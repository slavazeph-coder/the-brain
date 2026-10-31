"""Visual positioning: find where a new photo was taken inside a finished reconstruction.

The photo is prepared exactly like the reconstruction's own frames (EXIF orientation, metadata stripped, 1280-px edge),
its SIFT features are matched to every registered frame (mutual nearest neighbours that pass the ratio test), the
matches that land on the model's 3D points become 2D-3D correspondences, and LO-RANSAC PnP with non-linear refinement
solves its camera. The pose is in the reconstruction's own frame and units, so it is metric only after the user's
measured distance. A photo the model cannot explain is reported as not located; no pose is guessed.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

try:
    from . import sparse_colmap
except ImportError:
    import sparse_colmap

RATIO = 0.8  # Lowe's ratio on descriptor distances
MAX_ERROR_PIXELS = 8.0  # RANSAC inlier threshold at the prepared 1280-px size
# A pose is reported only with enough agreeing points; fewer usually means the photo shows a part of the place the
# walkthrough never filmed, or a different place.
MIN_INLIERS = 30
MIN_INLIER_RATIO = 0.2
RECONSTRUCTION_ENGINES = {'colmap-sparse', 'colmap-dense-cpu'}


def selected_model(workspace: Path):
    import pycolmap
    sparse = workspace / 'sparse'
    return pycolmap.Reconstruction(str(sparse / (sparse / sparse_colmap.SELECTED_MODEL).read_text().strip()))


def unit_rows(descriptors):
    import numpy as np
    rows = np.asarray(getattr(descriptors, 'data', descriptors), dtype=np.float32)  # the database returns FeatureDescriptors
    return rows / np.maximum(np.linalg.norm(rows, axis=1, keepdims=True), 1e-9)


def match(query, frame):
    """(query index, frame index) pairs: mutual nearest neighbours whose distance ratio passes RATIO."""
    import numpy as np
    if len(query) < 2 or len(frame) < 2:
        return np.zeros((0, 2), dtype=int)
    similarity = query @ frame.T  # unit SIFT descriptors: distance is sqrt(2 - 2 * similarity)
    top = np.argpartition(-similarity, 1, axis=1)[:, :2]
    rows = np.arange(len(query))
    a, b = similarity[rows, top[:, 0]], similarity[rows, top[:, 1]]
    best = np.where(a >= b, top[:, 0], top[:, 1])
    distance = lambda s: np.sqrt(np.maximum(2 - 2 * s, 0))
    keep = distance(np.maximum(a, b)) < RATIO * distance(np.minimum(a, b))
    keep &= np.argmax(similarity, axis=0)[best] == rows
    return np.stack([rows[keep], best[keep]], axis=1)


def query_camera(model, frame_camera_id: int, width: int, height: int):
    """The reconstruction's camera rescaled to the photo: same phone assumed, focal length refined in the solve."""
    import pycolmap
    camera = model.camera(frame_camera_id)
    scale = max(width, height) / max(camera.width, camera.height)
    params = camera.params.copy()
    for index in camera.focal_length_idxs():
        params[index] *= scale
    x, y = camera.principal_point_idxs()
    params[x], params[y] = width / 2, height / 2
    return pycolmap.Camera(model=camera.model_name, width=width, height=height, params=params)


def solve(points2d, points3d, camera) -> dict:
    """LO-RANSAC PnP with refinement. The pose is returned only when enough correspondences agree on it; otherwise why not."""
    import numpy as np
    import pycolmap
    estimation = pycolmap.AbsolutePoseEstimationOptions()
    estimation.ransac.max_error = MAX_ERROR_PIXELS
    refinement = pycolmap.AbsolutePoseRefinementOptions()
    refinement.refine_focal_length = True
    attempt = lambda: pycolmap.estimate_and_refine_absolute_pose(points2d, points3d, camera, estimation, refinement) if len(points2d) >= 4 else None
    # The scan's focal length is only a guess for a photo from another phone or zoom: refinement corrects it in `camera`, so
    # a second pass collects the matches the guess pushed past the threshold (30% off kept 44 of 140 true matches; then all
    # 140). If the guess is too far off for any start, the focal length is estimated within RANSAC instead.
    solved = attempt()
    if solved:
        solved = attempt() or solved
    else:
        estimation.estimate_focal_length = True
        solved = attempt()
    inliers = int(solved['num_inliers']) if solved else 0
    ratio = inliers / max(1, len(points2d))
    out = {'located': False, 'inliers': inliers, 'inlier_ratio': round(ratio, 4)}
    if not solved or inliers < MIN_INLIERS or ratio < MIN_INLIER_RATIO:
        out['reason'] = (f'Only {inliers} of {len(points2d)} matched points agree on one camera position; '
                         'the photo is not placed rather than placed wrongly.')
        return out
    pose = solved['cam_from_world']
    mask = np.asarray(solved['inlier_mask'], dtype=bool)
    residual = np.linalg.norm(np.array([camera.img_from_cam(pose * xyz) for xyz in points3d[mask]]) - points2d[mask], axis=1)
    out.update(located=True, world_to_camera=pose.matrix().tolist(), camera_center=(-pose.rotation.matrix().T @ pose.translation).tolist(),
               camera={'model': camera.model_name, 'width': camera.width, 'height': camera.height, 'parameters': camera.params.tolist()},
               mean_reprojection_error_pixels=round(float(residual.mean()), 3))
    return out


