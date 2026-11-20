"""Numerical camera, timing and eligibility fixtures. These tests do not run a model."""
import copy
import json
import sys

import numpy as np
import pytest

from robotics.world_worker import comparison_metrictrail as arm
from robotics.world_worker import reconstruction_comparison as rc


def capture():
    return {'captureSha256': 'a' * 64, 'sources': [{'kind': 'video'}],
            'frames': [{'image': f'frame_{i:04d}.jpg', 'sha256': f'{i:064x}', 'width': 480, 'height': 640,
                        'sourceFrameIndex': i * 3, 'timeBase': [1, 30], 'pts': i * 3} for i in range(20)]}


def tracked(root, receipt):
    frames = receipt['frames']
    ids = np.array([i for i in range(len(frames)) if i != 7])
    n = len(ids)
    rotation = np.array([[0., -1., 0.], [1., 0., 0.], [0., 0., 1.]])
    cams = np.tile(np.eye(4), (n, 1, 1))
    cams[:, :3, :3] = rotation
    cams[:, :3, 3] = np.column_stack((ids / 10, ids / 20, 1 + ids / 30))
    for name in ('pose', 'intrinsics', 'vipe', 'pointcloud'):
        (root / name).mkdir(parents=True)
    np.savez(root / 'pose/frames.npz', data=cams, source_frame_ids=ids, inds=np.arange(n))
    np.savez(root / 'intrinsics/frames.npz', data=np.tile([310., 320., 180., 240.], (n, 1)), inds=np.arange(n))
    run = {'schema': 'metrictrail_vipe_run_v1', 'status': 'success', 'name': 'frames', 'tracking_status': 'tracked',
           'intrinsics_source': 'sharedk', 'sensor_K_or_GT_read': False, 'tracking': {'metric_prior_status': 'applied'},
           'tracking_stride': {'stride': 1, 'tracked_frames': n, 'source_frame_ids': ids.tolist()},
           'input_raster': {'schema': 'metrictrail_input_raster_v2', 'policy': 'resize', 'source_hw': [640, 480],
                            'target_hw': [504, 378], 'resized_hw': [504, 378], 'crop_left_top': [0, 0],
                            'frame_stride': 1, 'source_frames': len(frames), 'source_fps': 30,
                            'interpolation': {'align_corners': False}}}
    rc.write_json(root / 'vipe/frames_metrictrail.json', run)
    return cams


def test_shared_portrait_jpeg_coordinates_and_pose_direction(tmp_path):
    case = capture()
    poses = tracked(tmp_path, case)
    cams = arm.comparison_cameras(tmp_path, case)
    row = cams['frames'][7]
    assert row['image'] == 'frame_0008.jpg' and row['imageSha256'] == case['frames'][8]['sha256']
    np.testing.assert_allclose(row['cam_from_world'], np.linalg.inv(poses[7])[:3], atol=1e-12)
    mapped = np.array(row['preparedToCameraPixelCenter']) @ [37, 83, 1]
    np.testing.assert_allclose(mapped[:2], (np.array([37, 83]) + .5) * 504 / 640 - .5)
    assert row['camera']['pixelConvention'] == 'integer-centres'
    assert cams['captureSha256'] == case['captureSha256'] and cams['metricVerified'] is False
    assert rc.pose_coverage(case, cams)['longestPoseGapSeconds'] == pytest.approx(.2)


@pytest.mark.parametrize('bad', ['crop', 'row-order', 'pose-ids', 'known-k', 'unordered', 'photos', 'frame-count'])
def test_incompatible_tracking_cannot_masquerade_as_same_images(tmp_path, bad):
    case = capture()
    tracked(tmp_path, case)
    path = tmp_path / 'vipe/frames_metrictrail.json'
    run = rc.read_json(path)
    if bad == 'crop':
        run['input_raster']['crop_left_top'] = [4, 0]
    if bad == 'row-order':
        k = tmp_path / 'intrinsics/frames.npz'
        with np.load(k) as a:
            values, ids = a['data'], a['inds']
        np.savez(k, data=values, inds=ids[::-1])
    if bad == 'pose-ids':
        run['tracking_stride']['source_frame_ids'][-1] -= 1
    if bad == 'known-k':
        run['sensor_K_or_GT_read'] = True
    if bad == 'unordered':
        case['frames'].reverse()
    if bad == 'photos':
        case['sources'][0]['kind'] = 'image'
    if bad == 'frame-count':
        run['input_raster']['source_frames'] += 1
    rc.write_json(path, run)
    with pytest.raises(ValueError):
        arm.comparison_cameras(tmp_path, case)


def test_pose_gaps_use_original_variable_rate_pts_and_count_unobserved_time():
    case = capture()
    case['frames'] = case['frames'][:4]
    for f, t in zip(case['frames'], (0, 2, 23, 46)):
        f.update(pts=t, timeBase=[1, 10])
    cams = {'frames': case['frames']}
    assert rc.pose_coverage(case, cams)['longestMissingIntervalSeconds'] == 0
    assert rc.pose_coverage(case, cams)['longestPoseGapSeconds'] == 2.3
    cams['frames'] = case['frames'][1:2]
    cov = rc.pose_coverage(case, cams)
    assert cov['withPose'] == 1 and len(cov['missing']) == 3
    assert cov['longestMissingIntervalSeconds'] == cov['longestPoseGapSeconds'] == 4.4
    case['frames'][2]['pts'] = 2
    assert rc.pose_coverage(case, cams)['longestPoseGapSeconds'] is None
    case['sources'][0]['kind'] = 'image'
    assert rc.pose_coverage(case, cams)['longestMissingIntervalSeconds'] is None


