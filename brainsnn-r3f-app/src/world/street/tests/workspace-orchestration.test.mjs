/** Exercise the actual app orchestration with real simulation and a minimal DOM/view. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWorld,createSimulation} from '../../../../public/world/street/sim-core.mjs';

const data=JSON.parse(fs.readFileSync(new URL('../../../../public/world/street/assets/scene.json',import.meta.url),'utf8'));
const source=fs.readFileSync(new URL('../../../../public/world/street/workspace.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const appSource=source.slice(source.indexOf('const $='),source.indexOf('async function init()'));
const clear={x:-12.79567743393,z:7.74172070813,width:2.2,depth:.65,yaw:.30868030847};
function harness(){
  const nodes=new Map(),listeners=new Map(),mockView={updates:[],colliderCalls:0,renderMode:'software',updateObject(id,patch){this.updates.push({id,patch:structuredClone(patch)});},setColliders(value){this.colliderCalls++;this.colliders=structuredClone(value);},setPlayerPose(value){this.player=structuredClone(value);},setRobotPose(value){this.robot=structuredClone(value);},setPath(value){this.path=structuredClone(value);},setCameraMode(value){this.mode=value;},resetCamera(){},select(){},focusObject(){}};
  function node(id){if(!nodes.has(id))nodes.set(id,{id,hidden:false,open:false,value:'',children:[],textContent:'',innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){},close(){this.open=false;},addEventListener(){},remove(){}});return nodes.get(id);}
  const context={createWorld,createSimulation,structuredClone,console,Map,Set,Math,Number,JSON,Date,CSS:{escape:s=>s},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){},matchMedia:()=>({matches:false}),localStorage:{setItem(){},getItem(){return null;}},document:{hidden:false,querySelector:node,querySelectorAll:()=>[],activeElement:{tagName:'DIV'},addEventListener(){},body:{dataset:{}}},addEventListener(type,fn){listeners.set(type,fn);}};
  context.window=context;context.root=context.document;context.surface=context.document.body;context.container={};context.disposed=false;context.active=true;context.importRevision=0;context.effectiveActive=()=>true;context.onStatus=()=>{};context.emitChange=()=>{};context.listen=(_target,type,fn)=>listeners.set(type,fn);context.animationFrame=0;vm.createContext(context);
  const expose=`
globalThis.__app={setup(data,mock){baseline=structuredClone(data);scene=structuredClone(data);objects=new Map(scene.objects.map(o=>[o.id,o]));view=mock;sim=createSimulation(createWorld(scene));look={yaw:Math.atan2(scene.goal.x-scene.start.x,scene.goal.z-scene.start.z),pitch:0};sim.setPlayerPose({yaw:look.yaw});},
  snapshot(){return structuredClone({scene,edits,editRevision,look,simulation:sim.getState()});},get sim(){return sim;},applyEdits,validateEdits,changeBarrier,restoreObject,resetRoute,resetAll,currentManifest,setMode,wireEvents,tick,setLook(v){look={...look,...v};sim.setPlayerPose({yaw:look.yaw});},view};`;
  new vm.Script(appSource+expose,{filename:'actual-app-under-test.mjs'}).runInContext(context);
  context.__app.setup(data,mockView);return{app:context.__app,view:mockView,nodes,fire:(type,event)=>listeners.get(type)?.({...event,composedPath:()=>[context.container]})};
}
const serial=value=>JSON.stringify(value);
const editableColor=data.objects.find(o=>o.editableProperties?.includes('material.color'));

test('batch import rejects current-actor collision before changing an earlier material edit',()=>{
  const{app,view}=harness();app.sim.setPlayerPose({position:{x:clear.x,z:clear.z}});const before=serial(app.snapshot()),updates=view.updates.length;
  const batch={[editableColor.id]:{material:{color:[.1,.2,.3]}},[data.barrier.id]:{transform:{position:[clear.x,99,clear.z],rotation:[0,clear.yaw,0],scale:[1,1,1]}}};
  assert.throws(()=>app.applyEdits(batch),/overlap the player/);assert.equal(serial(app.snapshot()),before);assert.equal(view.updates.length,updates);
});

test('malformed replacement import leaves existing edits and actor state intact',()=>{
  const{app,view}=harness();assert(app.changeBarrier(clear,{silent:true}));const before=serial(app.snapshot()),updates=view.updates.length;
  for(const patch of[{transform:{position:[0,0,0],scale:[2,1,1]}},{geometry:{type:'sphere',dimensions:[2,1,1]}},{madeUpProperty:true}]){
    assert.throws(()=>app.applyEdits({[data.barrier.id]:patch},{replace:true}));assert.equal(serial(app.snapshot()),before);assert.equal(view.updates.length,updates);
  }
});

test('accepted replacement import recomputes barrier height and synchronizes render, sim and collider export',()=>{
  const{app,view}=harness();app.applyEdits({[data.barrier.id]:{transform:{position:[clear.x,999,clear.z],rotation:[0,clear.yaw,0],scale:[1,1,1]},geometry:{type:'box',dimensions:[3,1.2,.7]},material:{color:[.2,.4,.6]}}},{replace:true});
  const manifest=app.currentManifest(),state=app.sim.getState(),barrier=state.barriers[0],object=manifest.objects.find(o=>o.id===data.barrier.id);
  assert.equal(object.transform.position[0],barrier.x);assert.equal(object.transform.position[2],barrier.z);assert.equal(object.transform.position[1],barrier.baseY+barrier.height/2);assert.equal(manifest.barrier.y,object.transform.position[1]);assert.equal(object.geometry.dimensions[0],3);assert.equal(view.colliders.revision,state.revision);assert.equal(view.colliders.barriers[0].x,barrier.x);assert.deepEqual(Array.from(object.material.color),[.2,.4,.6]);assert.equal(manifest.runtime.mode,'kinematic-navigation');
});

test('route reset rejects an edited barrier on the reset spawn without partial reset',()=>{
  const{app,view}=harness();app.sim.setPlayerPose({position:{x:clear.x,z:clear.z}});app.sim.startRobot();for(let i=0;i<30;i++)app.sim.step(.1);app.sim.pauseRobot();
  assert(app.changeBarrier({x:data.start.x,z:data.start.z},{silent:true}));const before=serial(app.snapshot()),updates=view.updates.length;
  assert.equal(app.resetRoute(),false);assert.equal(serial(app.snapshot()),before);assert.equal(view.updates.length,updates);
});

test('accepted route reset preserves current player pose and edited barrier, then refreshes collider revision',()=>{
  const{app,view}=harness();assert(app.changeBarrier(clear,{silent:true}));app.sim.movePlayer({x:1,z:1});app.sim.startRobot();for(let i=0;i<10;i++)app.sim.step(.1);const previous=app.sim.getState(),colliderCalls=view.colliderCalls;
  assert(app.resetRoute());const next=app.sim.getState();assert.deepEqual(next.player.position,previous.player.position);assert.equal(next.robot.position.x,data.start.x);assert.equal(next.robot.position.z,data.start.z);assert.equal(next.barriers[0].x,previous.barriers[0].x);assert(view.colliderCalls>colliderCalls);assert.equal(view.colliders.revision,next.revision);assert(!next.running);
});

test('failed barrier restore keeps geometry edits and appearance instead of discarding the saved change',()=>{
  const{app,view}=harness();assert(app.changeBarrier(clear,{silent:true}));app.sim.setPlayerPose({position:{x:data.barrier.x,z:data.barrier.z}});const before=serial(app.snapshot()),updates=view.updates.length;
  assert.equal(app.restoreObject(data.barrier.id),false);assert.equal(serial(app.snapshot()),before);assert.equal(view.updates.length,updates);
});

test('reset-all keeps camera yaw and walking direction consistent, and retains normalized barrier metadata',()=>{
  const{app,view}=harness();app.changeBarrier(clear,{silent:true});app.setLook({yaw:-1.2,pitch:.4});app.resetAll();const snap=app.snapshot(),heading=Math.atan2(data.goal.x-data.start.x,data.goal.z-data.start.z);
  assert.equal(snap.look.yaw,heading);assert.equal(snap.look.pitch,0);assert.equal(snap.simulation.player.yaw,heading);assert.equal(view.player.yaw,heading);assert.equal(snap.scene.barrier.baseY,snap.simulation.barriers[0].baseY);assert.equal(view.colliders.revision,snap.simulation.revision);assert.equal(Object.keys(snap.edits).length,0);
});

test('capital W moves along the displayed camera heading after reset',()=>{
  const{app,fire}=harness();app.wireEvents();app.resetAll();app.setMode('walk');const before=app.sim.getState().player.position,heading=app.snapshot().look.yaw;
  let prevented=false;fire('keydown',{key:'W',preventDefault(){prevented=true;}});assert(prevented);app.tick(1000);app.tick(1100);fire('keyup',{key:'W'});const after=app.sim.getState().player.position,dx=after.x-before.x,dz=after.z-before.z;
  assert(Math.hypot(dx,dz)>.24);assert(dx*Math.sin(heading)+dz*Math.cos(heading)>.24);assert(Math.abs(dx*Math.cos(heading)-dz*Math.sin(heading))<1e-6);
});
