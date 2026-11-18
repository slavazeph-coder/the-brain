"""Real CPU qualification against independently calculated mechanical identities."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform

from .authored_fixture import write_example
from .validation import sha256
from robotics.world_worker.biomechanics import run_request


def qualify(output: Path):
    import numpy as np
    output.mkdir(parents=True, exist_ok=True)
    fixture = write_example(output / 'inputs')

    def execute(mode, options_file, loads=False):
        inputs = [('biomech-model', fixture / 'authored-pendulum.osim'),
                  ('biomech-motion', fixture / 'authored-motion.mot'), ('biomech-options', options_file)]
        if loads:
            inputs.append(('biomech-loads', fixture / 'authored-loads.json'))
        result = output / mode
        run_request({'schema': 'brainsnn.adapter.v1', 'output_dir': str(result),
                     'inputs': [{'kind': kind, 'path': str(path), 'sha256': sha256(path.read_bytes())} for kind, path in inputs]})
        for kind, path in inputs:
            name = {'biomech-model': 'original-model.osim', 'biomech-motion': 'original-motion.mot',
                    'biomech-options': 'biomechanics-options.json', 'biomech-loads': 'external-loads.json'}[kind]
            assert (result / name).read_bytes() == path.read_bytes()
        return json.loads((result / 'biomechanics-preview.json').read_text())

    kinematics = execute('kinematics', fixture / 'kinematics-options.json')
    assert 'inverse_dynamics' not in kinematics
    baseline = execute('no-contact', fixture / 'inverse-dynamics-options.json')
    options = json.loads((fixture / 'inverse-dynamics-options.json').read_text())
    options['external_loads'] = 'supplied'; options.pop('no_external_loads_reason')
    supplied = fixture / 'supplied-loads-options.json'
    supplied.write_text(json.dumps(options) + '\n')
    loaded = execute('supplied-loads', supplied, True)
    theta = np.asarray(baseline['coordinate_values'])[:, 0]
    torque = np.asarray(baseline['inverse_dynamics']['generalized_forces'])[:, 0]
    expected_torque = (2 / 3) * .2 + 9.80665 * np.sin(theta)
    torque_error = float(np.max(abs(torque - expected_torque)))
    load_error = float(np.max(abs(np.asarray(loaded['inverse_dynamics']['generalized_forces'])[:, 0] - (torque - 2.2))))
    lower_com = np.stack([.5 * np.sin(theta), .5 - .5 * np.cos(theta), np.zeros_like(theta)], axis=1)
    expected_com = (2 * lower_com + np.asarray([0, .75, 0])) / 3
    com_error = float(np.max(abs(np.asarray(baseline['com_positions_m']) - expected_com)))
    insertion = np.stack([.1 * np.cos(theta) + .8 * np.sin(theta), .5 + .1 * np.sin(theta) - .8 * np.cos(theta), np.zeros_like(theta)], axis=1)
    relative = insertion - np.asarray([-.2, .9, 0])
    length = np.linalg.norm(relative, axis=1)
    derivative = np.stack([-.1 * np.sin(theta) + .8 * np.cos(theta), .1 * np.cos(theta) + .8 * np.sin(theta), np.zeros_like(theta)], axis=1)
    moment_arm = -np.sum(relative * derivative, axis=1) / length
    length_error = float(np.max(abs(np.asarray(baseline['muscle_lengths_m'])[:, 0] - length)))
    moment_error = float(np.max(abs(np.asarray(baseline['moment_arms_m'])[:, 0, 0] - moment_arm)))
    assert torque_error < 1e-6, torque_error
    assert load_error < 1e-9, load_error
    assert com_error < 1e-10, com_error
    assert length_error < 1e-10, length_error
    assert moment_error < 1e-10, moment_error
    assert np.ptp(theta) > .29
    assert baseline['time_s'] == loaded['time_s'] == kinematics['time_s']
    receipt = {'schema': 'brainsnn.biomechanics-qualification.v1', 'passed': True,
               'evidence': 'Real pinned OpenSim CPU; authored mechanical model and analytic geometry/dynamics comparison.',
               'host': {'system': platform.system(), 'machine': platform.machine(), 'python': platform.python_version()},
               'runtime': baseline['runtime'], 'frames': len(theta),
               'max_inverse_torque_error_Nm': torque_error, 'max_supplied_load_effect_error_Nm': load_error,
               'max_com_error_m': com_error, 'max_muscle_length_error_m': length_error, 'max_moment_arm_error_m': moment_error,
               'source_preserved': True, 'medical_validated': False, 'real_person_capture': False,
               'forward_dynamics_executed': False, 'muscle_activations_estimated': False,
               'ground_reaction_forces_estimated': False}
    (output / 'qualification.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    qualify(parser.parse_args().out)


if __name__ == '__main__':
    main()
