import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createRobotCapability} from '../../brainsnn-r3f-app/public/world/robot-capability.mjs';
import {buildShowroomEpisodeScene,runShowroomEpisode} from '../../brainsnn-r3f-app/public/world/showroom-episode-physics.mjs';
import {makeRobotCapabilityMJCF,runRobotCapabilityEpisode,capabilityActuatorLimits} from '../../brainsnn-r3f-app/public/world/robot-capability-physics.mjs';
import {makeShowroomEpisodeUSD} from '../../brainsnn-r3f-app/public/world/showroom-episode-usd.mjs';
import {buildReviewedMapEpisodeScene} from '../../brainsnn-r3f-app/public/world/reviewed-map-episode.mjs';
import {sampleWorld} from '../../brainsnn-r3f-app/public/world/core.mjs';

const req=createRequire(new URL('../../brainsnn-r3f-app/package.json',import.meta.url));
const {default:init}=await import(pathToFileURL(req.resolve('@mujoco/mujoco')));
const mj=await init();
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const profile=(driveKind='differential')=>createRobotCapability({id:'test-cart',name:'Test cart',width:.35,depth:.4,speed:.5,margin:.1,driveKind});
function scene(p=profile(),points=[[1,2],[4,2]]) {
  return buildShowroomEpisodeScene({title:'Native capability test',provenance:'Authored test geometry',bounds:[0,0,6,5],objects:[],unknown:[],routes:{objectId:null,before:{points}}},{robotCapability:p});
}

test('native differential model uses the selected box and free chassis with driven wheels, then reaches a straight target without sideways motion',async()=>{
  const p=profile(),s=scene(p),xml=makeRobotCapabilityMJCF(s),e=await runRobotCapabilityEpisode(mj,s,{maxSeconds:15});
  assert.match(xml,/<freejoint name="base_free"/);
  assert.match(xml,/<joint name="left_axle" type="hinge"/);
  assert.doesNotMatch(xml,/<joint[^>]+type="slide"/);
  const model=mj.MjModel.from_xml_string(xml),body=model.geom('robot_body');
  try {near(body.size[0],p.body.depth/2);near(body.size[1],p.body.width/2);assert.equal(model.nu,2);assert.equal(model.nq,9);} finally {body.delete();model.delete();}
  assert.equal(e.schema,'brainsnn.robot-capability-episode.v2');
  assert.equal(e.score.reason,'goal-reached');assert.equal(e.engine.name,'MuJoCo');
  assert.ok(e.frames.every(f=>Math.abs(f.position[1]-2)<.001));
  assert.ok(e.frames.at(-1).wheelPositionRad.every(v=>v>20));
  assert.ok(e.frames.some(f=>f.wheelTorqueNm.some(v=>Math.abs(v)>.05)));
  assert.ok(e.frames.every(f=>f.wheelTorqueNm.every(v=>Math.abs(v)<=e.actuatorLimits.wheelTorqueNm+1e-8)));
  assert.equal(e.frames.at(-1).action,null);assert.equal(e.provenance.physicalValidated,false);
  assert.equal(e.frames[0].frameId,'map');assert.equal(e.frames[0].childFrameId,'base_link');
  near(e.frames[0].positionXYZ[1],-2);assert.ok(e.frames[0].positionXYZ[2]>0);
  assert.deepEqual(e.robotCapability,p);assert.match(e.capabilitySha256,/^[a-f0-9]{64}$/);
  const usd=makeShowroomEpisodeUSD(e);assert.match(usd,/def Cube "Body"/);assert.match(usd,/quatf xformOp:orient.timeSamples/);assert.match(usd,/kinematic replay/);
});

test('both controller choices negotiate an actual wheeled right-angle turn and MPPI is deterministic',async()=>{
  const s=scene(profile(),[[1,2],[2.5,2],[2.5,3.5]]);
  for(const controller of ['waypoint','mppi']) {
    const e=await runRobotCapabilityEpisode(mj,s,{controller,maxSeconds:20});
    assert.equal(e.score.reason,'goal-reached');assert.deepEqual(e.score.contactNames,[]);
    assert.equal(e.provenance.controllerKind,controller);
    assert.ok(e.frames.some(f=>Math.abs(f.headingRad)>1.4));
    if(controller==='mppi') {
      assert.ok(e.controller.samples>=8);
      assert.deepEqual(e,await runRobotCapabilityEpisode(mj,s,{controller,maxSeconds:20}));
    }
  }
});

