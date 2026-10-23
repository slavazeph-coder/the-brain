"""ETH3D benchmark contracts on synthetic data: no dataset, no scipy, no model."""
import json
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker import benchmark_eth3d as bench
from robotics.world_worker.geometry import write_point_cloud


def rotation_z(angle):
    c, s = np.cos(angle), np.sin(angle)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def quaternion(R):
    w = np.sqrt(1 + np.trace(R)) / 2
    return [w, (R[2, 1] - R[1, 2]) / (4 * w), (R[0, 2] - R[2, 0]) / (4 * w), (R[1, 0] - R[0, 1]) / (4 * w)]


def synthetic_scene(tmp_path, *, pipeline='colmap-sparse'):
    """A 4 x 3 m floor scanned in metres, and a reconstruction of it in another frame at 1/7.3 scale."""
    s_true, R_true, t_true = 7.3, rotation_z(.6), np.array([2., -1., .5])  # metres per unit, unit frame -> ground truth
    floor = np.stack(np.meshgrid(np.arange(0, 4, .05), np.arange(0, 3, .05)), -1).reshape(-1, 2)
    scan = np.column_stack([floor, np.zeros(len(floor))])
    centres_gt = {f'DSC_{i:04d}': np.array([.5 + i * .7, 1.5 + (i % 2) * .4, 1.4]) for i in range(5)}
    to_unit = lambda p: ((p - t_true) @ R_true) / s_true  # inverse similarity
    scene = tmp_path / 'office'; (scene / 'dslr_calibration_jpg').mkdir(parents=True); (scene / 'scan_clean').mkdir()
    rows = ['# ETH3D-style images.txt']
    for i, (name, centre) in enumerate(centres_gt.items()):
        R_cam = rotation_z(.2 * i); t_cam = -R_cam @ centre
        rows += [f'{i + 1} ' + ' '.join(map(str, quaternion(R_cam))) + ' ' + ' '.join(map(str, t_cam)) + f' 1 dslr_images/{name}.JPG', '']
    (scene / 'dslr_calibration_jpg' / 'images.txt').write_text('\n'.join(rows) + '\n')
    header = f'ply\nformat binary_little_endian 1.0\nelement vertex {len(scan)}\nproperty float x\nproperty float y\nproperty float z\nend_header\n'
    (scene / 'scan_clean' / 'scan1.ply').write_bytes(header.encode() + scan.astype('<f4').tobytes())
    (scene / 'scan_clean' / 'scan_alignment.mlp').write_text(
        '<MeshLabProject><MeshGroup><MLMesh filename="scan1.ply"><MLMatrix44>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</MLMatrix44>'
        '</MLMesh></MeshGroup></MeshLabProject>')
    out = tmp_path / 'job'; out.mkdir()
    sources = [{'name': f'{name}.jpg', 'kind': 'image'} for name in centres_gt]
    centres = [to_unit(c) for c in centres_gt.values()]
    if pipeline == 'colmap-sparse':
        cameras = [{'image': f'image_{i:04d}.jpg', 'camera_center': c.tolist()} for i, c in enumerate(centres)]
    else:
        cameras = [{'view': i, 'camera_to_world_y_up': np.vstack([np.column_stack([np.eye(3), c]), [0, 0, 0, 1]]).tolist()} for i, c in enumerate(centres)]
    cameras.append({'image': 'image_0099.jpg', 'camera_center': [0, 0, 0]})  # no such source: ignored
    (out / 'reconstruction.json').write_text(json.dumps({'schema': 'brainsnn.reconstruction.v1', 'pipeline': pipeline, 'sources': sources, 'cameras': cameras}))
    half = scan[scan[:, 0] < 2]  # the reconstruction saw exactly half the floor
    write_point_cloud(out / ('sparse-preview.ply' if pipeline == 'colmap-sparse' else 'dense-preview.ply'),
                      to_unit(half), np.full((len(half), 3), 128), coordinate_frame='colmap')
    return scene, out, s_true


def test_umeyama_recovers_a_known_similarity():
    rng = np.random.default_rng(1)
    source = rng.normal(size=(20, 3)); R = rotation_z(1.1)
    s, rotation, t = bench.umeyama(source, 2.5 * source @ R.T + [1, 2, 3])
    assert abs(s - 2.5) < 1e-9 and np.allclose(rotation, R) and np.allclose(t, [1, 2, 3])


def test_both_engines_cameras_match_ground_truth_by_upload_name(tmp_path):
    for pipeline in ['colmap-sparse', 'mapanything-apache']:
        scene, out, _ = synthetic_scene(tmp_path / pipeline, pipeline=pipeline)
        pairs = bench.reconstruction_centres(json.loads((out / 'reconstruction.json').read_text()))
        assert [name for name, _ in pairs] == [f'dsc_{i:04d}' for i in range(5)]
        truth = bench.ground_truth_centres(scene / 'dslr_calibration_jpg' / 'images.txt')
        assert np.allclose(truth['dsc_0003'], [.5 + 3 * .7, 1.9, 1.4])


def test_score_recovers_scale_accuracy_and_partial_completeness(tmp_path):
    scene, out, s_true = synthetic_scene(tmp_path)
    report = bench.score(out, scene, scan_step=1, voxel=.02)
    assert report['cameras']['matched'] == 5 and report['cameras']['rmsMetres'] < 1e-6
    assert abs(report['scale']['metresPerUnit'] - s_true) < 1e-6
    assert report['accuracyMetres']['median'] < 1e-4 and report['accuracyMetres']['within5cm'] == 1
    # Half the floor was reconstructed, so half the scan (one boundary column aside) has a point within 5 cm.
    assert .45 < report['completeness']['within5cm'] < .55, report['completeness']


def test_too_few_named_cameras_is_an_error_not_a_score(tmp_path):
    scene, out, _ = synthetic_scene(tmp_path)
    evidence = json.loads((out / 'reconstruction.json').read_text())
    evidence['sources'] = [{'name': f'renamed_{i}.jpg'} for i in range(5)]
    (out / 'reconstruction.json').write_text(json.dumps(evidence))
    try:
        bench.score(out, scene, scan_step=1)
    except ValueError as error:
        assert 'original names' in str(error)
    else:
        raise AssertionError('scored without ground-truth cameras')
