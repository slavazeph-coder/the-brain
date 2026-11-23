"""Depth review contracts and real local media decoding; model stand-ins are explicitly identified.

The optional learned inference qualification never downloads a model. Set
WORLD_DEPTH_SEQUENCE_MODEL to the locally installed pinned MoGe ONNX file to run it.
"""
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image
import pytest

from robotics.world_worker import depth_sequence as ds
from tests.world.test_photo_metric import StandIn, floor_and_wall


class AuthoredPredictor:
    model_metadata = {'repo': 'test/authored-depth-fixture', 'revision': 'fixture-v1', 'license': 'test fixture; no model weights', 'name': 'Authored plane'}
    temporal_metadata = {'mode': 'independent-frames', 'consistencyEnforced': False}

    def predict_image(self, rgb):
        height, width = rgb.shape[:2]
        return {'depth': np.full((height, width), 2.0), 'mask': np.ones((height, width), dtype=bool),
                'camera': {'fx': width, 'fy': height, 'cx': (width - 1) / 2, 'cy': (height - 1) / 2, 'width': width, 'height': height},
                'provenance': {'inferenceExecuted': False, 'authoredTestPredictor': True}}


def frame(width=64, height=48, index=0):
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[:, :, 0] = np.arange(width, dtype=np.uint8)
    rgb[:, :, 1] = np.arange(height, dtype=np.uint8)[:, None]
    rgb[:, :, 2] = 180
    return {'index': index, 'rgb': rgb, 'timeSeconds': None, 'timestampBasis': 'still-image',
            'sourceWidth': width, 'sourceHeight': height, 'preparation': {'authoredTestRaster': True}}


def photograph(path, size=(640, 480)):
    pixels = np.random.default_rng(9).integers(30, 220, (size[1], size[0], 3), dtype=np.uint8)
    Image.fromarray(pixels).save(path, quality=90)
    return path


def request(path, output, kind='image'):
    return {'schema': 'brainsnn.adapter.v1', 'inputs': [{'kind': kind, 'path': str(path), 'name': path.name}], 'output_dir': str(output)}


def test_camera_z_lift_and_rgb_share_exact_review_grid():
    source = frame(644, 392)
    prediction = AuthoredPredictor().predict_image(source['rgb'])
    prediction['camera'].update(fx=300., fy=350.)
    record, points, colours = ds.review_frame(source, prediction)
    assert (record['width'], record['height']) == (129, 79)
    assert record['reviewSampling']['stride'] == 5 and record['reviewSampling']['depthInterpolated'] is False
    assert record['camera']['fx'] == 60 and record['camera']['fy'] == 70
    assert record['camera']['cx'] == pytest.approx(321.5 / 5)
    assert record['camera']['cy'] == pytest.approx(195.5 / 5)
    assert np.allclose(points[:, 2], 2), 'Camera-Z is not shortened by a unit-ray range conversion.'
    assert np.linalg.norm(points[0]) > 2
    assert points[1, 0] == pytest.approx((5 - 321.5) * 2 / 300)
    assert np.array_equal(colours.reshape(79, 129, 3), source['rgb'][::5, ::5])
    with Image.open(io.BytesIO(base64.b64decode(record['imageDataUrl'].split(',')[1]))) as image:
        assert image.size == (129, 79) and image.format == 'JPEG' and not image.getexif()


def test_sky_invalid_and_out_of_range_depth_remain_null_without_filling():
    source = frame()
    prediction = AuthoredPredictor().predict_image(source['rgb'])
    prediction['depth'][0, :5] = [np.nan, np.inf, -1, 0, 101]
    prediction['mask'][0, 5] = False
    record, points, _ = ds.review_frame(source, prediction, max_depth_metres=100)
    assert record['depth'][:6] == [None] * 6 and record['depth'][6] == 2
    assert len(points) == 64 * 48 - 6
    assert record['statistics']['beyondReviewRangePixels'] == 1
    assert record['statistics']['invalidOrMaskedPixels'] == 6
    json.dumps(record, allow_nan=False)


