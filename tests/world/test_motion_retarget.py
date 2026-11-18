"""Admission/provenance regressions plus opt-in REAL upstream CPU integration.

WORLD_SOMA_RUNTIME_DIR and WORLD_SOMA_TEST_PYTHON enable the real executable test.
No fixture substitutes for upstream IK, and no restricted motion examples are used.
"""
from __future__ import annotations

import csv
import json
import math
import os
from pathlib import Path
import subprocess

import pytest

from robotics.motion_retarget.validation import BVH, options_from_bytes, parse_bvh, sha256, validate_source
from robotics.world_worker.motion_retarget import run_request, validate_upload

OPTIONS = {'schema': 'brainsnn.motion-retarget-options.v1', 'target': 'unitree_g1',
           'source_units': 'cm', 'source_up_axis': 'Y', 'source_facing': 'Mujoco', 'fps': 30.}


def small_bvh():
    # An authored parser fixture, deliberately NOT represented as a SOMA rig.
    return BVH([{'name': 'Root', 'parent': -1, 'offset': [0, 0, 0],
                 'channels': ['Xposition', 'Yposition', 'Zposition', 'Zrotation', 'Yrotation', 'Xrotation']},
                {'name': 'Hips', 'parent': 0, 'offset': [0, 100, 0],
                 'channels': ['Zrotation', 'Yrotation', 'Xrotation']}],
               [[0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 10, 0, 0]], 1/30).canonical_bytes()


def test_frame_time_and_metres_are_preserved_without_resampling():
    source = parse_bvh(small_bvh())
    opts = options_from_bytes(json.dumps(OPTIONS).encode())
    validate_source(small_bvh(), opts)
    assert len(source.frames) == 2 and source.fps == pytest.approx(30)
    metres = parse_bvh(small_bvh())
    for joint in metres.joints:
        joint['offset'] = [v / 100 for v in joint['offset']]
    metres.frames[1][0] /= 100
    assert parse_bvh(metres.canonical_bytes('m')).frames == source.frames
    assert parse_bvh(metres.canonical_bytes('m')).joints == source.joints
    with pytest.raises(ValueError, match='FPS disagrees'):
        validate_source(small_bvh(), {**opts, 'fps': 120})


@pytest.mark.parametrize('replace,replacement', [
    (b'Frames: 2', b'Frames: 3'),
    (b'Frame Time: 0.0333333333333333', b'Frame Time: 0'),
    (b'JOINT Hips', b'JOINT Root'),
    (b'JOINT Hips', b'JOINT evil:Hips'),
    (b'OFFSET 0 100 0', b'OFFSET 0 nan 0'),
    (b'CHANNELS 3 Zrotation Yrotation Xrotation', b'CHANNELS 3 Zrotation Zrotation Xrotation'),
    (b'1 0 0 0 0 0 10 0 0', b'1 0 0 0 0 0 10 0'),
])
def test_rejects_malformed_or_ambiguous_bvh(replace, replacement):
    assert replace in small_bvh()
    with pytest.raises(ValueError):
        parse_bvh(small_bvh().replace(replace, replacement))


@pytest.mark.parametrize('change', [{'target': 'unitree_h2'}, {'source_up_axis': 'Z'},
    {'source_facing': 'SMPL'}, {'source_units': 'guess'}, {'fps': True}, {'fps': float('nan')},
    {'runtime_dir': '/tmp/attacker'}, {'device': 'cuda:0'}, {'enable_post_processing': False}])
def test_options_cannot_choose_code_device_or_unsafe_solver_settings(change):
    with pytest.raises(ValueError):
        options_from_bytes(json.dumps({**OPTIONS, **change}).encode())


def test_options_reject_duplicate_keys_and_oversized_json():
    raw = json.dumps(OPTIONS).encode()
    with pytest.raises(ValueError, match='Duplicate'):
        options_from_bytes(raw[:-1] + b',"target":"unitree_g1"}')
    with pytest.raises(ValueError):
        options_from_bytes(b' ' * 16385 + raw)


def test_topology_is_not_silently_remapped():
    other = parse_bvh(small_bvh())
    other.joints[1]['name'] = 'Chest'
    with pytest.raises(ValueError, match='hierarchy and order'):
        validate_source(small_bvh(), OPTIONS, other)


def test_upload_admission_symlinks_and_runtime_failure_publish_nothing(tmp_path, monkeypatch):
    # The HTTP worker validates filenames then stores content under extensionless IDs.
    source, opts = tmp_path / '1b93066a', tmp_path / '993b69a1'
    source.write_bytes(small_bvh()); opts.write_text(json.dumps(OPTIONS))
    assert validate_upload(source, 'motion')['frame_count'] == 2
    assert validate_upload(opts, 'retarget')['target'] == 'unitree_g1'
    link = tmp_path / 'link.bvh'; link.symlink_to(source)
    with pytest.raises(ValueError):
        validate_upload(link, 'motion')
    request = {'schema': 'brainsnn.adapter.v1', 'inputs': [
        {'kind': 'motion', 'path': str(source)}, {'kind': 'retarget', 'path': str(opts)}],
        'output_dir': str(tmp_path / 'result')}
    monkeypatch.delenv('WORLD_SOMA_RUNTIME_DIR', raising=False)
    with pytest.raises(RuntimeError, match='runtime unavailable'):
        run_request(request)
    assert not (tmp_path / 'result/manifest.json').exists()
    request['inputs'][0]['sha256'] = '0' * 64
    with pytest.raises(ValueError, match='SHA-256'):
        run_request(request)


