"""Native capture integration: real camera database/poses, auth, and source binding."""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import pytest
from fastapi.testclient import TestClient

from robotics.world_worker import native_capture as nc, sparse_colmap as sc
from robotics.world_worker.app import create_app


def bundle_inputs(root, count=3):
    frames, inputs = [], []
    for index in range(count):
        path = root / f'photo-{index}.png'
        Image.fromarray(np.random.default_rng(index).integers(0, 255, (300, 400, 3), dtype=np.uint8)).save(path)
        pose = np.eye(4); pose[0, 3] = index * .2
        frames.append({'id': str(index), 'image': path.name, 'image_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                       'image_size': [400, 300], 'timestamp_seconds': index * .2, 'tracking_state': 'normal',
                       'intrinsics': [[330, 0, 199.5], [0, 340, 149.5], [0, 0, 1]], 'camera_to_world': pose.tolist()})
        inputs.append({'path': str(path), 'name': path.name, 'kind': 'image'})
    bundle = {'schema': 'brainsnn.capture.v1', 'pose_convention': 'arkit-camera-to-world', 'units': 'm',
              'pixel_convention': 'integer-centres', 'frames': frames}
    sidecar = root / 'capture.json'; sidecar.write_text(json.dumps(bundle))
    return [{'path': str(sidecar), 'name': sidecar.name, 'kind': 'capture'}, *reversed(inputs)], bundle


def test_capture_binds_and_orders_original_uploads(tmp_path):
    inputs, bundle = bundle_inputs(tmp_path)
    images, evidence = nc.inputs_evidence(inputs)
    assert [item['name'] for item in images] == [frame['image'] for frame in bundle['frames']]
    assert evidence['normal_tracking_frames'] == 3
    assert evidence['bundle_sha256'] == hashlib.sha256(Path(inputs[0]['path']).read_bytes()).hexdigest()
    assert evidence['metric_verified'] is False
    assert evidence['frames'][1]['timestamp_seconds'] == .2


