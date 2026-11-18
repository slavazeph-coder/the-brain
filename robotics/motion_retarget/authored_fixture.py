"""Author a short arm sweep on the Apache-licensed SOMA reference rig.

This is a procedural test animation, not recorded human motion. It uses the
package's neutral rig, never assets/motions or the restricted Bones examples.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path

from .setup_runtime import ZERO
from .validation import BVH, MAX_BVH_BYTES, parse_bvh, read_regular


def authored_sweep(runtime_dir: Path, *, frames=31, fps=30.) -> bytes:
    if type(frames) is not int or not 2 <= frames <= 1800 or not 1 <= fps <= 240:
        raise ValueError('Authored fixture frame count/FPS is out of range.')
    neutral = parse_bvh(read_regular(runtime_dir / ZERO, MAX_BVH_BYTES), qualification_reference=True)
    cursor = 0; elbow = shoulder = None
    for j in neutral.joints:
        if j['name'] == 'LeftForeArm':
            elbow = cursor + j['channels'].index('Zrotation')
        if j['name'] == 'LeftArm':
            shoulder = cursor + j['channels'].index('Yrotation')
        cursor += len(j['channels'])
    if elbow is None or shoulder is None:
        raise ValueError('Pinned SOMA reference rig is incomplete.')
    rows = []
    for index in range(frames):
        row = list(neutral.frames[0])
        phase = math.sin(math.pi * index / (frames - 1)) ** 2
        row[elbow] += 35 * phase
        row[shoulder] += 12 * phase
        rows.append(row)
    return BVH(copy.deepcopy(neutral.joints), rows, 1 / fps).canonical_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--frames', type=int, default=31)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'authored-arm-sweep.bvh').write_bytes(authored_sweep(args.runtime_dir, frames=args.frames))
    (args.out / 'retarget-options.json').write_text(json.dumps({
        'schema': 'brainsnn.motion-retarget-options.v1', 'target': 'unitree_g1',
        'source_units': 'cm', 'source_up_axis': 'Y', 'source_facing': 'Mujoco', 'fps': 30.0}) + '\n')
    print('Authored procedural arm-sweep fixture; not a human capture or physical validation.')


if __name__ == '__main__':
    main()
