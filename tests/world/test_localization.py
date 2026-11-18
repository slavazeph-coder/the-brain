"""Map/record contracts and actual HTTP transport; authored data, not ROS claims."""
import copy
import http.client
import math
from pathlib import Path
import socket
import struct
import subprocess
import sys
import zipfile

import pytest

from robotics.localization import contracts as c, map_bundle
from robotics.localization.recording import Collector
from robotics.localization.telemetry import serve
from robotics.world_worker import localization_job as job
from robotics.world_worker.measurement_check import points_sha256
from robotics.scene_compiler import component_graph as cg

ROOT = Path(__file__).resolve().parents[2]
Z_TO_SCENE = [[1.,0.,0.,0.],[0.,0.,1.,0.],[0.,-1.,0.,0.],[0.,0.,0.,1.]]


def scan():
    points = [[i*.15, j*.16, .05*((i+2*j)%5)] for i in range(16) for j in range(13)]
    raw = ('ply\nformat ascii 1.0\ncomment AUTHORED CONTRACT FIXTURE\nelement vertex '+str(len(points))+
           '\nproperty float x\nproperty float y\nproperty float z\nend_header\n'+
           ''.join(' '.join(map(str,p))+'\n' for p in points)).encode()
    return raw, points


def options(raw):
    return {'schema':c.REQUEST_SCHEMA,'action':'prepare-map','sceneSha256':None,'scanSha256':c.sha(raw),
            'sourceFrame':'right-handed-z-up','sourceToScene':copy.deepcopy(Z_TO_SCENE),
            'declaration':{'kind':'registered-lidar','units':'m','registered':True},'baseFrame':'base_link','voxelMeters':.02}


def bundle(tmp_path):
    raw, _ = scan(); opt = options(raw)
    source={'mode':'scan-local','scanSha256':c.sha(raw),'sceneSha256':None,'cloudPointsSha256':None,'componentRevision':None}
    manifest, files = map_bundle.prepare(raw,opt,source)
    folder=tmp_path/'bundle'; folder.mkdir()
    for name,data in files.items():
        (folder/name).write_bytes(data)
    return folder,manifest,files


def collector_record(binding):
    collector=Collector(binding); start=1_000_000_000
    covariance=[0.]*36
    for i in (0,7,14,21,28,35):covariance[i]=.04
    for i in range(3):
        stamp=start+i*100_000_000
        collector.pose(stamp,'map',[1+i*.1,2.,3.],[0.,0.,0.,1.],covariance,now_ns=stamp)
        collector.status(stamp,0,'healthy',now_ns=stamp)
        collector.flush(now_ns=stamp,force=True)
    return collector


def test_standalone_scan_retains_ros_axes_and_deterministic_exact_map_hash(tmp_path):
    folder,m,files=bundle(tmp_path)
    assert m['source']['mode']=='scan-local' and m['source']['sceneSha256'] is None
    assert m['frames']['sourceToMap']==c.IDENTITY
    got,_=c.load_bundle(folder)
    data=files['localization-map.pcd'].split(b'DATA binary\n',1)[1]
    points=list(struct.iter_unpack('<ffff',data))
    assert points[1][:3]==pytest.approx(scan()[1][1])
    assert got['mapSha256']==c.sha(files['localization-map.pcd'])
    again=map_bundle.prepare(scan()[0],options(scan()[0]),m['source'])[1]
    assert files==again
    assert all(flag is False for flag in m['validation'].values())


