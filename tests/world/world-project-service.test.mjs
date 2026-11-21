import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldProjectService } from '../../brainsnn-r3f-app/src/server/worldProjectService.js';
import { canonical } from '../../brainsnn-r3f-app/src/server/worldProjectStore.js';
import { createProjectTestPool } from './helpers/project-test-pool.mjs';

const stamp = Date.parse('2026-11-19T12:00:00Z');
const sha = data => createHash('sha256').update(data).digest('hex');

async function host(service) {
  const server=createServer((req,res)=>service.handle(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/world/v1`;
  return {base,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
async function fixture(options={}) {
  const pool=options.pool||await createProjectTestPool();let clock=stamp;
  const service=createWorldProjectService({pool,env:{},now:()=>clock});await service.initialize();
  const tenant=await service.provisionTenant({name:`Fixture ${randomUUID()}`,...(options.limits?{limits:options.limits}:{})});
  const admin=await service.provisionKey({tenant_id:tenant.id,actor_name:'Provisioned administrator',role:'admin'});
  const editor=await service.provisionKey({tenant_id:tenant.id,actor_name:'Site operator',role:'editor'});
  const reviewer=await service.provisionKey({tenant_id:tenant.id,actor_name:'Separate reviewer',role:'reviewer'});
  const reader=await service.provisionKey({tenant_id:tenant.id,actor_name:'Read only',role:'reader'});
  const web=await host(service);
  async function call(path,{method='GET',body,token=admin.token,key=randomUUID(),headers={}}={}){
    const response=await fetch(web.base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ ...{} }),...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),headers:response.headers};
  }
  return {pool,service,tenant,admin,editor,reviewer,reader,call,web,setTime:value=>{clock=value;},close:async()=>{await web.close();await service.close();if(!options.pool)await pool.end();}};
}
async function createProject(f,title='Measured site') {
  const response=await f.call('/projects',{method:'POST',body:{title,description:'Authored software fixture; no physical run was performed.'},token:f.editor.token});
  assert.equal(response.status,201,JSON.stringify(response.data));return response.data.project;
}
async function source(f,project,text='fixture source') {
  const r=await f.call(`/projects/${project.id}/sources`,{method:'POST',token:f.editor.token,body:{expected_version:project.version,name:'source.txt',media_type:'text/plain',content_text:text,sha256:sha(Buffer.from(text))}});
  assert.equal(r.status,201,JSON.stringify(r.data));return r.data;
}
async function revision(f,project,sourceId,kind='as_is',parent=null){
  const r=await f.call(`/projects/${project.id}/revisions`,{method:'POST',token:f.editor.token,body:{expected_version:project.version,label:kind,kind,source_ids:[sourceId],robot:{model:'Test cleaner',width_m:0.6,margin_m:0.1},task:{kind:'cleaning',goal:'Authored test route'},...(parent?{parent_revision_id:parent}:{})}});
  assert.equal(r.status,201,JSON.stringify(r.data));return r.data;
}
async function evidence(f,project,revisionId,sourceId){
  const r=await f.call(`/projects/${project.id}/evidence`,{method:'POST',token:f.editor.token,body:{expected_version:project.version,revision_id:revisionId,source_id:sourceId,kind:'measured',claim:'Authored clearance observation',value:0.9,unit:'m',locator:{note:'Fixture reference A'},uncertainty:0.02,status:'unreviewed'}});
  assert.equal(r.status,201,JSON.stringify(r.data));return r.data;
}
async function reviewEvidence(f,project,evidenceId,decision='confirmed'){
  const r=await f.call(`/projects/${project.id}/evidence/${evidenceId}/review`,{method:'POST',token:f.reviewer.token,body:{expected_version:project.version,decision,reason:'Reviewed the authored fixture reference.'}});
  assert.equal(r.status,200,JSON.stringify(r.data));return r.data;
}

test('project ledger: retained evidence, independent decisions and exact physical-trial revision survive the full workflow',async()=>{
  const f=await fixture();
  try {
    const status=await f.call('/status',{token:null});assert.equal(status.data.available,true);assert.equal(status.data.physical_validated,false);
    let project=await createProject(f);
    const saved=await source(f,project,'µ exact original bytes\n');project=saved.project;const sourceId=saved.resource.id;
    const a=await revision(f,project,sourceId);project=a.project;const baseline=a.resource.id;
    const p=await revision(f,project,sourceId,'proposed',baseline);project=p.project;const proposed=p.resource.id;
    const e=await evidence(f,project,proposed,sourceId);project=e.project;
    const reviewed=await reviewEvidence(f,project,e.resource.id);project=reviewed.project;
    const earlyTrial=await f.call(`/projects/${project.id}/trials`,{method:'POST',token:f.editor.token,body:{expected_version:project.version,revision_id:proposed,robot_model:'Test cleaner',task:'Authored test route',kind:'physical',outcome:'pass',prediction:'pass',source_ids:[sourceId],measurement_evidence_ids:[e.resource.id],notes:'Authored trial recorded before implementation; cannot verify a later change.',occurred_at:new Date(stamp).toISOString()}});
    assert.equal(earlyTrial.status,201);project=earlyTrial.data.project;
    const change=await f.call(`/projects/${project.id}/changes`,{method:'POST',token:f.editor.token,body:{expected_version:project.version,base_revision_id:baseline,proposed_revision_id:proposed,title:'Widen the planned aisle',reason:'Compare a changed layout.',evidence_ids:[e.resource.id]}});
    assert.equal(change.status,201,JSON.stringify(change.data));project=change.data.project;const changeId=change.data.resource.id;
    const approve=await f.call(`/projects/${project.id}/changes/${changeId}/decisions`,{method:'POST',token:f.reviewer.token,body:{expected_version:project.version,decision:'approve',reason:'Approved the recorded proposal scope.'}});
    assert.equal(approve.status,200,JSON.stringify(approve.data));project=approve.data.project;
    const implemented=await f.call(`/projects/${project.id}/changes/${changeId}/decisions`,{method:'POST',token:f.editor.token,body:{expected_version:project.version,decision:'implemented',reason:'Operator records implementation in fixture.'}});
    assert.equal(implemented.status,200);project=implemented.data.project;
    const tooEarly=await f.call(`/projects/${project.id}/changes/${changeId}/decisions`,{method:'POST',token:f.reviewer.token,body:{expected_version:project.version,decision:'verified',reason:'Earlier test cannot verify later implementation.',trial_id:earlyTrial.data.resource.id}});
    assert.equal(tooEarly.status,409);assert.equal(tooEarly.data.error.code,'post-implementation-trial-required');
    const trialBody={expected_version:project.version,revision_id:proposed,robot_model:'Test cleaner',task:'Authored test route',kind:'simulation',outcome:'pass',prediction:'pass',source_ids:[sourceId],measurement_evidence_ids:[e.resource.id],notes:'Explicitly authored software fixture.',occurred_at:new Date(stamp).toISOString()};
    const simulated=await f.call(`/projects/${project.id}/trials`,{method:'POST',token:f.editor.token,body:trialBody});assert.equal(simulated.status,201);project=simulated.data.project;
    const refused=await f.call(`/projects/${project.id}/changes/${changeId}/decisions`,{method:'POST',token:f.reviewer.token,body:{expected_version:project.version,decision:'verified',reason:'Attempt simulation as physical evidence',trial_id:simulated.data.resource.id}});
    assert.equal(refused.status,409);assert.equal(refused.data.error.code,'physical-trial-required');
    const physical=await f.call(`/projects/${project.id}/trials`,{method:'POST',token:f.editor.token,body:{...trialBody,expected_version:project.version,kind:'physical',notes:'Operator-reported physical outcome; this test supplies authored data, not real physical proof.'}});
    assert.equal(physical.status,201);project=physical.data.project;
    const verified=await f.call(`/projects/${project.id}/changes/${changeId}/decisions`,{method:'POST',token:f.reviewer.token,body:{expected_version:project.version,decision:'verified',reason:'Reviewer records an attestation, not independent certification.',trial_id:physical.data.resource.id}});
    assert.equal(verified.status,200,JSON.stringify(verified.data));project=verified.data.project;
    assert.equal(verified.data.resource.status,'verified');assert.equal(verified.data.resource.physical_validated,false);
    assert.equal(verified.data.resource.decisions.at(-1).actor_id,f.reviewer.key.actor_id);
    assert.equal(project.readiness.certified,false);assert.equal(project.trials.length,3);
    const exported=await f.call(`/projects/${project.id}/export`,{token:f.reader.token});assert.equal(exported.status,200);
    const {integrity,...payload}=exported.data;assert.equal(sha(canonical(payload)),integrity.sha256);assert.equal(integrity.authenticated_signature,false);
    assert.equal(Buffer.from(payload.sources[0].data_base64,'base64').toString('utf8'),'µ exact original bytes\n');
    assert.equal(JSON.stringify(payload).includes(f.admin.token),false);
    f.setTime(stamp+1000);
    const laterFailure=await f.call(`/projects/${project.id}/trials`,{method:'POST',token:f.editor.token,body:{...trialBody,expected_version:project.version,kind:'physical',outcome:'fail',notes:'A later authored physical outcome invalidates the recorded verification.',occurred_at:new Date(stamp+1000).toISOString()}});
    assert.equal(laterFailure.status,201);project=laterFailure.data.project;assert.equal(project.changes[0].status,'stale');
    const fresh=await revision(f,project,sourceId,'as_is');assert.equal(fresh.project.changes[0].status,'stale');
    assert.ok(fresh.project.readiness.blockers.some(x=>x.code==='stale-changes'));
  } finally {await f.close();}
});

test('project ledger: latest physical outcome governs readiness and measured/task/parent contracts cannot be bypassed',async()=>{
  const f=await fixture();
  try{
    let project=await createProject(f);const s=await source(f,project);project=s.project;
    const missingParent=await f.call(`/projects/${project.id}/revisions`,{method:'POST',body:{expected_version:project.version,label:'Unbound proposal',kind:'proposed',source_ids:[s.resource.id],robot:{model:'Test cleaner'},task:{kind:'cleaning',goal:'Authored test route'}}});
    assert.equal(missingParent.status,422);
    const r=await revision(f,project,s.resource.id);project=r.project;
    const nonNumeric=await f.call(`/projects/${project.id}/evidence`,{method:'POST',body:{expected_version:project.version,revision_id:r.resource.id,source_id:s.resource.id,kind:'measured',claim:'Door seems wide',locator:{note:'No actual dimension'}}});
    assert.equal(nonNumeric.status,422);
    const e=await evidence(f,project,r.resource.id,s.resource.id);project=e.project;project=(await reviewEvidence(f,project,e.resource.id)).project;
    const base={expected_version:project.version,revision_id:r.resource.id,robot_model:'Test cleaner',task:'Authored test route',kind:'physical',outcome:'pass',prediction:'pass',source_ids:[s.resource.id],measurement_evidence_ids:[e.resource.id],notes:'Authored recorded result.',occurred_at:new Date(stamp).toISOString()};
    const wrong=await f.call(`/projects/${project.id}/trials`,{method:'POST',body:{...base,task:'A completely different task'}});assert.equal(wrong.status,422);
    const passed=await f.call(`/projects/${project.id}/trials`,{method:'POST',body:base});assert.equal(passed.status,201);project=passed.data.project;assert.equal(project.readiness.state,'trial-recorded');
    for(const [index,outcome] of ['fail','inconclusive'].entries()){
      f.setTime(stamp+(index+1)*1000);
      const result=await f.call(`/projects/${project.id}/trials`,{method:'POST',body:{...base,expected_version:project.version,outcome,occurred_at:new Date(stamp+(index+1)*1000).toISOString()}});
      assert.equal(result.status,201);project=result.data.project;assert.equal(project.readiness.state,'review-required');assert.ok(project.readiness.blockers.some(b=>b.code==='latest-physical-trial-not-passed'));
      assert.equal(project.readiness.latest_physical_trial_id,result.data.resource.id);
    }
    assert.equal(project.trials.length,3);assert.equal(project.trials.filter(t=>t.outcome==='pass').length,1);
  }finally{await f.close();}
});

test('project ledger: credentials cannot cross tenants, elevate roles, approve their own changes or fabricate source bindings',async()=>{
  const f=await fixture();
  try {
    let project=await createProject(f);const saved=await source(f,project);project=saved.project;
    const otherTenant=await f.service.provisionTenant({name:'Other tenant '+randomUUID()});
    const other=await f.service.provisionKey({tenant_id:otherTenant.id,actor_name:'Other admin',role:'admin'});
    assert.equal((await f.call(`/projects/${project.id}`,{token:other.token})).status,404);
    assert.equal((await f.call(`/projects/${project.id}/sources/${saved.resource.id}`,{token:other.token})).status,404);
    const readAttempt=await f.call('/projects',{method:'POST',token:f.reader.token,body:{title:'Forbidden'}});assert.equal(readAttempt.status,403);
    assert.equal((await f.call('/keys',{method:'POST',token:f.editor.token,body:{actor_name:'Escalate',role:'admin'}})).status,403);
    const badScope=await f.call('/keys',{method:'POST',body:{actor_name:'Invalid reader',role:'reader',scopes:['keys:manage']}});assert.equal(badScope.status,422);
    const wrongHash=await f.call(`/projects/${project.id}/sources`,{method:'POST',body:{expected_version:project.version,name:'bad.txt',media_type:'text/plain',content_text:'changed',sha256:'0'.repeat(64)}});
    assert.equal(wrongHash.status,422);assert.equal(wrongHash.data.error.code,'source-hash-mismatch');
    const baseline=await revision(f,project,saved.resource.id);project=baseline.project;
    const proposed=await revision(f,project,saved.resource.id,'proposed',baseline.resource.id);project=proposed.project;
    const ev=await evidence(f,project,proposed.resource.id,saved.resource.id);project=ev.project;
    const reviewed=await reviewEvidence(f,project,ev.resource.id);project=reviewed.project;
    // A reviewer can propose but cannot then review their own proposal.
    const change=await f.call(`/projects/${project.id}/changes`,{method:'POST',token:f.reviewer.token,body:{expected_version:project.version,base_revision_id:baseline.resource.id,proposed_revision_id:proposed.resource.id,title:'Reviewer proposal',reason:'Self-approval regression',evidence_ids:[ev.resource.id]}});
    assert.equal(change.status,201);project=change.data.project;
    const self=await f.call(`/projects/${project.id}/changes/${change.data.resource.id}/decisions`,{method:'POST',token:f.reviewer.token,body:{expected_version:project.version,decision:'approve',reason:'I cannot approve my own change.'}});
    assert.equal(self.status,403);assert.equal(self.data.error.code,'independent-review-required');
    const unknown=await f.call(`/projects/${project.id}/revisions`,{method:'POST',body:{expected_version:project.version,label:'Bad source',kind:'as_is',source_ids:['src_000000000000000000000000'],robot:{model:'Test cleaner'},task:{kind:'test',goal:'test'}}});
    assert.equal(unknown.status,404);assert.equal((await f.call(`/projects/${project.id}`)).data.project.version,project.version);
  } finally {await f.close();}
});

test('project ledger: concurrent idempotent retry creates once, changed input conflicts, and stale mutations roll back',async()=>{
  const f=await fixture();
  try{
    const key=randomUUID(),body={title:'One durable project'};
    const [first,replay]=await Promise.all([f.call('/projects',{method:'POST',body,key}),f.call('/projects',{method:'POST',body,key})]);
    assert.equal(first.status,201);assert.equal(replay.status,201);assert.deepEqual(first.data,replay.data);
    assert.equal([first,replay].filter(r=>r.headers.get('idempotency-replayed')==='true').length,1);
    assert.equal((await f.call('/projects',{method:'POST',body:{title:'Different'},key})).status,409);
    let project=first.data.project;
    const saved=await source(f,project);project=saved.project;
    const laterReplay=await f.call('/projects',{method:'POST',body,key});assert.equal(laterReplay.status,201);
    assert.equal(laterReplay.data.applied_version,1);assert.equal(laterReplay.data.project.version,2);
    const receiptRows=await f.pool.query('SELECT response FROM brainsnn_world_idempotency WHERE tenant_id=$1',[f.tenant.id]);
    assert.ok(receiptRows.rows.every(row=>!row.response.project&&!row.response.sources&&!row.response.events));
    const attempt={expected_version:1,name:'stale.txt',media_type:'text/plain',content_text:'stale'};
    const stale=await f.call(`/projects/${project.id}/sources`,{method:'POST',body:attempt});assert.equal(stale.status,409);
    assert.equal((await f.call(`/projects/${project.id}`)).data.project.sources.length,1);
    const usage=await f.call('/usage');assert.equal(usage.data.usage.projects,1);assert.equal(usage.data.usage.source_bytes,Buffer.byteLength('fixture source'));
    const missingKey=await f.call('/projects',{method:'POST',body:{title:'Missing idempotency'},headers:{'Idempotency-Key':''}});assert.equal(missingKey.status,400);
  }finally{await f.close();}
});

test('project ledger: API key creation never persists plaintext; rotation preserves actor; expiry and revocation fail closed',async()=>{
  const f=await fixture();
  try{
    const key=randomUUID(),body={actor_name:'Named operator',role:'editor',expires_at:new Date(stamp+60000).toISOString()};
    const created=await f.call('/keys',{method:'POST',body,key});assert.equal(created.status,201);assert.match(created.data.token,/^bsk_/);
    const replay=await f.call('/keys',{method:'POST',body,key});assert.equal(replay.status,201);assert.equal(replay.data.token,undefined);assert.equal(replay.data.token_available,false);
    const rows=await f.pool.query('SELECT digest FROM brainsnn_world_keys WHERE tenant_id=$1',[f.tenant.id]);
    assert.ok(rows.rows.every(r=>/^[a-f0-9]{64}$/.test(r.digest)));
    const persisted=await f.pool.query('SELECT response FROM brainsnn_world_idempotency WHERE tenant_id=$1',[f.tenant.id]);
    assert.equal(JSON.stringify(persisted.rows).includes(created.data.token),false);
    assert.equal((await f.call('/me',{token:created.data.token})).data.actor.id,created.data.key.actor_id);
    const rotated=await f.call('/keys',{method:'POST',body:{actor_name:'Named operator',actor_id:created.data.key.actor_id,role:'editor'}});
    assert.equal(rotated.status,201);assert.equal(rotated.data.key.actor_id,created.data.key.actor_id);
    const attemptedRoleChange=await f.call('/keys',{method:'POST',body:{actor_name:'Named operator',actor_id:created.data.key.actor_id,role:'admin'}});assert.equal(attemptedRoleChange.status,422);
    const prototypeRole=await f.call('/keys',{method:'POST',body:{actor_name:'Prototype role',role:'constructor'}});assert.equal(prototypeRole.status,422);
    f.setTime(stamp+61000);assert.equal((await f.call('/me',{token:created.data.token})).status,401);
    const revoked=await f.call(`/keys/${rotated.data.key.id}/revoke`,{method:'POST',body:{}});assert.equal(revoked.status,200);
    assert.equal((await f.call('/me',{token:rotated.data.token})).status,401);
  }finally{await f.close();}
});

test('project ledger: concurrent revisions reject stale writes, failed receipt commit rolls back, narrower keys cannot replay privileged decisions',async()=>{
  const f=await fixture();
  try{
    let project=await createProject(f);
    const sharedBody={expected_version:project.version,name:'race.txt',media_type:'text/plain',content_text:'one concurrent source'};
    const calls=await Promise.all([f.call(`/projects/${project.id}/sources`,{method:'POST',body:sharedBody}),f.call(`/projects/${project.id}/sources`,{method:'POST',body:sharedBody})]);
    assert.deepEqual(calls.map(x=>x.status).sort(),[201,409]);project=calls.find(x=>x.status===201).data.project;
    const oldAddEvent=f.service.store.addEvent;f.service.store.addEvent=async()=>{throw new Error('authored persistence failure, private detail');};
    const idempotency=randomUUID(),pending={expected_version:project.version,name:'rollback.txt',media_type:'text/plain',content_text:'must roll back'};
    const failure=await f.call(`/projects/${project.id}/sources`,{method:'POST',body:pending,key:idempotency});assert.equal(failure.status,503);assert.match(failure.data.error.message,/outcome may be unknown/);assert.equal(JSON.stringify(failure.data).includes('private detail'),false);
    f.service.store.addEvent=oldAddEvent;
    const after=await f.call(`/projects/${project.id}`);assert.equal(after.data.project.version,project.version);assert.equal(after.data.project.sources.length,1);
    const retry=await f.call(`/projects/${project.id}/sources`,{method:'POST',body:pending,key:idempotency});assert.equal(retry.status,201);project=retry.data.project;
    const r=await revision(f,project,project.sources[0].id);project=r.project;
    const e=await evidence(f,project,r.resource.id,project.sources[0].id);project=e.project;
    const decisionKey=randomUUID(),decision={expected_version:project.version,decision:'confirmed',reason:'Reviewed a fixture.'};
    const approved=await f.call(`/projects/${project.id}/evidence/${e.resource.id}/review`,{method:'POST',token:f.reviewer.token,body:decision,key:decisionKey});assert.equal(approved.status,200);
    const narrow=await f.service.provisionKey({tenant_id:f.tenant.id,actor_id:f.reviewer.key.actor_id,actor_name:'Separate reviewer',role:'reviewer',scopes:['project:read']});
    const replay=await f.call(`/projects/${project.id}/evidence/${e.resource.id}/review`,{method:'POST',token:narrow.token,body:decision,key:decisionKey});assert.equal(replay.status,403);
  }finally{await f.close();}
});

test('project ledger: exact sources and authenticated identity reopen after database/service restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'brainsnn-project-pg-'));let pool,web;
  try{
    pool=await createProjectTestPool({directory});const service=createWorldProjectService({pool,env:{},now:()=>stamp});await service.initialize();
    const tenant=await service.provisionTenant({name:'Restart fixture '+randomUUID()});const key=await service.provisionKey({tenant_id:tenant.id,actor_name:'Persistent reviewer',role:'admin'});web=await host(service);
    const call=async(path,body,idempotency=randomUUID())=>{const r=await fetch(web.base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key.token}`,...(body?{'Content-Type':'application/json','Idempotency-Key':idempotency}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
    const p=await call('/projects',{title:'Reopen after restart'});assert.equal(p.status,201);
    const exact=Buffer.from([0,255,1,128,2]);const save=await call(`/projects/${p.data.project.id}/sources`,{expected_version:1,name:'binary.bin',media_type:'application/octet-stream',data_base64:exact.toString('base64')});assert.equal(save.status,201);
    await web.close();web=null;await pool.end();pool=null;
    pool=await createProjectTestPool({directory});const restarted=createWorldProjectService({pool,env:{},now:()=>stamp});await restarted.initialize();web=await host(restarted);
    const restored=await call(`/projects/${p.data.project.id}`);assert.equal(restored.status,200);assert.equal(restored.data.project.version,2);
    const bytes=await call(`/projects/${p.data.project.id}/sources/${save.data.resource.id}`);assert.deepEqual(Buffer.from(bytes.data.data_base64,'base64'),exact);
    assert.equal((await call('/me')).data.actor.id,key.key.actor_id);
    await pool.query('UPDATE brainsnn_world_sources SET data_base64=$4 WHERE tenant_id=$1 AND project_id=$2 AND id=$3',[tenant.id,p.data.project.id,save.data.resource.id,Buffer.from('corrupt').toString('base64')]);
    assert.equal((await call(`/projects/${p.data.project.id}/sources/${save.data.resource.id}`)).status,503);
    const corrupt=await call(`/projects/${p.data.project.id}/export`);assert.equal(corrupt.status,503);assert.equal(corrupt.data.error.code,'source-integrity-failed');
  }finally{if(web)await web.close();if(pool)await pool.end();await rm(directory,{recursive:true,force:true});}
});

test('project ledger: authentication admission stays bounded before PostgreSQL queueing',async()=>{
  const pending=[];
  const pool={query:async sql=>sql.includes('SELECT k.id')?new Promise(resolve=>pending.push(resolve)):{rows:[]},connect:async()=>{throw new Error('Not used by the authentication admission test');}};
  const service=createWorldProjectService({pool,env:{},now:()=>stamp});await service.initialize();
  const req={headers:{authorization:'Bearer bsk_'+Buffer.alloc(32,7).toString('base64url')}};
  const calls=Array.from({length:32},()=>service.authenticate(req).catch(error=>error));
  await assert.rejects(()=>service.authenticate(req),error=>error.status===503&&error.code==='service-busy');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,32);
  pending.forEach(resolve=>resolve({rows:[]}));const errors=await Promise.all(calls);assert.ok(errors.every(e=>e.code==='invalid-api-key'));
});

