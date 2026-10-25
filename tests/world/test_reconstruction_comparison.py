"""Same-input runner contracts. Authored fixtures do not qualify GPU engines."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from PIL import Image, ImageDraw
import pytest

from robotics.world_worker import reconstruction_comparison as rc


def photos(root, names=('c.jpg', 'a.jpg', 'e.jpg', 'b.jpg', 'd.jpg'), *, exif=False):
    root.mkdir()
    for index, name in enumerate(names):
        image = Image.new('RGB', (640, 480), (30 + index * 15, 60, 100))
        draw = ImageDraw.Draw(image)
        for x in range(0, 640, 32):
            draw.line((x, 0, x, 479), fill='white')
        for y in range(0, 480, 32):
            draw.line((0, y, 639, y), fill='black')
        if exif and name == 'a.jpg':
            metadata = image.getexif(); metadata[274] = 6
            image.save(root / name, exif=metadata)
        else:
            image.save(root / name)
    return root


def prepared(tmp_path, **kwargs):
    inputs = photos(tmp_path / 'photos', **kwargs)
    case = tmp_path / 'case'
    receipt = rc.prepare(out=case, photos=inputs, frames=3)
    return case, receipt


def rewrite_receipt(case, receipt):
    receipt = copy.deepcopy(receipt)
    receipt.pop('captureSha256', None)
    receipt['captureSha256'] = hashlib.sha256(rc.canonical(receipt)).hexdigest()
    rc.write_json(case / 'capture.json', receipt)
    return receipt


def alive(pid):
    """Linux zombie descendants are no longer executing and can await host reaping."""
    try:
        return Path(f'/proc/{pid}/stat').read_text().split()[2] != 'Z'
    except FileNotFoundError:
        return False


def test_prepare_freezes_uniform_named_sources_exif_and_exact_frame_bytes(tmp_path):
    case, receipt = prepared(tmp_path, exif=True)
    assert [row['name'] for row in receipt['sources']] == ['a.jpg', 'c.jpg', 'e.jpg']
    assert [row['sourceFrameIndex'] for row in receipt['frames']] == [0, 2, 4]
    assert [row['image'] for row in receipt['frames']] == [f'frame_{i:04d}.jpg' for i in range(3)]
    first = receipt['frames'][0]
    assert [first['sourceWidth'], first['sourceHeight'], first['exifOrientation']] == [640, 480, 6]
    assert [first['width'], first['height']] == [480, 640]
    assert first['sourceToFramePixelCenter'] == [[0., -1., 479.], [1., 0., 0.], [0, 0, 1]]
    assert all(row['pts'] is None and row['timeBase'] is None for row in receipt['frames'])
    assert not receipt['metricVerified']
    assert rc.validate_capture(case) == receipt
    for row in receipt['frames']:
        path = case / 'frames' / row['image']
        assert row['sha256'] == rc.sha(path)
        assert row['bytes'] == path.stat().st_size
    template = rc.read_json(case / 'annotations.template.json')
    assert template['captureSha256'] == receipt['captureSha256']
    assert template['landmarks'] == [] and template['spans'] == []
    assert (case / 'annotate.html').is_file()


@pytest.mark.parametrize('count,requested,expected', [(11, 3, [0, 5, 10]), (3, 32, [0, 1, 2]),
                                                      (5, 4, [0, 1, 3, 4]), (60, 60, list(range(60)))])
def test_engine_independent_sampling_is_deterministic(count, requested, expected):
    assert rc.sample_indices(count, requested) == expected


@pytest.mark.parametrize('count,requested', [(2, 3), (10, 2), (10, 61), (True, 3), (10, True)])
def test_invalid_sampling_budget_is_refused(count, requested):
    with pytest.raises(ValueError):
        rc.sample_indices(count, requested)


def test_existing_output_cannot_be_reused_or_overwritten(tmp_path):
    case, _ = prepared(tmp_path)
    before = (case / 'capture.json').read_bytes()
    with pytest.raises(FileExistsError):
        rc.prepare(out=case, photos=tmp_path / 'photos', frames=3)
    assert (case / 'capture.json').read_bytes() == before


def test_source_changed_during_preparation_produces_failure_without_receipt(tmp_path, monkeypatch):
    from robotics.world_worker import sparse_colmap
    inputs = photos(tmp_path / 'photos')
    original = sparse_colmap.prepare_photo
    def changed(source, target, **kwargs):
        result = original(source, target, **kwargs)
        source.write_bytes(b'changed after raster preparation')
        return result
    monkeypatch.setattr(sparse_colmap, 'prepare_photo', changed)
    case = tmp_path / 'case'
    with pytest.raises(ValueError, match='changed'):
        rc.prepare(out=case, photos=inputs, frames=3)
    assert not (case / 'capture.json').exists()
    assert rc.read_json(case / 'preparation-failure.json')['status'] == 'failed'


def test_video_preparation_retains_actual_decoded_indices_and_pts(tmp_path):
    av = pytest.importorskip('av')
    import numpy as np
    source = tmp_path / 'authored-video.mp4'
    with av.open(str(source), 'w') as container:
        stream = container.add_stream('mpeg4', rate=5)
        stream.width, stream.height, stream.pix_fmt = 640, 480, 'yuv420p'
        for index in range(5):
            image = np.zeros((480, 640, 3), np.uint8)
            image[:, :, 0] = index * 40
            image[::20, :, :] = 220
            image[:, ::20, :] = 120
            frame = av.VideoFrame.from_ndarray(image, format='rgb24')
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    case = tmp_path / 'case'
    receipt = rc.prepare(out=case, video=source, frames=3)
    assert receipt['preparation']['decodedFrames'] == 5
    assert [row['sourceFrameIndex'] for row in receipt['frames']] == [0, 2, 4]
    stamps = [row['pts'] * row['timeBase'][0] / row['timeBase'][1] for row in receipt['frames']]
    assert stamps == pytest.approx([0, .4, .8])
    assert all(row['sourceIndex'] == 0 for row in receipt['frames'])
    assert receipt['sources'][0]['sha256'] == rc.sha(source)
    assert rc.validate_capture(case) == receipt
    assert 'Not applied' in receipt['preparation']['displayRotation']


@pytest.mark.parametrize('change,match', [
    (lambda case, r: (case / 'frames' / r['frames'][0]['image']).write_bytes(b'changed'), 'frame'),
    (lambda case, r: (case / 'frames' / 'unrecorded.jpg').write_bytes(b'extra'), 'unrecorded'),
    (lambda case, r: rc.write_json(case / 'capture.json', {**r, 'metricVerified': True}), 'hash'),
])
def test_shared_frame_or_receipt_mutation_is_refused(tmp_path, change, match):
    case, receipt = prepared(tmp_path)
    change(case, receipt)
    with pytest.raises(ValueError, match=match):
        rc.validate_capture(case)


@pytest.mark.parametrize('mutate', [
    lambda r: r.update(metricVerified=True),
    lambda r: r.pop('sources'),
    lambda r: r['preparation'].update(elapsedSeconds=-1),
    lambda r: r.pop('preparation'),
    lambda r: r['frames'][0].update(image='../escape.jpg'),
    lambda r: r['frames'][0].update(width=True),
    lambda r: r['frames'].append(copy.deepcopy(r['frames'][0])),
])
def test_rehashed_malformed_receipt_is_refused(tmp_path, mutate):
    case, receipt = prepared(tmp_path)
    mutate(receipt); rewrite_receipt(case, receipt)
    with pytest.raises(ValueError):
        rc.validate_capture(case)


def test_frame_symlink_and_unrecorded_directory_are_refused(tmp_path):
    case, receipt = prepared(tmp_path)
    path = case / 'frames' / receipt['frames'][0]['image']
    saved = tmp_path / 'saved.jpg'; path.rename(saved); path.symlink_to(saved)
    with pytest.raises(ValueError, match='frame'):
        rc.validate_capture(case)
    path.unlink(); saved.rename(path)
    (case / 'frames' / 'unrecorded').mkdir()
    with pytest.raises(ValueError, match='unrecorded'):
        rc.validate_capture(case)


@pytest.mark.parametrize('raw', ['{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'])
def test_json_duplicate_keys_and_nonfinite_values_are_refused(tmp_path, raw):
    path = tmp_path / 'bad.json'; path.write_text(raw)
    with pytest.raises(ValueError):
        rc.read_json(path)


def test_self_test_runs_real_scoring_without_inference_or_physical_qualification(tmp_path):
    result = rc.self_test(tmp_path / 'self-test')
    assert result['syntheticFixture'] and result['inferenceExecuted'] is False
    assert not result['promotion']['eligible'] and not result['physicalRobotValidated']
    assert result['referenceBasis'] == 'synthetic-fixture'
    assert len(result['runs']) == 3
    for row in result['runs']:
        summary = row['measurementReport']['summary']
        assert summary['validHeldOutCount'] == 7
        assert summary['heldOutMaxAbsoluteErrorMeters'] < 1e-10
        assert not summary['eligibleForPhysicalDimensionComparison']
        assert row['endToEndSeconds'] is None
    written = rc.read_json(tmp_path / 'self-test/run/comparison.json')
    assert written == result


@pytest.mark.parametrize('exit_code,expected', [(0, 'completed'), (7, 'failed')])
def test_bounded_process_preserves_exit_status_and_log(tmp_path, exit_code, expected):
    log = tmp_path / 'engine.log'
    result = rc.bounded_process([sys.executable, '-c', f'print("authored child"); raise SystemExit({exit_code})'],
                                log, timeout=3)
    assert result['status'] == expected and result['exitCode'] == exit_code
    assert result['coldWallSeconds'] > 0
    assert result['log']['sha256'] == rc.sha(log)
    assert 'authored child' in log.read_text()


@pytest.mark.skipif(os.name != 'posix' or not Path('/proc').is_dir(), reason='Linux process group qualification')
@pytest.mark.parametrize('parent_exits', [False, True])
def test_bounded_process_cleans_descendants_after_timeout_or_parent_exit(tmp_path, parent_exits):
    pidfile = tmp_path / 'pid'
    child = 'import time; time.sleep(30)'
    script = ('import pathlib, subprocess, sys, time; '
              f'p=subprocess.Popen([sys.executable, "-c", {child!r}]); '
              f'pathlib.Path({str(pidfile)!r}).write_text(str(p.pid)); '
              + ('raise SystemExit(0)' if parent_exits else 'time.sleep(30)'))
    result = rc.bounded_process([sys.executable, '-c', script], tmp_path / 'log', timeout=.6)
    assert result['status'] == ('completed' if parent_exits else 'timeout')
    pid = int(pidfile.read_text())
    try:
        for _ in range(20):
            if not alive(pid):
                break
            time.sleep(.02)
        assert not alive(pid), 'Bounded process left an executing descendant.'
    finally:
        if alive(pid):
            os.kill(pid, 9)


def test_bounded_process_caps_noisy_child_output(tmp_path, monkeypatch):
    monkeypatch.setattr(rc, 'MAX_LOG_BYTES', 4096)
    log = tmp_path / 'log'
    result = rc.bounded_process([sys.executable, '-c', 'import sys; sys.stdout.buffer.write(b"x"*10000)'], log, timeout=3)
    assert result['status'] == 'log-limit'
    assert log.stat().st_size == 4096


def test_execute_retains_every_failure_and_uses_same_case_in_isolated_processes(tmp_path, monkeypatch):
    case, _ = prepared(tmp_path)
    observed = []
    def transport(command, log, *, timeout, env):
        observed.append((command, env))
        log.write_text('Explicit fixture: engine failed before inference.')
        return {'status': 'failed', 'exitCode': 3, 'coldWallSeconds': .2,
                'timeoutSeconds': timeout, 'log': {'name': log.name, 'sha256': rc.sha(log)}}
    monkeypatch.setattr(rc, 'bounded_process', transport)
    result = rc.execute(case=case, out=tmp_path / 'run', engines=rc.ENGINES)
    assert [row['engine'] for row in result['runs']] == list(rc.ENGINES)
    assert all(row['status'] == 'failed' for row in result['runs'])
    assert result['annotationsPredeclared'] is False
    assert rc.read_json(tmp_path / 'run/run.json') == result
    assert all(command[command.index('--case')+1] == str(case.resolve()) for command, _ in observed)
    assert all(env['HF_HUB_OFFLINE'] == '1' and env['PYTHONHASHSEED'] == '0' for _, env in observed)
    assert len({command[command.index('--out')+1] for command, _ in observed}) == 3
    with pytest.raises(FileExistsError):
        rc.execute(case=case, out=tmp_path / 'run', engines=['colmap'])


def test_execute_refuses_success_receipt_from_another_capture(tmp_path, monkeypatch):
    case, _ = prepared(tmp_path)
    def transport(command, log, *, timeout, env):
        target = Path(command[command.index('--out')+1])
        rc.write_json(target / 'cameras.json', {'schema': rc.CAMERA_SCHEMA, 'frames': []})
        rc.write_json(target / 'engine-result.json', {'engine': 'colmap', 'captureSha256': 'a'*64,
            'cameras': {'sha256': rc.sha(target / 'cameras.json')}})
        log.write_text('Explicit fixture: bound output rejected.')
        return {'status': 'completed', 'exitCode': 0, 'coldWallSeconds': .1,
                'timeoutSeconds': timeout, 'log': {'name': log.name, 'sha256': rc.sha(log)}}
    monkeypatch.setattr(rc, 'bounded_process', transport)
    result = rc.execute(case=case, out=tmp_path / 'run', engines=['colmap'])
    assert result['runs'][0]['status'] == 'invalid-output'


@pytest.mark.parametrize('which', ['cameras', 'engine-result', 'annotations'])
def test_score_rejects_artifact_or_predeclared_annotation_changes(tmp_path, which):
    out = tmp_path / 'self-test'; rc.self_test(out)
    if which == 'annotations':
        path = out / 'annotations.json'; value = rc.read_json(path)
        value['spans'][1]['distanceMeters'] *= 1.05
    else:
        path = out / 'run/colmap' / f'{which}.json'; value = rc.read_json(path)
        value['changedAfterCompletion'] = True
    rc.write_json(path, value)
    with pytest.raises(ValueError, match='changed'):
        rc.score_run(case=out / 'case', run=out / 'run', annotations=out / 'annotations.json')


def test_score_rejects_cross_capture_annotations(tmp_path):
    out = tmp_path / 'self-test'; rc.self_test(out)
    marked = rc.read_json(out / 'annotations.json'); marked['captureSha256'] = 'e'*64
    rc.write_json(out / 'other-annotations.json', marked)
    with pytest.raises(ValueError, match='capture'):
        rc.score_run(case=out / 'case', run=out / 'run', annotations=out / 'other-annotations.json')


def gate_rows():
    def row(engine, median, maximum, seconds):
        return {'engine': engine, 'status': 'completed', 'endToEndSeconds': seconds,
                'measurementReport': {'summary': {'requestedHeldOutCount': 7, 'validHeldOutCount': 7,
                    'allRequestedHeldOutAvailable': True, 'eligibleForPhysicalDimensionComparison': True,
                    'heldOutMedianAbsoluteErrorMeters': median, 'heldOutMaxAbsoluteErrorMeters': maximum}}}
    return [row('colmap', .10, .20, 10.), row('vggt', .07, .18, 4.)]


def test_narrow_dimension_timing_gate_passes_only_measured_predeclared_improvement():
    rows = gate_rows()
    rc.dimension_timing_gate(rows, predeclared=True, physical=True)
    baseline, candidate = [row['dimensionAndTimingGate'] for row in rows]
    assert not baseline['passed'] and baseline['status'] == 'unavailable'
    assert candidate['passed'] and candidate['status'] == 'passed'
    assert candidate['measuredMedianErrorReduction'] == pytest.approx(.3)
    assert candidate['measuredEndToEndSpeedup'] == pytest.approx(2.5)
    assert candidate['openingCompletenessReviewed'] is False
    assert 'multi-capture' in candidate['reason']


@pytest.mark.parametrize('change', [
    lambda rows: rows[1]['measurementReport']['summary'].update(heldOutMaxAbsoluteErrorMeters=.21),
    lambda rows: rows[1].update(endToEndSeconds=6.),
    lambda rows: rows[1]['measurementReport']['summary'].update(heldOutMedianAbsoluteErrorMeters=.081),
    lambda rows: rows[1].update(status='failed'),
    lambda rows: rows[0].update(status='timeout'),
    lambda rows: rows[1]['measurementReport']['summary'].update(eligibleForPhysicalDimensionComparison=False,
                                                                  validHeldOutCount=6, allRequestedHeldOutAvailable=False),
    lambda rows: rows[0]['measurementReport']['summary'].update(eligibleForPhysicalDimensionComparison=False,
                                                                  validHeldOutCount=6, allRequestedHeldOutAvailable=False),
    lambda rows: rows[0]['measurementReport']['summary'].update(heldOutMedianAbsoluteErrorMeters=0.),
    lambda rows: rows[1].update(endToEndSeconds=None),
    lambda rows: rows[1].update(endToEndSeconds=float('nan')),
    lambda rows: rows[1].update(endToEndSeconds=True),
    lambda rows: rows.pop(0),
])
def test_partial_failed_slower_or_worse_candidate_cannot_pass_gate(change):
    rows = gate_rows(); change(rows)
    rc.dimension_timing_gate(rows, predeclared=True, physical=True)
    candidate = next(row for row in rows if row['engine'] == 'vggt')['dimensionAndTimingGate']
    assert candidate['passed'] is False and candidate['status'] in ('failed', 'unavailable')


@pytest.mark.parametrize('predeclared,physical', [(False, True), (True, False), (False, False)])
def test_postrun_or_synthetic_marks_cannot_pass_gate(predeclared, physical):
    rows = gate_rows()
    rc.dimension_timing_gate(rows, predeclared=predeclared, physical=physical)
    assert not rows[1]['dimensionAndTimingGate']['passed']
    assert rows[1]['dimensionAndTimingGate']['status'] == 'unavailable'


def test_missing_candidate_has_no_invented_result():
    rows = gate_rows()[:1]
    rc.dimension_timing_gate(rows, predeclared=True, physical=True)
    assert len(rows) == 1 and rows[0]['engine'] == 'colmap'
    assert rows[0]['dimensionAndTimingGate']['passed'] is False


def test_exact_twenty_percent_and_twofold_boundary_is_accepted():
    rows = gate_rows()
    rows[1]['measurementReport']['summary']['heldOutMedianAbsoluteErrorMeters'] = .08
    rows[1]['endToEndSeconds'] = 5.
    rc.dimension_timing_gate(rows, predeclared=True, physical=True)
    assert rows[1]['dimensionAndTimingGate']['passed']


def test_missing_vggt_installation_is_real_failed_subprocess_with_nonzero_cli(tmp_path):
    case, _ = prepared(tmp_path)
    output = tmp_path / 'missing-installation'
    code = rc.main(['run', '--case', str(case), '--out', str(output), '--engines', 'vggt',
                    '--timeout', '10', '--python', sys.executable])
    assert code == 2
    result = rc.read_json(output / 'run.json')
    assert len(result['runs']) == 1 and result['runs'][0]['engine'] == 'vggt'
    assert result['runs'][0]['status'] == 'failed'
    assert result['runs'][0]['exitCode'] != 0
    assert 'needs --vggt-source' in (output / 'vggt/engine.log').read_text()
    assert not (output / 'vggt/cameras.json').exists()
    comparison = rc.read_json(output / 'comparison.json')
    assert not comparison['promotion']['eligible']
    assert comparison['referenceBasis'] == 'not-provided'


def test_synthetic_report_labels_fixture_without_implying_model_inference(tmp_path):
    out = tmp_path / 'self-test'; rc.self_test(out)
    report = (out / 'run/comparison.md').read_text()
    assert 'synthetic' in report.lower()
    assert 'no model inference' in report.lower()
    assert 'not approved' in report.lower()