def test_live_status_invalidates_last_pose_without_waiting_for_another_pose(tmp_path):
    _, manifest, files = bundle(tmp_path)
    collector = collector_record(c.binding(manifest, files['localization-map.json']))
    assert collector.snapshot()['state'] == 'tracking'


    stamp = 1_300_000_000
    collector.status(stamp, 2, 'bad_match', now_ns=stamp)
    lost = collector.snapshot()
    assert lost['state'] == 'lost' and lost['sample'] is None
    # Historic accepted poses retain their own diagnostics; recovery requires a
    # newly accepted pose, not just a later healthy diagnostic message.
    assert collector.document()['samples'][-1]['state'] == 'tracking'
    collector.status(stamp+1, 0, 'healthy', now_ns=stamp+1)
    assert collector.snapshot()['state'] == 'lost'
    collector.status(stamp, 0, 'healthy', now_ns=stamp, reinitialization_requested=True)
    assert collector.snapshot()['state'] == 'lost'
    collector.reinit(True)
    assert collector.snapshot()['sample'] is None
    collector.reinit(False)
    recovered_stamp = stamp+100_000_000
    collector.pose(recovered_stamp, 'map', [1.,2.,3.], [0.,0.,0.,1.], [0.]*36, now_ns=recovered_stamp)
    collector.status(recovered_stamp, 0, 'healthy', now_ns=recovered_stamp)
    collector.flush(now_ns=recovered_stamp, force=True)
    assert collector.snapshot()['state'] == 'tracking'


def test_rehashed_map_cannot_change_units_runtime_or_provenance(tmp_path):
    _, manifest, _ = bundle(tmp_path)
    for path, value in [(('units',), 'cm'), (('measurement', 'units'), 'cm'),
                        (('measurement', 'independentlyVerified'), True),
                        (('measurement', 'basis'), 'generated-appearance'),
                        (('upstream', 'commit'), 'a'*40), (('upstream', 'ndtCommit'), 'b'*40)]:
        changed = copy.deepcopy(manifest)
        target = changed if len(path) == 1 else changed[path[0]]
        target[path[-1]] = value
        changed['revisionSha256'] = c.manifest_revision(changed)
        with pytest.raises(ValueError):
            c.validate_map(changed)


def test_scene_composed_transform_and_source_job_are_exact(tmp_path):
    raw,points=scan(); opt=options(raw)
    cloud={'units':'m','coordinateFrame':'right-handed-y-up','points':[[*p,10,20,30] for p in points]}
    scene={'schema':'brainsnn.scene.v1','units':'m','walls':[],'objects':[], 'cloudPointsSha256':points_sha256(cloud)}
    scene=cg.attach_component_ids(scene); scene_raw=c.encode(scene)
    source=tmp_path/'source'; out=source/'output'; out.mkdir(parents=True)
    (out/'scene.json').write_bytes(scene_raw); (out/'arena-cloud.json').write_bytes(c.encode(cloud))
    opt['sceneSha256']=c.sha(scene_raw)
    opt['sourceToScene'][0][3]=4.;opt['sourceToScene'][1][3]=2.;opt['sourceToScene'][2][3]=-3.
    metadata,snapshots=job.source_scene({'source':{'path':str(source)}},opt)
    m,files=map_bundle.prepare(raw,opt,metadata)
    assert metadata['mode']=='scene-bound' and metadata['componentRevision']==0
    p=next(struct.iter_unpack('<ffff',files['localization-map.pcd'].split(b'DATA binary\n',1)[1]))
    assert p[:3]==pytest.approx([4.,3.,2.])
    assert len(snapshots)==2
    opt['sceneSha256']='a'*64
    with pytest.raises(ValueError,match='Exact metric scene'):
        job.source_scene({'source':{'path':str(source)}},opt)


@pytest.mark.parametrize('edit', ['scale','reflection','translation','generated','hash'])
def test_refuse_unbound_or_nonmeasured_map_contract(edit):
    raw,_=scan(); opt=options(raw)
    if edit=='scale':opt['sourceToScene'][0][0]=2
    if edit=='reflection':opt['sourceToScene'][0][0]=-1
    if edit=='translation':opt['sourceToScene'][0][3]=1
    if edit=='generated':opt['declaration']['kind']='generated-sam3d'
    if edit=='hash':opt['scanSha256']='f'*64
    with pytest.raises(ValueError):
        map_bundle.prepare(raw,opt,{'mode':'scan-local','scanSha256':c.sha(raw),'sceneSha256':None,'cloudPointsSha256':None,'componentRevision':None})


