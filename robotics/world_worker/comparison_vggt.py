"""Local-only, commercial-checkpoint VGGT arms for the reconstruction comparison.

This is a benchmark adapter, not a production worker registration. The BA arm
uses the commercial VGGT checkpoint's own track head and PyCOLMAP 4.2.1. It does
not reproduce the paper's VGGSfM-tracker BA recipe or its reported timings.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time

import numpy as np
from PIL import Image

SOURCE_REVISION = 'a288dd0f14786c93483e45524328726ab7b1b4ce'
MODEL_ID = 'facebook/VGGT-1B-Commercial'
MODEL_REVISION = 'ebb29a532abe92960eeb6903a5530f16990ef4ab'
MODEL_FILENAME = 'model.safetensors'
MODEL_SHA256 = '2b766b284359bc47ce26be107254621f685b758a0282082ff109f3ff02788b53'
MODEL_BYTES = 5_026_367_224
PYCOLMAP_VERSION = '4.2.1'
RESOLUTION = 518
MAX_VIEWS = 60
MAX_PREVIEW_POINTS = 100_000
DEPTH_CONFIDENCE = 5.0
TRACK_VISIBILITY = .5
TRACK_CONFIDENCE = .5
MAX_REPROJECTION_PIXELS = 8.0
MAX_QUERY_POINTS = 1024
MIN_FRAME_OBSERVATIONS = 8


def _hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 ** 2), b''):
            digest.update(block)
    return digest.hexdigest()


def preflight(source: Path, checkpoint: Path):
    """Validate exact reviewed local bytes. Never download code or checkpoints."""
    source, checkpoint = Path(source), Path(checkpoint)
    if source.is_symlink() or not source.is_absolute() or not source.is_dir():
        raise ValueError('VGGT source must be an absolute, regular local checkout path.')
    command = ['git', '-c', 'core.fsmonitor=false', '-C', str(source)]
    actual = subprocess.run([*command, 'rev-parse', 'HEAD'], check=True, capture_output=True,
                            text=True, timeout=15).stdout.strip()
    dirty = subprocess.run([*command, 'status', '--porcelain', '--untracked-files=all'], check=True,
                           capture_output=True, text=True, timeout=15).stdout.strip()
    if actual != SOURCE_REVISION or dirty:
        raise ValueError(f'VGGT source must be clean at {SOURCE_REVISION}.')
    if checkpoint.is_symlink() or not checkpoint.is_absolute() or not checkpoint.is_file():
        raise ValueError('Provide a regular local commercial model.safetensors file, not a URL or cache symlink.')
    if checkpoint.stat().st_size != MODEL_BYTES or _hash(checkpoint) != MODEL_SHA256:
        raise ValueError('Checkpoint does not match the pinned VGGT-1B-Commercial safetensors. Original NC and Omega weights are not accepted.')
    return {'source': {'repository': 'https://github.com/facebookresearch/vggt', 'revision': actual,
                       'clean': True},
            'checkpoint': {'repository': MODEL_ID, 'revision': MODEL_REVISION, 'file': MODEL_FILENAME,
                           'bytes': MODEL_BYTES, 'sha256': MODEL_SHA256,
                           'license': 'VGGT commercial license with use restrictions; access obtained separately'},
            'networkDownloads': False, 'paperBenchmarkReproduced': False}


def square_transform(width, height, resolution=RESOLUTION):
    """Prepared integer pixel centres -> black-square padded model centres.

    The reviewed loader first pads to max(width,height), resizes to 1024 with
    Pillow, then the demo uses align_corners=False interpolation to 518. The
    composition is (pixel + pad + .5) * resolution / max_dimension - .5.
    """
    if any(type(v) is not int or v < 1 for v in (width, height, resolution)):
        raise ValueError('Raster dimensions must be positive integers.')
    edge = max(width, height)
    left, top = (edge - width) // 2, (edge - height) // 2
    scale = resolution / edge
    return [[scale, 0., scale * (left + .5) - .5],
            [0., scale, scale * (top + .5) - .5], [0., 0., 1.]]


def camera_records(names, sizes, extrinsics, intrinsics, *, resolution=RESOLUTION):
    """Keep calibration attached to its actual model raster, with no recentering."""
    poses, calibration = np.asarray(extrinsics, float), np.asarray(intrinsics, float)
    count = len(names)
    if (not 3 <= count <= MAX_VIEWS or len(set(names)) != count or len(sizes) != count
            or poses.shape != (count, 3, 4) or calibration.shape != (count, 3, 3)
            or not np.isfinite(poses).all() or not np.isfinite(calibration).all()):
        raise ValueError('Malformed VGGT camera output.')
    frames = []
    for name, (width, height), pose, k in zip(names, sizes, poses, calibration):
        if not re.fullmatch(r'frame_\d{4}\.jpg', name):
            raise ValueError('Unexpected prepared image name.')
        rotation = pose[:, :3]
        if (not np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-4, rtol=0)
                or not math.isclose(float(np.linalg.det(rotation)), 1., abs_tol=1e-4)
                or abs(pose[:, 3]).max() > 10_000_000):
            raise ValueError('Camera pose must be a bounded proper rigid transform.')
        if (k[0, 0] <= 0 or k[1, 1] <= 0 or not np.allclose(k[2], [0, 0, 1], atol=1e-7, rtol=0)
                or abs(k[0, 1]) > 1e-7 or abs(k[1, 0]) > 1e-7):
            raise ValueError('Expected positive pinhole intrinsics without skew.')
        frames.append({'image': name, 'width': resolution, 'height': resolution,
                       'preparedWidth': width, 'preparedHeight': height,
                       'preparedToCameraPixelCenter': square_transform(width, height, resolution),
                       'camera': {'model': 'PINHOLE', 'params': [k[0, 0], k[1, 1], k[0, 2], k[1, 2]],
                                  'pixelConvention': 'integer-centres'},
                       'cam_from_world': pose.tolist()})
    return frames


def _images(images):
    images = Path(images)
    if images.is_symlink() or not images.is_dir():
        raise ValueError('Use a regular shared prepared-image directory.')
    paths = sorted(images.iterdir())
    if not 3 <= len(paths) <= MAX_VIEWS:
        raise ValueError('VGGT benchmark accepts 3 to 60 prepared frames.')
    sizes, records = [], []
    for path in paths:
        if path.is_symlink() or not path.is_file() or not re.fullmatch(r'frame_\d{4}\.jpg', path.name):
            raise ValueError('Only regular frame_0000.jpg-style prepared JPEGs are allowed.')
        if path.stat().st_size > 16 * 1024 ** 2:
            raise ValueError('Prepared image exceeds 16 MiB.')
        with Image.open(path) as image:
            if image.format != 'JPEG' or not 256 <= min(image.size) or max(image.size) > 1280:
                raise ValueError('Prepared JPEGs must have a 256px minimum side and a 1280px maximum edge.')
            image.verify()
            sizes.append(image.size)
        records.append({'image': path.name, 'sha256': _hash(path), 'bytes': path.stat().st_size})
    return paths, sizes, records


@contextmanager
def _offline():
    """No model helper may silently retrieve other checkpoints during inference."""
    connect, resolve = socket.socket.connect, socket.getaddrinfo
    keys = ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_DATASETS_OFFLINE')
    previous = {key: os.environ.get(key) for key in keys}

    def reject(*_args, **_kwargs):
        raise RuntimeError('Network access is disabled inside the VGGT comparison arm.')

    try:
        socket.socket.connect = reject
        socket.getaddrinfo = reject
        for key in keys:
            os.environ[key] = '1'
        yield
    finally:
        socket.socket.connect, socket.getaddrinfo = connect, resolve
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _projection(points, poses, intrinsics):
    camera = np.einsum('nij,pj->npi', poses[:, :, :3], points) + poses[:, None, :, 3]
    pixels = np.einsum('nij,npj->npi', intrinsics, camera)
    with np.errstate(divide='ignore', invalid='ignore'):
        pixels = pixels[:, :, :2] / pixels[:, :, 2:]
    return pixels, camera[:, :, 2]


def build_bundle(points, colours, poses, intrinsics, tracks, visibility, confidence,
                 *, names, resolution=RESOLUTION):
    """Build actual observed tracks in the pinned current PyCOLMAP rig API.

    VGGT pixels have integer centres. Both K's principal point and every track
    observation get +.5 exactly once when entering COLMAP's half-pixel space.
    """
    import pycolmap
    if pycolmap.__version__ != PYCOLMAP_VERSION:
        raise RuntimeError(f'VGGT BA requires pycolmap=={PYCOLMAP_VERSION}.')
    points, colours, poses, intrinsics, tracks, visibility, confidence = [np.asarray(value) for value in
        (points, colours, poses, intrinsics, tracks, visibility, confidence)]
    count, point_count = len(names), len(points)
    if (not 3 <= count <= MAX_VIEWS or not 30 <= point_count <= 3 * MAX_QUERY_POINTS
            or points.shape != (point_count, 3) or colours.shape != points.shape
            or poses.shape != (count, 3, 4) or intrinsics.shape != (count, 3, 3)
            or tracks.shape != (count, point_count, 2) or visibility.shape != (count, point_count)
            or confidence.shape != (count, point_count)
            or not all(np.isfinite(value).all() for value in (points, colours, poses, intrinsics, tracks, visibility, confidence))
            or np.abs(points).max() > 10_000_000 or colours.min() < 0 or colours.max() > 255
            or visibility.min() < 0 or visibility.max() > 1 or confidence.min() < 0 or confidence.max() > 1):
        raise ValueError('Malformed or oversized native-track BA inputs.')
    # Validate camera rigid poses and calibration before giving them to native code.
    camera_records(names, [(resolution, resolution)] * count, poses, intrinsics, resolution=resolution)
    pixels, depth = _projection(points, poses, intrinsics)
    mask = ((visibility >= TRACK_VISIBILITY) & (confidence >= TRACK_CONFIDENCE)
            & (depth > 1e-6) & (np.linalg.norm(pixels - tracks, axis=-1) <= MAX_REPROJECTION_PIXELS)
            & (tracks[:, :, 0] >= 0) & (tracks[:, :, 0] < resolution)
            & (tracks[:, :, 1] >= 0) & (tracks[:, :, 1] < resolution))
    keep = np.flatnonzero(mask.sum(0) >= 2)
    if len(keep) < 30 or (mask[:, keep].sum(1) < MIN_FRAME_OBSERVATIONS).any():
        raise ValueError('Insufficient visible, geometrically consistent VGGT native tracks for BA; no refinement result was produced.')
    reconstruction = pycolmap.Reconstruction()
    lookup = []
    for index, name in enumerate(names):
        identifier = index + 1
        k = intrinsics[index]
        camera = pycolmap.Camera(model='PINHOLE', width=resolution, height=resolution,
                                params=[k[0, 0], k[1, 1], k[0, 2] + .5, k[1, 2] + .5], camera_id=identifier)
        reconstruction.add_camera_with_trivial_rig(camera)
        observed = keep[mask[index, keep]]
        image = pycolmap.Image(name=name, keypoints=tracks[index, observed].astype(float) + .5,
                              camera_id=identifier, image_id=identifier)
        image.frame_id = identifier
        frame = pycolmap.Frame(frame_id=identifier, rig_id=identifier)
        frame.add_data_id(image.data_id)
        reconstruction.add_frame(frame)
        reconstruction.add_image(image)
        reconstruction.frame(identifier).set_cam_from_world(identifier, pycolmap.Rigid3d(poses[index].astype(float)))
        reconstruction.register_frame(identifier)
        lookup.append({int(point): row for row, point in enumerate(observed)})
    for point in keep:
        identifier = reconstruction.add_point3D(points[point].astype(float), pycolmap.Track(), colours[point].astype(np.uint8))
        for image_index, rows in enumerate(lookup):
            if int(point) in rows:
                reconstruction.add_observation(identifier, pycolmap.TrackElement(image_index + 1, rows[int(point)]))
    return reconstruction, {'candidateTracks': point_count, 'acceptedTracks': len(keep),
                            'observationsPerFrame': mask[:, keep].sum(1).astype(int).tolist(),
                            'maxInitialReprojectionPixels': MAX_REPROJECTION_PIXELS,
                            'visibilityThreshold': TRACK_VISIBILITY, 'confidenceThreshold': TRACK_CONFIDENCE}


def refine_bundle(reconstruction):
    """Bounded CPU BA with an explicit similarity gauge, without physical priors."""
    import pycolmap
    options = pycolmap.BundleAdjustmentOptions()
    options.refine_principal_point = False
    options.ceres.solver_options.num_threads = 2
    options.ceres.solver_options.max_num_iterations = 100
    options.ceres.solver_options.max_solver_time_in_seconds = 300.
    options.ceres.loss_function_type = pycolmap.LossFunctionType.HUBER
    options.ceres.loss_function_scale = 1.
    config = pycolmap.BundleAdjustmentConfig()
    for image_id in sorted(reconstruction.reg_image_ids()):
        config.add_image(image_id)
    config.fix_gauge(pycolmap.BundleAdjustmentGauge.TWO_CAMS_FROM_WORLD)
    adjuster = pycolmap.create_default_bundle_adjuster(options, config, reconstruction)
    summary = adjuster.solve()
    if not summary.is_solution_usable():
        raise ValueError('PyCOLMAP BA did not produce a usable solution.')
    reconstruction.update_point_3d_errors()
    return {'solver': 'PyCOLMAP Ceres CPU', 'maxIterations': 100, 'maxSeconds': 300,
            'gauge': 'TWO_CAMS_FROM_WORLD', 'loss': 'Huber1px',
            'principalPointRefined': False, 'meanReprojectionErrorPixels': reconstruction.compute_mean_reprojection_error()}


def _numpy(tensor):
    return tensor.detach().float().cpu().numpy()


def _native_tracks(model, images, points, depth_conf, torch, dtype):
    """Up to three deterministic query views, using only the approved weights."""
    count = len(images)
    positions = sorted(set((0, count // 2, count - 1)))
    tracks, visibility, confidence, seeds, colours, queried = [], [], [], [], [], []
    # A regular grid makes this benchmark's query policy explicit and repeatable.
    grid_axis = np.arange(8, RESOLUTION - 8, 16)
    yy, xx = np.meshgrid(grid_axis, grid_axis, indexing='ij')
    grid = np.column_stack((xx.ravel(), yy.ravel()))[:MAX_QUERY_POINTS]
    for index in positions:
        valid = depth_conf[index, grid[:, 1], grid[:, 0]] >= DEPTH_CONFIDENCE
        query = grid[valid]
        if len(query) < 30:
            continue
        queried.append(index)
        order = [index, *[i for i in range(count) if i != index]]
        reverse = np.argsort(order)
        feed = images[order][None]
        with torch.inference_mode(), torch.autocast('cuda', dtype=dtype):
            tokens, patch_start = model.aggregator(feed)
            predictions, vis, conf = model.track_head(tokens, images=feed, patch_start_idx=patch_start,
                                                      query_points=torch.as_tensor(query[None], device='cuda', dtype=torch.float32))
        tracks.append(_numpy(predictions[-1])[0, reverse])
        visibility.append(_numpy(vis)[0, reverse])
        confidence.append(_numpy(conf)[0, reverse])
        seeds.append(points[index, query[:, 1], query[:, 0]])
        colour = _numpy(images[index]).transpose(1, 2, 0)
        colours.append(np.rint(colour[query[:, 1], query[:, 0]] * 255).astype(np.uint8))
        del predictions, vis, conf, tokens, feed
    if not tracks:
        raise ValueError('No confident VGGT native query points for bundle adjustment.')
    return (np.concatenate(seeds), np.concatenate(colours), np.concatenate(tracks, axis=1),
            np.concatenate(visibility, axis=1), np.concatenate(confidence, axis=1), queried)


def run(images: Path, out: Path, source: Path, checkpoint: Path, use_ba: bool):
    """Execute one isolated benchmark arm. Inputs remain untouched; out is fresh."""
    started = time.monotonic()
    provenance = preflight(source, checkpoint)
    paths, sizes, image_records = _images(images)
    out = Path(out)
    if out.is_symlink() or (out.exists() and (not out.is_dir() or any(out.iterdir()))):
        raise ValueError('VGGT arm output must be a fresh or empty directory.')
    out.mkdir(parents=True, exist_ok=True)
    if type(use_ba) is not bool:
        raise ValueError('use_ba must be a Boolean.')
    with _offline():
        import torch
        from safetensors.torch import load_file
        if not torch.cuda.is_available():
            raise RuntimeError('VGGT comparison requires a qualified CUDA worker; no CPU inference is claimed.')
        # Prevent accidentally using another installed VGGT package.
        if any(key == 'vggt' or key.startswith('vggt.') for key in sys.modules):
            raise RuntimeError('Run VGGT in a fresh child process; a VGGT module was already imported.')
        sys.path.insert(0, str(Path(source)))
        from vggt.models.vggt import VGGT
        from vggt.utils.load_fn import load_and_preprocess_images_square
        from vggt.utils.pose_enc import pose_encoding_to_extri_intri
        from vggt.utils.geometry import unproject_depth_map_to_point_map
        import vggt.models.vggt as model_module
        if not Path(model_module.__file__).resolve().is_relative_to(Path(source).resolve()):
            raise RuntimeError('VGGT import did not originate in the reviewed checkout.')
        torch.manual_seed(0)
        np.random.seed(0)
        torch.cuda.manual_seed_all(0)
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
        torch.backends.cuda.matmul.allow_tf32 = False
        dtype = torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16
        torch.cuda.reset_peak_memory_stats()
        load_started = time.monotonic()
        model = VGGT()
        state = load_file(str(checkpoint), device='cpu')
        model.load_state_dict(state, strict=True)
        del state
        model = model.eval().to('cuda')
        torch.cuda.synchronize()
        load_seconds = time.monotonic() - load_started
        input_started = time.monotonic()
        prepared, _coords = load_and_preprocess_images_square([str(path) for path in paths], target_size=1024)
        tensor = torch.nn.functional.interpolate(prepared, size=(RESOLUTION, RESOLUTION), mode='bilinear',
                                                 align_corners=False).to('cuda')
        del prepared
        torch.cuda.synchronize()
        input_seconds = time.monotonic() - input_started
        inference_started = time.monotonic()
        with torch.inference_mode():
            with torch.autocast('cuda', dtype=dtype):
                tokens, patch_start = model.aggregator(tensor[None])
            # Same camera/depth branch precision policy as the official demo.
            pose_encoding = model.camera_head(tokens)[-1]
            extrinsics, intrinsics = pose_encoding_to_extri_intri(pose_encoding, tensor.shape[-2:])
            depth, depth_confidence = model.depth_head(tokens, images=tensor[None], patch_start_idx=patch_start)
        poses, calibration = _numpy(extrinsics)[0], _numpy(intrinsics)[0]
        depths, conf = _numpy(depth)[0], _numpy(depth_confidence)[0]
        del tokens, pose_encoding, extrinsics, intrinsics, depth, depth_confidence
        torch.cuda.synchronize()
        inference_seconds = time.monotonic() - inference_started
        frames = camera_records([path.name for path in paths], sizes, poses, calibration)
        if depths.shape != (len(paths), RESOLUTION, RESOLUTION, 1) or conf.shape != depths.shape[:-1]:
            raise ValueError('VGGT depth/confidence shape does not match the camera raster.')
        points = np.asarray(unproject_depth_map_to_point_map(depths, poses, calibration), float)
        if points.shape != (*conf.shape, 3):
            raise ValueError('VGGT unprojection shape does not match its raster.')
        colours = np.rint(_numpy(tensor).transpose(0, 2, 3, 1) * 255).astype(np.uint8)
        yy, xx = np.meshgrid(np.arange(RESOLUTION), np.arange(RESOLUTION), indexing='ij')
        valid_raster = []
        for width, height in sizes:
            transform = np.asarray(square_transform(width, height))
            # Padding is never evidence of observed geometry.
            x = (xx - transform[0, 2]) / transform[0, 0]
            y = (yy - transform[1, 2]) / transform[1, 1]
            valid_raster.append((x >= 0) & (x <= width - 1) & (y >= 0) & (y <= height - 1))
        valid = (np.asarray(valid_raster) & (conf >= DEPTH_CONFIDENCE) & np.isfinite(points).all(axis=-1)
                 & (np.abs(points) <= 10_000_000).all(axis=-1) & np.isfinite(depths[..., 0]) & (depths[..., 0] > 0))
        selected = np.flatnonzero(valid.ravel())
        if len(selected) < 30:
            raise ValueError('VGGT produced fewer than 30 admitted depth points.')
        stride = max(1, math.ceil(len(selected) / MAX_PREVIEW_POINTS))
        selected = selected[::stride]
        from .geometry import write_point_cloud
        artifacts = [write_point_cloud(out / 'vggt-depth-preview.ply', points.reshape(-1, 3)[selected],
                                      colours.reshape(-1, 3)[selected], coordinate_frame='colmap')]
        artifacts[0]['basis'] = 'raw-VGGT-depth-and-cameras; not BA-refined'
        track_seconds, ba_seconds, bundle_info = 0., 0., None
        if use_ba:
            track_started = time.monotonic()
            seeded_points, seeded_colours, tracks, visibility, confidence, queries = _native_tracks(
                model, tensor, points, np.where(valid, conf, -1.), torch, dtype)
            torch.cuda.synchronize()
            track_seconds = time.monotonic() - track_started
            ba_started = time.monotonic()
            reconstruction, bundle_info = build_bundle(seeded_points, seeded_colours, poses, calibration,
                                                        tracks, visibility, confidence, names=[path.name for path in paths])
            bundle_info.update(refine_bundle(reconstruction))
            bundle_info['queryFrameIndices'] = queries
            bundle_info['recipe'] = 'VGGT native track head; deterministic16pxgrid; up to3queryviews; not paper VGGSfM recipe'
            sparse = out / 'sparse'; sparse.mkdir()
            reconstruction.write(sparse)
            refined_poses, refined_intrinsics = [], []
            for identifier in range(1, len(paths) + 1):
                image = reconstruction.image(identifier)
                camera = reconstruction.camera(image.camera_id)
                k = np.asarray(camera.calibration_matrix(), float)
                k[:2, 2] -= .5  # Native COLMAP centre -> VGGT integer centre.
                refined_poses.append(image.cam_from_world().matrix())
                refined_intrinsics.append(k)
            frames = camera_records([path.name for path in paths], sizes, refined_poses, refined_intrinsics)
            refined = [point for _, point in sorted(reconstruction.points3D.items())]
            artifacts.append(write_point_cloud(out / 'vggt-ba-sparse-preview.ply', np.array([p.xyz for p in refined]),
                                               np.array([p.color for p in refined]), coordinate_frame='colmap'))
            artifacts[-1]['basis'] = 'VGGT-native-track PyCOLMAP BA refined sparse points'
            ba_seconds = time.monotonic() - ba_started
        torch.cuda.synchronize()
        gpu = {'device': torch.cuda.get_device_name(), 'capability': list(torch.cuda.get_device_capability()),
               'totalBytes': torch.cuda.get_device_properties(0).total_memory,
               'peakAllocatedBytes': torch.cuda.max_memory_allocated(), 'peakReservedBytes': torch.cuda.max_memory_reserved(),
               'scope': 'this process PyTorch CUDA allocator; excludes other processes and driver memory'}
        runtime = {'torch': torch.__version__, 'cuda': torch.version.cuda, 'numpy': np.__version__,
                   'dtype': str(dtype), 'seed': 0,
                   'determinism': 'seeded; deterministic cuDNN requested; bitwise cross-hardware equality not guaranteed'}
        for package in ('torchvision', 'safetensors', 'Pillow', 'einops', 'huggingface_hub', 'pycolmap'):
            try:
                runtime[package] = importlib.metadata.version(package)
            except importlib.metadata.PackageNotFoundError:
                runtime[package] = None
    # Detect changes to the shared inputs during this arm.
    if any(record['sha256'] != _hash(path) or record['bytes'] != path.stat().st_size for path, record in zip(paths, image_records)):
        raise ValueError('Prepared input frames changed during VGGT execution.')
    for frame, record in zip(frames, image_records):
        frame['imageSha256'] = record['sha256']
    cameras = {'schema': 'brainsnn.comparison-cameras.v1', 'coordinateFrame': 'vggt-arbitrary',
               'metricVerified': False, 'frames': frames}
    (out / 'cameras.json').write_text(json.dumps(cameras, indent=2, allow_nan=False))
    metadata = {**provenance, 'engine': 'vggt_ba' if use_ba else 'vggt', 'frames': len(frames),
                'predictedFrames': len(frames), 'registeredFrames': None,
                'frameStatus': 'predicted cameras, not independently registered/validated cameras',
                'artifacts': artifacts, 'runtime': runtime, 'gpu': gpu, 'bundleAdjustment': bundle_info,
                'stageSeconds': {'modelLoad': load_seconds, 'modelPreprocessing': input_seconds,
                                 'cameraDepthInference': inference_seconds, 'nativeTracking': track_seconds,
                                 'bundleAdjustmentAndExport': ba_seconds},
                'elapsedSeconds': time.monotonic() - started,
                'scale': {'units': 'arbitrary', 'measured': False}, 'metricVerified': False,
                'physicalRobotValidated': False, 'paperBenchmarkReproduced': False,
                'depthConfidenceThreshold': DEPTH_CONFIDENCE}
    (out / 'engine.json').write_text(json.dumps(metadata, indent=2, allow_nan=False))
    return metadata
