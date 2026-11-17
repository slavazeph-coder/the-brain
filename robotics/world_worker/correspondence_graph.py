"""Frozen, source-bound pair correspondences for offline solver experiments.

This format is a BrainSNN interchange, not an unpublished DeepBA input API.
It preserves COLMAP's half-pixel image coordinates and all prepared frames. No
solved absolute poses, reconstructed points, track merging or physical
qualification is added. The frozen database retains relative two-view RANSAC
verification geometry; the portable numeric arrays contain only 2D matches.
Hashes detect inconsistent retained data; they are not signed attestations.
"""
from __future__ import annotations

import json
from fractions import Fraction
import math
from pathlib import Path
import shutil
import sqlite3
import time
from urllib.parse import quote
import zipfile

import numpy as np

from . import reconstruction_comparison as rc

SCHEMA = 'brainsnn.correspondence-pack.v1'
AUDIT_SCHEMA = 'brainsnn.view-graph-audit.v1'
PAIR_BASE = 2_147_483_647
MAX_DATABASE_BYTES = 2 * 1024**3
MAX_ARRAY_BYTES = 64 * 1024**2
MAX_KEYPOINTS = 100_000
MAX_MATCHES = 1_000_000
MAX_PAIRS = 1770
PAPER_MIN_MATCHES = 50
ARRAY_DTYPES = {'view_pairs': '<i8', 'pair_offsets': '<i8', 'feature_indices': '<u4',
                'xy': '<f4', 'pair_configs': '<i8'}
CLAIMS = {'deepbaExecuted': False, 'metricVerified': False,
          'physicalAccuracyVerified': False, 'parallaxVerified': False,
          'bimValidated': False, 'robotValidated': False}
INTEGRITY = 'Hashes bind retained files; they are not signed attestations against rewriting the entire history.'
FRAME_FIELDS = {'image', 'sha256', 'bytes', 'width', 'height', 'sourceIndex', 'sourceFrameIndex',
                'pts', 'timeBase', 'sourceWidth', 'sourceHeight', 'exifOrientation', 'sourceToFramePixelCenter'}
CONFIGURATIONS = {0: 'UNDEFINED', 1: 'DEGENERATE', 2: 'CALIBRATED', 3: 'UNCALIBRATED',
                  4: 'PLANAR', 5: 'PANORAMIC', 6: 'PLANAR_OR_PANORAMIC', 7: 'WATERMARK',
                  8: 'MULTIPLE', 9: 'CALIBRATED_RIG'}


def _same(value, expected, message):
    if rc.canonical(value) != rc.canonical(expected):
        raise ValueError(message)


def _keys(value, allowed, required, label):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise ValueError(f'Invalid {label} fields.')


def _regular(path, limit):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 1 <= path.stat().st_size <= limit:
        raise ValueError('Expected a bounded nonempty regular file, without a symlink.')
    return path


def _closed_database(path):
    path = _regular(path, MAX_DATABASE_BYTES)
    for suffix in ('-wal', '-journal', '-shm'):
        sidecar = Path(str(path) + suffix)
        if sidecar.is_symlink() or sidecar.exists() and sidecar.stat().st_size:
            raise ValueError('Close and checkpoint the database before freezing it; live SQLite sidecars are refused.')
    return path


def _artifact(path):
    return {'name': path.name, 'bytes': path.stat().st_size, 'sha256': rc.sha(path)}


