import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {imitationVelocity,radialFeatures} from '../../brainsnn-r3f-app/public/world/showroom-episode-policy.mjs';
import {showroomDriver} from '../../brainsnn-r3f-app/public/world/assets/showroom-driver.mjs';
import {createShowroomExample} from '../../brainsnn-r3f-app/public/world/showroom-model.mjs';
import {buildShowroomEpisodeScene,makeShowroomEpisodeMJCF,showroomEpisodeColliders,runShowroomEpisode} from '../../brainsnn-r3f-app/public/world/showroom-episode-physics.mjs';

const req=createRequire(new URL('../../brainsnn-r3f-app/package.json',import.meta.url));
const {default:init}=await import(pathToFileURL(req.resolve('@mujoco/mujoco')));
const mj=await init();
const room=createShowroomExample();

test('two showroom layouts reach the same destination in native MuJoCo and export different collision scenes',async()=>{
  const before=await runShowroomEpisode(mj,buildShowroomEpisodeScene(room));
  const after=await runShowroomEpisode(mj,buildShowroomEpisodeScene(room,{variant:'after'}));
  assert.equal(before.engine.version,'4.0.1');
  assert.equal(before.score.reason,'goal-reached');
  assert.equal(after.score.reason,'goal-reached');
  assert.ok(before.score.distanceMeters>after.score.distanceMeters+1);
  assert.equal(after.scene.obstacles.length,before.scene.obstacles.length-1);
  assert.ok(after.scene.obstacles.some(o=>o.kind==='unknown'));
  assert.equal(after.frames.at(-1).action,null);
  assert.ok(after.frames.every(f=>!f.contacts.length));
  assert.ok(before.frames.every(f=>f.action===null || Math.hypot(...f.action)<=.65+1e-12));
  assert.notEqual(before.sceneSha256,after.sceneSha256);
  assert.match(before.sceneSha256,/^[0-9a-f]{64}$/);
  assert.equal(before.scene.title,room.title);
  assert.equal(JSON.stringify(before.scene).includes('/world/assets/'),false);
  assert.deepEqual(after,await runShowroomEpisode(mj,after.scene));
});

test('recorded commands exactly reproduce positions, velocities and timestamps from standalone MJCF',async()=>{
  const result=await runShowroomEpisode(mj,buildShowroomEpisodeScene(room,{variant:'after'}));
  const model=mj.MjModel.from_xml_string(result.modelXML), data=new mj.MjData(model);
  const [x0,z0]=result.scene.route[0];
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8);
  try {
    mj.mj_forward(model,data);
    for(const frame of result.frames) {
      near(data.time,frame.time); near(data.qpos[0],frame.position[0]-x0); near(data.qpos[1],frame.position[1]-z0);
      near(data.qvel[0],frame.velocity[0]); near(data.qvel[1],frame.velocity[1]);
      if(frame.action) {
        data.ctrl.set(frame.action);
        for(let step=0;step<10;step++) mj.mj_step(model,data);
      }
    }
  } finally {data.delete(); model.delete();}
});

test('a replayed straight route hits the present object or retained unknown area and records active contacts',async()=>{
  // Straight through the practice cart; removing it in a separate copy makes this route passable.
  const unsafe=structuredClone(room);
  unsafe.routes.before=structuredClone(unsafe.routes.after);
  const scene=buildShowroomEpisodeScene(unsafe);
  const blocked=await runShowroomEpisode(mj,scene);
  assert.equal(blocked.score.reason,'contact');
  assert.deepEqual(blocked.score.contactNames,['object_0']);
  assert.ok(blocked.frames.at(-1).contacts.includes('object_0'));
  assert.ok(blocked.score.finalErrorMeters>5);
  // Sloping edges exercise real mesh colliders, including conservative hulls of concave footprints.
  unsafe.unknown.push([[4,3.5],[5,4],[4.2,4.1],[4,4.6],[3.8,4.1]]);
  const removed=buildShowroomEpisodeScene(unsafe,{variant:'after'});
  const obstacle=removed.obstacles.at(-1);
  assert.ok(obstacle.originalFootprint.length>obstacle.polygon.length);
  assert.ok(makeShowroomEpisodeMJCF(removed).includes('mesh="shape_unknown_1"'));
  const stopped=await runShowroomEpisode(mj,removed);
  assert.deepEqual(stopped.score.contactNames,['unknown_1']);
  assert.ok(stopped.frames.at(-1).contacts.includes('unknown_1'));
});

test('exported collider prisms match the room bounds and reject invalid or ambiguous scene geometry',()=>{
  const scene=buildShowroomEpisodeScene(room);
  const colliders=showroomEpisodeColliders(scene);
  assert.equal(colliders.filter(o=>o.kind==='wall').length,4);
  assert.equal(colliders.find(o=>o.kind==='floor').top,0);
  assert.deepEqual(colliders.find(o=>o.name==='object_0').polygon,scene.obstacles[0].polygon);
  for(const change of [
    s=>s.obstacles[0].name='evil" mesh="something',
    s=>s.route[0][1]=NaN,
    s=>s.cartRadius=.01,
    s=>s.obstacles[0].polygon.reverse(),
    s=>s.bounds[2]=1e7,
  ]) {
    const altered=structuredClone(scene);
    change(altered);
    assert.throws(()=>makeShowroomEpisodeMJCF(altered));
  }
  assert.throws(()=>buildShowroomEpisodeScene(room,{objectId:'missing'}));
  assert.throws(()=>buildShowroomEpisodeScene(room,{variant:'removed-everything'}));
});

test('offline policy receives only state and target, is speed-limited, and cannot mutate dynamics through observations',async()=>{
  const scene=buildShowroomEpisodeScene(room,{variant:'after'});
  const blocked=await runShowroomEpisode(mj,scene,{controller:'imitation',act(obs){
    assert.deepEqual(Object.keys(obs).sort(),['position','target','velocity']);
    obs.position[0]=998;
    return [-3,0];
  }});
  assert.ok(blocked.frames.every(f=>f.action===null || f.action[0]===-.65));
  assert.equal(blocked.provenance.controllerKind,'imitation');
  assert.equal(blocked.frames[0].position[0],scene.route[0][0]);
  assert.ok(blocked.score.contactNames.includes('wall_west'));
  await assert.rejects(runShowroomEpisode(mj,scene,{controller:'imitation',act:()=>[NaN,0]}));
});


test('the fitted, state-only cart driver follows new waypoint paths and stays behind solid obstacles',async()=>{
  assert.equal(showroomDriver.trainingScenes,21);
  assert.ok(showroomDriver.trainingTransitions>7000);
  assert.deepEqual(radialFeatures(.25,[0,.5,1]),[.5,.5,0]);
  const option={controller:'imitation',trainingId:showroomDriver.id,act:state=>imitationVelocity(showroomDriver,state)};
  const scene=buildShowroomEpisodeScene(room);
  const episode=await runShowroomEpisode(mj,scene,option);
  assert.equal(episode.score.reason,'goal-reached');
  assert.equal(episode.provenance.trainingId,showroomDriver.id);
  const blocked={...scene,route:[[1,4],[11,4]],objectId:null};
  const collision=await runShowroomEpisode(mj,blocked,option);
  assert.deepEqual(collision.score.contactNames,['object_0']);
  assert.notEqual(collision.sceneSha256,episode.sceneSha256);
  const still=await runShowroomEpisode(mj,blocked,{controller:'stationary'});
  assert.equal(still.score.reason,'timeout');
  assert.equal(still.provenance.learnedPolicyExecuted,false);
  assert.equal(still.score.distanceMeters,0);
});
