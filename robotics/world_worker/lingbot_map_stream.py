"""Optional, local-only LingBot-Map streaming reconstruction adapter (one walkthrough video, or 3-12 photos in order).

LingBot-Map (Apache-2.0 code, github.com/robbyant/lingbot-map) is a feed-forward model that poses every frame of a
long walk in one pass, where COLMAP folds on repeated surfaces. A feed-forward pose is still a prediction, so every
consecutive pair of frames is checked against the turn the two frames' own feature matches give (turn_check), and the
result is recorded as capture.consistency, which the site already shows as an error when it reads 'folded'.

Units are the model's own: nothing here is metric until the person sets a measured distance. GPU inference must be
qualified on the target host before enabling this adapter (docs/hermes-gpu-tasks.md), which also pins the checkpoint's
SHA-256: lingbot-map.pt and lingbot-map-long.pt are the same size, so the size alone cannot tell them apart. This
process never downloads model or code files and never unpickles anything but tensors.
"""
from __future__ import annotations
import argparse
import json
import math
import os
from pathlib import Path
import sys
import time

try:
    from .geometry import write_point_cloud, MAX_PREVIEW_COORDINATE
    from .sparse_colmap import prepare_photo, extract_video, FOLD_DEGREES, FOLD_MIN_MATCHES, FOLD_LISTED
    from .mapanything_apache import file_hash, verify_source, deny_network, as_numpy
except ImportError:
    from geometry import write_point_cloud, MAX_PREVIEW_COORDINATE
    from sparse_colmap import prepare_photo, extract_video, FOLD_DEGREES, FOLD_MIN_MATCHES, FOLD_LISTED
    from mapanything_apache import file_hash, verify_source, deny_network, as_numpy

PIPELINE = 'lingbot-map-stream'
SOURCE_REVISION = 'b9dd1b1de535e6d36e777fb42b8433c781bfd783'
MODEL_ID = 'robbyant/lingbot-map'
MODEL_FILE = 'lingbot-map.pt'
MODEL_BYTES = 4_632_303_465
# Set from the downloaded file during GPU qualification (python lingbot_map_stream.py --hash-checkpoint PATH); until
# then the adapter refuses to load any checkpoint.
MODEL_SHA256 = None
MAX_PHOTOS = 12
MAX_POINTS = 100_000
IMAGE_SIZE, PATCH_SIZE = 518, 14  # the model's canonical crop: width 518, height a multiple of 14, at most 518
SCALE_FRAMES = 8  # frames the model reads together before streaming the rest one at a time (its default)
CONFIDENCE_MIN = 1.5  # the upstream demo's visibility threshold on depth confidence
CONFIDENCE_PERCENTILE = 20  # and the least confident fifth of each frame is dropped, as for MapAnything
BACKENDS = ('sdpa', 'flashinfer')
# Turn check: SIFT matches between consecutive model rasters, ratio test, then an essential matrix in normalised
# coordinates from the model's own intrinsics. A pair whose matches fit a homography about as well as the essential
# matrix (a flat wall, or a camera turning on the spot) cannot give a reliable turn and is skipped, not trusted.
RATIO = 0.8
HOMOGRAPHY_SHARE = 0.9
_Y_UP = ((1., 0., 0., 0.), (0., -1., 0., 0.), (0., 0., -1., 0.), (0., 0., 0., 1.))


def local_installation():
    """The pinned source checkout and checkpoint, or an error before anything is loaded."""
    values = [os.environ.get(key) for key in ['WORLD_LINGBOT_SOURCE_DIR', 'WORLD_LINGBOT_MODEL_PATH']]
    if not all(values):
        raise RuntimeError('Install the pinned LingBot-Map source and checkpoint locally; set WORLD_LINGBOT_SOURCE_DIR and WORLD_LINGBOT_MODEL_PATH.')
    source, checkpoint = (Path(value).resolve() for value in values)
    verify_source(source, SOURCE_REVISION)
    if MODEL_SHA256 is None:
        raise RuntimeError('The LingBot-Map checkpoint hash is not pinned yet. Qualify it on the GPU host first (docs/hermes-gpu-tasks.md). No inference was started.')
    path = Path(values[1])
    if path.is_symlink() or not checkpoint.is_file() or checkpoint.stat().st_size != MODEL_BYTES or file_hash(checkpoint) != MODEL_SHA256:
        raise RuntimeError(f'Local {MODEL_FILE} does not match the pinned checkpoint. No inference was started.')
    backend = os.environ.get('WORLD_LINGBOT_BACKEND', 'sdpa')
    if backend not in BACKENDS:
        raise RuntimeError('WORLD_LINGBOT_BACKEND must be sdpa or flashinfer.')
    return source, checkpoint, backend