def test_map_tampering_and_symlinks_fail_closed(tmp_path):
    folder,m,_=bundle(tmp_path)
    (folder/'localization-map.pcd').write_bytes(b'bad')
    with pytest.raises(ValueError,match='artifact'):
        c.load_bundle(folder)
    (folder/'localization-map.ply').unlink(); (folder/'localization-map.ply').symlink_to(folder/'localization-map.json')
    with pytest.raises(ValueError):c.read_file(folder/'localization-map.ply')
    m['frames']['sourceToMap'][0][3]=9.; m['revisionSha256']=c.manifest_revision(m)
    with pytest.raises(ValueError,match='Composed'):c.validate_map(m)


def test_gaussian_ply_and_truncation_are_not_measured_points():
    raw,_=scan()
    with pytest.raises(ValueError,match='Gaussian'):
        list(map_bundle.ply_points(raw.replace(b'end_header',b'property float opacity\nend_header')))
    with pytest.raises(ValueError):list(map_bundle.ply_points(raw[:-30]))


def test_record_source_map_revision_time_and_health_are_independent_gates(tmp_path):
    _,m,files=bundle(tmp_path); bound=c.binding(m,files['localization-map.json'])
    record=collector_record(bound).document()
    assert len(c.validate_recording(record,bound)['samples'])==3
    for key in ('bundleSha256','mapSha256','scanSha256'):
        wrong={**bound,key:'a'*64}
        with pytest.raises(ValueError,match='another source'):c.validate_recording(record,wrong)
    for kind in ('backward','stale-status','healthy-bridge','false-claim','relative-time'):
        wrong=copy.deepcopy(record)
        if kind=='backward':wrong['samples'][1]['timestampNs']=wrong['samples'][0]['timestampNs']
        if kind=='stale-status':wrong['samples'][1]['diagnostics']['statusTimestampNs']='99'
        if kind=='healthy-bridge':wrong['samples'][1]['diagnostics']['poseSource']='odom_bridge_pose'
        if kind=='false-claim':wrong['validation']['accuracyVerified']=True
        if kind=='relative-time':wrong['samples'][1]['t']=99
        with pytest.raises(ValueError):c.validate_recording(wrong,bound)


def test_collector_waits_for_exact_status_rejects_stale_and_separates_odometry(tmp_path):
    _,m,files=bundle(tmp_path); collector=Collector(c.binding(m,files['localization-map.json']))
    stamp=4_000_000_000; cov=[0.]*36
    assert not collector.pose(1,'map',[0,0,0],[0,0,0,1],cov,now_ns=stamp)
    assert not collector.pose(stamp,'other',[0,0,0],[0,0,0,1],cov,now_ns=stamp)
    collector.pose(stamp,'map',[0,0,0],[0,0,0,1],cov,now_ns=stamp)
    collector.status(stamp-1,0,'healthy',now_ns=stamp);collector.flush(now_ns=stamp,force=True)
    assert not collector.samples, 'A different scan status must not authorize this pose'
    collector.status(stamp,1,'weak_overlap',now_ns=stamp)
    collector.pose(stamp,'map',[0,0,0],[0,0,0,1],cov,now_ns=stamp,source='odom_bridge_pose')
    collector.flush(now_ns=stamp,force=True)
    assert collector.document()['samples'][0]['state']=='odometry-only'
    collector.reinit(True)
    assert collector.snapshot()['state']=='odometry-only'
    collector.stop('map changed'); assert collector.snapshot()['sample'] is None


