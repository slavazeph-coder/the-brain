import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256} from '../../brainsnn-r3f-app/public/world/operational-twin.mjs';
import {pointsSHA256} from '../../brainsnn-r3f-app/public/world/dimension-review.mjs';
import {createFacilityReview,presentation,makeReceipt,facilityFrame,FACILITY_VALIDATION} from '../../brainsnn-r3f-app/public/world/facility-review.mjs';
const fixtures=new URL('../../brainsnn-r3f-app/public/world/fixtures/',import.meta.url);
const raw=await readFile(new URL('asbuilt-current.scene.json',fixtures)),scene=JSON.parse(raw),sceneSha=await sha256(raw),cloud=JSON.parse(await readFile(new URL('asbuilt-source.cloud.json',fixtures)));
const review=await createFacilityReview(scene,cloud,sceneSha);
const state=()=>({mode:'overlay',opacity:.35,query:'',kind:'all',selectedId:null,isolate:false,section:{enabled:false,min:review.frame.min[1],max:review.frame.max[1]},replayCount:review.parts.length,bookmarks:[]});

test('review binds original scene bytes, ordered source points and stable identities without mutation',()=>{
  assert.equal(review.binding.sceneSha256,sceneSha);assert.equal(review.binding.sourceSha256,scene.cloudPointsSha256);
  assert.equal(review.pointCount,cloud.points.length);assert.equal(review.parts.length,6);
  assert.ok(Object.isFrozen(review.cloudPoints[0]));assert.equal(JSON.stringify(scene),JSON.stringify(JSON.parse(raw)));
  assert.deepEqual(review.validation,FACILITY_VALIDATION);assert.equal(makeReceipt(review,state()).assembly.executionTimingAvailable,false);
});
test('wrong points, point order, units, frame, graph source and stale identities fail closed',async()=>{
  for(const mutate of [c=>c.points[0][0]+=.001,c=>c.points.reverse(),c=>c.units='ft',c=>c.coordinateFrame='z-up']){
    const c=structuredClone(cloud);mutate(c);await assert.rejects(createFacilityReview(scene,c,sceneSha));
  }
  for(const mutate of [s=>s.cloudPointsSha256='a'.repeat(64),s=>s.componentGraph.sourceSha256='a'.repeat(64),s=>s.componentGraph.components[0].sourceName='stale',s=>s.objects[0].componentId=s.objects[1].componentId]){
    const s=structuredClone(scene);mutate(s);await assert.rejects(createFacilityReview(s,cloud,sceneSha));
  }
});
test('source snapshots cannot be raced or changed after hashing begins',async()=>{
  const s=structuredClone(scene),c=structuredClone(cloud),pending=createFacilityReview(s,c,sceneSha);c.points[0][0]+=1;s.objects[0].label='mutated';
  const r=await pending;assert.deepEqual(r.cloudPoints[0],cloud.points[0]);assert.equal(r.parts.find(p=>p.componentId===scene.objects[0].componentId).label,scene.objects[0].label);
});
test('conflicting scale metadata is refused even with identical ordered points',async()=>{
  const c=structuredClone(cloud);c.scale.metresPerUnit=42;await assert.rejects(createFacilityReview(scene,c,sceneSha),/Scale metadata differs/);
  c.scale=Object.fromEntries(Object.entries(cloud.scale).reverse());assert.equal((await createFacilityReview(scene,c,sceneSha)).pointCount,cloud.points.length);
});
test('enforces original 50000 point budget before rendering',async()=>{
  await assert.rejects(createFacilityReview(scene,{...cloud,points:Array(50001).fill(cloud.points[0])},sceneSha),/50,000/);
});
test('whole-space framing includes points and yaw-rotated proxy extents',()=>{
  const f=facilityFrame([{centre:[10,2,20],size:[4,2,2],yaw:90}],[[100,8,50]]);
  assert.deepEqual(f.min,[9,1,18]);assert.deepEqual(f.max,[100,8,50]);assert.equal(f.span,91);
});
test('search, kind, isolation and completed assembly counts intersect without synthesizing components',()=>{
  const s=state(),id=review.parts[0].componentId;s.replayCount=0;assert.deepEqual(presentation(review,s).visibleIds,[]);
  s.replayCount=review.parts.length;s.selectedId=id;s.isolate=true;assert.deepEqual(presentation(review,s).visibleIds,[id]);
  s.isolate=false;s.kind='wall';assert.deepEqual(presentation(review,s).visibleIds,review.parts.filter(p=>p.kind==='wall').map(p=>p.componentId));
  s.kind='all';s.query=review.parts[0].sourceName;assert.ok(presentation(review,s).visibleIds.includes(id));
});
test('section bounds are original metric source coordinates and do not filter source evidence by proxy ownership',()=>{
  const s=state();s.section={enabled:true,min:.3,max:1.5};const p=presentation(review,s);
  assert.equal(p.clip.min[1],.3);assert.equal(p.clip.max[1],1.5);assert.deepEqual(review.cloudPoints,cloud.points);
  assert.equal(p.mode,'overlay');assert.equal(p.opacity,.35);
});
test('rejects impossible views, stale selections, invalid sections and unbounded receipts',()=>{
  for(const patch of [{selectedId:'missing'},{isolate:true},{opacity:NaN},{mode:'fakeAI'},{replayCount:.5},{replayCount:9999},{query:'x'.repeat(161)},{kind:'pipe'}])assert.throws(()=>presentation(review,{...state(),...patch}));
  for(const section of [{enabled:true,min:2,max:1},{enabled:true,min:-999,max:1}])assert.throws(()=>presentation(review,{...state(),section}));
  assert.throws(()=>makeReceipt(review,{...state(),view:{yaw:0,pitch:0,zoom:0,target:[0,0,0]}}));
  assert.throws(()=>makeReceipt(review,{...state(),bookmarks:Array(13).fill({name:'View',view:{yaw:0,pitch:0,zoom:1,target:[0,0,0]}})}));
});
test('receipt preserves scale metadata and original identities, makes no new validation claim',async()=>{
  const s=state();s.bookmarks=[{name:'Valve context',view:{yaw:.4,pitch:.3,zoom:2,target:[1,1,1]}}];s.view=s.bookmarks[0].view;
  const r=makeReceipt(review,s);assert.deepEqual(r.scale,scene.scale??null);assert.deepEqual(r.validation,FACILITY_VALIDATION);
  assert.deepEqual(r.visibleComponentIds,review.parts.map(p=>p.componentId));assert.equal(r.bookmarks[0].name,'Valve context');
  assert.equal(r.source.sourceSha256,await pointsSHA256(cloud));assert.match(r.scope,/internal fit/);assert.match(r.scope,/robot routes are unchanged/);
});
