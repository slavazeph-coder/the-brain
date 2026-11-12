"""splat_compact: a Gaussian PLY becomes the viewer's 32-byte records, most visible first, with honest evidence."""
import json
import struct
import sys
from pathlib import Path
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import splat_compact  # noqa: E402

PROPS = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'f_rest_0', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']


def write_gaussian_ply(path: Path, rows):
    header = 'ply\nformat binary_little_endian 1.0\nelement vertex %d\n' % len(rows) + ''.join(f'property float {p}\n' for p in PROPS) + 'end_header\n'
    body = b''.join(struct.pack('<%df' % len(PROPS), *row) for row in rows)
    path.write_bytes(header.encode('ascii') + body)


def gaussian(x, y, z, *, opacity_logit, log_scale, rgb_dc, rot=(1, 0, 0, 0)):
    return [x, y, z, 0, 0, 0, *rgb_dc, 0, opacity_logit, log_scale, log_scale, log_scale, *rot]


def test_compact_orders_by_visibility_and_writes_32_byte_records(tmp_path):
    ply = tmp_path / 'g.ply'
    rows = [gaussian(0, 0, 0, opacity_logit=4, log_scale=-2, rgb_dc=(2.0, -2.0, 0)),   # bright red, visible
            gaussian(1, 2, 3, opacity_logit=-6, log_scale=-2, rgb_dc=(0, 0, 0)),       # almost transparent
            gaussian(5, 5, 5, opacity_logit=4, log_scale=-5, rgb_dc=(0, 0, 0)),        # tiny
            [float('nan')] + gaussian(0, 0, 0, opacity_logit=4, log_scale=-2, rgb_dc=(0, 0, 0))[1:]]  # broken
    write_gaussian_ply(ply, rows)
    data = splat_compact.read_gaussian_ply(ply)
    blob, kept, total, dropped = splat_compact.compact(data, max_gaussians=2, core_percentile=0, min_opacity=0)
    assert (kept, total) == (2, 4) and len(blob) == 64 and dropped['not_finite'] == 1
    p0 = np.frombuffer(blob[:12], '<f4'); c0 = np.frombuffer(blob[24:28], 'u1'); r0 = np.frombuffer(blob[28:32], 'u1')
    assert np.allclose(p0, [0, 0, 0]) and c0[0] == 255 and c0[1] == 0 and c0[3] in (250, 251), (c0,)  # 0.5 + 0.2821·2 clamps to 1 → red, near-opaque first
    assert list(r0) == [255, 128, 128, 128]
    p1 = np.frombuffer(blob[32:44], '<f4'); assert np.allclose(p1, [5, 5, 5])  # most opaque first: the tiny opaque one, then the faint one is cut by max_gaussians


def test_colmap_frame_flip_turns_positions_and_rotations(tmp_path):
    ply = tmp_path / 'g.ply'; write_gaussian_ply(ply, [gaussian(1, 2, 3, opacity_logit=4, log_scale=-2, rgb_dc=(0, 0, 0), rot=(0.7071068, 0, 0.7071068, 0))] * 3)
    blob, kept, _, _ = splat_compact.compact(splat_compact.read_gaussian_ply(ply), max_gaussians=3, core_percentile=0, frame='colmap')
    assert np.allclose(np.frombuffer(blob[:12], '<f4'), [1, -2, -3])
    r = (np.frombuffer(blob[28:32], 'u1').astype(float) - 128) / 128  # stored (w, x, y, z): a half turn about x applied to a 90° turn about y
    assert np.allclose(r, [0, 0.7071068, 0, 0.7071068], atol=0.02), r  # (-x, w, -z, y)


def test_rejects_incomplete_or_ascii_ply(tmp_path):
    ascii_ply = tmp_path / 'a.ply'; ascii_ply.write_text('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0\n')
    with pytest.raises(ValueError, match='binary little-endian'):
        splat_compact.read_gaussian_ply(ascii_ply)
    plain = tmp_path / 'p.ply'; plain.write_bytes(b'ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n' + struct.pack('<3f', 0, 0, 0))
    with pytest.raises(ValueError, match='Not a complete Gaussian PLY'):
        splat_compact.read_gaussian_ply(plain)


def test_cli_writes_splat_and_evidence_with_held_out_numbers(tmp_path):
    ply = tmp_path / 'g.ply'; write_gaussian_ply(ply, [gaussian(i, 0, 0, opacity_logit=2, log_scale=-2, rgb_dc=(0, 0, 0)) for i in range(10)])
    metrics = tmp_path / 'metrics.json'; metrics.write_text(json.dumps({'mean_psnr': 21.04, 'mean_ssim': 0.8412, 'mean_lpips': 0.31, 'other': 'x'}))
    out, ev = tmp_path / 'v.splat', tmp_path / 'v.json'
    sys.argv = ['splat_compact', str(ply), str(out), '--max-gaussians', '6', '--metrics', str(metrics), '--evidence', str(ev)]
    splat_compact.main()
    e = json.loads(ev.read_text())
    assert out.stat().st_size == 6 * 32 and e['gaussians_written'] == 6 and e['gaussians_total'] == 10 and e['filters']['max_scale_m'] == 0.5
    assert e['held_out'] == {'psnr': 21.04, 'ssim': 0.8412, 'lpips': 0.31} and e['metric_verified'] is False and e['collision_geometry'] is False
    assert e['fits_viewer_limit'] is True and e['role'] == 'appearance'
