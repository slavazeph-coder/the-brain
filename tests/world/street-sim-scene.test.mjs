import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWorld,createSimulation,pointClear,segmentClear,sweepMove} from '../../brainsnn-r3f-app/public/world/street/sim-core.mjs';

const data=JSON.parse(fs.readFileSync(new URL('../../brainsnn-r3f-app/public/world/street/assets/scene.json',import.meta.url),'utf8'));
const CLEAR={id:'street/movable-barrier',x:-12.79567743393,z:7.74172070813,width:2.2,depth:.65,yaw:.30868030847};
const DETOUR={id:'street/movable-barrier',x:-14.31468535693,z:2.97804408913,width:5,depth:.65,yaw:1.87947663527};
function clearRoute(world,state){assert.equal(state.route.status,'ready',state.route.reason);for(let i=1;i<state.path.length;i++)assert(segmentClear(world,state.path[i-1],state.path[i],{radius:.42,height:.9,maxSlope:Math.tan(20*Math.PI/180),maxStep:.25}));}

test('actual 168-feature Toronto scene has a traversable baseline and robot reaches the saved goal',()=>{
  const world=createWorld(data),sim=createSimulation(world),state=sim.getState();
  assert.equal(world.buildings.length,168);assert.equal(world.navigation.agentRadius,.42);assert.equal(world.navigation.agentHeight,.9);assert.equal(world.navigation.maxSlopeDegrees,20);clearRoute(world,state);
  sim.startRobot();let count=0;while(sim.getState().running&&count<1600){const current=sim.step(.1);assert(pointClear(world,current.robot.position,{radius:.42,height:.9}));count++;}
  const done=sim.getState();assert.equal(done.status,'arrived');assert(Math.hypot(done.robot.position.x-data.goal.x,done.robot.position.z-data.goal.z)<1e-6);assert(done.travelled>40&&done.travelled<60);
});

test('actual clear/detour presets replan differently, preserve source IDs and avoid every runtime collider',()=>{
  const world=createWorld(data),sim=createSimulation(world),clear=sim.setBarrier(CLEAR).state;clearRoute(world,clear);assert.equal(clear.path.length,2);
  const detour=sim.setBarrier(DETOUR).state;clearRoute(world,detour);assert(detour.path.length>=3);assert(detour.route.cost>clear.route.cost+.2);assert.equal(detour.revision,clear.revision+1);assert.equal(detour.barriers[0].id,data.barrier.id);
  sim.startRobot();let count=0;while(sim.getState().running&&count<1600){const state=sim.step(.1);assert(pointClear(world,state.robot.position,{radius:.42,height:.9}));count++;}assert.equal(sim.getState().status,'arrived');
  const reset=sim.reset();assert(Math.abs(reset.barriers[0].x-data.barrier.x)<1e-8);assert(Math.abs(reset.barriers[0].z-data.barrier.z)<1e-8);assert.equal(reset.robot.position.x,data.start.x);
});

test('actual frontage wall blocks a continuous player sweep',()=>{
  const world=createWorld(data),frontage=data.buildings.find(b=>b.id===data.mainBuildingId);assert(frontage);
  let checked=false;
  for(const polygon of frontage.polygons){const ring=polygon.outer;for(let i=0;i<ring.length-1&&!checked;i++){
    const a=ring[i],b=ring[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<3)continue;
    const mid={x:(a[0]+b[0])/2,z:(a[1]+b[1])/2},n={x:-dz/len,z:dx/len};
    for(const sign of[-1,1]){const outside={x:mid.x+sign*n.x*1.1,z:mid.z+sign*n.z*1.1},inside={x:mid.x-sign*n.x*1.1,z:mid.z-sign*n.z*1.1};
      if(!pointClear(world,outside,{radius:.3,height:1.8})||pointClear(world,inside,{radius:.3,height:1.8}))continue;
      const moved=sweepMove(world,outside,{x:inside.x-outside.x,z:inside.z-outside.z},{radius:.3,height:1.8,slide:false});assert(moved.blocked);assert(moved.distance<1.0);assert(pointClear(world,moved.position,{radius:.3,height:1.8}));checked=true;break;
    }
  }}assert(checked,'No accessible frontage edge was checked.');
});
