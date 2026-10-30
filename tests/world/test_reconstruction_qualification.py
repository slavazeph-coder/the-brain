"""Authored cameras and explicit fake engine transport. No physical/GPU benchmark."""
import copy
from pathlib import Path

from PIL import Image
import pytest

from robotics.world_worker import reconstruction_comparison as rc
from robotics.world_worker import reconstruction_qualification as q


@pytest.fixture
def experiment_inputs(tmp_path):
    fixture = tmp_path / 'authored'
    rc.self_test(fixture)
    template = rc.read_json(fixture / 'annotations.json')
    cameras = rc.read_json(fixture / 'run/vggt/cameras.json')
    entries = []
    for index, condition in enumerate(q.CONDITIONS):
        photos = tmp_path / f'photos-{index}'
        photos.mkdir()
        for source in (fixture / 'authored-input').glob('*.jpg'):
            with Image.open(source) as image:
                image.paste((index * 70, 0, 0), (0, 0, 30, 30))
                image.save(photos / source.name)
        case = tmp_path / f'case-{index}'
        receipt = rc.prepare(out=case, photos=photos, frames=3)
        marked = copy.deepcopy(template)
        marked['captureSha256'] = receipt['captureSha256']
        rc.write_json(case / 'annotations.json', marked)
        entries.append({'id': f'room-{index}', 'condition': condition, 'case': str(case),
                        'annotations': str(case / 'annotations.json')})
    inputs = tmp_path / 'inputs.json'
    rc.write_json(inputs, {'schema': 'brainsnn.qualification-inputs.v1', 'cases': entries})
    return inputs, cameras


def plan_for(tmp_path, experiment_inputs, *, physical_metadata=False, **kwargs):
    """Physical-looking metadata only tests gates. These are NOT actual readings."""
    inputs, cameras = experiment_inputs
    if physical_metadata:
        for entry in rc.read_json(inputs)['cases']:
            path = Path(entry['annotations'])
            marked = rc.read_json(path)
            marked['referenceBasis'] = 'physical-readings'
            for span in marked['spans']:
                span.update(method='tape', instrument='AUTHORED TEST METADATA, NO PHYSICAL READING')
            rc.write_json(path, marked)
    root = tmp_path / 'experiment'
    plan = q.create_plan(inputs=inputs, out=root, allow_synthetic=not physical_metadata, **kwargs)
    return root, plan, cameras


def fake_transport(cameras, *, failed_cell=None, folded=False, slow=False):
    """Write actual camera JSON for the real triangulation scorer, no inference."""
    def execute(**kwargs):
        out, case = Path(kwargs['out']), Path(kwargs['case'])
        receipt = rc.validate_capture(case)
        marked = rc.read_json(kwargs['annotations'])
        out.mkdir()
        rows = []
        for engine in kwargs['engines']:
            target = out / engine
            target.mkdir()
            row = {'engine': engine, 'status': 'completed', 'endToEndSeconds': 10. if engine == 'colmap' else 6. if slow else 3.}
            if (out.name, engine) == failed_cell:
                row.update(status='timeout', exitCode=-9)
            else:
                camera = copy.deepcopy(cameras)
                # All rays still agree, but the baseline's shared focal error
                # stretches depth, producing nonzero withheld distance errors.
                if engine == 'colmap':
                    for frame in camera['frames']:
                        frame['camera']['params'][0] *= 1.03
                        frame['camera']['params'][1] *= 1.03
                rc.write_json(target / 'cameras.json', camera)
                result = {'schema': 'brainsnn.comparison-engine.v1', 'captureSha256': receipt['captureSha256'],
                          'engine': engine, 'syntheticFixture': True, 'inferenceExecuted': False,
                          'cameras': {'sha256': rc.sha(target / 'cameras.json')},
                          'detail': {'captureConsistency': {'status': 'folded' if folded else 'not-checked'}}}
                rc.write_json(target / 'engine-result.json', result)
                row['engineResultSha256'] = rc.sha(target / 'engine-result.json')
            rows.append(row)
        run = {'schema': rc.RUN_SCHEMA, 'captureSha256': receipt['captureSha256'], 'requestedEngines': kwargs['engines'],
               'annotationsPredeclared': True, 'annotationSha256': q.digest(marked),
               'hardware': rc.hardware_record(), 'runs': rows}
        rc.write_json(out / 'run.json', run)
        return run
    return execute


