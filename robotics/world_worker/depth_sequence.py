"""Bounded photo/video camera-depth review using the existing pinned MoGe-2 baseline.

Frames remain independent camera observations. This module does not register a scene,
smooth temporal depth, infer hidden surfaces, or create BIM/collision geometry. No
weights are downloaded at runtime. The shared writer also accepts an explicitly
provisioned backend through Python, never through uploaded request options.
"""
from __future__ import annotations

import argparse
import base64
from fractions import Fraction
import io
import json
import math
import os
from pathlib import Path
import re
import selectors
import shutil
import subprocess
import time

try:
    from . import metric_scale, photo_metric, sparse_colmap
    from .geometry import write_point_cloud
    from .observations import bounded_probe
except ImportError:
    import metric_scale
    import photo_metric
    import sparse_colmap
    from geometry import write_point_cloud
    from observations import bounded_probe

SCHEMA = 'brainsnn.depth-sequence.v1'
MAX_FRAMES = 32
DEFAULT_FRAMES = 16
MAX_REVIEW_EDGE = 160
MAX_VIDEO_SECONDS = 60
MAX_VIDEO_PIXELS = 24_000_000
MAX_INPUT_EDGE = 1280
MAX_ASPECT = 4
MAX_JSON_BYTES = 16 * 1024 ** 2
MAX_JPEG_BYTES = 128 * 1024
DEFAULT_MAX_DEPTH_METRES = 100.0
MAX_DECODE_LOG_BYTES = 256 * 1024
MAX_TIMING_BYTES = 64 * 1024
MAX_FRAME_BYTES = 8 * 1024 ** 2
MAX_DECODE_SECONDS = 180
VIDEO_CODECS = {'h264', 'hevc', 'mpeg4', 'vp8', 'vp9', 'av1'}
ENGINE = 'metric-depth-sequence'


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def checked_budget(max_frames=DEFAULT_FRAMES, max_depth_metres=DEFAULT_MAX_DEPTH_METRES):
    if type(max_frames) is not int or not 1 <= max_frames <= MAX_FRAMES:
        raise ValueError('Depth review accepts a frame budget from 1 to 32.')
    if not finite(max_depth_metres) or not 0 < max_depth_metres <= 1000:
        raise ValueError('Maximum review depth must be positive and at most 1,000 metres.')
    return max_frames, float(max_depth_metres)


def source_input(request, *, hash_source=True):
    inputs = request.get('inputs', [])
    if request.get('schema') != 'brainsnn.adapter.v1' or not isinstance(inputs, list) or len(inputs) != 1 or \
            not isinstance(inputs[0], dict) or inputs[0].get('kind') not in ('image', 'video'):
        raise ValueError('Depth review needs exactly one image or video.')
    item = inputs[0]
    path = Path(item.get('path', ''))
    limit = (200 * 1024 ** 2) if item['kind'] == 'image' else (2 * 1024 ** 3)
    if not path.is_absolute() or path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError('The depth source must be a bounded, regular local upload.')
    name = str(item.get('name') or path.name).replace('\x00', '')[:160]
    return path, {'sha256': sparse_colmap.file_sha256(path) if hash_source else None, 'kind': item['kind'], 'name': name, 'bytes': path.stat().st_size}


def _raster_bounds(width, height, *, minimum=128):
    if type(width) is not int or type(height) is not int or min(width, height) < minimum or \
            width * height > MAX_VIDEO_PIXELS or max(width, height) / min(width, height) > MAX_ASPECT:
        raise ValueError(f'Use a raster with sides of at least {minimum} pixels, at most 24 megapixels and aspect ratio at most 4:1.')


