import test from 'node:test';
import assert from 'node:assert/strict';
import {storyboard,scaleLabel,pickMime,VIDEO} from '../../brainsnn-r3f-app/public/world/share-video.mjs';
import {sampleWorld,planWorld,ROBOTS} from '../../brainsnn-r3f-app/public/world/core.mjs';

const reconstructed=(warning,extra={})=>({...sampleWorld(),provenance:'observed',scaleReviewed:false,geometrySource:{kind:'reconstruction-proposal',warnings:[warning]},...extra});

test('the scale is labelled as the map holds it, never stronger',()=>{
  assert.equal(scaleLabel(sampleWorld()),'Authored sample, not a reconstruction');
  assert.equal(scaleLabel(reconstructed('Scale estimated by a metric-depth model (MoGe): 1 unit ≈ 0.5 m')),'Scale estimated by a depth model, not measured');
  assert.equal(scaleLabel(reconstructed('Scale from a self-reported 0.9 m measurement between two picked points')),'Scale from a distance you measured');
  assert.equal(scaleLabel(reconstructed('Scale estimated from an assumed 1.35 m camera height')),'Scale assumed from the phone height, not measured');
  assert.equal(scaleLabel(reconstructed('Scale estimated by a metric-depth model',{scaleReviewed:true})),'Scale estimated by a depth model, not measured; checked by you');
  assert.equal(scaleLabel({provenance:'generated'}),'Generated, visual only: not a collision map');
});

test('the story calls out the largest obstacles with real sizes and the run as planned',()=>{
  const world=sampleWorld(),robot={...ROBOTS.cleaner,margin:.1},plan=planWorld(world,robot),scenes=storyboard(world,plan,robot);
  assert.ok(scenes[0].card&&scenes.at(-1).card,'opens and closes on cards');
  const callouts=scenes.filter(s=>s.select);
  const obstacles=world.objects.filter(o=>o.kind==='obstacle').sort((a,b)=>b.w*b.d-a.w*a.d);
  assert.deepEqual(callouts.map(s=>s.select),obstacles.slice(0,VIDEO.callouts).map(o=>o.id));
  for(const s of callouts){const o=world.objects.find(x=>x.id===s.select);assert.ok(s.caption.startsWith(o.name)&&s.caption.includes(`${Math.round(o.h*10)/10} m tall`),s.caption);}
  const run=scenes.find(s=>s.cursor);
  assert.deepEqual(run.cursor,[0,1]);
  assert.match(run.caption,new RegExp(`^Cleaning robot: ${Math.round(plan.reachableArea)} m² reached`));
  assert.match(scenes.at(-1).card.sub,/Authored sample, not a reconstruction\. A simulation on this map; no robot moved\./);
  const seconds=scenes.reduce((s,x)=>s+x.seconds,0);assert.ok(seconds>=20&&seconds<=30,`length ${seconds}`);
  for(const s of scenes.filter(x=>!x.card))assert.ok(Number.isFinite(s.yaw[0])&&Number.isFinite(s.yaw[1])&&s.yaw[1]>s.yaw[0],'the camera keeps turning one way');
});

test('a route to a goal is told as a route, and no run is never invented',()=>{
  const world=sampleWorld(),robot=ROBOTS.vacuum;
  const toGoal=storyboard(world,{route:[{x:1,z:1},{x:3,z:1}],goal:{x:3,z:1},distance:2.04,travelSeconds:7},robot).find(s=>s.cursor);
  assert.equal(toGoal.caption,'Robot vacuum: route to the goal, 2 m, about 1 min');
  const none=storyboard(world,null,robot);
  assert.ok(!none.some(s=>s.cursor));
  assert.match(none.at(-1).card.sub,/No route planned\./);
  assert.throws(()=>storyboard(null,null,robot),/Open or build a map/);
});

test('MP4 is chosen where the browser records it, else WebM, else the browser default',()=>{
  assert.equal(pickMime(t=>t.startsWith('video/mp4')),'video/mp4;codecs=avc1.42E01E');
  assert.equal(pickMime(t=>t==='video/webm;codecs=vp9'||t==='video/webm'),'video/webm;codecs=vp9');
  assert.equal(pickMime(()=>false),'');
});
