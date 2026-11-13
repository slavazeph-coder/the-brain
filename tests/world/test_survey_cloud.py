"""Laser-scan input: reading a scan file, thinning it to the compiler's budget, the Z-up turn and the hand-off record.
The scans here are authored rooms, not captures; the real-scan check is in docs/world-laser-scan-input.md."""
from pathlib import Path
import sys

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
sys.path.insert(0, str(ROOT / 'robotics' / 'scene_compiler'))
import scene_compiler as sc  # noqa: E402
import survey_cloud as sv  # noqa: E402


def room(n=40_000, seed=1):
    """A 5 x 4 x 3 m room in scanner coordinates (Z up): floor, ceiling and four walls, with 3 mm of noise."""
    rng = np.random.default_rng(seed)
    u, v, h = rng.uniform(0, 5, n), rng.uniform(0, 4, n), rng.uniform(0, 3, n)
    zero = np.zeros(n)
    faces = [np.stack([u, v, zero], 1), np.stack([u, v, zero + 3], 1), np.stack([u, zero, h], 1),
             np.stack([u, zero + 4, h], 1), np.stack([zero, v, h], 1), np.stack([zero + 5, v, h], 1)]
    xyz = (np.concatenate(faces) + rng.normal(0, .003, (6 * n, 3))).astype(np.float32)
    rgb = rng.integers(0, 255, (len(xyz), 3), dtype=np.uint8)
    return xyz, rgb


def write_ply(path, xyz, rgb=None, *, layout='binary_little_endian', intensity=True, camera=True):
    """A PLY as scanner software writes it: an extra per-point field and a trailing camera element."""
    fields = [('x', 'f4'), ('y', 'f4'), ('z', 'f4')] + ([('intensity', 'f4')] if intensity else []) \
        + ([('red', 'u1'), ('green', 'u1'), ('blue', 'u1')] if rgb is not None else [])
    names = {'f4': 'float', 'u1': 'uchar'}
    header = ['ply', f'format {layout} 1.0', 'comment authored test scan', f'element vertex {len(xyz)}',
              *[f'property {names[kind]} {name}' for name, kind in fields],
              *(['element camera 1', 'property float view_px'] if camera else []), 'end_header']
    with open(path, 'wb') as stream:
        stream.write(('\n'.join(header) + '\n').encode('ascii'))
        if layout == 'ascii':
            for i, p in enumerate(xyz):
                row = [*map(repr, map(float, p)), *(['0.5'] if intensity else []), *(map(str, rgb[i]) if rgb is not None else [])]
                stream.write((' '.join(row) + '\n').encode('ascii'))
        else:
            order = '<' if layout == 'binary_little_endian' else '>'
            record = np.zeros(len(xyz), np.dtype([(name, order + kind) for name, kind in fields]))
            record['x'], record['y'], record['z'] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
            if rgb is not None:
                record['red'], record['green'], record['blue'] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
            stream.write(record.tobytes())
        if camera:
            stream.write(b'\x00\x00\x00\x00' if layout != 'ascii' else b'0\n')


def read_all(path):
    chunks = list(sv.ply_chunks(path))
    return np.concatenate([c[0] for c in chunks]), (np.concatenate([c[1] for c in chunks]) if chunks[0][1] is not None else None)


@pytest.mark.parametrize('layout', ['binary_little_endian', 'binary_big_endian', 'ascii'])
def test_a_scanner_ply_reads_back_point_for_point(tmp_path, layout):
    xyz, rgb = room(n=300)
    write_ply(tmp_path / 'scan.ply', xyz, rgb, layout=layout)
    got_xyz, got_rgb = read_all(tmp_path / 'scan.ply')
    assert got_xyz.shape == xyz.shape and np.allclose(got_xyz, xyz, atol=1e-6)
    assert np.array_equal(got_rgb, rgb)


def test_a_scan_without_colour_is_read_and_says_so(tmp_path):
    xyz, _ = room(n=300)
    write_ply(tmp_path / 'grey.ply', xyz, None, intensity=False, camera=False)
    assert read_all(tmp_path / 'grey.ply')[1] is None
    _, rgb, facts = sv.read_thinned(tmp_path / 'grey.ply')
    assert facts['colour_in_file'] is False and set(np.unique(rgb)) == {180}


