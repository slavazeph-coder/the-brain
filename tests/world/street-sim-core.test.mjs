import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,pointClear,segmentClear,sweepMove,terrainHeight,findPath,setBarrier,createSimulation,colliderSnapshot,SIM_MODE} from '../../brainsnn-r3f-app/public/world/street/sim-core.mjs';

const rectangle=(id,x0,z0,x1,z1,holes=[])=>({id,baseY:0,height:10,polygons:[{outer:[[x0,z0],[x1,z0],[x1,z1],[x0,z1]],holes}]});
const base=(extra={})=>({bounds:{minX:-15,maxX:15,minZ:-15,maxZ:15},buildings:[],start:{x:-8,z:0},goal:{x:8,z:0},...extra});
const close=(a,b,tol=1e-6)=>assert(Math.abs(a-b)<tol,`${a} != ${b}`);
function validPath(world,result,radius=.42){assert.equal(result.status,'ready',result.reason);for(let i=1;i<result.points.length;i++)assert(segmentClear(world,result.points[i-1],result.points[i],{radius}),`Segment ${i} is blocked.`);}

test('a real polygon obstacle changes the route, with continuous radius-clear segments',()=>{
  const world=createWorld(base({buildings:[rectangle('long-wall',-1,-6,1,6)]}));
  const route=findPath(world,world.navigation.start,world.navigation.goal);
  validPath(world,route);assert(route.cost>18);assert(route.points.some(p=>Math.abs(p.z)>6.42));
  close(route.points[0].x,-8);close(route.points.at(-1).x,8);
});

test('courtyard holes remain traversable, while their enclosing walls remain solid',()=>{
  const world=createWorld(base({buildings:[rectangle('courtyard',-6,-6,6,6,[[[-3,-3],[3,-3],[3,3],[-3,3]]])]}));
  assert(pointClear(world,{x:0,z:0},.42));assert(!pointClear(world,{x:4,z:0},.42));
  assert(!pointClear(world,{x:2.7,z:0},.42));
  validPath(world,findPath(world,{x:-2,z:0},{x:2,z:0}));
  assert(!segmentClear(world,{x:0,z:0},{x:8,z:0}));
  const result=findPath(world,{x:0,z:0},{x:8,z:0},{maxExpanded:12000});assert.equal(result.status,'unreachable');
});

test('actor radius determines whether a narrow passage fits',()=>{
  const world=createWorld(base({buildings:[rectangle('left',-8,-6,-.4,6),rectangle('right',.4,-6,8,6)]}));
  assert(pointClear(world,{x:0,z:0},.39));assert(!pointClear(world,{x:0,z:0},.41));
  assert(segmentClear(world,{x:0,z:-8},{x:0,z:8},{radius:.39}));
  assert(!segmentClear(world,{x:0,z:-8},{x:0,z:8},{radius:.41}));
});

test('swept player movement cannot tunnel through a thin wall or a rotated barrier',()=>{
  const world=createWorld(base({buildings:[rectangle('thin-wall',0,-8,.025,8)]}));
  const moved=sweepMove(world,{x:-4,z:0},{x:12,z:0},{radius:.3});
  assert(moved.blocked);assert(moved.position.x<-.3);assert(moved.position.x>-.301);assert(pointClear(world,moved.position,.3));
  const rotated=createWorld(base({barrier:{id:'barrier',x:0,z:0,width:6,depth:.08,height:1,yaw:Math.PI/4}}));
  const across=sweepMove(rotated,{x:-4,z:-4},{x:8,z:8},{radius:.3,slide:false});
  assert(across.blocked);assert(across.distance<Math.sqrt(32));assert(pointClear(rotated,across.position,.3));
});

test('wall sliding advances tangentially but never crosses the footprint',()=>{
  const world=createWorld(base({buildings:[rectangle('wall',0,-10,.1,10)]}));
  const moved=sweepMove(world,{x:-2,z:-2},{x:4,z:4},{radius:.3});
  assert(moved.blocked);assert(moved.position.x<-.3);close(moved.position.z,2);assert(pointClear(world,moved.position,.3));
});