def screen_rows():
    rows = {}
    for name, error in [('colmap', .08), ('vggt', .04), ('metrictrail', .03)]:
        rows[name] = {'status': 'completed', 'captureConsistency': {'status': 'consistent' if name == 'colmap' else 'not-checked'},
                      'poseCoverage': {'fraction': .95, 'longestPoseGapSeconds': 1.},
                      'measurementReport': {'summary': {'requestedHeldOutCount': 3, 'allRequestedHeldOutAvailable': True,
                          'heldOutWithinToleranceCount': 3, 'heldOutMedianAbsoluteErrorMeters': error}}}
    return rows


def test_screen_uses_better_baseline_and_keeps_failed_or_unavailable_evidence():
    rows = screen_rows()
    ok = arm.comparison_screen(rows, True)
    assert ok['status'] == 'passed' and ok['baseline'] == 'vggt' and ok['metricVerified'] is False
    assert arm.comparison_screen(rows, False)['status'] == 'unavailable'
    for engine, path, value, expected in (
        ('colmap', ('captureConsistency', 'status'), 'folded', 'unavailable'),
        ('colmap', ('captureConsistency', 'status'), 'unconfirmed', 'unavailable'),
        ('vggt', ('status',), 'failed', 'unavailable'),
        ('metrictrail', ('measurementReport', 'summary', 'allRequestedHeldOutAvailable'), False, 'unavailable'),
        ('vggt', ('measurementReport', 'summary', 'heldOutMedianAbsoluteErrorMeters'), 0., 'unavailable'),
        ('metrictrail', ('poseCoverage', 'fraction'), .94, 'failed'),
        ('metrictrail', ('poseCoverage', 'longestPoseGapSeconds'), 1.01, 'failed'),
        ('metrictrail', ('measurementReport', 'summary', 'heldOutWithinToleranceCount'), 2, 'failed'),
        ('metrictrail', ('measurementReport', 'summary', 'heldOutMedianAbsoluteErrorMeters'), .035, 'failed'),
    ):
        changed = copy.deepcopy(rows)
        node = changed[engine]
        for key in path[:-1]:
            node = node[key]
        node[path[-1]] = value
        assert arm.comparison_screen(changed, True)['status'] == expected


def test_offline_adapter_invokes_tracking_and_strict_export_on_identical_directory(tmp_path, monkeypatch):
    # Stub scripts copy authored artifacts. This exercises the actual two-process adapter contract.
    case = capture()
    case_dir = tmp_path / 'case'
    (case_dir / 'frames').mkdir(parents=True)
    out = tmp_path / 'result'
    out.mkdir()
    checkout = tmp_path / 'source'
    (checkout / 'vipe/metrictrail').mkdir(parents=True)
    numeric = checkout / 'authored'
    tracked(numeric, case)
    ply = numeric / 'pointcloud/frames.ply'
    ply.write_text('ply\nformat ascii 1.0\nelement vertex 100\nproperty float x\nproperty float y\nproperty float z\nend_header\n'
                   + ''.join(f'{i/10} {j/10} 0\n' for i in range(10) for j in range(10)))
    (checkout / 'run.py').write_text(
        "from pathlib import Path\nimport sys,shutil\nargs=dict(a.split('=',1) for a in sys.argv[1:])\n"
        "assert args['streams']=='frame_dir_stream' and args['pipeline.init.input_raster.height']=='504'\n"
        "root=Path(__file__).parent\nshutil.copytree(root/'authored',args['pipeline.output.path'])\n"
        "Path('input.txt').write_text(args['streams.base_path'])\n")
    fused = {'name': 'frames', 'filter': 'strict', 'input_hw': [504, 378], 'frames': 19, 'voxels': 100,
             'frame': 'z_up', 'world_to_output_rotation': np.eye(3).tolist(), 'settings': {'min_consistent': 4}}
    (checkout / 'vipe/metrictrail/pointcloud.py').write_text(
        "from pathlib import Path\nimport sys\nassert sys.argv[2:4]==['--name','frames']\n"
        "assert sys.argv[4:]==['--frames',Path('input.txt').read_text(),'--filter','strict']\n"
        + 'print(' + repr(json.dumps(fused)) + ')\n')
    install = tmp_path / 'install.json'
    rc.write_json(install, dict(source=str(checkout), python=sys.executable, dpvo='/d', dino='/i', moge='/m'))
    monkeypatch.setattr(arm.mt, 'preflight', lambda *args: {'fixture': True})
    with pytest.raises(ValueError, match='evaluation-only'):
        arm.run(case_dir, out, case, install, False)
    result = arm.run(case_dir, out, case, install, True)
    assert (out / 'input.txt').read_text() == str(case_dir / 'frames')
    assert result['registeredFrames'] == 19 and result['evaluationOnly']
    cloud = rc.read_json(out / 'estimated-metric-cloud.json')
    assert 0 < len(cloud['points']) <= 50_000 and cloud['scale']['source'] == 'model-estimated'
    assert cloud['provenance']['comparisonCaptureSha256'] == case['captureSha256']
    assert cloud['provenance']['fusionPlySha256'] == rc.sha(ply)
    assert all(rc.sha(out / name) == digest for name, digest in result['artifactSha256'].items())
