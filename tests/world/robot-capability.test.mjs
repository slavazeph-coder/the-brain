import assert from 'node:assert/strict';
import test from 'node:test';
import {createRobotCapability,normalizeRobotCapability,profileEnvelope,robotCapabilityHash} from '../../brainsnn-r3f-app/public/world/robot-capability.mjs';
import {createCapabilityController,advanceCapabilityWaypoint} from '../../brainsnn-r3f-app/public/world/robot-capability-controller.mjs';
import {sampleWorld} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {buildReviewedMapEpisodeScene} from '../../brainsnn-r3f-app/public/world/reviewed-map-episode.mjs';

const profile=()=>createRobotCapability({id:'measured-cart',name:'Measured cart envelope',width:.58,depth:.68,speed:.4,margin:.12});

test('a planning envelope becomes an explicitly assumed bounded profile with retained source evidence',async()=>{
  const p=profile();
  assert.deepEqual(profileEnvelope(p),{name:p.name,width:.58,depth:.68,speed:.4,margin:.12});
  assert.equal(p.schema,'brainsnn.robot-capability.v1');
  assert.equal(p.basis,'assumed');
  assert.equal(p.source.physicalModelMatched,false);
  assert.equal(p.motor,null);
  assert.ok(p.evidence.some(e=>e.kind==='assumed'));
  assert.ok(p.unknowns.some(u=>u.includes('Motor')));
  p.evidence.push({field:'body.massKg',kind:'measured',source:{url:'https://example.test/measurement',sample:7}});
  p.source.scan={sha256:'7'.repeat(64)};
  const normalized=normalizeRobotCapability(p);
  assert.deepEqual(normalized,p);
  normalized.evidence.at(-1).source.sample=8;
  assert.equal(p.evidence.at(-1).source.sample,7);
  const rekeyed=Object.fromEntries(Object.entries(p).reverse());
  assert.equal(await robotCapabilityHash(p),await robotCapabilityHash(rekeyed));
  assert.notEqual(await robotCapabilityHash(p),await robotCapabilityHash({...p,body:{...p.body,payloadKg:5}}));
});

test('invalid, unbounded and structurally ambiguous physical inputs fail before planning or native compilation',()=>{
  for(const change of [
    p=>p.body.width=NaN,p=>p.body.massKg=-1,p=>p.body.depth=5.1,p=>p.limits.speedMps='0.5',
    p=>p.limits.latencySeconds=2.1,p=>p.drive.kind='ackermann',p=>p.drive.drivenWheels=4,
    p=>p.drive.wheelSeparationM=p.body.width,p=>p.drive.wheelRadiusM=.5,
    p=>p.body.depth=.1,p=>p.limits.unknownLimit=3,p=>p.source=new Date(),
    p=>p.source=JSON.parse('{"__proto__":{"polluted":true}}'),p=>p.evidence=[{fn(){}}],
  ]) {const p=profile();change(p);assert.throws(()=>normalizeRobotCapability(p));}
  const small=createRobotCapability({width:.1,depth:.1});
  assert.ok(small.drive.wheelRadiusM*2<=small.body.depth);
});

test('motor and driver fields stay optional, finite and source-labelled; incomplete thermal claims fail',()=>{
  const p=profile();
  p.motor={voltageV:24,currentLimitA:4,torqueConstantNmPerA:.05,resistanceOhm:.5,gearRatio:20,efficiency:.85,
    driverResistanceOhm:0,auxiliaryPowerW:0,backEmfVPerRadPerSecond:.05,noLoadCurrentA:.1};
  assert.deepEqual(normalizeRobotCapability(p).motor,p.motor);
  assert.equal(normalizeRobotCapability(p).basis,'assumed');
  assert.throws(()=>normalizeRobotCapability({...p,motor:{...p.motor,driverResistanceOhm:-.01}}));
  assert.throws(()=>normalizeRobotCapability({...p,motor:{...p.motor,thermalCapacityJPerK:500}}));
  p.motor={...p.motor,thermalCapacityJPerK:500,thermalResistanceKPerW:2,ambientC:25,temperatureLimitC:80};
  assert.equal(normalizeRobotCapability(p).motor.temperatureLimitC,80);
  assert.throws(()=>normalizeRobotCapability({...p,motor:{...p.motor,temperatureLimitC:20}}));
});

test('reviewed-map route keeps the exact selected footprint, source and blocked unknown geometry',()=>{
  const p=profile(),world={...sampleWorld(),width:8,depth:6,start:{x:1,z:1},objects:[{id:'unseen',name:'Unseen',x:6,z:3,w:1,d:1,h:.3,kind:'unknown'}]};
  const scene=buildReviewedMapEpisodeScene(world,{x:4,z:1},{source:'Survey',sourceSha256:'a'.repeat(64),scaleMethod:'measured'},p);
  assert.deepEqual(scene.robotCapability,p);
  assert.deepEqual(scene.sourceMap.plannerRobot,profileEnvelope(p));
  assert.equal(scene.sourceMap.robotCapabilityId,p.id);
  assert.equal(scene.cartRadius,Math.hypot(p.body.width,p.body.depth)/2);
  assert.equal(scene.cartHeight,p.body.height);
  assert.equal(scene.sourceMap.reconstruction.sha256,'a'.repeat(64));
  assert.equal(scene.obstacles.find(o=>o.kind==='unknown').id,'unseen');
  const old=buildReviewedMapEpisodeScene(world,{x:4,z:1});
  assert.equal(old.robotCapability,undefined);assert.equal(old.cartRadius,.175);
  assert.throws(()=>buildReviewedMapEpisodeScene({...world,mapReviewed:false},{x:4,z:1},null,p),/Review/);
});

test('differential control rotates toward a sideways target and respects profile command acceleration and yaw limits',()=>{
  const p=profile(),scene={bounds:[0,0,8,6],obstacles:[],route:[[1,1],[1,4]]};
  for(const mode of ['waypoint','mppi']) {
    const c=createCapabilityController(p,scene,{mode}),pose={x:1,z:1,heading:0};
    const first=c.command(pose,1);
    assert.ok(first[0]<=p.limits.accelerationMps2*.05+1e-12);
    assert.ok(first[1]>0&&first[1]<=p.limits.yawRateRps);
    let previous=first;
    for(let i=0;i<10;i++) {
      pose.heading+=previous[1]*.05;
      const next=c.command(pose,1);
      assert.ok(next[0]>=0&&next[0]<=p.limits.speedMps);
      assert.ok(next[0]-previous[0]<=p.limits.accelerationMps2*.05+1e-12);
      assert.ok(previous[0]-next[0]<=p.limits.brakingMps2*.05+1e-12);
      assert.ok(Math.abs(next[1])<=p.limits.yawRateRps);
      previous=next;
    }
  }
  assert.equal(advanceCapabilityWaypoint([[1,1],[1.1,1],[1.2,1],[2,1]],{x:1.24,z:1.02},1),3);
  assert.equal(advanceCapabilityWaypoint([[1,1],[1.1,1],[1.2,1],[2,1]],{x:1.24,z:2},1),1);
});
