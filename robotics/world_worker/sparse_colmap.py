"""CPU multi-view reconstruction, using pinned PyCOLMAP and local FFmpeg.

No downloaded models, network inputs, invented depth, or metric-scale claims.
Accepts 3–12 overlapping photos or one 2–120 second local video. Run via the
World Worker's adapter protocol so timeout, cancellation and disk limits apply.

With --densify-model (the pinned local Depth Anything V2 Small ONNX file), it also
writes dense-preview.ply: per-frame model depth aligned to the frame's own SfM
points and kept only where neighbouring frames agree (see densify.py). The dense
cloud is listed first, so the site opens it; the sparse cloud stays alongside it.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import time
import warnings

try:
    from .geometry import write_point_cloud
    from . import densify
except ImportError:
    from geometry import write_point_cloud
    import densify

PYCOLMAP_VERSION = '4.2.1'
MAX_IMAGES = 60
MAX_PIXELS = 24_000_000
MAX_IMAGE_EDGE = 1280
MAX_POINTS = 50_000
SELECTED_MODEL = 'selected.txt'  # in the sparse folder: which of COLMAP's models the outputs come from


def prepare_photo(source: Path, target: Path):
    from PIL import Image, ImageOps, ImageStat
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(source) as original:
            if original.format not in {'JPEG', 'PNG', 'WEBP'} or original.width * original.height > MAX_PIXELS:
                raise ValueError('Photos must be JPEG, PNG or WebP up to 24 megapixels.')
            original.verify()
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original).convert('RGB')
            if min(image.size) < 256:
                raise ValueError('Use photographs at least 256 pixels on each side.')
            image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))
            stats = ImageStat.Stat(image.convert('L'))
            if stats.mean[0] < 5 or stats.stddev[0] < 2:
                raise ValueError('Capture is too dark or lacks visible texture.')
            # Re-encoding removes location/EXIF metadata. COLMAP estimates intrinsics;
            # no lens, scale or camera calibration is claimed to be measured.
            image.save(target, 'JPEG', quality=92)
            return {'width': image.width, 'height': image.height}


def video_input_options(source: Path):
    with source.open('rb') as stream:
        header = stream.read(32)
    if header[4:8] == b'ftyp':
        return ['-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0']
    if header.startswith(b'\x1aE\xdf\xa3'):
        return ['-f', 'matroska']
    raise ValueError('Video signature is not MP4/MOV or WebM.')


def extract_video(source: Path, images: Path, *, max_images: int = MAX_IMAGES):
    from PIL import Image, ImageChops, ImageStat
    if type(max_images) is not int or not 6 <= max_images <= MAX_IMAGES:
        raise ValueError('Video frame budget must be between 6 and 60.')
    ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        raise RuntimeError('Install FFmpeg and FFprobe before enabling video reconstruction.')
    options = ['-protocol_whitelist', 'file,pipe', *video_input_options(source)]
    probe = subprocess.run([ffprobe, '-v', 'error', *options, '-show_entries',
                            'format=duration:stream=codec_type,width,height', '-of', 'json', str(source)],
                           check=True, capture_output=True, timeout=15)
    if len(probe.stdout) > 65536:
        raise ValueError('Video metadata exceeded its size budget.')
    metadata = json.loads(probe.stdout)
    duration = float(metadata.get('format', {}).get('duration', 0))
    streams = [stream for stream in metadata.get('streams', []) if stream.get('codec_type') == 'video']
    if (not math.isfinite(duration) or not 2 <= duration <= 120 or not streams
            or any(not 1 <= stream.get('width', 0) * stream.get('height', 0) <= MAX_PIXELS for stream in streams)):
        raise ValueError('Use a 2–120 second video, at most 24 megapixels per frame.')
    raw = images.parent / 'video-frames'
    raw.mkdir()
    fps = min(3, max_images / duration)
    subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2',
                    *options, '-i', str(source), '-map', '0:v:0', '-an', '-sn', '-dn',
                    '-vf', f'fps={fps:.8f},scale={MAX_IMAGE_EDGE}:{MAX_IMAGE_EDGE}:force_original_aspect_ratio=decrease',
                    '-frames:v', str(max_images), '-q:v', '3', str(raw / 'frame_%04d.jpg')],
                   check=True, timeout=90)
    accepted, discarded, duplicates = 0, 0, 0
    previous = None
    for frame in sorted(raw.glob('*.jpg')):
        try:
            target = images / f'image_{accepted:04d}.jpg'
            prepare_photo(frame, target)
            with Image.open(target) as photo:
                fingerprint = photo.convert('L').resize((32, 32))
            if previous is not None and ImageStat.Stat(ImageChops.difference(previous, fingerprint)).mean[0] < 1:
                target.unlink()
                duplicates += 1
                continue
            previous = fingerprint
            accepted += 1
        except ValueError:
            discarded += 1
    shutil.rmtree(raw)
    if accepted < 6:
        raise ValueError('Fewer than 6 useful frames. Walk slowly with overlapping views and visible detail.')
    return {'duration_seconds': duration, 'sample_fps': fps, 'discarded_frames': discarded,
            'near_duplicate_frames': duplicates}


def run(request: dict, densify_model: Path | None = None):
    import numpy as np
    import pycolmap
    if pycolmap.__version__ != PYCOLMAP_VERSION:
        raise RuntimeError(f'This adapter is validated with pycolmap=={PYCOLMAP_VERSION}.')
    inputs = request.get('inputs', [])
    photo_set = 3 <= len(inputs) <= 12 and all(item.get('kind') == 'image' for item in inputs)
    video = len(inputs) == 1 and inputs[0].get('kind') == 'video'
    if request.get('schema') != 'brainsnn.adapter.v1' or not (photo_set or video):
        raise ValueError('Use 3–12 overlapping photos or one walkthrough video.')
    out = Path(request['output_dir']).resolve()
    out.mkdir(parents=True, exist_ok=True)
    # Intermediate files remain outside published artifacts and share worker retention.
    workspace = out.parent / 'colmap-work'
    images = workspace / 'images'
    images.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    sources = []
    for item in inputs:
        path = Path(item['path'])
        if not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise ValueError('Adapter inputs must be regular local files.')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for part in iter(lambda: stream.read(1024 ** 2), b''):
                digest.update(part)
        sources.append({'name': item['name'], 'kind': item['kind'], 'sha256': digest.hexdigest()})
    capture = extract_video(Path(inputs[0]['path']), images) if video else {}
    if photo_set:
        for index, item in enumerate(inputs):
            prepare_photo(Path(item['path']), images / f'image_{index:04d}.jpg')
    count = len(list(images.glob('*.jpg')))
    database, sparse = workspace / 'database.db', workspace / 'sparse'
    sparse.mkdir()
    extraction = pycolmap.FeatureExtractionOptions({'num_threads': 2, 'max_image_size': MAX_IMAGE_EDGE,
                                                    'sift': {'max_num_features': 4096}})
    pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.AUTO,
                              reader_options={'camera_model': 'SIMPLE_RADIAL'},
                              extraction_options=extraction, device=pycolmap.Device.cpu)
    matching = pycolmap.FeatureMatchingOptions({'num_threads': 2})
    # Exhaustive matching stays bounded at 60 frames and can close walkthrough loops.
    pycolmap.match_exhaustive(database, matching_options=matching, device=pycolmap.Device.cpu)
    mapping = pycolmap.IncrementalPipelineOptions({'num_threads': 2, 'random_seed': 0,
                                                  'min_model_size': 3, 'max_num_models': 3,
                                                  'max_runtime_seconds': 900})
    models = pycolmap.incremental_mapping(database, images, sparse, options=mapping)
    if not models:
        raise ValueError('Views could not be aligned. Recapture with sideways motion, overlap and stationary detail.')
    index, model = max(models.items(), key=lambda item: (item[1].num_reg_images(), item[1].num_points3D()))
    # The models are written to sparse/<index>; record which one the outputs come from, for anything that reads the frames later.
    (sparse / SELECTED_MODEL).write_text(str(index))
    registered = model.num_reg_images()
    if registered < 3 or model.num_points3D() < 30:
        raise ValueError('Insufficient reconstructed geometry: at least 3 camera positions and 30 points are required.')
    model.extract_colors_for_all_images(images, num_threads=2)
    points = sorted(model.points3D.items())
    stride = max(1, math.ceil(len(points) / MAX_POINTS))
    sample = [point for _, point in points[::stride]]
    visual = write_point_cloud(out / 'sparse-preview.ply', np.array([point.xyz for point in sample]),
                               np.array([point.color for point in sample]), coordinate_frame='colmap')
    artifacts, dense = [visual], None
    if densify_model:
        dense_started = time.monotonic()
        frames, frame_stats = densify.frames_from_model(model, images, densify.load_session(densify_model), log=lambda message: None)
        if not frames:
            raise ValueError('No frame could be aligned for dense points; the sparse reconstruction alone is reliable here.')
        dense_points, dense_colours, fuse_stats = densify.fuse(frames)
        if fuse_stats['points'] < 30:
            raise ValueError('Neighbouring frames confirmed too few dense points; recapture with more overlap.')
        artifacts = [write_point_cloud(out / 'dense-preview.ply', dense_points, np.clip(dense_colours, 0, 255).astype(np.uint8),
                                       coordinate_frame='colmap'), visual]
        dense = {'method': 'monocular depth per frame, aligned to its SfM points, kept where neighbouring frames agree',
                 'model': {k: densify.MODEL[k] for k in ('repo', 'revision', 'file', 'sha256', 'license')},
                 **frame_stats, **fuse_stats, 'tolerance': 0.02, 'min_agree': 2, 'neighbours': 4,
                 'elapsed_seconds': round(time.monotonic() - dense_started, 3)}
    cameras = []
    for image_id in sorted(model.reg_image_ids()):
        image = model.image(image_id)
        camera = model.camera(image.camera_id)
        cameras.append({'image': image.name, 'camera_id': image.camera_id,
                        'world_to_camera': image.cam_from_world().matrix().tolist(),
                        'camera_center': image.projection_center().tolist(),
                        'model': camera.model_name, 'width': camera.width, 'height': camera.height,
                        'parameters': camera.params.tolist()})
    evidence = {'schema': 'brainsnn.reconstruction.v1', 'pipeline': 'colmap-sparse',
                'pycolmap_version': pycolmap.__version__, 'device': 'cpu', 'sources': sources,
                'capture': {**capture, 'images': count, 'registered_images': registered,
                            'registration_fraction': registered / count, 'models_found': len(models), 'model_index': index},
                'reconstructed_points': model.num_points3D(), 'preview_points': len(sample),
                'mean_reprojection_error_pixels': model.compute_mean_reprojection_error(),
                'elapsed_seconds': round(time.monotonic() - started, 3),
                'coordinate_frame': 'colmap', 'units': 'arbitrary', 'metric_verified': False,
                'physics_ready': False, 'policy_executed': False, 'model_weights_used': dense is not None,
                'camera_intrinsics': 'estimated from resized images; not measured calibration',
                'review_required': ['Verify scale against a measured distance', 'Align floor and up axis',
                                    'Inspect missing surfaces and author collision geometry'],
                'warnings': ['Sparse points do not define a solid surface or free space.',
                             'Glass, blank walls, reflections and moving objects may be missing.'] +
                            (['Some submitted views did not align; reconstruction is incomplete.'] if registered < count else []) +
                            (['Dense points come from a depth model checked across frames; they are less accurate than the sparse points.']
                             if dense else []),
                'cameras': cameras}
    if dense: evidence['dense'] = dense
    (out / 'reconstruction.json').write_text(json.dumps(evidence, indent=2, allow_nan=False))
    (out / 'manifest.json').write_text(json.dumps({'artifacts': [*artifacts, {'name': 'reconstruction.json', 'kind': 'evidence'}]}, allow_nan=False))
    return evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-manifest', required=True)
    parser.add_argument('--densify-model', type=Path, help='pinned Depth Anything V2 Small ONNX file; adds dense-preview.ply')
    args = parser.parse_args()
    request = Path(args.input_manifest)
    if request.stat().st_size > 65536:
        raise ValueError('Input manifest is too large.')
    run(json.loads(request.read_text()), densify_model=args.densify_model)


if __name__ == '__main__':
    main()