def test_files_that_are_not_a_usable_scan_are_refused_by_name(tmp_path):
    xyz, rgb = room(n=50)
    write_ply(tmp_path / 'ok.ply', xyz, rgb)
    whole = (tmp_path / 'ok.ply').read_bytes()
    cases = {'cut.ply': (whole[:-200], 'ends before its vertex count'),
             'text.ply': (b'not a scan\n', 'Not a PLY'),
             'faces.ply': (b'ply\nformat ascii 1.0\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n', 'vertices first'),
             'flat.ply': (b'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nend_header\n0 0\n', 'need x, y and z'),
             'list.ply': (b'ply\nformat ascii 1.0\nelement vertex 1\nproperty list uchar int k\nend_header\n', 'does not support')}
    for name, (data, message) in cases.items():
        (tmp_path / name).write_bytes(data)
        with pytest.raises(ValueError, match=message):
            read_all(tmp_path / name)
    (tmp_path / 'scan.xyz').write_text('0 0 0\n')
    with pytest.raises(ValueError, match='PLY, LAS, LAZ or E57'):
        sv.read_thinned(tmp_path / 'scan.xyz')
    for suffix, package in (('.las', 'laspy'), ('.e57', 'pye57')):
        try:
            __import__(package)
        except ImportError:
            (tmp_path / f'scan{suffix}').write_bytes(b'\x00' * 64)
            with pytest.raises(ValueError, match=package):
                sv.read_thinned(tmp_path / f'scan{suffix}')


def test_thinning_fits_the_budget_and_does_not_depend_on_how_the_file_is_read(tmp_path, monkeypatch):
    xyz, rgb = room()
    xyz[7] = np.nan  # scanners write these for returns they could not range
    write_ply(tmp_path / 'room.ply', xyz, rgb)
    kept, colours, facts = sv.read_thinned(tmp_path / 'room.ply', budget=20_000)
    assert facts['points_in_file'] == len(xyz) and facts['non_finite_dropped'] == 1
    assert 10_000 < len(kept) <= 20_000 and facts['points_kept'] == len(kept) and facts['voxel_metres'] >= sv.FINEST_VOXEL
    assert np.isfinite(kept).all() and len(colours) == len(kept)
    # One point per voxel over 94 m² of surface: about area / voxel² points, whatever the scanner's own density was.
    expected = 94 / facts['voxel_metres'] ** 2
    assert .5 * expected < len(kept) < 2.5 * expected, (len(kept), expected)
    monkeypatch.setattr(sv, 'CHUNK', 7_000)
    again, colours_again, facts_again = sv.read_thinned(tmp_path / 'room.ply', budget=20_000)
    assert np.array_equal(again, kept) and np.array_equal(colours_again, colours) and facts_again == facts


def test_the_hand_off_is_upright_in_metres_and_says_where_the_metres_come_from(tmp_path):
    xyz, rgb = room()
    write_ply(tmp_path / 'room.ply', xyz, rgb)
    cloud, evidence = sv.hand_off(tmp_path / 'room.ply')
    heights = np.array([p[1] for p in cloud['points']])
    assert 2.7 < heights.max() - heights.min() < 3.1, 'the scanner\'s Z is the worker\'s up'
    assert abs(float(np.percentile(heights, 2))) < .1, 'the floor is at zero'
    assert cloud['units'] == 'm' and cloud['sourceFrame'] == 'survey-scan' and cloud['coordinateFrame'] == 'right-handed-y-up'
    assert cloud['scale'] == {'source': 'scan-file', 'metresPerUnit': 1.0, 'distance': None, 'spanUnits': None, 'selfReported': True, 'verified': False}
    assert sc.measured_scan(cloud) and not sc.multi_view(cloud)
    assert len(cloud['points']) <= sv.BUDGET
    assert evidence['schema'] == 'brainsnn.survey-scan.v1' and len(evidence['file']['sha256']) == 64 and evidence['file']['format'] == 'ply'
    assert evidence['measured'] is True and evidence['metric_verified'] is False and evidence['collision_ready'] is False
    assert evidence['up_axis'] == 'z' and evidence['points_in_file'] == len(xyz)
    assert [round(v) for v in evidence['extent_metres_xyz_y_up']] == [5, 3, 4]
    # The same room handed over as Y-up is not turned again.
    yup = np.stack([xyz[:, 0], xyz[:, 2], -xyz[:, 1]], 1)
    write_ply(tmp_path / 'yup.ply', yup, rgb)
    other, _ = sv.hand_off(tmp_path / 'yup.ply', up='y')
    span = np.ptp(np.array([p[1] for p in other['points']]))
    assert 2.7 < span < 3.1
    with pytest.raises(ValueError, match='z or y'):
        sv.to_y_up(xyz, 'x')


def test_the_compiler_finds_the_four_walls_of_a_scanned_room(tmp_path):
    xyz, rgb = room()
    write_ply(tmp_path / 'room.ply', xyz, rgb)
    cloud, _ = sv.hand_off(tmp_path / 'room.ply')
    _, walls, _, _ = sc.analyse(cloud['points'], cloud['floorEstimate']['y'] if cloud.get('floorEstimate') else 0.0, True, dense=sc.measured_scan(cloud))
    lengths = sorted(round(w['length']) for w in walls)
    assert lengths == [4, 4, 5, 5], lengths
