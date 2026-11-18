"""Real build-time CPU qualification and Warp prewarm. Fails on any solver/output error."""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
from pathlib import Path
import platform

from . import UPSTREAM_COMMIT
from .authored_fixture import authored_sweep
from .validation import sha256


def qualify(runtime_dir: Path, output: Path) -> dict:
    from robotics.world_worker.motion_retarget import run_request
    output.mkdir(parents=True, exist_ok=True)
    source = output / 'authored-arm-sweep.bvh'
    opts = output / 'retarget-options.json'
    source.write_bytes(authored_sweep(runtime_dir, frames=31))
    opts.write_text(json.dumps({'schema': 'brainsnn.motion-retarget-options.v1', 'target': 'unitree_g1',
                               'source_units': 'cm', 'source_up_axis': 'Y', 'source_facing': 'Mujoco', 'fps': 30.}))
    os.environ['WORLD_SOMA_RUNTIME_DIR'] = str(runtime_dir.resolve())
    os.environ['WORLD_SOMA_DEVICE'] = 'cpu'
    request = {'schema': 'brainsnn.adapter.v1', 'inputs': [
        {'kind': 'motion', 'path': str(source), 'sha256': sha256(source.read_bytes())},
        {'kind': 'retarget', 'path': str(opts), 'sha256': sha256(opts.read_bytes())}],
        'output_dir': str(output / 'result')}
    report = run_request(request)
    result = output / 'result'
    preview = json.loads((result / 'motion-preview.json').read_text())
    assert (result / 'original-motion.bvh').read_bytes() == source.read_bytes()
    assert report['runtime']['commit'] == UPSTREAM_COMMIT
    assert preview['frame_count'] == 31 and math.isclose(preview['fps'], 30)
    assert len(preview['joint_order']) == 29 and report['diagnostics']['joint_limits']['violating_frames'] == 0
    rows = list(csv.reader((result / 'robot-reference.csv').open()))
    assert len(rows) == 32 and rows[0][7:] == preview['joint_order']
    maximum_delta = max(max(column) - min(column) for column in zip(*preview['joint_angles_rad']))
    assert maximum_delta > .05, 'Authored articulation did not produce changing robot joint angles.'
    for track in ('human', 'robot'):
        value = preview[track]
        assert len(value['positions']) == 31
        assert len(value['parents']) == len(value['joint_names'])
        assert all(-1 <= parent < i for i, parent in enumerate(value['parents']))
        assert all(math.isfinite(v) for frame in value['positions'] for point in frame for v in point)
    receipt = {'schema': 'brainsnn.soma-qualification.v1', 'passed': True,
               'evidence': 'real pinned upstream IK on authored procedural motion; no restricted sample dataset',
               'host': {'system': platform.system(), 'machine': platform.machine(), 'python': platform.python_version()},
               'runtime': report['runtime'], 'source_sha256': report['source_sha256'],
               'model_sha256': report['model_sha256'], 'frame_count': report['frame_count'], 'fps': report['fps'],
               'max_joint_excursion_rad': maximum_delta, 'elapsed_seconds': report['elapsed_seconds'],
               'csv_sha256': sha256((result / 'robot-reference.csv').read_bytes()),
               'preview_sha256': sha256((result / 'motion-preview.json').read_bytes()),
               'physics_executed': False, 'policy_trained': False, 'robot_control_enabled': False}
    (output / 'qualification.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(qualify(args.runtime_dir, args.out), indent=2))


if __name__ == '__main__':
    main()