def probe_video(path):
    ffprobe = shutil.which('ffprobe')
    if not ffprobe:
        raise RuntimeError('Install FFprobe before enabling video depth review.')
    metadata = bounded_probe([ffprobe, '-v', 'error', '-protocol_whitelist', 'file',
        *sparse_colmap.video_input_options(path), '-probesize', '5242880', '-analyzeduration', '5000000',
        '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,duration,avg_frame_rate,start_time,time_base',
        '-of', 'json', str(path)])
    streams = [s for s in metadata.get('streams', []) if s.get('codec_type') == 'video']
    if len(streams) != 1:
        raise ValueError('Depth review accepts exactly one video stream.')
    stream = streams[0]
    _raster_bounds(stream.get('width'), stream.get('height'))
    if stream.get('codec_name') not in VIDEO_CODECS:
        raise ValueError('Use H.264, HEVC, MPEG-4, VP8, VP9 or AV1 video.')
    try:
        duration = float(stream.get('duration', metadata.get('format', {}).get('duration', 0)))
        rate = float(Fraction(stream.get('avg_frame_rate', '0/1')))
    except (ValueError, TypeError, ZeroDivisionError):
        raise ValueError('The video has invalid duration or frame-rate metadata.') from None
    if not math.isfinite(duration) or not 0 < duration <= MAX_VIDEO_SECONDS or not math.isfinite(rate) or not 0 <= rate <= 240:
        raise ValueError('Depth review accepts videos up to 60 seconds and at most 240 frames per second.')
    time_base = None
    match = re.fullmatch(r'(\d{1,10})/(\d{1,10})', str(stream.get('time_base', '')))
    if match and all(0 < int(v) <= 10 ** 9 for v in match.groups()):
        value = Fraction(*map(int, match.groups()))
        time_base = [value.numerator, value.denominator]
    return {'width': stream['width'], 'height': stream['height'], 'durationSeconds': duration,
            'averageFrameRate': rate or None, 'codec': stream['codec_name'], 'streamStartTime': stream.get('start_time'),
            'sourceTimeBase': time_base}