test('the default cleaning footprint and supplied motor can execute the actual sample-map grid route',async()=>{
  const p=createRobotCapability({width:.58,depth:.68,speed:.35,margin:.1});
  p.motor={voltageV:24,currentLimitA:5,torqueConstantNmPerA:.1,resistanceOhm:1,gearRatio:10,efficiency:.8,backEmfVPerRadPerSecond:.1,noLoadCurrentA:.2};
  const s=buildReviewedMapEpisodeScene(sampleWorld(),{x:2.2,z:1},null,p);
  for(const controller of ['waypoint','mppi']) {
    const e=await runRobotCapabilityEpisode(mj,s,{controller,maxSeconds:25});
    assert.equal(e.score.reason,'goal-reached');assert.deepEqual(e.score.contactNames,[]);
    assert.deepEqual(e.scene.sourceMap.plannerRobot,{name:p.name,width:.58,depth:.68,speed:.35,margin:.1});
  }
});

test('held commands in standalone MJCF exactly replay body poses, wheel encoders, velocities and simulated actuator torque',async()=>{
  const e=await runRobotCapabilityEpisode(mj,scene(profile(),[[1,2],[2.5,2],[2.5,3.5]]),{controller:'mppi',maxSeconds:20});
  const model=mj.MjModel.from_xml_string(e.modelXML),data=new mj.MjData(model);
  try {
    mj.mj_forward(model,data);
    for(const f of e.frames) {
      near(data.time,f.time);
      f.positionXYZ.forEach((v,i)=>near(data.qpos[i],v));
      f.quaternionWxyz.forEach((v,i)=>near(data.qpos[i+3],v));
      f.wheelPositionRad.forEach((v,i)=>near(data.qpos[i+7],v));
      f.wheelVelocityRadS.forEach((v,i)=>near(data.qvel[i+6],v));
      f.wheelTorqueNm.forEach((v,i)=>near(data.actuator_force[i],v));
      if(f.action){data.ctrl.set(f.action);for(let step=0;step<10;step++)mj.mj_step(model,data);}
    }
  } finally {data.delete();model.delete();}
});

test('unplanned obstacles and unknown space cause native contact failures; malformed profiles cannot reach the engine',async()=>{
  for(const kind of ['object','unknown']) {
    const s=scene();s.obstacles.push({kind,name:kind+'_0',id:'block',label:'Blocked',polygon:[[2.2,1],[2.8,1],[2.8,3],[2.2,3]]});
    const e=await runRobotCapabilityEpisode(mj,s,{maxSeconds:15});
    assert.equal(e.score.reason,'contact');assert.deepEqual(e.score.contactNames,[kind+'_0']);
    assert.ok(e.frames.at(-1).contacts.includes(kind+'_0'));
  }
  const bad=scene();bad.robotCapability.body.massKg=NaN;
  assert.throws(()=>makeRobotCapabilityMJCF(bad));
  await assert.rejects(runRobotCapabilityEpisode(mj,scene(),{controller:'imitation'}),/waypoint or MPPI/);
});

test('profile latency is recorded as held zero commands, while holonomic episodes explicitly lack wheel telemetry',async()=>{
  const p=profile();p.limits.latencySeconds=.15;
  const delayed=await runRobotCapabilityEpisode(mj,scene(p),{maxSeconds:15});
  assert.equal(delayed.score.reason,'goal-reached');
  assert.ok(delayed.frames.slice(0,3).every(f=>f.action.every(v=>v===0)));
  const holo=await runShowroomEpisode(mj,scene(profile('holonomic')),{controller:'mppi'});
  assert.equal(holo.score.reason,'goal-reached');
  assert.match(holo.provenance.cart,/holonomic.*surrogate/);
  assert.deepEqual(holo.frames[0].wheelTorqueNm,[]);
  assert.deepEqual(holo.frames[0].wheelVelocityRadS,[]);
  assert.match(holo.modelXML,/type="slide"/);
});

test('a supplied weak motor is force limited and cannot manufacture a successful run',async()=>{
  const p=profile();p.motor={voltageV:12,currentLimitA:.02,torqueConstantNmPerA:.001,resistanceOhm:1,gearRatio:1,efficiency:.5,driverResistanceOhm:.1,auxiliaryPowerW:2};
  const e=await runRobotCapabilityEpisode(mj,scene(p),{maxSeconds:1});
  const limits=capabilityActuatorLimits(p);
  assert.equal(e.score.success,false);assert.equal(e.score.reason,'timeout');
  assert.ok(e.frames.every(f=>f.wheelTorqueNm.every(v=>Math.abs(v)<=limits.wheelTorqueNm+1e-10)));
  assert.equal(limits.speedDependentVoltageEnforced,false);
  assert.equal(limits.thermalDeratingEnforced,false);
});
