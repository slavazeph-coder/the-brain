"""A registered laser scan (PLY, LAS/LAZ or E57) as the scene compiler's point-cloud hand-off.

A terrestrial scanner measures in metres and puts points on every surface it sees, so its cloud needs no scale step and
no second view. This reads one unified, already-registered cloud, thins it to one point per voxel within the compiler's
budget, turns the scanner's Z-up frame to the worker's Y-up frame, and writes `arena-cloud.json` with
`sourceFrame: "survey-scan"`. The scene compiler then holds its walls to the face-coverage test (scene_compiler.py,
WALL_FACE_COVERAGE), because a dense scan gives a plane through furniture enough points to pass the sparse-cloud tests.

What it does not do: register separate scan positions (export one unified cloud from the scanner's software, or an E57
whose scans carry their poses), check the file's units (the coordinates are taken as metres and recorded as declared,
not verified), or model beams, ducts and pipes: the compiler still writes a floor, walls and boxed objects.

  python robotics/world_worker/survey_cloud.py --input office.ply --out run/ [--up z|y] [--compile --blender blender]

PLY needs only numpy. LAS/LAZ needs `laspy` (with `lazrs` for LAZ) and E57 needs `pye57`; each is imported only for
its own format and the error says which package is missing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from pathlib import Path

BUDGET = 50_000            # geometry.ARENA_CLOUD_MAX_POINTS: what the scene compiler accepts
FINEST_VOXEL = 0.02        # metres: finer than this adds nothing the compiler's 6 cm wall tolerance can use
MAX_POINTS = 400_000_000   # a refusal, not a target: about 6 GB of binary PLY
CHUNK = 4_000_000
PLY_TYPES = {'char': 'i1', 'int8': 'i1', 'uchar': 'u1', 'uint8': 'u1', 'short': 'i2', 'int16': 'i2', 'ushort': 'u2', 'uint16': 'u2',
             'int': 'i4', 'int32': 'i4', 'uint': 'u4', 'uint32': 'u4', 'float': 'f4', 'float32': 'f4', 'double': 'f8', 'float64': 'f8'}
COLOURS = (('red', 'green', 'blue'), ('r', 'g', 'b'), ('diffuse_red', 'diffuse_green', 'diffuse_blue'))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 ** 2), b''):
            digest.update(block)
    return digest.hexdigest()


def ply_header(path: Path):
    """(format, vertex count, [(name, numpy type)], byte offset of the data). The vertex element must come first and hold
    only scalar properties, which is how every scanner and point-cloud tool writes a cloud."""
    with path.open('rb') as stream:
        if stream.readline().strip() != b'ply':
            raise ValueError('Not a PLY file.')
        layout, count, properties, element = None, None, [], None
        for _ in range(400):
            line = stream.readline()
            if not line:
                break
            words = line.decode('ascii', 'replace').split()
            if not words or words[0] in ('comment', 'obj_info'):
                continue
            if words[0] == 'format' and len(words) >= 2:
                layout = words[1]
            elif words[0] == 'element' and len(words) == 3:
                if element is None and words[1] != 'vertex':
                    raise ValueError('The PLY must list its vertices first.')
                element = words[1]
                if element == 'vertex':
                    count = int(words[2])
            elif words[0] == 'property' and element == 'vertex':
                if words[1] == 'list' or len(words) != 3 or words[1] not in PLY_TYPES:
                    raise ValueError('The PLY vertices hold a property this reader does not support.')
                properties.append((words[2], PLY_TYPES[words[1]]))
            elif words[0] == 'end_header':
                if layout not in ('ascii', 'binary_little_endian', 'binary_big_endian') or not count or count > MAX_POINTS:
                    raise ValueError('The PLY has no usable vertex list.')
                if not {'x', 'y', 'z'} <= {name for name, _ in properties}:
                    raise ValueError('The PLY vertices need x, y and z.')
                return layout, count, properties, stream.tell()
    raise ValueError('The PLY header never ends.')


def ply_chunks(path: Path):
    """Yields (xyz float64 [n, 3], rgb uint8 [n, 3] or None) a few million points at a time, without loading the file."""
    import numpy as np
    layout, count, properties, offset = ply_header(path)
    names = [name for name, _ in properties]
    colour = next((triple for triple in COLOURS if set(triple) <= set(names)), None)
    if layout == 'ascii':
        columns = [names.index(k) for k in ('x', 'y', 'z')] + ([names.index(k) for k in colour] if colour else [])
        with path.open('rb') as stream:
            stream.seek(offset)
            for start in range(0, count, CHUNK):
                block = np.loadtxt(stream, usecols=columns, max_rows=min(CHUNK, count - start), ndmin=2)
                if len(block) != min(CHUNK, count - start):
                    raise ValueError('The PLY ends before its vertex count.')
                yield block[:, :3], (np.clip(block[:, 3:6], 0, 255).astype(np.uint8) if colour else None)
        return
    order = '<' if layout == 'binary_little_endian' else '>'
    record = np.dtype([(name, order + kind) for name, kind in properties])
    if path.stat().st_size < offset + count * record.itemsize:
        raise ValueError('The PLY ends before its vertex count.')
    points = np.memmap(path, dtype=record, mode='r', offset=offset, shape=(count,))
    for start in range(0, count, CHUNK):
        block = points[start:start + CHUNK]
        xyz = np.stack([block['x'], block['y'], block['z']], 1).astype(np.float64)
        rgb = None
        if colour:
            rgb = np.stack([block[k] for k in colour], 1)
            rgb = (rgb >> 8).astype(np.uint8) if rgb.dtype.itemsize == 2 else np.clip(rgb, 0, 255).astype(np.uint8)
        yield xyz, rgb


def las_chunks(path: Path):
    try:
        import laspy
    except ImportError as error:
        raise ValueError('Reading LAS or LAZ needs the laspy package (pip install "laspy[lazrs]").') from error
    import numpy as np
    with laspy.open(str(path)) as reader:
        if reader.header.point_count > MAX_POINTS:
            raise ValueError('The scan holds more points than this reader accepts.')
        for block in reader.chunk_iterator(CHUNK):
            xyz = np.stack([block.x, block.y, block.z], 1).astype(np.float64)
            rgb = None
            if all(hasattr(block, k) for k in ('red', 'green', 'blue')):
                rgb = np.stack([block.red, block.green, block.blue], 1)
                rgb = (rgb >> 8).astype(np.uint8) if rgb.max(initial=0) > 255 else rgb.astype(np.uint8)
            yield xyz, rgb


def e57_chunks(path: Path):
    try:
        import pye57
    except ImportError as error:
        raise ValueError('Reading E57 needs the pye57 package (pip install pye57).') from error
    import numpy as np
    scan = pye57.E57(str(path))
    for index in range(scan.scan_count):
        # transform=True applies each scan position's own pose, so an E57 with registered scans comes out as one cloud.
        data = scan.read_scan(index, colors=True, ignore_missing_fields=True, transform=True)
        xyz = np.stack([data['cartesianX'], data['cartesianY'], data['cartesianZ']], 1).astype(np.float64)
        rgb = np.stack([data[k] for k in ('colorRed', 'colorGreen', 'colorBlue')], 1).astype(np.uint8) if 'colorRed' in data else None
        for start in range(0, len(xyz), CHUNK):
            yield xyz[start:start + CHUNK], (rgb[start:start + CHUNK] if rgb is not None else None)


READERS = {'.ply': ply_chunks, '.las': las_chunks, '.laz': las_chunks, '.e57': e57_chunks}


def voxel_keys(xyz, origin, size):
    import numpy as np
    cells = np.clip(np.floor((xyz - origin) / size), 0, 2 ** 21 - 1).astype(np.int64)
    return (cells[:, 0] << 42) | (cells[:, 1] << 21) | cells[:, 2]


def thin(xyz, rgb, origin, size):
    """One point per voxel: the first one met, so the result does not depend on chunking or on a random seed."""
    import numpy as np
    _, first = np.unique(voxel_keys(xyz, origin, size), return_index=True)
    first.sort()
    return xyz[first], rgb[first]


def read_thinned(path: Path, budget: int = BUDGET):
    """The scan at one point per voxel, with the smallest voxel (from FINEST_VOXEL up) that fits the budget.
    Returns (xyz, rgb, facts). Non-finite points are dropped and counted."""
    import numpy as np
    reader = READERS.get(path.suffix.lower())
    if reader is None:
        raise ValueError('Scans must be PLY, LAS, LAZ or E57.')
    kept_xyz, kept_rgb, total, dropped, coloured, origin = [], [], 0, 0, True, None
    for xyz, rgb in reader(path):
        total += len(xyz)
        finite = np.isfinite(xyz).all(1)
        dropped += int((~finite).sum())
        xyz = xyz[finite]
        if rgb is None:
            coloured, rgb = False, np.full((len(xyz), 3), 180, np.uint8)
        else:
            rgb = rgb[finite]
        if not len(xyz):
            continue
        if origin is None:
            # Anchored on the file's first point, not on a chunk, so the result is the same however the file is read.
            # That point sits mid-range of the 2^21 cells per axis, leaving about 20 km either side.
            origin = np.floor(xyz[0] / FINEST_VOXEL) * FINEST_VOXEL - 2 ** 20 * FINEST_VOXEL
        xyz, rgb = thin(xyz, rgb, origin, FINEST_VOXEL)
        kept_xyz.append(xyz); kept_rgb.append(rgb)
    if not kept_xyz:
        raise ValueError('The scan holds no usable points.')
    xyz, rgb = thin(np.concatenate(kept_xyz), np.concatenate(kept_rgb), origin, FINEST_VOXEL)
    size = FINEST_VOXEL
    while len(xyz) > budget:
        # Surfaces scale with the square of the voxel edge; the 1.05 keeps the loop short without overshooting far.
        size = round(size * max(1.05, math.sqrt(len(xyz) / budget) * 0.98), 4)
        xyz, rgb = thin(xyz, rgb, origin, size)
    return xyz, rgb, {'points_in_file': total, 'non_finite_dropped': dropped, 'voxel_metres': size, 'points_kept': len(xyz), 'colour_in_file': coloured}


def to_y_up(xyz, up: str):
    """Scanner coordinates to the worker's right-handed Y-up frame. Tripod scanners level themselves, so Z is up."""
    import numpy as np
    if up == 'y':
        return xyz
    if up == 'z':
        return np.stack([xyz[:, 0], xyz[:, 2], -xyz[:, 1]], 1)
    raise ValueError('The up axis must be z or y.')