test('project ledger: unconfigured storage is unavailable, explicit limits reject oversized or unbounded writes',async()=>{
  const unavailable=createWorldProjectService({env:{}}),web=await host(unavailable);
  try{const status=await fetch(web.base+'/status');assert.equal((await status.json()).available,false);const denied=await fetch(web.base+'/projects');assert.equal(denied.status,503);}finally{await web.close();}
  const f=await fixture({limits:{projectSourceBytes:12,sourceBytes:10}});
  try{const p=await createProject(f);const tooLarge=await f.call(`/projects/${p.id}/sources`,{method:'POST',body:{expected_version:p.version,name:'large',media_type:'text/plain',content_text:'12345678901'}});assert.equal(tooLarge.status,413);
    const unknown=await f.call('/projects',{method:'POST',body:{title:'unknown',tenant_id:'forged'}});assert.equal(unknown.status,422);
    assert.equal((await f.call('/projects')).data.projects.length,1);
  }finally{await f.close();}
});

test('project ledger: monthly usage meter counts each workspace separately and exports one row per workspace',async()=>{
  const pool=await createProjectTestPool();
  const a=await fixture({pool}),b=await fixture({pool});
  try {
    for(let i=0;i<3;i++)assert.equal((await a.call('/projects',{token:a.reader.token})).status,200);
    assert.equal((await b.call('/projects',{token:b.reader.token})).status,200);
    // Bridge-reported processing usage.
    await a.service.meterUsage(a.tenant.id,'processing_jobs_started',1);
    await a.service.meterUsage(a.tenant.id,'processing_upload_bytes',4096);
    await a.service.meterUsage(a.tenant.id,'processing_upload_bytes',1024);
    await a.service.meterUsage(a.tenant.id,'processing_artifact_bytes',0);  // nothing to count
    await assert.rejects(()=>a.service.meterUsage(a.tenant.id,'free_lunches',1),/Unknown usage metric/);
    const own=await a.call('/usage',{token:a.reader.token});
    assert.equal(own.status,200);
    assert.equal(own.data.billing.month,'2026-11');
    assert.equal(own.data.billing.period,'calendar month, UTC');
    assert.equal(own.data.billing.api_requests,4,'three list calls and this usage call');
    assert.equal(own.data.billing.processing_jobs_started,1);
    assert.equal(own.data.billing.processing_upload_bytes,5120);
    assert.equal(own.data.billing.processing_artifact_bytes,0);
    const other=await b.call('/usage',{token:b.reader.token});
    assert.equal(other.data.billing.api_requests,2,'workspaces never see each other\'s usage');
    assert.equal(other.data.billing.processing_jobs_started,0);
    const report=await a.service.usageReport('2026-11');
    const row=report.find(r=>r.tenant_id===a.tenant.id);
    assert.deepEqual({...row,tenant_name:undefined},{tenant_id:a.tenant.id,tenant_name:undefined,month:'2026-11',api_requests:4,
      processing_jobs_started:1,processing_upload_bytes:5120,processing_artifact_bytes:0});
    assert.equal(report.find(r=>r.tenant_id===b.tenant.id).api_requests,2);
    assert.deepEqual(await a.service.usageReport('2026-10'),[],'months are kept apart');
    // A new month starts again; the previous month stays exportable.
    a.setTime(Date.parse('2026-12-01T00:00:01Z'));
    assert.equal((await a.call('/usage',{token:a.reader.token})).data.billing.api_requests,1);
    assert.equal((await a.service.usageReport('2026-11')).find(r=>r.tenant_id===a.tenant.id).api_requests,4);
    await assert.rejects(()=>a.service.usageReport('2026-13'),/YYYY-MM/);
  } finally { await a.close(); await b.close(); await pool.end(); }
});
