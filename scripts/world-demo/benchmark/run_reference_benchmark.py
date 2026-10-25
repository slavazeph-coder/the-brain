"""The reference-scale benchmark in one command: how close standard-size references put the scale to the true one.

usage: python run_reference_benchmark.py OUT [--reconstruction JOB] [--noise 0 5 10 20] [--claude] [--frames 12]
OUT is build_office.py's output (truth.json with its references, frames/, walkthrough.mp4).
1. Without --reconstruction it runs sparse_colmap.py on OUT/walkthrough.mp4 into OUT/reconstruction (pycolmap 4.2.1,
   FFmpeg); no worker is needed.
2. Oracle: the true corners projected into the frames with pixel noise, at each --noise level, through
   reference_scale.run. This tests everything after detection.
3. --claude (ANTHROPIC_API_KEY set): Claude finds the references in --frames frames. Its raw corners are scored
   against the true ones (pixels), then measured the same way. This is the real pipeline.
Writes OUT/reference-benchmark.json and prints one line per run: status, metres per unit, error against the truth.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import oracle_references as orc  # noqa: E402
import reference_scale as rs  # noqa: E402


def reconstruct(out):
    job = out / 'reconstruction'
    if (job / 'output' / 'reconstruction.json').is_file():
        return job
    video = out / 'walkthrough.mp4'
    manifest = out / 'reconstruction-input.json'
    manifest.write_text(json.dumps({'schema': 'brainsnn.adapter.v1', 'output_dir': str(job / 'output'),
                                    'inputs': [{'path': str(video.resolve()), 'name': video.name, 'kind': 'video', 'size': video.stat().st_size}]}))
    subprocess.run([sys.executable, str(ROOT / 'robotics/world_worker/sparse_colmap.py'), '--input-manifest', str(manifest)], check=True)
    return job


def pointing(detections, seen):
    """Each model detection's corners against the true projected corners of the nearest reference of its kind in that
    frame: mean corner distance in pixels, the corners matched in the best order round the face."""
    rows = []
    for det in detections:
        options = [(ref, uv) for ref, name, uv, _ in seen if name == det['frame'] and ref['id'] == det['id']]
        D = np.asarray(det['corners'], float)
        best = None
        for ref, uv in options:
            for flip in (False, True):
                U = uv[::-1] if flip else uv
                for k in range(4):
                    e = float(np.linalg.norm(np.roll(U, k, axis=0) - D, axis=1).mean())
                    if best is None or e < best[0]: best = (e, ref['name'])
        rows.append({'id': det['id'], 'frame': det['frame'], 'truth': best and best[1], 'meanCornerErrorPixels': best and round(best[0], 1)})
    return rows


def summary(report, true_k):
    k = report.get('metresPerUnit')
    return {'status': report['status'], 'metresPerUnit': k, 'relativeError': None if not k else round(k / true_k - 1, 5),
            'instances': len(report.get('instances') or []), 'used': sum(d.get('used', False) for d in report.get('detections', [])),
            'detections': len(report.get('detections', []))}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out', type=Path); ap.add_argument('--reconstruction', type=Path)
    ap.add_argument('--noise', type=float, nargs='*', default=[0, 5, 10, 20]); ap.add_argument('--claude', action='store_true')
    ap.add_argument('--frames', type=int, default=12); ap.add_argument('--per-reference', type=int, default=3)
    a = ap.parse_args()
    truth = json.loads((a.out / 'truth.json').read_text())
    job = a.reconstruction or reconstruct(a.out)
    seen, true_k = orc.projected(truth, a.out / 'frames', job)
    result = {'schema': 'brainsnn.reference-benchmark.v1', 'synthetic': True, 'trueMetresPerUnit': true_k, 'reconstruction': str(job),
              'visible': {r['name']: sum(o[0]['name'] == r['name'] for o in seen) for r in truth.get('references', [])}, 'runs': []}
    rng = np.random.default_rng(0)
    for noise in a.noise:
        dets = []
        for ref in truth.get('references', []):
            for _, name, uv, _ in sorted((o for o in seen if o[0]['name'] == ref['name']), key=lambda o: -o[3])[:a.per_reference]:
                dets.append({'id': ref['id'], 'frame': name, 'corners': (uv + rng.normal(0, noise, uv.shape)).tolist(), 'confidence': 'high',
                             'by': f'oracle ({noise:g} px)'})
        report = rs.run(job, detections=dets)
        result['runs'].append({'detector': f'oracle, {noise:g} px noise', **summary(report, true_k), 'report': report})
        print(json.dumps(result['runs'][-1] | {'report': None}))
    if a.claude:
        if not os.environ.get('ANTHROPIC_API_KEY'):
            sys.exit('--claude needs ANTHROPIC_API_KEY in the environment.')
        import anthropic
        views, _ = rs.views(job); chosen = rs.pick_frames(views, a.frames)
        found, model, usage = rs.ask(anthropic.Anthropic(), chosen)
        report = rs.run(job, detections=found)
        result['runs'].append({'detector': f'Claude ({model})', 'framesSent': len(chosen), 'usage': usage, 'pointing': pointing(found, seen),
                               **summary(report, true_k), 'report': report})
        print(json.dumps({k: v for k, v in result['runs'][-1].items() if k != 'report'}))
    (a.out / 'reference-benchmark.json').write_text(json.dumps(result, indent=1, default=float))


if __name__ == '__main__':
    main()