def _matching(value, capture_sha, database_sha):
    required = ('schema', 'origin', 'captureSha256', 'databaseSha256', 'settings', 'dependencies',
                'device', 'featureExtractionSeconds', 'matchingSeconds', 'totalSeconds')
    _keys(value, (*required, 'implementation', 'preparedAt'), required, 'fresh matching provenance')
    _same(value['schema'], 'brainsnn.matching-preparation.v1', 'Unknown matching provenance schema.')
    _same(value['origin'], 'fresh-cpu-sift-before-solve', 'A pack requires fresh CPU matching before any solve.')
    _same(value['captureSha256'], capture_sha, 'Matching belongs to a different capture.')
    _same(value['databaseSha256'], database_sha, 'Matching database bytes changed before freezing.')
    if not isinstance(value['settings'], dict) or not value['settings'] or not isinstance(value['dependencies'], dict) \
            or not isinstance(value['device'], dict) or value['device'].get('type') != 'cpu':
        raise ValueError('Matching settings, dependencies and actual CPU device evidence are required.')
    for name in ('featureExtractionSeconds', 'matchingSeconds', 'totalSeconds'):
        n = value[name]
        if isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or not 0 <= n <= 86_400:
            raise ValueError('Matching timings must be finite nonnegative measured seconds.')
    if value['totalSeconds'] + 1e-9 < value['featureExtractionSeconds'] + value['matchingSeconds']:
        raise ValueError('Matching total must include feature extraction and matching.')
    if 'implementation' in value and not isinstance(value['implementation'], dict):
        raise ValueError('Implementation provenance must be a JSON object.')
    if 'preparedAt' in value and (not isinstance(value['preparedAt'], str) or not 1 <= len(value['preparedAt']) <= 128):
        raise ValueError('Invalid preparation timestamp.')
    # A JSON round trip detaches the caller and rejects nonfinite or non-JSON metadata.
    encoded = rc.canonical(value)
    if len(encoded) > 256 * 1024:
        raise ValueError('Matching metadata exceeds its byte budget.')
    return json.loads(encoded)


def _integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'Invalid {label}.')
    return value


