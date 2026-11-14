"""One opt-in hosted IFC deployment check on authored points, never a phone test.

Runs inside the existing worker with its existing site credential in memory.
Only bounded identifiers, counts and artifact hashes are persisted or logged.
"""
from __future__ import annotations
import argparse,copy,hashlib,json,os,re,sys,tempfile,time,uuid
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[4]))
from robotics.world_worker.deploy.railway.acceptance import Client,synthetic_room
from robotics.scene_compiler import component_graph as cg
from robotics.scene_compiler.ifc_export import write_ifc,ifc_guid

def prior_review(scene,scene_sha):
    original=cg.ensure_component_ids(scene)
    candidates=[(i,p) for i,p in enumerate(original['objects']) if p.get('kind')=='separated' and p.get('label')!='floor']
    if not candidates:raise ValueError('Synthetic compilation produced no standalone object')
    index,target=candidates[0];prior=copy.deepcopy(original);prior.pop('componentGraph')
    for field in ('walls','objects','openings'):
        for p in prior.get(field,[]):
            for key in ('componentId','hostComponentId','doorComponentId'):p.pop(key,None)
    moved=prior['objects'][index];moved['centre'][0]-=.25
    for field in ('min','max'):
        if field in moved:moved[field][0]-=.25
    prior=cg.attach_component_ids(prior)
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'prior.ifc';write_ifc(path,prior);raw=path.read_bytes()
    pairs=[{'priorGlobalId':ifc_guid(p['componentId']),'currentComponentId':p['componentId'],'reviewed':True} for field in ('walls','objects') for p in original.get(field,[])]
    request={'schema':'brainsnn.asbuilt-review.v1','source':{'priorIfcSha256':hashlib.sha256(raw).hexdigest(),'currentSceneSha256':scene_sha,'componentRevision':original['componentGraph']['revision']},
      'registration':{'method':'operator-reviewed-same-frame','translationMeters':[0,0,0],'yawDegrees':0,'reviewed':True,'note':'Authored same-frame deployment fixture; not measured registration.'},
      'toleranceMeters':.05,'maxTranslationMeters':2,'maxExtentDifferenceMeters':.05,'pairs':pairs,'selectedTranslations':[ifc_guid(target['componentId'])],
      'brief':{'targets':'Authored standalone placement','intendedUse':'Deployment execution check','accuracyTargetMeters':.05,'detail':'observed-component-proxies'},'metricVerified':False,'physicalRobotValidated':False}
    return raw,request,target['componentId']

def upload(client,raw,name,kind):
    base='/api/world/worker/v1'
    uid=client.json(base+'/uploads',body={'name':name,'kind':kind,'size':len(raw)})['id']
    for offset in range(0,len(raw),4*1024**2):
        part=raw[offset:offset+4*1024**2];reply=client.json(base+f'/uploads/{uid}?offset={offset}',raw=part,method='PUT')
        if reply['offset']!=offset+len(part):raise ValueError('Upload offset mismatch')
    return uid

def run_job(client,engine,files,source):
    ids=[upload(client,*f) for f in files]
    job=client.json('/api/world/worker/v1/jobs',body={'engine':engine,'upload_ids':ids,'source_job':source,'consent':True})
    jid=job['id']
    try:
        client.json(f'/api/world/worker/v1/jobs/{jid}/start',body={});deadline=time.monotonic()+240
        while time.monotonic()<deadline:
            job=client.json('/api/world/worker/v1/jobs/'+jid)
            if job['status'] in ('complete','failed','cancelled'):break
            time.sleep(1)
        if job['status']!='complete':raise ValueError('Hosted as-built operation did not complete')
        return job
    except Exception:
        try:client.json('/api/world/worker/v1/jobs/'+jid,method='DELETE')
        except Exception:pass
        raise

def payload(client,job,name):
    index,entry=next((i,e) for i,e in enumerate(job['artifacts']) if e['name']==name)
    if entry['size']>16*1024**2:raise ValueError('Acceptance artifact exceeds limit')
    url=client.json(f'/api/world/worker/v1/jobs/{job["id"]}/ticket',body={'artifact':index})['url']
    if not url.startswith('/api/world/worker/v1/download/'):raise ValueError('Unexpected ticket path')
    with client.call(url) as response:raw=response.read(entry['size']+1)
    if len(raw)!=entry['size'] or hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Acceptance artifact integrity mismatch')
    return raw

