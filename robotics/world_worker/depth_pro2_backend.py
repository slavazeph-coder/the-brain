"""Optional, separately licensed Depth Pro 2-S connector; disabled without provisioning.

No Apple weights are bundled, fetched or qualified by this module. The default Apple
model licence excludes product development and commercial services. The operator
must separately obtain appropriate written permission and provision its receipt,
the exact source package and local model files before this connector can load.

Only the small safetensors release is supported. Official API composition is used;
no upstream implementation is copied here. All optional imports occur after the
permission and local integrity gates. The normal depth worker uses its MoGe baseline.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import importlib
import importlib.util
import json
import math
import numbers
import os
from pathlib import Path
import re
import sys

SCHEMA = 'brainsnn.depth-pro2-provisioning.v1'
SOURCE_REPOSITORY = 'https://github.com/apple-aiml-research/ml-depth-pro-2'
SOURCE_COMMIT = 'aa389cbb0b74341664ed663a0966c859905cd6c0'
# SHA-256 of the official source bytes at SOURCE_COMMIT, inspected without running them.
SOURCE_FILES = {
    '__init__.py': 'ba4a7dd8d6fcfe3d32260f1d55d411fccce98ed5b2c713f924d75c83e56e981b',
    'model.py': '0c97c9731679814a5c7150bf358ec41e33358339800152a9f6bff0a2786098cd',
    'streaming.py': 'f6feb102911221161fbf15576c983b7bc07449e9a3a620e3f7f4c32d602415c2',
    'utils.py': 'eb459fd736e9e8a9287985b3d33ccca9e18d126ab2b5eb27c41d37a6dd1be19b',
    'network/__init__.py': '8ca8ed7f11eb9ee6d627843d7e4610d0d679c7ecccc6a0e426645e6040982eba',
    'network/encoder.py': 'c4b467b484d12c988422d2e5d8e25bf445c8c332657735030fed16736c93a2b6',
    'network/decoder.py': '0fa27e03db7cdb8721a0131e0cebe1d6c6971af83b1f90c575a6fecd9bfc0dda',
    'network/fov.py': 'fab6732b293403f7eadff32710bf14311dd957513042eaaac73b915d49d19dfb',
}
# Official Hugging Face metadata, not hashes inferred from checkpoint filenames.
MODEL = {
    'repo': 'apple/DepthPro2-S', 'revision': '903a1c1ade918831d138adcc4aedbcc8f4da0078',
    'file': 'model.safetensors', 'bytes': 97_264_508,
    'sha256': '583c4d630779fd231f969c738733624963ad34bd3c29f9c64088257e3436f97c',
    'config_sha256': '42e0a8202b5260a1acbf4e8924745edf96feb0ebff75455c1e291e10505e8c04',
}
FOCAL_MODEL = {
    'repo': 'apple/DepthPro2-focal', 'revision': '622659d44a2002cf9ae4333f2569afa938290d9a',
    'file': 'model.safetensors', 'bytes': 93_840_880,
    'sha256': '8f567d1c97ff916137288668f6bd306ce2094da2e2b852b0e4539dbb139c8c86',
}
MAX_FRAMES = 32
MAX_EDGE = 1280
MAX_WINDOW = 16


def _object(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f'{label} has unsupported fields or is not an object.')
    return value


def _integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{label} must be an integer from {low} to {high}.')
    return value


def _finite(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, numbers.Real) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} must be finite and from {low} to {high}.')
    return float(value)


def _absolute(value, label, *, directory=False):
    if not isinstance(value, str) or len(value) > 4096 or not Path(value).is_absolute():
        raise ValueError(f'{label} must be an existing absolute local path.')
    path = Path(value).resolve(strict=True)
    if not (path.is_dir() if directory else path.is_file()):
        raise ValueError(f'{label} must be a regular local {"directory" if directory else "file"}.')
    return path


def _digest(value, label):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
        raise ValueError(f'{label} requires an explicit lowercase SHA-256 digest.')
    return value


def _identity(path):
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def _verified_file(path, digest, *, max_bytes, exact_bytes=None):
    if not path.is_file():
        raise ValueError(f'Required local file is missing: {path.name}.')
    before = _identity(path)
    if before[2] < 1 or before[2] > max_bytes or exact_bytes is not None and before[2] != exact_bytes:
        raise ValueError(f'Local file has an unexpected size: {path.name}.')
    actual = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            actual.update(part)
    if _identity(path) != before or actual.hexdigest() != digest:
        raise ValueError(f'Local file does not match its pinned SHA-256: {path.name}.')
    return before


def load_operator_config(path):
    """Read trusted operator configuration, never a browser-supplied permission flag.

    The adapter CLI or deployment environment supplies this path. This function does
    not decide whether a permission document legally grants the declared scope.
    """
    config_path = _absolute(str(path), 'Operator provisioning JSON')
    if config_path.stat().st_size > 65536:
        raise ValueError('Operator provisioning JSON exceeds 64 KiB.')
    try:
        config = json.loads(config_path.read_text(encoding='utf-8'))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('Operator provisioning must be valid UTF-8 JSON.') from error
    if not isinstance(config, dict):
        raise ValueError('Operator provisioning must be an object.')
    return config


class DepthPro2Backend:
    """Bounded adapter with lazy, strictly local model loading and explicit provenance."""

    def __init__(self, config):
        config = _object(config, ('schema', 'enabled', 'authorization', 'source', 'model', 'focal',
                                  'device', 'precision', 'window', 'overlap', 'max_depth_m'), 'Operator provisioning')
        if config.get('schema') != SCHEMA or config.get('enabled') is not True:
            raise ValueError('Depth Pro 2 is disabled without explicit operator provisioning.')
        authorization = _object(config.get('authorization'), ('kind', 'scope', 'document_path', 'document_sha256'), 'Authorization')
        if authorization.get('kind') != 'separate-written-permission' or authorization.get('scope') != 'product-development-and-commercial-service':
            raise ValueError('Separate written permission covering product development and commercial service is required; the public research licence does not grant this.')
        receipt = _absolute(authorization.get('document_path'), 'Written-permission document')
        receipt_hash = _digest(authorization.get('document_sha256'), 'Permission document')
        self._verified = {receipt: _verified_file(receipt, receipt_hash, max_bytes=1024 * 1024)}

        source = _object(config.get('source'), ('commit', 'package_dir'), 'Source package')
        if source.get('commit') != SOURCE_COMMIT:
            raise ValueError('Provision the exact supported Depth Pro 2 source commit.')
        self._package = _absolute(source.get('package_dir'), 'Source package directory', directory=True)
        for name, digest in SOURCE_FILES.items():
            path = self._package / name
            if not path.resolve(strict=True).is_relative_to(self._package):
                raise ValueError('A source module escapes the declared package directory.')
            self._verified[path] = _verified_file(path, digest, max_bytes=128 * 1024)

        model = _object(config.get('model'), ('directory', 'sha256', 'config_sha256'), 'Model checkpoint')
        if model.get('sha256') != MODEL['sha256'] or model.get('config_sha256') != MODEL['config_sha256']:
            raise ValueError('Use the published DepthPro2-S safetensors and configuration digests.')
        self._model_directory = _absolute(model.get('directory'), 'Local model directory', directory=True)
        for name, digest, size in [('model.safetensors', MODEL['sha256'], MODEL['bytes']), ('config.json', MODEL['config_sha256'], None)]:
            path = self._model_directory / name
            self._verified[path] = _verified_file(path, digest, max_bytes=MODEL['bytes'] if size else 32768, exact_bytes=size)
        self._focal_path = None
        if config.get('focal') is not None:
            focal = _object(config['focal'], ('path', 'sha256'), 'Focal checkpoint')
            if focal.get('sha256') != FOCAL_MODEL['sha256']:
                raise ValueError('Use the published DepthPro2-focal safetensors digest.')
            self._focal_path = _absolute(focal.get('path'), 'Local focal checkpoint')
            self._verified[self._focal_path] = _verified_file(self._focal_path, FOCAL_MODEL['sha256'], max_bytes=FOCAL_MODEL['bytes'], exact_bytes=FOCAL_MODEL['bytes'])

        self._device = config.get('device', 'cuda')
        if self._device not in ('cpu', 'cuda', 'mps'):
            raise ValueError('Select an explicit cpu, cuda or mps device.')
        self._precision = config.get('precision', 'fp32' if self._device == 'cpu' else 'bf16')
        if self._precision not in ('fp32', 'fp16', 'bf16') or self._device == 'cpu' and self._precision != 'fp32':
            raise ValueError('Select fp32, fp16 or bf16; this adapter uses fp32 on CPU.')
        self._window = _integer(config.get('window', 16), 1, MAX_WINDOW, 'Temporal window')
        self._overlap = _integer(config.get('overlap', min(4, self._window - 1)), 0, self._window - 1, 'Temporal overlap')
        self._max_depth = _finite(config.get('max_depth_m', 100), .01, 1000, 'Maximum displayed depth in metres')
        self._model = self._transform = self._torch = None
        self._metadata = {
            **MODEL, 'name': 'Depth Pro 2-S', 'runtime': 'pytorch', 'maxInputEdge': MAX_EDGE,
            'code': {'repository': SOURCE_REPOSITORY, 'commit': SOURCE_COMMIT, 'source_files_verified': True},
            'focal_model': dict(FOCAL_MODEL) if self._focal_path else None,
            'license': 'Apple Machine Learning Research Model; default terms exclude product development and commercial services',
            'authorization': {'kind': 'operator-declared-separate-written-permission', 'document_sha256': receipt_hash,
                              'scope': authorization['scope'], 'document_legally_verified_by_software': False},
            'device_requested': self._device, 'precision_requested': self._precision,
            'runtime_downloads': False, 'hardware_qualified': False,
        }

    @property
    def model_metadata(self):
        return deepcopy(self._metadata)

    @property
    def temporal_metadata(self):
        joint = self._window > 1
        return {'method': 'official-buffered-cross-frame-attention' if joint else 'official-independent-frame-inference',
                'joint_video_model': joint, 'mode': 'joint-video' if joint else 'independent-frames',
                'stream_mode': 'buffered', 'window_frames': self._window, 'overlap_frames': self._overlap,
                'overlapBlendingConfigured': self._overlap > 0,
                'description': ('Buffered joint video attention; overlap blending is configured for overlapping windows. '
                                'No measured temporal-accuracy qualification.') if joint else
                               'A one-frame window has no cross-frame attention or overlap blending.',
                'looks_ahead': joint, 'flush_tail_retained': True, 'output_order': 'input order',
                'timestamp_policy': 'source timestamps retained when supplied; no timestamps inferred',
                'measured_temporal_accuracy': False}

    def _assert_unchanged(self):
        for path, identity in self._verified.items():
            if not path.is_file() or _identity(path) != identity:
                raise ValueError('Provisioned source, permission or checkpoint changed; create a newly verified backend.')

    def _load(self):
        self._assert_unchanged()
        if self._model is not None:
            return
        # Never prepend an operator directory to sys.path. The installed package must
        # already resolve to the exact verified source tree, not a shadowed module.
        spec = importlib.util.find_spec('depth_pro_2')
        if spec is None or spec.origin is None or Path(spec.origin).resolve() != self._package / '__init__.py':
            raise ValueError('The installed depth_pro_2 package does not resolve to the verified source directory.')
        for name, module in tuple(sys.modules.items()):
            if name == 'depth_pro_2' or name.startswith('depth_pro_2.'):
                origin = getattr(module, '__file__', None)
                if origin is None or not Path(origin).resolve().is_relative_to(self._package):
                    raise ValueError('A different Depth Pro 2 package is already loaded.')
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['TRANSFORMERS_OFFLINE'] = '1'
        torch = importlib.import_module('torch')
        if self._device == 'cuda' and not torch.cuda.is_available() or self._device == 'mps' and not torch.backends.mps.is_available():
            raise RuntimeError('The explicitly configured inference device is unavailable; no silent CPU fallback was used.')
        if self._device == 'cuda' and self._precision == 'bf16' and not torch.cuda.is_bf16_supported():
            raise RuntimeError('This CUDA device does not support the configured bfloat16 precision.')
        dtype = {'fp32': torch.float32, 'fp16': torch.float16, 'bf16': torch.bfloat16}[self._precision]
        upstream = importlib.import_module('depth_pro_2')
        normalization = importlib.import_module('depth_pro_2.model').to_normalized_tensor
        # A real, verified local directory plus local_files_only prevents Hub fallback.
        # The immutable official config has fov:false, so no hidden focal download occurs.
        model = upstream.DepthPro2.from_pretrained(str(self._model_directory), precision=dtype, strict=True, local_files_only=True)
        if self._focal_path is not None:
            estimator = importlib.import_module('depth_pro_2.network.fov').FOVEstimator(dtype)
            load_file = importlib.import_module('safetensors.torch').load_file
            estimator.load_state_dict(load_file(str(self._focal_path), device='cpu'), strict=True)
            model.fov = estimator
        elif getattr(model, 'fov', None) is not None:
            raise RuntimeError('The verified image model unexpectedly contains a focal estimator.')
        self._model = model.to(self._device).eval()
        device = torch.device(self._device)
        self._transform = lambda rgb: normalization(rgb, device=device)
        self._torch = torch

    def _image(self, rgb):
        import numpy as np
        if not isinstance(rgb, np.ndarray) or rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3:
            raise ValueError('Depth input must be an RGB uint8 H×W×3 array.')
        if min(rgb.shape[:2]) < 16 or max(rgb.shape[:2]) > MAX_EDGE:
            raise ValueError(f'Depth input dimensions must be 16–{MAX_EDGE} pixels per side; resize with matching intrinsics before calling.')
        return rgb

    def _focal(self, value):
        if value is None:
            if self._focal_path is None:
                raise ValueError('Supply focal_px at the input raster size or separately provision the focal estimator.')
            return None
        return _finite(value, .01, 1e7, 'Supplied focal length in input pixels')

    def _prediction(self, result, rgb, supplied_focal, *, sequence):
        import numpy as np
        if not isinstance(result, dict) or any(result.get(k) is None for k in ('depth', 'inverse_depth', 'focallength_px')):
            raise ValueError('The official API did not produce metric depth and a focal length.')

        def array(value):
            if hasattr(value, 'detach'):
                value = value.detach().cpu().numpy()
            return np.asarray(value)

        depth = array(result['depth'])
        inverse = array(result['inverse_depth'])
        focal = array(result['focallength_px'])
        if focal.size != 1:
            raise ValueError('The depth API must return one focal length per image or video.')
        focal = _finite(float(focal.reshape(-1)[0]), .01, 1e7, 'Returned focal length')
        if supplied_focal is not None and not math.isclose(focal, supplied_focal, rel_tol=1e-5, abs_tol=1e-5):
            raise ValueError('Returned focal length differs from the supplied input calibration.')
        if depth.shape != rgb.shape[:2] or inverse.shape != depth.shape or not np.issubdtype(depth.dtype, np.floating) or not np.issubdtype(inverse.dtype, np.floating):
            raise ValueError('Depth and inverse-depth outputs must match the exact input raster and floating-point contract.')
        mask = np.isfinite(depth) & np.isfinite(inverse) & (depth > 0) & (depth <= self._max_depth) & (inverse > 0)
        if not mask.any():
            raise ValueError('No finite positive camera depth lies within the configured range.')
        height, width = depth.shape
        if not np.allclose(depth[mask] * inverse[mask] * width, focal, rtol=1e-3, atol=1e-4):
            raise ValueError('Depth and focal-normalized inverse depth disagree; the upstream output contract changed.')
        depth = depth.astype(np.float32, copy=True)
        depth[~mask] = np.nan
        return {'depth': depth, 'mask': mask,
                'camera': {'fx': focal, 'fy': focal, 'cx': (width - 1) / 2, 'cy': (height - 1) / 2, 'width': width, 'height': height},
                'provenance': {'backend': 'depth-pro-2-s', 'metric_verified': False, 'collision_ready': False,
                               'inferenceExecuted': True, 'focalBasis': 'supplied' if supplied_focal is not None else 'model-estimated',
                               'depth_kind': 'learned-camera-z-metres', 'frame': 'camera-x-right-y-down-z-forward',
                               'focal_source': 'supplied-at-input-resolution' if supplied_focal is not None else 'estimated-from-first-video-window' if sequence else 'estimated-from-image',
                               'focal_length_px': focal, 'principal_point_source': 'image-centre-assumption',
                               'pixel_centres': 'integer pixel indices', 'input_raster': [width, height],
                               'resized_by_backend': False, 'lens_distortion_corrected_by_backend': False,
                               'depth_max_metres': self._max_depth, 'invalid_or_out_of_range_depth_masked': True,
                               'joint_video_model_applied': sequence, 'video_stream_applied': sequence,
                               'overlap_blending_applied_to_sequence': False,
                               'camera_poses_produced': False}}

    def predict_image(self, rgb, *, focal_px=None):
        """One independent image. Supplied focal_px must describe this exact input raster."""
        self._assert_unchanged()
        rgb = self._image(rgb)
        focal = self._focal(focal_px)
        self._load()
        with self._torch.inference_mode():
            result = self._model.infer(self._transform(rgb), f_px=focal)
        return self._prediction(result, rgb, focal, sequence=False)

    def predict_sequence(self, frames, *, timestamps_seconds=None, focal_px=None):
        """One ordered video, with a new stream each call and the final buffered tail.

        These are sequential frames from one camera with a fixed focal length; do not
        combine unrelated photos or scenes. The adapter does not invent source times.
        """
        self._assert_unchanged()
        if not isinstance(frames, (list, tuple)) or not 1 <= len(frames) <= MAX_FRAMES:
            raise ValueError(f'Provide 1–{MAX_FRAMES} sequential video frames.')
        frames = [self._image(frame) for frame in frames]
        if any(frame.shape != frames[0].shape for frame in frames):
            raise ValueError('One video stream must keep a constant raster size; split changes into separate streams.')
        if timestamps_seconds is None:
            timestamps = [None] * len(frames)
        elif not isinstance(timestamps_seconds, (list, tuple)) or len(timestamps_seconds) != len(frames):
            raise ValueError('Provide one source timestamp or None per frame.')
        else:
            timestamps = list(timestamps_seconds)
        previous = None
        for timestamp in timestamps:
            if timestamp is not None:
                stamp = _finite(timestamp, -1e12, 1e12, 'Source timestamp')
                if previous is not None and stamp <= previous:
                    raise ValueError('Available source timestamps must be strictly increasing in input order.')
                previous = stamp
        focal = self._focal(focal_px)
        self._load()
        stream = self._model.stream(window=self._window, overlap=self._overlap, f_px=focal, mode='buffered')
        index, first_focal = 0, None

        def finished(predictions):
            nonlocal index, first_focal
            if not isinstance(predictions, list):
                raise ValueError('The official stream must return a list of completed predictions.')
            for prediction in predictions:
                if index >= len(frames):
                    raise ValueError('The stream returned more predictions than source frames.')
                normalized = self._prediction(prediction, frames[index], focal, sequence=True)
                current_focal = normalized['camera']['fx']
                if first_focal is None:
                    first_focal = current_focal
                elif not math.isclose(first_focal, current_focal, rel_tol=1e-5, abs_tol=1e-5):
                    raise ValueError('Buffered video predictions changed focal length within one stream.')
                # Exactly one complete window flushes its held tail without another
                # prediction, so configured overlap alone is not an executed blend.
                normalized['provenance'].update(
                    joint_video_model_applied=self._window > 1 and len(frames) > 1,
                    video_stream_applied=True, input_sequence_frame_count=len(frames),
                    window_frames_configured=self._window, overlap_frames_configured=self._overlap,
                    overlap_blending_applied_to_sequence=self._overlap > 0 and len(frames) > self._window)
                normalized.update(index=index, timestamp_seconds=timestamps[index])
                index += 1
                yield normalized

        with self._torch.inference_mode():
            for frame in frames:
                yield from finished(stream.step(self._transform(frame)))
            yield from finished(stream.flush())
        if index != len(frames):
            raise ValueError('The stream ended without one prediction per source frame, including its buffered tail.')


def main():
    """Dedicated optional adapter entry point; all rights/configuration come from argv."""
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest', required=True)
    parser.add_argument('--operator-config', required=True, help='Trusted local permission and provisioning JSON; never taken from request.options.')
    parser.add_argument('--max-frames', type=int, default=16)
    parser.add_argument('--max-depth-metres', type=float, default=100)
    args = parser.parse_args()
    # Even media decoding is deferred until the permission/provisioning gates pass.
    backend = DepthPro2Backend(load_operator_config(args.operator_config))
    path = _absolute(args.input_manifest, 'Adapter input manifest')
    if path.stat().st_size > 65536:
        raise ValueError('Adapter input manifest exceeds 64 KiB.')
    request = json.loads(path.read_text(encoding='utf-8'))
    try:
        from .depth_sequence import run_with_backend
    except ImportError:
        from depth_sequence import run_with_backend
    run_with_backend(request, backend, engine='depth-pro-2', max_frames=args.max_frames, max_depth_metres=args.max_depth_metres)


if __name__ == '__main__':
    main()
