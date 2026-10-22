import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleWorld,clone,proofPack,planningGate} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {EVIDENCE_LIMITS,geometrySnapshot,geometrySHA256,createGeometryEvidence,addMeasurement,reviewGeometry,
  evidenceBinding,invalidateGeometryEvidence,measurementComparison,exportGeometryEvidence,importGeometryEvidence} from '../../brainsnn-r3f-app/public/world/measurement-evidence.mjs';

const reading=()=>({id:'m-one',label:'Measured floor span',from:[0,0],to:[4,3],distanceMeters:5.02,uncertaintyMeters:.02,method:'laser',instrument:'Handheld meter, serial noted on site',measuredOn:'2026-10-19',note:'Independent reading, fixture only.'});
const review=(target='floor')=>({target,decision:'checked',note:'Human observation, fixture only.',reviewedAt:'2026-10-19T12:00:00.000Z'});
async function populated(world=sampleWorld()){let s=await createGeometryEvidence(world);s=addMeasurement(s,reading(),world);return reviewGeometry(s,review(),world);}

test('binding hashes exact normalized geometry and ignores display names, flags and object ordering',async()=>{
  const w=sampleWorld(),copy=clone(w),original=await geometrySHA256(w);
  copy.name='renamed';copy.scaleReviewed=false;copy.mapReviewed=false;copy.objects.reverse();copy.objects[0].name='new label';copy.objects[0].note='annotation';
  assert.equal(await geometrySHA256(copy),original);
  for(const edit of [x=>x.width++,x=>x.start.x++,x=>x.objects[0].x++,x=>x.objects[0].kind='unknown',x=>x.provenance='observed',x=>x.floor=[[0,0],[18,0],[18,12],[0,13]]]){
    const changed=clone(w);edit(changed);assert.notEqual(await geometrySHA256(changed),original);
  }
  const canonical=geometrySnapshot(w);
  assert.equal(original,Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical)))).toString('hex'));
});

test('readings and decisions are immutable, checkable and cannot change geometry or planning flags',async()=>{
  const w={...sampleWorld(),scaleReviewed:false,mapReviewed:false},before=JSON.stringify(w),empty=await createGeometryEvidence(w),s=addMeasurement(empty,reading(),w);
  const decided=reviewGeometry(s,review('object:storage'),w);
  assert.equal(JSON.stringify(w),before);assert.equal(empty.measurements.length,0);assert.equal(s.reviews.length,0);
  assert.ok(Object.isFrozen(decided.measurements[0].from));assert.throws(()=>decided.measurements.push(reading()));
  assert.deepEqual(measurementComparison(s.measurements[0]),{mapDistanceMeters:5,discrepancyMeters:5.02-5});
  assert.match(planningGate(w),/measured scale/);
  const out=await exportGeometryEvidence(decided,w);assert.equal(out.binding.status,'current');assert.equal(out.authority,'self-reported-unverified');assert.equal(out.metricVerified,false);assert.equal(out.certified,false);
});

test('a geometric mismatch or explicit replacement revokes authority without discarding records',async()=>{
  const w=sampleWorld(),s=await populated(w),changed={...w,start:{x:2,z:2}};
  assert.equal(evidenceBinding(s,changed),'stale');assert.equal(evidenceBinding(s,null),'stale');
  assert.throws(()=>addMeasurement(s,{...reading(),id:'m-two'},changed),/stale/);
  const stale=invalidateGeometryEvidence(s,'map-replaced');assert.equal(evidenceBinding(stale,w),'stale');
  assert.deepEqual(stale.measurements,s.measurements);assert.deepEqual(stale.reviews,s.reviews);
  const out=await exportGeometryEvidence(stale,w);assert.equal(out.binding.reason,'map-replaced');assert.equal(out.binding.status,'stale');
  assert.throws(()=>reviewGeometry(stale,review(),w),/stale/);
});

test('imported evidence retains originals but resets authority even for the identical current map',async()=>{
  const w=sampleWorld(),original=await exportGeometryEvidence(await populated(w),w),imported=await importGeometryEvidence(JSON.stringify(original));
  assert.equal(evidenceBinding(imported,w),'imported');assert.throws(()=>reviewGeometry(imported,review(),w),/imported/);
  const out=await exportGeometryEvidence(imported,w);assert.equal(out.origin,'imported');assert.equal(out.binding.status,'imported');assert.deepEqual(out.measurements,original.measurements);assert.deepEqual(out.reviews,original.reviews);
});

test('bad measurements reject blank methods, forged fields, malformed dates, endpoints and nonfinite readings',async()=>{
  const w=sampleWorld(),s=await createGeometryEvidence(w);
  for(const patch of [{distanceMeters:NaN},{distanceMeters:Infinity},{distanceMeters:0},{distanceMeters:201},{uncertaintyMeters:-1},{uncertaintyMeters:Infinity},{method:'model'},{instrument:''},{label:''},{measuredOn:'2026-02-30'},{measuredOn:'yesterday'},{from:[0]},{from:[-1,0]},{to:[19,0]},{to:[0,0]},{metricVerified:true},{label:'x'.repeat(121)}])assert.throws(()=>addMeasurement(s,{...reading(),...patch},w),JSON.stringify(patch));
});

test('reviews must target exact floor, start or object and a bounded explicit human decision',async()=>{
  const w=sampleWorld();let s=await createGeometryEvidence(w);
  for(const target of ['floor','start','object:unknown-1'])s=reviewGeometry(s,review(target),w);
  assert.equal(s.reviews.length,3);
  s=reviewGeometry(s,{...review('floor'),decision:'needs-work',note:'Boundary missing'},w);
  assert.equal(s.reviews.length,3);assert.equal(s.reviews.find(r=>r.target==='floor').decision,'needs-work');
  for(const patch of [{target:'object:missing'},{decision:'certified'},{reviewedAt:'yesterday'},{reviewedAt:'2026-02-30T12:00:00.000Z'},{note:'x'.repeat(601)},{scaleReviewed:true}])assert.throws(()=>reviewGeometry(s,{...review(),...patch},w));
});