test('moving a barrier replans to a different clear route and robot actually reaches its goal',()=>{
  const scene=base({barrier:{id:'barrier-1',x:0,z:6,width:5,depth:.6,height:1,yaw:0}}),world=createWorld(scene),sim=createSimulation(world,{robotSpeed:3});
  const first=sim.getState();close(first.route.cost,16);assert.equal(first.mode,SIM_MODE);
  sim.startRobot();for(let i=0;i<8;i++)sim.step(.05);
  const edited=sim.setBarrier({id:'barrier-1',x:0,z:0,expectedRevision:0});assert(edited.changed);assert.equal(world.revision,1);
  const second=sim.getState();assert(second.running);assert(second.replans>first.replans);assert.equal(second.routeRevision,1);assert(second.path.some(p=>Math.abs(p.z)>.7));
  validPath(world,{status:'ready',points:second.path});
  for(let i=0;i<1000&&sim.getState().running;i++){const state=sim.step(.05);assert(pointClear(world,state.robot.position,state.robot.radius));}
  const done=sim.getState();assert.equal(done.status,'arrived');close(done.robot.position.x,8);close(done.robot.position.z,0);assert(done.travelled>14);assert(!done.blocked);
});

test('a barrier that seals the whole corridor reports unreachable and stops the robot',()=>{
  const world=createWorld(base({bounds:{minX:-10,maxX:10,minZ:-2,maxZ:2},barrier:{id:'gate',x:0,z:0,width:.3,depth:4,height:1,yaw:0}}));
  const sim=createSimulation(world,{cellSize:.4});const state=sim.startRobot();assert.equal(state.status,'unreachable');assert(state.blocked);assert(!state.running);
  const before=state.robot.position;sim.step(.2);assert.deepEqual(sim.getState().robot.position,before);
});

test('terrain is bilinear; unknown cells and excessive slopes are blocked',()=>{
  const grid={originX:0,originZ:0,cellSize:2,width:2,height:2,heights:[0,1,2,3]};
  const world=createWorld(base({bounds:{minX:0,maxX:2,minZ:0,maxZ:2},terrain:grid,start:{x:.4,z:.4},goal:{x:.4,z:1.6}}));
  close(terrainHeight(world,1,1),1.5);assert.equal(terrainHeight(world,-1,0),null);
  assert(!segmentClear(world,{x:.4,z:.4},{x:.4,z:1.6},{radius:.1,maxSlope:.65}));
  assert(segmentClear(world,{x:.4,z:.4},{x:.4,z:1.6},{radius:.1,maxSlope:2}));
  const missing=createWorld(base({terrain:{...grid,heights:[0,null,0,0]}}));assert.equal(terrainHeight(missing,1,1),null);assert(!pointClear(missing,{x:1,z:1},.1));
});

test('short obstacles can be cleared only when terrain actually places the actor above them',()=>{
  const world=createWorld(base({terrain:{kind:'flat',height:3},buildings:[{...rectangle('low-roof',-2,-2,2,2),height:2}]}));
  assert(pointClear(world,{x:0,z:0},.3));
  const ground=createWorld(base({buildings:[{...rectangle('low-roof',-2,-2,2,2),height:2}]}));assert(!pointClear(ground,{x:0,z:0},.3));
});

test('malformed or stale edits are rejected atomically, including transform validation',()=>{
  const world=createWorld(base({barrier:{id:'barrier',x:0,z:6,width:2,depth:.6,height:1,yaw:0}})),before=JSON.stringify(colliderSnapshot(world));
  for(const edit of[{id:'barrier',x:NaN},{id:'barrier',width:-1},{id:'unknown',x:0},{id:'barrier',secret:1},{id:'barrier',x:1000},{id:'barrier',expectedRevision:8,x:1},{id:'barrier',transform:{rotation:[1,0,0]}},{id:'barrier',transform:{scale:[2,1,1]}}]){
    assert.throws(()=>setBarrier(world,edit));assert.equal(world.revision,0);assert.equal(JSON.stringify(colliderSnapshot(world)),before);
  }
  const ok=setBarrier(world,{id:'barrier',transform:{position:[1,99,4],rotation:[0,.3,0],scale:[1,1,1]}});assert.equal(ok.revision,1);close(ok.barrier.baseY,0);close(ok.barrier.yaw,.3);
});

