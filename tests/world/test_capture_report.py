"""The capture report: seconds of the walk that registered, the ones that did not, and what the frames support."""
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import capture_report as cr  # noqa: E402


def reconstruction(registered, n=20, fps=1.0):
    frames = [{'image': f'image_{i:04d}.jpg', 'resampledOutputIndex': i} for i in range(n)]
    return {'schema': 'brainsnn.reconstruction.v1', 'capture': {'frames': frames, 'sample_fps': fps, 'duration_seconds': n / fps},
            'cameras': [{'image': f'image_{i:04d}.jpg'} for i in registered]}


def write_frames(folder, n, soft):
    rng = np.random.default_rng(0)
    for i in range(n):
        a = rng.integers(0, 255, (90, 160), np.uint8)
        img = Image.fromarray(a)
        if i in soft:
            from PIL import ImageFilter
            img = img.filter(ImageFilter.GaussianBlur(4))
        img.save(folder / f'image_{i:04d}.jpg')


def test_stretches_are_in_seconds_and_the_longest_registered_one_is_named(tmp_path):
    report = cr.build(reconstruction(list(range(0, 8)) + list(range(14, 20))))
    assert report['status'] == 'ok' and report['seconds_total'] == 20 and report['seconds_registered'] == 14
    assert [(s['start'], s['end'], s['registered']) for s in report['stretches']] == [(0, 8, True), (8, 14, False), (14, 20, True)]
    assert report['longest_registered']['start'] == 0 and report['longest_registered']['seconds'] == 8
    assert report['dropped'][0]['cause'] == 'no-overlap' and 'none joined' in report['dropped'][0]['reason'] or 'No frame here' in report['dropped'][0]['reason']
    assert 'Most of the walk is in the model' in report['verdict']
    assert report['sharpness']['measured'] is False


def test_soft_dropped_frames_are_called_motion_blur_and_sharp_ones_no_overlap(tmp_path):
    write_frames(tmp_path, 20, soft={8, 9, 10, 11, 12, 13})
    report = cr.build(reconstruction(list(range(0, 8)) + list(range(17, 20))), tmp_path)
    assert report['sharpness']['measured'] is True
    causes = {(d['start'], d['end']): d['cause'] for d in report['dropped']}
    assert causes == {(8, 17): 'motion-blur'}, 'six of nine dropped frames are soft'
    assert any('Turns are where frames blur' in a for a in report['advice'])
    assert 'Most of the walk is in the model' in report['verdict']
    write_frames(tmp_path, 20, soft=set())
    report = cr.build(reconstruction(list(range(0, 8)) + list(range(17, 20))), tmp_path)
    assert {(d['start'], d['end']): d['cause'] for d in report['dropped']} == {(8, 17): 'no-overlap'}, 'sharp frames that did not join'


def test_short_gaps_get_no_advice_and_a_full_registration_says_so():
    report = cr.build(reconstruction([i for i in range(20) if i != 5]))
    assert report['dropped'] == [] and len(report['stretches']) == 3
    assert 'The whole walk is in the model' in report['verdict'] and report['advice'] == []


def test_no_frames_and_the_written_file(tmp_path):
    assert cr.build({'schema': 'brainsnn.reconstruction.v1', 'capture': {}, 'cameras': []})['status'] == 'no-frames'
    path, report = cr.write(tmp_path, reconstruction([0, 1, 2]))
    assert path.name == 'capture-report.json' and json.loads(path.read_text())['schema'] == cr.SCHEMA
    assert report['registered_share'] == 0.15 and 'Most of the walk did not join' in report['verdict']