test('record count and duplicate bounds are enforced',async()=>{
  const w=sampleWorld();let s=await createGeometryEvidence(w);
  for(let i=0;i<EVIDENCE_LIMITS.measurements;i++)s=addMeasurement(s,{...reading(),id:'m-'+i},w);
  assert.throws(()=>addMeasurement(s,{...reading(),id:'m-next'},w),/64/);
  const first=addMeasurement(await createGeometryEvidence(w),reading(),w);assert.throws(()=>addMeasurement(first,reading(),w),/unique/);
  await assert.rejects(importGeometryEvidence(' '.repeat(EVIDENCE_LIMITS.bytes+1)),/256/);
});

test('large multilingual records fail before a worksheet becomes unexportable',async()=>{
  const w={...sampleWorld(),objects:Array.from({length:128},(_,i)=>({id:'o-'+i,name:'Object',x:3,z:3,w:.1,d:.1,h:1,kind:'unknown'}))};
  let s=await createGeometryEvidence(w),rejected=false;
  for(let i=0;i<64;i++)s=addMeasurement(s,{...reading(),id:'m-'+i,label:'測'.repeat(120),instrument:'測'.repeat(120),note:'測'.repeat(600)},w);
  for(const object of w.objects){
    try{s=reviewGeometry(s,{...review('object:'+object.id),note:'測'.repeat(600)},w);}
    catch(error){assert.match(error.message,/256 KiB/);rejected=true;break;}
  }
  assert.equal(rejected,true);
  assert.ok(new TextEncoder().encode(JSON.stringify(await exportGeometryEvidence(s,w))).byteLength<=EVIDENCE_LIMITS.bytes);
  assert.ok(new TextEncoder().encode(JSON.stringify(await exportGeometryEvidence(invalidateGeometryEvidence(s),w))).byteLength<=EVIDENCE_LIMITS.bytes);
});

test('imports reject changed snapshot hashes, invented certification, extras and duplicate records',async()=>{
  const w=sampleWorld(),original=await exportGeometryEvidence(await populated(w),w);
  for(const edit of [x=>x.geometry.snapshot.width++,x=>x.geometry.sha256='0'.repeat(64),x=>x.metricVerified=true,x=>x.authority='certified',x=>x.invented='x',x=>x.measurements.push(x.measurements[0]),x=>x.reviews.push(x.reviews[0]),x=>x.binding.currentGeometrySha256='bad',x=>x.measurements[0].distanceMeters='5',x=>x.geometry.snapshot.objects[0].extra='x',x=>x.geometry.snapshot.floor[0].push(3)]){
    const broken=clone(original);edit(broken);await assert.rejects(importGeometryEvidence(JSON.stringify(broken)));
  }
});

test('generated map evidence never bypasses the generated-geometry planning gate',async()=>{
  const w={...sampleWorld(),provenance:'generated'},s=await populated(w),out=await exportGeometryEvidence(s,w);
  assert.equal(out.metricVerified,false);assert.match(planningGate(w),/Generated/);
});

test('proof packs preserve current/stale evidence under the existing integrity hash',async()=>{
  const w=sampleWorld(),s=await populated(w),proof=await proofPack(w,null,{},[],[],[],s);
  assert.equal(proof.geometryEvidence.binding.status,'current');assert.equal(proof.geometryEvidence.measurements[0].distanceMeters,5.02);
  assert.equal(proof.integrity.authenticatesAuthor,false);assert.equal(proof.signature,null);
  const {integrity,...body}=proof;assert.equal(integrity.value,Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)))).toString('hex'));
  const stale=await proofPack({...w,start:{x:2,z:2}},null,{},[],[],[],s);assert.equal(stale.geometryEvidence.binding.status,'stale');
  const missing=await proofPack(null,null,{},[],[],[],s);assert.equal(missing.geometryEvidence.binding.currentGeometrySha256,null);
  assert.equal((await proofPack(w,null,{})).geometryEvidence,undefined);
  await assert.rejects(proofPack(w,null,{},[],[],[],clone(s)),/worksheet/);
});

test('proof inputs are snapshotted before asynchronous geometry hashing',async()=>{
  const w=sampleWorld(),s=await populated(w),result={travelSeconds:60,turns:2,route:[{x:1,z:1}]},assumptions={setupMinutes:1},sources=[{name:'capture.png',size:12,kind:'image',derivation:{job:'original'}}],events=[{type:'original',detail:{note:'before'}}],observations=[{source:{sha256:'a'.repeat(64)}}];
  const pending=proofPack(w,result,assumptions,sources,events,observations,s);
  w.width=20;result.route[0].x=7;assumptions.setupMinutes=100;sources[0].derivation.job='changed';sources.push({name:'later'});events[0].detail.note='changed';events.push({type:'later'});observations[0].source.sha256='b'.repeat(64);
  const proof=await pending;
  assert.equal(proof.world.width,18);assert.equal(proof.result.route[0].x,1);assert.equal(proof.estimate.assumptions.setupMinutes,1);
  assert.equal(proof.sources.length,1);assert.equal(proof.sources[0].derivation.job,'original');assert.deepEqual(proof.events,[{type:'original',detail:{note:'before'}}]);assert.equal(proof.observations[0].source.sha256,'a'.repeat(64));assert.equal(proof.geometryEvidence.binding.status,'current');
});