def _read_database(database, capture):
    """Read only the bounded feature/verified-pair tables, never solved geometry."""
    path = _closed_database(database)
    digest = rc.sha(path)
    uri = 'file:' + quote(str(path.resolve()), safe='/') + '?mode=ro&immutable=1'
    connection = sqlite3.connect(uri, uri=True)
    try:
        deadline = time.monotonic() + 30
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)
        connection.execute('PRAGMA query_only=ON')
        connection.execute('PRAGMA trusted_schema=OFF')
        schema = connection.execute('SELECT name, type FROM sqlite_master LIMIT 257').fetchall()
        if len(schema) > 256:
            raise ValueError('Unexpectedly large correspondence database schema.')
        if any(kind == 'view' for _, kind in schema):
            raise ValueError('Native correspondence databases must not contain views.')
        tables = {name for name, kind in schema if kind == 'table'}
        if not {'cameras', 'images', 'keypoints', 'two_view_geometries'} <= tables:
            raise ValueError('Required native correspondence objects must be real tables, not views.')
        if 'pose_priors' in tables and connection.execute('SELECT 1 FROM pose_priors LIMIT 1').fetchone():
            raise ValueError('Cold-start correspondence packs cannot include position or gravity pose priors.')
        if {name.lower() for name in tables} & {'points3d', 'points3d_tracks', 'reconstructions', 'reconstructed_points', 'camera_poses'}:
            raise ValueError('Solved pose or reconstructed-point tables are not cold-start correspondence inputs.')
        frame_rows = capture['frames']
        if any(set(row) - FRAME_FIELDS for row in frame_rows):
            raise ValueError('Unrecognized frame metadata cannot enter a cold-start correspondence pack.')
        by_name = {row['image']: i for i, row in enumerate(frame_rows)}
        cameras = {}
        rows = connection.execute('SELECT camera_id, model, width, height, length(params), prior_focal_length FROM cameras LIMIT ?',
                                  (len(frame_rows) + 1,)).fetchall()
        if len(rows) > len(frame_rows):
            raise ValueError('Database contains too many camera records.')
        for camera_id, model, width, height, size, prior in rows:
            _integer(camera_id, 1, PAIR_BASE - 1, 'database camera ID')
            if camera_id in cameras:
                raise ValueError('Database camera IDs must be unique.')
            _integer(model, 0, 64, 'database camera-model ID')
            _integer(width, 256, 1280, 'camera raster width')
            _integer(height, 256, 1280, 'camera raster height')
            if type(size) is not int or not 8 <= size <= 64 * 8 or size % 8 or prior not in (0, 1):
                raise ValueError('Invalid initial camera parameters.')
            blob = connection.execute('SELECT params FROM cameras WHERE camera_id=?', (camera_id,)).fetchone()[0]
            params = np.frombuffer(blob, dtype='<f8')
            if not np.isfinite(params).all() or params[0] <= 0:
                raise ValueError('Camera priors must contain finite parameters and a positive focal parameter.')
            cameras[camera_id] = {'cameraId': camera_id, 'modelId': model, 'width': width, 'height': height,
                                  'params': params.tolist(), 'priorFocalLength': bool(prior),
                                  'role': 'initial-database-prior-unverified', 'pixelConvention': 'colmap-half-pixel'}
        images = connection.execute('SELECT image_id, name, camera_id FROM images LIMIT ?', (len(frame_rows) + 1,)).fetchall()
        if len(images) != len(frame_rows) or {row[1] for row in images} != set(by_name):
            raise ValueError('Database must contain the exact complete prepared-frame set, including isolated views.')
        keypoint_ids = [row[0] for row in connection.execute('SELECT image_id FROM keypoints LIMIT ?', (len(frame_rows) + 1,)).fetchall()]
        if len(keypoint_ids) > len(frame_rows) or len(set(keypoint_ids)) != len(keypoint_ids):
            raise ValueError('Database keypoint image IDs must be unique and bounded by the prepared frame count.')
        nodes, keypoints, frames = {}, {}, [None] * len(frame_rows)
        for image_id, name, camera_id in images:
            _integer(image_id, 1, PAIR_BASE - 1, 'database image ID')
            if image_id in nodes or camera_id not in cameras:
                raise ValueError('Image IDs must be unique and have an existing camera.')
            index = by_name[name]
            original, camera = frame_rows[index], cameras[camera_id]
            if (camera['width'], camera['height']) != (original['width'], original['height']):
                raise ValueError('Database camera dimensions do not match the exact prepared raster.')
            nodes[image_id] = index
            metadata = connection.execute('SELECT rows, cols, length(data) FROM keypoints WHERE image_id=?', (image_id,)).fetchone()
            if metadata is None:
                points = np.empty((0, 2), dtype='<f4')
            else:
                count, cols, size = metadata
                _integer(count, 0, MAX_KEYPOINTS, 'keypoint count')
                if cols not in ((0, 2, 4, 6) if not count else (2, 4, 6)) or (size or 0) != count * cols * 4:
                    raise ValueError('Malformed or oversized keypoint data.')
                blob = connection.execute('SELECT data FROM keypoints WHERE image_id=?', (image_id,)).fetchone()[0]
                points = (np.frombuffer(blob or b'', dtype='<f4').reshape(count, cols)[:, :2].copy()
                          if count else np.empty((0, 2), dtype='<f4'))
                if not np.isfinite(points).all() or np.any(points < 0) or np.any(points[:, 0] >= original['width']) \
                        or np.any(points[:, 1] >= original['height']):
                    raise ValueError('Keypoints must be finite coordinates inside their prepared raster.')
            keypoints[image_id] = points
            frames[index] = {**original, 'sourceKind': capture['sources'][original['sourceIndex']]['kind'],
                             'databaseImageId': image_id, 'cameraId': camera_id, 'keypoints': len(points)}
        if any(image_id not in nodes for image_id in keypoint_ids):
            raise ValueError('Keypoints refer to an unrecorded image.')
        metadata = connection.execute('SELECT pair_id, rows, cols, length(data), config FROM two_view_geometries LIMIT ?',
                                      (MAX_PAIRS + 1,)).fetchall()
        if len(metadata) > MAX_PAIRS:
            raise ValueError('Verified pair records exceed the complete-graph budget.')
        pairs, total = [], 0
        for pair_id, count, cols, size, config in metadata:
            _integer(pair_id, 1, PAIR_BASE**2 - 1, 'pair ID')
            image_b = pair_id % PAIR_BASE
            image_a = (pair_id - image_b) // PAIR_BASE
            if not 0 < image_a < image_b < PAIR_BASE or image_a not in nodes or image_b not in nodes:
                raise ValueError('Verified pair refers to invalid or absent image IDs.')
            _integer(count, 0, MAX_MATCHES, 'verified match count')
            if cols not in ((0, 2) if not count else (2,)) or (size or 0) != count * 8:
                raise ValueError('Malformed verified pair index data.')
            _integer(config, 0 if not count else 1, max(CONFIGURATIONS), 'known pinned two-view geometry configuration')
            total += count
            if total > MAX_MATCHES:
                raise ValueError('Complete correspondences exceed one million matches; no silent thinning is permitted.')
            if not count:
                continue
            blob = connection.execute('SELECT data FROM two_view_geometries WHERE pair_id=?', (pair_id,)).fetchone()[0]
            features = np.frombuffer(blob, dtype='<u4').reshape(count, 2).copy()
            if np.any(features[:, 0] >= len(keypoints[image_a])) or np.any(features[:, 1] >= len(keypoints[image_b])):
                raise ValueError('A verified match index is outside its original keypoint table.')
            if len(np.unique(features, axis=0)) != count:
                raise ValueError('A pair cannot repeat the same feature correspondence.')
            a, b = nodes[image_a], nodes[image_b]
            xy = np.concatenate((keypoints[image_a][features[:, 0]], keypoints[image_b][features[:, 1]]), axis=1)
            if a > b:
                a, b = b, a
                features = features[:, ::-1].copy()
                xy = xy[:, [2, 3, 0, 1]].copy()
            pairs.append((a, b, config, features, xy))
        pairs.sort(key=lambda row: (row[0], row[1]))
        offsets = [0]
        for row in pairs:
            offsets.append(offsets[-1] + len(row[3]))
        arrays = {'view_pairs': np.asarray([(r[0], r[1]) for r in pairs], dtype='<i8').reshape(-1, 2),
                  'pair_offsets': np.asarray(offsets, dtype='<i8'),
                  'feature_indices': np.concatenate([r[3] for r in pairs]) if pairs else np.empty((0, 2), dtype='<u4'),
                  'xy': np.concatenate([r[4] for r in pairs]) if pairs else np.empty((0, 4), dtype='<f4'),
                  'pair_configs': np.asarray([r[2] for r in pairs], dtype='<i8')}
    except (sqlite3.Error, TypeError, OverflowError) as error:
        raise ValueError(f'Malformed correspondence database: {error}') from error
    finally:
        connection.close()
    if rc.sha(_closed_database(path)) != digest:
        raise ValueError('Database changed while its correspondences were read.')
    return frames, [cameras[k] for k in sorted(cameras)], arrays


