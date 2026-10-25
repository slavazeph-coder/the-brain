"""Reference spans for a benchmark run: find the reconstructed points at the true landmarks, set the scale from the
calibration span the way a person does in the site, and write the withheld spans as #232's dimension-checks.json.

usage: python pick_references.py --truth truth.json --frames frames/ --reconstruction <reconstruction job dir> --out OUT
                                 [--radius 0.05] [--world brainsnn-r3f-app/public/world] [--spans office-spans.json]
<reconstruction job dir> holds output/ (sparse-preview.ply, reconstruction.json) and colmap-work/images (the frames the
worker sampled). Writes into OUT:
- brainsnn-point-cloud.json: the site's hand-off (toArenaCloud), scaled by the calibration span alone;
- dimension-checks.json: #232's schema, with point indices into that hand-off;
- references.json: each landmark's picked point and how far it sits from the landmark, every span's true and
  reconstructed length, and the landmarks no point was near.

The alignment only finds points. It is a similarity fit of the reconstruction's camera centres to the true camera
positions, matched by comparing each sampled frame with the rendered frames. Its scale is never used to measure.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
from scene_usd import read_ply  # noqa: E402  (the worker's own PLY reader)

TOLERANCE = {'absoluteMeters': 0.05, 'relative': 0.02}  # #232's default policy, not an achieved accuracy


def thumbnail(path, size=(64, 36)):
    return np.asarray(Image.open(path).convert('L').resize(size, Image.BILINEAR), float) / 255


def match_frames(images, frames):
    """Each sampled image's rendered frame: the one it differs from least (mean squared, 64 x 36 grey)."""
    rendered = sorted(frames.glob('frame_*.png')); bank = np.stack([thumbnail(p) for p in rendered])
    out = {}
    for img in sorted(images.glob('*.jpg')):
        err = ((bank - thumbnail(img)) ** 2).mean(axis=(1, 2)); k = int(err.argmin())
        out[img.name] = {'frame': int(rendered[k].stem.split('_')[1]), 'error': float(err[k])}
    return out


def similarity(src, dst):
    """Umeyama: scale s, rotation R, translation t with dst ~ s R src + t (least squares)."""
    src, dst = np.asarray(src, float), np.asarray(dst, float); ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md; U, S, Vt = np.linalg.svd(b.T @ a / len(src))
    E = np.eye(3); E[2, 2] = np.sign(np.linalg.det(U @ Vt)); R = U @ E @ Vt
    s = float(np.trace(np.diag(S) @ E) / (a ** 2).sum(1).mean()); t = md - s * R @ ms
    return s, R, t


def fingerprint(points):
    """#232's cloudPointsSha256: SHA-256 of the prefix, then each point's six values as little-endian float64."""
    h = hashlib.sha256(b'brainsnn.dimension-points.v1\0right-handed-y-up\0m\0')
    for p in points: h.update(struct.pack('<6d', *[float(v) for v in p[:6]]))
    return h.hexdigest()


def handoff(ply, out, world, k=1.0, distance=None, span=None):
    cmd = ['node', str(Path(__file__).with_name('handoff.mjs')), str(ply), str(out), repr(k)]
    if distance is not None: cmd += [repr(distance), repr(span)]
    subprocess.run(cmd + [str(world)], check=True, capture_output=True, cwd=ROOT)
    return json.loads(Path(out).read_text())


