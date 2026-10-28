"""Opt-in deployed-site acceptance using SYNTHETIC geometry only.

Uses the existing shared passcode in memory, never logs it or tokens. Runs the
actual scene compiler, packages one installed NVIDIA asset, and streams every
artifact through the site proxy with hashes checked. Not a phone or physics test.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
SITE='https://the-brain-production.up.railway.app'

class Client:
    def __init__(self):self.token=None
    def call(self,path,body=None,raw=None,method=None):
        headers={'Cache-Control':'no-store'}
        if self.token and path.startswith('/api/world/worker/') and '/v1/download/' not in path:headers['Authorization']='Bearer '+self.token
        data=raw if raw is not None else json.dumps(body).encode() if body is not None else None
        if data is not None:headers['Content-Type']='application/octet-stream' if raw is not None else 'application/json'
        return urllib.request.urlopen(urllib.request.Request(SITE+path,data=data,headers=headers,method=method or ('POST' if data is not None else 'GET')),timeout=120)
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
            try:self.json(f'/api/world/worker/v1/jobs/{jid}/cancel',body={})
            except Exception:pass
            raise
    def artifacts(self,job):
        records=[];payloads={}
        for i,a in enumerate(job['artifacts']):
            url=self.json(f"/api/world/worker/v1/jobs/{job['id']}/ticket",body={'artifact':i})['url']
            if not url.startswith('/api/world/worker/v1/download/'):raise ValueError('Unexpected download path')
            digest=hashlib.sha256();size=0;parts=[]
            with self.call(url) as r:
                while block:=r.read(1024**2):
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


def main():
    p=argparse.ArgumentParser();p.add_argument('--confirm-synthetic-deployment-test',action='store_true');a=p.parse_args()
    if not a.confirm_synthetic_deployment_test:raise ValueError('Explicit test execution required')
    secret=os.environ.get('WORLD_SITE_PASSCODE','')
    if len(secret)<12:raise ValueError('Shared site passcode unavailable')
    client=Client();deadline=time.monotonic()+180;caps=None
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
    pack=client.run('omniverse-pack',cloud,scene['id']);pack_records,_=client.artifacts(pack)
    report={'schema':'brainsnn.hosted-omniverse-acceptance.v1','source_kind':'synthetic-room',
            'site':SITE,'scene_job':scene['id'],'pack_job':pack['id'],'scene_artifacts':scene_records,
            'pack_artifacts':pack_records,'asset':asset['asset'],'elapsed_seconds':round(time.monotonic()-started,2),
            'authenticated_site_proxy':True,'actual_scene_compiler':True,'all_download_hashes_verified':True,
            'physics_executed':False,'phone_capture_executed':False,'physical_accuracy_verified':False}
    Path('/data/omniverse-acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
    print('OMNIVERSE_HOSTED_ACCEPTANCE '+json.dumps(report),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('OMNIVERSE_HOSTED_ACCEPTANCE_FAILED '+type(error).__name__+': '+str(error).split('?')[0][:250],flush=True)
        sys.exit(1)