def _array_shape(name, shape):
    if not isinstance(shape, tuple) or any(type(n) is not int or n < 0 for n in shape):
        return False
    return {'view_pairs': len(shape) == 2 and shape[1] == 2 and shape[0] <= MAX_PAIRS,
            'pair_offsets': len(shape) == 1 and 1 <= shape[0] <= MAX_PAIRS + 1,
            'feature_indices': len(shape) == 2 and shape[1] == 2 and shape[0] <= MAX_MATCHES,
            'xy': len(shape) == 2 and shape[1] == 4 and shape[0] <= MAX_MATCHES,
            'pair_configs': len(shape) == 1 and shape[0] <= MAX_PAIRS}[name]


def _read_arrays(path):
    path = _regular(path, MAX_ARRAY_BYTES)
    expected = {name + '.npy': name for name in ARRAY_DTYPES}
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) != len(expected) or {entry.filename for entry in entries} != set(expected) \
                    or sum(entry.file_size for entry in entries) > MAX_ARRAY_BYTES:
                raise ValueError('Unexpected, duplicated or oversized numeric archive members.')
            for entry in entries:
                if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ValueError('Unsupported numeric archive encoding.')
                name = expected[entry.filename]
                with archive.open(entry) as stream:
                    version = np.lib.format.read_magic(stream)
                    reader = {(1, 0): np.lib.format.read_array_header_1_0,
                              (2, 0): np.lib.format.read_array_header_2_0}.get(version)
                    if reader is None:
                        raise ValueError('Unsupported numeric array format version.')
                    shape, fortran, dtype = reader(stream, max_header_size=4096)
                    if not _array_shape(name, shape) or fortran or dtype.str != ARRAY_DTYPES[name] \
                            or dtype.hasobject or stream.tell() + math.prod(shape) * dtype.itemsize != entry.file_size:
                        raise ValueError('Malformed numeric array shape, dtype or record length.')
        with np.load(path, allow_pickle=False) as loaded:
            return {key: loaded[key] for key in ARRAY_DTYPES}
    except (OSError, zipfile.BadZipFile, KeyError, EOFError) as error:
        raise ValueError(f'Malformed numeric archive: {error}') from error


