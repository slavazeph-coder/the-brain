"""Restricted connector tests use synthetic files and a mocked official API only.

No Apple checkpoint is downloaded, loaded or used for product development in these
tests. Patched fixture digests are deliberately distinct from the production pins.
"""
from contextlib import nullcontext
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker import depth_pro2_backend as adapter


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prediction(rgb, focal=80.0):
    height, width = rgb.shape[:2]
    depth = np.full((height, width), 1 + int(rgb[0, 0, 0]) / 10, np.float32)
    inverse = focal / (width * depth)
    depth[0, 0], inverse[0, 0] = np.inf, 0  # Sky is a mask, not a finite surface.
    return {'depth': depth, 'inverse_depth': inverse, 'focallength_px': np.array(focal, np.float32)}


class BufferedStream:
    def __init__(self, model, options):
        self.model, self.options = model, options
        self.pending = []
        self.flush_calls = 0

    def step(self, frame):
        self.pending.append(frame)
        if len(self.pending) < self.options['window']:
            return []
        count = self.options['window'] - self.options['overlap']
        done, self.pending = self.pending[:count], self.pending[count:]
        return [prediction(rgb, self.options['f_px'] or 80.0) for rgb in done]

    def flush(self):
        self.flush_calls += 1
        done, self.pending = self.pending, []
        result = [prediction(rgb, self.options['f_px'] or 80.0) for rgb in done]
        if self.model.tail == 'missing':
            return result[:-1]
        if self.model.tail == 'extra':
            return result + result[-1:]
        if self.model.tail == 'focal-change' and result:
            result[-1] = prediction(done[-1], 100)
        return result


class OfficialModelMock:
    def __init__(self):
        self.fov = None
        self.streams = []
        self.tail = None
        self.infer = Mock(side_effect=lambda rgb, f_px=None: prediction(rgb, f_px or 80.0))

    def to(self, device):
        self.device = device
        return self

    def eval(self):
        self.training = False
        return self

    def stream(self, **options):
        stream = BufferedStream(self, options)
        self.streams.append(stream)
        return stream


