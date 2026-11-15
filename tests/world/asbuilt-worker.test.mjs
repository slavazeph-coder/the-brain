import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsBuiltJobs,validatePhotoEvidence} from '../../brainsnn-r3f-app/public/world/asbuilt-worker.mjs';
const id='a'.repeat(32),sourceJob='b'.repeat(32);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('closing during job creation retains and cancels the returned server job',async()=>{
 let release,created=false;const calls=[];
 const client={caps:{engines:[{id:'asbuilt-update',available:true}]},upload:async()=>id,request:async(path,options)=>{calls.push([path,options?.method]);if(path==='/v1/jobs'){created=true;return await new Promise(resolve=>release=resolve);}if(options?.method==='DELETE')return {id,status:'cancelled'};throw Error('Cancelled job must not start.');}};
 const jobs=createAsBuiltJobs({client,sourceJob}),pending=jobs.run('asbuilt-update',[{file:{},kind:'ifc'}]);const observed=pending.then(()=>assert.fail('Unexpected success'),e=>e);
 while(!created)await tick();const stopping=jobs.stop();release({id,status:'prepared'});await stopping;const error=await observed;
 assert.equal(error.name,'AbortError');assert.ok(calls.some(([p,m])=>p==='/v1/jobs/'+id&&m==='DELETE'));assert.ok(!calls.some(([p])=>p.endsWith('/start')));
});
test('a source change during create cancels the prepared job instead of executing',async()=>{
 let valid=true;const cancelled=[];
 const client={caps:{engines:[{id:'asbuilt-evidence',available:true}]},upload:async()=>id,request:async(path,options)=>{if(path==='/v1/jobs'){valid=false;return {id,status:'prepared'};}if(options?.method==='DELETE'){cancelled.push(path);return {};}throw Error('Must not execute.');}};
 const jobs=createAsBuiltJobs({client,sourceJob,isCurrent:()=>valid});await assert.rejects(jobs.run('asbuilt-evidence',[{file:{},kind:'asbuilt'}]),/source or review changed/);assert.deepEqual(cancelled,['/v1/jobs/'+id]);
});
test('photo reports require exact component/revision, finite bounds and matching availability',()=>{
 const expected={sceneSha:'c'.repeat(64),componentId:'component',revision:2};
 const report={schema:'brainsnn.asbuilt-photo-evidence.v1',sceneSha256:expected.sceneSha,componentId:'component',componentRevision:2,metricVerified:false,physicalRobotValidated:false,status:'available',frames:[{previewName:'evidence-frame-01.jpg',previewSha256:'d'.repeat(64),originalImageSha256:'e'.repeat(64),ledgerSha256:'f'.repeat(64),normalizedPointBounds:[.1,.2,.8,.9]}]};
 assert.equal(validatePhotoEvidence(report,expected),report);
 for(const patch of [{componentRevision:3},{sceneSha256:'0'.repeat(64)},{metricVerified:true},{status:'unavailable'}])assert.throws(()=>validatePhotoEvidence({...report,...patch},expected));
 assert.throws(()=>validatePhotoEvidence({...report,frames:[{...report.frames[0],normalizedPointBounds:[0,0,NaN,1]}]},expected));
});
