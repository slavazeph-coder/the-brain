"""Manual fourth-engine acceptance through the real local authenticated API.

This is deliberately separate from startup and from the three existing engines.
It creates only original mechanical fixtures, requires explicit invocation and
an idle worker, preserves private receipts, and never claims human validity.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from robotics.biomechanics import VERSION, NATIVE_BUILD
from robotics.biomechanics.setup_runtime import WHEELS
from robotics.biomechanics.validation import strict_json
from robotics.world_worker.deploy.railway.layers_acceptance import (
    LocalClient, deployment_identity, encode, owner_credential, require,
    require_idle, sha, write_receipt, SHA,
)

ROOT = Path(__file__).resolve().parents[4]
CASES = ('kinematics', 'inverse-dynamics-none-declared', 'inverse-dynamics-supplied')


def authored_inputs(native_python):
    """Use the installed native package to serialize our original model only."""
    native_python = Path(native_python)
    require(native_python.is_absolute() and native_python.is_file(), 'Use the installed isolated native Python.')
    subprocess.run([str(native_python), '-m', 'robotics.biomechanics.setup_runtime', '--verify-only'],
                   cwd=ROOT, check=True, timeout=60, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    receipt = native_python.parent.parent / 'brainsnn-opensim-runtime.json'
    require(receipt.is_file() and not receipt.is_symlink() and receipt.stat().st_size <= 256 * 1024, 'Missing native runtime receipt.')
    runtime_raw = receipt.read_bytes()
    runtime = json.loads(runtime_raw)
    with tempfile.TemporaryDirectory(prefix='brainsnn-biomechanics-acceptance-') as directory:
        path = Path(directory)
        subprocess.run([str(native_python), str(ROOT / 'robotics/biomechanics/authored_fixture.py'), '--out', str(path)],
                       cwd=path, check=True, timeout=60, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        raw = {name: (path / name).read_bytes() for name in (
            'authored-pendulum.osim', 'authored-motion.mot', 'kinematics-options.json',
            'inverse-dynamics-options.json', 'authored-loads.json')}
    require(all(0 < len(value) <= 8 * 1024**2 for value in raw.values()), 'Authored fixture exceeded its profile.')
    base = [('biomech-model', 'model.osim', raw['authored-pendulum.osim']),
            ('biomech-motion', 'motion.mot', raw['authored-motion.mot'])]
    options = json.loads(raw['inverse-dynamics-options.json'])
    options['external_loads'] = 'supplied'
    options.pop('no_external_loads_reason')
    cases = {
        'kinematics': base + [('biomech-options', 'options.json', raw['kinematics-options.json'])],
        'inverse-dynamics-none-declared': base + [('biomech-options', 'options.json', raw['inverse-dynamics-options.json'])],
        'inverse-dynamics-supplied': base + [('biomech-options', 'options.json', encode(options)),
                                          ('biomech-loads', 'loads.json', raw['authored-loads.json'])],
    }
    return cases, {'manifest_sha256': sha(runtime_raw), **{key: runtime[key] for key in ('version', 'native_build', 'wheel_sha256')}}


def validate_outputs(inputs, payloads, expected_runtime=None):
    """Independent analytic checks on downloaded native outputs, no OpenSim call."""
    blobs = {kind: raw for kind, _, raw in inputs}
    originals = {'biomech-model': 'original-model.osim', 'biomech-motion': 'original-motion.mot',
                 'biomech-options': 'biomechanics-options.json', 'biomech-loads': 'external-loads.json'}
    for kind, raw in blobs.items():
        require(payloads.get(originals[kind]) == raw, 'Analysis did not preserve exact original bytes.')
    options = json.loads(blobs['biomech-options'])
    preview = strict_json(payloads['biomechanics-preview.json'])
    report = strict_json(payloads['biomechanics-report.json'])
    require(preview.get('schema') == 'brainsnn.biomechanics-preview.v1' and report.get('schema') == 'brainsnn.biomechanics-report.v1', 'Unsupported native result.')
    require(preview.get('analysis') == report.get('analysis') == options['analysis'], 'Analysis mode changed.')
    bindings = preview.get('bindings', {})
    expected = {'model_sha256': sha(blobs['biomech-model']), 'motion_sha256': sha(blobs['biomech-motion']),
                'options_sha256': sha(blobs['biomech-options']), 'loads_sha256': sha(blobs['biomech-loads']) if 'biomech-loads' in blobs else None,
                'analysis_model_sha256': sha(payloads['analysis-model.osim'])}
    require(all(bindings.get(key) == value for key, value in expected.items()) and bindings == report.get('bindings'), 'Native output source binding changed.')
    require(isinstance(bindings.get('runtime_manifest_sha256'), str) and bool(SHA.fullmatch(bindings['runtime_manifest_sha256'])), 'Missing runtime binding.')
    require(report.get('preview_sha256') == sha(payloads['biomechanics-preview.json']), 'Report does not bind the actual preview bytes.')
    runtime = preview.get('runtime', {})
    require(runtime == report.get('runtime') and runtime.get('version') == VERSION and
            str(runtime.get('native_build', '')).startswith(NATIVE_BUILD) and runtime.get('wheel_sha256') in {row[1] for row in WHEELS.values()}, 'Unsupported native OpenSim runtime.')
    if expected_runtime is not None:
        require(bindings['runtime_manifest_sha256'] == expected_runtime['manifest_sha256'] and
                all(runtime.get(key) == expected_runtime[key] for key in ('version', 'native_build', 'wheel_sha256')), 'Result does not match the installed qualified native runtime.')
    for key in ('medical_validated', 'muscle_activations_estimated', 'ground_reaction_forces_estimated', 'forward_dynamics_executed'):
        require(preview.get(key) is False and report.get(key) is False, 'Unexpected physical, clinical or execution claim.')
    for key in ('external_loads_physically_verified', 'subject_anatomy_verified', 'source_is_video', 'markerless_capture_executed', 'enable_executed'):
        require(report.get(key) is False, 'Unexpected physical, clinical or execution claim.')
    times = preview['time_s']
    require(len(times) == report.get('frame_count') == 31 and all(math.isclose(t, i / 30, abs_tol=1e-9) for i, t in enumerate(times)), 'Authored timing changed.')
    require(preview.get('coordinate_frame') == 'right-handed-y-up' and preview.get('coordinate_names') == ['knee_angle_r'] and
            preview.get('coordinate_units') == ['rad'] and preview.get('muscle_names') == ['authored_flexor'] and
            preview.get('moment_arm_coordinate_names') == ['knee_angle_r'] and preview.get('mass_kg') == 3., 'Authored model identity or units changed.')
    require(preview.get('body_names') == ['upper_segment', 'lower_segment'] and preview.get('body_parents') == [-1, 0], 'Body hierarchy changed.')
    def finite_series(value):
        if isinstance(value, list):
            return all(finite_series(item) for item in value)
        return type(value) in (float, int) and math.isfinite(value) and abs(value) < 1e8
    for key in ('body_positions_m', 'body_rotations_xyzw', 'body_com_positions_m', 'joint_positions_m',
                'coordinate_values', 'com_positions_m', 'muscle_lengths_m', 'moment_arms_m'):
        require(isinstance(preview.get(key), list) and len(preview[key]) == 31 and finite_series(preview[key]), 'Nonfinite or incomplete native geometry.')
    errors = {'coordinate': 0., 'com_m': 0., 'muscle_length_m': 0., 'moment_arm_m': 0.}
    for i, t in enumerate(times):
        angle = .35 + .2 * t + .1 * t**2
        errors['coordinate'] = max(errors['coordinate'], abs(preview['coordinate_values'][i][0] - angle))
        com = [math.sin(angle) / 3, (1.75 - math.cos(angle)) / 3, 0.]
        errors['com_m'] = max(errors['com_m'], *(abs(a - b) for a, b in zip(preview['com_positions_m'][i], com)))
        dx, dy = .1 * math.cos(angle) + .8 * math.sin(angle) + .2, .1 * math.sin(angle) - .8 * math.cos(angle) - .4
        length = math.hypot(dx, dy)
        arm = -(dx * (-.1 * math.sin(angle) + .8 * math.cos(angle)) + dy * (.1 * math.cos(angle) + .8 * math.sin(angle))) / length
        errors['muscle_length_m'] = max(errors['muscle_length_m'], abs(preview['muscle_lengths_m'][i][0] - length))
        errors['moment_arm_m'] = max(errors['moment_arm_m'], abs(preview['moment_arms_m'][i][0][0] - arm))
    require(all(math.isfinite(value) and value < 1e-7 for value in errors.values()), 'Native geometry differs from the independent authored mechanism.')
    dynamics = options['analysis'] == 'inverse-dynamics'
    require(report.get('inverse_dynamics_executed') is dynamics, 'Inverse dynamics execution flag mismatch.')
    force_error = None
    if dynamics:
        data = preview['inverse_dynamics']
        require(data.get('coordinate_names') == ['knee_angle_r'] and data.get('units') == ['N m'] and
                data.get('external_loads_mode') == options['external_loads'] and report.get('external_loads_mode') == options['external_loads'], 'Dynamics units or load assumption changed.')
        actual = [row[0] for row in data['generalized_forces']]
        expected = [2 / 3 * .2 + 9.80665 * math.sin(.35 + .2 * t + .1 * t**2) - (2.2 if options['external_loads'] == 'supplied' else 0.) for t in times]
        require(len(actual) == 31 and finite_series(actual), 'Wrong or nonfinite inverse dynamics frames.')
        force_error = max(abs(a - b) for a, b in zip(actual, expected))
        require(math.isfinite(force_error) and force_error < 1e-6, 'Native inverse dynamics failed independent analytic torque/load check.')
        rows = list(csv.reader(io.StringIO(payloads['biomechanics-inverse-dynamics.csv'].decode())))
        require(len(rows) == 32 and rows[0] == ['time_s', 'knee_angle_r [N m]'] and
                all(len(row) == 2 and math.isclose(float(row[1]), actual[i], abs_tol=1e-10) and math.isclose(float(row[0]), times[i], abs_tol=1e-10) for i, row in enumerate(rows[1:])), 'CSV differs from displayed native forces.')
    else:
        require('inverse_dynamics' not in preview and 'biomechanics-inverse-dynamics.csv' not in payloads, 'Kinematics unexpectedly contains force estimates.')
    return {'analysis': options['analysis'], 'external_loads': options.get('external_loads'), 'frames': 31,
            'bindings': bindings, 'native_runtime': runtime, 'preview_sha256': report['preview_sha256'],
            'max_geometry_errors': errors, 'max_analytic_torque_error_Nm': force_error,
            'native_OpenSim_executed': True, 'clinical_validated': False, 'physical_accuracy_verified': False}


def run_acceptance(*, confirmed=False, receipt_path=Path('/data/biomechanics-acceptance.json'), env=None,
                   expected_commit=None, expected_deployment=None):
    require(confirmed is True, 'Explicit synthetic deployment-test confirmation is required.')
    env = os.environ if env is None else env
    identity = deployment_identity(env, expected_commit, expected_deployment)
    report = {'schema': 'brainsnn.hosted-biomechanics-acceptance.v1', 'run_id': str(uuid.uuid4()), 'status': 'started',
              'started_at': datetime.now(timezone.utc).isoformat(), **identity, 'script_sha256': sha(Path(__file__).read_bytes()),
              'source_kind': 'original authored mechanical model and motion', 'medical_validated': False,
              'physical_accuracy_verified': False, 'robot_control_enabled': False, 'jobs': [], 'results': {}}
    write_receipt(receipt_path, report)
    client = None
    try:
        root = Path(env.get('WORLD_WORKER_DIR', '/data/worker'))
        report['initial_all_owner_active_counts'] = require_idle(root)
        token = owner_credential(env)
        cases, runtime = authored_inputs(env.get('WORLD_BIOMECHANICS_PYTHON', '/opt/biomechanics/venv/bin/python'))
        report['qualified_native_runtime'] = runtime
        port_text = env.get('PORT', '8080')
        require(port_text.isdigit(), 'Invalid local worker port.')
        client = LocalClient(token, port=int(port_text), duration=900)
        caps = client.json('/v1/capabilities')
        require(caps.get('owner_id') == 'site-owner' and any(row.get('id') == 'biomechanics' and row.get('available') is True for row in caps.get('engines', [])), 'Native biomechanics must be available to the hosted site owner.')
        for case in CASES:
            require_idle(root)
            job = client.run('biomechanics', cases[case], report['run_id'])
            report['jobs'] = list(client.jobs)
            records, payloads = client.artifacts(job)
            report['results'][case] = {**validate_outputs(cases[case], payloads, runtime), 'artifacts': records}
            write_receipt(receipt_path, report)
        report.update(status='passed', all_download_hashes_verified=True)
    except Exception as error:
        report.update(status='failed', error_type=type(error).__name__)
        if client is not None:
            report['jobs'] = list(client.jobs)
            report['own_active_job_cancellation'] = client.cancel_own_active()
        raise
    finally:
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        write_receipt(receipt_path, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-synthetic-deployment-test', action='store_true')
    parser.add_argument('--receipt', type=Path, default=Path('/data/biomechanics-acceptance.json'))
    parser.add_argument('--expected-commit')
    parser.add_argument('--expected-deployment')
    args = parser.parse_args()
    report = run_acceptance(confirmed=args.confirm_synthetic_deployment_test, receipt_path=args.receipt,
                            expected_commit=args.expected_commit, expected_deployment=args.expected_deployment)
    print('BIOMECHANICS_HOSTED_ACCEPTANCE ' + json.dumps({'status': report['status'], 'commit_sha': report['commit_sha'],
          'deployment_id': report['deployment_id'], 'jobs': report['jobs'], 'receipt_sha256': sha(args.receipt.read_bytes())}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('BIOMECHANICS_HOSTED_ACCEPTANCE_FAILED ' + type(error).__name__, flush=True)
        sys.exit(1)
