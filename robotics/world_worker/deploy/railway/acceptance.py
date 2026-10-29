"""Opt-in deployed-site acceptance using SYNTHETIC geometry only.

Uses the existing shared passcode in memory, never logs it or tokens. Runs the
actual scene compiler, packages one installed NVIDIA asset, and streams every
artifact through the site proxy with hashes checked. Not a phone or physics test.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import re
import time
import urllib.request
import uuid
SITE='https://the-brain-production.up.railway.app'

class Client:
    def __init__(self):self.token=None;self.deadline=time.monotonic()+1800
    def remaining(self):
        remaining=self.deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('Acceptance deadline exceeded')
        return remaining
    def call(self,path,body=None,raw=None,method=None):
        headers={'Cache-Control':'no-store'}
        if self.token and path.startswith('/api/world/worker/') and '/v1/download/' not in path:headers['Authorization']='Bearer '+self.token
        data=raw if raw is not None else json.dumps(body).encode() if body is not None else None
        if data is not None:headers['Content-Type']='application/octet-stream' if raw is not None else 'application/json'
        return urllib.request.urlopen(urllib.request.Request(SITE+path,data=data,headers=headers,method=method or ('POST' if data is not None else 'GET')),timeout=min(120,self.remaining()))
    def json(self,path,**kw):
        with self.call(path,**kw) as r:
            data=r.read(16*1024**2+1)
            if len(data)>16*1024**2:raise ValueError('JSON size limit')
            return json.loads(data)
    def upload(self,cloud):
        data=json.dumps(cloud,allow_nan=False).encode()
        u=self.json('/api/world/worker/v1/uploads',body={'name':'synthetic-acceptance.json','kind':'cloud','size':len(data)})
        for i in range(0,len(data),4*1024**2):
            result=self.json(f"/api/world/worker/v1/uploads/{u['id']}?offset={i}",raw=data[i:i+4*1024**2],method='PUT')
            if result['offset']!=min(i+4*1024**2,len(data)):raise ValueError('Upload offset mismatch')
        return u['id']
    def run(self,engine,cloud,source=None):
        body={'engine':engine,'upload_ids':[self.upload(cloud)],'consent':True}
        if source:body['source_job']=source
        j=self.json('/api/world/worker/v1/jobs',body=body);jid=j['id']
        try:
            self.json(f'/api/world/worker/v1/jobs/{jid}/start',body={});deadline=time.monotonic()+660
            while time.monotonic()<deadline:
                j=self.json('/api/world/worker/v1/jobs/'+jid)
                if j['status'] in ('complete','failed','cancelled'):break
                time.sleep(2)
            if j['status']!='complete':raise RuntimeError(f'{engine}: {j["status"]}')
            return j
        except Exception:
            try:self.json(f'/api/world/worker/v1/jobs/{jid}',method='DELETE')
            except Exception:pass
            raise
    def artifacts(self,job):
        records=[];payloads={}
        rows=job.get('artifacts')
        if not isinstance(rows,list) or not rows or len(rows)>64:raise ValueError('Missing or excessive artifacts')
        if len({a['name'] for a in rows})!=len(rows):raise ValueError('Duplicate artifact names')
        for i,a in enumerate(rows):
            url=self.json(f"/api/world/worker/v1/jobs/{job['id']}/ticket",body={'artifact':i})['url']
            if not url.startswith('/api/world/worker/v1/download/'):raise ValueError('Unexpected download path')
            digest=hashlib.sha256();size=0;parts=[]
            with self.call(url) as r:
                while block:=r.read(1024**2):
                    self.remaining()
                    size+=len(block)
                    if size>a['size']:raise ValueError('Download size exceeded')
                    digest.update(block)
                    if a['name'] in ('scene.json','arena-cloud.json','omniverse-receipt.json'):
                        if size>16*1024**2:raise ValueError('Evidence size exceeded')
                        parts.append(block)
            if size!=a['size'] or digest.hexdigest()!=a['sha256']:raise ValueError('Artifact hash mismatch')
            records.append({'name':a['name'],'bytes':size,'sha256':digest.hexdigest(),'hash_verified':True})
            if parts:payloads[a['name']]=json.loads(b''.join(parts))
        return records,payloads


def validate_pack(records,payloads,options):
    by_name={row['name']:row for row in records}
    if len(by_name)!=len(records) or not {'scene-omniverse.zip','omniverse-receipt.json'}<=by_name.keys():
        raise ValueError('Required package artifacts missing or duplicated')
    receipt=payloads.get('omniverse-receipt.json')
    if not isinstance(receipt,dict) or receipt.get('schema')!='brainsnn.omniverse-pack.v1':
        raise ValueError('Package receipt missing or invalid')
    for field,expected in {'source_scene_sha256':options['scene_sha256'],'source_cloud_sha256':options['cloud_sha256'],
                           'archive_sha256':by_name['scene-omniverse.zip']['sha256'],'units':'m','up_axis':'Y'}.items():
        if receipt.get(field)!=expected:raise ValueError('Package receipt source or archive mismatch')
    for field in ('physics_executed','metric_verified','physics_ready','policy_executed'):
        if receipt.get(field) is not False:raise ValueError('Package receipt contains an unsupported qualification')
    if receipt.get('usd_reopened') is not True or receipt.get('source_exports_unchanged') is not True:
        raise ValueError('Package receipt lacks source preservation or USD load evidence')
    placements=receipt.get('library_placements')
    if not isinstance(placements,list) or len(placements)!=1:raise ValueError('Package placement missing or duplicated')
    actual,wanted=placements[0],options['placements'][0]
    asset=actual.get('asset')
    if (actual.get('id')!=wanted['id'] or actual.get('translation_m')!=wanted['translation_m']
            or actual.get('rotation_xyz_deg')!=wanted.get('rotation_xyz_deg',[0,0,0])
            or not isinstance(asset,dict) or asset.get('asset')!=wanted['asset']
            or asset.get('package_sha256')!=wanted['package_sha256'] or asset.get('physics_tested') is not False):
        raise ValueError('Package receipt does not match the reviewed library placement')


def synthetic_room():
    points=[]
    for i in range(41):
        for j in range(28):
            x,y=i*.1,j*.1
            points += [[x,y,0,120,120,120],[x,y,4,120,120,120],[0,y,x,120,120,120],[4,y,x,120,120,120]]
        for j in range(41):points.append([i*.1,0,j*.1,90,90,90])
    return {'version':1,'kind':'colmap-sparse-point-cloud','coordinateFrame':'right-handed-y-up',
            'sourceFrame':'right-handed-y-up','multiView':True,'units':'m',
            'source':'SYNTHETIC deployment fixture; not a camera reconstruction or physical measurement',
            'points':points,'floorEstimate':{'y':0},'provenance':{'synthetic':True,'metricVerified':False},
            'scale':{'source':'user-measured','metresPerUnit':1,'distance':4,'spanUnits':4,'selfReported':True,'verified':False}}


def execute(client):
    secret=os.environ.get('WORLD_SITE_PASSCODE','')
    if len(secret)<12:raise ValueError('Shared site passcode unavailable')
    deadline=time.monotonic()+180;caps=None
    while time.monotonic()<deadline:
        try:
            client.token=client.json('/api/world/session',body={'passcode':secret})['token']
            candidate=client.json('/api/world/worker/v1/capabilities')
            if any(e['id']=='omniverse-pack' and e.get('available') for e in candidate['engines']):caps=candidate;break
        except Exception:pass
        time.sleep(5)
    if caps is None:raise RuntimeError('Updated worker was not reachable through website')
    asset=next((x for x in caps.get('simready_assets',[]) if x.get('available')),None)
    if asset is None:raise RuntimeError('NVIDIA asset catalog was not available')
    started=time.monotonic();scene=client.run('scene-usd',synthetic_room());scene_records,payloads=client.artifacts(scene)
    options={'schema':'brainsnn.omniverse-request.v1','reviewed':True,
             'scene_sha256':next(a['sha256'] for a in scene['artifacts'] if a['name']=='scene.json'),
             'cloud_sha256':next(a['sha256'] for a in scene['artifacts'] if a['name']=='arena-cloud.json'),
             'placements':[{'id':'acceptance_pole','asset':asset['asset'],'package_sha256':asset['package_sha256'],
                            'translation_m':[2,0,2],'license_reviewed':True,'unqualified_physics_reviewed':True}]}
    cloud=payloads['arena-cloud.json'];cloud['omniversePack']=options
    pack=client.run('omniverse-pack',cloud,scene['id']);pack_records,pack_payloads=client.artifacts(pack)
    validate_pack(pack_records,pack_payloads,options)
    return {'source_kind':'synthetic-room',
            'site':SITE,'scene_job':scene['id'],'pack_job':pack['id'],'scene_artifacts':scene_records,
            'pack_artifacts':pack_records,'asset':asset['asset'],'elapsed_seconds':round(time.monotonic()-started,2),
            'authenticated_site_proxy':True,'actual_scene_compiler':True,'all_download_hashes_verified':True,
            'physics_executed':False,'phone_capture_executed':False,'physical_accuracy_verified':False}


def write_report(path,report):
    temporary=path.with_name(path.name+'.'+report['run_id']+'.tmp')
    temporary.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    temporary.replace(path)


def run_acceptance(path=Path('/data/omniverse-acceptance.json')):
    # Overwrite an earlier success before any authentication or network request.
    # Only explicitly allowlisted, validated deployment identifiers are retained.
    deployment=os.environ.get('RAILWAY_DEPLOYMENT_ID','')
    commit=os.environ.get('RAILWAY_GIT_COMMIT_SHA','')
    report={'schema':'brainsnn.hosted-omniverse-acceptance.v1','run_id':str(uuid.uuid4()),'status':'started',
            'started_at':datetime.now(timezone.utc).isoformat(),
            'deployment_id':deployment if re.fullmatch(r'[a-fA-F0-9-]{36}',deployment) else None,
            'commit_sha':commit if re.fullmatch(r'[a-fA-F0-9]{40}',commit) else None,
            'acceptance_script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    write_report(path,report)
    try:
        report.update(execute(Client()));report['status']='passed'
    except Exception as error:
        report.update(status='failed',error_type=type(error).__name__)
        raise
    finally:
        report['finished_at']=datetime.now(timezone.utc).isoformat()
        write_report(path,report)
    print('OMNIVERSE_HOSTED_ACCEPTANCE '+json.dumps(report),flush=True)
    return report


def main():
    p=argparse.ArgumentParser();p.add_argument('--confirm-synthetic-deployment-test',action='store_true');a=p.parse_args()
    if not a.confirm_synthetic_deployment_test:raise ValueError('Explicit test execution required')
    run_acceptance()

if __name__=='__main__':
    try:main()
    except Exception as error:
        # Network exceptions can carry signed URLs. Persist/log only their type.
        print('OMNIVERSE_HOSTED_ACCEPTANCE_FAILED '+type(error).__name__,flush=True)
        sys.exit(1)
