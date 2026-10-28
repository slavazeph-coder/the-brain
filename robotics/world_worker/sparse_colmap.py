"""CPU multi-view reconstruction, using pinned PyCOLMAP and local FFmpeg.

No downloaded models, network inputs, invented depth, or metric-scale claims.
Accepts 3–12 overlapping photos or one local video of 2 seconds to 5 minutes. Run via the
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
import os
from pathlib import Path
import shutil
import subprocess
import time
import warnings

try:
    from .geometry import write_point_cloud
    from . import densify, native_capture
except ImportError:
    from geometry import write_point_cloud
    import densify
    import native_capture

PYCOLMAP_VERSION = '4.2.1'
MAX_IMAGES = 60
# A video gives 60 frames up to a minute long (at most 3 a second), then one a second up to five minutes: a person
# walking films about half a metre between frames, so a longer walk needs more frames, not sparser ones.
MAX_VIDEO_SECONDS = 300
MAX_VIDEO_FRAMES = 300
# Matching every pair is 1,770 pairs at 60 frames but 44,850 at 300. Past 60 frames, each frame is matched with its
# NEIGHBOURS next frames, and up to 60 keyframes spread over the video with every other keyframe, which closes loops
# where the walk comes back to a wall it already filmed.
EXHAUSTIVE_FRAMES = 60
NEIGHBOURS = 15
THREADS = int(os.environ.get('WORLD_CPU_THREADS', '2')) if os.environ.get('WORLD_CPU_THREADS', '2').isdigit() else 2
THREADS = max(1, min(64, THREADS))  # a shared worker keeps 2; a worker on its own machine can give it all its cores
MAX_PIXELS = 24_000_000
MAX_IMAGE_EDGE = 1280
MAX_POINTS = 50_000
SELECTED_MODEL = 'selected.txt'  # in the sparse folder: which of COLMAP's models the outputs come from
# Mapping can split one walkthrough into several models depending on its seed. From the same matches, a 62 s room video
# joined 33 of 60 frames with seed 0 and 57 with seeds 1, 2 and 3, about 20 s each. Another seed is tried only while
# fewer than JOINED_FRACTION of the frames are in one model, within the same total mapping time as before.
MAPPING_SEEDS = (0, 1, 2)
JOINED_FRACTION = 0.9
MAPPING_SECONDS = 900
# A walk past repeated surfaces can fold: opposite walls are matched to each other and the model is built round the
# false matches, yet every frame registers at a low reprojection error. On synthetic walks of the benchmark room, five
# laps registered all 300 frames at 0.39 px and the path was 1.1 m RMS off. Frames filmed one after the other are the
# pairs whose matches can be trusted, so the model's turn between them is checked against the turn their own matches
# give. Over 18 mappings of synthetic walks the four correct models disagreed by at most 5.1 degrees and the 13 folded
# ones (0.6 to 1.8 m RMS off) by 59 degrees or more. Mapping the same matches with another seed unfolded one of eight,
# so a fold is reported for a recapture, not retried. It catches folds, not every error: a 21-frame partial model 15 cm off passed.
# A fold or a misplaced frame turns more than one consecutive pair, or one pair by far more, or the pairs that bridge it
# too. One pair's own two-view pose can be wrong alone: on the Mip-NeRF 360 room walk, frames 38 and 39 (76 matches) read
# 6 degrees on two mappings and 24 on a third whose cameras matched theirs to 0.4 degrees, and a 454-match pair read 13.
# So a lone pair up to FOLD_LONE_DEGREES that no bridging pair confirms is reported unconfirmed, not folded.
FOLD_DEGREES = 15
FOLD_LONE_DEGREES = 45
FOLD_MIN_MATCHES = 30
FOLD_LISTED = 20


def map_frames(database: Path, images: Path, workspace: Path, count: int, *, calibrated=False):
    """Incremental mapping into workspace/sparse, retrying other seeds while too few frames joined one model."""
    import pycolmap
    best, attempts, deadline = None, [], time.monotonic() + MAPPING_SECONDS
    for seed in MAPPING_SEEDS:
        remaining = deadline - time.monotonic()
        if best and remaining < 60: break
        target = workspace / f'sparse-seed-{seed}'
        target.mkdir()
        pycolmap.set_random_seed(seed)
        mapping = pycolmap.IncrementalPipelineOptions({'num_threads': THREADS, 'random_seed': seed,
                                                      'min_model_size': 3, 'max_num_models': 3,
                                                      'max_runtime_seconds': max(60, int(remaining))})
        if calibrated:
            mapping.ba_refine_focal_length = False
            mapping.ba_refine_principal_point = False
            mapping.ba_refine_extra_params = False
            mapping.mapper.abs_pose_refine_focal_length = False
            mapping.mapper.abs_pose_refine_extra_params = False
        models = pycolmap.incremental_mapping(database, images, target, options=mapping)
        if not models:
            attempts.append({'seed': seed, 'registered_images': 0, 'models_found': 0}); continue
        index, model = max(models.items(), key=lambda item: (item[1].num_reg_images(), item[1].num_points3D()))
        attempts.append({'seed': seed, 'registered_images': model.num_reg_images(), 'models_found': len(models)})
        if not best or (model.num_reg_images(), model.num_points3D()) > (best[3].num_reg_images(), best[3].num_points3D()):
            best = (target, models, index, model)
        if best[3].num_reg_images() >= JOINED_FRACTION * count: break
    if not best:
        raise ValueError('Views could not be aligned. Recapture with sideways motion, overlap and stationary detail.')
    target, models, index, model = best
    # The models are written to sparse/<index>; record which one the outputs come from, for anything that reads the frames later.
    target.rename(workspace / 'sparse')
    (workspace / 'sparse' / SELECTED_MODEL).write_text(str(index))
    for attempt in workspace.glob('sparse-seed-*'): shutil.rmtree(attempt)
    return models, index, model, attempts


def model_against_matches(database, model, a, b):
    """How far the model's turn from registered image a to b is from the turn COLMAP's own two-view pose gives from their
    verified matches (essential, fundamental or homography, by the pair's geometry), or None when they were not matched
    well enough to tell."""
    import numpy as np
    import pycolmap
    if not database.exists_two_view_geometry(a.image_id, b.image_id):
        return None
    geometry = database.read_two_view_geometry(a.image_id, b.image_id)
    if len(geometry.inlier_matches) < FOLD_MIN_MATCHES or not pycolmap.estimate_two_view_geometry_pose(
            model.camera(a.camera_id), database.read_keypoints(a.image_id)[:, :2].astype(float),
            model.camera(b.camera_id), database.read_keypoints(b.image_id)[:, :2].astype(float), geometry):
        return None
    matched = geometry.cam2_from_cam1.rotation.matrix()
    modelled = (b.cam_from_world().rotation * a.cam_from_world().rotation.inverse()).matrix()
    cosine = (np.trace(matched.T @ modelled) - 1) / 2
    return {'from': a.name, 'to': b.name, 'matches': len(geometry.inlier_matches),
            'disagreementDegrees': round(math.degrees(math.acos(max(-1.0, min(1.0, cosine)))), 2)}


def consecutive_turns(database, model, names):
    """For each two registered frames filmed one after the other, model_against_matches. A pair over FOLD_DEGREES also
    gets its bridges: the same check from the frame before it to its second frame and from its first frame to the frame
    after it, where those were matched. database is an open pycolmap.Database; names are all frames in filming order.
    Returns the checked pairs and how many consecutive pairs could not be checked."""
    by_name = {model.image(image_id).name: model.image(image_id) for image_id in model.reg_image_ids()}
    order = [by_name[name] for name in names if name in by_name]
    turns, skipped = [], 0
    for index, (a, b) in enumerate(zip(order, order[1:])):
        turn = model_against_matches(database, model, a, b)
        if turn is None:
            skipped += 1; continue
        if turn['disagreementDegrees'] > FOLD_DEGREES:
            ends = [(index - 1, index + 1), (index, index + 2)]
            bridges = (model_against_matches(database, model, order[x], order[y]) for x, y in ends if x >= 0 and y < len(order))
            turn['bridges'] = [bridge for bridge in bridges if bridge]
        turns.append(turn)
    return turns, skipped


def fold_check(turns, skipped):
    """The consistency record: a model that turns a camera differently from its own consecutive frames is folded, unless
    the only disagreement is one pair up to FOLD_LONE_DEGREES that no bridging pair confirms: that one is unconfirmed."""
    folds = [turn for turn in turns if turn['disagreementDegrees'] > FOLD_DEGREES]
    lone = (len(folds) == 1 and folds[0]['disagreementDegrees'] <= FOLD_LONE_DEGREES
            and not any(bridge['disagreementDegrees'] > FOLD_DEGREES for bridge in folds[0].get('bridges', [])))
    return {'method': 'model turn against two-view turn, consecutive registered frames', 'thresholdDegrees': FOLD_DEGREES,
            'status': 'unconfirmed' if lone else 'folded' if folds else 'consistent' if turns else 'not-checked',
            'pairsChecked': len(turns), 'pairsSkipped': skipped, 'pairsDisagreeing': len(folds),
            'worstDisagreementDegrees': max((turn['disagreementDegrees'] for turn in turns), default=None),
            'disagreeing': sorted(folds, key=lambda turn: -turn['disagreementDegrees'])[:FOLD_LISTED]}


def file_sha256(path: Path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024 ** 2), b''):
            digest.update(part)
    return digest.hexdigest()


def photo_pixel_transform(width, height, orientation, prepared_width, prepared_height):
    """Stored source pixel centres -> EXIF-upright, resized pixel centres.

    Pixel (0,0) is the first pixel centre, not its outer corner. Pillow's resize
    maps centres by (x+.5)*scale-.5, after the discrete EXIF transpose.
    """
    if any(type(value) is not int or value < 1 for value in (width, height, prepared_width, prepared_height)):
        raise ValueError('Source and prepared raster dimensions must be positive integers.')
    matrices = {
        1: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        2: [[-1, 0, width - 1], [0, 1, 0], [0, 0, 1]],
        3: [[-1, 0, width - 1], [0, -1, height - 1], [0, 0, 1]],
        4: [[1, 0, 0], [0, -1, height - 1], [0, 0, 1]],
        5: [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
        6: [[0, -1, height - 1], [1, 0, 0], [0, 0, 1]],
        7: [[0, -1, height - 1], [-1, 0, width - 1], [0, 0, 1]],
        8: [[0, 1, 0], [-1, 0, width - 1], [0, 0, 1]],
    }
    if type(orientation) is not int or orientation not in matrices:
        raise ValueError('EXIF orientation must be an integer from 1 to 8.')
    ow, oh = (height, width) if orientation >= 5 else (width, height)
    sx, sy = prepared_width / ow, prepared_height / oh
    exif = matrices[orientation]
    return [[sx * exif[0][0], sx * exif[0][1], sx * exif[0][2] + (sx - 1) / 2],
            [sy * exif[1][0], sy * exif[1][1], sy * exif[1][2] + (sy - 1) / 2], [0, 0, 1]]


def prepare_photo(source: Path, target: Path, *, with_evidence=False):
    from PIL import Image, ImageOps, ImageStat
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(source) as original:
            if original.format not in {'JPEG', 'PNG', 'WEBP'} or original.width * original.height > MAX_PIXELS:
                raise ValueError('Photos must be JPEG, PNG or WebP up to 24 megapixels.')
            original.verify()
        with Image.open(source) as original:
            original_width, original_height = original.size
            orientation = original.getexif().get(274, 1)
            if type(orientation) is not int or not 1 <= orientation <= 8:
                raise ValueError('Unsupported EXIF orientation; use an orientation from 1 to 8.')
            image = ImageOps.exif_transpose(original).convert('RGB')
            oriented_width, oriented_height = image.size
            if min(image.size) < 256:
                raise ValueError('Use photographs at least 256 pixels on each side.')
            image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))
            stats = ImageStat.Stat(image.convert('L'))
            if stats.mean[0] < 5 or stats.stddev[0] < 2:
                raise ValueError('Capture is too dark or lacks visible texture.')
            # Re-encoding removes location/EXIF metadata. COLMAP estimates intrinsics;
            # no lens, scale or camera calibration is claimed to be measured.
            image.save(target, 'JPEG', quality=92)
            result = {'width': image.width, 'height': image.height}
            if with_evidence:
                result.update(sourceSha256=file_sha256(source), sourceWidth=original_width, sourceHeight=original_height,
                              exifOrientation=orientation, orientedWidth=oriented_width, orientedHeight=oriented_height,
                              preparedPath=target.name, preparedSha256=file_sha256(target),
                              sourceToPreparedPixelCenter=photo_pixel_transform(original_width, original_height, orientation,
                                                                               image.width, image.height))
            return result


def video_input_options(source: Path):
    with source.open('rb') as stream:
        header = stream.read(32)
    if header[4:8] == b'ftyp':
        return ['-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0']
    if header.startswith(b'\x1aE\xdf\xa3'):
        return ['-f', 'matroska']
    raise ValueError('Video signature is not MP4/MOV or WebM.')


def frame_budget(duration: float) -> int:
    """Frames to sample from a video: 60 up to a minute, then one a second."""
    return max(MAX_IMAGES, min(MAX_VIDEO_FRAMES, round(duration)))


def image_pairs(count: int):
    """The pairs to match among `count` frames in filming order: all of them up to EXHAUSTIVE_FRAMES, else each frame
    with its NEIGHBOURS next frames plus every pair of up to EXHAUSTIVE_FRAMES evenly spread keyframes."""
    if count <= EXHAUSTIVE_FRAMES:
        return [(i, j) for i in range(count) for j in range(i + 1, count)]
    keys = sorted({round(k * (count - 1) / (EXHAUSTIVE_FRAMES - 1)) for k in range(EXHAUSTIVE_FRAMES)})
    pairs = {(i, j) for i in range(count) for j in range(i + 1, min(count, i + NEIGHBOURS + 1))}
    pairs |= {(a, b) for n, a in enumerate(keys) for b in keys[n + 1:]}
    return sorted(pairs)


def extract_video(source: Path, images: Path, *, max_images: int | None = None):
    from PIL import Image, ImageChops, ImageStat
    if max_images is not None and (type(max_images) is not int or not 6 <= max_images <= MAX_VIDEO_FRAMES):
        raise ValueError(f'Video frame budget must be between 6 and {MAX_VIDEO_FRAMES}.')
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
    if (not math.isfinite(duration) or not 2 <= duration <= MAX_VIDEO_SECONDS or not streams
            or any(not 1 <= stream.get('width', 0) * stream.get('height', 0) <= MAX_PIXELS for stream in streams)):
        raise ValueError('Use a video of 2 seconds to 5 minutes, at most 24 megapixels per frame.')
    raw = images.parent / 'video-frames'
    raw.mkdir()
    budget = frame_budget(duration) if max_images is None else min(max_images, frame_budget(duration))
    fps = min(3, budget / duration)
    # Every frame is decoded to sample a few: about 3 s per minute of 1080p on 2 threads, 4 times that for 4K.
    subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', str(THREADS),
                    *options, '-i', str(source), '-map', '0:v:0', '-an', '-sn', '-dn',
                    '-vf', f'fps={fps:.8f},scale={MAX_IMAGE_EDGE}:{MAX_IMAGE_EDGE}:force_original_aspect_ratio=decrease',
                    '-frames:v', str(budget), '-q:v', '3', str(raw / 'frame_%04d.jpg')],
                   check=True, timeout=max(90, 3 * duration))
    accepted, discarded, duplicates = 0, 0, 0
    associations = []
    source_sha256 = file_sha256(source)
    previous = None
    for sampled_index, frame in enumerate(sorted(raw.glob('*.jpg'))):
        try:
            target = images / f'image_{accepted:04d}.jpg'
            preparation = prepare_photo(frame, target, with_evidence=True)
            with Image.open(target) as photo:
                fingerprint = photo.convert('L').resize((32, 32))
            if previous is not None and ImageStat.Stat(ImageChops.difference(previous, fingerprint)).mean[0] < 1:
                target.unlink()
                duplicates += 1
                continue
            previous = fingerprint
            associations.append({'image': target.name, 'sourceIndex': 0, 'sourceSha256': source_sha256,
                                 'sourceWidth': streams[0]['width'], 'sourceHeight': streams[0]['height'],
                                 'exifOrientation': None, 'sourceToFramePixelCenter': None, 'timestamp': None,
                                 'resampledOutputIndex': sampled_index, 'extractedFrame': frame.name,
                                 'preparation': preparation})
            accepted += 1
        except ValueError:
            discarded += 1
    shutil.rmtree(raw)
    if accepted < 6:
        raise ValueError('Fewer than 6 useful frames. Walk slowly with overlapping views and visible detail.')
    return {'duration_seconds': duration, 'sample_fps': fps, 'frame_budget': budget, 'discarded_frames': discarded,
            'near_duplicate_frames': duplicates, 'frames': associations,
            'timestamp_evidence': 'Original PTS/time base unavailable: FFmpeg fps resampling and duplicate filtering are not an original-frame timestamp ledger. resampledOutputIndex is not a source PTS.',
            'pixel_geometry_evidence': 'Video source-to-prepared transform unavailable: FFmpeg autorotation and pre-extraction scaling were not recorded. The extracted-raster-to-prepared transform and prepared image hash are retained.'}


def camera_frame_records(model, images, associations, sources, job_root):
    """Actual selected-model cameras, bound to their precise prepared rasters.

    Source-to-frame transforms describe preparation only, not calibration. The
    full fitted lens model is retained; radial distortion is not discarded.
    """
    try:
        from . import camera_frames
    except ImportError:
        import camera_frames
    by_name = {entry['image']: entry for entry in associations}
    if len(by_name) != len(associations):
        raise ValueError('Prepared frame associations must have unique names.')
    frames = []
    for image_id in sorted(model.reg_image_ids()):
        image = model.image(image_id); camera = model.camera(image.camera_id)
        entry = by_name.get(image.name)
        if entry is None or Path(image.name).name != image.name:
            raise ValueError('A registered camera has no exact prepared-source frame association.')
        preparation = entry['preparation']; path = Path(images) / image.name
        if file_sha256(path) != preparation['preparedSha256']:
            raise ValueError('Prepared camera raster changed after capture preparation.')
        if (camera.width, camera.height) != (preparation['width'], preparation['height']):
            raise ValueError('COLMAP camera dimensions do not match the actual prepared raster.')
        source_index = entry['sourceIndex']
        if type(source_index) is not int or not 0 <= source_index < len(sources) \
                or entry['sourceSha256'] != sources[source_index]['sha256']:
            raise ValueError('Prepared frame source hash does not match the accepted capture source.')
        # COLMAP's top-left pixel centre is (.5,.5), unlike Pillow raster
        # indices. Keep fitted parameters native and let the shared projector
        # convert to integer-centre raster coordinates explicitly.
        camera_model = {'model': camera.model_name, 'params': camera.params.tolist(), 'pixelConvention': 'colmap-half-pixel'}
        if camera_model['model'] not in ('PINHOLE', 'SIMPLE_RADIAL'):
            raise ValueError('This frame evidence version requires a supported actual COLMAP camera model.')
        pose = image.cam_from_world().matrix().tolist()
        image_record = camera_frames.file_record(job_root, path, width=camera.width, height=camera.height)
        frame = {'frame_id': camera_frames.frame_id(sources[source_index]['sha256'], image_record['sha256'], camera_model, pose),
                 'image': image_record,
                 'origin': {key: entry[key] for key in ('sourceIndex', 'sourceWidth', 'sourceHeight', 'exifOrientation', 'sourceToFramePixelCenter')},
                 'timestamp': entry['timestamp'], 'camera': camera_model, 'cam_from_world': pose}
        frames.append(frame)
    return frames


def run(request: dict, densify_model: Path | None = None):
    import numpy as np
    import pycolmap
    if pycolmap.__version__ != PYCOLMAP_VERSION:
        raise RuntimeError(f'This adapter is validated with pycolmap=={PYCOLMAP_VERSION}.')
    inputs = request.get('inputs', [])
    native = None
    if any(item.get('kind') == 'capture' for item in inputs):
        inputs, native = native_capture.inputs_evidence(inputs)
    photo_set = 3 <= len(inputs) <= 12 and all(item.get('kind') == 'image' for item in inputs)
    video = len(inputs) == 1 and inputs[0].get('kind') == 'video'
    if request.get('schema') != 'brainsnn.adapter.v1' or not (photo_set or video):
        raise ValueError('Use 3–12 overlapping photos, one walkthrough video, or native capture JSON with 3–11 photos.')
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
        sources.append({'name': item['name'], 'kind': item['kind'], 'sha256': file_sha256(path)})
    capture = extract_video(Path(inputs[0]['path']), images) if video else {}
    associations = list(capture.get('frames', []))
    if photo_set:
        for index, item in enumerate(inputs):
            target = images / f'image_{index:04d}.jpg'
            preparation = prepare_photo(Path(item['path']), target, with_evidence=True)
            associations.append({'image': target.name, 'sourceIndex': index, 'sourceSha256': preparation['sourceSha256'],
                                 'sourceWidth': preparation['sourceWidth'], 'sourceHeight': preparation['sourceHeight'],
                                 'exifOrientation': preparation['exifOrientation'],
                                 'sourceToFramePixelCenter': preparation['sourceToPreparedPixelCenter'],
                                 'timestamp': None, 'preparation': preparation})
    count = len(list(images.glob('*.jpg')))
    database = workspace / 'database.db'
    extraction = pycolmap.FeatureExtractionOptions({'num_threads': THREADS, 'max_image_size': MAX_IMAGE_EDGE,
                                                    'sift': {'max_num_features': 4096}})
    pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.PER_IMAGE if native else pycolmap.CameraMode.AUTO,
                              reader_options={'camera_model': 'PINHOLE' if native else 'SIMPLE_RADIAL'},
                              extraction_options=extraction, device=pycolmap.Device.cpu)
    if native:
        native_capture.apply_calibration(database, associations, native)
    matching = pycolmap.FeatureMatchingOptions({'num_threads': THREADS})
    names = sorted(path.name for path in images.glob('*.jpg'))  # filming order
    pairs = image_pairs(count)
    if count <= EXHAUSTIVE_FRAMES:
        pycolmap.match_exhaustive(database, matching_options=matching, device=pycolmap.Device.cpu)
    else:
        listing = workspace / 'pairs.txt'
        listing.write_text(''.join(f'{names[i]} {names[j]}\n' for i, j in pairs))
        pycolmap.match_image_pairs(database, matching_options=matching, pairing_options=pycolmap.ImportedPairingOptions({'match_list_path': str(listing)}),
                                   device=pycolmap.Device.cpu)
    capture['matching'] = {'method': 'exhaustive' if count <= EXHAUSTIVE_FRAMES else f'{NEIGHBOURS} neighbours and keyframes', 'pairs': len(pairs)}
    if native:
        models, index, model, attempts = map_frames(database, images, workspace, count, calibrated=True)
    else:
        models, index, model, attempts = map_frames(database, images, workspace, count)
    registered = model.num_reg_images()
    if registered < 3 or model.num_points3D() < 30:
        raise ValueError('Insufficient reconstructed geometry: at least 3 camera positions and 30 points are required.')
    # Photos have no filming order, so only a video's consecutive frames are checked.
    if video or native:
        opened = pycolmap.Database.open(str(database))
        try:
            consistency = fold_check(*consecutive_turns(opened, model, names))
        finally:
            opened.close()
    else:
        consistency = {'status': 'not-checked', 'reason': 'Photos have no filming order; consecutive frames are checked for videos only.'}
    capture['consistency'] = consistency
    folded = consistency['status'] == 'folded'
    if native:
        if folded:
            raise ValueError('Native reconstruction contradicts its own consecutive image matches; recapture before pose alignment.')
        native['alignment'] = native_capture.align_model(model, associations, native)
        native['reconstruction_executed'] = True
        native['calibration_consumed'] = 'Resized per-frame PINHOLE intrinsics fixed during image matching and bundle adjustment.'
        native['limitations'] = ['Native pose estimates are used for checked post-solve alignment, not as optimizer constraints.',
                                 'Independent physical dimensions remain required; no native capture app is included.']
        model.write(workspace / 'sparse' / str(index))
    model.extract_colors_for_all_images(images, num_threads=THREADS)
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
    frame_records = camera_frame_records(model, images, associations, sources, out.parent)
    by_image = {Path(frame['image']['name']).name: frame for frame in frame_records}
    cameras = []
    for image_id in sorted(model.reg_image_ids()):
        image = model.image(image_id)
        camera = model.camera(image.camera_id)
        cameras.append({'image': image.name, 'camera_id': image.camera_id, 'frame_id': by_image[image.name]['frame_id'],
                        'world_to_camera': image.cam_from_world().matrix().tolist(),
                        'camera_center': image.projection_center().tolist(),
                        'model': camera.model_name, 'width': camera.width, 'height': camera.height,
                        'parameters': camera.params.tolist()})
    evidence = {'schema': 'brainsnn.reconstruction.v1', 'pipeline': 'colmap-sparse',
                'pycolmap_version': pycolmap.__version__, 'device': 'cpu', 'sources': sources,
                'capture': {**capture, 'images': count, 'registered_images': registered,
                            'registration_fraction': registered / count, 'models_found': len(models), 'model_index': index,
                            'mapping_attempts': attempts},
                'reconstructed_points': model.num_points3D(), 'preview_points': len(sample),
                'mean_reprojection_error_pixels': model.compute_mean_reprojection_error(),
                'elapsed_seconds': round(time.monotonic() - started, 3),
                'coordinate_frame': 'colmap', 'units': 'arbitrary', 'metric_verified': False,
                'physics_ready': False, 'policy_executed': False, 'model_weights_used': dense is not None,
                'camera_intrinsics': ('source-bound native calibration, transformed to resized COLMAP half-pixel coordinates; held fixed during solve'
                                      if native else 'estimated from resized images; not measured calibration'),
                'review_required': (['Recapture: the model contradicts its own consecutive frames'] if folded else []) +
                                   ['Verify scale against a measured distance', 'Align floor and up axis',
                                    'Inspect missing surfaces and author collision geometry'],
                'warnings': ([f"The model contradicts its own frames: between {consistency['pairsDisagreeing']} pairs of frames filmed "
                              f"one after the other it turns the camera by up to {consistency['worstDisagreementDegrees']:.0f} degrees "
                              'more or less than those frames show. This is how a walk past repeated surfaces folds the room onto itself. '
                              "Do not use this model's layout or dimensions; recapture the room."] if folded else []) +
                            ([f"One pair of frames filmed one after the other ({consistency['disagreeing'][0]['from']} to "
                              f"{consistency['disagreeing'][0]['to']}) turns {consistency['disagreeing'][0]['disagreementDegrees']:.0f} "
                              f"degrees differently in the model than in their own {consistency['disagreeing'][0]['matches']} matches, "
                              'and no other pair confirms it. A lone pair like this is usually a weak match, not a folded room: '
                              'check the model around those frames.'] if consistency['status'] == 'unconfirmed' else []) +
                            ['Sparse points do not define a solid surface or free space.',
                             'Glass, blank walls, reflections and moving objects may be missing.'] +
                            (['Some submitted views did not align; reconstruction is incomplete.'] if registered < count else []) +
                            (['This video is longer than a minute. Videos this long have not yet been checked against a measured room: '
                              'confirm the scale and some withheld tape measurements before relying on dimensions.']
                             if capture.get('duration_seconds', 0) > 60 else []) +
                            (['Dense points come from a depth model checked across frames; they are less accurate than the sparse points.']
                             if dense else []),
                'cameras': cameras}
    try:
        from . import camera_frames
    except ImportError:
        import camera_frames
    clouds = [camera_frames.file_record(out.parent, out / artifact['name'], coordinate_frame='colmap') for artifact in artifacts]
    evidence['point_clouds'] = clouds
    evidence['camera_frame_evidence'] = {'schema': 'brainsnn.camera-frames.v1', 'artifact': 'camera-frames.json',
                                         'registered_frames': len(frame_records),
                                         'prepared_images': 'Private colmap-work/images files share worker job retention; source EXIF/location metadata is stripped from prepared JPEGs.',
                                         'pixel_centres': 'Source integer pixel centres; EXIF transpose followed by (x+.5)*scale-.5 resize.',
                                         'camera_pixels': 'Native COLMAP parameters use top-left centre (.5,.5); the shared raster projector subtracts .5. Calibration parameters are not silently shifted.',
                                         'timestamps': 'Original video PTS unavailable for the FFmpeg resampled path; photos have no video timestamp.'}
    if dense: evidence['dense'] = dense
    native_artifacts = []
    if native:
        (out / 'native-capture.json').write_text(json.dumps(native, indent=2, allow_nan=False))
        evidence['native_capture'] = {'artifact': 'native-capture.json', 'sha256': file_sha256(out / 'native-capture.json'),
                                      'bundle_sha256': native['bundle_sha256'], 'alignment': native['alignment']}
        evidence['camera_frame_evidence']['timestamps'] = 'Original native timestamps are bound to image hashes in native-capture.json; image sources have no video PTS.'
        native_artifacts = [{'name': 'native-capture.json', 'kind': 'evidence'}]
    (out / 'reconstruction.json').write_text(json.dumps(evidence, indent=2, allow_nan=False))
    ledger = {'schema': 'brainsnn.camera-frames.v1', 'sources': sources,
              'reconstruction': camera_frames.file_record(out.parent, out / 'reconstruction.json'),
              'clouds': clouds, 'frames': frame_records, 'metric_verified': False}
    camera_frames.write(out.parent, ledger, output_path=out / 'camera-frames.json')
    (out / 'manifest.json').write_text(json.dumps({'artifacts': [*artifacts, {'name': 'reconstruction.json', 'kind': 'evidence'},
                                                               {'name': 'camera-frames.json', 'kind': 'evidence'}, *native_artifacts]}, allow_nan=False))
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
