import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readIfcPrior} from '../../brainsnn-r3f-app/src/world/ifc-prior.js';
import {sha256,currentInventory,identityPairs,compareModels,reviewRequest,footprintHull,registeredBounds,registrationMatrix} from '../../brainsnn-r3f-app/public/world/asbuilt-core.mjs';
import {scoreReference} from '../../brainsnn-r3f-app/public/world/asbuilt-benchmark.mjs';
const require=createRequire(new URL('../../brainsnn-r3f-app/package.json',import.meta.url)),WebIFC=require('web-ifc');
const fixture=new URL('../../brainsnn-r3f-app/public/world/fixtures/',import.meta.url),rawScene=readFileSync(new URL('asbuilt-current.scene.json',fixture)),scene=JSON.parse(rawScene),sceneSha=await sha256(rawScene),rawIfc=new Uint8Array(readFileSync(new URL('asbuilt-prior.ifc',fixture)));
const prior=await readIfcPrior(rawIfc,null,{api:new WebIFC.IfcAPI()}),current=currentInventory(scene,sceneSha),pairs=identityPairs(prior,current),registration={method:'operator-reviewed-same-frame',translationMeters:[0,0,0],yawDegrees:0,reviewed:true,note:'Authored fixture common frame.'};
const compare=(over={})=>compareModels(prior,scene,sceneSha,{registration,pairs,...over});
const chair=prior.elements.find(e=>e.name==='chair'),brief={targets:'Furniture placement',intendedUse:'Coordination draft',accuracyTargetMeters:.05,detail:'observed-component-proxies'};
const awaitSha=await sha256(rawIfc);

