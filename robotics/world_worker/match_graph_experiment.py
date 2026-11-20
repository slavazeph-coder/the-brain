"""Frozen CPU correspondences and classical replay, separate from production.

DeepBA is not implemented here. These commands prepare a source-bound graph
before any solve, then run the existing classical solver on a private DB copy.
They do not execute learned weights, certify geometry or change engine defaults.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import shutil
import sys
import time

from . import reconstruction_comparison as rc

RUN_SCHEMA = 'brainsnn.match-graph-execution.v1'
PREPARE_SCHEMA = 'brainsnn.match-graph-preparation-result.v1'
REPLAY_SCHEMA = 'brainsnn.match-graph-replay-result.v1'
PYCOLMAP_VERSION = '4.2.1'
SOURCES = ('match_graph_experiment.py', 'correspondence_graph.py',
           'reconstruction_comparison.py', 'sparse_colmap.py', 'geometry.py',
           'comparison_measurements.py', 'requirements-colmap.txt')
CLAIMS = {'deepbaExecuted': False, 'paperBenchmarkReproduced': False,
          'metricVerified': False, 'surveyAccuracyValidated': False,
          'bimDimensionsValidated': False, 'physicalRobotValidated': False,
          'productionPromotionApproved': False}


def code_signature():
    root = Path(__file__).parent
    return {name: rc.sha(root / name) for name in SOURCES}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _clock():
    return time.monotonic()


def status():
    return {'schema': 'brainsnn.deepba-integration-status.v1',
            'integrationAvailable': False, 'inferenceExecuted': False,
            'status': 'not-integrated-in-this-build',
            'observedAt': '2026-11-16',
            'reason': 'Official executable code, checkpoint and license were pending at review. Recheck the original project before implementing an adapter.',
            'paper': 'https://arxiv.org/abs/2611.18256',
            'project': 'https://cphjsn.github.io/deep-ba/',
            'availableTools': ['prepare', 'inspect', 'replay-colmap'],
            **CLAIMS}


def _finite_seconds(value, label):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError(f'{label} must be finite nonnegative seconds.')
    return float(value)


def _timeout(value):
    value = _finite_seconds(value, 'Timeout')
    if not 1 <= value <= 7200:
        raise ValueError('Timeout must be from 1 to 7200 seconds.')
    return value


def _pack_path(value):
    path = Path(value)
    if path.is_symlink():
        raise ValueError('Use a regular match-pack directory, not a symlink.')
    return path.resolve()


def _json_options(value):
    """Keep actual pinned native defaults, including enum names, as JSON."""
    if value is None or type(value) in (str, bool, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError('Native matching options must be finite.')
        return value
    if isinstance(value, dict):
        return {str(k): _json_options(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_options(v) for v in value]
    if hasattr(value, 'name') and isinstance(value.name, str):
        return value.name
    raise ValueError(f'Unsupported native option type: {type(value).__name__}')


def _dependencies():
    import pycolmap
    import numpy as np
    if pycolmap.__version__ != PYCOLMAP_VERSION:
        raise RuntimeError(f'Install pycolmap=={PYCOLMAP_VERSION}; no substitute solver is used.')
    return {'pycolmap': pycolmap.__version__, 'numpy': np.__version__,
            'Pillow': importlib.metadata.version('Pillow'), 'python': platform.python_version()}


def _device():
    return {'type': 'cpu', 'threads': 2, 'processor': platform.processor(),
            'logicalCpuCount': os.cpu_count()}


def _rss():
    try:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(peak if sys.platform == 'darwin' else peak * 1024)
    except ImportError:
        return None


def _prepare_child(case, out):
    from . import correspondence_graph as graph
    import pycolmap
    receipt = rc.validate_capture(case)
    signature = code_signature()
    dependencies = _dependencies()
    started = time.monotonic()
    native = Path(out) / 'native'
    native.mkdir()
    database = native / 'database.db'
    images = Path(case) / 'frames'
    extraction = pycolmap.FeatureExtractionOptions({'num_threads': 2, 'max_image_size': 1280,
                                                    'sift': {'max_num_features': 4096}})
    matching = pycolmap.FeatureMatchingOptions({'num_threads': 2})
    pairing = pycolmap.ExhaustivePairingOptions()
    verification = pycolmap.TwoViewGeometryOptions()
    verification.ransac.random_seed = 0
    pycolmap.set_random_seed(0)
    reader = pycolmap.ImageReaderOptions({'camera_model': 'SIMPLE_RADIAL'})
    settings = {'method': 'exhaustive', 'threads': 2, 'maxImageSize': 1280,
                'maxSiftFeatures': 4096, 'cameraModel': 'SIMPLE_RADIAL',
                'seed': 0,
                'cameraMode': 'AUTO', 'pixelConvention': 'colmap-half-pixel',
                'featureExtractionOptions': _json_options(extraction.todict()),
                'matchingOptions': _json_options(matching.todict()),
                'pairingOptions': _json_options(pairing.todict()),
                'verificationOptions': _json_options(verification.todict()),
                'readerOptions': _json_options(reader.todict())}
    extraction_started = time.monotonic()
    pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.AUTO,
                             reader_options=reader, extraction_options=extraction,
                             device=pycolmap.Device.cpu)
    extracted = time.monotonic()
    pycolmap.match_exhaustive(database, matching_options=matching, pairing_options=pairing,
                             verification_options=verification, device=pycolmap.Device.cpu)
    matched = time.monotonic()
    # Both native calls have closed their DB handles before the immutable copy.
    rc.validate_capture(case)
    metadata = {'schema': 'brainsnn.matching-preparation.v1',
                'origin': 'fresh-cpu-sift-before-solve',
                'captureSha256': receipt['captureSha256'], 'databaseSha256': rc.sha(database),
                'settings': settings, 'dependencies': dependencies, 'device': _device(),
                'featureExtractionSeconds': extracted - extraction_started,
                'matchingSeconds': matched - extracted, 'totalSeconds': matched - started,
                'implementation': signature, 'preparedAt': now()}
    exporting = time.monotonic()
    manifest = graph.build_pack(case=case, database=database, out=Path(out) / 'pack', matching=metadata)
    exported = time.monotonic()
    rc.validate_capture(case)
    if code_signature() != signature:
        raise ValueError('Experiment implementation changed during preparation.')
    result = {'schema': PREPARE_SCHEMA, 'captureSha256': receipt['captureSha256'],
              'codeSignature': signature, 'packManifestSha256': rc.sha(Path(out) / 'pack' / 'manifest.json'),
              'stagesSeconds': {'featureExtraction': metadata['featureExtractionSeconds'],
                               'matching': metadata['matchingSeconds'],
                               'matchingFrontendTotal': metadata['totalSeconds'],
                               'packExport': exported - exporting},
              'databaseSha256': manifest['artifacts']['database']['sha256'],
              'device': _device(), 'dependencies': dependencies, 'peakProcessRssBytes': _rss(),
              'peakProcessRssScope': 'This fresh child process including native allocations; excludes other processes.',
              **CLAIMS}
    rc.write_json(Path(out) / 'preparation-result.json', result)


def _front_end_cost(pack, manifest):
    """Complete cold cost exists only with the retained, bound preparation run."""
    pack = Path(pack)
    cost = {'matchingInternalSeconds': _finite_seconds(manifest['matching']['totalSeconds'], 'Matching time'),
            'matchingPreparationColdWallSeconds': None, 'matchingPreparationOperationWallSeconds': None,
            'matchingPreparationParentOverheadSeconds': None, 'matchingPreparationReceiptSha256': None}
    path = pack.parent / 'run.json'
    if not path.exists():
        return cost
    saved = rc.read_json(path)
    if saved.get('schema') != RUN_SCHEMA or saved.get('action') != 'prepare':
        return cost
    if saved.get('status') != 'completed' or saved.get('captureSha256') != manifest['captureSha256'] \
            or saved.get('packManifestSha256') != rc.sha(pack / 'manifest.json'):
        raise ValueError('Preparation receipt is not bound to this completed match pack.')
    process = saved.get('childProcess', {})
    if process.get('status') != 'completed' or process.get('exitCode') != 0:
        raise ValueError('Preparation process did not complete successfully.')
    cold = _finite_seconds(process.get('coldWallSeconds'), 'Matching preparation cold time')
    if cold < cost['matchingInternalSeconds']:
        raise ValueError('Preparation cold time cannot exclude its matching work.')
    operation = _finite_seconds(saved.get('operationWallSeconds'), 'Matching preparation operation time')
    if operation < cold:
        raise ValueError('Preparation operation time cannot exclude its child process.')
    result = saved.get('result', {})
    if result.get('name') != 'preparation-result.json' or rc.sha(pack.parent / result['name']) != result.get('sha256'):
        raise ValueError('Preparation result changed after execution.')
    detail = rc.read_json(pack.parent / result['name'])
    if detail.get('schema') != PREPARE_SCHEMA or detail.get('packManifestSha256') != saved['packManifestSha256'] \
            or detail.get('captureSha256') != manifest['captureSha256']:
        raise ValueError('Preparation detail belongs to a different match pack.')
    cost.update(matchingPreparationColdWallSeconds=cold, matchingPreparationOperationWallSeconds=operation,
                matchingPreparationParentOverheadSeconds=operation-cold, matchingPreparationReceiptSha256=rc.sha(path))
    return cost


def _replay_child(case, pack, out):
    from . import correspondence_graph as graph
    from . import sparse_colmap
    from .geometry import write_point_cloud
    import numpy as np
    import pycolmap
    receipt = rc.validate_capture(case)
    signature = code_signature()
    dependencies = _dependencies()
    loaded = graph.load_pack(case=case, pack=pack)
    manifest = loaded['manifest']
    frozen_db = Path(pack) / manifest['artifacts']['database']['name']
    frozen_before = rc.sha(frozen_db)
    native = Path(out) / 'native'
    native.mkdir()
    copied = native / 'database.db'
    shutil.copyfile(frozen_db, copied)
    if rc.sha(copied) != frozen_before:
        raise ValueError('Solver-private database does not match the frozen graph.')
    started = time.monotonic()
    count = len(receipt['frames'])
    models, index, model, attempts = sparse_colmap.map_frames(copied, Path(case) / 'frames', native, count)
    solved = time.monotonic()
    if model.num_reg_images() < 3 or model.num_points3D() < 30:
        raise ValueError('COLMAP replay reconstructed fewer than three cameras or 30 points.')
    consistency = {'status': 'not-checked', 'reason': 'Unordered photographs have no filming order.'}
    if len(receipt['sources']) == 1 and receipt['sources'][0]['kind'] == 'video':
        opened = pycolmap.Database.open(str(copied))
        try:
            names = [r['image'] for r in receipt['frames']]
            consistency = sparse_colmap.fold_check(*sparse_colmap.consecutive_turns(opened, model, names))
        finally:
            opened.close()
    model.extract_colors_for_all_images(Path(case) / 'frames', num_threads=2)
    frames = []
    for image_id in sorted(model.reg_image_ids()):
        image = model.image(image_id)
        camera = model.camera(image.camera_id)
        frames.append({'image': image.name, 'width': camera.width, 'height': camera.height,
                       'camera': {'model': camera.model_name, 'params': camera.params.tolist(),
                                  'pixelConvention': 'colmap-half-pixel'},
                       'cam_from_world': image.cam_from_world().matrix().tolist()})
    cameras = {'schema': rc.CAMERA_SCHEMA, 'coordinateFrame': 'colmap-arbitrary',
               'metricVerified': False, 'frames': frames}
    rc.write_json(Path(out) / 'cameras.json', cameras)
    points = sorted(model.points3D.items())
    step = max(1, math.ceil(len(points) / 100_000))
    retained = [p for _, p in points[::step]]
    preview = write_point_cloud(Path(out) / 'points.ply', np.asarray([p.xyz for p in retained]),
                                np.asarray([p.color for p in retained]), coordinate_frame='colmap')
    preview.update(bytes=(Path(out) / 'points.ply').stat().st_size, sha256=rc.sha(Path(out) / 'points.ply'))
    exported = time.monotonic()
    graph.load_pack(case=case, pack=pack)
    if rc.sha(frozen_db) != frozen_before:
        raise ValueError('Frozen database changed during solver execution.')
    rc.validate_capture(case)
    if code_signature() != signature:
        raise ValueError('Experiment implementation changed during replay.')
    result = {'schema': REPLAY_SCHEMA, 'captureSha256': receipt['captureSha256'],
              'packManifestSha256': rc.sha(Path(pack) / 'manifest.json'), 'codeSignature': signature,
              'solver': 'Existing pinned CPU COLMAP incremental mapping from the full verified graph',
              'inputFrames': count, 'registeredFrames': len(frames),
              'registrationFraction': len(frames) / count,
              'missingFrames': [r['image'] for r in receipt['frames'] if r['image'] not in {f['image'] for f in frames}],
              'modelsFound': len(models), 'selectedModel': index, 'mappingAttempts': attempts,
              'captureConsistency': consistency, 'points': model.num_points3D(), 'preview': preview,
              'internalMeanReprojectionErrorPixels': model.compute_mean_reprojection_error(),
              'stagesSeconds': {'solve': solved - started, 'exportAndFoldCheck': exported - solved},
              'frozenDatabaseBeforeSha256': frozen_before, 'frozenDatabaseAfterSha256': rc.sha(frozen_db),
              'solverCopyBeforeSha256': frozen_before, 'solverCopyAfterSha256': rc.sha(copied),
              'matchingFrontend': _front_end_cost(pack, manifest),
              'cameras': {'name': 'cameras.json', 'bytes': (Path(out) / 'cameras.json').stat().st_size,
                          'sha256': rc.sha(Path(out) / 'cameras.json')},
              'device': _device(), 'dependencies': dependencies, 'peakProcessRssBytes': _rss(),
              'peakProcessRssScope': 'This fresh child process including native allocations; excludes other processes.',
              **CLAIMS}
    rc.write_json(Path(out) / 'replay-result.json', result)


def _environment():
    return {**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
            'HF_DATASETS_OFFLINE': '1', 'PYTHONHASHSEED': '0', 'PYTHONUNBUFFERED': '1',
            'WORLD_CPU_THREADS': '2',
            'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2', 'MKL_NUM_THREADS': '2'}


def _save(root, value):
    temporary = root / 'run.pending.json'
    rc.write_json(temporary, value)
    temporary.replace(root / 'run.json')


def _execute(action, *, case, out, timeout=1800, pack=None):
    operation_started = _clock()
    from . import correspondence_graph as graph
    timeout = _timeout(timeout)
    case = Path(case).resolve()
    receipt = rc.validate_capture(case)
    pack = _pack_path(pack) if pack is not None else None
    manifest = graph.load_pack(case=case, pack=pack)['manifest'] if pack is not None else None
    signature = code_signature()
    root = Path(out)
    if root.is_symlink():
        raise ValueError('Use a fresh regular output directory.')
    root.mkdir(parents=True, exist_ok=False)
    root = root.resolve()
    run = {'schema': RUN_SCHEMA, 'action': action, 'status': 'running', 'startedAt': now(),
           'captureSha256': receipt['captureSha256'], 'captureReceiptSha256': rc.sha(case / 'capture.json'),
           'codeSignature': signature, 'timeoutSeconds': timeout, 'device': _device(), **CLAIMS}
    if pack is not None:
        run['packManifestSha256'] = rc.sha(pack / 'manifest.json')
    _save(root, run)
    command = [sys.executable, '-m', 'robotics.world_worker.match_graph_experiment',
               '_prepare' if action == 'prepare' else '_replay', '--case', str(case), '--out', str(root)]
    if pack is not None:
        command += ['--pack', str(pack)]
    try:
        process = rc.bounded_process(command, root / 'execution.log', timeout=timeout, env=_environment())
        run['childProcess'] = process
        if process['status'] != 'completed' or process['exitCode'] != 0:
            raise RuntimeError(f'Fresh CPU child did not complete: {process["status"]}; inspect execution.log.')
        rc.validate_capture(case)
        if code_signature() != signature:
            raise ValueError('Experiment implementation changed during execution.')
        filename = 'preparation-result.json' if action == 'prepare' else 'replay-result.json'
        result = rc.read_json(root / filename)
        if result.get('schema') != (PREPARE_SCHEMA if action == 'prepare' else REPLAY_SCHEMA) \
                or result.get('captureSha256') != receipt['captureSha256'] \
                or result.get('codeSignature') != signature \
                or any(result.get(k) is not False for k in CLAIMS):
            raise ValueError('CPU result has an invalid source, implementation or qualification binding.')
        active_pack = root / 'pack' if action == 'prepare' else pack
        loaded = graph.load_pack(case=case, pack=active_pack)
        graph_sha = rc.sha(active_pack / 'manifest.json')
        if result.get('packManifestSha256') != graph_sha:
            raise ValueError('CPU result is not bound to the frozen match pack.')
        run['packManifestSha256'] = graph_sha
        if action == 'prepare':
            stages = result.get('stagesSeconds', {})
            expected = loaded['manifest']['matching']
            if result.get('databaseSha256') != loaded['manifest']['artifacts']['database']['sha256']:
                raise ValueError('Preparation result does not match its database bytes.')
            for actual, key in (('featureExtraction', 'featureExtractionSeconds'), ('matching', 'matchingSeconds'),
                                ('matchingFrontendTotal', 'totalSeconds')):
                if _finite_seconds(stages.get(actual), actual) != expected[key]:
                    raise ValueError('Preparation timing does not match the frozen matching receipt.')
            exported = _finite_seconds(stages.get('packExport'), 'Graph export time')
            if _finite_seconds(process['coldWallSeconds'], 'Preparation cold wall time') + 1e-6 < expected['totalSeconds'] + exported:
                raise ValueError('Preparation cold time cannot exclude matching and graph export.')
        if action == 'replay-colmap':
            from . import comparison_measurements as measurements
            cameras = rc.read_json(root / 'cameras.json')
            measurements._cameras(cameras, measurements._frames(receipt))
            if result.get('cameras', {}).get('sha256') != rc.sha(root / 'cameras.json'):
                raise ValueError('Camera bytes changed after solver export.')
            registered = len(cameras['frames'])
            names = {f['image'] for f in cameras['frames']}
            missing = [r['image'] for r in receipt['frames'] if r['image'] not in names]
            if result.get('inputFrames') != len(receipt['frames']) or result.get('registeredFrames') != registered \
                    or result.get('registrationFraction') != registered / len(receipt['frames']) \
                    or result.get('missingFrames') != missing:
                raise ValueError('Replay registration denominator does not match the camera evidence.')
            stages = result.get('stagesSeconds', {})
            for key in ('solve', 'exportAndFoldCheck'):
                _finite_seconds(stages.get(key), key)
            preview = result.get('preview', {})
            if preview.get('name') != 'points.ply' or preview.get('sha256') != rc.sha(root / 'points.ply') \
                    or preview.get('bytes') != (root / 'points.ply').stat().st_size:
                raise ValueError('Preview bytes changed after solver export.')
            db_sha = loaded['manifest']['artifacts']['database']['sha256']
            if result.get('frozenDatabaseBeforeSha256') != db_sha or result.get('frozenDatabaseAfterSha256') != db_sha:
                raise ValueError('Replay did not preserve the frozen source database.')
            if result.get('solverCopyBeforeSha256') != db_sha or result.get('solverCopyAfterSha256') != rc.sha(root / 'native' / 'database.db'):
                raise ValueError('Replay private database copy is not bound to its source and result.')
            front = _front_end_cost(pack, loaded['manifest'])
            if result.get('matchingFrontend') != front:
                raise ValueError('Replay matching cost is not bound to the preparation receipt.')
            cold = _finite_seconds(process['coldWallSeconds'], 'Replay cold wall time')
            run['timing'] = {**front, 'replayColdWallSeconds': cold,
                             'framePreparationSeconds': receipt['preparation']['elapsedSeconds'],
                             'recordedMatchingInternalPlusReplayColdSeconds': front['matchingInternalSeconds'] + cold,
                             'fromPreparedFramesWallSeconds': None,
                             'fromOriginalCaptureWallSeconds': None,
                             'scope': 'Sum of separately measured sequential parent operations, from before input validation through post-child validation, excluding parent interpreter/CLI startup, each final run-receipt serialization and manual gaps. Complete totals require the bound preparation run. Original-capture total adds rc.prepare recorded frame-preparation elapsed, not phone recording, annotation, installation or an independently timed entire workflow. Internal-only subtotal excludes parent validation, graph serialization and process overhead. OS caches are not flushed.'}
        run.update(status='completed', result={'name': filename, 'sha256': rc.sha(root / filename)})
        if action == 'replay-colmap':
            folded = result.get('captureConsistency', {}).get('status') == 'folded'
            run['geometryScreen'] = {'status': 'requires-review' if folded else 'no-fold-detected' if result.get('captureConsistency', {}).get('status') == 'consistent' else 'not-assessed',
                                     'scope': 'Existing consecutive-frame match/model fold screen only; no physical dimension or surface validation.'}
            if folded:
                run['status'] = 'requires-review'
    except BaseException as error:
        run.update(status='interrupted' if isinstance(error, KeyboardInterrupt) else 'failed',
                   error=f'{type(error).__name__}: {error}'[:1500])
        rc.write_json(root / 'failure.json', {'schema': 'brainsnn.match-graph-failure.v1',
                      'action': action, 'captureSha256': receipt['captureSha256'],
                      'status': run['status'], 'reason': run['error'], **CLAIMS})
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
    finally:
        operation = _clock() - operation_started
        run['operationWallSeconds'] = operation
        run['operationWallScope'] = 'Python API entry after CLI imports/argument parsing, before input validation through post-child validation; excludes parent interpreter/CLI startup, final run-receipt serialization and manual gaps.'
        if 'childProcess' in run:
            try:
                child_cold = _finite_seconds(run['childProcess']['coldWallSeconds'], 'Child cold wall time')
                if operation < child_cold:
                    raise ValueError('Operation wall time cannot exclude its child process.')
                run['parentOverheadSeconds'] = operation - child_cold
            except ValueError as error:
                run['parentOverheadSeconds'] = None
                run['timingValidationError'] = str(error)
                if run['status'] in ('completed', 'requires-review'):
                    run.update(status='failed', error=str(error))
                    run.pop('result', None)
                    rc.write_json(root / 'failure.json', {'schema': 'brainsnn.match-graph-failure.v1',
                                  'action': action, 'captureSha256': receipt['captureSha256'],
                                  'status': 'failed', 'reason': str(error), **CLAIMS})
        if action == 'replay-colmap' and 'timing' in run:
            timing = run['timing']
            timing['replayOperationWallSeconds'] = operation
            timing['replayParentOverheadSeconds'] = run.get('parentOverheadSeconds')
            complete = timing['matchingPreparationOperationWallSeconds']
            if complete is not None:
                timing['fromPreparedFramesWallSeconds'] = complete + operation
                timing['fromOriginalCaptureWallSeconds'] = receipt['preparation']['elapsedSeconds'] + complete + operation
        run['finishedAt'] = now()
        _save(root, run)
    return run


def prepare(*, case, out, timeout=1800):
    return _execute('prepare', case=case, out=out, timeout=timeout)


def replay_colmap(*, case, pack, out, timeout=1800):
    return _execute('replay-colmap', case=case, pack=pack, out=out, timeout=timeout)


def inspect_pack(*, case, pack):
    from . import correspondence_graph as graph
    pack = _pack_path(pack)
    loaded = graph.load_pack(case=Path(case).resolve(), pack=pack)
    return {'schema': 'brainsnn.match-graph-inspection.v1',
            'captureSha256': loaded['manifest']['captureSha256'],
            'packManifestSha256': rc.sha(Path(pack) / 'manifest.json'),
            'audit': loaded['audit'], 'matching': loaded['manifest']['matching'], **CLAIMS}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('status', help='Describe the observed, unintegrated DeepBA research candidate')
    for name in ('prepare', 'replay-colmap', '_prepare', '_replay', 'inspect'):
        command = sub.add_parser(name, help=argparse.SUPPRESS if name.startswith('_') else None)
        command.add_argument('--case', type=Path, required=True)
        if name != 'inspect':
            command.add_argument('--out', type=Path, required=True)
        if name in ('replay-colmap', '_replay', 'inspect'):
            command.add_argument('--pack', type=Path, required=True)
        if name in ('prepare', 'replay-colmap'):
            command.add_argument('--timeout', type=float, default=1800)
    args = parser.parse_args(argv)
    try:
        if args.command == 'status':
            result = status()
        elif args.command == 'inspect':
            result = inspect_pack(case=args.case, pack=args.pack)
        elif args.command.startswith('_'):
            os.environ['WORLD_CPU_THREADS'] = '2'
            sys.addaudithook(rc._deny_network)
            if args.command == '_prepare':
                _prepare_child(args.case, args.out)
            else:
                _replay_child(args.case, args.pack, args.out)
            return 0
        elif args.command == 'prepare':
            result = prepare(case=args.case, out=args.out, timeout=args.timeout)
        else:
            result = replay_colmap(case=args.case, pack=args.pack, out=args.out, timeout=args.timeout)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 2 if result.get('status') == 'requires-review' else 1 if result.get('status') in ('failed', 'interrupted') else 0
    except KeyboardInterrupt:
        return 130
    except (ValueError, RuntimeError, OSError, ImportError) as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
