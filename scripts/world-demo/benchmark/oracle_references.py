"""Stand-in detections for reference_scale.py on a benchmark run: the true reference corners projected into the frames,
with pixel noise the size of a vision model's pointing error. It tests everything after detection (refinement,
measurement, agreement) against the true scale; it does not test the model. Label anything made with it "oracle".

usage: python oracle_references.py --truth truth.json --frames frames/ --reconstruction <reconstruction job dir>
                                   --out detections.json [--noise 10] [--per-reference 3] [--seed 0]
Prints the true metres per reconstruction unit (the camera similarity's scale), to pass to reference_scale.py as
--expected-metres-per-unit.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parents[2] / 'robotics' / 'world_worker'))
import pick_references as pr  # noqa: E402
import reference_scale as rs  # noqa: E402


def projected(truth, frames, reconstruction):
    """Every truth reference's corners in every frame that sees it whole, facing the camera and large enough to
    measure: [(reference, frame name, 4 x 2 pixels, smallest edge in pixels)], and the true metres per unit."""
    rec = json.loads((reconstruction / 'output/reconstruction.json').read_text())
    matched = pr.match_frames(reconstruction / 'colmap-work/images', frames); true_pos = {c['frame']: c['position'] for c in truth['cameras']}
    pairs = [(c['camera_center'], true_pos[matched[c['image']]['frame']]) for c in rec['cameras'] if c['image'] in matched]
    s, R, t = pr.similarity([p for p, _ in pairs], [q for _, q in pairs])  # truth ~ s R rec + t
    views, _ = rs.views(reconstruction); out = []
    for ref in truth.get('references', []):
        if 'corners' not in ref:
            continue
        G = np.asarray(ref['corners'], float); P = (G - t) @ R / s  # truth -> reconstruction
        normal = np.cross(P[1] - P[0], P[3] - P[0]); centre = P.mean(0)
        for v in views:
            M = v['cam_from_world']; cam = P @ M[:, :3].T + M[:, 3]
            if (cam[:, 2] <= 1e-6).any():
                continue
            uv = v['project'](cam); C = -M[:, :3].T @ M[:, 3]
            facing = abs(float(normal @ (C - centre))) / (np.linalg.norm(normal) * np.linalg.norm(C - centre))
            edges = [np.linalg.norm(uv[(k + 1) % 4] - uv[k]) for k in range(4)]
            if facing < .25 or min(edges) < rs.MIN_EDGE_PIXELS or (uv < 10).any() or (uv[:, 0] > v['width'] - 10).any() or (uv[:, 1] > v['height'] - 10).any():
                continue
            out.append((ref, v['name'], uv, min(edges)))
    return out, s


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--truth', type=Path, required=True); ap.add_argument('--frames', type=Path, required=True)
    ap.add_argument('--reconstruction', type=Path, required=True); ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--noise', type=float, default=10, help='pixels (standard deviation) added to each projected corner')
    ap.add_argument('--per-reference', type=int, default=3); ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()
    truth = json.loads(a.truth.read_text()); rng = np.random.default_rng(a.seed); out = []
    seen, s = projected(truth, a.frames, a.reconstruction)
    for ref in truth.get('references', []):
        options = sorted((o for o in seen if o[0]['name'] == ref['name']), key=lambda o: -o[3])[:a.per_reference]
        for _, name, uv, _ in options:
            out.append({'id': ref['id'], 'frame': name, 'corners': (uv + rng.normal(0, a.noise, uv.shape)).round(1).tolist(),
                        'confidence': 'high', 'by': f'oracle (truth projected, {a.noise:g} px noise)', 'truth': ref['name']})
    a.out.write_text(json.dumps(out, indent=1))
    print(json.dumps({'trueMetresPerUnit': s, 'detections': len(out), 'byReference': {r['name']: sum(d['truth'] == r['name'] for d in out) for r in truth.get('references', [])}}))


if __name__ == '__main__':
    main()