def model_crop(width, height):
    """The pinned loader's crop mode (lingbot_map/utils/load_fn.py at SOURCE_REVISION): Pillow resize to width 518 and a
    height rounded to a multiple of 14, then a centre crop to 518 rows when taller. Returns the model raster size and
    the prepared-to-model pixel-centre transform (Pillow maps centres by (x+.5)*scale-.5), and how many resized rows
    the crop dropped (a portrait frame loses its top and bottom)."""
    if any(type(value) is not int or value < 1 for value in (width, height)):
        raise ValueError('Prepared frame dimensions must be positive integers.')
    resized = round(height * (IMAGE_SIZE / width) / PATCH_SIZE) * PATCH_SIZE
    if resized < PATCH_SIZE:
        raise ValueError('A prepared frame is too wide for the model crop.')
    top = (resized - IMAGE_SIZE) // 2 if resized > IMAGE_SIZE else 0
    sx, sy = IMAGE_SIZE / width, resized / height
    transform = [[sx, 0., (sx - 1) / 2], [0., sy, (sy - 1) / 2 - top], [0., 0., 1.]]
    return IMAGE_SIZE, min(resized, IMAGE_SIZE), transform, max(0, resized - IMAGE_SIZE)


def cameras_from_predictions(extrinsic, intrinsic, size_hw):
    """Validate the decoded cameras: pose_encoding_to_extri_intri returns camera-to-world [R|t] with OpenCV axes and a
    pinhole whose principal point is the raster centre. A finite matrix can still hold shear, scale or a reflection,
    which would corrupt every later projection into a frame, so each rotation must be rigid and right-handed."""
    import numpy as np
    extrinsic, intrinsic = as_numpy(extrinsic).astype(float), as_numpy(intrinsic).astype(float)
    count = len(extrinsic)
    if extrinsic.shape != (count, 3, 4) or intrinsic.shape != (count, 3, 3) or count < 1:
        raise ValueError('Model camera output shapes do not match the reviewed API.')
    if not np.isfinite(extrinsic).all() or not np.isfinite(intrinsic).all():
        raise ValueError('Invalid predicted camera geometry.')
    height, width = size_hw
    cameras = []
    for pose, K in zip(extrinsic, intrinsic):
        rotation = pose[:, :3]
        if (not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-3, rtol=0)
                or not np.isclose(np.linalg.det(rotation), 1, atol=1e-3, rtol=0)):
            raise ValueError('Invalid predicted camera rotation: expected a right-handed rigid pose.')
        if (K[0, 0] <= 0 or K[1, 1] <= 0 or not np.allclose([K[0, 1], K[1, 0]], 0, atol=1e-6)
                or not np.allclose(K[2], [0, 0, 1], atol=1e-6) or not np.allclose(K[:2, 2], [width / 2, height / 2], atol=1e-3)):
            raise ValueError('Invalid predicted camera intrinsics: expected positive focal lengths, no skew and a centred principal point.')
        camera_to_world = np.eye(4); camera_to_world[:3] = pose
        cameras.append({'camera_to_world': camera_to_world, 'K': K})
    return cameras


def world_points(depth, cameras):
    """Each frame's depth through its own camera, exactly as the pinned unproject_depth_map_to_point_map does
    (integer pixel centres, principal point at W/2, H/2), so the points and the recorded cameras agree by construction."""
    import numpy as np
    depth = as_numpy(depth).astype(float)
    if depth.ndim == 4 and depth.shape[-1] == 1:
        depth = depth[..., 0]
    if depth.ndim != 3 or len(depth) != len(cameras) or not 1 <= depth.shape[1] * depth.shape[2] <= 1_000_000:
        raise ValueError('Model depth output shapes do not match the reviewed API.')
    _, height, width = depth.shape
    u, v = np.meshgrid(np.arange(width), np.arange(height))
    points = []
    for frame, camera in zip(depth, cameras):
        K, pose = camera['K'], camera['camera_to_world']
        local = np.stack([(u - K[0, 2]) * frame / K[0, 0], (v - K[1, 2]) * frame / K[1, 1], frame], axis=-1)
        points.append(local @ pose[:3, :3].T + pose[:3, 3])
    return np.stack(points)