class DepthPro2BackendTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.package = self.root / 'source' / 'depth_pro_2'
        self.directory = self.root / 'model'
        self.directory.mkdir(parents=True)
        source_pins = {}
        for name in adapter.SOURCE_FILES:
            raw = f'# synthetic source fixture for {name}; never executed\n'.encode()
            path = self.package / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            source_pins[name] = digest(raw)
        checkpoint = b'synthetic small-model fixture; not a checkpoint'
        configuration = b'{"fov": false}\n'
        focal = b'synthetic focal fixture; not a checkpoint'
        permission = b'Synthetic test receipt; grants no actual model rights.\n'
        (self.directory / 'model.safetensors').write_bytes(checkpoint)
        (self.directory / 'config.json').write_bytes(configuration)
        self.focal = self.root / 'focal.safetensors'
        self.focal.write_bytes(focal)
        self.permission = self.root / 'permission.txt'
        self.permission.write_bytes(permission)
        model_pin = {**adapter.MODEL, 'sha256': digest(checkpoint), 'config_sha256': digest(configuration), 'bytes': len(checkpoint)}
        focal_pin = {**adapter.FOCAL_MODEL, 'sha256': digest(focal), 'bytes': len(focal)}
        patched = patch.multiple(adapter, SOURCE_FILES=source_pins, MODEL=model_pin, FOCAL_MODEL=focal_pin)
        patched.start()
        self.addCleanup(patched.stop)
        self.config = {
            'schema': adapter.SCHEMA, 'enabled': True,
            'authorization': {'kind': 'separate-written-permission', 'scope': 'product-development-and-commercial-service',
                              'document_path': str(self.permission), 'document_sha256': digest(permission)},
            'source': {'commit': adapter.SOURCE_COMMIT, 'package_dir': str(self.package)},
            'model': {'directory': str(self.directory), 'sha256': model_pin['sha256'], 'config_sha256': model_pin['config_sha256']},
            'focal': {'path': str(self.focal), 'sha256': focal_pin['sha256']},
            'device': 'cpu', 'precision': 'fp32', 'window': 4, 'overlap': 1, 'max_depth_m': 100,
        }
        self.rgb = np.zeros((16, 24, 3), np.uint8)

    def runtime(self, *, origin=None, cuda=True):
        """Mock the published API; no model implementation or checkpoint executes."""
        model = OfficialModelMock()
        factory = Mock(return_value=model)
        estimator = SimpleNamespace(load_state_dict=Mock())
        safetensors = Mock(return_value={'synthetic-state': 'fixture'})
        torch = SimpleNamespace(float32='float32', float16='float16', bfloat16='bfloat16', device=lambda x: x,
                                inference_mode=nullcontext, cuda=SimpleNamespace(is_available=lambda: cuda, is_bf16_supported=lambda: True),
                                backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)))
        modules = {
            'torch': torch,
            'depth_pro_2': SimpleNamespace(DepthPro2=SimpleNamespace(from_pretrained=factory)),
            'depth_pro_2.model': SimpleNamespace(to_normalized_tensor=lambda rgb, device: rgb),
            'depth_pro_2.network.fov': SimpleNamespace(FOVEstimator=lambda dtype: estimator),
            'safetensors.torch': SimpleNamespace(load_file=safetensors),
        }
        importer = patch.object(adapter.importlib, 'import_module', side_effect=lambda name: modules[name])
        finder = patch.object(adapter.importlib.util, 'find_spec', return_value=SimpleNamespace(origin=str(origin or self.package / '__init__.py')))
        environment = patch.dict(adapter.os.environ, {}, clear=False)
        for context in (importer, finder, environment):
            context.start()
            self.addCleanup(context.stop)
        return model, factory, estimator, safetensors

    def test_disabled_and_research_only_declarations_fail_before_optional_imports(self):
        for change in ({'enabled': False}, {'enabled': 1}, {'schema': 'other'}):
            with self.subTest(change=change), patch.object(adapter.importlib, 'import_module', side_effect=AssertionError('must not import')):
                with self.assertRaises(ValueError):
                    adapter.DepthPro2Backend({**self.config, **change})
        value = deepcopy(self.config)
        value['authorization']['kind'] = 'public-research-license'
        with patch.object(adapter.importlib, 'import_module', side_effect=AssertionError('must not import')):
            with self.assertRaisesRegex(ValueError, 'Separate written permission'):
                adapter.DepthPro2Backend(value)
        with self.assertRaisesRegex(ValueError, 'unsupported fields'):
            adapter.DepthPro2Backend({**self.config, 'browser_permission_checkbox': True})

    def test_receipt_source_and_checkpoint_are_verified_before_loading(self):
        cases = [
            ('authorization', 'document_sha256', '0' * 64),
            ('source', 'commit', 'main'),
            ('model', 'sha256', '0' * 64),
            ('model', 'config_sha256', '0' * 64),
            ('focal', 'sha256', '0' * 64),
            ('focal', 'path', 'https://example.invalid/model.safetensors'),
        ]
        with patch.object(adapter.importlib, 'import_module', side_effect=AssertionError('must not import')):
            for section, key, value in cases:
                config = deepcopy(self.config)
                config[section][key] = value
                with self.subTest(section=section, key=key), self.assertRaises(ValueError):
                    adapter.DepthPro2Backend(config)
            (self.package / 'model.py').write_bytes(b'changed source')
            with self.assertRaisesRegex(ValueError, 'pinned SHA-256'):
                adapter.DepthPro2Backend(self.config)

    def test_missing_or_changed_weight_file_never_reaches_model_import(self):
        with patch.object(adapter.importlib, 'import_module', side_effect=AssertionError('must not import')):
            path = self.directory / 'model.safetensors'
            path.write_bytes(b'x' * path.stat().st_size)
            with self.assertRaisesRegex(ValueError, 'pinned SHA-256'):
                adapter.DepthPro2Backend(self.config)
            path.unlink()
            with self.assertRaisesRegex(ValueError, 'missing'):
                adapter.DepthPro2Backend(self.config)

    def test_local_official_api_loads_once_with_no_hub_fallback_and_correct_focal_labels(self):
        backend = adapter.DepthPro2Backend(self.config)
        model, factory, estimator, load = self.runtime()
        first = backend.predict_image(self.rgb, focal_px=120)
        second = backend.predict_image(self.rgb)
        factory.assert_called_once_with(str(self.directory), precision='float32', strict=True, local_files_only=True)
        load.assert_called_once_with(str(self.focal), device='cpu')
        estimator.load_state_dict.assert_called_once_with({'synthetic-state': 'fixture'}, strict=True)
        self.assertEqual(adapter.os.environ['HF_HUB_OFFLINE'], '1')
        self.assertEqual(model.device, 'cpu')
        self.assertEqual(model.infer.call_count, 2)
        self.assertEqual(first['camera'], {'fx': 120.0, 'fy': 120.0, 'cx': 11.5, 'cy': 7.5, 'width': 24, 'height': 16})
        self.assertEqual(first['provenance']['focal_source'], 'supplied-at-input-resolution')
        self.assertEqual(second['provenance']['focal_source'], 'estimated-from-image')
        self.assertFalse(first['mask'][0, 0])
        self.assertTrue(np.isnan(first['depth'][0, 0]))
        self.assertFalse(first['provenance']['metric_verified'])
        self.assertFalse(first['provenance']['joint_video_model_applied'])
        self.assertFalse(first['provenance']['overlap_blending_applied_to_sequence'])
        self.assertFalse(backend.model_metadata['hardware_qualified'])
        self.assertNotIn('document_path', backend.model_metadata['authorization'])
        self.assertEqual(backend.temporal_metadata['mode'], 'joint-video')
        self.assertEqual(backend.temporal_metadata['stream_mode'], 'buffered')
        self.assertTrue(backend.temporal_metadata['overlapBlendingConfigured'])
        self.assertNotIn('overlapBlending', backend.temporal_metadata)

    def test_absent_focal_requires_input_calibration_before_import(self):
        config = deepcopy(self.config)
        config.pop('focal')
        backend = adapter.DepthPro2Backend(config)
        with patch.object(adapter.importlib, 'import_module', side_effect=AssertionError('must not import')):
            with self.assertRaisesRegex(ValueError, 'Supply focal_px'):
                backend.predict_image(self.rgb)
        model, _, _, load = self.runtime()
        result = backend.predict_image(self.rgb, focal_px=100)
        self.assertEqual(result['camera']['fx'], 100)
        self.assertIsNone(model.fov)
        load.assert_not_called()

    def test_buffered_video_returns_every_frame_in_order_and_flushes_tail(self):
        backend = adapter.DepthPro2Backend(self.config)
        model, _, _, _ = self.runtime()
        frames = [np.full_like(self.rgb, index) for index in range(7)]
        timestamps = [0.0, 0.1, None, 0.3, 0.4, 0.5, 0.6]
        result = list(backend.predict_sequence(frames, timestamps_seconds=timestamps))
        self.assertEqual([r['index'] for r in result], list(range(7)))
        self.assertEqual([r['timestamp_seconds'] for r in result], timestamps)
        np.testing.assert_allclose([r['depth'][1, 1] for r in result], 1 + np.arange(7) / 10)
        self.assertEqual(model.streams[0].flush_calls, 1)
        self.assertEqual(model.streams[0].options, {'window': 4, 'overlap': 1, 'f_px': None, 'mode': 'buffered'})
        self.assertTrue(all(r['provenance']['joint_video_model_applied'] for r in result))
        self.assertTrue(all(r['provenance']['overlap_blending_applied_to_sequence'] for r in result))
        self.assertTrue(all(r['provenance']['focal_source'] == 'estimated-from-first-video-window' for r in result))
        again = list(backend.predict_sequence(frames[:2]))
        self.assertEqual([r['index'] for r in again], [0, 1])
        self.assertTrue(all(r['timestamp_seconds'] is None for r in again))
        self.assertFalse(any(r['provenance']['overlap_blending_applied_to_sequence'] for r in again))
        self.assertEqual(len(model.streams), 2, 'a new stream must not retain another video')
        exact_window = list(backend.predict_sequence(frames[:4]))
        self.assertFalse(any(r['provenance']['overlap_blending_applied_to_sequence'] for r in exact_window),
                         'one full window flushes the held tail without another overlapping prediction')
        single = list(backend.predict_sequence(frames[:1]))
        self.assertFalse(single[0]['provenance']['joint_video_model_applied'])
        self.assertTrue(single[0]['provenance']['video_stream_applied'])
        individual = adapter.DepthPro2Backend({**self.config, 'window': 1, 'overlap': 0})
        self.assertEqual(individual.temporal_metadata['mode'], 'independent-frames')
        self.assertFalse(individual.temporal_metadata['joint_video_model'])
        self.assertFalse(individual.temporal_metadata['looks_ahead'])

    def test_bad_frames_timestamps_and_focal_values_fail_before_model_load(self):
        backend = adapter.DepthPro2Backend(self.config)
        with patch.object(backend, '_load', side_effect=AssertionError('must not load')):
            for focal in (0, -1, float('nan'), float('inf'), True):
                with self.subTest(focal=focal), self.assertRaises(ValueError):
                    backend.predict_image(self.rgb, focal_px=focal)
            for frame in (self.rgb.astype(np.float32), self.rgb[:, :, 0], np.zeros((1281, 16, 3), np.uint8)):
                with self.assertRaises(ValueError):
                    backend.predict_image(frame)
            for frames, timestamps in [([], []), ([self.rgb] * 33, None),
                                       ([self.rgb, np.zeros((16, 25, 3), np.uint8)], None),
                                       ([self.rgb] * 2, [0, 0]), ([self.rgb] * 2, [1, 0]),
                                       ([self.rgb] * 2, [0, float('nan')]), ([self.rgb] * 2, [0])]:
                with self.assertRaises(ValueError):
                    list(backend.predict_sequence(frames, timestamps_seconds=timestamps))

    def test_upstream_shape_focal_and_inverse_depth_contract_changes_fail(self):
        backend = adapter.DepthPro2Backend(self.config)
        model, _, _, _ = self.runtime()
        cases = [
            {'depth': None},
            {'depth': np.ones((8, 8), np.float32)},
            {'depth': np.full((16, 24), np.inf, np.float32)},
            {'focallength_px': np.array([80, 90])},
            {'inverse_depth': np.ones((16, 24), np.float32)},
        ]
        for change in cases:
            model.infer.side_effect = lambda rgb, f_px=None, change=change: {**prediction(rgb), **change}
            with self.subTest(fields=list(change)), self.assertRaises(ValueError):
                backend.predict_image(self.rgb)
        model.infer.side_effect = lambda rgb, f_px=None: prediction(rgb, 80)
        with self.assertRaisesRegex(ValueError, 'differs from the supplied'):
            backend.predict_image(self.rgb, focal_px=90)

    def test_dropped_extra_or_inconsistent_video_tail_fails(self):
        backend = adapter.DepthPro2Backend(self.config)
        model, _, _, _ = self.runtime()
        for tail in ('missing', 'extra', 'focal-change'):
            model.tail = tail
            with self.subTest(tail=tail), self.assertRaises(ValueError):
                list(backend.predict_sequence([self.rgb] * 5))

    def test_provisioning_changes_and_package_shadowing_fail_before_inference(self):
        backend = adapter.DepthPro2Backend(self.config)
        model, factory, _, _ = self.runtime(origin=self.root / 'unverified' / '__init__.py')
        with self.assertRaisesRegex(ValueError, 'does not resolve'):
            backend.predict_image(self.rgb)
        factory.assert_not_called()
        model.infer.assert_not_called()
        self.permission.write_bytes(b'permission was changed after preflight')
        with self.assertRaisesRegex(ValueError, 'changed'):
            backend.predict_image(self.rgb)

    def test_changed_checkpoint_symlink_target_cannot_bypass_preflight(self):
        path = self.directory / 'model.safetensors'
        first = self.root / 'first.safetensors'
        path.rename(first)
        path.symlink_to(first)
        backend = adapter.DepthPro2Backend(self.config)
        second = self.root / 'second.safetensors'
        second.write_bytes(b'not the verified bytes')
        path.unlink()
        path.symlink_to(second)
        with patch.object(adapter.importlib, 'import_module', side_effect=AssertionError('must not import')):
            with self.assertRaisesRegex(ValueError, 'changed'):
                backend.predict_image(self.rgb)

    def test_bounds_and_explicit_device_have_no_silent_fallback(self):
        for values in ({'window': 17}, {'window': True}, {'overlap': 4}, {'max_depth_m': float('inf')}, {'device': 'auto'}, {'precision': 'bf16'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                adapter.DepthPro2Backend({**self.config, **values})
        backend = adapter.DepthPro2Backend({**self.config, 'device': 'cuda', 'precision': 'fp32'})
        _, factory, _, _ = self.runtime(cuda=False)
        with self.assertRaisesRegex(RuntimeError, 'no silent CPU fallback'):
            backend.predict_image(self.rgb)
        factory.assert_not_called()

    def test_operator_config_reader_is_bounded_and_never_downloads_paths(self):
        path = self.root / 'operator.json'
        path.write_text(json.dumps(self.config))
        self.assertEqual(adapter.load_operator_config(path), self.config)
        with self.assertRaises(ValueError):
            adapter.load_operator_config('https://example.invalid/config.json')
        path.write_text('x' * 65537)
        with self.assertRaisesRegex(ValueError, '64 KiB'):
            adapter.load_operator_config(path)
        path.write_text('{')
        with self.assertRaisesRegex(ValueError, 'valid UTF-8 JSON'):
            adapter.load_operator_config(path)

    def test_cli_stops_before_media_or_model_loading_when_not_entitled(self):
        path = self.root / 'operator.json'
        path.write_text(json.dumps({**self.config, 'enabled': False}))
        argv = ['depth_pro2_backend.py', '--operator-config', str(path), '--input-manifest', str(self.root / 'does-not-exist.json')]
        with patch.object(sys, 'argv', argv), patch.object(adapter.importlib, 'import_module', side_effect=AssertionError('must not import')):
            with self.assertRaisesRegex(ValueError, 'disabled'):
                adapter.main()

    def test_mocked_backend_matches_shared_artifact_and_point_preview_contract(self):
        from PIL import Image
        from robotics.world_worker.depth_sequence import run_with_backend
        source = self.root / 'authored-input.png'
        rows, columns = np.indices((256, 320))
        checker = (40 + 150 * ((rows // 16 + columns // 16) % 2)).astype(np.uint8)
        Image.fromarray(np.repeat(checker[..., None], 3, axis=2)).save(source)
        backend = adapter.DepthPro2Backend(self.config)
        self.runtime()
        output = self.root / 'output'
        evidence = run_with_backend({'schema': 'brainsnn.adapter.v1',
            'inputs': [{'kind': 'image', 'path': str(source), 'name': source.name}],
            'output_dir': str(output)}, backend, engine='depth-pro-2')
        self.assertEqual(evidence['schema'], 'brainsnn.depth-sequence.v1')
        self.assertEqual(evidence['model']['repo'], 'apple/DepthPro2-S')
        self.assertFalse(evidence['model']['hardware_qualified'])
        self.assertFalse(evidence['scale']['verified'])
        self.assertFalse(evidence['registration']['cameraPosesAvailable'])
        self.assertFalse(evidence['frames'][0]['provenance']['joint_video_model_applied'])
        self.assertEqual(evidence['temporal']['mode'], 'independent-frames')
        self.assertEqual(evidence['temporal']['configuredMode'], 'joint-video')
        self.assertFalse(evidence['temporal']['applied'])
        self.assertEqual(evidence['frames'][0]['reviewSampling']['stride'], 2)
        self.assertTrue((output / 'depth-first-frame.ply').is_file())
        saved = json.loads((output / 'depth-sequence.json').read_text())
        self.assertEqual(saved['frames'][0]['depth'][0], None, 'sky is serialized as an absent sample')
        self.assertAlmostEqual(saved['frames'][0]['camera']['fx'], 40, msg='intrinsics match the exact strided review raster')

    def test_mocked_buffered_driver_matches_shared_video_writer_and_retains_flush(self):
        from robotics.world_worker import depth_sequence
        source = self.root / 'authored-video.mp4'
        source.write_bytes(b'authored decoder fixture; not actual encoded media')
        times = [5.0, 5.2, None, 5.6, 5.8, 6.0, 6.2]
        frames = [{'index': index, 'rgb': np.full((48, 64, 3), index, np.uint8),
                   'timeSeconds': timestamp, 'timestampBasis': 'source-pts' if timestamp is not None else 'not-available',
                   'sourceWidth': 64, 'sourceHeight': 48, 'preparation': {'authoredDecoderFixture': True}}
                  for index, timestamp in enumerate(times)]
        backend = adapter.DepthPro2Backend(self.config)
        model, _, _, _ = self.runtime()
        output = self.root / 'output'
        with patch.object(depth_sequence, 'prepare_frames', return_value=(frames, {'method': 'authored-decoder-fixture'})):
            evidence = depth_sequence.run_with_backend({'schema': 'brainsnn.adapter.v1',
                'inputs': [{'kind': 'video', 'path': str(source), 'name': source.name}],
                'output_dir': str(output)}, backend, engine='depth-pro-2')
        self.assertEqual([f['index'] for f in evidence['frames']], list(range(7)))
        self.assertEqual([f['timeSeconds'] for f in evidence['frames']], times)
        self.assertEqual(model.streams[0].flush_calls, 1)
        self.assertEqual(evidence['temporal']['mode'], 'joint-video')
        self.assertTrue(evidence['temporal']['applied'])
        self.assertTrue(evidence['temporal']['overlapBlendingConfigured'])
        self.assertTrue(all(f['provenance']['overlap_blending_applied_to_sequence'] for f in evidence['frames']))
        self.assertTrue(all(f['provenance']['input_sequence_frame_count'] == 7 for f in evidence['frames']))
        np.testing.assert_allclose([f['depth'][1] for f in evidence['frames']], 1 + np.arange(7) / 10)
        self.assertFalse(evidence['provenance']['additionalDepthSmoothing'])


if __name__ == '__main__':
    unittest.main()
