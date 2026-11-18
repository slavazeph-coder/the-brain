import test from 'node:test';
import assert from 'node:assert/strict';
import {createLayerJobRunner} from '../../brainsnn-r3f-app/public/world/layer-job-client.mjs';
const id='a'.repeat(32),engine='splat-repair';
const caps={engines:[{id:engine,available:true,max_inputs:2,input_kinds:['splat','repair']}]};
const file=new File(['source'],'original.ply'),inputs=[{file,kind:'splat'},{file:new File(['{}'],'options.json'),kind:'repair'}];
function fixture({status='complete'}={}){
  const calls=[],client={async upload(f,k){calls.push(['upload',f,k]);return 'b'.repeat(32);},async request(path,options={}){calls.push([path,options]);return {id,engine,status:path==='/v1/jobs'?'prepared':status,artifacts:[]};}};
  let saved=null;const runner=createLayerJobRunner({getConnection:()=>({client,caps}),onComplete:(job,c,metadata)=>{saved={job,client:c,metadata};return saved;}});
  return {calls,client,runner,saved:()=>saved};
}
test('tool jobs retain their original client and clone upload identities',async()=>{
  const f=fixture(),result=await f.runner.run({engine,inputs,sourceNames:['original.ply']});
  assert.equal(result.client,f.client);assert.equal(result.job.engine,engine);assert.deepEqual(result.metadata.sourceNames,['original.ply']);
  assert.notEqual(f.calls[0][1],file);assert.equal(f.calls[0][2],'splat');assert.equal(f.calls[1][2],'repair');
  assert.equal(f.calls.find(c=>c[0]==='/v1/jobs')[1].body.consent,true);assert.equal(f.runner.isActive(),false);
});
test('a source-bound job refuses a different client before upload',async()=>{
  const f=fixture();await assert.rejects(f.runner.run({engine,inputs,sourceJob:id,expectedClient:{}}),/original processing session/);assert.equal(f.calls.length,0);
});
test('the execution slot is reserved while connection is resolving',async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;}),f=fixture();
  const runner=createLayerJobRunner({getConnection:async()=>{await waiting;return {client:f.client,caps};},onComplete:()=>{throw Error('cancelled job must not publish');}});
  const run=runner.run({engine,inputs});const observed=assert.rejects(run,{name:'AbortError'});
  assert.equal(runner.isActive(),true);await assert.rejects(runner.run({engine,inputs}),/current tool/);
  const cancelled=runner.cancel();release();await cancelled;await observed;assert.equal(f.calls.length,0);assert.equal(runner.isActive(),false);
});
test('cancelling a started job uses its original client and never publishes it',async()=>{
  const f=fixture({status:'running'});const run=f.runner.run({engine,inputs});const observed=assert.rejects(run,{name:'AbortError'});
  while(!f.calls.some(c=>c[0]===`/v1/jobs/${id}/start`))await new Promise(r=>setImmediate(r));
  await f.runner.cancel();await observed;assert.equal(f.saved(),null);assert.ok(f.calls.some(c=>c[1]?.method==='DELETE'&&c[0]===`/v1/jobs/${id}`));
});
test('a service cannot switch job identifiers or engines during execution',async()=>{
  for(const replacement of [{id:'c'.repeat(32)},{engine:'scene-usd'}]){
    const f=fixture(),request=f.client.request;f.client.request=async(path,o)=>({...await request(path,o),...(path.endsWith('/start')?replacement:{})});
    await assert.rejects(f.runner.run({engine,inputs}),/inconsistent job/);assert.equal(f.saved(),null);
  }
});
test('unavailable engines and wrong input kinds fail before upload',async()=>{
  const f=fixture();await assert.rejects(f.runner.run({engine:'absent',inputs}),/not enabled/);await assert.rejects(f.runner.run({engine,inputs:[{file,kind:'video'}]}),/required files/);assert.equal(f.calls.length,0);
});
