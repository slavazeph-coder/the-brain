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
  assert.equal(f[1],'Detected: 1 object placed from reviewed detections.');assert.equal(f[3],'Units: metres, from a measured scale.');assert.match(f[4],/^scene\.usda was written/);});
test('missing or malformed scene.json never produces invented counts or scale',()=>{
  for(const bad of [null,undefined,'x',{},{schema:'other'}])assert.deepEqual(sceneFacts(bad),['No valid scene.json came with this scene, so its provenance and scale are unknown. Treat it as a picture only.']);
  const f=sceneFacts(scene({counts:{points:-1,walls:1.5,objects:'3',unknown_cells:NaN},usd:undefined,units:'ft'}));
  assert.deepEqual(f,['Observed: counts not recorded.','Detected: not recorded.','Unknown space: not recorded.','Units: arbitrary reconstruction units. No measured scale, so sizes are relative.','USD status was not recorded.']);
  assert.ok(sceneFacts(scene({units:'m',usd:{written:false,reason:'r'.repeat(5000)}}))[4].length<='No scene.usda. '.length+300);});