def preview(points, depth, confidence, rasters, *, max_points=MAX_POINTS):
    """Confident, finite points in the viewer's right-handed Y-up frame (OpenCV y and z flipped), split evenly over frames."""
    import numpy as np
    depth, confidence, rasters = (as_numpy(value) for value in (depth, confidence, rasters))
    if depth.ndim == 4:
        depth = depth[..., 0]
    count = len(points)
    if (points.shape[:3] != depth.shape or confidence.shape != depth.shape or rasters.shape != (*depth.shape, 3)
            or rasters.dtype != np.uint8 or not 1 <= count):
        raise ValueError('Model depth, confidence and raster shapes disagree.')
    if type(max_points) is not int or not count <= max_points <= MAX_POINTS:
        raise ValueError('Invalid preview point budget.')
    budget, chosen, colours, counts = max_points // count, [], [], []
    for index in range(count):
        flat, conf = points[index].reshape(-1, 3), confidence[index].reshape(-1)
        finite = np.isfinite(flat).all(axis=1) & np.isfinite(conf) & (depth[index].reshape(-1) > 1e-8)
        cut = max(CONFIDENCE_MIN, float(np.percentile(conf[finite], CONFIDENCE_PERCENTILE))) if finite.any() else math.inf
        valid = finite & (conf >= cut) & (np.abs(flat) <= MAX_PREVIEW_COORDINATE).all(axis=1)
        indices = np.flatnonzero(valid)
        selected = indices[::max(1, math.ceil(len(indices) / budget))] if len(indices) else indices
        chosen.append(flat[selected] * np.array([1., -1., -1.]))
        colours.append(rasters[index].reshape(-1, 3)[selected])
        counts.append({'view': index, 'predicted_pixels': int(len(flat)), 'confident_points': int(len(indices)),
                       'preview_points': int(len(selected)), 'confidence_cut': round(cut, 4) if math.isfinite(cut) else None})
    points, colours = np.concatenate(chosen), np.concatenate(colours)
    if len(points) < 30:
        raise ValueError('Too little confident model geometry to publish a preview.')
    return points, colours, counts


def relative_turn(first, second):
    """Rotation taking first-camera coordinates to second-camera coordinates, from two camera-to-world poses."""
    return second['camera_to_world'][:3, :3].T @ first['camera_to_world'][:3, :3]


def angle_between(a, b):
    import numpy as np
    cosine = (np.trace(a.T @ b) - 1) / 2
    return math.degrees(math.acos(max(-1.0, min(1.0, float(cosine)))))


def two_view_turn(points_a, points_b, K_a, K_b):
    """The second camera's turn relative to the first from matched pixels, or (None, reason) when the pair cannot say."""
    import cv2
    import numpy as np
    points_a, points_b = np.asarray(points_a, float).reshape(-1, 2), np.asarray(points_b, float).reshape(-1, 2)
    if len(points_a) < FOLD_MIN_MATCHES or len(points_a) != len(points_b):
        return None, 'too few matches'
    normalised = [cv2.undistortPoints(p.reshape(-1, 1, 2), K, None).reshape(-1, 2) for p, K in ((points_a, K_a), (points_b, K_b))]
    focal = (K_a[0, 0] + K_a[1, 1] + K_b[0, 0] + K_b[1, 1]) / 4
    E, mask = cv2.findEssentialMat(*normalised, np.eye(3), method=cv2.RANSAC, prob=0.999, threshold=1.0 / focal)
    if E is None or E.shape[1:] != (3,) or len(E) < 3:
        return None, 'no essential matrix'
    inliers, R, _, _ = cv2.recoverPose(E[:3], *normalised, np.eye(3), mask=mask)
    if inliers < FOLD_MIN_MATCHES:
        return None, 'too few inliers'
    _, planar = cv2.findHomography(*normalised, cv2.RANSAC, 1.0 / focal)
    if planar is not None and planar.sum() >= HOMOGRAPHY_SHARE * inliers:
        return None, 'planar or turning on the spot'
    return R, int(inliers)