def test_plan_snapshots_before_inference_and_rotates_every_engine_into_first_place(tmp_path, experiment_inputs):
    root, plan, _ = plan_for(tmp_path, experiment_inputs)
    assert q.validate_plan(root / 'plan.json') == plan
    assert not (root / 'runs').exists()
    assert len(q.schedule(plan)) == 9
    for case in plan['cases']:
        cells = [c for c in q.schedule(plan) if c['caseId'] == case['id']]
        assert {c['engines'][0] for c in cells} == set(rc.ENGINES)
    # Original editable worksheet can change without changing the snapshot.
    entry = rc.read_json(experiment_inputs[0])['cases'][0]
    Path(entry['annotations']).write_text('{}')
    assert q.validate_plan(root / 'plan.json') == plan


def test_exact_duplicate_capture_cannot_count_twice(tmp_path, experiment_inputs):
    inputs, _ = experiment_inputs
    value = rc.read_json(inputs)
    value['cases'][1].update(case=value['cases'][0]['case'], annotations=value['cases'][0]['annotations'])
    rc.write_json(inputs, value)
    with pytest.raises(ValueError, match='different original captures'):
        q.create_plan(inputs=inputs, out=tmp_path / 'bad', allow_synthetic=True)
    assert not (tmp_path / 'bad/plan.json').exists()


@pytest.mark.parametrize('mutation', ['annotation', 'raster', 'code', 'plan'])
def test_changed_frozen_inputs_or_implementation_are_refused(tmp_path, experiment_inputs, monkeypatch, mutation):
    root, _, _ = plan_for(tmp_path, experiment_inputs)
    if mutation == 'annotation':
        path = root / 'cases/room-0/annotations.json'
        value = rc.read_json(path); value['spans'][1]['distanceMeters'] *= 1.2
        rc.write_json(path, value)
    elif mutation == 'raster':
        (root / 'cases/room-0/frames/frame_0000.jpg').write_bytes(b'changed')
    elif mutation == 'code':
        monkeypatch.setattr(q, 'code_signature', lambda: {})
    else:
        value = rc.read_json(root / 'plan.json'); value['repeats'] = 1
        rc.write_json(root / 'plan.json', value)
    with pytest.raises(ValueError):
        q.validate_plan(root / 'plan.json')


def test_synthetic_or_incomplete_reference_inputs_require_explicit_labelling(tmp_path, experiment_inputs):
    inputs, _ = experiment_inputs
    with pytest.raises(ValueError, match='Synthetic fixtures'):
        q.create_plan(inputs=inputs, out=tmp_path / 'no')
    entry = rc.read_json(inputs)['cases'][0]
    path = Path(entry['annotations']); marked = rc.read_json(path)
    marked['spans'].pop(); rc.write_json(path, marked)
    with pytest.raises(ValueError, match='seven withheld'):
        q.create_plan(inputs=inputs, out=tmp_path / 'no', allow_synthetic=True)


def test_every_requested_trial_is_scored_with_real_triangulation_but_no_inference(tmp_path, experiment_inputs, monkeypatch):
    root, _, cameras = plan_for(tmp_path, experiment_inputs, physical_metadata=True)
    monkeypatch.setattr(rc, 'execute', fake_transport(cameras))
    report = q.execute_plan(plan_path=root / 'plan.json')
    assert report['requestedTrials'] == 9 and report['requestedEngineRuns'] == 27
    assert report['completeExperimentDesign']
    assert all(c['readyForGeometryReview'] and len(c['passedTrials']) == 9 for c in report['candidates'])
    assert all(t['status'] == 'scored' for t in report['trials'])
    assert not report['productionPromotionApproved'] and not report['surveyAccuracyValidated']
    assert not report['bimSurfacesValidated'] and not report['physicalRobotValidated']
    assert '27' in (root / 'qualification.md').read_text()
    with pytest.raises(FileExistsError):
        q.execute_plan(plan_path=root / 'plan.json')


