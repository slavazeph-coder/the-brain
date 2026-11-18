"""Bounded map preparation / recording verification; ROS execution lives at edge."""
from __future__ import annotations
import argparse
import io
from pathlib import Path
import shutil
import tempfile
import zipfile
import sys

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from robotics.localization import contracts as c, map_bundle as maps
from robotics.world_worker import camera_frames as cf
from robotics.world_worker.measurement_check import points_sha256
from robotics.scene_compiler import component_graph as cg


def validate_upload(path, kind):
    raw = c.read_file(path, maps.MAX_SCAN_BYTES if kind == 'survey' else c.MAX_RECORD_BYTES)
    if kind == 'survey':
        for _ in maps.ply_points(raw):
            pass
        return {'sha256': c.sha(raw)}
    elif kind == 'localization':
        value = c.decode(raw)
        if not isinstance(value, dict):
            raise ValueError('Expected a localization JSON object')
        if value.get('schema') == c.REQUEST_SCHEMA:
            c.validate_request(value)
        else:
            c.validate_recording(value)
        return value
    else:
        raise ValueError('Unknown localization upload kind')


def source_scene(request, options):
    source = {'mode': 'scan-local', 'scanSha256': options['scanSha256'], 'sceneSha256': None,
              'cloudPointsSha256': None, 'componentRevision': None}
    snapshots = []
    if options['sceneSha256'] is None:
        if request.get('source'):
            raise ValueError('Scan-local mode must not silently borrow another scene')
        return source, snapshots
    link = request.get('source') or {}
    if link.get('missing') or not link.get('path'):
        raise ValueError('The exact completed source scene is required')
    root = cf._root(link['path'])
    scene_path, cloud_path = cf._path(root, 'output/scene.json'), cf._path(root, 'output/arena-cloud.json')
    scene_raw, cloud_raw = c.read_file(scene_path, cg.MAX_SCENE_BYTES), c.read_file(cloud_path)
    scene, cloud = c.decode(scene_raw), c.decode(cloud_raw)
    if c.sha(scene_raw) != options['sceneSha256'] or scene.get('units') != 'm' or cloud.get('units') != 'm' or scene.get('coordinateFrame', 'right-handed-y-up') != 'right-handed-y-up':
        raise ValueError('Exact metric scene binding is unavailable')
    if 'componentGraph' not in scene:
        raise ValueError('Source scene has no revision identity')
    cg.ensure_component_ids(scene)
    point_hash = points_sha256(cloud)
    if scene['componentGraph']['sourceSha256'] != point_hash:
        raise ValueError('Source scene/cloud mismatch')
    source.update(mode='scene-bound', sceneSha256=c.sha(scene_raw), cloudPointsSha256=point_hash,
                  componentRevision=scene['componentGraph']['revision'])
    return source, [(scene_path, scene_raw), (cloud_path, cloud_raw)]


def edge_files(manifest, raw):
    config = {'schema': 'brainsnn.localization-edge.v1', 'binding': c.binding(manifest, raw),
              'cloudTopic': '/cloud', 'imuTopic': '/imu', 'lidarFrame': manifest['frames']['baseFrame'],
              'baseFrame': manifest['frames']['baseFrame'], 'profile': 'standalone',
              'upstreamCommit': c.UPSTREAM_COMMIT,
              'note': 'Configure actual sensor topics/extrinsics. No robot command interface is included.'}
    readme = ('BrainSNN measured localization map\n\n'
              f'Pinned localizer: {c.UPSTREAM_COMMIT}\n'
              'Build robotics/localization/Dockerfile from the BrainSNN repository.\n'
              'Mount this extracted folder read-only at /map, the ROS bag at /bag and an empty output folder at /run-output.\n'
              'Run: python3 -m robotics.localization.ros2_runner --bundle /map --bag /bag --output /run-output\n'
              'For existing edge sensors omit --bag and select --duration. Set cloud/IMU topics and real TF frames.\n'
              'The bridge only records localization; it does not command hardware.\n'
              'Review registration, scan units, transform, stale/lost states and independent accuracy before robot use.\n')
    return {'localization-edge.json': c.encode(config), 'LOCALIZATION-README.txt': readme.encode()}