test('reset restores baseline geometry and poses, preserves IDs and advances revision',()=>{
  const input=base({barrier:{id:'persisted-barrier',x:0,z:5,width:2,depth:1,height:1,yaw:0}}),raw=JSON.stringify(input),world=createWorld(input),sim=createSimulation(world);
  sim.setBarrier({id:'persisted-barrier',x:2,z:3});sim.movePlayer({x:1,z:0});sim.startRobot();sim.step(.1);
  const before=sim.getState().revision,reset=sim.reset();assert.equal(reset.revision,before+1);assert.equal(reset.barriers[0].id,'persisted-barrier');close(reset.barriers[0].x,0);close(reset.barriers[0].z,5);close(reset.player.position.x,-8);close(reset.robot.position.x,-8);assert(!reset.running);assert.equal(JSON.stringify(input),raw);
  const noChange=sim.setBarrier({id:'persisted-barrier',x:0,z:5});assert(!noChange.changed);assert.equal(noChange.revision,reset.revision);
});

test('pause is stable and blocked goal never produces a fake arrived state',()=>{
  const world=createWorld(base({buildings:[rectangle('building',1,-2,3,2)]})),sim=createSimulation(world);
  sim.startRobot();sim.step(.1);sim.pauseRobot();const p=sim.getState().robot.position;for(let i=0;i<10;i++)sim.step(.1);assert.deepEqual(sim.getState().robot.position,p);
  const state=sim.setGoal({x:2,z:0});assert.equal(state.status,'blocked-goal');assert(state.blocked);assert.equal(state.path.length,0);assert(!sim.startRobot().running);
});

test('building and actor overlap edits fail before geometry or route revisions change',()=>{
  const world=createWorld(base({buildings:[rectangle('building',-1,-1,1,1)],barrier:{id:'barrier',x:0,z:6,width:2,depth:.6,height:1,yaw:0}})),sim=createSimulation(world,{playerStart:{x:-8,z:2}});
  const before=sim.getState();
  for(const edit of[{id:'barrier',x:0,z:0},{id:'barrier',x:-8,z:0},{id:'barrier',x:-8,z:2}]){
    assert.throws(()=>sim.setBarrier(edit),/overlap/);assert.equal(world.revision,0);assert.deepEqual(sim.getState(),before);
  }
});

test('declared tree-trunk proxies and box steps participate in actual runtime collisions',()=>{
  const world=createWorld(base({navigationObstacles:[{id:'tree/trunk',x:0,z:4,width:.25,depth:.25,height:2.2,baseY:0,yaw:0}],objects:[{id:'authored-step',geometry:{type:'box',dimensions:[1.5,.2,1]},transform:{position:[0,.1,-4],rotation:[0,.4,0],scale:[1,1,1]},collider:{enabled:true,type:'triangle-mesh'}}]}));
  assert.equal(world.obstacles.length,2);assert(!pointClear(world,{x:0,z:4},.3));assert(!pointClear(world,{x:0,z:-4},.3));
  assert(!segmentClear(world,{x:-2,z:4},{x:2,z:4},{radius:.3}));assert.equal(colliderSnapshot(world).obstacles.length,2);
});

test('source nav radius and terrain limits drive the route, rather than hidden defaults',()=>{
  const world=createWorld(base({buildings:[rectangle('left',-8,-6,-.4,6),rectangle('right',.4,-6,8,6)],start:{x:0,z:0},goal:{x:0,z:10},nav:{agentRadius:.5,agentHeight:1.1,maxSlopeDegrees:20,maxStepHeight:.2,cellSize:.4,playerRadius:.28}}));
  const sim=createSimulation(world);assert.equal(sim.getState().robot.radius,.5);assert.equal(sim.getState().player.radius,.28);assert.equal(sim.getState().status,'blocked-start');assert.equal(world.navigation.cellSize,.4);
});