def test_malformed_json_shapes_produce_validation_errors(tmp_path):
    _,m,files=bundle(tmp_path); record=collector_record(c.binding(m,files['localization-map.json'])).document()
    for key,value in [('runtime',[]),('samples',[None]),('samples',[{**record['samples'][0],'diagnostics':None}])]:
        with pytest.raises(ValueError):c.validate_recording({**record,key:value})
    for key in ('source','frames','artifacts'):
        with pytest.raises(ValueError):c.validate_map({**m,key:None})
    path=tmp_path/'bad.json';path.write_text('[]')
    with pytest.raises(ValueError):job.validate_upload(path,'localization')


def test_worker_cli_from_private_job_cwd_and_edge_bundle(tmp_path):
    raw,_=scan(); scan_path=tmp_path/'scan.ply'; scan_path.write_bytes(raw)
    opts=tmp_path/'request.json';opts.write_bytes(c.encode(options(raw)))
    output=tmp_path/'out';output.mkdir()
    request={'schema':'brainsnn.adapter.v1','inputs':[{'kind':'survey','path':str(scan_path)},{'kind':'localization','path':str(opts)}],'output_dir':str(output)}
    req=tmp_path/'adapter.json';req.write_bytes(c.encode(request))
    subprocess.run([sys.executable,str(ROOT/'robotics/world_worker/localization_job.py'),'--input-manifest',str(req)],cwd=tmp_path,check=True)
    m,raw_m=c.load_bundle(output)
    with zipfile.ZipFile(output/'localization-edge.zip') as zipped:
        assert zipped.read('localization-map.pcd')==(output/'localization-map.pcd').read_bytes()
        assert c.decode(zipped.read('localization-edge.json'))['binding']==c.binding(m,raw_m)
    record=collector_record(c.binding(m,raw_m)).document()
    record_path=tmp_path/'record.json';record_path.write_bytes(c.encode(record))
    verified=tmp_path/'verified';verified.mkdir()
    # Source jobs use output/; preserve exactly the prepared artifacts.
    source=tmp_path/'job';source.mkdir();output.rename(source/'output')
    result=job.run({'schema':'brainsnn.adapter.v1','source':{'path':str(source)},'inputs':[{'kind':'localization','path':str(record_path)}],'output_dir':str(verified)})
    assert result['status']=='contract-verified' and result['accuracyVerified'] is False


def test_real_http_transport_token_origin_and_stale_snapshot(tmp_path):
    _,m,files=bundle(tmp_path);collector=collector_record(c.binding(m,files['localization-map.json']))
    token=tmp_path/'token';token.write_text('x'*48)
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    server=serve(collector,token,port,'https://www.brainsnn.com')
    def request(headers=None,method='GET'):
        client=http.client.HTTPConnection('127.0.0.1',port,timeout=2)
        client.request(method,'/v1/localization',headers=headers or {})
        response=client.getresponse();result=(response.status,dict(response.getheaders()),response.read());client.close();return result
    try:
        assert request()[0]==401
        headers={'Authorization':'Bearer '+'x'*48,'Origin':'https://www.brainsnn.com'}
        status,returned,body=request(headers)
        assert status==200 and returned['Access-Control-Allow-Origin']=='https://www.brainsnn.com'
        assert c.decode(body)['binding']==collector.binding
        assert request({**headers,'Origin':'https://untrusted.example'})[0]==403
        assert request({'Origin':'https://www.brainsnn.com','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'},'OPTIONS')[0]==204
        collector.last_received=0
        status,_,body=request(headers);assert status==409 and c.decode(body)['sample'] is None
    finally:
        server.shutdown();server.server_close()


def test_ros_jazzy_byte_diagnostic_levels_and_integer_compatibility():
    from robotics.localization.ros2_bridge import diagnostic_level
    for level in range(4):
        assert diagnostic_level(bytes([level])) == level
        assert diagnostic_level(bytearray([level])) == level
        assert diagnostic_level(level) == level
    for bad in (True, -1, 4, b'', b'00', '0', 1.0):
        with pytest.raises(ValueError, match='diagnostic level'):
            diagnostic_level(bad)
