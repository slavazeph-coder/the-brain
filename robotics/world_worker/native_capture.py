"""Bounded, source-bound native capture inputs for the CPU reconstruction adapter.

Calibration seeds the actual COLMAP solve. ARKit poses align its solved model
only after agreement checks; they are not survey truth or optimizer constraints.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
try:
    from .capture_evidence import validate_bundle
    from .simready_bridge import file_hash
except ImportError:
    from capture_evidence import validate_bundle
    from simready_bridge import file_hash

MAX_METADATA_BYTES = 1024 ** 2
MAX_CAPTURE_FRAMES = 11  # one sidecar + photos within the worker's 12-input limit


def read_metadata(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_METADATA_BYTES:
        raise ValueError('Native capture metadata must be a regular JSON file up to 1 MiB.')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate capture metadata field.')
            result[key] = value
        return result
    def bad(_):
        raise ValueError('Non-finite capture metadata.')
    try:
        bundle = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs, parse_constant=bad)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('Invalid native capture JSON.') from error
    if not isinstance(bundle, dict) or bundle.get('schema') != 'brainsnn.capture.v1':
        raise ValueError('Expected brainsnn.capture.v1 metadata.')
    frames = bundle.get('frames')
    if not isinstance(frames, list) or not 3 <= len(frames) <= MAX_CAPTURE_FRAMES:
        raise ValueError('Worker native captures require 3 to 11 frames.')
    for frame in frames:
        name = frame.get('image') if isinstance(frame, dict) else None
        if not isinstance(name, str) or not name or '/' in name or '\\' in name or ':' in name or len(name) > 160:
            raise ValueError('Worker capture images must be exact uploaded filenames, without paths.')
    return bundle


def inputs_evidence(inputs):
    """Return ordered image inputs and verified priors; never resolve JSON paths."""
    sidecars = [item for item in inputs if item.get('kind') == 'capture']
    images = [item for item in inputs if item.get('kind') == 'image']
    if len(sidecars) != 1 or len(images) + 1 != len(inputs):
        raise ValueError('Use one native capture JSON and its 3 to 11 original photos.')
    bundle = read_metadata(sidecars[0]['path'])
    by_name = {item['name']: item for item in images}
    if len(by_name) != len(images) or set(by_name) != {frame['image'] for frame in bundle['frames']}:
        raise ValueError('Capture frames must match the complete set of unique uploaded image names.')
    evidence = validate_bundle(bundle, Path('.'), image_paths={name: Path(item['path']) for name, item in by_name.items()})
    if any(frame['tracking_state'] != 'normal' for frame in evidence['frames']):
        raise ValueError('The bounded native reconstruction profile requires normally tracked frames only.')
    evidence['bundle_sha256'] = file_hash(Path(sidecars[0]['path']))
    return [by_name[frame['image']] for frame in evidence['frames']], evidence


def apply_calibration(database, associations, evidence):
    """Replace each extracted camera with its actual resized PINHOLE calibration."""
    import pycolmap
    priors = {entry['image']: frame for entry, frame in zip(associations, evidence['frames'])}
    prepared = {entry['image']: entry['preparation'] for entry in associations}
    opened = pycolmap.Database.open(str(database))
    try:
        images = opened.read_all_images()
        if len(images) != len(priors) or len({image.camera_id for image in images}) != len(images):
            raise ValueError('Native calibration requires one independently calibrated camera per prepared image.')
        for image in images:
            frame, prep = priors[image.name], prepared[image.name]
            K = np.asarray(prep['sourceToPreparedPixelCenter']) @ np.asarray(frame['intrinsics_integer_centres'])
            # Convert the resized integer-centre principal point to COLMAP's (.5,.5) pixel centre.
            params = [K[0, 0], K[1, 1], K[0, 2] + .5, K[1, 2] + .5]
            camera = pycolmap.Camera(camera_id=image.camera_id, model='PINHOLE', width=prep['width'], height=prep['height'],
                                     params=params, has_prior_focal_length=True)
            opened.update_camera(camera)
    finally:
        opened.close()


def align_model(model, associations, evidence):
    """Align solved cameras/points to estimated ARKit scale after residual checks.

    Rotation uses all camera attitudes, so a straight walk is not intrinsically
    degenerate. Translation-only/no-baseline captures cannot establish scale.
    The thresholds are acceptance guards, not a measured accuracy guarantee.
    """
    import pycolmap
    priors = {entry['image']: frame for entry, frame in zip(associations, evidence['frames'])}
    basis = np.diag([1., -1., -1.])  # ARKit world -> COLMAP-style world axes
    old, targets, rotations, pairs = [], [], [], []
    for image_id in sorted(model.reg_image_ids()):
        image = model.image(image_id)
        frame = priors[image.name]
        pose = np.asarray(frame['world_to_colmap_camera'])
        center = -pose[:, :3].T @ pose[:, 3]
        desired = pose[:, :3] @ basis
        old_rotation = image.cam_from_world().rotation.matrix()
        rotations.append(desired.T @ old_rotation)
        old.append(image.projection_center())
        targets.append(basis @ center)
        pairs.append((image, desired))
    if len(old) < 3:
        raise ValueError('At least three solved native cameras are required for pose alignment.')
    old, targets = np.asarray(old), np.asarray(targets)
    u, _, vt = np.linalg.svd(np.sum(rotations, axis=0))
    rotation = u @ np.diag([1., 1., np.linalg.det(u @ vt)]) @ vt
    rotated = old @ rotation.T
    a, b = rotated - rotated.mean(0), targets - targets.mean(0)
    denominator, target_variance = float(np.sum(a*a)), float(np.sum(b*b))
    if denominator < 1e-10 or target_variance < 1e-6:
        raise ValueError('Native camera poses have insufficient translation to establish scale.')
    scale = float(np.sum(a*b) / denominator)
    if not np.isfinite(scale) or scale <= 0:
        raise ValueError('Native camera positions disagree with the reconstructed trajectory.')
    translation = targets.mean(0) - scale*rotated.mean(0)
    residuals = np.linalg.norm(scale*rotated + translation - targets, axis=1)
    span = float(np.sqrt(target_variance / len(targets)))
    angles = []
    for image, desired in pairs:
        relative = desired.T @ (image.cam_from_world().rotation.matrix() @ rotation.T)
        angles.append(float(np.degrees(np.arccos(np.clip((np.trace(relative)-1)/2, -1, 1)))))
    rms = float(np.sqrt(np.mean(residuals**2)))
    if max(angles) > 15 or rms > max(.03, .1*span) or max(residuals) > max(.06, .2*span):
        raise ValueError('Native pose priors disagree with the image reconstruction; review calibration and recapture.')
    model.transform(pycolmap.Sim3d(scale, pycolmap.Rotation3d(rotation), translation))
    return {'method': 'solved image geometry aligned to estimated native camera poses; poses are not optimizer constraints',
            'applied': True, 'scale_from_sfm': scale, 'rotation': rotation.tolist(), 'translation': translation.tolist(),
            'arkit_world_to_output_basis': basis.tolist(), 'registered_prior_frames': len(old),
            'position_rms_native_m': rms, 'position_max_native_m': float(max(residuals)),
            'rotation_max_degrees': float(max(angles)), 'metric_verified': False,
            'units_policy': 'Estimated native metre scale; downstream units stay arbitrary until independent dimensional review.'}
