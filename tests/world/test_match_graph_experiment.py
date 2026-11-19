"""CPU command orchestration on authored data, not learned SfM or physical proof."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import shutil
import sys
import time

import numpy as np
import pytest

from robotics.world_worker import correspondence_graph as cg
from robotics.world_worker import match_graph_experiment as experiment
from robotics.world_worker import reconstruction_comparison as rc
from robotics.world_worker.geometry import write_point_cloud
from test_correspondence_graph import authored_case, authored_database, matching_evidence


def process(log, *, status='completed', code=0, cold=2.):
    Path(log).write_text('Authored orchestration fixture, no native or learned inference.\n')
    return {'status': status, 'exitCode': code, 'coldWallSeconds': cold,
            'timeoutSeconds': 5., 'log': {'name': Path(log).name, 'sha256': rc.sha(log)}}


def prepared_output(root, case, receipt):
    native = root / 'native'
    native.mkdir()
    database = native / 'database.db'
    authored_database(database, receipt)
    metadata = matching_evidence(database, receipt)
    metadata['implementation'] = experiment.code_signature()
    manifest = cg.build_pack(case=case, database=database, out=root / 'pack', matching=metadata)
    detail = {'schema': experiment.PREPARE_SCHEMA, 'captureSha256': receipt['captureSha256'],
              'codeSignature': experiment.code_signature(), 'packManifestSha256': rc.sha(root / 'pack' / 'manifest.json'),
              'databaseSha256': manifest['artifacts']['database']['sha256'],
              'stagesSeconds': {'featureExtraction': .2, 'matching': .3,
                               'matchingFrontendTotal': .5, 'packExport': .04},
              **experiment.CLAIMS}
    rc.write_json(root / 'preparation-result.json', detail)
    return manifest


def preparation_child(case, receipt):
    def run(command, log_path, *, timeout, env):
        assert command[:3] == [sys.executable, '-m', 'robotics.world_worker.match_graph_experiment']
        assert command[3] == '_prepare'
        assert command[command.index('--case') + 1] == str(case.resolve())
        assert timeout == 5.
        assert env['WORLD_CPU_THREADS'] == '2' and env['HF_HUB_OFFLINE'] == '1'
        root = Path(command[command.index('--out') + 1])
        prepared_output(root, case, receipt)
        return process(log_path)
    return run


def operation_clock(monkeypatch, durations):
    """Mock whole parent operations independently from mocked child costs."""
    durations = iter(durations)
    clock, start = 100., True
    def tick():
        nonlocal clock, start
        if start:
            start = False
            return clock
        clock += next(durations)
        start = True
        return clock
    monkeypatch.setattr(experiment, '_clock', tick)


def replay_output(root, case, receipt, pack, *, folded=False):
    loaded = cg.load_pack(case=case, pack=pack)
    manifest = loaded['manifest']
    frozen = pack / 'database.db'
    native = root / 'native'
    native.mkdir()
    shutil.copyfile(frozen, native / 'database.db')
    cameras = {'schema': rc.CAMERA_SCHEMA, 'coordinateFrame': 'authored-arbitrary',
               'metricVerified': False, 'frames': []}
    for index, row in enumerate(receipt['frames']):
        cameras['frames'].append({'image': row['image'], 'width': row['width'], 'height': row['height'],
                                  'camera': {'model': 'PINHOLE', 'params': [500., 500., 320., 240.],
                                             'pixelConvention': 'colmap-half-pixel'},
                                  'cam_from_world': [[1., 0., 0., -.2 * index], [0., 1., 0., 0.], [0., 0., 1., 0.]]})
    rc.write_json(root / 'cameras.json', cameras)
    points = np.asarray([[index / 100, index / 200, 3.] for index in range(30)])
    preview = write_point_cloud(root / 'points.ply', points, np.full_like(points, 128), coordinate_frame='colmap')
    preview.update(bytes=(root / 'points.ply').stat().st_size, sha256=rc.sha(root / 'points.ply'))
    detail = {'schema': experiment.REPLAY_SCHEMA, 'captureSha256': receipt['captureSha256'],
              'packManifestSha256': rc.sha(pack / 'manifest.json'), 'codeSignature': experiment.code_signature(),
              'cameras': {'name': 'cameras.json', 'sha256': rc.sha(root / 'cameras.json')},
              'inputFrames': len(receipt['frames']), 'registeredFrames': len(receipt['frames']),
              'registrationFraction': 1., 'missingFrames': [], 'preview': preview,
              'stagesSeconds': {'solve': 1.25, 'exportAndFoldCheck': .1},
              'captureConsistency': {'status': 'folded' if folded else 'not-checked'},
              'frozenDatabaseBeforeSha256': rc.sha(frozen), 'frozenDatabaseAfterSha256': rc.sha(frozen),
              'solverCopyBeforeSha256': rc.sha(frozen), 'solverCopyAfterSha256': rc.sha(native / 'database.db'),
              'matchingFrontend': experiment._front_end_cost(pack, manifest), **experiment.CLAIMS}
    rc.write_json(root / 'replay-result.json', detail)
    return detail


@pytest.fixture
def case(tmp_path):
    return authored_case(tmp_path)


@pytest.fixture
def prepared(tmp_path, monkeypatch, case):
    source, receipt = case
    operation_clock(monkeypatch, [5., 7.])
    monkeypatch.setattr(rc, 'bounded_process', preparation_child(source, receipt))
    out = tmp_path / 'prepared'
    run = experiment.prepare(case=source, out=out, timeout=5.)
    assert run['status'] == 'completed', run
    return source, receipt, out


def test_research_status_is_dated_unavailable_and_never_claims_inference(capsys):
    assert experiment.main(['status']) == 0
    value = json.loads(capsys.readouterr().out)
    assert not value['integrationAvailable'] and not value['inferenceExecuted']
    assert value['status'] == 'not-integrated-in-this-build' and value['observedAt'] == '2026-11-16'
    assert value['paper'] == 'https://arxiv.org/abs/2611.18256'
    assert all(value[k] is False for k in experiment.CLAIMS)
    assert rc.ENGINES == ('colmap', 'vggt', 'vggt-ba')


def test_prepare_freezes_complete_bound_graph_and_records_separate_export_cost(prepared):
    source, receipt, out = prepared
    run = rc.read_json(out / 'run.json')
    loaded = cg.load_pack(case=source, pack=out / 'pack')
    assert run['captureSha256'] == receipt['captureSha256']
    assert len(loaded['manifest']['frames']) == len(receipt['frames']) == 3
    assert run['packManifestSha256'] == rc.sha(out / 'pack' / 'manifest.json')
    detail = rc.read_json(out / 'preparation-result.json')
    assert detail['stagesSeconds']['matchingFrontendTotal'] == .5
    assert detail['stagesSeconds']['packExport'] == .04
    assert run['childProcess']['coldWallSeconds'] == 2.
    assert run['operationWallSeconds'] == 5.
    assert run['parentOverheadSeconds'] == 3.
    assert run['codeSignature'] == detail['codeSignature'] == experiment.code_signature()
    assert all(run[k] is False for k in experiment.CLAIMS)


@pytest.mark.parametrize('failure,code', [('timeout', -9), ('failed', 1), ('log-limit', -9)])
def test_process_failures_remain_failures_with_logs_and_no_fake_deepba(case, tmp_path, monkeypatch, failure, code):
    source, receipt = case
    monkeypatch.setattr(rc, 'bounded_process', lambda command, log_path, **kwargs: process(log_path, status=failure, code=code))
    out = tmp_path / failure
    run = experiment.prepare(case=source, out=out, timeout=5)
    assert run['status'] == 'failed' and run['childProcess']['status'] == failure
    assert run['captureSha256'] == receipt['captureSha256'] and 'result' not in run
    assert rc.read_json(out / 'failure.json')['status'] == 'failed'
    assert (out / 'execution.log').is_file() and not (out / 'pack').exists()


def test_zero_exit_without_result_is_not_a_completed_preparation(case, tmp_path, monkeypatch):
    source, _ = case
    monkeypatch.setattr(rc, 'bounded_process', lambda command, log_path, **kwargs: process(log_path))
    run = experiment.prepare(case=source, out=tmp_path / 'missing', timeout=5)
    assert run['status'] == 'failed' and run['childProcess']['status'] == 'completed'
    assert 'result' not in run


def test_source_mutation_during_child_is_retained_as_failure(case, tmp_path, monkeypatch):
    source, receipt = case
    original = preparation_child(source, receipt)
    def change(*args, **kwargs):
        result = original(*args, **kwargs)
        with (source / 'frames' / receipt['frames'][0]['image']).open('ab') as file:
            file.write(b'changed')
        return result
    monkeypatch.setattr(rc, 'bounded_process', change)
    run = experiment.prepare(case=source, out=tmp_path / 'changed', timeout=5)
    assert run['status'] == 'failed' and 'frame' in run['error'].lower()


def test_implementation_change_after_launch_is_not_accepted(case, tmp_path, monkeypatch):
    source, receipt = case
    original = preparation_child(source, receipt)
    def change(*args, **kwargs):
        result = original(*args, **kwargs)
        monkeypatch.setattr(experiment, 'code_signature', lambda: {'altered.py': '0' * 64})
        return result
    monkeypatch.setattr(rc, 'bounded_process', change)
    run = experiment.prepare(case=source, out=tmp_path / 'code-changed', timeout=5)
    assert run['status'] == 'failed' and 'implementation changed' in run['error']


def test_existing_outputs_are_not_reused_or_overwritten(prepared):
    source, _, out = prepared
    before = (out / 'run.json').read_bytes()
    with pytest.raises(FileExistsError):
        experiment.prepare(case=source, out=out, timeout=5)
    assert (out / 'run.json').read_bytes() == before


@pytest.mark.parametrize('timeout', [True, 0, .5, 7201, float('inf'), float('nan'), '5'])
def test_invalid_budgets_refused_before_output(case, tmp_path, timeout):
    source, _ = case
    with pytest.raises(ValueError):
        experiment.prepare(case=source, out=tmp_path / 'invalid-timeout', timeout=timeout)
    assert not (tmp_path / 'invalid-timeout').exists()


def replay_child(source, receipt, pack, *, folded=False, mutate=None):
    def run(command, log_path, **kwargs):
        assert command[3] == '_replay'
        root = Path(command[command.index('--out') + 1])
        detail = replay_output(root, source, receipt, pack, folded=folded)
        if mutate:
            mutate(root, detail)
        return process(log_path, cold=3.)
    return run


def test_replay_preserves_source_db_and_includes_matching_cold_cost(prepared, tmp_path, monkeypatch):
    source, receipt, prepared_dir = prepared
    pack = prepared_dir / 'pack'
    before = rc.sha(pack / 'database.db')
    monkeypatch.setattr(rc, 'bounded_process', replay_child(source, receipt, pack))
    out = tmp_path / 'replay'
    run = experiment.replay_colmap(case=source, pack=pack, out=out, timeout=5)
    assert run['status'] == 'completed', run
    assert rc.sha(pack / 'database.db') == before
    assert run['timing']['matchingInternalSeconds'] == .5
    assert run['timing']['matchingPreparationColdWallSeconds'] == 2.
    assert run['timing']['replayColdWallSeconds'] == 3.
    assert run['timing']['matchingPreparationOperationWallSeconds'] == 5.
    assert run['timing']['replayOperationWallSeconds'] == 7.
    assert run['timing']['replayParentOverheadSeconds'] == 4.
    assert run['timing']['fromPreparedFramesWallSeconds'] == 12.
    assert run['timing']['fromOriginalCaptureWallSeconds'] == pytest.approx(12. + receipt['preparation']['elapsedSeconds'])
    assert run['geometryScreen']['status'] == 'not-assessed'
    assert all(run[k] is False for k in experiment.CLAIMS)


def test_standalone_pack_does_not_invent_missing_frontend_process_overhead(case, tmp_path, monkeypatch):
    source, receipt = case
    operation_clock(monkeypatch, [7.])
    standalone = tmp_path / 'standalone'
    standalone.mkdir()
    prepared_output(standalone, source, receipt)
    pack = standalone / 'pack'
    monkeypatch.setattr(rc, 'bounded_process', replay_child(source, receipt, pack))
    run = experiment.replay_colmap(case=source, pack=pack, out=tmp_path / 'replay', timeout=5)
    assert run['status'] == 'completed', run
    assert run['timing']['matchingInternalSeconds'] == .5
    assert run['timing']['recordedMatchingInternalPlusReplayColdSeconds'] == 3.5
    assert run['timing']['matchingPreparationColdWallSeconds'] is None
    assert run['timing']['fromPreparedFramesWallSeconds'] is None
    assert run['timing']['fromOriginalCaptureWallSeconds'] is None


def test_recase_rejected_before_replay_launch_or_output(prepared, tmp_path, monkeypatch):
    source, _, prepared_dir = prepared
    different, _ = authored_case(tmp_path, name='different', tone=10)
    monkeypatch.setattr(rc, 'bounded_process', lambda *a, **k: pytest.fail('Wrong capture must not execute.'))
    out = tmp_path / 'replay'
    with pytest.raises(ValueError):
        experiment.replay_colmap(case=different, pack=prepared_dir / 'pack', out=out, timeout=5)
    assert not out.exists()


@pytest.mark.parametrize('action', ['inspect', 'replay-colmap'])
def test_top_level_pack_symlink_is_refused_before_resolution(prepared, tmp_path, monkeypatch, action):
    source, _, prepared_dir = prepared
    alias = tmp_path / 'aliased-pack'
    alias.symlink_to(prepared_dir / 'pack', target_is_directory=True)
    monkeypatch.setattr(rc, 'bounded_process', lambda *a, **k: pytest.fail('A symlink cannot launch a solver.'))
    with pytest.raises(ValueError, match='symlink'):
        if action == 'inspect':
            experiment.inspect_pack(case=source, pack=alias)
        else:
            experiment.replay_colmap(case=source, pack=alias, out=tmp_path / 'replay', timeout=5)
    assert not (tmp_path / 'replay').exists()


@pytest.mark.parametrize('mode', ['camera-bytes', 'denominator', 'preview', 'frozen-db', 'timing'])
def test_zero_exit_cannot_promote_tampered_replay_artifacts(prepared, tmp_path, monkeypatch, mode):
    source, receipt, prepared_dir = prepared
    pack = prepared_dir / 'pack'
    def mutate(root, detail):
        if mode == 'camera-bytes':
            (root / 'cameras.json').write_text('{}')
        elif mode == 'denominator':
            detail['inputFrames'] = 2
            rc.write_json(root / 'replay-result.json', detail)
        elif mode == 'preview':
            (root / 'points.ply').write_text('changed')
        elif mode == 'frozen-db':
            with (pack / 'database.db').open('ab') as stream:
                stream.write(b'changed')
        else:
            detail['matchingFrontend']['matchingInternalSeconds'] = 0.
            rc.write_json(root / 'replay-result.json', detail)
    monkeypatch.setattr(rc, 'bounded_process', replay_child(source, receipt, pack, mutate=mutate))
    run = experiment.replay_colmap(case=source, pack=pack, out=tmp_path / 'replay', timeout=5)
    assert run['status'] == 'failed' and 'result' not in run
    assert run['childProcess']['status'] == 'completed'


def test_folded_geometry_remains_review_required_despite_successful_process(prepared, tmp_path, monkeypatch, capsys):
    source, receipt, prepared_dir = prepared
    pack = prepared_dir / 'pack'
    monkeypatch.setattr(rc, 'bounded_process', replay_child(source, receipt, pack, folded=True))
    code = experiment.main(['replay-colmap', '--case', str(source), '--pack', str(pack), '--out', str(tmp_path / 'folded'), '--timeout', '5'])
    assert code == 2
    run = json.loads(capsys.readouterr().out)
    assert run['status'] == 'requires-review' and run['childProcess']['status'] == 'completed'
    assert run['geometryScreen']['status'] == 'requires-review' and not run['productionPromotionApproved']


def test_inspect_recomputes_diagnostics_and_does_not_execute_an_engine(prepared, monkeypatch, capsys):
    source, _, prepared_dir = prepared
    monkeypatch.setattr(rc, 'bounded_process', lambda *a, **k: pytest.fail('Inspection cannot execute inference.'))
    assert experiment.main(['inspect', '--case', str(source), '--pack', str(prepared_dir / 'pack')]) == 0
    value = json.loads(capsys.readouterr().out)
    assert value['audit']['fullGraph']['pairs'] == 2
    assert value['audit']['paperCandidateGraph']['pairs'] == 1
    assert value['audit']['fullGraph']['frames'] == 3
    assert not value['deepbaExecuted'] and not value['metricVerified']


def test_interrupt_writes_a_retained_nonpassing_receipt(case, tmp_path, monkeypatch):
    source, _ = case
    def interrupt(*args, **kwargs):
        raise KeyboardInterrupt()
    monkeypatch.setattr(rc, 'bounded_process', interrupt)
    out = tmp_path / 'interrupted'
    with pytest.raises(KeyboardInterrupt):
        experiment.prepare(case=source, out=out, timeout=5)
    assert rc.read_json(out / 'run.json')['status'] == 'interrupted'
    assert rc.read_json(out / 'failure.json')['status'] == 'interrupted'


@pytest.mark.skipif(os.name != 'posix' or not Path('/proc').exists(), reason='Linux process-group regression')
def test_deadline_kills_descendants_and_retains_timeout_receipt(case, tmp_path, monkeypatch):
    source, _ = case
    original = rc.bounded_process
    pid_file = tmp_path / 'descendant.pid'
    helper = ('import subprocess,sys,time;from pathlib import Path;'
              'p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]);'
              f'Path({str(pid_file)!r}).write_text(str(p.pid));time.sleep(30)')
    def slow(command, log_path, *, timeout, env):
        assert command[3] == '_prepare'
        return original([sys.executable, '-c', helper], log_path, timeout=timeout, env=env)
    monkeypatch.setattr(rc, 'bounded_process', slow)
    before = time.monotonic()
    run = experiment.prepare(case=source, out=tmp_path / 'timeout', timeout=1)
    assert time.monotonic() - before < 8
    assert run['status'] == 'failed' and run['childProcess']['status'] == 'timeout'
    pid = int(pid_file.read_text())
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            if Path(f'/proc/{pid}/stat').read_text().split()[2] == 'Z':
                break
        except FileNotFoundError:
            break
        time.sleep(.02)
    else:
        pytest.fail('The timed-out child left its descendant executing.')


def test_native_cpu_prepare_executes_pinned_sift_without_model_weights(case, tmp_path):
    pycolmap = pytest.importorskip('pycolmap')
    if pycolmap.__version__ != experiment.PYCOLMAP_VERSION:
        pytest.skip('Exact pinned native CPU dependency is not installed.')
    source, receipt = case
    out = tmp_path / 'actual-cpu-preparation'
    run = experiment.prepare(case=source, out=out, timeout=30)
    assert run['status'] == 'completed', run
    loaded = cg.load_pack(case=source, pack=out / 'pack')
    metadata = loaded['manifest']['matching']
    assert metadata['dependencies']['pycolmap'] == '4.2.1'
    assert metadata['device']['type'] == 'cpu'
    assert metadata['settings']['verificationOptions']['ransac']['random_seed'] == 0
    assert loaded['audit']['fullGraph']['frames'] == len(receipt['frames'])
    assert (out / 'execution.log').stat().st_size > 0
    assert not run['deepbaExecuted'] and not run['metricVerified']


def test_native_replay_registers_authored_room_from_unchanged_frozen_matches(tmp_path):
    """Exercise the actual new handoff; synthetic geometry is not phone accuracy."""
    import runpy
    pycolmap = pytest.importorskip('pycolmap')
    if pycolmap.__version__ != experiment.PYCOLMAP_VERSION:
        pytest.skip('Exact pinned native CPU dependency is not installed.')
    fixture = Path(__file__).with_name('test_native_capture.py')
    render = runpy.run_path(str(fixture))['rendered_capture']
    render(tmp_path / 'authored-room')
    case = tmp_path / 'case'
    receipt = rc.prepare(out=case, photos=tmp_path / 'authored-room', frames=5)
    # The native calibration sidecar is excluded: this arm gets ordinary JPEGs.
    assert all(source['kind'] == 'image' for source in receipt['sources'])
    preparation = experiment.prepare(case=case, out=tmp_path / 'prepared', timeout=60)
    assert preparation['status'] == 'completed', preparation
    pack = tmp_path / 'prepared' / 'pack'
    before = rc.sha(pack / 'database.db')
    replay = experiment.replay_colmap(case=case, pack=pack, out=tmp_path / 'replay', timeout=90)
    assert replay['status'] == 'completed', replay
    detail = rc.read_json(tmp_path / 'replay' / 'replay-result.json')
    assert detail['inputFrames'] == detail['registeredFrames'] == 5
    assert detail['missingFrames'] == [] and detail['points'] >= 30
    assert detail['frozenDatabaseBeforeSha256'] == detail['frozenDatabaseAfterSha256'] == before
    assert rc.sha(pack / 'database.db') == before
    assert detail['cameras']['sha256'] == rc.sha(tmp_path / 'replay' / 'cameras.json')
    assert not detail['deepbaExecuted'] and not detail['metricVerified']
