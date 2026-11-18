"""Read a bounded declared measured PLY and prepare reproducible ROS map bytes."""
from __future__ import annotations
import math
from pathlib import Path
import struct
from . import contracts as c

MAX_SCAN_BYTES = 64 * 1024 * 1024
MAX_INPUT_POINTS = 2_000_000
MAX_MAP_POINTS = 250_000
TYPES = {'float': 'f', 'float32': 'f', 'double': 'd', 'float64': 'd', 'char': 'b', 'int8': 'b',
         'uchar': 'B', 'uint8': 'B', 'short': 'h', 'int16': 'h', 'ushort': 'H', 'uint16': 'H',
         'int': 'i', 'int32': 'i', 'uint': 'I', 'uint32': 'I'}


def ply_points(raw):
    """Scalar XYZ vertices only; reject meshes and Gaussian appearance files."""
    end = raw.find(b'end_header\n', 0, 32_768)
    marker = 11
    if end < 0:
        end = raw.find(b'end_header\r\n', 0, 32_768); marker = 12
    if end < 0:
        raise ValueError('PLY header missing or too large')
    lines = raw[:end].decode('ascii').splitlines()
    if not lines or lines[0] != 'ply':
        raise ValueError('Expected a PLY point cloud')
    layout, count, props, element = None, None, [], None
    for line in lines[1:]:
        w = line.split()
        if not w or w[0] in ('comment', 'obj_info'):
            continue
        if w[0] == 'format' and len(w) == 3 and w[2] == '1.0':
            layout = w[1]
        elif w[0] == 'element' and len(w) == 3:
            if element is not None or w[1] != 'vertex':
                raise ValueError('Localization input must contain only measured point vertices')
            element, count = w[1], int(w[2])
        elif w[0] == 'property' and len(w) == 3 and element == 'vertex' and w[1] in TYPES:
            props.append((w[2], TYPES[w[1]]))
        else:
            raise ValueError('Unsupported localization PLY header')
    names = [p[0] for p in props]
    if layout not in ('ascii', 'binary_little_endian', 'binary_big_endian') or type(count) is not int or not 100 <= count <= MAX_INPUT_POINTS:
        raise ValueError('Measured PLY requires 100 to 2 million points')
    if len(props) > 32 or len(names) != len(set(names)) or not {'x', 'y', 'z'} <= set(names):
        raise ValueError('PLY must have unique bounded scalar XYZ properties')
    if any(n.startswith(('f_dc_', 'f_rest_', 'scale_', 'rot_')) or n == 'opacity' for n in names):
        raise ValueError('Gaussian appearance cannot be used as a measured map')
    data = memoryview(raw)[end+marker:]
    axes = [names.index(k) for k in ('x', 'y', 'z')]
    if layout == 'ascii':
        # File byte bound makes splitting bounded; vertex count is checked exactly.
        rows = bytes(data).splitlines()
        if len(rows) != count:
            raise ValueError('PLY vertex count does not match its body')
        values = (list(map(float, row.split())) for row in rows)
    else:
        item = struct.Struct(('<' if layout == 'binary_little_endian' else '>') + ''.join(k for _, k in props))
        if len(data) != count * item.size:
            raise ValueError('PLY byte length does not match declared points')
        values = item.iter_unpack(data)
    for values_row in values:
        if len(values_row) != len(props):
            raise ValueError('PLY property count mismatch')
        point = [float(values_row[j]) for j in axes]
        if not all(math.isfinite(v) and abs(v) <= 1e6 for v in point):
            raise ValueError('Non-finite or unbounded measured coordinate')
        yield point


def prepare(raw_scan, options, source):
    c.validate_request(options)
    if len(raw_scan) > MAX_SCAN_BYTES or c.sha(raw_scan) != options['scanSha256']:
        raise ValueError('Measured scan hash mismatch or byte limit exceeded')
    matrix = c.compose(c.SCENE_TO_MAP, options['sourceToScene'])
    cells, count = {}, 0
    voxel = options['voxelMeters']
    for point in ply_points(raw_scan):
        count += 1
        p = c.transform(matrix, point)
        if max(map(abs, p)) > 100_000:
            raise ValueError('Local map exceeds its coordinate bound; register to a nearby origin')
        cell = tuple(math.floor(v / voxel) for v in p)
        if cell not in cells:
            if len(cells) >= MAX_MAP_POINTS:
                raise ValueError('Map exceeds 250,000 voxels; choose a coarser declared voxel size')
            cells[cell] = p
    points = list(cells.values())
    if len(points) < 100:
        raise ValueError('Measured map has fewer than 100 retained points')
    # PCD XYZI is accepted by the upstream PointXYZI reader. Intensity is a neutral
    # constant because localization uses geometry; do not invent measured intensity.
    packed = b''.join(struct.pack('<ffff', *p, 0.) for p in points)
    pcd = (f'# BrainSNN declared measured geometry; unqualified\nVERSION .7\nFIELDS x y z intensity\n'
           f'SIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH {len(points)}\nHEIGHT 1\n'
           f'VIEWPOINT 0 0 0 1 0 0 0\nPOINTS {len(points)}\nDATA binary\n').encode() + packed
    ply = (f'ply\nformat binary_little_endian 1.0\ncomment Declared measured ROS Z-up metres; unqualified\n'
           f'element vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\nend_header\n').encode()
    ply += b''.join(struct.pack('<fff', *p) for p in points)
    files = {'localization-map.pcd': pcd, 'localization-map.ply': ply}
    manifest = {'schema': c.MAP_SCHEMA, 'source': source, 'units': 'm', 'mapSha256': c.sha(pcd),
                'frames': {'sourceFrame': options['sourceFrame'], 'sceneFrame': 'right-handed-y-up',
                           'mapFrame': 'map', 'baseFrame': options['baseFrame'],
                           'sourceToScene': options['sourceToScene'], 'sceneToMap': c.SCENE_TO_MAP, 'sourceToMap': matrix},
                'measurement': {'basis': 'operator-declared-registered-lidar', 'units': 'm', 'independentlyVerified': False},
                'sampling': {'inputPoints': count, 'retainedPoints': len(points), 'voxelMeters': voxel,
                             'method': 'first measured point in each voxel; no interpolation or generated geometry'},
                'bounds': {'min': [min(p[i] for p in points) for i in range(3)], 'max': [max(p[i] for p in points) for i in range(3)]},
                'upstream': {'repository': 'https://github.com/rsasaki0109/lidar_localization_ros2',
                             'commit': c.UPSTREAM_COMMIT, 'ndtCommit': c.NDT_COMMIT},
                'validation': {'metricVerified': False, 'physicalRobotValidated': False, 'localizationValidated': False},
                'limitations': ['File units and registration are declared, not independently measured here.',
                                'A localization map does not establish traversability or collision safety.',
                                'The separate Nav2 occupancy bundle is not generated or replaced by this map.'],
                'artifacts': {name: {'sha256': c.sha(raw), 'bytes': len(raw)} for name, raw in files.items()}}
    manifest['revisionSha256'] = c.manifest_revision(manifest)
    c.validate_map(manifest)
    files['localization-map.json'] = c.encode(manifest)
    return manifest, files
