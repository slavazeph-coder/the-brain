"""The whole benchmark after the render, through a running worker whose job directory is on this machine.

usage: WORLD_WORKER_URL=... WORLD_WORKER_TOKEN=... python run_benchmark.py OUT --jobs <worker dir>/jobs [--radius 0.05] [--world DIR]
       [--spans FILE] [--reconstruction-job ID] [--refs NAME]
OUT is build_office.py's output directory. Steps, each the same as a person's in the site:
1. colmap-sparse on OUT/walkthrough.mp4;
2. pick_references.py: the landmark points, the scale from the calibration span, the withheld spans as checks;
3. scene-usd on the metric hand-off with the checks embedded, reading the reconstruction's frames;
4. score_against_truth.py on the compiled scene.
Writes OUT/<refs>/: the references, truth-score.json and run.json (the job ids), and prints both reports' summaries.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from worker_client import run  # noqa: E402


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out', type=Path); ap.add_argument('--jobs', type=Path, required=True)
    ap.add_argument('--radius', default='0.05')
    ap.add_argument('--world', type=Path, help="the site's world directory whose hand-off to use (default: this checkout's)")
    ap.add_argument('--spans', type=Path, help="reference spans to use instead of truth.json's")
    ap.add_argument('--reconstruction-job', help='reuse this finished colmap-sparse job instead of reconstructing again')
    ap.add_argument('--refs', default='refs', help='name of the references directory under OUT (one per variant)')
    a = ap.parse_args()
    out, refs = a.out, a.out / a.refs
    rec = {'id': a.reconstruction_job, 'status': 'complete'} if a.reconstruction_job else run('colmap-sparse', [out / 'walkthrough.mp4'])
    if rec['status'] != 'complete': sys.exit(f"colmap-sparse {rec['status']}: {rec.get('error')}")
    subprocess.run([sys.executable, str(HERE / 'pick_references.py'), '--truth', str(out / 'truth.json'), '--frames', str(out / 'frames'),
                    '--reconstruction', str(a.jobs / rec['id']), '--out', str(refs), '--radius', a.radius,
                    *(['--world', str(a.world)] if a.world else []), *(['--spans', str(a.spans)] if a.spans else [])], check=True)
    cloud = json.loads((refs / 'brainsnn-point-cloud.json').read_text())
    cloud['measurementChecks'] = json.loads((refs / 'dimension-checks.json').read_text())
    (refs / 'cloud-with-checks.json').write_text(json.dumps(cloud))
    scene = run('scene-usd', [refs / 'cloud-with-checks.json'], source_job=rec['id'])
    (refs / 'run.json').write_text(json.dumps({'reconstruction': rec['id'], 'scene': scene['id'], 'sceneStatus': scene['status'],
                                               'world': str(a.world or 'this checkout')}, indent=1))
    if scene['status'] != 'complete': sys.exit(f"scene-usd {scene['status']}: {scene.get('error')}")
    job = a.jobs / scene['id'] / 'output'
    subprocess.run([sys.executable, str(HERE / 'score_against_truth.py'), '--truth', str(out / 'truth.json'), '--references',
                    str(refs / 'references.json'), '--job', str(job), '--out', str(refs / 'truth-score.json')], check=True)
    report = job / 'scene-measurements.json'
    if report.exists():
        r = json.loads(report.read_text())
        print(json.dumps({k: r[k] for k in ('status', 'summary') if k in r}, indent=1))


if __name__ == '__main__':
    main()