def locate(workspace: Path, photo: Path, scratch: Path) -> dict:
    import numpy as np
    import pycolmap
    from PIL import Image
    started = time.monotonic()
    model = selected_model(workspace)
    scratch.mkdir(parents=True, exist_ok=True)
    prepared = scratch / 'located-photo.jpg'
    preparation = sparse_colmap.prepare_photo(photo, prepared, with_evidence=True)
    gray = np.ascontiguousarray(np.asarray(Image.open(prepared).convert('L'), dtype=np.uint8))
    options = pycolmap.FeatureExtractionOptions({'num_threads': sparse_colmap.THREADS, 'max_image_size': sparse_colmap.MAX_IMAGE_EDGE,
                                                 'sift': {'max_num_features': 4096}})
    keypoints, descriptors = pycolmap.Sift(options, device=pycolmap.Device.cpu).extract(gray)
    query = unit_rows(descriptors)
    # One 3D point per photo feature and one photo feature per 3D point, keeping the strongest frame's vote.
    by_point, frames = {}, []
    database = pycolmap.Database.open(str(workspace / 'database.db'))
    try:
        for image_id in sorted(model.reg_image_ids()):
            image = model.image(image_id)
            pairs = match(query, unit_rows(database.read_descriptors(image_id)))
            observed = image.points2D
            hits = [(int(q), int(observed[f].point3D_id)) for q, f in pairs if observed[f].has_point3D()]
            frames.append({'image': image.name, 'camera_id': image.camera_id, 'matches': len(pairs), 'on_points': len(hits)})
            for q, point in hits:
                if point not in by_point:
                    by_point[point] = q
    finally:
        database.close()
    frames.sort(key=lambda frame: -frame['on_points'])
    taken, pairs2d3d = set(), []
    for point, q in by_point.items():
        if q in taken:
            continue
        taken.add(q)
        pairs2d3d.append((q, point))
    width, height = preparation['width'], preparation['height']
    result = {'schema': 'brainsnn.localization.v1', 'located': False, 'coordinate_frame': 'colmap',
              'units': 'reconstruction units: metric only after a measured distance',
              'photo': {'sha256': preparation['sourceSha256'], 'width': width, 'height': height,
                        'source_width': preparation['sourceWidth'], 'source_height': preparation['sourceHeight']},
              'features': int(len(keypoints)), 'correspondences': len(pairs2d3d),
              'frames_matched': frames[:5], 'thresholds': {'min_inliers': MIN_INLIERS, 'min_inlier_ratio': MIN_INLIER_RATIO,
                                                            'max_error_pixels': MAX_ERROR_PIXELS, 'ratio_test': RATIO},
              'policy_executed': False, 'metric_verified': False}
    if len(pairs2d3d) < MIN_INLIERS or not frames:
        result['reason'] = 'Too few of this photo\'s features match the reconstruction. It may show a part of the place the walkthrough did not film.'
        result['elapsed_seconds'] = round(time.monotonic() - started, 3)
        return result
    points2d = np.array([keypoints[q, :2] for q, _ in pairs2d3d], dtype=np.float64)
    points3d = np.array([model.points3D[p].xyz for _, p in pairs2d3d], dtype=np.float64)
    camera = query_camera(model, frames[0]['camera_id'], width, height)
    result.update(solve(points2d, points3d, camera))
    if result['located']:
        result['nearest_frame'] = frames[0]['image']
    result['elapsed_seconds'] = round(time.monotonic() - started, 3)
    return result


def run(request: dict) -> dict:
    inputs = request.get('inputs', [])
    if request.get('schema') != 'brainsnn.adapter.v1' or len(inputs) != 1 or inputs[0].get('kind') != 'image':
        raise ValueError('Locate one photo against an earlier reconstruction of the same place.')
    source = request.get('source') if isinstance(request.get('source'), dict) else {}
    if not source or source.get('missing') or source.get('engine') not in RECONSTRUCTION_ENGINES:
        raise ValueError('Choose a completed reconstruction of this place to locate the photo in.')
    workspace = Path(source['path']) / 'colmap-work'
    if not (workspace / 'database.db').is_file() or not (workspace / 'sparse' / sparse_colmap.SELECTED_MODEL).is_file():
        raise ValueError('That reconstruction no longer has its matching data; reconstruct the walkthrough again.')
    out = Path(request['output_dir']).resolve()
    out.mkdir(parents=True, exist_ok=True)
    result = locate(workspace, Path(inputs[0]['path']), out.parent / 'locate-work')
    result['source_job'] = source.get('job')
    (out / 'localization.json').write_text(json.dumps(result, indent=2, allow_nan=False))
    (out / 'manifest.json').write_text(json.dumps({'artifacts': [{'name': 'localization.json', 'kind': 'evidence'}]}))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-manifest', required=True)
    args = parser.parse_args()
    request = Path(args.input_manifest)
    if request.stat().st_size > 65536:
        raise ValueError('Input manifest is too large.')
    run(json.loads(request.read_text()))


if __name__ == '__main__':
    main()