def _validate_arrays(frames, arrays, *, require_geometry=True):
    if not isinstance(arrays, dict) or set(arrays) != set(ARRAY_DTYPES):
        raise ValueError('Unexpected correspondence array fields.')
    for name, array in arrays.items():
        if not isinstance(array, np.ndarray) or array.dtype.str != ARRAY_DTYPES[name] or not _array_shape(name, array.shape):
            raise ValueError('Malformed correspondence array dimensions or dtype.')
    pairs, offsets, features, xy, configs = (arrays[k] for k in ARRAY_DTYPES)
    if len(offsets) != len(pairs) + 1 or len(configs) != len(pairs) or offsets[0] != 0 \
            or offsets[-1] != len(features) or len(features) != len(xy) or np.any(np.diff(offsets) <= 0) \
            or np.any(pairs < 0) or np.any(pairs >= len(frames)) or np.any(pairs[:, 0] >= pairs[:, 1]) \
            or np.any(configs < 1) or np.any(configs > max(CONFIGURATIONS)) or not np.isfinite(xy).all():
        raise ValueError('Correspondence arrays have inconsistent offsets, pairs, configurations or coordinates.')
    if len(pairs) and list(map(tuple, pairs.tolist())) != sorted(set(map(tuple, pairs.tolist()))):
        raise ValueError('View pairs must be unique and canonically ordered.')
    if np.any(features >= MAX_KEYPOINTS) or np.any(xy < 0):
        raise ValueError('Invalid original feature IDs or negative raster coordinates.')
    for index, (a, b) in enumerate(pairs):
        start, stop = offsets[index:index + 2]
        rows, locations = features[start:stop], xy[start:stop]
        if len(np.unique(rows, axis=0)) != len(rows):
            raise ValueError('Duplicate feature correspondence.')
        for column, node in enumerate((a, b)) if require_geometry else ():
            frame = frames[node]
            if np.any(rows[:, column] >= frame['keypoints']) or np.any(locations[:, 2*column:2*column+2] < 0) \
                    or np.any(locations[:, 2*column] >= frame['width']) or np.any(locations[:, 2*column+1] >= frame['height']):
                raise ValueError('Feature IDs or coordinates escape their prepared frame.')


def _minimum_cut(weights, *, all_phases=False):
    """Exact integer-weight Stoer-Wagner global cut with stable phase tie breaks.

    The selected cut minimizes crossing match weight, not normalized cut. It
    can isolate a single weak view. A normalized witness score is descriptive.
    """
    n = len(weights)
    original = [[int(value) for value in row] for row in weights]
    matrix = [row[:] for row in original]
    vertices = list(range(n))
    groups = {i: {i} for i in vertices}
    best, phases, prefixes = None, [], set()
    while len(vertices) > 1:
        used, scores, previous = set(), {i: 0 for i in vertices}, None
        for step in range(len(vertices)):
            node = max((i for i in vertices if i not in used), key=lambda i: (scores[i], -i))
            used.add(node)
            if step < len(vertices) - 1:
                selected = set().union(*(groups[i] for i in used))
                sides = sorted((tuple(sorted(selected)), tuple(i for i in range(n) if i not in selected)))
                crossing = sum(original[i][j] for i in sides[0] for j in sides[1])
                prefixes.add((crossing, sides[0], sides[1]))
            if step == len(vertices) - 1:
                sides = sorted((tuple(sorted(groups[node])), tuple(i for i in range(n) if i not in groups[node])))
                candidate = (scores[node], sides[0], sides[1])
                phases.append(candidate)
                if best is None or candidate < best:
                    best = candidate
                for other in vertices:
                    if other not in (node, previous):
                        matrix[previous][other] += matrix[node][other]
                        matrix[other][previous] = matrix[previous][other]
                groups[previous].update(groups[node])
                vertices.remove(node)
                break
            previous = node
            for other in vertices:
                if other not in used:
                    scores[other] += matrix[node][other]
    return (phases, sorted(prefixes)) if all_phases else best