def _bounded_decode(command, timeout=MAX_DECODE_SECONDS, *, cwd=None):
    """Drain both subprocess pipes with a total byte budget and wall-clock deadline."""
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd)
    log, used = bytearray(), 0
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, False)
            selector.register(process.stderr, selectors.EVENT_READ, True)
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise TimeoutError('Video depth decoding exceeded its time budget.')
                for key, _ in selector.select(min(.2, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fileobj.fileno(), 8192)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    used += len(chunk)
                    if used > MAX_DECODE_LOG_BYTES:
                        raise ValueError('Video decoder diagnostics exceeded their bounded log budget.')
                    if key.data:
                        log.extend(chunk)
        if process.wait(timeout=max(.01, deadline - time.monotonic())) != 0:
            raise ValueError('The restricted video decoder rejected this source: ' + log.decode('utf-8', 'replace')[-500:])
        return log.decode('utf-8', 'replace')
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()
        process.stderr.close()


def source_timestamps(timing, frame_count, time_base=None):
    """Read only the private constant-key timing channel, never source metadata or stderr."""
    base = None
    if isinstance(time_base, list) and len(time_base) == 2 and all(type(v) is int and 0 < v <= 10 ** 9 for v in time_base):
        base = Fraction(*time_base)
    records = {}
    pattern = r'^frame:(\d{1,6})\s+pts:(-?\d{1,20}|NOPTS)\s+pts_time:[^\r\n]{1,48}\r?\nbrainsnn_depth_frame=1(?:\r?\n|$)'
    for match in re.finditer(pattern, timing, re.MULTILINE):
        index, pts = int(match[1]), match[2]
        if index >= frame_count or index in records or base is None or pts == 'NOPTS' or len(pts) > 20:
            continue
        instant = int(pts) * base
        if abs(instant) <= 86400:
            records[index] = {'timeSeconds': float(instant), 'timestampBasis': 'source-pts',
                              'sourceTimestamp': {'pts': pts, 'timeBase': [base.numerator, base.denominator]}}
    result, previous = [], None
    for index in range(frame_count):
        entry = records.get(index)
        if entry and (previous is None or entry['timeSeconds'] > previous):
            previous = entry['timeSeconds']
            result.append(entry)
        else:
            result.append({'timeSeconds': None, 'timestampBasis': 'not-available',
                           'timestampNote': 'No matching, strictly increasing original source PTS was available.'})
    return result


def prepare_frames(path, kind, work, *, max_frames=DEFAULT_FRAMES):
    """EXIF-upright photo or FFmpeg-upright actual video frames; no calibration/undistortion or poses."""
    import numpy as np
    from PIL import Image
    checked_budget(max_frames)
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    if kind == 'image':
        with Image.open(path, formats=sparse_colmap.PHOTO_FORMATS) as opened:
            if getattr(opened, 'n_frames', 1) != 1:
                raise ValueError('Use a still JPEG, PNG or WebP image; animated images need a video input.')
        photo = work / 'photo.jpg'
        preparation = sparse_colmap.prepare_photo(path, photo, with_evidence=True)
        _raster_bounds(preparation['orientedWidth'], preparation['orientedHeight'], minimum=256)
        with Image.open(photo, formats=('JPEG',)) as opened:
            rgb = np.asarray(opened.convert('RGB')).copy()
        frame = {'index': 0, 'rgb': rgb, 'timeSeconds': None, 'timestampBasis': 'still-image',
                 'sourceWidth': preparation['orientedWidth'], 'sourceHeight': preparation['orientedHeight'],
                 'decodedWidth': rgb.shape[1], 'decodedHeight': rgb.shape[0], 'preparation': preparation}
        return [frame], {'method': 'exif-upright-photo', 'metadataStripped': True, 'undistorted': False,
                         'sourceToPreparedPixelCenter': preparation['sourceToPreparedPixelCenter']}
    if kind != 'video':
        raise ValueError('Depth review supports image and video inputs only.')
    info = probe_video(path)
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('Install FFmpeg before enabling video depth review.')
    raw = work / 'video-frames'
    raw.mkdir(exist_ok=False)
    interval = info['durationSeconds'] / max_frames
    # Select original frames rather than fps-filter duplicates. copyts preserves their source timestamps.
    choose = f"select='isnan(prev_selected_t)+gte(t-prev_selected_t,{interval:.12f})'"
    scale = f"scale='min(iw,{MAX_INPUT_EDGE})':'min(ih,{MAX_INPUT_EDGE})':force_original_aspect_ratio=decrease"
    # Strip any source-provided value of this key, set a constant, and print only that key.
    # A fixed filename in the private working directory avoids filter-path escaping and
    # prevents arbitrary container metadata in stderr from impersonating frame timing.
    timing_filter = ('metadata=mode=delete:key=brainsnn_depth_frame,'
                     'metadata=mode=add:key=brainsnn_depth_frame:value=1,'
                     'metadata=mode=print:key=brainsnn_depth_frame:file=source-timestamps.txt')
    _bounded_decode([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-copyts',
        '-threads', str(sparse_colmap.THREADS), '-protocol_whitelist', 'file,pipe',
        *sparse_colmap.video_input_options(path), '-probesize', '5242880', '-analyzeduration', '5000000',
        '-max_pixels', str(MAX_VIDEO_PIXELS), '-codec_whitelist', ','.join(sorted(VIDEO_CODECS | {'libdav1d'})),
        '-i', str(path), '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', f'{choose},{scale},{timing_filter}',
        '-fps_mode', 'passthrough', '-frames:v', str(max_frames), '-q:v', '3', str(raw / 'frame_%04d.jpg')], cwd=work)
    files = sorted(raw.glob('frame_*.jpg'))
    if not 1 <= len(files) <= max_frames:
        raise ValueError('The source produced no bounded video frames.')
    timing_file = work / 'source-timestamps.txt'
    if timing_file.is_symlink() or (timing_file.exists() and
            (not timing_file.is_file() or timing_file.stat().st_size > MAX_TIMING_BYTES)):
        raise ValueError('Video timing evidence exceeded its bounded private-file budget.')
    timing = source_timestamps(timing_file.read_text() if timing_file.exists() else '', len(files), info['sourceTimeBase'])
    frames = []
    for index, file in enumerate(files):
        if file.is_symlink() or not 0 < file.stat().st_size <= MAX_FRAME_BYTES:
            raise ValueError('A decoded video frame exceeded its file budget.')
        with Image.open(file, formats=('JPEG',)) as opened:
            width, height = opened.size
            _raster_bounds(width, height)
            if max(width, height) > MAX_INPUT_EDGE:
                raise ValueError('A decoded frame exceeded its prepared raster budget.')
            rgb = np.asarray(opened.convert('RGB')).copy()
        frames.append({'index': index, 'rgb': rgb, **timing[index], 'sourceWidth': info['width'], 'sourceHeight': info['height'],
                       'decodedWidth': width, 'decodedHeight': height, 'preparation': {'decodedFrameSha256': sparse_colmap.file_sha256(file)}})
    return frames, {'method': 'original-frame-selection', 'metadataStripped': True, 'undistorted': False,
                    'orientation': 'FFmpeg decoder autorotation; source raster transform not independently calibrated',
                    'sampledFrames': True, 'selectionIntervalSeconds': interval,
                    'timestampMethod': 'copyts + original-frame select + private constant-key frame PTS channel', **info}


class MogeBackend:
    """The licensed default: each image independently uses the existing pinned metric depth solve."""
    def __init__(self, model, *, threads=sparse_colmap.THREADS):
        self.session = metric_scale.load_session(Path(model), threads)
        self.model_metadata = {k: metric_scale.MODEL[k] for k in ('repo', 'revision', 'file', 'sha256', 'base_model', 'license')}
        self.model_metadata.update(name='MoGe-2 ViT-B', runtime='onnxruntime-cpu', maxInputEdge=photo_metric.MODEL_EDGE,
                                   tokens=metric_scale.TOKENS)
        self.temporal_metadata = {'mode': 'independent-frames', 'consistencyEnforced': False,
                                  'description': 'Each sampled frame is inferred independently; metric scale and focal length may vary.'}

    def predict_image(self, rgb):
        import numpy as np
        from PIL import Image
        height, width = rgb.shape[:2]
        factor = min(1, photo_metric.MODEL_EDGE / max(width, height))
        size = tuple(max(14, int(round(side * factor / 14)) * 14) for side in (width, height))
        image = np.asarray(Image.fromarray(rgb).resize(size, Image.Resampling.BICUBIC)).copy()
        points, mask, camera = photo_metric.metric_points(self.session, image)
        f = float(camera['focal_pixels'])
        return {'depth': points[..., 2], 'mask': mask, 'rgb': image,
                'camera': {'fx': f, 'fy': f, 'cx': (size[0] - 1) / 2, 'cy': (size[1] - 1) / 2, 'width': size[0], 'height': size[1]},
                'provenance': {'inferenceExecuted': True, 'focalBasis': 'model-estimated', 'depthShiftSolved': True,
                               'depthEdgesRemoved': True, 'depthSmoothed': False, 'undistorted': False}}


def review_frame(frame, prediction, *, max_depth_metres=DEFAULT_MAX_DEPTH_METRES):
    """Exact integer-stride sampling of matching RGB/depth/mask and its pinhole intrinsics."""
    import numpy as np
    from PIL import Image
    checked_budget(max_depth_metres=max_depth_metres)
    depth, mask = np.asarray(prediction.get('depth')), np.asarray(prediction.get('mask'))
    rgb = np.asarray(prediction.get('rgb', frame['rgb']))
    if depth.ndim != 2 or mask.shape != depth.shape or rgb.shape != (*depth.shape, 3) or rgb.dtype != np.uint8 or \
            max(depth.shape) > MAX_INPUT_EDGE or min(depth.shape) < 24 or depth.dtype.kind not in 'fiu':
        raise ValueError('The backend must return matching bounded camera-depth, mask and RGB rasters.')
    if mask.dtype != np.bool_:
        raise ValueError('The backend geometry mask must be boolean.')
    height, width = depth.shape
    camera = prediction.get('camera', {})
    if any(not finite(camera.get(key)) for key in ('fx', 'fy', 'cx', 'cy')) or \
            not 0 < camera['fx'] <= 1e7 or not 0 < camera['fy'] <= 1e7 or \
            not -.5 <= camera['cx'] <= width - .5 or not -.5 <= camera['cy'] <= height - .5 or \
            camera.get('width', width) != width or camera.get('height', height) != height:
        raise ValueError('The backend intrinsics must describe the exact prediction raster with finite positive focal lengths.')
    stride = max(1, math.ceil(max(width, height) / MAX_REVIEW_EDGE))
    sampled = depth[::stride, ::stride].astype(np.float64)
    keep = mask[::stride, ::stride] & np.isfinite(sampled) & (sampled > 0) & (sampled <= max_depth_metres)
    image = rgb[::stride, ::stride].copy()
    h, w = sampled.shape
    if w < 32 or h < 24:
        raise ValueError('The review raster is too narrow. Use a source with aspect ratio no greater than 4:1.')
    encoded = io.BytesIO()
    # A fresh image prevents source metadata from entering the review artifact.
    Image.fromarray(image).save(encoded, format='JPEG', quality=85, subsampling=0)
    jpeg = encoded.getvalue()
    if len(jpeg) > MAX_JPEG_BYTES:
        raise ValueError('The review JPEG exceeded its byte budget.')
    values = [float(f'{float(value):.7g}') if valid else None for value, valid in zip(sampled.flat, keep.flat)]
    calibrated = {key: float(camera[key]) / stride for key in ('fx', 'fy', 'cx', 'cy')}
    if any(not .01 <= calibrated[key] <= 1e6 for key in ('fx', 'fy')):
        raise ValueError('The sampled camera focal length exceeds the supported review range.')
    valid = sampled[keep]
    record = {'index': frame['index'], 'timeSeconds': frame['timeSeconds'], 'timestampBasis': frame['timestampBasis'],
              'width': w, 'height': h, 'depth': values, 'camera': calibrated,
              'imageDataUrl': 'data:image/jpeg;base64,' + base64.b64encode(jpeg).decode('ascii'),
              'inputWidth': width, 'inputHeight': height, 'sourceWidth': frame['sourceWidth'], 'sourceHeight': frame['sourceHeight'],
              'reviewSampling': {'method': 'integer-stride-at-original-pixel-centres', 'stride': stride,
                                 'firstInputPixel': [0, 0], 'depthInterpolated': False, 'imageAligned': True},
              'statistics': {'validPixels': int(keep.sum()), 'totalPixels': int(keep.size),
                             'minimumMetres': float(valid.min()) if valid.size else None,
                             'medianMetres': float(np.median(valid)) if valid.size else None,
                             'maximumMetres': float(valid.max()) if valid.size else None,
                             'invalidOrMaskedPixels': int((~keep).sum()),
                             'beyondReviewRangePixels': int((np.isfinite(sampled) & (sampled > max_depth_metres)).sum())},
              'preparation': frame.get('preparation', {}), 'provenance': prediction.get('provenance', {})}
    for key in ('sourceTimestamp', 'timestampNote'):
        if key in frame:
            record[key] = frame[key]
    # PLY derives from the same displayed camera-Z depth, never Euclidean range along a unit ray.
    u, v = np.meshgrid(np.arange(w), np.arange(h))
    z = np.array([v if v is not None else np.nan for v in values]).reshape(h, w)
    xyz = np.stack([(u - calibrated['cx']) * z / calibrated['fx'], (v - calibrated['cy']) * z / calibrated['fy'], z], axis=-1)
    return record, xyz[keep], image[keep]


def run_with_backend(request, backend, *, engine=ENGINE, max_frames=DEFAULT_FRAMES, max_depth_metres=DEFAULT_MAX_DEPTH_METRES):
    """Trusted Python seam; uploaded request options cannot select a backend or permission configuration."""
    max_frames, max_depth_metres = checked_budget(max_frames, max_depth_metres)
    if engine not in (ENGINE, 'depth-pro-2'):
        raise ValueError('Unknown depth-review engine.')
    path, source = source_input(request)
    out = Path(request.get('output_dir', ''))
    if not out.is_absolute() or out.is_symlink():
        raise ValueError('The depth output must be an absolute local job directory.')
    started = time.monotonic()
    work = out.parent / 'depth-sequence-work'
    if work.is_symlink() or work.exists():
        raise ValueError('Depth review requires a fresh private work directory.')
    frames, preparation = prepare_frames(path, source['kind'], work, max_frames=max_frames)
    model, temporal = dict(backend.model_metadata), dict(backend.temporal_metadata)
    if not all(isinstance(model.get(key), str) and 0 < len(model[key]) <= 300 for key in ('repo', 'revision', 'license')) or \
            temporal.get('mode') not in ('independent-frames', 'joint-video'):
        raise ValueError('The backend must report its pinned model and temporal method.')
    use_joint = source['kind'] == 'video' and temporal['mode'] == 'joint-video' and len(frames) > 1
    if source['kind'] == 'image' or len(frames) == 1:
        temporal.update(configuredMode=temporal['mode'], mode='independent-frames', applied=False,
                        description='A single frame was inferred; no cross-frame temporal method was applied.')
    elif temporal['mode'] == 'joint-video':
        temporal['applied'] = True
    if use_joint:
        if not callable(getattr(backend, 'predict_sequence', None)):
            raise ValueError('A joint-video backend must provide sequence inference.')
        predictions = iter(backend.predict_sequence([f['rgb'] for f in frames], timestamps_seconds=[f['timeSeconds'] for f in frames]))
    else:
        predictions = (backend.predict_image(f['rgb']) for f in frames)
    output_frames, first_xyz, first_rgb = [], None, None
    for index, frame in enumerate(frames):
        try:
            prediction = next(predictions)
        except StopIteration:
            raise ValueError('The backend returned fewer predictions than source frames.') from None
        if not isinstance(prediction, dict) or prediction.get('index', index) != index:
            raise ValueError('The backend returned an out-of-order frame prediction.')
        record, xyz, rgb = review_frame(frame, prediction, max_depth_metres=max_depth_metres)
        output_frames.append(record)
        if index == 0:
            first_xyz, first_rgb = xyz, rgb
    try:
        next(predictions)
    except StopIteration:
        pass
    else:
        raise ValueError('The backend returned more predictions than source frames.')
    if any('overlap_blending_applied_to_sequence' in f['provenance'] for f in output_frames):
        temporal['overlapBlendingApplied'] = any(f['provenance'].get('overlap_blending_applied_to_sequence') is True for f in output_frames)
    evidence = {'schema': SCHEMA, 'engine': engine, 'source': source, 'model': model, 'units': 'm',
                'coordinateFrame': 'camera-x-right-y-down-z-forward', 'depthConvention': 'camera-z',
                'maxDepthMeters': max_depth_metres, 'scale': {'basis': 'model-estimated', 'verified': False},
                'registration': {'available': False, 'cameraPosesAvailable': False}, 'temporal': temporal,
                'preparation': preparation, 'frames': output_frames,
                'provenance': {'inferenceExecuted': all(f['provenance'].get('inferenceExecuted', False) is True for f in output_frames),
                               'metricVerified': False, 'collisionReady': False,
                               'hiddenSurfaceCompletion': False, 'additionalDepthSmoothing': False, 'worldRegistrationExecuted': False,
                               'sourceFrameCount': len(frames), 'modelDepthConvention': 'camera-z',
                               'reviewDownsampled': any(f['reviewSampling']['stride'] > 1 for f in output_frames),
                               'elapsedSeconds': round(time.monotonic() - started, 3)},
                'pointPreview': {'available': bool(len(first_xyz)), 'frameIndex': 0,
                                 'coordinateFrame': 'right-handed-y-up', 'cameraToPreview': [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
                                 'scaleBasis': 'model-estimated; unverified'}}
    encoded = json.dumps(evidence, allow_nan=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) > MAX_JSON_BYTES:
        raise ValueError('Depth sequence exceeds the 16 MiB review artifact budget.')
    out.mkdir(parents=True, exist_ok=True)
    (out / 'depth-sequence.json').write_bytes(encoded)
    artifacts = [{'name': 'depth-sequence.json', 'kind': 'evidence'}]
    if len(first_xyz):
        # Match the existing photo metric preview convention; its generic visual hint does not promote estimated scale.
        cloud = write_point_cloud(out / 'depth-first-frame.ply', first_xyz * [1, -1, -1], first_rgb,
                                  coordinate_frame='right-handed-y-up', max_points=MAX_REVIEW_EDGE ** 2)
        artifacts.append(cloud)
    (out / 'manifest.json').write_text(json.dumps({'artifacts': artifacts}, allow_nan=False))
    return evidence


def run(request, model, *, max_frames=DEFAULT_FRAMES, max_depth_metres=DEFAULT_MAX_DEPTH_METRES):
    checked_budget(max_frames, max_depth_metres)
    source_input(request, hash_source=False)  # Validate the one bounded source before a heavyweight model session.
    return run_with_backend(request, MogeBackend(model), max_frames=max_frames, max_depth_metres=max_depth_metres)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--input-manifest', required=True, type=Path)
    parser.add_argument('--model', required=True, type=Path, help='Local pinned metric_scale.MODEL ONNX checkpoint; never downloaded here.')
    parser.add_argument('--max-frames', type=int, default=DEFAULT_FRAMES)
    parser.add_argument('--max-depth-metres', type=float, default=DEFAULT_MAX_DEPTH_METRES)
    args = parser.parse_args()
    if args.input_manifest.is_symlink() or not args.input_manifest.is_file() or args.input_manifest.stat().st_size > 65536:
        raise ValueError('The adapter manifest must be a regular local JSON file no larger than 64 KiB.')
    run(json.loads(args.input_manifest.read_text()), args.model, max_frames=args.max_frames, max_depth_metres=args.max_depth_metres)


if __name__ == '__main__':
    main()
