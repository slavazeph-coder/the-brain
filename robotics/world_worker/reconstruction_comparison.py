"""Offline, same-frame COLMAP / VGGT comparison, separate from production workers.

Prepare once, mark the physical references before inspecting results, then run
each engine in a fresh bounded process. Camera-landmark checks do not validate
the dense cloud, compiled BIM, collision geometry or physical robot execution.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
FRAME_SCHEMA = 'brainsnn.comparison-frames.v1'
RUN_SCHEMA = 'brainsnn.comparison-run.v1'
CAMERA_SCHEMA = 'brainsnn.comparison-cameras.v1'
ENGINES = ('colmap', 'vggt', 'vggt-ba')
MAX_FRAMES = 60
MAX_FRAME_BYTES = 8 * 1024 ** 2
MAX_JSON_BYTES = 4 * 1024 ** 2
MAX_LOG_BYTES = 16 * 1024 ** 2
MAX_SOURCE_BYTES = 2 * 1024 ** 3
MAX_DECODED_FRAMES = 36_000
_SHA = re.compile(r'^[a-f0-9]{64}$')
_FRAME = re.compile(r'^frame_\d{4}\.jpg$')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False, ensure_ascii=False).encode('utf-8')


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024 ** 2), b''):
            digest.update(part)
    return digest.hexdigest()


def read_json(path, limit=MAX_JSON_BYTES):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('Expected a bounded regular JSON file.')
    def reject(value):
        raise ValueError(f'Non-finite JSON value: {value}')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON keys are not permitted.')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), parse_constant=reject, object_pairs_hook=pairs)


def write_json(path, value):
    data = json.dumps(value, indent=2, allow_nan=False, ensure_ascii=False) + '\n'
    if len(data.encode('utf-8')) > MAX_JSON_BYTES:
        raise ValueError('Result exceeds its JSON size budget.')
    Path(path).write_text(data, encoding='utf-8')


def regular_source(path, limit=MAX_SOURCE_BYTES):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 1 <= path.stat().st_size <= limit:
        raise ValueError('Use a nonempty regular local source file within its byte budget.')
    return path.resolve()


def source_record(path, kind):
    return {'name': path.name, 'sha256': sha(path), 'bytes': path.stat().st_size, 'kind': kind}


def sample_indices(count, requested):
    if type(count) is not int or type(requested) is not int or not 3 <= requested <= MAX_FRAMES or count < 3:
        raise ValueError('Use 3 to 60 frames and a capture containing at least three frames.')
    chosen = min(count, requested)
    return [round(index * (count - 1) / (chosen - 1)) for index in range(chosen)]


def frame_record(path, **extra):
    from PIL import Image
    with Image.open(path) as image:
        width, height = image.size
    return {'image': path.name, 'sha256': sha(path), 'bytes': path.stat().st_size,
            'width': width, 'height': height, **extra}


def _decode_video(source, wanted=None, target=None):
    """Decode stored rasters in order. Display-rotation metadata is not applied."""
    import av
    from PIL import Image
    count, records, durations, first_pts = 0, [], [], None
    with av.open(str(source), mode='r', options={'protocol_whitelist': 'file,pipe',
                                               'enable_drefs': '0', 'use_absolute_path': '0'}) as container:
        streams = [stream for stream in container.streams if stream.type == 'video']
        if len(streams) != 1:
            raise ValueError('Use a video containing one video stream.')
        stream = streams[0]
        if container.duration is not None and container.duration / av.time_base > 301:
            raise ValueError('Comparison video must be at most five minutes.')
        stream.thread_type = 'SLICE'
        stream.codec_context.thread_count = 2
        for frame in container.decode(stream):
            if count >= MAX_DECODED_FRAMES or frame.width * frame.height > 24_000_000:
                raise ValueError('Video exceeds the decoded-frame or raster budget.')
            if min(frame.width, frame.height) < 256:
                raise ValueError('Use video rasters at least 256 pixels on each side.')
            stamp = float(frame.pts * frame.time_base) if frame.pts is not None and frame.time_base is not None else None
            if stamp is not None:
                first_pts = stamp if first_pts is None else first_pts
                if abs(stamp - first_pts) > 301:
                    raise ValueError('Comparison video must be at most five minutes.')
                durations.append(stamp)
            if wanted is not None and count in wanted:
                image = Image.fromarray(frame.to_ndarray(format='rgb24'))
                source_width, source_height = image.size
                image.thumbnail((1280, 1280))
                name = target / f'frame_{len(records):04d}.jpg'
                image.save(name, 'JPEG', quality=92)
                from .sparse_colmap import photo_pixel_transform
                records.append(frame_record(name, sourceIndex=0, sourceFrameIndex=count,
                    pts=frame.pts, timeBase=([frame.time_base.numerator, frame.time_base.denominator]
                                           if frame.time_base is not None else None),
                    sourceWidth=source_width, sourceHeight=source_height,
                    sourceToFramePixelCenter=photo_pixel_transform(source_width, source_height, 1, image.width, image.height)))
            count += 1
    return count, records, {'decodedFrames': count, 'timestampRangeSeconds':
        [min(durations), max(durations)] if durations else None,
        'displayRotation': 'Not applied; annotations and all engines use the same stored raster orientation.',
        'decoder': f'PyAV {av.__version__}'}


def prepare(*, out, frames=32, video=None, photos=None):
    if (video is None) == (photos is None):
        raise ValueError('Choose exactly one video or photo directory.')
    if type(frames) is not int or not 3 <= frames <= MAX_FRAMES:
        raise ValueError('Use 3 to 60 frames.')
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    images = out / 'frames'; images.mkdir()
    started = time.monotonic()
    try:
        if video is not None:
            source = regular_source(video)
            # Only self-contained movie formats; reject playlist/network inputs.
            from .sparse_colmap import video_input_options
            video_input_options(source)
            sources = [source_record(source, 'video')]
            count, _, _ = _decode_video(source)
            selected = sample_indices(count, frames)
            count_again, rows, detail = _decode_video(source, set(selected), images)
            if count_again != count or len(rows) != len(selected) or sha(source) != sources[0]['sha256']:
                raise ValueError('Video changed or decoded differently during preparation.')
            detail['selection'] = 'Uniform indices over all decoded frames; no engine-dependent selection.'
        else:
            directory = Path(photos)
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError('Use a regular local photo directory.')
            candidates = sorted(p for p in directory.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp'))
            if len(candidates) > 10_000:
                raise ValueError('Photo directory exceeds 10,000 candidates.')
            selected = sample_indices(len(candidates), frames)
            sources, rows = [], []
            from .sparse_colmap import prepare_photo
            for index in selected:
                source = regular_source(candidates[index], 64 * 1024 ** 2)
                entry = source_record(source, 'image'); sources.append(entry)
                target = images / f'frame_{len(rows):04d}.jpg'
                info = prepare_photo(source, target, with_evidence=True)
                if info['sourceSha256'] != entry['sha256'] or sha(source) != entry['sha256']:
                    raise ValueError('Photo changed during preparation.')
                rows.append(frame_record(target, sourceIndex=len(sources)-1, sourceFrameIndex=index,
                    pts=None, timeBase=None, sourceWidth=info['sourceWidth'], sourceHeight=info['sourceHeight'],
                    exifOrientation=info['exifOrientation'], sourceToFramePixelCenter=info['sourceToPreparedPixelCenter']))
            detail = {'selection': 'Uniform indices in lexicographic filename order; no engine-dependent selection.',
                      'candidatePhotos': len(candidates)}
        receipt = {'schema': FRAME_SCHEMA, 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'sources': sources, 'frames': rows,
            'preparation': {'requestedFrames': frames, 'selectedFrames': len(rows),
                            'elapsedSeconds': time.monotonic() - started, **detail},
            'metricVerified': False, 'captureProvenance': 'Local input file hashes; ownership and physical capture are not independently attested.'}
        receipt['captureSha256'] = hashlib.sha256(canonical(receipt)).hexdigest()
        write_json(out / 'capture.json', receipt)
        write_json(out / 'annotations.template.json', {'schema': 'brainsnn.comparison-annotations.v1',
            'captureSha256': receipt['captureSha256'], 'referenceBasis': 'physical-readings',
            'landmarks': [], 'spans': [], 'floorLandmarks': []})
        template = ROOT / 'scripts/world-demo/benchmark/comparison_annotator.html'
        if template.is_file():
            shutil.copyfile(template, out / 'annotate.html')
        return receipt
    except Exception as error:
        write_json(out / 'preparation-failure.json', {'status': 'failed', 'error': str(error)[:2000]})
        raise


def validate_capture(case):
    from PIL import Image
    case = Path(case).resolve()
    receipt = read_json(case / 'capture.json')
    if not isinstance(receipt, dict) or receipt.get('schema') != FRAME_SCHEMA:
        raise ValueError('Unknown shared-frame receipt schema.')
    digest = receipt.get('captureSha256')
    if not isinstance(digest, str) or not _SHA.fullmatch(digest) or digest != hashlib.sha256(
            canonical({k: v for k, v in receipt.items() if k != 'captureSha256'})).hexdigest():
        raise ValueError('Shared-frame receipt hash does not match.')
    rows = receipt.get('frames')
    if not isinstance(rows, list) or not 3 <= len(rows) <= MAX_FRAMES:
        raise ValueError('Shared-frame receipt requires 3 to 60 frames.')
    preparation = receipt.get('preparation')
    sources = receipt.get('sources')
    if receipt.get('metricVerified') is not False or not isinstance(preparation, dict) \
            or isinstance(preparation.get('elapsedSeconds'), bool) \
            or not isinstance(preparation.get('elapsedSeconds'), (int, float)) \
            or not math.isfinite(preparation['elapsedSeconds']) or not 0 <= preparation['elapsedSeconds'] <= 86_400 \
            or type(preparation.get('selectedFrames')) is not int or preparation['selectedFrames'] != len(rows) \
            or type(preparation.get('requestedFrames')) is not int or not len(rows) <= preparation['requestedFrames'] <= MAX_FRAMES:
        raise ValueError('Invalid shared-frame preparation receipt or unverified metric flag.')
    if not isinstance(sources, list) or not 1 <= len(sources) <= MAX_FRAMES:
        raise ValueError('Shared capture needs bounded original-source provenance.')
    for source in sources:
        if not isinstance(source, dict) or source.get('kind') not in ('image', 'video') \
                or not isinstance(source.get('name'), str) or not 1 <= len(source['name']) <= 255 \
                or Path(source['name']).name != source['name'] \
                or not isinstance(source.get('sha256'), str) or not _SHA.fullmatch(source['sha256']) \
                or type(source.get('bytes')) is not int or not 1 <= source['bytes'] <= MAX_SOURCE_BYTES:
            raise ValueError('Invalid original-source provenance.')
    names = set()
    for row in rows:
        name = row.get('image') if isinstance(row, dict) else None
        if not isinstance(name, str) or not _FRAME.fullmatch(name) or name in names:
            raise ValueError('Frame names must be unique canonical basenames.')
        names.add(name)
        if type(row.get('sourceIndex')) is not int or not 0 <= row['sourceIndex'] < len(sources) \
                or type(row.get('sourceFrameIndex')) is not int or row['sourceFrameIndex'] < 0:
            raise ValueError('Shared frame has invalid original-source association.')
        path = case / 'frames' / name
        if path.parent.is_symlink() or path.is_symlink() or not path.is_file() or not 1 <= path.stat().st_size <= MAX_FRAME_BYTES \
                or type(row.get('bytes')) is not int or path.stat().st_size != row['bytes'] or sha(path) != row.get('sha256'):
            raise ValueError('A shared frame is missing, modified or outside its byte budget.')
        with Image.open(path) as image:
            if image.format != 'JPEG' or list(image.size) != [row.get('width'), row.get('height')] \
                    or any(type(row.get(k)) is not int for k in ('width', 'height')) \
                    or min(image.size) < 256 or max(image.size) > 1280:
                raise ValueError('Shared JPEG raster does not match its receipt.')
            image.verify()
    actual = {p.name for p in (case / 'frames').iterdir()}
    if actual != names:
        raise ValueError('Shared frame directory contains unrecorded files.')
    return receipt


def run_colmap(images, out):
    """The existing pinned CPU/SIFT baseline, on the already prepared shared JPEGs."""
    import numpy as np
    import pycolmap
    from . import sparse_colmap
    from .geometry import write_point_cloud
    if pycolmap.__version__ != sparse_colmap.PYCOLMAP_VERSION:
        raise RuntimeError(f'Install pycolmap=={sparse_colmap.PYCOLMAP_VERSION}.')
    started = time.monotonic()
    workspace = out / 'native'; workspace.mkdir()
    database = workspace / 'database.db'
    extraction = pycolmap.FeatureExtractionOptions({'num_threads': 2, 'max_image_size': 1280,
                                                    'sift': {'max_num_features': 4096}})
    pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.AUTO,
        reader_options={'camera_model': 'SIMPLE_RADIAL'}, extraction_options=extraction, device=pycolmap.Device.cpu)
    extracted = time.monotonic()
    matching = pycolmap.FeatureMatchingOptions({'num_threads': 2})
    pycolmap.match_exhaustive(database, matching_options=matching, device=pycolmap.Device.cpu)
    matched = time.monotonic()
    count = len(list(images.glob('*.jpg')))
    models, index, model, attempts = sparse_colmap.map_frames(database, images, workspace, count)
    mapped = time.monotonic()
    if model.num_reg_images() < 3 or model.num_points3D() < 30:
        raise ValueError('COLMAP reconstructed fewer than three cameras or 30 points.')
    model.extract_colors_for_all_images(images, num_threads=2)
    rows = []
    for image_id in sorted(model.reg_image_ids()):
        image = model.image(image_id); camera = model.camera(image.camera_id)
        rows.append({'image': image.name, 'width': camera.width, 'height': camera.height,
            'camera': {'model': camera.model_name, 'params': camera.params.tolist(), 'pixelConvention': 'colmap-half-pixel'},
            'cam_from_world': image.cam_from_world().matrix().tolist()})
    points = sorted(model.points3D.items())
    stride = max(1, math.ceil(len(points) / 100_000))
    selected = [point for _, point in points[::stride]]
    visual = write_point_cloud(out / 'points.ply', np.asarray([p.xyz for p in selected]),
                               np.asarray([p.color for p in selected]), coordinate_frame='colmap')
    write_json(out / 'cameras.json', {'schema': CAMERA_SCHEMA, 'coordinateFrame': 'colmap-arbitrary',
        'metricVerified': False, 'frames': rows})
    return {'engine': 'colmap', 'method': 'Pinned existing CPU SIFT / exhaustive matching / incremental mapping baseline',
        'device': {'type': 'cpu', 'threads': 2, 'processor': platform.processor()},
        'dependencies': {'pycolmap': pycolmap.__version__, 'numpy': np.__version__},
        'stagesSeconds': {'featureExtraction': extracted-started, 'matching': matched-extracted,
                         'mapping': mapped-matched, 'artifactExport': time.monotonic()-mapped},
        'registeredFrames': len(rows), 'inputFrames': count, 'registrationFraction': len(rows)/count,
        'modelsFound': len(models), 'selectedModel': index, 'mappingAttempts': attempts,
        'points': model.num_points3D(), 'preview': visual,
        'internalMeanReprojectionErrorPixels': model.compute_mean_reprojection_error(),
        'gpuMemory': None, 'metricVerified': False}


def _deny_network(event, _args):
    if event in ('socket.connect', 'socket.getaddrinfo'):
        raise RuntimeError('Comparison engine execution is offline; prepare dependencies separately.')


def hardware_record():
    cpu = platform.processor()
    if not cpu and sys.platform.startswith('linux'):
        try:
            cpu = next((line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines()
                        if line.startswith('model name')), '')
        except OSError:
            pass
    gpu = None
    executable = shutil.which('nvidia-smi')
    if executable:
        try:
            result = subprocess.run([executable, '--query-gpu=name,memory.total,driver_version',
                                     '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=10, check=True)
            gpu = result.stdout[:4096].strip()
        except (OSError, subprocess.SubprocessError):
            pass
    return {'platform': platform.platform(), 'machine': platform.machine(), 'python': platform.python_version(),
            'cpu': cpu, 'logicalCpuCount': os.cpu_count(), 'nvidiaNameMemoryMiBDriver': gpu,
            'gpuMemoryMeasurement': 'Per-engine CUDA allocator peaks are in the actual engine result; nvidia-smi lists host devices only.'}


def engine_main(args):
    receipt = validate_capture(args.case)
    out = Path(args.out).resolve()
    sys.addaudithook(_deny_network)
    started = time.monotonic()
    if args.engine == 'colmap':
        detail = run_colmap(Path(args.case).resolve() / 'frames', out)
    else:
        from . import comparison_vggt
        if args.vggt_source is None or args.vggt_checkpoint is None:
            raise RuntimeError('VGGT needs --vggt-source and --vggt-checkpoint; no downloads are performed.')
        detail = comparison_vggt.run(Path(args.case).resolve() / 'frames', out,
            Path(args.vggt_source).resolve(), Path(args.vggt_checkpoint).resolve(), use_ba=args.engine == 'vggt-ba')
    validate_capture(args.case)  # Detect mutation during actual inference.
    cameras = read_json(out / 'cameras.json')
    if cameras.get('schema') != CAMERA_SCHEMA:
        raise ValueError('Engine did not produce comparison camera evidence.')
    valid_names = {row['image'] for row in receipt['frames']}
    rows = cameras.get('frames', [])
    if not rows or len(rows) != len({r['image'] for r in rows}) or any(r['image'] not in valid_names for r in rows):
        raise ValueError('Engine camera identities do not match shared frames.')
    try:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        peak_rss = int(peak if sys.platform == 'darwin' else peak*1024)
    except ImportError:
        peak_rss = None
    write_json(out / 'engine-result.json', {'schema': 'brainsnn.comparison-engine.v1',
        'captureSha256': receipt['captureSha256'], 'engine': args.engine, 'status': 'completed',
        'elapsedSecondsInsideEngine': time.monotonic()-started, 'peakProcessRssBytes': peak_rss,
        'peakProcessRssScope': 'Process high-water RSS including native allocations; excludes other processes.',
        'cameras': {'name': 'cameras.json', 'sha256': sha(out / 'cameras.json')}, 'detail': detail})


def bounded_process(command, log_path, *, timeout, env=None):
    """Timeout/log caps include child processes. Completed logs remain local evidence."""
    started, status, code = time.monotonic(), None, None
    with Path(log_path).open('wb') as log:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=(os.name == 'posix'))
        try:
            while True:
                code = process.poll()
                if time.monotonic()-started >= timeout:
                    status = 'timeout'; break
                if Path(log_path).stat().st_size > MAX_LOG_BYTES:
                    status = 'log-limit'; break
                if code is not None:
                    status = 'completed' if code == 0 else 'failed'; break
                time.sleep(.1)
        finally:
            if os.name == 'posix':
                # A parent can exit while a descendant continues in the dedicated
                # session. Reap the whole group even after a zero parent exit.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            elif process.poll() is None:
                process.kill()
            code = process.wait()
    if Path(log_path).stat().st_size > MAX_LOG_BYTES:
        with Path(log_path).open('r+b') as stream:
            stream.truncate(MAX_LOG_BYTES)
    return {'status': status, 'exitCode': code, 'coldWallSeconds': time.monotonic()-started,
            'timeoutSeconds': timeout, 'log': {'name': Path(log_path).name, 'sha256': sha(log_path)}}


def execute(*, case, out, engines=ENGINES, vggt_source=None, vggt_checkpoint=None, timeout=1800,
            python=sys.executable, annotations=None):
    from . import comparison_measurements as measurements
    case = Path(case).resolve(); out = Path(out)
    receipt = validate_capture(case)
    engines = list(engines)
    if not engines or len(set(engines)) != len(engines) or any(e not in ENGINES for e in engines):
        raise ValueError('Choose unique engine names from colmap, vggt, vggt-ba.')
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= 7200:
        raise ValueError('Engine timeout must be 1 to 7200 seconds.')
    frozen = None
    if annotations is not None:
        frozen = read_json(annotations)
        measurements.validate_annotations(frozen, receipt)
    out.mkdir(parents=True, exist_ok=False)
    out = out.resolve()
    write_json(out / 'capture.json', receipt)
    if frozen is not None:
        write_json(out / 'annotations.json', frozen)
    report = {'schema': RUN_SCHEMA, 'captureSha256': receipt['captureSha256'],
        'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'requestedEngines': engines,
        'annotationsPredeclared': frozen is not None,
        'annotationSha256': hashlib.sha256(canonical(frozen)).hexdigest() if frozen is not None else None,
        'timingScope': 'Sequential fresh processes, one process-cold run per engine; includes process startup, checkpoint verification/load and export. OS file caches are not flushed. Preparation measured separately.',
        'hardware': hardware_record(),
        'preparationSeconds': receipt['preparation']['elapsedSeconds'], 'runs': [],
        'metricVerified': False, 'physicalRobotValidated': False, 'bimDimensionsValidated': False}
    write_json(out / 'run.json', report)
    env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
           'HF_DATASETS_OFFLINE': '1', 'PYTHONHASHSEED': '0', 'PYTHONUNBUFFERED': '1',
           'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2', 'MKL_NUM_THREADS': '2'}
    for engine in engines:
        target = out / engine; target.mkdir()
        log_path = out / f'{engine}.log'
        command = [str(python), '-m', 'robotics.world_worker.reconstruction_comparison', '_engine',
                   '--case', str(case), '--out', str(target), '--engine', engine]
        if vggt_source is not None:
            command += ['--vggt-source', str(Path(vggt_source).resolve())]
        if vggt_checkpoint is not None:
            command += ['--vggt-checkpoint', str(Path(vggt_checkpoint).resolve())]
        print(f'Running {engine} on {len(receipt["frames"])} identical prepared frames...', flush=True)
        try:
            row = {'engine': engine, **bounded_process(command, log_path, timeout=timeout, env=env)}
        except OSError as error:
            row = {'engine': engine, 'status': 'failed-to-start', 'error': str(error)[:1000],
                   'coldWallSeconds': 0., 'exitCode': None, 'timeoutSeconds': timeout}
        # VGGT requires an empty output directory at entry. Keep its live log
        # outside the arm directory, then retain it beside the completed output.
        if log_path.is_file():
            log_path.rename(target / 'engine.log')
            row['log'] = {'name': 'engine.log', 'sha256': sha(target / 'engine.log')}
        row['endToEndSeconds'] = receipt['preparation']['elapsedSeconds'] + row['coldWallSeconds']
        if row['status'] == 'completed':
            try:
                result = read_json(target / 'engine-result.json')
                if result.get('captureSha256') != receipt['captureSha256'] or result.get('engine') != engine \
                        or result.get('cameras', {}).get('sha256') != sha(target / 'cameras.json'):
                    raise ValueError('Engine result is not bound to this capture and camera output.')
                row['result'] = result
                row['engineResultSha256'] = sha(target / 'engine-result.json')
            except (OSError, ValueError, TypeError, KeyError) as error:
                row.update(status='invalid-output', error=str(error)[:1000])
        report['runs'].append(row)
        write_json(out / 'run.json', report)
        print(f'{engine}: {row["status"]} ({row["coldWallSeconds"]:.2f}s)', flush=True)
    validate_capture(case)
    if frozen is not None:
        score_run(case=case, run=out, annotations=out / 'annotations.json')
    else:
        comparison = {'schema': 'brainsnn.reconstruction-comparison.v1', 'captureSha256': receipt['captureSha256'],
            'runReceiptSha256': sha(out / 'run.json'), 'referenceBasis': 'not-provided',
            'annotationsPredeclared': False, 'scope': 'Execution and timing only; no reference measurements provided.',
            'runs': [{'engine': row['engine'], 'status': row['status'], 'endToEndSeconds': row['endToEndSeconds']}
                     for row in report['runs']],
            'promotion': {'eligible': False, 'reason': 'No predeclared independent reference measurements.'},
            'metricVerified': False, 'surveyAccuracyValidated': False, 'physicalRobotValidated': False}
        write_json(out / 'comparison.json', comparison)
        write_markdown(out / 'comparison.md', comparison)
    return report


def score_run(*, case, run, annotations):
    from . import comparison_measurements as measurements
    case, run = Path(case).resolve(), Path(run).resolve()
    receipt, runs, marked = validate_capture(case), read_json(run / 'run.json'), read_json(annotations)
    measurements.validate_annotations(marked, receipt)
    marked_hash = hashlib.sha256(canonical(marked)).hexdigest()
    if runs.get('schema') != RUN_SCHEMA or runs.get('captureSha256') != receipt['captureSha256']:
        raise ValueError('Run does not belong to this shared capture.')
    if runs.get('annotationsPredeclared') is True and marked_hash != runs.get('annotationSha256'):
        raise ValueError('Annotations changed after the run was started. Use a fresh declared run.')
    rows = []
    for row in runs['runs']:
        engine = row.get('engine')
        if engine not in ENGINES:
            raise ValueError('Unknown engine in run receipt.')
        scored = {'engine': engine, 'status': row['status'], 'endToEndSeconds': row.get('endToEndSeconds')}
        if row['status'] == 'completed':
            target = run / engine
            if sha(target / 'engine-result.json') != row.get('engineResultSha256'):
                raise ValueError('Engine receipt changed after completion.')
            result = read_json(target / 'engine-result.json')
            if sha(target / 'cameras.json') != result['cameras']['sha256']:
                raise ValueError('Camera output changed after completion.')
            scored['measurementReport'] = measurements.score(read_json(target / 'cameras.json'), marked, receipt)
        rows.append(scored)
    dimension_timing_gate(rows, predeclared=runs.get('annotationsPredeclared') is True,
                          physical=marked['referenceBasis'] == 'physical-readings')
    comparison = {'schema': 'brainsnn.reconstruction-comparison.v1', 'captureSha256': receipt['captureSha256'],
        'runReceiptSha256': sha(run / 'run.json'), 'annotationSha256': marked_hash,
        'referenceBasis': marked['referenceBasis'], 'annotationsPredeclared': runs.get('annotationsPredeclared') is True,
        'scope': 'Same-image triangulated camera landmarks after one scalar calibration. Dense geometry, BIM and opening completeness remain unvalidated.',
        'runs': rows, 'promotion': {'eligible': False,
            'reason': 'Camera checks alone cannot approve engine promotion; independent opening/BIM coverage review and multi-capture repeated timing are required.'},
        'metricVerified': False, 'surveyAccuracyValidated': False, 'physicalRobotValidated': False}
    write_json(run / 'comparison.json', comparison)
    write_markdown(run / 'comparison.md', comparison)
    return comparison


def dimension_timing_gate(rows, *, predeclared, physical):
    """A narrow per-capture candidate gate, never an automatic release approval."""
    baseline = next((row for row in rows if row['engine'] == 'colmap'), None)
    for row in rows:
        gate = {'status': 'unavailable', 'passed': False, 'medianErrorReductionRequired': .20,
                'endToEndSpeedupRequired': 2., 'maximumErrorMustNotIncrease': True,
                'minimumHeldOutSpans': 7, 'openingCompletenessReviewed': False}
        row['dimensionAndTimingGate'] = gate
        if row['engine'] == 'colmap':
            gate['reason'] = 'Baseline, not a promotion candidate.'; continue
        a = (baseline or {}).get('measurementReport', {}).get('summary', {})
        b = row.get('measurementReport', {}).get('summary', {})
        times = [(baseline or {}).get('endToEndSeconds'), row.get('endToEndSeconds')]
        if not predeclared or not physical:
            gate['reason'] = 'Requires predeclared physical readings; synthetic or post-run annotations cannot qualify.'
        elif baseline is None or baseline.get('status') != 'completed' or row.get('status') != 'completed':
            gate['reason'] = 'Both baseline and candidate must complete.'
        elif not a.get('eligibleForPhysicalDimensionComparison') or not b.get('eligibleForPhysicalDimensionComparison'):
            gate['reason'] = 'Both arms need every requested withheld span available, with at least seven.'
        elif any(isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t) or t <= 0 for t in times):
            gate['reason'] = 'Valid measured end-to-end timings are unavailable.'
        elif a['heldOutMedianAbsoluteErrorMeters'] <= 1e-9:
            gate['reason'] = 'Baseline median is effectively zero; a percentage improvement is not meaningful.'
        else:
            reduction = 1-b['heldOutMedianAbsoluteErrorMeters']/a['heldOutMedianAbsoluteErrorMeters']
            speedup = times[0]/times[1]
            maximum_ok = b['heldOutMaxAbsoluteErrorMeters'] <= a['heldOutMaxAbsoluteErrorMeters']
            passed = reduction >= .20 and speedup >= 2. and maximum_ok
            gate.update(status='passed' if passed else 'failed', passed=passed,
                        measuredMedianErrorReduction=reduction, measuredEndToEndSpeedup=speedup,
                        maximumErrorDidNotIncrease=maximum_ok,
                        reason='Per-capture dimension/timing screen only. Repeated multi-capture trials and separate geometry/coverage review remain required.')


def write_markdown(path, report):
    lines = ['# Reconstruction comparison', '', f'Scope: {report["scope"]}', '',
             f'Capture SHA-256: `{report["captureSha256"]}`', '',
             '| Engine | Execution | Cold total seconds | Withheld spans available | Median error (cm) | Max error (cm) | Dimension/timing screen |',
             '|---|---|---:|---:|---:|---:|---|']
    if report.get('referenceBasis') == 'synthetic-fixture':
        lines[2:2] = ['**Synthetic harness fixture. No model inference or physical measurements.**', '']
    def number(value, multiplier=1.):
        return 'unavailable' if value is None else f'{value*multiplier:.3f}'
    for row in report['runs']:
        summary = row.get('measurementReport', {}).get('summary', {})
        available = (f'{summary["validHeldOutCount"]}/{summary["requestedHeldOutCount"]}' if summary else 'unscored')
        lines.append(f'| {row["engine"]} | {row["status"]} | {number(row.get("endToEndSeconds"))} | {available} | '
            f'{number(summary.get("heldOutMedianAbsoluteErrorMeters"), 100)} | '
            f'{number(summary.get("heldOutMaxAbsoluteErrorMeters"), 100)} | '
            f'{row.get("dimensionAndTimingGate", {}).get("status", "unavailable")} |')
    lines += ['', 'Engine promotion: **not approved**. '+report['promotion']['reason'], '',
        'Physical readings and their instrument metadata are self-reported. One calibration span sets scale; '
        'withheld spans never fit cameras or scale. Missing spans stay in the denominator.', '',
        'Cold total includes shared frame preparation plus each fresh engine process, checkpoint verification/loading '
        'and export. COLMAP uses CPU; VGGT uses CUDA. One run does not establish repeatable device speed.', '',
        'Pixel-landmark distances do not validate dense surfaces, compiled BIM, opening completeness, survey accuracy '
        'or physical robot execution. Inspect each arm\'s local engine.log and JSON evidence for details.', '']
    Path(path).write_text('\n'.join(lines), encoding='utf-8')


def self_test(out):
    """Exercise real scoring/receipts with authored cameras; never a model benchmark."""
    import numpy as np
    from PIL import Image, ImageDraw
    out = Path(out); out.mkdir(parents=True, exist_ok=False)
    photos = out / 'authored-input'; photos.mkdir()
    for index in range(3):
        image = Image.new('RGB', (640, 480), (30+index*30, 40, 60))
        draw = ImageDraw.Draw(image)
        for x in range(0, 640, 40):
            draw.line((x, 0, x, 479), fill=(180, 160, 120))
        for y in range(0, 480, 40):
            draw.line((0, y, 639, y), fill=(120, 160, 180))
        draw.text((20, 20), 'AUTHORED FIXTURE. NO MODEL INFERENCE.', fill='white')
        image.save(photos / f'{index:02d}.jpg')
    receipt = prepare(out=out / 'case', photos=photos, frames=3)
    points = [[-.8, -.5, 5], [.8, -.5, 5], [-.7, .4, 5.2], [.7, .4, 5.2], [0, -.7, 6], [0, .6, 6]]
    cameras = []
    landmarks = [{'id': f'p{i}', 'observations': []} for i in range(len(points))]
    for index, x in enumerate((-1., 0., 1.)):
        pose = [[1, 0, 0, -x], [0, 1, 0, 0], [0, 0, 1, 0]]
        name = receipt['frames'][index]['image']
        cameras.append({'image': name, 'width': 640, 'height': 480,
            'camera': {'model': 'PINHOLE', 'params': [500, 500, 319.5, 239.5], 'pixelConvention': 'integer-centres'},
            'cam_from_world': pose})
        for point, landmark in zip(points, landmarks):
            px, py, pz = point
            landmark['observations'].append({'image': name, 'xy': [500*(px-x)/pz+319.5, 500*py/pz+239.5]})
    pairs = [(0, 1), (0, 2), (0, 3), (0, 4), (1, 2), (1, 3), (2, 3), (4, 5)]
    marks = {'schema': 'brainsnn.comparison-annotations.v1', 'captureSha256': receipt['captureSha256'],
        'referenceBasis': 'synthetic-fixture', 'landmarks': landmarks,
        'spans': [{'id': f's{i}', 'label': f'Authored span {i}', 'role': 'calibration' if i == 0 else 'held-out',
            'landmarks': [f'p{a}', f'p{b}'], 'distanceMeters': float(np.linalg.norm(np.asarray(points[a])-points[b])),
            'uncertaintyMeters': 0., 'method': 'synthetic', 'instrument': 'Authored exact coordinates, no physical reading',
            'measuredOn': '2026-10-25'} for i, (a, b) in enumerate(pairs)], 'floorLandmarks': []}
    write_json(out / 'annotations.json', marks)
    run = out / 'run'; run.mkdir()
    rows = []
    for engine in ENGINES:
        target = run / engine; target.mkdir()
        write_json(target / 'cameras.json', {'schema': CAMERA_SCHEMA, 'coordinateFrame': 'synthetic-arbitrary',
            'metricVerified': False, 'frames': cameras})
        result = {'schema': 'brainsnn.comparison-engine.v1', 'captureSha256': receipt['captureSha256'],
            'engine': engine, 'status': 'completed', 'syntheticFixture': True, 'inferenceExecuted': False,
            'cameras': {'name': 'cameras.json', 'sha256': sha(target / 'cameras.json')}}
        write_json(target / 'engine-result.json', result)
        rows.append({'engine': engine, 'status': 'completed', 'endToEndSeconds': None,
                     'engineResultSha256': sha(target / 'engine-result.json')})
    write_json(run / 'run.json', {'schema': RUN_SCHEMA, 'captureSha256': receipt['captureSha256'],
        'annotationsPredeclared': True, 'annotationSha256': hashlib.sha256(canonical(marks)).hexdigest(),
        'syntheticFixture': True, 'inferenceExecuted': False, 'runs': rows})
    result = score_run(case=out / 'case', run=run, annotations=out / 'annotations.json')
    result['syntheticFixture'] = True; result['inferenceExecuted'] = False
    write_json(run / 'comparison.json', result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare', help='Freeze one shared frame set from a local video or photo directory')
    source = prep.add_mutually_exclusive_group(required=True)
    source.add_argument('--video', type=Path); source.add_argument('--photos', type=Path)
    prep.add_argument('--out', type=Path, required=True); prep.add_argument('--frames', type=int, default=32)
    run = sub.add_parser('run', help='Run fresh sequential engine processes; failures remain in run.json')
    run.add_argument('--case', type=Path, required=True); run.add_argument('--out', type=Path, required=True)
    run.add_argument('--engines', choices=ENGINES, nargs='+', default=list(ENGINES))
    run.add_argument('--vggt-source', type=Path); run.add_argument('--vggt-checkpoint', type=Path)
    run.add_argument('--timeout', type=int, default=1800); run.add_argument('--python', default=sys.executable)
    run.add_argument('--annotations', type=Path, help='Freeze predeclared independent references and score after running')
    score = sub.add_parser('score', help='Score bound camera evidence; never refit on withheld measurements')
    score.add_argument('--case', required=True, type=Path); score.add_argument('--run', required=True, type=Path)
    score.add_argument('--annotations', required=True, type=Path)
    check = sub.add_parser('self-test', help='Authored geometry only; no model inference or physical accuracy claim')
    check.add_argument('--out', required=True, type=Path)
    preflight = sub.add_parser('preflight', help='Verify local approved commercial checkpoint and clean pinned source')
    preflight.add_argument('--vggt-source', required=True, type=Path)
    preflight.add_argument('--vggt-checkpoint', required=True, type=Path)
    worker = sub.add_parser('_engine', help=argparse.SUPPRESS)
    worker.add_argument('--case', required=True, type=Path); worker.add_argument('--out', required=True, type=Path)
    worker.add_argument('--engine', required=True, choices=ENGINES)
    worker.add_argument('--vggt-source', type=Path); worker.add_argument('--vggt-checkpoint', type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == 'prepare':
            result = prepare(out=args.out, frames=args.frames, video=args.video, photos=args.photos)
        elif args.command == 'run':
            result = execute(case=args.case, out=args.out, engines=args.engines, vggt_source=args.vggt_source,
                vggt_checkpoint=args.vggt_checkpoint, timeout=args.timeout, python=args.python, annotations=args.annotations)
        elif args.command == 'score':
            result = score_run(case=args.case, run=args.run, annotations=args.annotations)
        elif args.command == 'self-test':
            result = self_test(args.out)
        elif args.command == 'preflight':
            from . import comparison_vggt
            result = comparison_vggt.preflight(args.vggt_source.resolve(), args.vggt_checkpoint.resolve())
        else:
            engine_main(args); return 0
        if args.command == 'prepare':
            visible = {'case': str(args.out.resolve()), 'captureSha256': result['captureSha256'],
                       'frames': len(result['frames']), 'annotations': 'Use annotate.html through a local HTTP server.'}
        elif args.command == 'run':
            visible = {'report': str((args.out / 'comparison.md').resolve()),
                       'runs': [{k: row[k] for k in ('engine', 'status', 'coldWallSeconds')} for row in result['runs']]}
        elif args.command in ('score', 'self-test'):
            directory = args.run if args.command == 'score' else args.out / 'run'
            visible = {'report': str((directory / 'comparison.md').resolve()),
                'syntheticFixture': result.get('syntheticFixture', False),
                'runs': [{'engine': row['engine'], 'status': row['status'],
                          'summary': row.get('measurementReport', {}).get('summary')} for row in result['runs']],
                'promotion': result['promotion']}
        else:
            visible = result
        print(json.dumps(visible, allow_nan=False, indent=2))
        if args.command == 'run' and any(row['status'] != 'completed' for row in result['runs']):
            return 2
        return 0
    except (ValueError, RuntimeError, OSError, ImportError, subprocess.SubprocessError) as error:
        print(f'Comparison error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