def matches(raster_a, raster_b):
    """SIFT keypoints matched by Lowe's ratio test, as two pixel arrays in integer-centre coordinates."""
    import cv2
    import numpy as np
    sift = cv2.SIFT_create(nfeatures=2000)
    found = [sift.detectAndCompute(cv2.cvtColor(raster, cv2.COLOR_RGB2GRAY), None) for raster in (raster_a, raster_b)]
    if any(descriptors is None or len(descriptors) < 2 for _, descriptors in found):
        return np.empty((0, 2)), np.empty((0, 2))
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(found[0][1], found[1][1], k=2)
    good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < RATIO * pair[1].distance]
    return (np.array([found[0][0][m.queryIdx].pt for m in good]).reshape(-1, 2),
            np.array([found[1][0][m.trainIdx].pt for m in good]).reshape(-1, 2))


def turn_check(cameras, rasters, names):
    """capture.consistency for model poses: each consecutive pair's modelled turn against the turn its matches give.
    Same threshold and record shape as sparse_colmap.fold_check, so the site and the qualification read both alike. It
    keeps the strict rule (any pair over the threshold is a fold) until GPU qualification measures this engine's pairs."""
    turns, skipped, reasons = [], 0, {}
    for index in range(len(cameras) - 1):
        a, b = matches(rasters[index], rasters[index + 1])
        if len(a) < FOLD_MIN_MATCHES:
            skipped += 1; reasons['too few matches'] = reasons.get('too few matches', 0) + 1; continue
        matched, detail = two_view_turn(a, b, cameras[index]['K'], cameras[index + 1]['K'])
        if matched is None:
            skipped += 1; reasons[detail] = reasons.get(detail, 0) + 1; continue
        turns.append({'from': names[index], 'to': names[index + 1], 'matches': detail,
                      'disagreementDegrees': round(angle_between(matched, relative_turn(cameras[index], cameras[index + 1])), 2)})
    folds = [turn for turn in turns if turn['disagreementDegrees'] > FOLD_DEGREES]
    ordered = sorted(turn['disagreementDegrees'] for turn in turns)
    return {'method': 'model turn against two-view turn from SIFT matches, consecutive frames', 'thresholdDegrees': FOLD_DEGREES,
            'status': 'folded' if folds else 'consistent' if turns else 'not-checked',
            'pairsChecked': len(turns), 'pairsSkipped': skipped, 'skippedReasons': reasons, 'pairsDisagreeing': len(folds),
            'medianDisagreementDegrees': ordered[len(ordered) // 2] if ordered else None,
            'worstDisagreementDegrees': ordered[-1] if ordered else None,
            'disagreeing': sorted(folds, key=lambda turn: -turn['disagreementDegrees'])[:FOLD_LISTED]}


def camera_records(cameras, names):
    """reconstruction.json cameras in the points' Y-up frame. The site and the ETH3D benchmark read camera_to_world_y_up;
    image and camera_center let the synthetic benchmark match each camera to its prepared frame, as for COLMAP."""
    import numpy as np
    flip = np.array(_Y_UP)
    records = []
    for view, (camera, name) in enumerate(zip(cameras, names)):
        pose = flip @ camera['camera_to_world'] @ flip
        records.append({'view': view, 'image': name, 'camera_to_world_y_up': pose.tolist(),
                        'camera_center': pose[:3, 3].tolist(), 'intrinsics_opencv': camera['K'].tolist()})
    return records


def frame_ledger(cameras, rasters, paths, preparations, sources, out, transforms):
    """camera-frames.json: each model raster (private, beside the job) with its camera, bound to the published cloud."""
    import numpy as np
    from PIL import Image
    try:
        from . import camera_frames
    except ImportError:
        import camera_frames
    root = out.parent
    if not len(cameras) == len(rasters) == len(paths) == len(preparations) == len(transforms):
        raise ValueError('Camera frame evidence requires every prepared frame and prediction in filming order.')
    for path, prep in zip(paths, preparations):
        source_index = prep.get('sourceIndex')
        if (type(source_index) is not int or not 0 <= source_index < len(sources) or prep.get('image') != path.name
                or prep.get('sourceSha256') != sources[source_index]['sha256']
                or prep.get('preparation', prep).get('preparedSha256') != file_hash(path)):
            raise ValueError('Prepared camera frame source/hash association does not match this view.')
    private = root / 'lingbot-frames'
    private.mkdir(exist_ok=False)
    flip = np.array(_Y_UP)
    frames = []
    for index, (camera, pixels, path, prep, transform) in enumerate(zip(cameras, rasters, paths, preparations, transforms)):
        source_index = prep['sourceIndex']
        target = private / f'view_{index:04d}.png'
        Image.fromarray(pixels).save(target, format='PNG')
        K = camera['K']
        model = {'model': 'PINHOLE', 'params': [float(K[0, 0]), float(K[1, 1]), float(K[0, 2]), float(K[1, 2])],
                 'pixelConvention': 'integer-centres'}
        # Points are in Y-up; camera-local coordinates stay OpenCV for these intrinsics: inv(cam2world_cv) @ yup_to_cv.
        pose = (np.linalg.inv(camera['camera_to_world']) @ flip)[:3].tolist()
        image = camera_frames.file_record(root, target, width=pixels.shape[1], height=pixels.shape[0])
        with Image.open(path) as prepared:
            prepared_size = prepared.size
        frames.append({
            'frame_id': camera_frames.frame_id(sources[source_index]['sha256'], image['sha256'], model, pose),
            'image': image, 'preparedImage': camera_frames.file_record(root, path, width=prepared_size[0], height=prepared_size[1]),
            'origin': {'sourceIndex': source_index, 'sourceWidth': prep.get('sourceWidth'), 'sourceHeight': prep.get('sourceHeight'),
                       'exifOrientation': prep.get('exifOrientation'), 'sourceToFramePixelCenter': None},
            'timestamp': prep.get('timestamp'), 'camera': model, 'cam_from_world': pose,
            'preprocessing': {'sourceToModelPixelCenter': None, 'preparedToModelPixelCenter': transform,
                              'reason': 'Pinned loader crop mode: resize to width 518, centre crop to at most 518 rows.',
                              'raster': 'Model-input RGB, rounded to uint8, not the original upload.'}})
    record = {'schema': 'brainsnn.camera-frames.v1', 'sources': sources,
              'reconstruction': camera_frames.file_record(root, out / 'reconstruction.json'),
              'clouds': [camera_frames.file_record(root, out / 'dense-preview.ply', coordinate_frame='right-handed-y-up')],
              'frames': frames, 'metric_verified': False}
    camera_frames.write(root, record, output_path=out / 'camera-frames.json')
    return record


def load_model(torch, checkpoint, backend, device):
    """The demo's streaming configuration at SOURCE_REVISION, with tensors-only loading and every model weight present:
    a missing key would leave random weights in the network and still produce confident-looking geometry."""
    from lingbot_map.models.gct_stream import GCTStream
    model = GCTStream(img_size=IMAGE_SIZE, patch_size=PATCH_SIZE, enable_3d_rope=True, max_frame_num=1024,
                      kv_cache_sliding_window=64, kv_cache_scale_frames=SCALE_FRAMES, kv_cache_cross_frame_special=True,
                      kv_cache_include_scale_frames=True, use_sdpa=backend == 'sdpa', camera_num_iterations=4)
    if checkpoint is not None:
        try:
            state = torch.load(str(checkpoint), map_location='cpu', weights_only=True, mmap=True)
        except Exception as error:  # noqa: BLE001  includes the refusal to unpickle anything but tensors
            raise RuntimeError('The checkpoint could not be loaded as tensors only; it is not loaded.') from error
        missing, _ = model.load_state_dict(state.get('model', state), strict=False)
        if missing:
            raise RuntimeError(f'The checkpoint lacks {len(missing)} model weights; no inference was started.')
    return model.to(device).eval()


def infer(torch, model, images, device):
    """Streaming inference (scale frames together, then one frame at a time with the KV cache), predictions on the CPU."""
    from lingbot_map.utils.pose_enc import pose_encoding_to_extri_intri
    cuda = device.type == 'cuda'
    dtype = (torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16) if cuda else torch.float32
    if cuda:
        model.aggregator = model.aggregator.to(dtype=dtype)  # heads stay fp32, as in the upstream demo
    with torch.no_grad(), torch.autocast(device.type, dtype=dtype, enabled=cuda):
        predictions = model.inference_streaming(images, num_scale_frames=min(SCALE_FRAMES, len(images)),
                                                keyframe_interval=1, output_device=torch.device('cpu'))
    extrinsic, intrinsic = pose_encoding_to_extri_intri(predictions['pose_enc'].float(), images.shape[-2:])
    return {'extrinsic': extrinsic[0], 'intrinsic': intrinsic[0], 'depth': predictions['depth'][0].float(),
            'depth_conf': predictions['depth_conf'][0].float()}


def prepare_inputs(items, images):
    """Hash the sources and write the prepared frames: the same video frames as colmap-sparse, or the photos in order."""
    sources = []
    for item in items:
        path = Path(item['path'])
        if not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise ValueError('Inputs must be regular local files.')
        sources.append({'name': item['name'], 'kind': item['kind'], 'sha256': file_hash(path)})
    if items[0]['kind'] == 'video':
        capture = extract_video(Path(items[0]['path']), images)
        return sources, capture, capture['frames']
    preparations = []
    for index, item in enumerate(items):
        target = images / f'image_{index:04d}.jpg'
        prep = prepare_photo(Path(item['path']), target, with_evidence=True)
        preparations.append({'image': target.name, 'sourceIndex': index, 'sourceSha256': prep['sourceSha256'],
                             'sourceWidth': prep['sourceWidth'], 'sourceHeight': prep['sourceHeight'],
                             'exifOrientation': prep['exifOrientation'], 'timestamp': None, 'preparation': prep})
    return sources, {}, preparations


def prepare(items, out):
    """Validate the request's inputs, write the prepared frames and work out the model crop for each."""
    from PIL import Image
    photos = 3 <= len(items) <= MAX_PHOTOS and all(item.get('kind') == 'image' for item in items)
    video = len(items) == 1 and items[0].get('kind') == 'video'
    if not (photos or video):
        raise ValueError('Use one walkthrough video, or 3-12 photos in the order they were taken.')
    images = out.parent / 'lingbot-images'; images.mkdir(exist_ok=False)
    sources, capture, preparations = prepare_inputs(items, images)
    paths = [images / prep['image'] for prep in preparations]
    crops = []
    for path in paths:
        with Image.open(path) as prepared:
            crops.append(model_crop(*prepared.size))
    if len({crop[:2] for crop in crops}) != 1:
        raise ValueError('Every frame must share one model raster size; use photos of one orientation.')
    return sources, capture, preparations, paths, crops


def publish(out, prepared, predictions, rasters, *, run_record):
    """Everything after inference, on plain arrays: cameras, cloud, turn check, receipt, frame ledger and manifest.
    predictions holds extrinsic (S,3,4 camera-to-world, OpenCV), intrinsic (S,3,3), depth and depth_conf; rasters are
    the model inputs as uint8 RGB."""
    sources, capture, preparations, paths, crops = prepared
    cameras = cameras_from_predictions(predictions['extrinsic'], predictions['intrinsic'], rasters.shape[1:3])
    if len(cameras) != len(paths) or len(rasters) != len(paths):
        raise ValueError('The model did not return every submitted frame.')
    points = world_points(predictions['depth'], cameras)
    cloud, colours, counts = preview(points, predictions['depth'], predictions['depth_conf'], rasters)
    names = [path.name for path in paths]
    consistency = turn_check(cameras, rasters, names)
    visual = write_point_cloud(out / 'dense-preview.ply', cloud, colours, coordinate_frame='right-handed-y-up')
    warnings = ['Model geometry and scale are predictions; set a measured distance before measuring anything.',
                'Dense points are not a watertight collision mesh or a proof of free space.',
                'Review scale, floor alignment, missing surfaces and obstacles before planning.']
    if any(crop[3] for crop in crops):
        warnings.append("Portrait frames lose their top and bottom to the model's square crop; film walkthroughs in landscape.")
    if consistency['status'] == 'folded':
        warnings.append(f"{consistency['pairsDisagreeing']} consecutive frame pairs turn differently in the model than in "
                        'their own matches; recapture before trusting the walls.')
    evidence = {'schema': 'brainsnn.reconstruction.v1', 'pipeline': PIPELINE, 'model': MODEL_ID, 'model_file': MODEL_FILE,
                'model_sha256': MODEL_SHA256, 'source_revision': SOURCE_REVISION, 'code_license': 'Apache-2.0',
                **run_record, 'sources': sources,
                'capture': {**{key: value for key, value in capture.items() if key != 'frames'}, 'images': len(paths),
                            'registered_images': len(cameras), 'model_raster': list(crops[0][:2]), 'consistency': consistency},
                'view_counts': counts, 'preview_points': len(cloud), 'coordinate_frame': 'right-handed-y-up',
                'source_coordinate_frame': 'OpenCV; x right, y down, z forward',
                'scale_basis': 'model units; no measurement', 'metric_verified': False, 'physics_ready': False,
                'policy_executed': False, 'confidence_min': CONFIDENCE_MIN, 'confidence_filter_percentile': CONFIDENCE_PERCENTILE,
                'cameras': camera_records(cameras, names), 'warnings': warnings}
    (out / 'reconstruction.json').write_text(json.dumps(evidence, indent=2, allow_nan=False))
    frame_ledger(cameras, rasters, paths, preparations, sources, out, [crop[2] for crop in crops])
    (out / 'manifest.json').write_text(json.dumps({'artifacts': [visual, {'name': 'reconstruction.json', 'kind': 'evidence'},
                                                              {'name': 'camera-frames.json', 'kind': 'evidence'}]}, allow_nan=False))
    return evidence


def run(request):
    if request.get('schema') != 'brainsnn.adapter.v1':
        raise ValueError('Use one walkthrough video, or 3-12 photos in the order they were taken.')
    source, checkpoint, backend = local_installation()
    os.environ.update({'HF_HUB_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1'})
    sys.addaudithook(deny_network)
    sys.path.insert(0, str(source))
    import numpy as np
    import torch
    import lingbot_map
    from lingbot_map.utils.load_fn import load_and_preprocess_images
    if not Path(lingbot_map.__file__).resolve().is_relative_to(source):
        raise RuntimeError('lingbot_map must be imported from the pinned source checkout.')
    if not torch.cuda.is_available():
        raise RuntimeError('This adapter requires a separately qualified CUDA worker. No CPU fallback is claimed.')
    device = torch.device('cuda')
    out = Path(request['output_dir']).resolve(); out.mkdir(parents=True, exist_ok=True)
    prepared = prepare(request.get('inputs', []), out)
    paths, crops = prepared[3], prepared[4]
    started = time.monotonic()
    torch.cuda.reset_peak_memory_stats()
    model = load_model(torch, checkpoint, backend, device)
    tensor = load_and_preprocess_images([str(path) for path in paths], mode='crop', image_size=IMAGE_SIZE, patch_size=PATCH_SIZE)
    if tuple(tensor.shape) != (len(paths), 3, crops[0][1], crops[0][0]):
        raise ValueError('The pinned loader did not return the expected model rasters.')
    predictions = infer(torch, model, tensor, device)
    run_record = {'device': 'cuda', 'attention_backend': backend, 'torch_version': torch.__version__,
                  'peak_cuda_allocated_bytes': torch.cuda.max_memory_allocated(),
                  'elapsed_seconds': round(time.monotonic() - started, 3)}
    rasters = np.rint(tensor.permute(0, 2, 3, 1).numpy().clip(0, 1) * 255).astype(np.uint8)
    return publish(out, prepared, {key: as_numpy(value) for key, value in predictions.items()}, rasters, run_record=run_record)


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--input-manifest'); group.add_argument('--hash-checkpoint', type=Path)
    args = parser.parse_args()
    if args.hash_checkpoint:
        path = args.hash_checkpoint
        print(json.dumps({'file': path.name, 'bytes': path.stat().st_size, 'size_matches': path.stat().st_size == MODEL_BYTES,
                          'sha256': file_hash(path)}))
        return
    path = Path(args.input_manifest)
    if path.stat().st_size > 65536:
        raise ValueError('Input manifest exceeds its size limit.')
    run(json.loads(path.read_text()))


if __name__ == '__main__':
    main()