def test_bvh_limits_bound_work_before_native_import():
    source = parse_bvh(small_bvh())
    source.frames *= 901
    with pytest.raises(ValueError):
        parse_bvh(source.canonical_bytes())
    source.frames = source.frames[:100]
    source.frame_time = 1
    with pytest.raises(ValueError, match='60 seconds'):
        parse_bvh(source.canonical_bytes())


def test_real_cpu_retarget_and_absolute_cli_from_private_cwd(tmp_path):
    runtime = os.environ.get('WORLD_SOMA_RUNTIME_DIR')
    python = os.environ.get('WORLD_SOMA_TEST_PYTHON')
    if not runtime or not python:
        pytest.skip('Real SOMA runtime not installed; run documented CPU qualification to enable.')
    root = Path(__file__).resolve().parents[2]
    fixture = tmp_path / 'source'
    subprocess.run([python, '-m', 'robotics.motion_retarget.authored_fixture', '--runtime-dir', runtime,
                    '--out', str(fixture)], cwd=root, check=True, capture_output=True, timeout=30)
    source, opts = fixture / 'authored-arm-sweep.bvh', fixture / 'retarget-options.json'
    stored_source, stored_opts = tmp_path / '8e04c4ff', tmp_path / 'cc5f774c'
    stored_source.write_bytes(source.read_bytes()); stored_opts.write_bytes(opts.read_bytes())
    source, opts = stored_source, stored_opts
    out = tmp_path / 'result'
    request = tmp_path / 'input.json'
    request.write_text(json.dumps({'schema': 'brainsnn.adapter.v1', 'inputs': [
        {'kind': 'motion', 'path': str(source), 'sha256': sha256(source.read_bytes())},
        {'kind': 'retarget', 'path': str(opts)}], 'output_dir': str(out)}))
    env = {key: value for key, value in os.environ.items() if key != 'PYTHONPATH'}
    env['WORLD_SOMA_DEVICE'] = 'cpu'
    completed = subprocess.run([python, str(root / 'robotics/world_worker/motion_retarget.py'),
                                '--input-manifest', str(request)], cwd=tmp_path, env=env,
                               capture_output=True, text=True, timeout=180)
    assert completed.returncode == 0, completed.stdout[-4000:] + completed.stderr[-4000:]
    report = json.loads((out / 'motion-reference.json').read_text())
    preview = json.loads((out / 'motion-preview.json').read_text())
    assert (out / 'original-motion.bvh').read_bytes() == source.read_bytes()
    assert report['fps'] == pytest.approx(30) and report['frame_count'] == 31
    assert preview['frame_times_seconds'][-1] == pytest.approx(1)
    assert report['runtime']['device'] == 'cpu' and report['runtime']['version'] == '0.2.1'
    assert report['diagnostics']['joint_limits']['violating_frames'] == 0
    assert len(report['diagnostics']['contact']['weights']) == 31
    assert not report['physics_executed'] and not report['policy_trained'] and not preview['robot_control_enabled']
    assert preview['source_sha256'] == report['source_sha256'] == sha256(source.read_bytes())
    assert preview['csv_sha256'] == sha256((out / 'robot-reference.csv').read_bytes())
    with (out / 'robot-reference.csv').open() as stream:
        rows = list(csv.reader(stream))
    assert rows[0][7:] == preview['joint_order'] and len(rows) == 32
    for frame, row in enumerate(rows[1:]):
        assert [math.radians(float(v)) for v in row[7:]] == pytest.approx(preview['joint_angles_rad'][frame], abs=1e-6)
    excursions = [max(column) - min(column) for column in zip(*preview['joint_angles_rad'])]
    assert max(excursions) > .05  # Real changing articulation, not a repeated neutral pose.
    for track in ('human', 'robot'):
        body = preview[track]
        assert len(body['positions']) == 31
        assert all(-1 <= parent < i for i, parent in enumerate(body['parents']))
        assert all(math.isfinite(v) for frame in body['positions'] for point in frame for v in point)
    # Output joint-order/schema must describe the actual model, not a generic stick figure.
    assert 'left_elbow_link' in preview['robot']['joint_names']
    assert len(preview['joint_order']) == 29
    assert report['artifacts']['motion-preview.json']['sha256'] == sha256((out / 'motion-preview.json').read_bytes())
