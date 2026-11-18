import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceResults,sourceJobOptions,shouldOpenCompletedResult} from '../../brainsnn-r3f-app/public/world/workspace-results.mjs';
const job=(n=1)=>({id:n.toString(16).padStart(32,'0'),engine:'scene-usd',status:'complete',created:123,artifacts:[{name:'scene.glb',kind:'visual',size:10,sha256:'a'.repeat(64),url:'must-not-escape'}]});

test('old artifacts retain their original client, immutable manifest and input lineage',()=>{
  const history=createWorkspaceResults(),a={token:'private-a'},b={token:'private-b'},first=job(),record=history.remember(first,a,{sourceIds:['source-a','source-a'],sourceNames:['Room A.png']});
  first.artifacts[0].name='changed.glb';history.remember(job(2),b,{sourceIds:['source-b']});
  assert.equal(history.get(record.key).sourceClient,a);assert.equal(record.job.artifacts[0].name,'scene.glb');
  assert.deepEqual(record.sourceIds,['source-a']);assert.equal(history.find(job(),a),record);assert.equal(history.find(job(),b),null);
  const snapshot=history.list();assert.ok(!JSON.stringify(snapshot).includes('private-'));assert.ok(!JSON.stringify(snapshot).includes('must-not-escape'));
  snapshot[0].sourceIds.push('wrong');snapshot[0].sourceNames[0]='wrong';snapshot[0].artifacts[0].name='wrong';
  assert.deepEqual(history.list()[0].sourceIds,['source-a']);assert.deepEqual(history.list()[0].sourceNames,['Room A.png']);assert.equal(history.list()[0].artifacts[0].name,'scene.glb');
});
test('equal job IDs on different connections cannot overwrite or borrow authority',()=>{
  const history=createWorkspaceResults(),a={},b={},first=history.remember(job(),a),second=history.remember(job(),b);
  assert.notEqual(first.key,second.key);assert.equal(history.remember(job(),a),first);assert.equal(history.list().length,2);
  assert.deepEqual(sourceJobOptions({job:job().id,sourceClient:a},a),{source_job:job().id});
  assert.deepEqual(sourceJobOptions({job:job().id,sourceClient:a},b),{});
  assert.deepEqual(sourceJobOptions({job:'invalid',sourceClient:a},a),{});
  assert.equal(Object.hasOwn(sourceJobOptions({job:job().id,sourceClient:a},a),'nameObjects'),false);
});
test('history eviction and clearing invalidate in-flight context references',()=>{
  const history=createWorkspaceResults({limit:2}),client={},first=history.remember(job(),client),second=history.remember(job(2),client);
  history.remember(job(3),client);assert.equal(history.isCurrent(first),false);assert.equal(history.get(first.key),null);assert.equal(history.isCurrent(second),true);
  history.clear();assert.equal(history.isCurrent(second),false);assert.deepEqual(history.list(),[]);
  assert.throws(()=>history.remember({...job(),status:'running'},client));
});
test('a late completion cannot replace another selected source or map view',()=>{
  const start={sourceId:'source-a',viewRevision:1};
  assert.equal(shouldOpenCompletedResult(start,{...start,street:false}),true);
  assert.equal(shouldOpenCompletedResult(start,{sourceId:'source-b',viewRevision:1}),false);
  assert.equal(shouldOpenCompletedResult(start,{...start,viewRevision:2}),false);
  assert.equal(shouldOpenCompletedResult(start,{...start,street:true}),false);
});