def _graph(frames, arrays, minimum):
    n = len(frames)
    counts = np.diff(arrays['pair_offsets'])
    edges = [(int(a), int(b), int(count)) for (a, b), count in zip(arrays['view_pairs'], counts) if count >= minimum]
    configurations = [{'code': code, 'label': CONFIGURATIONS[code],
                       'pairs': int(np.count_nonzero((arrays['pair_configs'] == code) & (counts >= minimum))),
                       'matches': int(counts[(arrays['pair_configs'] == code) & (counts >= minimum)].sum())}
                      for code in sorted(CONFIGURATIONS) if np.any((arrays['pair_configs'] == code) & (counts >= minimum))]
    adjacent = [set() for _ in range(n)]
    weights = np.zeros((n, n), dtype=np.float64)
    for a, b, count in edges:
        adjacent[a].add(b); adjacent[b].add(a)
        weights[a, b] = weights[b, a] = count
    components, seen = [], set()
    for start in range(n):
        if start in seen:
            continue
        todo, component = [start], []
        seen.add(start)
        while todo:
            node = todo.pop(); component.append(node)
            for neighbor in sorted(adjacent[node], reverse=True):
                if neighbor not in seen:
                    seen.add(neighbor); todo.append(neighbor)
        component.sort()
        components.append({'frameIndices': component, 'frames': [frames[i]['image'] for i in component], 'size': len(component)})
    discovery, low, clock, bridges, articulations = {}, {}, 0, [], set()
    def visit(node, parent=None):
        nonlocal clock
        discovery[node] = low[node] = clock; clock += 1
        children = 0
        for neighbor in sorted(adjacent[node]):
            if neighbor == parent:
                continue
            if neighbor not in discovery:
                children += 1; visit(neighbor, node); low[node] = min(low[node], low[neighbor])
                if low[neighbor] > discovery[node]:
                    bridges.append(tuple(sorted((node, neighbor))))
                if parent is not None and low[neighbor] >= discovery[node]:
                    articulations.add(node)
            else:
                low[node] = min(low[node], discovery[neighbor])
        if parent is None and children > 1:
            articulations.add(node)
    for node in range(n):
        if node not in discovery:
            visit(node)
    temporal = []
    for source_index in sorted({f.get('sourceIndex') for f in frames if f.get('sourceKind') == 'video'}):
        ordered = sorted((i for i, f in enumerate(frames) if f.get('sourceKind') == 'video' and f.get('sourceIndex') == source_index),
                         key=lambda i: (frames[i]['sourceFrameIndex'], i))
        temporal.extend([frames[a]['image'], frames[b]['image']] for a, b in zip(ordered, ordered[1:]) if b not in adjacent[a])
    cut, phase_cut = None, None
    if len(components) == 1:
        phases, prefixes = _minimum_cut(weights, all_phases=True)
        crossing, left, right = min(phases)
        degree = weights.sum(axis=1)
        def normalized(witness):
            count, a, b = witness
            volume_a, volume_b = int(degree[list(a)].sum()), int(degree[list(b)].sum())
            return Fraction(count * (volume_a + volume_b), volume_a * volume_b)
        def describe(witness, method, objective):
            count, a, b = witness
            score = normalized(witness)
            return {'method': method, 'normalizedCutScore': round(float(score), 12),
                    'partitionA': [frames[i]['image'] for i in a], 'partitionB': [frames[i]['image'] for i in b],
                    'crossingPairs': sum(1 for i, j, _ in edges if (i in a) != (j in a)),
                    'crossingMatches': count, 'heuristicThreshold': .15, 'weak': score < Fraction(15, 100),
                    'objective': objective, 'balancedPartitionRequired': False, 'physicalAccuracyValidated': False}
        cut = describe((crossing, left, right), 'integer-weight-global-mincut-stoer-wagner-v1',
                       'minimum-crossing-match-weight; normalized score is not globally optimized')
        best_phase = min(prefixes, key=lambda witness: (normalized(witness), witness))
        phase_cut = describe(best_phase, 'integer-weight-stoer-wagner-phase-prefix-witness-v1',
                             'minimum normalized score among deterministic maximum-adjacency phase-prefix cuts; not a global normalized-cut optimum')
        phase_cut['phaseCutsConsidered'] = len(prefixes)
        phase_cut['terminalPhaseCutsConsidered'] = len(phases)
    return {'minimumPairMatches': minimum, 'scope': 'stored-nonempty-two-view-table-records; not a solver-used-edge policy',
            'geometryConfigurations': configurations, 'frames': n, 'pairedFrames': sum(bool(v) for v in adjacent),
            'pairs': len(edges), 'matches': sum(c for _, _, c in edges), 'connected': len(components) == 1,
            'components': components, 'isolatedFrames': [frames[i]['image'] for i in range(n) if not adjacent[i]],
            'degree': [{'image': frames[i]['image'], 'neighbors': len(adjacent[i]), 'matches': int(weights[i].sum())} for i in range(n)],
            'bridges': [{'frames': [frames[a]['image'], frames[b]['image']], 'matches': int(weights[a, b])} for a, b in sorted(bridges)],
            'articulationFrames': [frames[i]['image'] for i in sorted(articulations)],
            'missingSequentialPairs': temporal, 'bottleneck': cut, 'normalizedPhaseCut': phase_cut}


