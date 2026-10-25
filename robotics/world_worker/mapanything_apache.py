"""Optional, local-only MapAnything Apache checkpoint adapter.

Source/API and conversion are reviewed; GPU inference must be qualified on the
target host before enabling this adapter. A predicted metric scale is never
independently verified geometry. This process never downloads model/code files.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

try:
    from .geometry import write_point_cloud, MAX_PREVIEW_COORDINATE
    from .sparse_colmap import prepare_photo, extract_video
except ImportError:
    from geometry import write_point_cloud, MAX_PREVIEW_COORDINATE
    from sparse_colmap import prepare_photo, extract_video

SOURCE_REVISION = '3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9'
DINOV2_REVISION = '7764ea0f912e53c92e82eb78a2a1631e92725fc8'
MODEL_ID = 'facebook/map-anything-apache'
MODEL_REVISION = '00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a'
MODEL_SHA256 = 'fa06c0fdccefc5048e072c85935d5789b1e36b307f3859033c17f9dcb9fd5201'
MODEL_BYTES = 4_914_062_480
CONFIG_SHA256 = '65701d09d99ed37a21d295f0d138978b3d584ab3bccdbcb4a2853da212b676c5'
MAX_VIEWS = 12
MAX_POINTS = 100_000


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024 ** 2), b''):
            digest.update(part)
    return digest.hexdigest()


def verify_source(path: Path, revision: str):
    if not path.is_absolute() or not path.is_dir():
        raise RuntimeError('Set an absolute path to the pinned source checkout.')
    command = ['git', '-c', 'core.fsmonitor=false', '-C', str(path)]
    actual = subprocess.run([*command, 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    dirty = subprocess.run([*command, 'status', '--porcelain', '--untracked-files=all'], check=True,
                           capture_output=True, text=True, timeout=10).stdout.strip()
    if actual != revision or dirty:
        raise RuntimeError('Model source checkout must be clean and match its reviewed revision.')


def local_installation():
    values = [os.environ.get(key) for key in ['WORLD_MAPANYTHING_SOURCE_DIR', 'WORLD_DINOV2_SOURCE_DIR', 'WORLD_MAPANYTHING_MODEL_DIR']]
    if not all(values):
        raise RuntimeError('Install pinned MapAnything, DINOv2 source and Apache model locally; set WORLD_MAPANYTHING_SOURCE_DIR, WORLD_DINOV2_SOURCE_DIR and WORLD_MAPANYTHING_MODEL_DIR.')
    source, dino, snapshot = [Path(value).resolve() for value in values]
    verify_source(source, SOURCE_REVISION)
    verify_source(dino, DINOV2_REVISION)
    for name, size, digest in [('model.safetensors', MODEL_BYTES, MODEL_SHA256), ('config.json', 5776, CONFIG_SHA256)]:
        path = snapshot / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != size or file_hash(path) != digest:
            raise RuntimeError(f'Local {name} does not match the pinned Apache checkpoint. No inference was started.')
    return source, dino, snapshot


def deny_network(event, args):
    # HF offline mode does not cover torch.hub or other Python HTTP clients.
    if event in ['socket.connect', 'socket.getaddrinfo']:
        raise RuntimeError('Network access is disabled inside the reconstruction adapter.')


@contextmanager
def local_dino_architecture(torch, dino):
    original = torch.hub.load

    def load(repo, model, *args, **kwargs):
        if repo != 'facebookresearch/dinov2' or model != 'dinov2_vitg14' or args or kwargs.get('pretrained') is not False:
            raise RuntimeError('Only the reviewed local DINOv2 architecture without separate pretrained weights is allowed.')
        return original(str(dino), model, source='local', pretrained=False)

    torch.hub.load = load
    try:
        yield
    finally:
        torch.hub.load = original


def as_numpy(value):
    import numpy as np
    if hasattr(value, 'detach'):
        value = value.detach().float().cpu().numpy()
    return np.asarray(value)


def preview_from_predictions(predictions, *, max_points=MAX_POINTS):
    """Convert actual world points once; no depth invention or second pose transform.

    MapAnything pts3d already includes camera-to-world transforms. Rotate the
    shared OpenCV frame by diag(1,-1,-1) to a right-handed Y-up viewer frame.
    """
    import numpy as np
    if not isinstance(predictions, (list, tuple)) or not 1 <= len(predictions) <= MAX_VIEWS:
        raise ValueError('Expected 1–12 model prediction views.')
    if type(max_points) is not int or not len(predictions) <= max_points <= MAX_POINTS:
        raise ValueError('Invalid preview point budget.')
    all_points, all_colours, counts = [], [], []
    budget = max_points // len(predictions)
    for view in predictions:
        points, colours, mask = (as_numpy(view[key]) for key in ['pts3d', 'img_no_norm', 'mask'])
        if (points.ndim != 4 or points.shape[0] != 1 or points.shape[-1] != 3
                or not 1 <= points.shape[1] * points.shape[2] <= 1_000_000
                or colours.shape != points.shape or mask.shape != (*points.shape[:-1], 1)):
            raise ValueError('Model output shapes do not match the reviewed API.')
        if not np.isfinite(colours).all() or colours.min() < 0 or colours.max() > 1 or not np.isfinite(mask).all():
            raise ValueError('Invalid model colours or mask values.')
        flat_points, flat_colours = points.reshape(-1, 3), colours.reshape(-1, 3)
        valid = (mask.reshape(-1) > .5) & np.isfinite(flat_points).all(axis=1) & (np.abs(flat_points) <= MAX_PREVIEW_COORDINATE).all(axis=1)
        indices = np.flatnonzero(valid)
        stride = max(1, math.ceil(len(indices) / budget))
        selected = indices[::stride]
        all_points.append(flat_points[selected] * np.array([1., -1., -1.]))
        all_colours.append(np.rint(flat_colours[selected] * 255).astype(np.uint8))
        counts.append({'predicted_pixels': len(flat_points), 'valid_points': len(indices), 'preview_points': len(selected)})
    points, colours = np.concatenate(all_points), np.concatenate(all_colours)
    if len(points) < 30:
        raise ValueError('Too little valid model geometry to publish a preview.')
    return points, colours, counts


def camera_metadata(predictions):
    """Record only rigid camera-to-world poses and valid pinhole calibration.

    The reviewed MapAnything API documents OpenCV cam2world poses and pinhole
    intrinsics (source README at SOURCE_REVISION). Finite matrices alone can
    still contain scale, shear or a reflection, which would corrupt subsequent
    frame-to-component projections. Allow small floating-point rotation error;
    this validates the representation, not the predicted camera's accuracy.
    """
    import numpy as np
    transform = np.diag([1., -1., -1., 1.])
    result = []
    for index, view in enumerate(predictions):
        pose, intrinsics = (as_numpy(view[key]) for key in ['camera_poses', 'intrinsics'])
        if (pose.shape != (1, 4, 4) or intrinsics.shape != (1, 3, 3)
                or not np.isfinite(pose).all() or not np.isfinite(intrinsics).all()
                or not np.allclose(pose[0, 3], [0, 0, 0, 1], atol=1e-4, rtol=0)):
            raise ValueError('Invalid predicted camera geometry.')
        rotation = pose[0, :3, :3]
        if (not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-3, rtol=0)
                or not np.isclose(np.linalg.det(rotation), 1, atol=1e-3, rtol=0)):
            raise ValueError('Invalid predicted camera rotation: expected a right-handed rigid pose.')
        if (intrinsics[0, 0, 0] <= 0 or intrinsics[0, 1, 1] <= 0
                or not np.allclose(intrinsics[0, 2], [0, 0, 1], atol=1e-4, rtol=0)):
            raise ValueError('Invalid predicted camera intrinsics: expected positive focal lengths and a canonical last row.')
        result.append({'view': index, 'camera_to_world_y_up': (transform @ pose[0] @ transform).tolist(),
                       'intrinsics_opencv': intrinsics[0].tolist()})
    return result


def run(request):
    items = request.get('inputs', [])
    photos = 1 <= len(items) <= MAX_VIEWS and all(item.get('kind') == 'image' for item in items)
    video = len(items) == 1 and items[0].get('kind') == 'video'
    if request.get('schema') != 'brainsnn.adapter.v1' or not (photos or video):
        raise ValueError('Use 1–12 photos or one walkthrough video.')
    source, dino, snapshot = local_installation()
    os.environ.update({'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1'})
    sys.addaudithook(deny_network)
    sys.path.insert(0, str(source))
    if importlib.metadata.version('uniception') != '0.1.7':
        raise RuntimeError('Install the reviewed uniception==0.1.7 dependency.')
    import torch
    from mapanything.models import MapAnything
    from mapanything.utils.image import load_images
    if not torch.cuda.is_available():
        raise RuntimeError('This adapter requires a separately qualified CUDA worker. No CPU fallback is claimed.')
    out = Path(request['output_dir']).resolve();out.mkdir(parents=True, exist_ok=True)
    images = out.parent / 'mapanything-images';images.mkdir(exist_ok=False)
    sources = []
    for item in items:
        path = Path(item['path'])
        if not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise ValueError('Inputs must be regular local files.')
        sources.append({'name': item['name'], 'kind': item['kind'], 'sha256': file_hash(path)})
    capture = extract_video(Path(items[0]['path']), images, max_images=MAX_VIEWS) if video else {}
    if photos:
        for index, item in enumerate(items):
            prepare_photo(Path(item['path']), images / f'image_{index:04d}.jpg')
    paths = sorted(images.glob('*.jpg'))
    started = time.monotonic()
    torch.cuda.reset_peak_memory_stats()
    with local_dino_architecture(torch, dino):
        model = MapAnything.from_pretrained(str(snapshot), local_files_only=True, strict=True).to('cuda').eval()
    views = load_images([str(path) for path in paths], size=518, resize_mode='longest_side', verbose=False)
    if len(views) != len(paths):
        raise ValueError('Some source images could not be prepared for the model.')
    with torch.inference_mode():
        predictions = model.infer(views, memory_efficient_inference=True, minibatch_size=1,
                                  use_amp=True, amp_dtype='bf16', apply_mask=True, mask_edges=True,
                                  apply_confidence_mask=True, confidence_percentile=20,
                                  use_multiview_confidence=False)
    torch.cuda.synchronize()
    if len(predictions) != len(paths):
        raise ValueError('The model did not return every submitted view.')
    points, colours, counts = preview_from_predictions(predictions)
    visual = write_point_cloud(out / 'dense-preview.ply', points, colours, coordinate_frame='right-handed-y-up')
    evidence = {'schema': 'brainsnn.reconstruction.v1', 'pipeline': 'mapanything-apache',
                'model': MODEL_ID, 'model_revision': MODEL_REVISION, 'model_sha256': MODEL_SHA256,
                'config_sha256': CONFIG_SHA256, 'source_revision': SOURCE_REVISION, 'dinov2_source_revision': DINOV2_REVISION,
                'code_license': 'Apache-2.0', 'checkpoint_license': 'Apache-2.0', 'device': 'cuda',
                'torch_version': torch.__version__, 'peak_cuda_allocated_bytes': torch.cuda.max_memory_allocated(),
                'elapsed_seconds': round(time.monotonic() - started, 3), 'sources': sources,
                'capture': {**capture, 'images': len(paths)}, 'view_counts': counts,
                'preview_points': len(points), 'coordinate_frame': 'right-handed-y-up',
                'source_coordinate_frame': 'OpenCV; x right, y down, z forward',
                'scale_basis': 'model-predicted metric scale; no independent measurement',
                'metric_verified': False, 'physics_ready': False, 'policy_executed': False,
                'confidence_filter_percentile': 20, 'cameras': camera_metadata(predictions),
                'warnings': ['Model geometry and scale are estimates, including single-view hidden regions.',
                             'Dense points are not a watertight collision mesh or a proof of free space.',
                             'Review scale, floor alignment, missing surfaces and obstacles before planning.']}
    (out / 'reconstruction.json').write_text(json.dumps(evidence, indent=2, allow_nan=False))
    (out / 'manifest.json').write_text(json.dumps({'artifacts': [visual, {'name': 'reconstruction.json', 'kind': 'evidence'}]}, allow_nan=False))
    return evidence


def main():
    parser = argparse.ArgumentParser();parser.add_argument('--input-manifest', required=True)
    args = parser.parse_args();path = Path(args.input_manifest)
    if path.stat().st_size > 65536:
        raise ValueError('Input manifest exceeds its size limit.')
    run(json.loads(path.read_text()))


if __name__ == '__main__':
    main()