test('real pinned IFC reader retains units, GUIDs, component IDs and source byte digest',()=>{
  assert.equal(prior.elements.length,6);assert.equal(prior.nativeLengthScale,1);assert.equal(prior.sourceSha256,awaitSha);assert.equal(prior.skipped.length,0);assert.equal(pairs.length,6);assert.equal(prior.elements.filter(e=>e.ifcClass==='IfcFurniture').length,3);
  assert.ok(prior.elements.every(e=>e.footprintXZ.length>=3));
});
test('outdated position is distinguished from incompatible geometry and unpaired observations',()=>{
  const report=compare(),move=report.rows.find(r=>r.priorGlobalId===chair.globalId),bad=report.rows.find(r=>r.prior.name==='cabinet');
  assert.ok(Math.abs(move.distanceMeters-.7)<1e-5);assert.equal(move.eligible,true);assert.equal(move.status,'position-differs');assert.equal(bad.status,'bounds-differ');assert.equal(bad.eligible,false);
  assert.equal(report.metricVerified,false);assert.equal(compare({pairs:[]}).summary.priorUnmatched,6);assert.match(compare({pairs:[]}).rows[0].reason,/Removal is unproven/);
  assert.equal(compare().rows.find(r=>r.prior.ifcClass==='IfcSlab').eligible,false);
});
test('export requires explicit identity/frame review and preserves the original scene',()=>{
  const before=JSON.stringify(scene);assert.throws(()=>reviewRequest(prior,scene,sceneSha,{registration,pairs,selected:[chair.globalId],brief}),/explicitly reviewed/);
  const reviewed=pairs.map(p=>({...p,reviewed:true})),request=reviewRequest(prior,scene,sceneSha,{registration,pairs:reviewed,selected:[chair.globalId],brief});
  assert.equal(request.source.priorIfcSha256,prior.sourceSha256);assert.equal(request.source.currentSceneSha256,sceneSha);assert.deepEqual(request.selectedTranslations,[chair.globalId]);assert.equal(JSON.stringify(scene),before);
  assert.throws(()=>reviewRequest(prior,scene,sceneSha,{registration:{...registration,reviewed:false},pairs:reviewed,selected:[chair.globalId],brief}),/alignment/);
});
test('duplicate, stale, scale fitting, nonfinite and over-budget updates are refused',()=>{
  assert.throws(()=>compare({pairs:[...pairs,pairs[0]]}),/one to one/);
  assert.throws(()=>compare({pairs:[{priorGlobalId:'missing',currentComponentId:current[0].componentId,reviewed:true}]}),/missing component/);
  assert.throws(()=>compare({registration:{...registration,translationMeters:[NaN,0,0]}}),/finite/);
  assert.throws(()=>compare({registration:{...registration,yawDegrees:10}}),/Same-frame/);
  assert.throws(()=>compare({maxTranslationMeters:100}),/finite/);
  assert.throws(()=>compareModels(prior,{...scene,units:'arbitrary'},sceneSha,{registration,pairs}),/metric compiler/);
});
test('a convex footprint preserves tight bounds after a rotated frame change',()=>{
  const hull=footprintHull([[0,0],[2,0],[2,1],[0,1],[1,.5],[2,0]]);assert.equal(hull.length,4);
  const m=registrationMatrix({method:'operator-entered-rigid',translationMeters:[3,2,-4],yawDegrees:90,reviewed:true,note:'Authored transform'}),b=registeredBounds({min:[0,0,0],max:[2,1,1],footprintXZ:hull},m);
  assert.ok(Math.abs(b.min[0]-2)<1e-9&&Math.abs(b.max[0]-3)<1e-9);assert.deepEqual([b.min[1],b.max[1]],[2,3]);assert.ok(Math.abs(b.min[2]+4)<1e-9&&Math.abs(b.max[2]+2)<1e-9);
});
function reference(){return {schema:'brainsnn.component-reference.v1',units:'m',coordinateFrame:'right-handed-y-up',sceneSha256:sceneSha,frameReviewed:true,origin:'synthetic-fixture',method:'Authored test coordinates',instrument:'Software fixture, not a survey',measuredOn:'2026-11-14',usedForModeling:false,usedForRegistration:false,isPriorModel:false,derivedFromSha256:null,sourceSha256:'f'.repeat(64),toleranceMeters:.2,components:current.map((c,i)=>({id:'ref-'+i,class:c.floor?'floor':c.kind==='wall'?'wall':c.label,centreMeters:c.centre.map((n,j)=>n+(c.label==='chair'&&j===0?1:0)),positionMode:c.floor?'exclude':'horizontal',uncertaintyMeters:0}))};}
test('recognition can be perfect while position fails; floor is excluded from position statistics',()=>{
  const r=scoreReference(scene,sceneSha,reference(),'e'.repeat(64));assert.equal(r.detection.recall,1);assert.equal(r.detection.precision,1);assert.equal(r.position.referenceCount,5);assert.equal(r.position.withinToleranceCount,4);assert.equal(r.position.withinToleranceRecall,.8);assert.equal(r.position.medianErrorMeters,0);assert.equal(r.metricVerified,false);assert.match(r.scope,/Authored fixture/);
});
test('class-conditioned assignment has no distance cutoff and is globally one to one',()=>{
  const ref=reference();ref.components=ref.components.filter(r=>r.class==='wall');ref.components[0].centreMeters=[100,0,100];
  const report=scoreReference(scene,sceneSha,ref,'e'.repeat(64));assert.equal(report.detection.truePositives,2);assert.equal(report.detection.falsePositives,4);assert.ok(report.matches.some(m=>m.positionErrorMeters>100));assert.equal(new Set(report.matches.map(m=>m.predictionId)).size,2);
});
test('modeling, prior, registration and source leakage are rejected before any reference scores',()=>{
  for(const patch of [{usedForModeling:true},{usedForRegistration:true},{isPriorModel:true},{derivedFromSha256:sceneSha},{sourceSha256:scene.componentGraph.sourceSha256},{sceneSha256:'b'.repeat(64)},{frameReviewed:false}])assert.throws(()=>scoreReference(scene,sceneSha,{...reference(),...patch},'e'.repeat(64)));
  assert.throws(()=>scoreReference(scene,sceneSha,{...reference(),sourceSha256:prior.sourceSha256},'e'.repeat(64),{priorIfcSha256:prior.sourceSha256}),/leakage/);
});