@pytest.mark.parametrize('mutation', ['hash', 'extra', 'missing', 'duplicate', 'path', 'orientation', 'distortion', 'skew', 'tracking'])
def test_capture_rejects_unbound_or_unsupported_inputs(tmp_path, mutation):
    inputs, bundle = bundle_inputs(tmp_path)
    if mutation == 'hash': bundle['frames'][0]['image_sha256'] = '0'*64
    if mutation == 'extra': inputs.append({**inputs[-1], 'name': 'extra.png'})
    if mutation == 'missing': inputs.pop()
    if mutation == 'duplicate': inputs.append(inputs[-1])
    if mutation == 'path': bundle['frames'][0]['image'] = '../photo-0.png'
    if mutation == 'distortion': bundle['frames'][0]['distortion'] = [0.1]
    if mutation == 'skew': bundle['frames'][0]['intrinsics'][0][1] = .1
    if mutation == 'tracking': bundle['frames'][0]['tracking_state'] = 'limited'
    if mutation == 'orientation':
        path = tmp_path / 'photo-0.png'
        with Image.open(path) as original: raster = original.copy()
        exif = Image.Exif(); exif[274] = 6
        raster.save(path, exif=exif)
        bundle['frames'][0]['image_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    Path(inputs[0]['path']).write_text(json.dumps(bundle))
    with pytest.raises(ValueError): nc.inputs_evidence(inputs)


def test_metadata_rejects_duplicates_and_oversized_json(tmp_path):
    path = tmp_path / 'capture.json'
    path.write_text('{"schema": "brainsnn.capture.v1", "schema": "brainsnn.capture.v1"}')
    with pytest.raises(ValueError, match='Duplicate'): nc.read_metadata(path)
    path.write_bytes(b' ' * (nc.MAX_METADATA_BYTES + 1))
    with pytest.raises(ValueError, match='1 MiB'): nc.read_metadata(path)


def associations_for(images, root):
    root.mkdir()
    associations = []
    for index, item in enumerate(images):
        target = root / f'image_{index:04d}.jpg'
        preparation = sc.prepare_photo(Path(item['path']), target, with_evidence=True)
        associations.append({'image': target.name, 'preparation': preparation})
    return associations


def test_native_calibration_written_to_actual_colmap_database(tmp_path):
    pycolmap = pytest.importorskip('pycolmap')
    inputs, _ = bundle_inputs(tmp_path)
    images, evidence = nc.inputs_evidence(inputs)
    associations = associations_for(images, tmp_path / 'prepared')
    # Exercise nonuniform scaling and the half-pixel conversion directly.
    associations[0]['preparation'].update(width=200, height=225, sourceToPreparedPixelCenter=[[.5, 0, -.25], [0, .75, -.125], [0, 0, 1]])
    path = tmp_path / 'database.db'
    db = pycolmap.Database.open(path)
    for entry in associations:
        prep = entry['preparation']
        camera = pycolmap.Camera(model='PINHOLE', width=prep['width'], height=prep['height'], params=[1, 1, 1, 1])
        cid = db.write_camera(camera)
        db.write_image(pycolmap.Image(name=entry['image'], camera_id=cid))
    db.close()
    nc.apply_calibration(path, associations, evidence)
    db = pycolmap.Database.open(path)
    try:
        by_name = {image.name: db.read_camera(image.camera_id) for image in db.read_all_images()}
        assert by_name['image_0000.jpg'].params == pytest.approx([165, 255, 100, 112.5])
        assert by_name['image_0001.jpg'].params == pytest.approx([330, 340, 200, 150])
        assert all(c.model_name == 'PINHOLE' and c.has_prior_focal_length for c in by_name.values())
    finally: db.close()


def authored_model(root, count=3):
    pycolmap = pytest.importorskip('pycolmap')
    root.mkdir()
    (root / 'cameras.txt').write_text('1 PINHOLE 400 300 330 340 200 150\n')
    (root / 'images.txt').write_text(''.join(f'{i+1} 1 0 0 0 {-i} 0 0 1 image_{i:04d}.jpg\n\n' for i in range(count)))
    (root / 'points3D.txt').write_text('1 1 2 4 100 100 100 0.1\n')
    return pycolmap.Reconstruction(root)


def test_real_model_alignment_scales_points_and_keeps_unverified_units(tmp_path):
    inputs, _ = bundle_inputs(tmp_path)
    images, evidence = nc.inputs_evidence(inputs)
    associations = associations_for(images, tmp_path / 'prepared')
    model = authored_model(tmp_path / 'model')
    aligned = nc.align_model(model, associations, evidence)
    assert aligned['scale_from_sfm'] == pytest.approx(.2)
    assert aligned['applied'] is True and aligned['metric_verified'] is False
    assert aligned['position_rms_native_m'] < 1e-10
    assert model.point3D(1).xyz == pytest.approx([.2, .4, .8])
    assert model.image(2).projection_center() == pytest.approx([.2, 0, 0])


@pytest.mark.parametrize('mode', ['no-baseline', 'inconsistent-centres', 'inconsistent-attitude'])
def test_alignment_rejects_degenerate_or_contradictory_priors(tmp_path, mode):
    inputs, bundle = bundle_inputs(tmp_path)
    if mode == 'no-baseline':
        for frame in bundle['frames']: frame['camera_to_world'][0][3] = 0
    if mode == 'inconsistent-centres': bundle['frames'][1]['camera_to_world'][1][3] = 3
    if mode == 'inconsistent-attitude':
        bundle['frames'][1]['camera_to_world'] = [[0, -1, 0, .2], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    Path(inputs[0]['path']).write_text(json.dumps(bundle))
    images, evidence = nc.inputs_evidence(inputs)
    associations = associations_for(images, tmp_path / 'prepared')
    model = authored_model(tmp_path / 'model')
    before = model.point3D(1).xyz.copy()
    with pytest.raises(ValueError): nc.align_model(model, associations, evidence)
    assert model.point3D(1).xyz == pytest.approx(before), 'No transformation is applied before acceptance.'


def test_capture_upload_uses_existing_auth_consent_and_size_gates(tmp_path):
    inputs, _ = bundle_inputs(tmp_path)
    config = tmp_path / 'adapters.json'
    config.write_text(json.dumps([{'id': 'capture-test', 'command': [sys.executable, '-c', 'pass'], 'input_kinds': ['image', 'capture'],
                                  'enabled': True, 'license_reviewed': True, 'max_inputs': 12}]))
    headers = {'Authorization': 'Bearer ' + 'x'*40}
    with TestClient(create_app(root=tmp_path / 'worker', token='x'*40, adapters=str(config))) as client:
        payload = Path(inputs[0]['path']).read_bytes()
        meta = {'name': 'capture.json', 'kind': 'capture', 'size': len(payload)}
        assert client.post('/v1/uploads', json=meta).status_code == 401
        assert client.post('/v1/uploads', json={**meta, 'size': nc.MAX_METADATA_BYTES+1}, headers=headers).status_code == 422
        upload = client.post('/v1/uploads', json=meta, headers=headers)
        assert upload.status_code == 201, upload.text
        uid = upload.json()['id']
        assert client.put(f'/v1/uploads/{uid}?offset=0', content=payload, headers=headers).status_code == 200
        assert client.post('/v1/jobs', json={'engine': 'capture-test', 'upload_ids': [uid], 'consent': False}, headers=headers).status_code == 422
        assert client.post('/v1/jobs', json={'engine': 'inspect', 'upload_ids': [uid], 'consent': True}, headers=headers).status_code == 422
        assert client.post('/v1/jobs', json={'engine': 'capture-test', 'upload_ids': [uid], 'consent': True}, headers=headers).status_code == 201


def rendered_capture(root):
    """Idealized ray-cast room; authored truth is independent of the image solver."""
    from PIL import ImageDraw
    root.mkdir()
    w,h=800,600; f=650.; cx=(w-1)/2;cy=(h-1)/2
    rng=np.random.default_rng(740)
    textures=[]
    for surface in range(6):
        tex=Image.new('RGB',(1024,1024),(120,120,130));d=ImageDraw.Draw(tex)
        for i in range(6000):
            x,y=rng.integers(0,1024,2);r=int(rng.integers(3,15));color=tuple(map(int,rng.integers(15,245,3)))
            d.rectangle((int(x),int(y),int(x+r),int(y+r)),fill=color)
        textures.append(np.asarray(tex))
    yy,xx=np.mgrid[:h,:w]; ray=np.stack(((xx-cx)/f,(yy-cy)/f,np.ones_like(xx)),axis=-1)
    frames=[]
    for i,x in enumerate([-1.,-.5,0.,.5,1.]):
        C=np.array([x,0.,0.]); best=np.full((h,w),np.inf);rgb=np.zeros((h,w,3),dtype=np.uint8)
        # axis, plane position, other axes bounds, texture index
        surfaces=[(2,4,0,-2,2,1,-1.5,1.5,0),(0,-2,2,0,4,1,-1.5,1.5,1),(0,2,2,0,4,1,-1.5,1.5,2),(1,1.5,0,-2,2,2,0,4,3),(1,-1.5,0,-2,2,2,0,4,4),(2,2.5,0,-.65,.5,1,-.4,.65,5)]
        for axis,pos,ua,lo,hi,va,vlo,vhi,tex in surfaces:
            with np.errstate(divide='ignore',invalid='ignore'): t=(pos-C[axis])/ray[:,:,axis];P=C+t[:,:,None]*ray
            valid=(t>0)&(t<best)&(P[:,:,ua]>=lo)&(P[:,:,ua]<=hi)&(P[:,:,va]>=vlo)&(P[:,:,va]<=vhi)
            u=np.clip(np.nan_to_num((P[:,:,ua]-lo)/(hi-lo),nan=0,posinf=0,neginf=0)*1023,0,1023).astype(int)
            v=np.clip(np.nan_to_num((P[:,:,va]-vlo)/(vhi-vlo),nan=0,posinf=0,neginf=0)*1023,0,1023).astype(int)
            rgb[valid]=textures[tex][v[valid],u[valid]];best[valid]=t[valid]
        path=root/f'frame-{i}.png';Image.fromarray(rgb).save(path)
        T=np.eye(4);T[:3,3]=np.diag([1,-1,-1])@C
        frames.append({'id':str(i),'image':path.name,'image_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'image_size':[w,h],'timestamp_seconds':i*.4,'tracking_state':'normal','intrinsics':[[f,0,cx],[0,f,cy],[0,0,1]],'camera_to_world':T.tolist()})
    bundle={'schema':'brainsnn.capture.v1','pose_convention':'arkit-camera-to-world','units':'m','pixel_convention':'integer-centres','frames':frames}
    (root/'capture.json').write_text(json.dumps(bundle))
    inputs=[{'name':'capture.json','kind':'capture','path':str(root/'capture.json')}]+[{'name':f['image'],'kind':'image','path':str(root/f['image'])} for f in frames]
    return {'schema': 'brainsnn.adapter.v1', 'inputs': inputs, 'output_dir': str(root/'job'/'artifacts')}


def test_full_native_adapter_solves_rendered_room_and_reopens_bound_camera_evidence(tmp_path):
    pytest.importorskip('pycolmap')
    from robotics.world_worker import camera_frames
    request = rendered_capture(tmp_path / 'rendered')
    result = sc.run(request)
    assert result['capture']['registered_images'] == 5
    assert result['capture']['consistency']['status'] == 'consistent'
    assert result['reconstructed_points'] > 100
    assert result['mean_reprojection_error_pixels'] < 1
    assert result['units'] == 'arbitrary' and result['metric_verified'] is False
    alignment = result['native_capture']['alignment']
    assert alignment['applied'] and alignment['position_rms_native_m'] < .01
    assert alignment['rotation_max_degrees'] < 1
    assert all(camera['model'] == 'PINHOLE' and camera['parameters'] == [650, 650, 400, 300] for camera in result['cameras'])
    out = Path(request['output_dir'])
    native = out / 'native-capture.json'
    assert hashlib.sha256(native.read_bytes()).hexdigest() == result['native_capture']['sha256']
    assert json.loads(native.read_text())['reconstruction_executed'] is True
    cli = native_submission_cli()
    expected = nc.inputs_evidence(request['inputs'])[1]
    names = ['reconstruction.json', 'native-capture.json', 'camera-frames.json', 'sparse-preview.ply']
    checked = cli['verify_result'](out, names, expected)
    assert checked['source_frames'] == 5 and checked['fold_status'] == 'consistent'
    # A successful JSON transport cannot substitute different or empty geometry.
    original = (out / 'reconstruction.json').read_bytes()
    for mutate in [lambda record: record.update(reconstructed_points=0),
                   lambda record: record['capture'].update(registered_images=0),
                   lambda record: record['sources'][0].update(name='other.png'),
                   lambda record: record['point_clouds'][0].update(sha256='0'*64)]:
        record = json.loads(original); mutate(record)
        (out / 'reconstruction.json').write_text(json.dumps(record))
        with pytest.raises(RuntimeError): cli['verify_result'](out, names, expected)
    (out / 'reconstruction.json').write_bytes(original)
    ledger_bytes = (out / 'camera-frames.json').read_bytes()
    broken = json.loads(ledger_bytes); broken['frames'][0]['origin']['sourceIndex'] = 99
    (out / 'camera-frames.json').write_text(json.dumps(broken))
    with pytest.raises(RuntimeError, match='camera ledger'): cli['verify_result'](out, names, expected)
    (out / 'camera-frames.json').write_bytes(ledger_bytes)
    ledger = camera_frames.load_record(out.parent, ledger_path=out / 'camera-frames.json')
    assert len(ledger['frames']) == 5
    # The transformed cameras must still project the transformed cloud; a persisted
    # model with the old gauge would disagree with the public receipt.
    import pycolmap
    reopened = pycolmap.Reconstruction(out.parent / 'colmap-work' / 'sparse' / '0')
    by_name = {image.name: image for image in reopened.images.values()}
    for camera in result['cameras']:
        assert by_name[camera['image']].cam_from_world().matrix() == pytest.approx(np.asarray(camera['world_to_camera']))


def test_native_capture_upload_cannot_cross_tenant_boundary(tmp_path):
    from robotics.world_worker.auth import REGISTRY_SCHEMA
    inputs, _ = bundle_inputs(tmp_path)
    config = tmp_path / 'adapters.json'
    config.write_text(json.dumps([{'id': 'capture-test', 'command': [sys.executable, '-c', 'pass'], 'input_kinds': ['image', 'capture'],
                                  'enabled': True, 'license_reviewed': True, 'max_inputs': 12}]))
    tenants = tmp_path / 'tenants.json'
    tenants.write_text(json.dumps({'schema': REGISTRY_SCHEMA, 'tenants': [
        {'id': owner, 'token_sha256': hashlib.sha256(token.encode()).hexdigest(), 'engines': ['capture-test']}
        for owner, token in [('alpha', 'a'*43), ('beta', 'b'*43)]]}))
    a, b = {'Authorization': 'Bearer '+'a'*43}, {'Authorization': 'Bearer '+'b'*43}
    with TestClient(create_app(root=tmp_path / 'worker', token='operator-'+'x'*40, tenants=str(tenants), adapters=str(config))) as client:
        payload = Path(inputs[0]['path']).read_bytes()
        upload = client.post('/v1/uploads', json={'name': 'capture.json', 'kind': 'capture', 'size': len(payload)}, headers=a)
        assert upload.status_code == 201
        uid = upload.json()['id']
        assert client.put(f'/v1/uploads/{uid}?offset=0', content=payload, headers=a).status_code == 200
        assert client.get(f'/v1/uploads/{uid}', headers=b).status_code == 404
        assert client.post('/v1/jobs', json={'engine': 'capture-test', 'upload_ids': [uid], 'consent': True}, headers=b).status_code == 404


def native_submission_cli():
    import runpy
    script = Path(__file__).resolve().parents[2] / 'scripts/world-demo/native_capture_submit.py'
    sys.path.insert(0, str(script.parent))
    try: return runpy.run_path(str(script))
    finally: sys.path.remove(str(script.parent))


def test_native_submission_validates_sources_and_checks_upload_offsets(tmp_path):
    cli = native_submission_cli()
    inputs, _ = bundle_inputs(tmp_path)
    submitted = cli['capture_inputs'](Path(inputs[0]['path']), tmp_path)
    assert len(submitted) == 4
    class WrongOffset:
        def json(self, method, path, *args, **kwargs):
            return {'id': '0'*32} if method == 'POST' else {'offset': 1}
    with pytest.raises(RuntimeError, match='offset'): cli['upload'](WrongOffset(), submitted[0])
    (tmp_path / 'photo-0.png').write_bytes(b'changed bytes')
    with pytest.raises(ValueError, match='hash'): cli['capture_inputs'](Path(inputs[0]['path']), tmp_path)


@pytest.mark.parametrize('mutation', ['missing', 'fold', 'missing-fold', 'hash', 'bundle', 'frame', 'not-executed', 'not-aligned', 'metric'])
def test_native_submission_rejects_unqualified_completed_results(tmp_path, mutation):
    cli = native_submission_cli()
    expected = {'bundle_sha256': 'a' * 64, 'frames': [{'image': 'frame.png', 'image_sha256': 'b' * 64}]}
    native = {'schema': 'brainsnn.capture-evidence.v1', **expected, 'reconstruction_executed': True,
              'metric_verified': False, 'alignment': {'applied': True, 'metric_verified': False}}
    native = json.loads(json.dumps(native))
    if mutation == 'frame': native['frames'][0]['image_sha256'] = 'c' * 64
    if mutation == 'not-executed': native['reconstruction_executed'] = False
    if mutation == 'not-aligned': native['alignment']['applied'] = False
    data = json.dumps(native).encode()
    (tmp_path / 'native-capture.json').write_bytes(data)
    result = {'capture': {'consistency': {'status': 'consistent'}}, 'metric_verified': False, 'units': 'arbitrary',
              'native_capture': {'artifact': 'native-capture.json', 'sha256': hashlib.sha256(data).hexdigest(),
                                 'bundle_sha256': expected['bundle_sha256'], 'alignment': native['alignment']}}
    if mutation == 'fold': result['capture']['consistency']['status'] = 'folded'
    if mutation == 'missing-fold': result['capture'] = {}
    if mutation == 'hash': result['native_capture']['sha256'] = '0' * 64
    if mutation == 'bundle': result['native_capture']['bundle_sha256'] = 'd' * 64
    if mutation == 'metric': result['metric_verified'] = True
    (tmp_path / 'reconstruction.json').write_text(json.dumps(result))
    names = ['native-capture.json', 'reconstruction.json', 'camera-frames.json', 'sparse-preview.ply'] if mutation != 'missing' else ['native-capture.json']
    with pytest.raises(RuntimeError): cli['verify_result'](tmp_path, names, expected)


def test_native_submission_timeout_keeps_receipt_and_known_job_id(tmp_path, monkeypatch):
    cli = native_submission_cli()
    inputs, _ = bundle_inputs(tmp_path)
    output = tmp_path / 'submitted'
    monkeypatch.setenv('BRAINSNN_PASSCODE', 'test-only-secret-never-record')
    monkeypatch.setattr(sys, 'argv', ['native_capture_submit.py', '--bundle', inputs[0]['path'], '--out', str(output), '--consent'])
    class Site:
        def __init__(self, base): self.base = base
        def json(self, *args, **kwargs):
            return {'token': 'session-secret-never-record', 'engines': [{'id': 'colmap-sparse', 'available': True, 'input_kinds': ['capture']}]}
    def timed_out(*args, on_job, **kwargs):
        on_job({'id': 'known-native-job', 'status': 'queued'})
        raise RuntimeError('known-native-job exceeded deadline; cancellation accepted')
    monkeypatch.setitem(cli['main'].__globals__, 'Site', Site)
    monkeypatch.setitem(cli['main'].__globals__, 'upload', lambda *args: 'upload')
    monkeypatch.setitem(cli['main'].__globals__, 'run_job', timed_out)
    with pytest.raises(RuntimeError, match='cancellation accepted'): cli['main']()
    text = (output / 'submission.json').read_text(); receipt = json.loads(text)
    assert receipt['passed'] is False and receipt['job_id'] == 'known-native-job'
    assert receipt['status'] == 'queued'  # last known, not a fabricated terminal status
    assert 'secret-never-record' not in text


def test_alignment_respects_native_basis_with_nonidentity_rotation_and_translation(tmp_path):
    inputs, bundle = bundle_inputs(tmp_path)
    angle = np.deg2rad(27)
    rotation = np.array([[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]])
    basis = np.diag([1., -1., -1.]); translation = np.array([3., -2., 1.])
    for index, frame in enumerate(bundle['frames']):
        pose = np.eye(4)
        pose[:3, :3] = basis @ rotation @ basis
        pose[:3, 3] = basis @ (.2*rotation @ [index, 0, 0] + translation)
        frame['camera_to_world'] = pose.tolist()
    Path(inputs[0]['path']).write_text(json.dumps(bundle))
    images, evidence = nc.inputs_evidence(inputs)
    associations = associations_for(images, tmp_path / 'prepared')
    model = authored_model(tmp_path / 'model')
    aligned = nc.align_model(model, associations, evidence)
    assert np.asarray(aligned['rotation']) == pytest.approx(rotation)
    assert aligned['translation'] == pytest.approx(translation)
    assert model.point3D(1).xyz == pytest.approx(.2*rotation @ [1, 2, 4] + translation)
    assert model.image(2).cam_from_world().rotation.matrix() == pytest.approx(rotation.T)
