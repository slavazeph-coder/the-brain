"""Conservative static Nav2 map from a metric BrainSNN scene and optional bound cloud.

This is an interchange artifact, not a physical robot validation. Scene Y-up is
rotated to ROS Z-up by [x, -z, y], a proper right-handed rotation. No geographic
heading, localization transform, robot footprint or inflation is inferred.

Format references verified against the upstream implementation:
https://github.com/ros-navigation/navigation2/blob/jazzy/nav2_map_server/src/map_io.cpp
https://github.com/ros-infrastructure/rep/blob/master/rep-0103.rst

API: export(scene, NEW_DIRECTORY, cloud=cloud, scene_bytes=raw_scene,
            cloud_bytes=raw_cloud). CLI: python nav2_export.py --scene scene.json
            --cloud arena-cloud.json --out NEW_DIRECTORY
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import unicodedata
import uuid

try:
    from .opening_geometry import wall_parts, door_parts
    from ..world_worker.measurement_check import points_sha256
except ImportError:  # direct CLI from the scene_compiler directory
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from robotics.scene_compiler.opening_geometry import wall_parts, door_parts
    from robotics.world_worker.measurement_check import points_sha256

SCHEMA = 'brainsnn.nav2-map.v1'
FILES = ('nav2-map.pgm', 'nav2-map.yaml', 'nav2-map.json')
MAX_CELLS, MAX_SIDE = 1_000_000, 4096
MAX_RASTER_CANDIDATES = 20_000_000
MAX_SCENE_BYTES, MAX_CLOUD_BYTES = 4 * 1024 * 1024, 16 * 1024 * 1024
UNKNOWN, FREE, OCCUPIED = 205, 254, 0
_SHA = re.compile(r'^[a-f0-9]{64}$')


def _number(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{name} must be finite and between {low} and {high}.')
    return value


def _triple(value, low, high, name):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f'{name} must contain three numbers.')
    return [_number(v, low, high, name) for v in value]


def _canonical(value):
    try:
        return json.dumps(value, allow_nan=False, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    except (ValueError, TypeError, RecursionError, UnicodeError) as error:
        raise ValueError('Map evidence must be finite JSON.') from error


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('Duplicate JSON fields are not accepted.')
        result[key] = value
    return result


def _parse(raw):
    def invalid(_value):
        raise ValueError('Map evidence must be finite JSON.')
    try:
        return json.loads(raw, object_pairs_hook=_pairs, parse_constant=invalid)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError('Map evidence must be valid JSON.') from error


def _source(value, raw, maximum, name):
    canonical = _canonical(value)
    if len(canonical) > maximum:
        raise ValueError(f'{name} exceeds its byte limit.')
    if raw is None:
        return canonical, 'canonical-json'
    if not isinstance(raw, bytes) or len(raw) > maximum:
        raise ValueError(f'{name} source bytes must be bounded bytes.')
    if _canonical(_parse(raw)) != canonical:
        raise ValueError(f'{name} source bytes do not match the supplied object.')
    return raw, 'exact-file-bytes'


def _box(value, name):
    if not isinstance(value, dict) or not isinstance(value.get('name'), str) or not 1 <= len(value['name']) <= 160:
        raise ValueError(f'{name} needs a bounded element name.')
    centre = _triple(value.get('centre'), -1_000_000, 1_000_000, name + ' centre')
    size = _triple(value.get('size'), .000001, 100_000, name + ' size')
    yaw = _number(value.get('yaw_degrees', 0), -360, 360, name + ' yaw')
    if 'min' in value or 'max' in value:
        lo = _triple(value.get('min'), -1_000_000, 1_000_000, name + ' min')
        hi = _triple(value.get('max'), -1_000_000, 1_000_000, name + ' max')
        if yaw != 0 or any(hi[i] <= lo[i] or abs((hi[i] + lo[i]) / 2 - centre[i]) > 1e-7
                           or abs(hi[i] - lo[i] - size[i]) > 1e-7 for i in range(3)):
            raise ValueError(f'{name} min/max do not match its axis-aligned box.')
    return value


def _openings(scene, walls):
    values = scene.get('openings', [])
    if not isinstance(values, list) or len(values) > 32:
        raise ValueError('Provide at most 32 reviewed openings.')
    by_name, ids = {w['name']: w for w in walls}, set()
    fields = {'id', 'hostWall', 'offsetMeters', 'widthMeters', 'heightMeters', 'sillMeters', 'kind', 'reviewed', 'host'}
    identities = {'componentId', 'hostComponentId', 'doorComponentId'}
    metadata = {'physicalReviewRequired', 'dimensionProvenance', 'parameterProvenance', 'label', 'labelProvenance', 'labelAuthority',
                'provenance', 'sourceProvenance', 'supportPointsScope', 'support_points'}
    for o in values:
        if not isinstance(o, dict) or not fields <= set(o) or set(o) - fields - identities - metadata or not isinstance(o['id'], str) \
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', o['id']) or o['id'] in ids:
            raise ValueError('Reviewed openings need unique bounded IDs and exact fields.')
        ids.add(o['id'])
        wall = by_name.get(o['hostWall']) if isinstance(o['hostWall'], str) else None
        snapshot = {k: wall.get(k, 0) for k in ('centre', 'size', 'yaw_degrees')} if wall else None
        if not isinstance(o['host'], dict) or set(o['host']) != {'centre', 'size', 'yaw_degrees'}:
            raise ValueError('Opening host snapshot must contain exact geometry fields.')
        _triple(o['host']['centre'], -1_000_000, 1_000_000, 'Opening host centre')
        _triple(o['host']['size'], .000001, 100_000, 'Opening host size')
        _number(o['host']['yaw_degrees'], -360, 360, 'Opening host yaw')
        if o['reviewed'] is not True or o['kind'] not in ('opening', 'door') or o['host'] != snapshot:
            raise ValueError('Opening review or exact host snapshot is missing or stale.')
        for key in identities & set(o):
            try:
                if not isinstance(o[key], str) or str(uuid.UUID(o[key])) != o[key]:
                    raise ValueError()
            except (ValueError, AttributeError, TypeError) as error:
                raise ValueError('Opening component identities must be canonical UUIDs.') from error
        if 'hostComponentId' in o and o['hostComponentId'] != wall.get('componentId'):
            raise ValueError('Opening host component identity is stale.')
        if 'doorComponentId' in o and o['kind'] != 'door':
            raise ValueError('Only a filled door opening can carry a door component identity.')
        if 'physicalReviewRequired' in o and o['physicalReviewRequired'] is not True:
            raise ValueError('Edited openings must retain physicalReviewRequired true.')
        for key, required in (('dimensionProvenance', 'operator-authored-edit'),
                              ('labelProvenance', 'operator-authored-edit'), ('labelAuthority', 'operator-declared'),
                              ('provenance', 'operator-authored-edit'), ('supportPointsScope', 'original-source-not-edited-geometry')):
            if key in o and o[key] != required:
                raise ValueError('Opening edit provenance or label authority is invalid.')
        if 'sourceProvenance' in o:
            value = o['sourceProvenance']
            if not isinstance(value, str) or not value.strip() or len(value) > 160 \
                    or any(unicodedata.category(char).startswith('C') for char in value):
                raise ValueError('Opening source provenance must be a bounded plain string.')
        if 'support_points' in o and (type(o['support_points']) is not int or not 0 <= o['support_points'] <= 50_000):
            raise ValueError('Original opening support count must be a bounded nonnegative integer.')
        if 'parameterProvenance' in o:
            parameters = o['parameterProvenance']
            if not isinstance(parameters, dict) or not parameters or not set(parameters) <= {'offsetMeters', 'widthMeters', 'heightMeters', 'sillMeters', 'hostPlacement'} \
                    or any(value != 'operator-authored-edit' for value in parameters.values()):
                raise ValueError('Opening parameter provenance must name only authored opening dimensions.')
        if 'label' in o:
            if not isinstance(o['label'], str) or not o['label'].strip() or len(o['label']) > 160 \
                    or any(unicodedata.category(char).startswith('C') for char in o['label']):
                raise ValueError('Opening label must contain 1 to 160 plain characters.')
        elif 'labelProvenance' in o or 'labelAuthority' in o:
            raise ValueError('Opening label provenance requires a label.')
        for key, lo, hi in [('offsetMeters', 0, 100_000), ('widthMeters', .05, 100),
                            ('sillMeters', 0, 100), ('heightMeters', .05, 100)]:
            _number(o[key], lo, hi, key)
        if o['offsetMeters'] + o['widthMeters'] > wall['size'][0] + 1e-9 \
                or o['sillMeters'] + o['heightMeters'] > wall['size'][1] + 1e-9 \
                or (o['kind'] == 'door' and o['sillMeters'] != 0):
            raise ValueError('Reviewed opening must fit its host; a door starts at its base.')
    for i, a in enumerate(values):
        for b in values[i + 1:]:
            if a['hostWall'] == b['hostWall'] \
                    and min(a['offsetMeters'] + a['widthMeters'], b['offsetMeters'] + b['widthMeters']) - max(a['offsetMeters'], b['offsetMeters']) > 1e-9 \
                    and min(a['sillMeters'] + a['heightMeters'], b['sillMeters'] + b['heightMeters']) - max(a['sillMeters'], b['sillMeters']) > 1e-9:
                raise ValueError('Reviewed openings must not overlap.')
    return values


def _scene(scene):
    if not isinstance(scene, dict) or scene.get('schema') != 'brainsnn.scene.v1' or scene.get('units') != 'm':
        raise ValueError('Nav2 export requires a brainsnn.scene.v1 scene in metres.')
    if scene.get('coordinateFrame', 'right-handed-y-up') != 'right-handed-y-up':
        raise ValueError('Nav2 source scene must use the right-handed-y-up frame.')
    if scene.get('bimReview') is not None and not isinstance(scene['bimReview'], dict):
        raise ValueError('Scene BIM review metadata must be an object.')
    if 'componentGraph' in scene:
        # Reject geometry or identity changes that bypassed the exact-source edit contract.
        from robotics.scene_compiler.component_graph import ensure_component_ids
        ensure_component_ids(scene)
    floor_y = _number(scene.get('floor_y'), -1_000_000, 1_000_000, 'Floor height')
    walls, objects, unknown = scene.get('walls'), scene.get('objects'), scene.get('unknown', [])
    if not isinstance(walls, list) or len(walls) > 512 or not isinstance(objects, list) or len(objects) > 2048 \
            or not isinstance(unknown, list) or len(unknown) > 65_536:
        raise ValueError('Scene geometry lists are missing or exceed their bounds.')
    names, placed, floors = set(), [], []
    for value, kind in [(w, 'wall') for w in walls] + [(o, 'object') for o in objects]:
        if kind == 'object' and isinstance(value, dict) and value.get('provenance') == 'detected-unplaced':
            if any(k in value for k in ('centre', 'size', 'min', 'max')):
                raise ValueError('An unplaced detection must not carry placed geometry.')
            continue
        _box(value, kind)
        if value['name'] in names:
            raise ValueError('Scene element names must be unique.')
        names.add(value['name'])
        if value['name'] == 'floor_observed':
            if kind != 'object' or value.get('yaw_degrees', 0) != 0:
                raise ValueError('The observed floor must be an axis-aligned floor object.')
            floors.append(value)
        elif kind == 'object':
            placed.append(value)
    if len(floors) != 1:
        raise ValueError('Exactly one observed floor extent is required.')
    floor = floors[0]; centre, size = floor['centre'], floor['size']
    if abs(centre[1] + size[1] / 2 - floor_y) > 1e-7:
        raise ValueError('Observed floor top must match floor_y.')
    for cell in unknown:
        _triple(cell, -1_000_000, 1_000_000, 'Unknown cell')
        _number(cell[2], .000001, 100_000, 'Unknown cell size')
    holes = _openings(scene, walls)
    # Bounds in ROS [x, -z]. No geographic heading is implied.
    bounds = [centre[0] - size[0] / 2, -centre[2] - size[2] / 2,
              centre[0] + size[0] / 2, -centre[2] + size[2] / 2]
    return floor_y, bounds, walls, placed, unknown, holes


def _grid(bounds, resolution):
    # One extra unknown cell on every side; round outward so the floor is never truncated.
    x0, y0 = math.floor(bounds[0] / resolution) - 1, math.floor(bounds[1] / resolution) - 1
    x1, y1 = math.ceil(bounds[2] / resolution) + 1, math.ceil(bounds[3] / resolution) + 1
    width, height = x1 - x0, y1 - y0
    if width > MAX_SIDE or height > MAX_SIDE or width * height > MAX_CELLS:
        raise ValueError(f'Nav2 map exceeds {MAX_SIDE} cells per side or {MAX_CELLS} total cells.')
    return x0 * resolution, y0 * resolution, width, height


def _candidates(bounds, origin, resolution, width, height, budget=None):
    x0, y0, x1, y1 = bounds
    # Inclusive boundaries are conservative: even a sub-pixel wall can occupy a cell.
    rows = range(max(0, math.floor((y0 - origin[1]) / resolution - 1e-9)),
                 min(height - 1, math.floor((y1 - origin[1]) / resolution + 1e-9)) + 1)
    cols = range(max(0, math.floor((x0 - origin[0]) / resolution - 1e-9)),
                 min(width - 1, math.floor((x1 - origin[0]) / resolution + 1e-9)) + 1)
    if budget is not None:
        budget[0] += len(rows) * len(cols)
        if budget[0] > MAX_RASTER_CANDIDATES:
            raise ValueError('Nav2 geometry exceeds its bounded rasterization workload.')
    for row in rows:
        for col in cols:
            yield col, row


def _project(box):
    angle = -math.radians(box.get('yaw_degrees', 0))
    ux, uy = math.cos(angle), math.sin(angle)
    return box['centre'][0], -box['centre'][2], box['size'][0] / 2, box['size'][2] / 2, ux, uy


def _occupied(grid, box, eligible, origin, resolution, width, height, budget):
    cx, cy, a, b, ux, uy = _project(box); vx, vy = -uy, ux
    hx, hy, r = abs(ux) * a + abs(vx) * b, abs(uy) * a + abs(vy) * b, resolution / 2
    for col, row in _candidates([cx - hx, cy - hy, cx + hx, cy + hy], origin, resolution, width, height, budget):
        k = row * width + col
        if not eligible[k]:
            continue
        dx, dy = origin[0] + (col + .5) * resolution - cx, origin[1] + (row + .5) * resolution - cy
        # Four separating axes of a grid square and an oriented rectangle.
        if abs(dx) <= hx + r + 1e-10 and abs(dy) <= hy + r + 1e-10 \
                and abs(dx * ux + dy * uy) <= a + r * (abs(ux) + abs(uy)) + 1e-10 \
                and abs(dx * vx + dy * vy) <= b + r * (abs(vx) + abs(vy)) + 1e-10:
            grid[k] = OCCUPIED


def _publish_directory(source, target):
    """Atomic directory publication without replacing even an empty existing target.

    Linux renameat2 is available on the worker platform. Fail closed on platforms
    without its no-replace guarantee rather than publishing a partial bundle.
    """
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, 'renameat2', None)
    if rename is None:
        raise RuntimeError('Atomic fresh Nav2 export requires renameat2 on this platform.')
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(target), 1) != 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise FileExistsError('Nav2 output must be a fresh, absent directory.')
        raise OSError(code, os.strerror(code), str(target))


def export(scene, out_dir, *, cloud=None, scene_bytes=None, cloud_bytes=None,
           resolution=.05, floor_tolerance=.05, minimum_headroom=2.0):
    """Write a fresh, atomic PGM/YAML/manifest bundle. Return relative artifact names.

    Four quadrants of each free cell need near-floor samples in the exact bound
    cloud. These are sample-supported candidate cells, not surveyed traversability.
    Without a cloud the observed extent creates no free cells. Occupancy is raw,
    with no robot inflation; configure footprint, margin and unknown handling in
    Nav2 and validate localization, clearance and physical operation separately.
    """
    _number(resolution, .01, 1, 'Resolution')
    _number(floor_tolerance, .001, .1, 'Floor tolerance')
    _number(minimum_headroom, .1, 5, 'Minimum headroom')
    raw_scene, scene_basis = _source(scene, scene_bytes, MAX_SCENE_BYTES, 'Scene')
    floor_y, bounds, walls, objects, unknown, holes = _scene(scene)
    raw_cloud, cloud_basis, point_hash, points = None, None, None, []
    if cloud is not None:
        raw_cloud, cloud_basis = _source(cloud, cloud_bytes, MAX_CLOUD_BYTES, 'Cloud')
        point_hash = points_sha256(cloud)
        bindings = [scene.get('cloudPointsSha256'), (scene.get('bimReview') or {}).get('cloudPointsSha256')]
        bindings = [v for v in bindings if v is not None]
        if not bindings or any(not isinstance(v, str) or not _SHA.fullmatch(v) or v != point_hash for v in bindings):
            raise ValueError('Floor samples need an exact scene cloudPointsSha256 binding to this cloud.')
        if _canonical(scene.get('scale')) != _canonical(cloud.get('scale')):
            raise ValueError('Scene and floor-cloud scale must match exactly.')
        points = cloud['points']
    elif cloud_bytes is not None:
        raise ValueError('Cloud source bytes require a supplied cloud.')
    origin_x, origin_y, width, height = _grid(bounds, resolution)
    origin = [origin_x, origin_y]; count = width * height
    grid = bytearray([UNKNOWN]) * count
    eligible = bytearray(count)
    for row in range(height):
        y0, y1 = origin_y + row * resolution, origin_y + (row + 1) * resolution
        for col in range(width):
            x0, x1 = origin_x + col * resolution, origin_x + (col + 1) * resolution
            if x0 >= bounds[0] - 1e-9 and y0 >= bounds[1] - 1e-9 and x1 <= bounds[2] + 1e-9 and y1 <= bounds[3] + 1e-9:
                eligible[row * width + col] = 1
    masks = bytearray(count); floor_samples = 0
    for point in points:
        if abs(point[1] - floor_y) > floor_tolerance:
            continue
        gx, gy = (point[0] - origin_x) / resolution, (-point[2] - origin_y) / resolution
        col, row = math.floor(gx), math.floor(gy)
        if 0 <= col < width and 0 <= row < height and eligible[row * width + col]:
            quadrant = int(gx - col >= .5) + 2 * int(gy - row >= .5)
            masks[row * width + col] |= 1 << quadrant; floor_samples += 1
    for k, mask in enumerate(masks):
        if mask == 15:
            grid[k] = FREE
    # Explicit unknown coverage always removes free status, with no interpolation.
    budget = [0]
    for x, z, size in unknown:
        for col, row in _candidates([x, -(z + size), x + size, -z], origin, resolution, width, height, budget):
            grid[row * width + col] = UNKNOWN
    projected_walls = 0
    for wall in walls:
        for part in wall_parts(wall, holes):
            low, high = part['centre'][1] - part['size'][1] / 2, part['centre'][1] + part['size'][1] / 2
            if low < floor_y + minimum_headroom - 1e-9 and high > floor_y + .02:
                _occupied(grid, part, eligible, origin, resolution, width, height, budget); projected_walls += 1
    leaves = door_parts(walls, holes)
    for box in leaves + objects:
        _occupied(grid, box, eligible, origin, resolution, width, height, budget)
    # PGM starts at the highest ROS y. OccupancyGrid starts at the lowest ROS y.
    pixels = b''.join(bytes(grid[row * width:(row + 1) * width]) for row in range(height - 1, -1, -1))
    pgm = f'P5\n{width} {height}\n255\n'.encode('ascii') + pixels
    yaml = (f'image: {FILES[0]}\nmode: trinary\nresolution: {resolution:.12g}\n'
            f'origin: [{origin_x:.12g}, {origin_y:.12g}, 0.0]\nnegate: 0\n'
            'occupied_thresh: 0.65\nfree_thresh: 0.196\n').encode('ascii')
    counts = {'occupied': grid.count(OCCUPIED), 'free': grid.count(FREE), 'unknown': grid.count(UNKNOWN)}
    source = {'sceneSha256': hashlib.sha256(raw_scene).hexdigest(), 'sceneDigestBasis': scene_basis,
              'cloudSha256': hashlib.sha256(raw_cloud).hexdigest() if raw_cloud is not None else None,
              'cloudDigestBasis': cloud_basis, 'cloudPointsSha256': point_hash,
              'sceneCloudBindingVerified': cloud is not None}
    provenance = cloud.get('provenance') if isinstance(cloud, dict) else None
    aligned = provenance.get('floorAligned') if isinstance(provenance, dict) else None
    source['reportedFloorAligned'] = aligned if isinstance(aligned, bool) else None
    component_graph = scene.get('componentGraph')
    if component_graph is not None:
        source['componentGraph'] = {key: component_graph[key] for key in
                                    ('schema', 'sourceSha256', 'revision', 'evidenceStatus', 'invalidatedEvidence')}
    manifest = {'schema': SCHEMA, 'units': 'm', 'frameId': 'map',
                'coordinateTransform': {'source': 'right-handed-y-up', 'target': 'right-handed-z-up',
                                        'xyz': ['x', '-z', 'y'], 'matrix': [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
                                        'rosYawRadians': '-sceneYawDegrees*pi/180', 'geographicHeadingKnown': False},
                'grid': {'width': width, 'height': height, 'resolution': resolution, 'origin': [origin_x, origin_y, 0],
                         'imageRowOrder': 'highest ROS y first', 'occupancyGridRowOrder': 'lowest ROS y first',
                         'pgmValues': {'occupied': OCCUPIED, 'free': FREE, 'unknown': UNKNOWN}, 'mode': 'trinary'},
                'source': source, 'scale': scene.get('scale'), 'counts': counts,
                'geometry': {'semanticWalls': len(walls), 'projectedWallParts': projected_walls, 'closedDoorLeaves': len(leaves),
                             'objects': len(objects), 'explicitUnknownCells': len(unknown), 'floorSamples': floor_samples},
                'policy': {'free': 'Four cell quadrants each contain a bound source-cloud point within floorTolerance of floor_y; no dilation, interpolation or ray clearing.',
                           'floorToleranceMeters': floor_tolerance, 'observedFloorExtentImpliesFree': False,
                           'unknown': 'Outside the observed floor and explicit unknown regions stay unknown; occupied geometry takes precedence. Configure Nav2 to block unknown for conservative use.',
                           'obstacles': 'Any grid square intersecting projected solid geometry is occupied; objects and closed doors are projected conservatively.',
                           'wallProjectionHeightMeters': minimum_headroom, 'wallProjection': 'Remaining wall solids intersecting the floor-to-headroom band; raised and short voids stay blocked.',
                           'robotInflationBakedIn': False, 'robotFootprint': None, 'robotMarginMeters': None,
                           'footprintAndMargin': 'Configure robot footprint, safety margin and inflation in Nav2. Raster intersection expands geometry by at most one cell diagonal; this is not robot inflation.'},
                'validation': {'metricVerified': False, 'physicalRobotValidated': False, 'localizationValidated': False,
                               'physicalReviewRequired': scene.get('physicalReviewRequired') is True,
                               'nav2RuntimeTested': False, 'purpose': 'Static map interchange and software experiments only.'},
                'limitations': ['Camera-derived geometry and entered scale are not independent metric or survey validation.',
                                'Gravity alignment is only the source report when present; the exporter does not validate a physical horizontal floor.',
                                'Floor samples do not prove traversability, obstacle completeness, load-bearing support or floor slope.',
                                'The headroom band is a declared planar convention, not a robot clearance check.',
                                'Controlled component edits author new geometry; original capture measurements do not independently validate the edited dimensions.',
                                'Unknown space, low clutter, dynamic objects and localization need independent operational validation.'],
                'formatReferences': ['https://github.com/ros-navigation/navigation2/blob/jazzy/nav2_map_server/src/map_io.cpp',
                                     'https://github.com/ros-infrastructure/rep/blob/master/rep-0103.rst'],
                'artifacts': {FILES[0]: {'sha256': hashlib.sha256(pgm).hexdigest(), 'bytes': len(pgm)},
                              FILES[1]: {'sha256': hashlib.sha256(yaml).hexdigest(), 'bytes': len(yaml)}}}
    raw_manifest = json.dumps(manifest, indent=2, allow_nan=False).encode('utf-8') + b'\n'
    target = Path(out_dir).absolute()
    if target.exists() or target.is_symlink():
        raise FileExistsError('Nav2 output must be a fresh, absent directory.')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f'.{target.name}.tmp-', dir=target.parent))
    try:
        for name, raw in zip(FILES, (pgm, yaml, raw_manifest)):
            with (temporary / name).open('xb') as stream:
                stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        _publish_directory(temporary, target)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return {'written': True, 'files': list(FILES), 'width': width, 'height': height, 'resolution': resolution,
            'counts': counts, **source}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', required=True, type=Path)
    parser.add_argument('--cloud', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--resolution', type=float, default=.05)
    args = parser.parse_args(argv)
    def read(path, maximum):
        if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
            raise ValueError('Inputs must be bounded regular JSON files.')
        raw = path.read_bytes()
        return _parse(raw), raw
    scene, raw_scene = read(args.scene, MAX_SCENE_BYTES)
    cloud, raw_cloud = read(args.cloud, MAX_CLOUD_BYTES) if args.cloud else (None, None)
    result = export(scene, args.out, cloud=cloud, scene_bytes=raw_scene, cloud_bytes=raw_cloud, resolution=args.resolution)
    print(json.dumps(result, allow_nan=False))


if __name__ == '__main__':
    main()