def execute(client):
    secret=os.environ.get('WORLD_SITE_PASSCODE','')
    if len(secret)<12:raise ValueError('Existing site credential unavailable')
    deadline=time.monotonic()+180
    while time.monotonic()<deadline:
        try:
            client.token=client.json('/api/world/session',body={'passcode':secret})['token']
            caps=client.json('/api/world/worker/v1/capabilities')
            if {'asbuilt-update','asbuilt-evidence','scene-usd'}<={e['id'] for e in caps['engines'] if e.get('available')}:break
        except Exception:pass
        time.sleep(4)
    else:raise ValueError('Updated worker did not become available')
    cloud=synthetic_room()
    for i in range(13):
        for j in range(13):
            x,y=i/20,j/20
            cloud['points'] += [[1.5+x,.6,1.5+y,140,90,50],[1.5+x,y,1.5,140,90,50],[1.5+x,y,2.1,140,90,50],[1.5,y,1.5+x,140,90,50],[2.1,y,1.5+x,140,90,50]]
    started=time.monotonic();scene_job=client.run('scene-usd',cloud)
    scene_raw=payload(client,scene_job,'scene.json');scene=json.loads(scene_raw);scene_sha=hashlib.sha256(scene_raw).hexdigest()
    prior,review,component=prior_review(scene,scene_sha)
    changed=run_job(client,'asbuilt-update',[(prior,'prior.ifc','ifc'),(json.dumps(review).encode(),'review.json','asbuilt')],scene_job['id'])
    updated=payload(client,changed,'updated.ifc');report=json.loads(payload(client,changed,'asbuilt-update-report.json'))
    receipt=json.loads(payload(client,changed,'asbuilt-source.json'))
    if report['updatedCount']!=1 or report['source']!=review['source'] or receipt['outputIfcSha256']!=hashlib.sha256(updated).hexdigest() or receipt['sceneSha256']!=scene_sha or receipt['metricVerified'] is not False or receipt['physicalRobotValidated'] is not False:
        raise ValueError('Hosted IFC receipt does not match the requested copy')
    if payload(client,changed,'prior.ifc')!=prior or payload(client,changed,'capture-scene.json')!=scene_raw or payload(client,scene_job,'scene.json')!=scene_raw:
        raise ValueError('Original input bytes changed')
    options={'schema':'brainsnn.asbuilt-evidence-request.v1','sceneSha256':scene_sha,'componentId':component,'reviewed':True}
    photos=run_job(client,'asbuilt-evidence',[(json.dumps(options).encode(),'photos.json','asbuilt')],scene_job['id'])
    evidence=json.loads(payload(client,photos,'asbuilt-photo-evidence.json'))
    # A directly compiled authored cloud has no retained camera capture.
    if evidence['status']!='unavailable' or evidence['frames'] or evidence['sceneSha256']!=scene_sha:
        raise ValueError('Authored cloud unexpectedly supplied photo evidence')
    return {'sourceKind':'authored-point-cloud','sourceJob':scene_job['id'],'updateJob':changed['id'],'photoJob':photos['id'],
      'updatedCount':report['updatedCount'],'sourceSceneSha256':scene_sha,'priorIfcSha256':hashlib.sha256(prior).hexdigest(),'updatedIfcSha256':hashlib.sha256(updated).hexdigest(),
      'originalBytesPreserved':True,'authenticatedSiteProxy':True,'actualSceneCompiler':True,'actualIfcWriter':True,'downloadsHashVerified':True,
      'missingPhotoEvidenceRejected':True,'phoneCaptureExecuted':False,'physicalAccuracyVerified':False,'physicalRobotValidated':False,'elapsedSeconds':round(time.monotonic()-started,2)}

def run_acceptance(path=Path('/data/asbuilt-acceptance.json')):
    commit=os.environ.get('RAILWAY_GIT_COMMIT_SHA','');deployment=os.environ.get('RAILWAY_DEPLOYMENT_ID','')
    if path.is_file():
        previous=json.loads(path.read_text())
        if previous.get('status')=='passed' and previous.get('commitSha')==commit and previous.get('deploymentId')==deployment \
                and re.fullmatch('[a-f0-9]{40}',commit) and re.fullmatch('[a-fA-F0-9-]{36}',deployment):
            print('ASBUILT_HOSTED_ACCEPTANCE '+json.dumps({**previous,'reused':True}),flush=True);return previous
    report={'schema':'brainsnn.hosted-asbuilt-acceptance.v1','runId':str(uuid.uuid4()),'status':'started','startedAt':datetime.now(timezone.utc).isoformat(),
      'deploymentId':deployment if re.fullmatch('[a-fA-F0-9-]{36}',deployment) else None,'commitSha':commit if re.fullmatch('[a-f0-9]{40}',commit) else None}
    path.write_text(json.dumps(report))
    try:report.update(execute(Client()));report['status']='passed'
    except Exception as error:report.update(status='failed',errorType=type(error).__name__)
    report['finishedAt']=datetime.now(timezone.utc).isoformat();pending=path.with_name(path.name+'.tmp');pending.write_text(json.dumps(report,indent=2)+'\n');pending.replace(path)
    print('ASBUILT_HOSTED_ACCEPTANCE '+json.dumps(report),flush=True)
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--confirm-synthetic-deployment-test',action='store_true');a=p.parse_args()
    if not a.confirm_synthetic_deployment_test:raise SystemExit('Explicit deployment test flag required')
    raise SystemExit(0 if run_acceptance()['status']=='passed' else 1)
