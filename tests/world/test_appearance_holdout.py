"""Black-box evaluation regressions. The expected pixels are authored independently of projection."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

import numpy as np
import pytest
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'scripts/world-demo'))
sys.path.insert(0, str(HERE / 'fixtures/appearance-holdout'))
import evaluate_appearance as ev
import make_fixture as fixture


@pytest.fixture
def files(tmp_path):
    return fixture.make(tmp_path / 'job')


def read(path):
    return json.loads(path.read_bytes())


def relabel(files, **updates):
    labels = read(files['labels_path'])
    fixture.write_json(files['labels_path'], {**labels, **updates})


def update_ledger(files, change):
    ledger = files['job'] / 'output/camera-frames.json'
    record = read(ledger)
    change(record)
    fixture.write_json(ledger, record)
    relabel(files, cameraLedger={'name': 'output/camera-frames.json', 'sha256': fixture.sha(ledger)})


def cli(files, *extra):
    cmd = [sys.executable, str(Path(ev.__file__)), '--object', files['object_id']]
    for name in ('job', 'labels_path', 'source', 'edits', 'variant', 'receipt'):
        cmd.extend(['--' + name.removesuffix('_path'), str(files[name])])
    return subprocess.run(cmd + list(extra), capture_output=True, text=True)


@pytest.mark.parametrize('case,iou,floor,fp,fn,other,passed', [
    ('original', 1, 0, 0, 0, 0, True),  # native JSON serializes a signed-zero bound as 0
    ('correct', 1, 0, 0, 0, 0, True),
    ('incomplete', .5, 0, 0, 2, 0, False),
    ('floor', .8, .2, 1, 0, 0, False),
    ('background', .8, 0, 1, 0, 1, False),
    ('occluded', 0, None, 0, 4, 0, False),
    ('ignored', 1, 0, 0, 0, 0, True),
])
def test_real_cli_on_authored_membership(tmp_path, case, iou, floor, fp, fn, other, passed):
    files = fixture.make(tmp_path / 'job', case)
    result = cli(files)
    assert result.returncode == (0 if passed else 1), result.stderr
    report = json.loads(result.stdout)
    assert report['allFramesMeetTargets'] is passed
    assert report['originalSourcePreserved'] and report['captureKindDeclared'] == 'authored-fixture'
    for view in report['frames']:
        assert (view['iou'], view['floorContamination'], view['falsePositive'], view['falseNegative'],
                view['otherBackgroundPixelsPredicted']) == (iou, floor, fp, fn, other)
        assert view['ignoredPredictedPixels'] == int(case == 'ignored')
        if case == 'occluded':
            assert view['selectedInFrustum'] == view['selectedLosingDepthTest'] == 2
            assert view['predictedPixels'] == 0


def test_repeat_byte_identical_and_preserve_all_inputs(files):
    before = {p: fixture.sha(p) for p in files['job'].rglob('*') if p.is_file()}
    first, second = cli(files), cli(files)
    assert first.returncode == second.returncode == 0 and first.stdout == second.stdout
    report = json.loads(first.stdout)
    assert report['sourceSha256Before'] == report['sourceSha256After'] == before[files['source']]
    # Invalid raw row 1 is missing from the preview. Original vertex IDs are 0,2,3,4.
    assert report['membership']['selectedSourceIdsSha256'] == hashlib.sha256(struct.pack('<4I', 0, 2, 3, 4)).hexdigest()
    assert report['membership']['exportReplayMatched']
    assert cli(files, '--out', str(files['source'])).returncode == 2
    assert before == {p: fixture.sha(p) for p in files['job'].rglob('*') if p.is_file()}


@pytest.mark.parametrize('kind', ['ply', 'splat'])
def test_flip_and_authored_instances_are_scored_in_original_camera_coordinates(tmp_path, kind):
    files = fixture.make(tmp_path / 'job', kind=kind, orientation='flip-y-z')
    report = ev.evaluate(**files)
    assert report['membership']['source']['displayTransform'] == 'flip-y-z'
    assert report['allFramesMeetTargets']
    assert [f['intersection'] for f in report['frames']] == [4, 4]


def test_splat_refuses_a_similar_but_different_camera_cloud(tmp_path):
    files = fixture.make(tmp_path / 'job', kind='splat')
    cloud = files['job'] / 'output/fixture.ply'
    cloud.write_text(cloud.read_text().replace('40 0 2', '41 0 2'))
    update_ledger(files, lambda l: l['clouds'][0].update(sha256=fixture.sha(cloud)))
    relabel(files, cameraCloudSha256=fixture.sha(cloud))
    with pytest.raises(ValueError, match='centres differ'):
        ev.evaluate(**files)


@pytest.mark.parametrize('defect,message', [
    ('source', 'frozen label manifest'), ('editSource', 'different source'),
    ('receipt', 'receipt disagree'), ('variant', 'Derived PLY'), ('editBytes', 'Edit bytes'),
    ('orientation', 'different source'), ('unreviewed', 'reviewed|Review the selected'),
    ('ledger', 'ledger hash'), ('cloud', 'another point-cloud'), ('focal', 'Focal length'),
    ('reflection', 'proper rigid'), ('frameHash', 'SHA-256'), ('staleMask', 'mask hash'),
    ('size', 'exact camera raster'), ('unknownLabel', 'undefined labels'),
    ('overlap', 'overlap'), ('duplicate', 'Duplicate frame'), ('missingFrame', 'missing'),
    ('sameReviewer', 'separate reviewer'), ('maskTraversal', 'traversal'),
])
def test_refuse_unusable_inputs_without_reporting_a_score(files, defect, message):
    labels = read(files['labels_path'])
    if defect == 'source':
        with files['source'].open('ab') as stream: stream.write(b'\n')
    elif defect in ('editSource', 'orientation', 'unreviewed'):
        edits = read(files['edits'])
        if defect == 'editSource': edits['source']['sha256'] = 'f' * 64
        if defect == 'orientation': edits['source']['displayTransform'] = 'flip-y-z'
        if defect == 'unreviewed': edits['objects'][0]['reviewed'] = False
        fixture.write_json(files['edits'], edits)
    elif defect == 'receipt':
        receipt = read(files['receipt'])
        receipt['objects'][0]['pointCount'] += 1
        fixture.write_json(files['receipt'], receipt)
    elif defect == 'variant':
        payload = bytearray(files['variant'].read_bytes())
        payload[-1] ^= 1  # object_instance tag
        files['variant'].write_bytes(payload)
    elif defect == 'editBytes':
        with files['edits'].open('ab') as stream: stream.write(b' ')
    elif defect == 'ledger':
        labels['cameraLedger']['sha256'] = 'f' * 64
        relabel(files, **labels)
    elif defect == 'cloud':
        relabel(files, cameraCloudSha256='f' * 64)
    elif defect == 'focal':
        update_ledger(files, lambda l: l['frames'][0]['camera'].update(params=[0, 2, 3, 2]))
    elif defect == 'reflection':
        update_ledger(files, lambda l: l['frames'][0]['cam_from_world'][0].__setitem__(0, -1))
    elif defect == 'frameHash':
        (files['job'] / 'images/authored-0.png').write_bytes(b'stale')
    elif defect in ('staleMask', 'size', 'unknownLabel', 'maskTraversal'):
        binding = labels['frames'][0]
        path = files['job'] / binding['mask']
        if defect == 'staleMask':
            path.write_bytes(b'changed')
        elif defect == 'maskTraversal':
            binding['mask'] = '../' + binding['mask']
        else:
            image = Image.new('L', (8, 7) if defect == 'size' else (9, 7), 17)
            image.save(path)
            binding['maskSha256'] = fixture.sha(path)
        relabel(files, frames=labels['frames'])
    elif defect == 'overlap':
        relabel(files, selectionFrameIds=[labels['frames'][0]['frameId']])
    elif defect == 'duplicate':
        relabel(files, frames=[labels['frames'][0]] * 2)
    elif defect == 'missingFrame':
        labels['frames'][0]['frameId'] = 'e' * 64
        relabel(files, frames=labels['frames'])
    elif defect == 'sameReviewer':
        relabel(files, labelReviewer=labels['selectionOperator'].upper())
    with pytest.raises(ValueError, match=message):
        ev.evaluate(**files)


def test_refuses_a_changed_source_at_end_of_run(files, monkeypatch):
    original = ev.score_view
    def change_source(*args):
        with files['source'].open('ab') as stream: stream.write(b'\n')
        return original(*args)
    monkeypatch.setattr(ev, 'score_view', change_source)
    with pytest.raises(ValueError, match='changed during evaluation'):
        ev.evaluate(**files)


def test_unseen_label_counts_as_miss_and_one_bad_view_fails_run(files):
    labels = read(files['labels_path'])
    binding = labels['frames'][1]
    path = files['job'] / binding['mask']
    with Image.open(path) as img:
        mask = img.copy()
    mask.putpixel((8, 0), 1)
    mask.save(path)
    binding['maskSha256'] = fixture.sha(path)
    relabel(files, frames=labels['frames'])
    report = ev.evaluate(**files)
    assert report['frames'][0]['meetsTargets'] and not report['allFramesMeetTargets']
    view = report['frames'][1]
    assert view['iou'] == view['iouCeilingFromSampleCoverage'] == .8
    assert view['referencePixelsWithoutSourceCentre'] == 1 and view['referencePixelsWithUnselectedWinner'] == 0


@pytest.mark.parametrize('selected_count,target,floor,passes', [(85, 100, 0, True), (84, 100, 0, False),
                                                               (100, 99, 1, False), (101, 100, 1, True)])
def test_exact_thresholds(selected_count, target, floor, passes):
    view = {'width': 110, 'height': 1, 'cam_from_world': np.eye(4)[:3],
            'project': lambda camera: camera[:, :2]}
    xyz = np.column_stack((np.arange(110), np.zeros(110), np.ones(110)))
    mask = np.zeros((1, 110), dtype=np.uint8)
    mask[:, :target] = 1
    mask[:, target:target + floor] = 2
    result = ev.score_view(xyz, np.arange(110) < selected_count, view, mask)
    assert result['meetsTargets'] is passes


def test_cli_invalid_inputs_exit_two_without_metrics(files):
    result = cli({**files, 'object_id': 'object-000999'})
    assert result.returncode == 2 and result.stdout == '' and 'reviewed base object' in result.stderr


def test_partial_job_keeps_ledger_checks_and_default_strictness(files):
    # No private RGB or unused secondary PLY needs to be invented for an unrelated view.
    import copy
    def add_absent(record):
        frame = copy.deepcopy(record['frames'][0])
        frame['image'].update(name='images/absent.png', sha256='a' * 64)
        frame['frame_id'] = ev.cameras.frame_id(record['sources'][0]['sha256'], frame['image']['sha256'],
                                                frame['camera'], frame['cam_from_world'])
        record['frames'].append(frame)
        record['clouds'].append({**record['clouds'][0], 'name': 'output/absent.ply', 'sha256': 'a' * 64})
    update_ledger(files, add_absent)
    assert ev.evaluate(**files)['allFramesMeetTargets']
    with pytest.raises(ValueError, match='missing'):
        ev.cameras.load_views(files['job'])
    def invalidate_absent(record):
        record['frames'][-1]['camera']['params'][0] = 0
    update_ledger(files, invalidate_absent)
    with pytest.raises(ValueError, match='Focal length'):
        ev.evaluate(**files)


def test_raster_alias_cannot_cross_split(files):
    import copy
    def add_alias(record):
        twin = copy.deepcopy(record['frames'][0])
        twin['image']['name'] = 'images/alias.png'
        twin['cam_from_world'][0][3] = 2
        twin['frame_id'] = ev.cameras.frame_id(record['sources'][0]['sha256'], twin['image']['sha256'],
                                               twin['camera'], twin['cam_from_world'])
        record['frames'].append(twin)
    update_ledger(files, add_alias)
    ledger = read(files['job'] / 'output/camera-frames.json')
    relabel(files, selectionFrameIds=[ledger['frames'][-1]['frame_id']])
    with pytest.raises(ValueError, match='raster reused'):
        ev.evaluate(**files)


def test_coverage_uses_actual_retained_centres_and_unique_depth_pixels(files):
    import appearance_coverage as coverage
    labels = read(files['labels_path'])
    spec = {'cameraLedgerSha256': labels['cameraLedger']['sha256'],
            'cameraCloudSha256': labels['cameraCloudSha256'], 'regions': {}}
    for i, view in enumerate(labels['frames']):
        spec['regions'][view['frameId']] = {'interior': [3+i, 2, 6+i, 4], 'envelope': [0, 0, 9, 7]}
    path = files['job'] / 'regions.json'
    fixture.write_json(path, spec)
    report = coverage.coverage(files['job'], path)
    assert report['retained'] == 11 and report['originalSourcePreserved']
    for frame in report['frames']:
        assert frame['interiorPixels'] == 6 and frame['interiorHits'] == 5
        assert frame['envelopeHits'] == frame['visibleSourcePixels'] == 7
        assert frame['iouUpperBound'] == frame['interiorOnlyUpperBound'] == 7/8
    for key in ('cameraCloudSha256', 'cameraLedgerSha256'):
        fixture.write_json(path, {**spec, key: '0' * 64})
        with pytest.raises(ValueError):
            coverage.coverage(files['job'], path)


@pytest.mark.parametrize('interior,envelope', [
    ([0, 0, 0, 1], [0, 0, 2, 2]),
    ([0, 0, 1, 2], [0, 0, 2, 1]),
    ([0, 0, 1, 1], [-1, 0, 2, 2]),
    ([0, 0, 1.0, 1], [0, 0, 2, 2]),
])
def test_coverage_refuses_invalid_region(interior, envelope):
    from appearance_coverage import bound
    with pytest.raises(ValueError):
        bound(np.array([], dtype=int), {'width': 2, 'height': 2}, {'interior': interior, 'envelope': envelope})
