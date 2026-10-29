import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exportSceneUSD } from '../../brainsnn-r3f-app/public/world/street/usd-export.mjs';

const source=JSON.parse(fs.readFileSync(new URL('../../brainsnn-r3f-app/public/world/street/assets/scene.json',import.meta.url),'utf8'));
const baseline=exportSceneUSD(source);

// Extract one balanced USDA prim block, ignoring braces inside quoted metadata.
// This is deliberately a narrow contract check; usd-core is the real parser in
// asset_pipeline/validate_exports.py.
function primBlock(text, header){
  const begin=text.indexOf(header);
  assert.ok(begin>=0,`Missing ${header}`);
  let quote=false,escape=false,depth=0,opened=false;
  for(let i=begin+header.length;i<text.length;i++){
    const c=text[i];
    if(quote){if(escape) escape=false; else if(c==='\\') escape=true; else if(c==='"') quote=false;continue;}
    if(c==='"'){quote=true;continue;}
    // Metadata customData also has braces. A prim's body starts after its
    // optional metadata parentheses; skip metadata depth before first body.
    if(!opened && c==='('){
      let p=1;
      for(i++;i<text.length&&p;i++){
        const d=text[i];
        if(quote){if(escape)escape=false;else if(d==='\\')escape=true;else if(d==='"')quote=false;}
        else if(d==='"')quote=true;
        else if(d==='(')p++;
        else if(d===')')p--;
      }
      i--;continue;
    }
    if(c==='{'){depth++;opened=true;}
    if(c==='}' && --depth===0 && opened) return text.slice(begin,i+1);
  }
  assert.fail(`Unbalanced ${header}`);
}

test('USD declares geographic metre/Y-up convention and all stable object identities',()=>{
  assert.match(baseline,/^#usda 1\.0/);
  assert.match(baseline,/metersPerUnit = 1\b/);
  assert.match(baseline,/upAxis = "Y"/);
  assert.match(baseline,/EPSG:2958/);
  assert.equal((baseline.match(/def Mesh "Mesh"/g)||[]).length,source.objects.length);
  for(const object of source.objects){
    const token=`string stableId = ${JSON.stringify(object.id)}`;
    assert.equal(baseline.split(token).length-1,1,`${object.id} must occur exactly once`);
  }
});

test('USD retains component hierarchy and source labels',()=>{
  const parent=primBlock(baseline,'def Xform "bldg_130159"');
  assert.ok(parent.includes('def Xform "window_001"'));
  assert.ok(parent.includes('def Xform "roof"'));
  assert.ok(!parent.includes('def Xform "bldg_130140"'));
  const window=primBlock(parent,'def Xform "window_001"');
  assert.match(window,/string parentId = "bldg-130159"/);
  assert.match(window,/semantics:labels:class = \["window"\]/);
  assert.match(window,/semantics:labels:source_status = \["authored-assumed"\]/);
});

test('live USD serializes a moved and recolored barrier without mutating its input',()=>{
  const edited=structuredClone(source);
  const barrier=edited.objects.find(o=>o.id===edited.barrier.id);
  barrier.transform.position=[12.25,1.125,-3.5];
  barrier.material.color=[.2,.4,.8];
  const before=JSON.stringify(edited);
  const output=exportSceneUSD(edited);
  const block=primBlock(output,'def Xform "movable_barrier"');
  assert.match(block,/xformOp:translate = \(12\.25, 1\.125, -3\.5\)/);
  assert.match(block,/PhysicsRigidBodyAPI/);
  assert.match(block,/physics:mass = 20\b/);
  const index=edited.objects.indexOf(barrier);
  const material=primBlock(output,`def Material "m_${index}_street_movable_barrier"`);
  assert.match(material,/inputs:diffuseColor = \(0\.2, 0\.4, 0\.8\)/);
  assert.equal(JSON.stringify(edited),before);
});

test('hiding a visual preserves enabled USD collision and the rigid body',()=>{
  const edited=structuredClone(source);
  edited.objects.find(o=>o.id===edited.barrier.id).visible=false;
  const output=exportSceneUSD(edited);
  const block=primBlock(output,'def Xform "movable_barrier"');
  const mesh=primBlock(block,'def Mesh "Mesh"');
  assert.match(mesh,/token visibility = "invisible"/);
  assert.match(mesh,/PhysicsCollisionAPI/);
  assert.match(mesh,/physics:collisionEnabled = true/);
  assert.match(mesh,/physics:approximation = "convexHull"/);
  assert.match(mesh,/material:binding:physics = <\/World\/Materials\/ConfiguredContact>/);
  assert.match(block,/physics:rigidBodyEnabled = true/);
});

test('courtyard building uses the original triangle mesh, never a convex hull',()=>{
  const parent=primBlock(baseline,'def Xform "bldg_130140"');
  const mesh=primBlock(parent,'def Mesh "Mesh"');
  assert.match(mesh,/PhysicsCollisionAPI/);
  assert.match(mesh,/physics:approximation = "none"/);
  assert.doesNotMatch(mesh,/convexHull/);
  const object=source.objects.find(o=>o.id==='bldg-130140');
  const triangleCount=object.geometry.indices.length/3;
  const countText=mesh.match(/int\[\] faceVertexCounts = \[([^\]]+)\]/)[1];
  assert.equal(countText.split(',').length,triangleCount);
  assert.ok(object.metadata.courtyardCount>0);
});