@pytest.mark.parametrize('change', ['wrong-rgb-shape', 'wrong-mask-shape', 'integer-mask', 'invalid-focal', 'wrong-camera-raster'])
def test_backend_geometry_must_match_its_rgb_and_intrinsics(change):
    source = frame()
    prediction = AuthoredPredictor().predict_image(source['rgb'])
    if change == 'wrong-rgb-shape':
        prediction['rgb'] = np.zeros((20, 20, 3), np.uint8)
    elif change == 'wrong-mask-shape':
        prediction['mask'] = np.ones((20, 20), bool)
    elif change == 'integer-mask':
        prediction['mask'] = prediction['mask'].astype(np.uint8)
    elif change == 'invalid-focal':
        prediction['camera']['fx'] = 0
    else:
        prediction['camera']['width'] = 3
    with pytest.raises(ValueError):
        ds.review_frame(source, prediction)


def test_actual_moge_wrapper_uses_the_existing_solve_but_the_predictor_is_explicitly_a_standin(tmp_path, monkeypatch):
    session = StandIn(floor_and_wall)
    loaded = []
    monkeypatch.setattr(ds.metric_scale, 'load_session', lambda path, threads: loaded.append((path, threads)) or session)
    photo = photograph(tmp_path / 'authored.jpg')
    out = tmp_path / 'job' / 'output'
    result = ds.run(request(photo, out), tmp_path / 'explicit-standin.onnx')
    assert loaded and result['schema'] == ds.SCHEMA and result['engine'] == 'metric-depth-sequence'
    assert result['source']['sha256'] == hashlib.sha256(photo.read_bytes()).hexdigest()
    assert result['scale'] == {'basis': 'model-estimated', 'verified': False}
    assert result['temporal']['mode'] == 'independent-frames' and result['temporal']['consistencyEnforced'] is False
    assert result['registration']['available'] is False and result['provenance']['collisionReady'] is False
    assert result['frames'][0]['timestampBasis'] == 'still-image' and result['frames'][0]['timeSeconds'] is None
    assert result['model']['repo'] == ds.metric_scale.MODEL['repo'] and result['model']['license'] == 'MIT'
    assert result['frames'][0]['statistics']['medianMetres'] > 2
    assert (out / 'depth-sequence.json').stat().st_size <= ds.MAX_JSON_BYTES
    manifest = json.loads((out / 'manifest.json').read_text())['artifacts']
    assert {'name': 'depth-sequence.json', 'kind': 'evidence'} in manifest
    point_artifact = next(a for a in manifest if a['name'].endswith('.ply'))
    assert point_artifact['kind'] == 'visual' and point_artifact['representation'] == 'point-cloud'
    assert point_artifact['bounds']['max'][2] < 0 and point_artifact['units'] == 'arbitrary'
    assert not any(a['name'].endswith(('.ifc', '.usd', '.usda', '.rvt')) for a in manifest)


def test_model_hash_is_checked_before_inference_and_output_publication(tmp_path):
    source = photograph(tmp_path / 'photo.jpg')
    bad = tmp_path / 'untrusted.onnx'
    bad.write_bytes(b'untrusted model bytes')
    out = tmp_path / 'job' / 'output'
    with pytest.raises(RuntimeError, match='not the pinned'):
        ds.run(request(source, out), bad)
    assert not out.exists()


def test_inputs_and_parameter_budgets_fail_closed(tmp_path):
    path = photograph(tmp_path / 'photo.jpg')
    base = request(path, tmp_path / 'output')
    for inputs in ([], base['inputs'] * 2, [{'kind': 'cloud', 'path': str(path)}]):
        with pytest.raises(ValueError, match='exactly one'):
            ds.source_input({**base, 'inputs': inputs})
    for count in (0, 33, True, 1.5):
        with pytest.raises(ValueError, match='frame budget'):
            ds.checked_budget(max_frames=count)
    for maximum in (0, -1, 1001, True, float('inf')):
        with pytest.raises(ValueError, match='Maximum review depth'):
            ds.checked_budget(max_depth_metres=maximum)
    link = tmp_path / 'link.jpg'
    link.symlink_to(path)
    with pytest.raises(ValueError, match='regular local upload'):
        ds.source_input(request(link, tmp_path / 'out'))