def apply(matrix, p):
    M = np.asarray(matrix, float); return M[:, :3] @ np.asarray(p, float) + M[:, 3]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--truth', type=Path, required=True); ap.add_argument('--frames', type=Path, required=True)
    ap.add_argument('--reconstruction', type=Path, required=True); ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--radius', type=float, default=0.05, help='metres: a landmark with no point this close has no endpoint')
    ap.add_argument('--world', type=Path, default=ROOT / 'brainsnn-r3f-app/public/world')
    ap.add_argument('--spans', type=Path, help="reference spans to use instead of truth.json's (lengths from its landmarks)")
    a = ap.parse_args(); a.out.mkdir(parents=True, exist_ok=False)
    truth = json.loads(a.truth.read_text()); rec = json.loads((a.reconstruction / 'output/reconstruction.json').read_text())
    if a.spans:
        truth['spans'] = [{**sp, 'distanceMeters': round(math.dist(truth['landmarks'][sp['from']], truth['landmarks'][sp['to']]), 6)}
                          for sp in json.loads(a.spans.read_text())]
    # 1. Which rendered frame each sampled image is, then align camera centres to the true camera positions.
    matched = match_frames(a.reconstruction / 'colmap-work/images', a.frames)
    true_pos = {c['frame']: c['position'] for c in truth['cameras']}
    pairs = [(c['camera_center'], true_pos[matched[c['image']]['frame']]) for c in rec['cameras'] if c['image'] in matched]
    s, R, t = similarity([p for p, _ in pairs], [q for _, q in pairs])
    residual = float(np.sqrt(np.mean([np.sum((s * R @ np.asarray(p) + t - np.asarray(q)) ** 2) for p, q in pairs])))
    # 2. The hand-off in reconstruction units: the same points, order and framing as the metric one (only scaled).
    ply = a.reconstruction / 'output/sparse-preview.ply'
    unit = handoff(ply, a.out / 'unit-cloud.json', a.world); P1 = np.asarray([p[:3] for p in unit['points']], float)
    def locate(name):
        """The hand-off point nearest a true landmark, and its distance from it in true metres."""
        g = np.asarray(truth['landmarks'][name], float); c = R.T @ (g - t) / s  # truth -> reconstruction frame
        q = apply(unit['fromSource'], c); d = np.linalg.norm(P1 - q, axis=1); i = int(d.argmin())
        return i, float(d[i] * s)
    found = {}
    for span in truth['spans']:
        for name in (span['from'], span['to']):
            if name not in found: found[name] = dict(zip(('index', 'offsetMeters'), locate(name)))
    usable = lambda sp: all(found[n]['offsetMeters'] <= a.radius for n in (sp['from'], sp['to']))
    cal = next((sp for sp in truth['spans'] if sp['role'] == 'calibration'), None)
    if cal is None or not usable(cal):
        sys.exit(f'The calibration span has no reconstructed endpoint within {a.radius} m of its landmarks: {found}')
    # 3. Scale from the calibration span alone, exactly as a person types a taped distance in the site.
    span_units = float(np.linalg.norm(P1[found[cal['from']]['index']] - P1[found[cal['to']]['index']]))
    k = cal['distanceMeters'] / span_units
    cloud = handoff(ply, a.out / 'brainsnn-point-cloud.json', a.world, k, cal['distanceMeters'], span_units)
    Pk = np.asarray([p[:3] for p in cloud['points']], float)
    if len(Pk) != len(P1) or not np.allclose(Pk, P1 * k, atol=1e-6 * max(1, k)):
        sys.exit('The metric hand-off does not keep the unit hand-off\'s point order; indices would not carry over.')
    (a.out / 'unit-cloud.json').unlink()
    # 4. #232's dimension checks, and our own record of every span.
    today = datetime.date.today().isoformat(); checks, spans = [], []
    for sp in truth['spans']:
        i, j = found[sp['from']]['index'], found[sp['to']]['index']; model = float(np.linalg.norm(Pk[i] - Pk[j]))
        row = {'id': sp['id'], 'label': sp['label'], 'role': sp['role'], 'trueMeters': sp['distanceMeters'], 'modelMeters': round(model, 4),
               'errorMeters': round(model - sp['distanceMeters'], 4), 'endpoints': [sp['from'], sp['to']], 'usable': usable(sp)}
        spans.append(row)
        if usable(sp):
            checks.append({'id': sp['id'], 'label': sp['label'], 'role': sp['role'], 'pointIndices': [i, j],
                           'distanceMeters': sp['distanceMeters'], 'uncertaintyMeters': 0.0005, 'method': 'manual-reference',
                           'instrument': 'Synthetic scene definition (scripts/world-demo/benchmark/build_office.py)', 'measuredOn': today,
                           'note': f"Endpoints: the reconstructed points nearest {sp['from']} and {sp['to']} "
                                   f"({found[sp['from']]['offsetMeters'] * 100:.1f} and {found[sp['to']]['offsetMeters'] * 100:.1f} cm away)"})
    (a.out / 'dimension-checks.json').write_text(json.dumps({'schema': 'brainsnn.dimension-checks.v1', 'cloudPointsSha256': fingerprint(cloud['points']),
        'coordinateFrame': 'right-handed-y-up', 'units': 'm', 'tolerance': TOLERANCE, 'checks': checks}, indent=1))
    (a.out / 'references.json').write_text(json.dumps({
        'schema': 'brainsnn.benchmark-references.v1', 'synthetic': True,
        'alignment': {'purpose': 'locating landmark points only; never used for scale', 'cameras': len(pairs),
                      'scale': s, 'rotation': R.tolist(), 'translation': t.tolist(), 'rmsMeters': residual,
                      'pairs': [{'reconstruction': list(p), 'truth': list(q)} for p, q in pairs],
                      'worstFrameMatchError': max(m['error'] for m in matched.values())},
        'calibration': {'span': cal['id'], 'trueMeters': cal['distanceMeters'], 'spanUnits': span_units, 'metresPerUnit': k},
        'landmarks': found, 'spans': spans, 'radiusMeters': a.radius}, indent=1))
    print(json.dumps({'cameras': len(pairs), 'alignment_rms_m': round(residual, 4), 'metres_per_unit': round(k, 5),
                      'checks': len(checks), 'spans': [(r['id'], r['trueMeters'], r['modelMeters'], r['usable']) for r in spans]}, indent=1))


if __name__ == '__main__':
    main()
