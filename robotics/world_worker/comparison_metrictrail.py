"""Run the pinned research tracker on exactly the JPEGs used by the other arms."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess

import numpy as np

from . import metrictrail_trial as mt
from . import reconstruction_comparison as rc
from .measurement_check import comparison_evidence


def video_frames(capture):
    frames = capture['frames']
    if len(capture['sources']) != 1 or capture['sources'][0]['kind'] != 'video':
        raise ValueError('MetricTrail needs temporally ordered frames from one video.')
    if len(frames) < 16:
        raise ValueError('MetricTrail needs at least 16 prepared frames.')
    if [f['image'] for f in frames] != [f'frame_{i:04d}.jpg' for i in range(len(frames))]:
        raise ValueError('ViPE directory order differs from the shared frame inventory.')
    if any(b['sourceFrameIndex'] <= a['sourceFrameIndex'] for a, b in zip(frames, frames[1:])):
        raise ValueError('Original video frame indices must increase.')
    if len({(f['width'], f['height']) for f in frames}) != 1:
        raise ValueError('MetricTrail needs a constant prepared raster.')
    return frames


def target_hw(frame):
    # A plain resize retains all annotated pixels, including for portrait video.
    factor = min(1., 504 / max(frame['height'], frame['width']))
    return [round(frame[k] * factor) for k in ('height', 'width')]


def comparison_cameras(raw, capture):
    frames = video_frames(capture)
    run, poses, ids, intrinsics = mt.read_tracking(raw, 'frames', check_indices=True)
    h, w = frames[0]['height'], frames[0]['width']
    th, tw = target_hw(frames[0])
    expected = {'schema': 'metrictrail_input_raster_v2', 'policy': 'resize', 'source_hw': [h, w],
                'target_hw': [th, tw], 'resized_hw': [th, tw], 'crop_left_top': [0, 0],
                'frame_stride': 1, 'source_frames': len(frames)}
    raster = run['input_raster']
    tracking = run['tracking_stride']
    if (any(raster.get(key) != value for key, value in expected.items())
            or raster.get('interpolation', {}).get('align_corners') is not False
            or tracking.get('stride') != 1 or tracking.get('tracked_frames') != len(ids)
            or run.get('intrinsics_source') != 'sharedk' or run.get('sensor_K_or_GT_read') is not False):
        raise ValueError('ViPE raster, tracking or calibration differs from the frozen comparison.')
    # Map integer pixel centres from the annotated JPEG to the resized ViPE raster.
    sx, sy = tw / w, th / h
    affine = [[sx, 0., (sx - 1) / 2], [0., sy, (sy - 1) / 2], [0., 0., 1.]]
    rows = []
    for frame_id, pose, k in zip(ids, poses, intrinsics):
        frame = frames[int(frame_id)]  # local frame directory ordinal, never an original video index
        rotation = pose[:3, :3].T
        rows.append({'image': frame['image'], 'imageSha256': frame['sha256'], 'width': tw, 'height': th,
                     'preparedWidth': w, 'preparedHeight': h, 'preparedToCameraPixelCenter': affine,
                     'cam_from_world': np.column_stack((rotation, -rotation @ pose[:3, 3])).tolist(),
                     'camera': {'model': 'PINHOLE', 'params': k.tolist(), 'pixelConvention': 'integer-centres'}})
    return {'schema': rc.CAMERA_SCHEMA, 'coordinateFrame': 'vipe-opencv-world-model-estimated-metres',
            'captureSha256': capture['captureSha256'], 'metricVerified': False, 'frames': rows}


def run(case, out, capture, install, evaluation_only):
    if not evaluation_only or install is None:
        raise ValueError('MetricTrail needs --evaluation-only and --metrictrail-install with local paths.')
    frames = video_frames(capture)
    paths = rc.read_json(install)
    if (not isinstance(paths, dict) or set(paths) != {'source', 'python', *mt.WEIGHTS}
            or any(not isinstance(p, str) or not Path(p).is_absolute() for p in paths.values())):
        raise ValueError('MetricTrail installation needs absolute source, python, dpvo, dino and moge paths.')
    source, python = Path(paths['source']), Path(paths['python'])
    if not python.is_file() or not os.access(python, os.X_OK):
        raise ValueError('The configured ViPE Python interpreter is unavailable.')
    weights = {k: Path(paths[k]) for k in mt.WEIGHTS}
    pins = mt.preflight(source, weights)
    env = mt.tracking_environment(source, weights)
    raw = out / 'raw'
    images = case / 'frames'
    th, tw = target_hw(frames[0])
    command = mt.tracking_command(python, source, images, raw, weights)
    command += ['streams=frame_dir_stream', 'pipeline.init.input_raster.policy=resize',
                f'pipeline.init.input_raster.height={th}', f'pipeline.init.input_raster.width={tw}']
    # Both children share the outer benchmark process group, deadline and engine log.
    subprocess.run(command, cwd=out, env=env, check=True)
    cameras = comparison_cameras(raw, capture)
    # The pinned exporter prints its summary on stdout and progress on stderr.
    # Keep the regular log bounded by the outer runner; cap summary input separately.
    command = [str(python), '-m', 'vipe.metrictrail.pointcloud', str(raw), '--name', 'frames',
               '--frames', str(images), '--filter', 'strict']
    with subprocess.Popen(command, cwd=out, env=env, stdout=subprocess.PIPE) as child:
        summary = child.stdout.read(64 * 1024 + 1)
        if len(summary) > 64 * 1024:
            child.kill()
            raise ValueError('ViPE fusion summary exceeded 64 KiB.')
        if child.wait():
            raise RuntimeError('Strict ViPE fusion failed. See the engine log.')
    (out / 'fusion.json').write_bytes(summary)
    fused = rc.read_json(out / 'fusion.json')
    if (fused.get('name') != 'frames' or fused.get('filter') != 'strict'
            or fused.get('input_hw') != [th, tw] or fused.get('frames') != len(cameras['frames'])):
        raise ValueError('Strict export does not match the tracked camera inventory.')
    ply = raw / 'pointcloud/frames.ply'
    cloud, sampling = mt.estimated_cloud(ply, fused)
    cloud['provenance']['comparisonEvidence'] = comparison_evidence({
        'captureReceiptSha256': capture['captureSha256'], 'sourceVideoSha256': capture['sources'][0]['sha256'],
        'fusionPlySha256': rc.sha(ply)})
    mt.preflight(source, weights)
    cloud_path = out / 'estimated-metric-cloud.json'
    mt.write_cloud(cloud_path, cloud)
    rc.write_json(out / 'cameras.json', cameras)
    return {'engine': 'metrictrail', 'evaluationOnly': True, 'installation': pins,
            'registeredFrames': len(cameras['frames']), 'inputFrames': len(frames), 'device': {'type': 'cuda'},
            'sampling': sampling, 'pointsHandedOff': len(cloud['points']), 'scaleBasis': 'model-estimated',
            'floorFit': {'basis': 'internal-cloud-fit', 'independentGravityValidated': False,
                         **{key: cloud['provenance'][key] for key in ('floorAligned', 'floorTiltDegrees', 'floorInlierFraction')}},
            'inputRaster': [th, tw], 'metricVerified': False, 'physicalRobotValidated': False,
            'artifactSha256': {str(p.relative_to(out)): rc.sha(p) for p in (
                raw / 'vipe/frames_metrictrail.json', raw / 'pose/frames.npz', raw / 'intrinsics/frames.npz',
                ply, out / 'fusion.json', cloud_path)}}


def comparison_screen(rows, predeclared_physical):
    """Compare calibrated geometry only. Preserve unscorable attempts and partial spans."""
    screen = {'status': 'unavailable', 'basis': 'single-calibration-held-out-landmarks',
              'minimumSpans': 3, 'minimumMedianReduction': .25, 'minimumPoseFraction': .95,
              'maximumPoseGapSeconds': 1., 'metricVerified': False}
    if not predeclared_physical:
        return {**screen, 'reason': 'The screen requires physical readings frozen before inference.'}
    for engine in ('colmap', 'vggt', 'metrictrail'):
        row = rows.get(engine, {})
        if row.get('status') != 'completed' or (row.get('captureConsistency') or {}).get('status') == 'folded':
            return {**screen, 'reason': f'{engine} did not complete a comparable run or reported a fold.'}
        summary = row['measurementReport']['summary']
        if summary['requestedHeldOutCount'] < screen['minimumSpans'] or not summary['allRequestedHeldOutAvailable']:
            return {**screen, 'reason': f'{engine} has insufficient complete held-out evidence.'}
    if (rows['colmap'].get('captureConsistency') or {}).get('status') != 'consistent':
        return {**screen, 'reason': 'The COLMAP film-order check is inconclusive.'}
    baseline = min(('colmap', 'vggt'), key=lambda e: rows[e]['measurementReport']['summary']['heldOutMedianAbsoluteErrorMeters'])
    base_error = rows[baseline]['measurementReport']['summary']['heldOutMedianAbsoluteErrorMeters']
    candidate = rows['metrictrail']
    summary = candidate['measurementReport']['summary']
    coverage = candidate['poseCoverage']
    gap = coverage['longestPoseGapSeconds']
    if base_error <= 1e-9 or gap is None:
        return {**screen, 'reason': 'The baseline median is effectively zero or original frame timing is unavailable.'}
    reduction = 1 - summary['heldOutMedianAbsoluteErrorMeters'] / base_error
    passed = (reduction >= screen['minimumMedianReduction'] and coverage['fraction'] >= screen['minimumPoseFraction']
              and gap <= screen['maximumPoseGapSeconds']
              and summary['heldOutWithinToleranceCount'] == summary['requestedHeldOutCount'])
    return {**screen, 'status': 'passed' if passed else 'failed', 'baseline': baseline,
            'measuredMedianReduction': reduction, 'reason': 'One capture, calibrated landmark errors and pose coverage only.'}