def hand_off(path: Path, *, up: str = 'z', budget: int = BUDGET) -> tuple[dict, dict]:
    """(arena cloud, evidence) for one scan file."""
    try:
        from . import scene_usd
    except ImportError:
        import scene_usd
    started = time.monotonic()
    xyz, rgb, facts = read_thinned(path, budget)
    upright = to_y_up(xyz, up)
    rows = [[float(p[0]), float(p[1]), float(p[2]), int(c[0]), int(c[1]), int(c[2])] for p, c in zip(upright, rgb)]
    cloud = scene_usd.to_arena_cloud(rows, source=f'Laser scan {path.name}'[:160], metres_per_unit=1.0, budget=budget)
    # Not a reconstruction and not a tape measure: the metres are the scan file's own, taken as declared.
    cloud.update(kind='survey-scan-point-cloud', sourceFrame='survey-scan',
                 scale={'source': 'scan-file', 'metresPerUnit': 1.0, 'distance': None, 'spanUnits': None, 'selfReported': True, 'verified': False})
    # The compiler sizes its wall-coverage cells from this, so a large scan thinned coarsely keeps its walls.
    cloud['provenance']['voxelMetres'] = facts['voxel_metres']
    extent = [round(float(upright[:, axis].max() - upright[:, axis].min()), 3) for axis in range(3)]
    evidence = {'schema': 'brainsnn.survey-scan.v1', 'engine': 'survey-cloud',
                'file': {'name': path.name[:160], 'bytes': path.stat().st_size, 'sha256': file_sha256(path), 'format': path.suffix.lower().lstrip('.')},
                **facts, 'up_axis': up, 'extent_metres_xyz_y_up': extent,
                'units': 'metres as the scan file records them; declared, not verified',
                'registration': 'not done here: the file is read as one already-registered cloud',
                'floor': {'aligned': cloud['provenance']['floorAligned'], 'tilt_degrees': cloud['provenance']['floorTiltDegrees'],
                          'inlier_fraction': cloud['provenance']['floorInlierFraction']},
                'measured': True, 'metric_verified': False, 'collision_ready': False,
                'label': 'A laser scan thinned to one point per voxel for the scene compiler. The geometry is measured by the '
                         'scanner; the model built from it is automatic and unreviewed.',
                'elapsed_seconds': round(time.monotonic() - started, 3)}
    return cloud, evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--input', type=Path, required=True, help='one registered scan: .ply, .las, .laz or .e57')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--up', choices=['z', 'y'], default='z', help='the scan file\'s up axis (tripod scanners: z)')
    parser.add_argument('--compile', action='store_true', help='also run the scene compiler (needs --blender)')
    parser.add_argument('--blender', default='blender')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    cloud, evidence = hand_off(args.input.resolve(), up=args.up)
    (args.out / 'arena-cloud.json').write_text(json.dumps(cloud, allow_nan=False))
    if args.compile:
        try:
            from . import scene_usd
        except ImportError:
            import scene_usd
        started = time.monotonic()
        scene = scene_usd.compile_scene(args.out / 'arena-cloud.json', args.out / 'scene', blender=args.blender)
        evidence['scene'] = {'counts': scene.get('counts'), 'usd_written': bool((scene.get('usd') or {}).get('written')),
                             'ifc_written': bool((scene.get('ifc') or {}).get('written')), 'compile_seconds': round(time.monotonic() - started, 3)}
    (args.out / 'survey-scan.json').write_text(json.dumps(evidence, indent=2, allow_nan=False))
    print(json.dumps({k: evidence[k] for k in ('points_in_file', 'points_kept', 'voxel_metres', 'extent_metres_xyz_y_up', 'elapsed_seconds')}
                     | ({'scene': evidence['scene']} if 'scene' in evidence else {})))


if __name__ == '__main__':
    main()
