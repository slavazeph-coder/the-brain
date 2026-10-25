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


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--truth', type=Path, required=True); ap.add_argument('--frames', type=Path, required=True)
    ap.add_argument('--reconstruction', type=Path, required=True); ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--noise', type=float, default=10, help='pixels (standard deviation) added to each projected corner')
    ap.add_argument('--per-reference', type=int, default=3); ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()
    truth = json.loads(a.truth.read_text()); rec = json.loads((a.reconstruction / 'output/reconstruction.json').read_text())
    matched = pr.match_frames(a.reconstruction / 'colmap-work/images', a.frames); true_pos = {c['frame']: c['position'] for c in truth['cameras']}
    pairs = [(c['camera_center'], true_pos[matched[c['image']]['frame']]) for c in rec['cameras'] if c['image'] in matched]
    s, R, t = pr.similarity([p for p, _ in pairs], [q for _, q in pairs])  # truth ~ s R rec + t
    views, _ = rs.views(a.reconstruction); rng = np.random.default_rng(a.seed); out = []
    for ref in truth.get('references', []):
        if 'corners' not in ref:
            continue
        G = np.asarray(ref['corners'], float); P = (G - t) @ R / s  # truth -> reconstruction
        normal = np.cross(P[1] - P[0], P[3] - P[0]); centre = P.mean(0); options = []
        for v in views:
            M = v['cam_from_world']; cam = P @ M[:, :3].T + M[:, 3]
            if (cam[:, 2] <= 1e-6).any():
                continue
            uv = v['project'](cam); C = -M[:, :3].T @ M[:, 3]
            facing = abs(float(normal @ (C - centre))) / (np.linalg.norm(normal) * np.linalg.norm(C - centre))
            edges = [np.linalg.norm(uv[(k + 1) % 4] - uv[k]) for k in range(4)]
            if facing < .25 or min(edges) < rs.MIN_EDGE_PIXELS or (uv < 10).any() or (uv[:, 0] > v['width'] - 10).any() or (uv[:, 1] > v['height'] - 10).any():
                continue
            options.append((min(edges), v['name'], uv))
        for _, name, uv in sorted(options, key=lambda o: -o[0])[:a.per_reference]:
            out.append({'id': ref['id'], 'frame': name, 'corners': (uv + rng.normal(0, a.noise, uv.shape)).round(1).tolist(),
                        'confidence': 'high', 'by': f'oracle (truth projected, {a.noise:g} px noise)', 'truth': ref['name']})
    a.out.write_text(json.dumps(out, indent=1))
    print(json.dumps({'trueMetresPerUnit': s, 'detections': len(out), 'byReference': {r['name']: sum(d['truth'] == r['name'] for d in out) for r in truth.get('references', [])}}))


if __name__ == '__main__':
    main()
