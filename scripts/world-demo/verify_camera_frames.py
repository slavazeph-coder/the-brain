"""Read-only camera-ledger and optional handoff checks, with native COLMAP parity when available.

Reads private rasters/models locally. Publishes no images, runs no inference and proves no physical accuracy.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from robotics.world_worker import camera_frames as cf, object_names as names
from robotics.world_worker.geometry import load_arena_cloud


def native_parity(job, views, reconstruction):
    """Check actual registered tracks, never renderer truth poses or synthetic camera transport."""
    if not str(reconstruction.get('pipeline', '')).startswith('colmap'):
        return {'status': 'unavailable', 'reason': 'This is not a COLMAP reconstruction; no native-model comparison ran.'}
    sparse = job / 'colmap-work' / 'sparse'
    if not sparse.is_dir():
        return {'status': 'unavailable', 'reason': 'No retained COLMAP workspace; no native-model comparison ran.'}
    try:
        import pycolmap
    except ImportError:
        return {'status': 'unavailable', 'reason': 'PyCOLMAP is not installed; no native-model comparison ran.'}
    import numpy as np
    model = pycolmap.Reconstruction(str(names.selected_model(sparse)))
    images = {image.name: image for image in model.images.values()}
    errors, residuals, cameras = [], [], []
    for view in views:
        if view['name'] not in images:
            raise ValueError('Ledger camera is absent from the selected native model.')
        image = images[view['name']]; camera = model.camera(image.camera_id)
        tracks = [point for point in image.points2D if point.has_point3D()]
        selected = tracks[:100]  # Bounded, deterministic feature order; no residual-based selection.
        if not selected:
            raise ValueError('Registered native camera has no 3D tracks to compare.')
        xyz = np.asarray([model.point3D(point.point3D_id).xyz for point in selected])
        matrix = image.cam_from_world().matrix()
        coordinates = xyz @ matrix[:, :3].T + matrix[:, 3]
        native = camera.img_from_cam(coordinates) - .5
        actual, depth = names.project(view, xyz)
        if not (np.isfinite(native).all() and np.isfinite(actual).all() and (depth > 0).all()):
            raise ValueError('Registered track projection is nonfinite or behind its camera.')
        difference = np.linalg.norm(native - actual, axis=1)
        residual = np.linalg.norm(native - (np.asarray([point.xy for point in selected]) - .5), axis=1)
        maximum = float(difference.max())
        if maximum > 1e-6:
            raise ValueError(f'Unified/native projection differs by {maximum:.9g} pixels.')
        errors.extend(difference.tolist()); residuals.extend(residual.tolist())
        cameras.append({'frameId': view['frame_id'], 'registeredTracks': len(tracks),
                        'sampledTracks': len(selected), 'maxParityErrorPixels': maximum})
    if not errors:
        raise ValueError('No native track observations were compared.')
    return {'status': 'checked', 'pycolmapVersion': pycolmap.__version__,
            'basis': 'Unified pose/lens projection versus actual selected-model img_from_cam minus 0.5, integer-centre pixels.',
            'registeredImages': model.num_reg_images(), 'reconstructedPoints': model.num_points3D(),
            'observationsCompared': len(errors), 'maxParityErrorPixels': max(errors), 'tolerancePixels': 1e-6,
            'perCamera': cameras,
            'reprojection': {'basis': 'Native model versus its fitted feature observations; separate from projection parity.',
                             'modelMeanErrorPixels': model.compute_mean_reprojection_error(),
                             'sampleMedianErrorPixels': float(np.median(residuals)),
                             'sampleMaxErrorPixels': max(residuals)}}


def verify(job, cloud_path=None, ledger_path=None):
    job = job.absolute()
    record = cf.load_record(job, ledger_path=ledger_path)
    views = (names.reconstruction_views(job, load_arena_cloud(cloud_path), ledger_path=ledger_path)
             if cloud_path is not None else cf.load_views(job, ledger_path=ledger_path))
    if cloud_path is not None and any(view.get('binding_status') != 'ordered-source-subset' for view in views):
        raise ValueError('The handoff did not receive an ordered source-cloud binding.')
    receipt_path = job / record['reconstruction']['name']
    reconstruction = json.loads(receipt_path.read_text())  # Bytes/size already admitted by load_record.
    parity = native_parity(job, views, reconstruction)
    return {'schema': 'brainsnn.camera-frame-verification.v1', 'ledgerFilesValidated': True,
            'handoffBinding': 'ordered-source-subset' if cloud_path is not None else 'not-requested',
            'registeredLedgerFrames': len(record['frames']), 'originalSources': len(record['sources']),
            'timestampedFrames': sum(frame['timestamp'] is not None for frame in record['frames']),
            'sourceClouds': [{'name': cloud['name'], 'sha256': cloud['sha256']} for cloud in record['clouds']],
            'nativeProjectionParity': parity, 'imagesPublished': False, 'inferenceExecuted': False,
            'metricVerified': False, 'scope': 'Local raster/point/camera consistency, not physical accuracy, semantic recognition or original-source attestation.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True, type=Path, help='Retained reconstruction job root')
    parser.add_argument('--cloud', type=Path, help='Optional Arena handoff bound to the reconstruction')
    parser.add_argument('--ledger', type=Path, help='Optional ledger path within the job root')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.job, args.cloud, args.ledger), indent=2, allow_nan=False))
    except (ValueError, OSError, KeyError, TypeError, ImportError, RuntimeError, names.NamingSkipped) as error:
        parser.exit(2, f'REFUSED: {error}\n')