def graph_audit(frames, arrays):
    """Connectivity diagnostics only; dense graphs can still contain wrong matches."""
    if not isinstance(frames, list) or not 3 <= len(frames) <= rc.MAX_FRAMES:
        raise ValueError('Graph audit requires the complete 3–60 prepared-frame denominator.')
    names = [row.get('image') if isinstance(row, dict) else None for row in frames]
    if any(not isinstance(name, str) or not 1 <= len(name) <= 255 or Path(name).name != name for name in names) \
            or len(set(names)) != len(names):
        raise ValueError('Every graph frame needs a unique image basename.')
    # Standalone graph diagnostics need only frame names and topology. Pack
    # build/load additionally enforce exact keypoint IDs and raster bounds.
    _validate_arrays(frames, arrays, require_geometry=False)
    full, candidate = _graph(frames, arrays, 1), _graph(frames, arrays, PAPER_MIN_MATCHES)
    warnings = []
    codes = {row['code'] for row in full['geometryConfigurations']}
    if codes & {1, 7}:
        warnings.append('Stored two-view records include DEGENERATE or WATERMARK configurations. They remain visible here; solver-specific rejection policies are separate.')
    if codes & {4, 5, 6}:
        warnings.append('Stored records include planar or panoramic configurations. A connected graph does not demonstrate observable 3D parallax.')
    if 8 in codes:
        warnings.append('Stored records include MULTIPLE configurations; inspect their interpretation before adopting an inference filter policy.')
    if not full['connected']:
        warnings.append('The full verified-pair graph is disconnected; keep every component and isolated frame visible.')
    if full['bridges'] or full['bottleneck'] and full['bottleneck']['weak'] \
            or full['normalizedPhaseCut'] and full['normalizedPhaseCut']['weak']:
        warnings.append('The full graph contains a bridge or heuristic weak cut. Review overlap and loop closure; this is not proof of wrong geometry.')
    if not candidate['connected']:
        warnings.append('The separately filtered >=50-matches/pair paper-candidate graph is disconnected. This does not change sparse-phone reconstruction defaults.')
    if full['missingSequentialPairs']:
        warnings.append('Some adjacent retained video frames have no verified pair. This is a capture-review signal, not a measured parallax test.')
    return {'schema': AUDIT_SCHEMA, 'scope': 'matching-connectivity-screen-only', 'screeningOnly': True,
            **CLAIMS, 'fullGraph': full, 'paperCandidateGraph': candidate, 'needsReview': bool(warnings), 'warnings': warnings,
            'limitations': ['Connected or dense correspondence graphs can still be geometrically wrong.',
                            'Repeated textures, planar scenes, pure rotation and bad focal estimates are not ruled out by graph connectivity.',
                            'The >=50 paper filter is a separate diagnostic, not a production acceptance threshold or a shared-matcher DeepBA benchmark.']}


def build_pack(*, case, database, out, matching):
    capture = rc.validate_capture(case)
    database = _closed_database(database)
    original_sha = rc.sha(database)
    metadata = _matching(matching, capture['captureSha256'], original_sha)
    frames, cameras, arrays = _read_database(database, capture)
    _validate_arrays(frames, arrays)
    audit = graph_audit(frames, arrays)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    try:
        target = out / 'database.db'
        shutil.copyfile(database, target)
        if rc.sha(_closed_database(database)) != original_sha or rc.sha(target) != original_sha:
            raise ValueError('Matching database changed while it was frozen.')
        np.savez_compressed(out / 'correspondences.npz', **arrays)
        _regular(out / 'correspondences.npz', MAX_ARRAY_BYTES)
        rc.write_json(out / 'audit.json', audit)
        manifest = {'schema': SCHEMA, 'captureSha256': capture['captureSha256'],
                    'captureReceiptSha256': rc.sha(Path(case) / 'capture.json'),
                    'frames': frames, 'cameras': cameras, 'matching': metadata,
                    'pixelConvention': 'colmap-half-pixel', 'pairOrder': 'canonical-prepared-frame-pair; original-database-row-order-within-pair',
                    'observations': {'pairs': len(arrays['view_pairs']), 'matches': len(arrays['xy']), 'thinned': False,
                                     'tracksMerged': False, 'solvedAbsolutePosesIncluded': False,
                                     'relativeVerificationGeometryRetained': True, 'reconstructedPointsIncluded': False},
                    'artifacts': {'database': _artifact(target), 'arrays': _artifact(out / 'correspondences.npz'),
                                  'audit': _artifact(out / 'audit.json')}, 'claims': dict(CLAIMS),
                    'integrity': INTEGRITY}
        rc.write_json(out / 'manifest.json', manifest)
        # Validate the finished archive by the exact loader used before any solve.
        load_pack(case=case, pack=out)
        return manifest
    except Exception:
        shutil.rmtree(out)
        raise


