import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneFacts,SCENE_SCHEMA} from '../../brainsnn-r3f-app/public/world/scene-preview.mjs';
const scene=(over={})=>({schema:SCENE_SCHEMA,units:'arbitrary',counts:{points:6195,walls:1,objects:0,unplaced:2,unknown_cells:14},usd:{written:false,reason:'Isaac Sim reads USD in metres.'},...over});
test('scene facts come only from scene.json and say what was observed, detected and unknown',()=>{
  const f=sceneFacts(scene());
  assert.equal(f[0],'Observed: 6,195 reconstructed points, the floor and 1 wall.');
  assert.equal(f[1],'Detected: no objects placed, 2 left unplaced.');
  assert.match(f[2],/^Unknown: 14 floor cells .*never free space\.$/);
  assert.match(f[3],/arbitrary reconstruction units/);
  assert.match(f[4],/^No scene\.usda: .*no measured scale\. .*Export static OpenUSD\.$/);});
test('a metric scene with a written USD says so',()=>{const f=sceneFacts(scene({units:'m',counts:{points:10,walls:3,objects:1,unplaced:0,unknown_cells:0},usd:{written:true,metersPerUnit:1}}));
  assert.equal(f[1],'Detected: 1 object placed from 2D detections.');assert.equal(f[3],'Units: metres, from a measured scale.');assert.match(f[4],/^scene\.usda was written/);});
test('missing or malformed scene.json never produces invented counts or scale',()=>{
  for(const bad of [null,undefined,'x',{},{schema:'other'}])assert.deepEqual(sceneFacts(bad),['No valid scene.json came with this scene, so its provenance and scale are unknown. Treat it as a picture only.']);
  const f=sceneFacts(scene({counts:{points:-1,walls:1.5,objects:'3',unknown_cells:NaN},usd:undefined,units:'ft'}));
  assert.deepEqual(f,['Observed: counts not recorded.','Detected: not recorded.','Unknown space: not recorded.','Units: not recorded.','USD status was not recorded.']);
  // An unsupported unit is unknown, so neither the units nor the missing USD are explained as an unmeasured scene.
  assert.deepEqual(sceneFacts(scene({units:'ft',usd:{written:false,reason:'Fixture reason.'}})).slice(3),['Units: not recorded.','No scene.usda. Fixture reason.']);
  assert.ok(sceneFacts(scene({units:'m',usd:{written:false,reason:'r'.repeat(5000)}}))[4].length<='No scene.usda. '.length+300);});
test('a scene scaled by a distance the user measured says it is self-reported',()=>{
  const f=sceneFacts(scene({units:'m',scale:{source:'user-measured',metresPerUnit:.66,distance:3.581,selfReported:true,verified:false},usd:{written:true,metersPerUnit:1}}));
  assert.equal(f[3],'Units: metres, from a distance you measured (3.581 m). Self-reported, not verified.');
  assert.equal(f.length,5,'no IFC line unless scene.json says it was written');
  assert.match(sceneFacts(scene({units:'m',usd:{written:true},ifc:{written:true,schema:'IFC4'}}))[5],/^scene\.ifc was written for BIM tools \(IFC4, metres\)/);
  assert.equal(sceneFacts(scene({ifc:{written:false,reason:'x'}})).length,5);
  assert.equal(sceneFacts(scene({units:'m',scale:{selfReported:true,distance:'3 m'}}))[3],'Units: metres, from a distance you measured. Self-reported, not verified.');});
test('separated objects are counted and the largest are measured, only from scene.json',()=>{
  const objects=[{name:'object_1',label:'object',kind:'separated',size:[3.412,0.731,1.26]},{name:'object_2',label:'chair',kind:'separated',size:[0.5,0.9,0.48]},
    {name:'floor_observed',label:'floor',size:[4,0.02,8]},{name:'object_3',kind:'separated',size:[1,NaN,1]}];
  const f=sceneFacts(scene({units:'m',usd:{written:true},ifc:{written:true},separation:{done:true},counts:{points:10,walls:2,objects:0,unplaced:0,unknown_cells:0,separated:3},objects}));
  assert.equal(f[6],'Separated: 3 objects from the points, each measured as an oriented box in metres. Largest: Object 1: 3.41 × 1.26 m, 0.73 m high; chair: 0.50 × 0.48 m, 0.90 m high.');
  assert.equal(sceneFacts(scene({separation:{done:false,reason:'x'}}))[5],'Separated: none, because object sizes need a measured scale.');
  assert.equal(sceneFacts(scene({units:'m',usd:{written:true},separation:{done:true},counts:{points:1,walls:0,objects:0,unknown_cells:0,separated:0}}))[5],'Separated: no clusters of points stand above the floor apart from walls.');
  assert.equal(sceneFacts(scene()).length,5,'older scenes without separation add no line');});