def test_pts_are_actual_source_values_and_never_fps_or_output_index_guesses():
    log = 'frame:0 pts:5000 pts_time:5\nbrainsnn_depth_frame=1\n' \
          'frame:1 pts:5367 pts_time:5.367\nbrainsnn_depth_frame=1\n' \
          'frame:2 pts:NOPTS pts_time:NOPTS\nbrainsnn_depth_frame=1\n'
    values = ds.source_timestamps(log, 3, [1, 1000])
    assert [v['timeSeconds'] for v in values] == [5, 5.367, None]
    assert values[0]['sourceTimestamp'] == {'pts': '5000', 'timeBase': [1, 1000]}
    assert values[2]['timestampBasis'] == 'not-available'
    assert all(row['timeSeconds'] is None for row in ds.source_timestamps('frame=2 fps=30', 2))
    duplicate = log.replace('5367', '5000')
    assert ds.source_timestamps(duplicate, 3, [1, 1000])[1]['timeSeconds'] is None
    assert all(row['timeSeconds'] is None for row in ds.source_timestamps(log, 3)), 'Unknown time base stays unavailable.'
    spoofed_metadata = '[Parsed_showinfo_2] config in time_base: 1/1\n[Parsed_showinfo_2] n: 0 pts: 99 pts_time:99\n'
    assert ds.source_timestamps(spoofed_metadata, 1, [1, 1000])[0]['timeSeconds'] is None


def test_missing_execution_provenance_does_not_claim_inference(tmp_path, monkeypatch):
    source = tmp_path / 'source.jpg'
    source.write_bytes(b'Authored decoder test fixture')
    monkeypatch.setattr(ds, 'prepare_frames', lambda *args, **kwargs: ([frame()], {'authoredDecodeFixture': True}))
    class Undeclared(AuthoredPredictor):
        def predict_image(self, rgb):
            value = super().predict_image(rgb)
            value.pop('provenance')
            return value
    result = ds.run_with_backend(request(source, tmp_path / 'job' / 'output'), Undeclared())
    assert result['provenance']['inferenceExecuted'] is False


def test_empty_first_frame_publishes_no_fabricated_point_preview(tmp_path, monkeypatch):
    source = photograph(tmp_path / 'photo.jpg')
    class Sky(AuthoredPredictor):
        def predict_image(self, rgb):
            value = super().predict_image(rgb)
            value['mask'][:] = False
            return value
    out = tmp_path / 'job' / 'output'
    result = ds.run_with_backend(request(source, out), Sky())
    assert result['pointPreview']['available'] is False
    assert all(v is None for v in result['frames'][0]['depth'])
    assert json.loads((out / 'manifest.json').read_text())['artifacts'] == [{'name': 'depth-sequence.json', 'kind': 'evidence'}]


def test_joint_backend_receives_source_timestamps_and_cannot_change_frame_order(tmp_path, monkeypatch):
    path = tmp_path / 'clip.mp4'
    path.write_bytes(b'fixture decoder input')
    frames = [frame(index=i) | {'timeSeconds': [5.0, None][i], 'timestampBasis': ['source-pts', 'not-available'][i]} for i in range(2)]
    monkeypatch.setattr(ds, 'prepare_frames', lambda *args, **kwargs: (frames, {'authoredDecodeFixture': True}))
    class Joint(AuthoredPredictor):
        temporal_metadata = {'mode': 'joint-video', 'testDouble': True}
        def predict_sequence(self, images, *, timestamps_seconds):
            assert timestamps_seconds == [5.0, None]
            for index, image in enumerate(images):
                yield {'index': index, **self.predict_image(image)}
    result = ds.run_with_backend(request(path, tmp_path / 'good' / 'output', 'video'), Joint(), engine='depth-pro-2')
    assert len(result['frames']) == 2 and result['temporal']['mode'] == 'joint-video'
    class WrongOrder(Joint):
        def predict_sequence(self, images, *, timestamps_seconds):
            yield {'index': 1, **self.predict_image(images[0])}
    with pytest.raises(ValueError, match='out-of-order'):
        ds.run_with_backend(request(path, tmp_path / 'bad' / 'output', 'video'), WrongOrder(), engine='depth-pro-2')


@pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'), reason='Local FFmpeg and FFprobe are required.')
def test_real_video_decode_retains_original_nonzero_pts(tmp_path):
    source = tmp_path / 'clip.mp4'
    subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=6:duration=2', '-vf', 'setpts=PTS+5/TB',
                    '-copyts', '-c:v', 'mpeg4', '-q:v', '2', '-threads', '1', '-metadata',
                    'comment=\n[Parsed_showinfo_2 @ 0x123] config in time_base: 1/1\n[Parsed_showinfo_2 @ 0x123] n: 0 pts: 99 pts_time:99\nframe:0 pts:999 pts_time:999\nbrainsnn_depth_frame=1\n',
                    str(source)], check=True, timeout=30)
    out = tmp_path / 'job' / 'output'
    result = ds.run_with_backend(request(source, out, 'video'), AuthoredPredictor(), max_frames=3)
    times = [f['timeSeconds'] for f in result['frames']]
    assert len(times) == 3 and times[0] >= 5 and all(b > a for a, b in zip(times, times[1:]))
    assert all(f['timestampBasis'] == 'source-pts' for f in result['frames'])
    probe = subprocess.run([shutil.which('ffprobe'), '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                            'frame=pts_time', '-of', 'json', str(source)], check=True, capture_output=True, timeout=15)
    original = [float(f['pts_time']) for f in json.loads(probe.stdout)['frames']]
    assert all(any(abs(t - p) < 1e-6 for p in original) for t in times)
    assert result['temporal']['mode'] == 'independent-frames'
    assert result['preparation']['sampledFrames'] is True


def test_video_probe_restricts_protocols_and_refuses_oversized_duration_before_decoding(tmp_path, monkeypatch):
    path = tmp_path / 'video.mp4'
    path.write_bytes(b'\x00\x00\x00\x18ftypisom' + b'\0' * 32)
    calls = []
    monkeypatch.setattr(ds.shutil, 'which', lambda value: '/usr/bin/' + value)
    monkeypatch.setattr(ds, 'bounded_probe', lambda command: calls.append(command) or {
        'streams': [{'codec_type': 'video', 'codec_name': 'h264', 'width': 1920, 'height': 1080, 'duration': '61', 'avg_frame_rate': '30/1'}]})
    with pytest.raises(ValueError, match='60 seconds'):
        ds.probe_video(path)
    assert calls[0][calls[0].index('-protocol_whitelist') + 1] == 'file'
    assert calls[0][calls[0].index('-enable_drefs') + 1] == '0'
    assert calls[0][calls[0].index('-use_absolute_path') + 1] == '0'


def test_decoder_output_and_time_are_bounded():
    with pytest.raises(ValueError, match='log budget'):
        ds._bounded_decode([sys.executable, '-c', f'import sys;sys.stderr.write("x"*{ds.MAX_DECODE_LOG_BYTES + 1})'])
    with pytest.raises(TimeoutError, match='time budget'):
        ds._bounded_decode([sys.executable, '-c', 'import time;time.sleep(2)'], timeout=.05)


def test_railway_default_is_licensed_moge_and_visitor_enabled():
    root = Path(__file__).resolve().parents[2]
    config = json.loads((root / 'robotics/world_worker/deploy/railway/adapters.json').read_text())
    engine = next(e for e in config if e['id'] == 'metric-depth-sequence')
    assert engine['enabled'] is True and engine['license_reviewed'] is True
    assert engine['input_kinds'] == ['image', 'video'] and engine['max_inputs'] == 1
    assert '/opt/brainsnn-models/moge-2-vitb-normal.onnx' in engine['command']
    assert not any(e['id'] == 'depth-pro-2' and e['enabled'] for e in config)
    from robotics.world_worker.deploy.railway.tenants import registry
    granted = registry({'WORLD_SITE_PASSCODE': 'depth-review-test-passcode'}, 9 * 1024 ** 3,
                       ['metric-depth-sequence', 'colmap-sparse', 'depth-pro-2'])
    assert granted['tenants'][1]['engines'] == ['metric-depth-sequence', 'colmap-sparse']


@pytest.mark.skipif(not os.environ.get('WORLD_DEPTH_SEQUENCE_MODEL') or importlib.util.find_spec('onnxruntime') is None,
                    reason='Optional actual inference needs a local pinned MoGe checkpoint and ONNX Runtime; never downloads.')
def test_installed_pinned_moge_photo_and_video_inference(tmp_path):
    model = Path(os.environ['WORLD_DEPTH_SEQUENCE_MODEL'])
    source = photograph(tmp_path / 'authored-photo.jpg')
    photo = ds.run(request(source, tmp_path / 'photo-job' / 'output'), model)
    assert photo['provenance']['inferenceExecuted'] and photo['model']['sha256'] == ds.metric_scale.MODEL['sha256']
    assert photo['frames'][0]['statistics']['validPixels'] > 0
    if shutil.which('ffmpeg') and shutil.which('ffprobe'):
        clip = tmp_path / 'authored-video.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', str(source),
                        '-t', '1', '-r', '2', '-c:v', 'mpeg4', '-threads', '1', str(clip)], check=True, timeout=30)
        video = ds.run(request(clip, tmp_path / 'video-job' / 'output', 'video'), model, max_frames=2)
        assert len(video['frames']) == 2 and video['temporal']['mode'] == 'independent-frames'