def load_pack(*, case, pack):
    """Re-read immutable input and regenerate diagnostics before solver replay."""
    pack = Path(pack)
    if pack.is_symlink() or not pack.is_dir():
        raise ValueError('Use a regular correspondence-pack directory.')
    if {p.name for p in pack.iterdir()} != {'manifest.json', 'database.db', 'correspondences.npz', 'audit.json'}:
        raise ValueError('Correspondence pack contains missing or unrecorded files.')
    capture = rc.validate_capture(case)
    manifest = rc.read_json(pack / 'manifest.json')
    required = ('schema', 'captureSha256', 'captureReceiptSha256', 'frames', 'cameras', 'matching', 'pixelConvention',
                'pairOrder', 'observations', 'artifacts', 'claims', 'integrity')
    _keys(manifest, required, required, 'correspondence manifest')
    _same(manifest['schema'], SCHEMA, 'Unknown correspondence-pack schema.')
    _same(manifest['captureSha256'], capture['captureSha256'], 'Pack belongs to a different capture.')
    _same(manifest['captureReceiptSha256'], rc.sha(Path(case) / 'capture.json'), 'Capture receipt bytes changed.')
    _same(manifest['claims'], CLAIMS, 'Correspondence packs cannot claim DeepBA, metric, physics, BIM or robot validation.')
    _same(manifest['integrity'], INTEGRITY, 'Correspondence packs cannot claim authenticated physical provenance.')
    _same(manifest['pixelConvention'], 'colmap-half-pixel', 'Unsupported correspondence pixel convention.')
    _same(manifest['pairOrder'], 'canonical-prepared-frame-pair; original-database-row-order-within-pair', 'Unsupported correspondence ordering.')
    expected = {'database': ('database.db', MAX_DATABASE_BYTES), 'arrays': ('correspondences.npz', MAX_ARRAY_BYTES),
                'audit': ('audit.json', rc.MAX_JSON_BYTES)}
    _keys(manifest['artifacts'], expected, expected, 'pack artifact')
    for key, (name, limit) in expected.items():
        path = _regular(pack / name, limit)
        _same(manifest['artifacts'][key], _artifact(path), 'A frozen pack artifact is missing or its bytes changed.')
    _matching(manifest['matching'], capture['captureSha256'], manifest['artifacts']['database']['sha256'])
    frames, cameras, original_arrays = _read_database(pack / 'database.db', capture)
    _same(manifest['frames'], frames, 'Source frames, database IDs or keypoint counts were relabelled.')
    _same(manifest['cameras'], cameras, 'Initial camera priors were relabelled.')
    arrays = _read_arrays(pack / 'correspondences.npz')
    _validate_arrays(frames, arrays)
    for key in ARRAY_DTYPES:
        if arrays[key].shape != original_arrays[key].shape or arrays[key].dtype != original_arrays[key].dtype \
                or arrays[key].tobytes() != original_arrays[key].tobytes():
            raise ValueError('Numeric correspondences do not equal the frozen database, including feature orientation and raw pixels.')
    _same(manifest['observations'], {'pairs': len(arrays['view_pairs']), 'matches': len(arrays['xy']), 'thinned': False,
           'tracksMerged': False, 'solvedAbsolutePosesIncluded': False, 'relativeVerificationGeometryRetained': True,
           'reconstructedPointsIncluded': False}, 'Observation scope was relabelled.')
    audit = graph_audit(frames, arrays)
    _same(rc.read_json(pack / 'audit.json'), audit, 'Stored graph diagnostics do not match the actual correspondences.')
    return {'manifest': manifest, 'arrays': arrays, 'audit': audit}