@pytest.mark.parametrize('mode', ['synthetic', 'one-repeat', 'one-condition', 'slow', 'folded', 'timeout'])
def test_incomplete_synthetic_folded_failed_or_slow_experiment_cannot_qualify(tmp_path, experiment_inputs, monkeypatch, mode):
    if mode == 'one-condition':
        value = rc.read_json(experiment_inputs[0]); value['cases'] = value['cases'][:1]
        rc.write_json(experiment_inputs[0], value)
    root, _, cameras = plan_for(tmp_path, experiment_inputs, physical_metadata=mode != 'synthetic',
                               repeats=1 if mode == 'one-repeat' else 3)
    monkeypatch.setattr(rc, 'execute', fake_transport(cameras, folded=mode == 'folded', slow=mode == 'slow',
                        failed_cell=('room-0-r2', 'vggt') if mode == 'timeout' else None))
    report = q.execute_plan(plan_path=root / 'plan.json', allow_synthetic=mode == 'synthetic')
    assert not next(c for c in report['candidates'] if c['engine'] == 'vggt')['readyForGeometryReview']
    if mode == 'timeout':
        trial = next(t for t in report['trials'] if t['id'] == 'room-0-r2')
        arm = next(a for a in trial['arms'] if a['engine'] == 'vggt')
        assert arm['availableHeldOutCount'] == 0 and arm['requestedHeldOutCount'] == 7
        assert len(arm['outsideToleranceOrMissingSpanIds']) == 7
        assert report['requestedEngineRuns'] == 27


def test_total_budget_retains_unstarted_work_without_invoking_engines(tmp_path, experiment_inputs, monkeypatch):
    root, _, _ = plan_for(tmp_path, experiment_inputs)
    monkeypatch.setattr(rc, 'execute', lambda **kw: pytest.fail('Exhausted budget must not invoke an engine'))
    report = q.execute_plan(plan_path=root / 'plan.json', max_seconds=1, allow_synthetic=True)
    assert len(report['trials']) == 9
    assert all(t['status'] == 'budget-exhausted' for t in report['trials'])
    assert all(len(c['unavailableTrials']) == 9 for c in report['candidates'])


def test_interruption_leaves_a_reportable_partial_matrix(tmp_path, experiment_inputs, monkeypatch):
    root, _, _ = plan_for(tmp_path, experiment_inputs)
    def interrupted(**kw):
        raise KeyboardInterrupt()
    monkeypatch.setattr(rc, 'execute', interrupted)
    with pytest.raises(KeyboardInterrupt):
        q.execute_plan(plan_path=root / 'plan.json', allow_synthetic=True)
    report = q.build_report(root / 'plan.json')
    assert report['trials'][0]['status'] == 'running'
    assert all(t['status'] == 'not-started' for t in report['trials'][1:])
    assert not any(c['readyForGeometryReview'] for c in report['candidates'])


@pytest.mark.parametrize('mutation', ['camera', 'run', 'order', 'hardware', 'dropped-trial'])
def test_recomputed_report_rejects_changed_evidence_or_dropped_denominators(tmp_path, experiment_inputs, monkeypatch, mutation):
    root, _, cameras = plan_for(tmp_path, experiment_inputs)
    monkeypatch.setattr(rc, 'execute', fake_transport(cameras))
    q.execute_plan(plan_path=root / 'plan.json', allow_synthetic=True)
    trial = root / 'runs/room-0-r1'
    if mutation == 'camera':
        path = trial / 'vggt/cameras.json'
        value = rc.read_json(path); value['changed'] = True; rc.write_json(path, value)
    elif mutation in ('run', 'order', 'hardware'):
        path = trial / 'run.json'; value = rc.read_json(path)
        if mutation == 'order':
            value['requestedEngines'].reverse()
        elif mutation == 'hardware':
            value['hardware'] = {}
        else:
            value['changed'] = True
        rc.write_json(path, value)
        if mutation != 'run':
            journal = rc.read_json(root / 'execution.json')
            journal['trials'][0]['runSha256'] = rc.sha(path)
            rc.write_json(root / 'execution.json', journal)
    else:
        journal = rc.read_json(root / 'execution.json'); journal['trials'].pop()
        rc.write_json(root / 'execution.json', journal)
        with pytest.raises(ValueError, match='dropped'):
            q.build_report(root / 'plan.json')
        return
    report = q.build_report(root / 'plan.json')
    assert report['trials'][0]['status'] == 'invalid-evidence'
    assert not any(c['readyForGeometryReview'] for c in report['candidates'])


def test_cli_failure_is_nonzero_and_budget_failure_writes_report(tmp_path, experiment_inputs):
    root, _, _ = plan_for(tmp_path, experiment_inputs)
    assert q.main(['run', '--plan', str(root / 'plan.json')]) == 1
    assert not (root / 'runs').exists()
    assert q.main(['run', '--plan', str(root / 'plan.json'), '--allow-synthetic', '--max-seconds', '1']) == 2
    assert (root / 'qualification.json').is_file()
