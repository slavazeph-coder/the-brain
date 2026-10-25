import test from 'node:test';
import assert from 'node:assert/strict';
import {importWorld} from '../../brainsnn-r3f-app/public/world/import-world.mjs';
import {sampleWorld,normalizeWorld,planWorld,arenaMap,usdScene,ROBOTS} from '../../brainsnn-r3f-app/public/world/core.mjs';
const site=globalThis.BrainSNNSiteCore;
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const concave=[[0,0],[8,0],[8,3],[3,3],[3,8],[0,8]];
const room=floor=>({name:'Captured floor',floors:[{transform:identity,polygonCorners:floor.map(([x,z])=>[x,0,z])}],objects:[],walls:[]});
const reviewed=world=>({...world,scaleReviewed:true,mapReviewed:true});
const robot={...ROBOTS.cleaner,margin:.1};

test('RoomPlan import preserves a concave floor and requires independent review',()=>{
  const input=room(concave),before=JSON.stringify(input),world=importWorld(input,'my-room.json');
  assert.deepEqual(world.floor,concave);
  assert.equal(world.geometrySource.kind,'roomplan');
  assert.equal(world.provenance,'observed');
  assert.equal(world.scaleReviewed,false);assert.equal(world.mapReviewed,false);
  assert.throws(()=>planWorld(world,robot),/measured scale/);
  assert.equal(JSON.stringify(input),before);
  const result=planWorld(reviewed(world),robot),scene=site.normalizeScene({width:8,depth:8,floor:concave,obstacles:[]});
  const radius=Math.hypot(robot.width,robot.depth)/2+robot.margin;
  assert.ok(result.route.length>100);
  for(let i=0;i<result.route.length;i++){
    const p=result.route[i];assert.ok(site.pointClear([p.x,p.z],scene,radius));
    if(i){const a=result.route[i-1];assert.ok(site.segmentClear([a.x,a.z],[p.x,p.z],scene,radius));}
  }
  assert.ok(result.reachableArea<39,'Excluded concavity must not become free bounding-box floor');
});

test('rotated RoomPlan coordinates preserve the real floor and keep outside starts blocked',()=>{
  const angle=Math.PI/4,c=Math.cos(angle),s=Math.sin(angle);
  const input=room([[0,0],[6,0],[6,4],[0,4]]);
  input.floors[0].transform=[c,0,-s,0,0,1,0,0,s,0,c,0,30,2,-15,1];
  const world=importWorld({capturedRoom:input});
  assert.equal(world.floor.length,4);
  assert.ok(Math.abs(site.polygonArea(world.floor)-24)<1e-8);
  assert.ok(world.width*world.depth>24);
  assert.throws(()=>planWorld(reviewed({...world,start:{x:.8,z:.8}}),robot),/start is blocked/);
  const w=reviewed({...world,start:{x:world.width/2,z:world.depth/2}}),result=planWorld(w,robot);
  assert.ok(result.route.length>0);assert.ok(result.reachableArea<24);
});

test('Arena import converts centre boxes to bounds and retains floor and assumptions',()=>{
  const scene=site.normalizeScene({name:'Existing site',width:8,depth:8,floor:concave,scaleConfirmed:true,
    obstacles:[{id:'wall',label:'Thin wall',x:2,z:2,width:.02,depth:1,height:2}],source:{kind:'roomplan',warnings:['Door cut-outs require review.']}});
  const world=importWorld(scene);
  assert.deepEqual(world.floor,concave);
  assert.equal(world.objects[0].x,1.99);assert.ok(Math.abs(world.objects[0].w-.02)<1e-8);
  assert.equal(world.scaleReviewed,false);assert.equal(world.mapReviewed,false);
  assert.ok(world.geometrySource.warnings.some(s=>s.includes('Door cut-outs')));
  const exported=arenaMap(reviewed(world));
  assert.deepEqual(exported.floor,concave);assert.equal(exported.obstacles[0].x,2);
});

test('world round trips retain imported polygons but clear review and reject crossed floors',()=>{
  const original=reviewed(importWorld(room(concave)));
  const imported=importWorld(original);
  assert.deepEqual(imported.floor,concave);assert.equal(imported.scaleReviewed,false);
  assert.throws(()=>normalizeWorld({...original,floor:[[0,0],[8,8],[8,0],[0,8]]}),/cross/);
  assert.throws(()=>normalizeWorld({...original,floor:[[0,0],[9,0],[0,8]]}),/within/);
});

test('OpenUSD rejects nonrectangular floors rather than inventing collision geometry',()=>{
  const world=reviewed(importWorld(room(concave)));
  assert.throws(()=>usdScene(world),/rectangular floors only/);
  assert.deepEqual(arenaMap(world).floor,concave);
  const rectangular=reviewed(importWorld(room([[0,0],[8,0],[8,8],[0,8]])));
  assert.match(usdScene(rectangular),/PhysicsCollisionAPI/);
});

test('unsupported RoomPlan data remains an error and generated maps remain unplannable',()=>{
  assert.throws(()=>importWorld({floors:[]}),/one RoomPlan floor/);
  const slope=room(concave);slope.floors[0].polygonCorners[0][1]=.2;
  assert.throws(()=>importWorld(slope),/level floors/);
  const generated=importWorld({...sampleWorld(),provenance:'generated'});
  assert.throws(()=>planWorld(reviewed(generated),robot),/Generated/);
  const arenaGenerated=importWorld({...site.sampleScene(),source:{kind:'generated'}});
  assert.throws(()=>planWorld(reviewed(arenaGenerated),robot),/Generated/);
});