def publish(output, files):
    output = Path(output)
    if output.is_symlink() or not output.is_dir() or any((output / name).exists() for name in [*files, 'manifest.json']):
        raise ValueError('Use a fresh adapter output directory')
    with tempfile.TemporaryDirectory(prefix='localization-') as temp:
        stage = Path(temp)
        for name, raw in files.items():
            (stage / name).write_bytes(raw)
        for name in files:
            shutil.move(stage / name, output / name)
    artifacts = [{'name': name, 'kind': 'visual' if name.endswith('.ply') else 'evidence',
                  **({'representation': 'point-cloud', 'coordinate_frame': 'right-handed-z-up', 'units': 'm'} if name.endswith('.ply') else {})}
                 for name in files]
    (output / 'manifest.json').write_bytes(c.encode({'artifacts': artifacts}))


def run(request):
    if not isinstance(request, dict) or request.get('schema') != 'brainsnn.adapter.v1':
        raise ValueError('Expected a worker adapter request')
    inputs = request.get('inputs', [])
    if not isinstance(inputs, list) or len(inputs) > 2 or not all(isinstance(item, dict) for item in inputs):
        raise ValueError('Invalid localization input manifest')
    options_inputs = [i for i in inputs if i.get('kind') == 'localization']
    if len(options_inputs) != 1:
        raise ValueError('Exactly one localization JSON is required')
    raw = c.read_file(options_inputs[0]['path']); options = c.decode(raw)
    if not isinstance(options, dict):
        raise ValueError('Expected a localization JSON object')
    if options.get('schema') == c.RECORDING_SCHEMA:
        if len(inputs) != 1:
            raise ValueError('Recording verification takes only its JSON')
        link = request.get('source') or {}
        if link.get('missing') or not link.get('path'):
            raise ValueError('The exact localization map job is required')
        root = cf._root(link['path']); folder = cf._path(root, 'output/localization-map.json').parent
        manifest, bundle_raw = c.load_bundle(folder)
        c.validate_recording(options, c.binding(manifest, bundle_raw))
        report = {'schema': 'brainsnn.localization-verification.v1', 'recordingSha256': c.sha(raw),
                  'binding': options['binding'], 'samples': len(options['samples']),
                  'status': 'contract-verified', 'physicalRobotValidated': False, 'accuracyVerified': False,
                  'scope': 'Exact source/map/revision and bounded pose/health contract; producer and physical accuracy are not attested.'}
        publish(request['output_dir'], {'localization-recording.json': raw, 'localization-verification.json': c.encode(report)})
        return report
    c.validate_request(options)
    scans = [i for i in inputs if i.get('kind') == 'survey']
    if len(inputs) != 2 or len(scans) != 1:
        raise ValueError('Map preparation requires one survey PLY and one localization request')
    scan_raw = c.read_file(scans[0]['path'], maps.MAX_SCAN_BYTES)
    source, snapshots = source_scene(request, options)
    manifest, files = maps.prepare(scan_raw, options, source)
    extra = edge_files(manifest, files['localization-map.json'])
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
        for name, data in {**files, **extra}.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            zipped.writestr(info, data)
    files.update(extra); files['localization-edge.zip'] = archive.getvalue()
    for path, before in snapshots:
        if c.read_file(path, max(len(before), 1)) != before:
            raise ValueError('Scene source changed while preparing the map')
    publish(request['output_dir'], files)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest', type=Path, required=True)
    args = parser.parse_args()
    run(c.decode(c.read_file(args.input_manifest, 1_000_000)))


if __name__ == '__main__':
    main()
