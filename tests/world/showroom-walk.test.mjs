import test from 'node:test';
import assert from 'node:assert/strict';
import {
  framePose, validateWalkPose, walkFrames, walkPose, nearestWalkFrame, walkComparison,
  projectWalkPoint, drawWalkFrame,
} from '../../brainsnn-r3f-app/public/world/showroom-walk.mjs';

const pinhole = {eye:[0, 1, 0], right:[1,0,0], down:[0,-1,0], forward:[0,0,1], intrinsics:[100, 100, 50, 40]};
const picture = (id, x, time) => ({id, image:id+'.jpg', width:100, height:80, timeSeconds:time,
  pose:{...pinhole, eye:[x,1,0]}});
const close = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-8, actual+' differs from '+expected);

test('calibrated camera projects floor-XZ-height points with pixel intrinsics and forward depth', () => {
  const pose = framePose(picture('a',0,0));
  assert.deepEqual(projectWalkPoint(pose,[0,2,1]),{x:0.5,y:0.5,depth:2});
  const offset = projectWalkPoint(pose,[0.5,2,1.4,'cart']);
  close(offset.x,0.75); close(offset.y,0.25); close(offset.depth,2);
  assert.equal(projectWalkPoint(pose,[0,-2,1]),null);
  assert.equal(projectWalkPoint(pose,[0,0.008,1]),null);
  assert.equal(projectWalkPoint(pose,[1,2,1]),null);
  assert.equal(projectWalkPoint(pose,[0,2,-1]),null);
});

test('rejects invalid handedness changes, degenerate camera input, malformed intrinsics and huge coordinates', () => {
  for (const change of [{right:[0,1,0]}, {forward:[0,0,NaN]}, {eye:[1e8,0,0]},
    {intrinsics:[0,100,50,40]}, {intrinsics:[100,100,2e6,40]}, {down:[,1,0]}]) {
    assert.throws(()=>validateWalkPose({...pinhole,...change},100,80));
  }
  assert.throws(()=>validateWalkPose(pinhole,0,80));
  const f = picture('good',0,0), mirrored = {...f,pose:{...f.pose,right:[-1,0,0]}};
  assert.equal(walkPose({frames:[f,mirrored]},0,1,0.5),null);
  const cloned = validateWalkPose(f.pose,100,80);
  cloned.eye[0]=99;
  assert.equal(f.pose.eye[0],0);
});

test('interpolates position, roll, focal length and principal point consistently at differing resolutions', () => {
  const a=picture('a',0,0), b=picture('b',2,2);
  b.width=200; b.height=160;
  b.pose={...b.pose,right:[0,1,0],down:[1,0,0],intrinsics:[200,200,120,80]};
  const room={frames:[a,b]};
  const pose=walkPose(room,0,1,0.5);
  assert.deepEqual(pose.eye,[1,1,0]);
  close(pose.right[0],Math.SQRT1_2); close(pose.right[1],Math.SQRT1_2);
  close(pose.down[0],Math.SQRT1_2); close(pose.down[1],-Math.SQRT1_2);
  close(pose.forward[2],1); close(pose.intrinsics[0]/pose.width,1);
  close(pose.intrinsics[2]/pose.width,0.55);
  for(const [i,t] of [[0,-1],[1,2]]) assert.deepEqual(walkPose(room,0,1,t),framePose(room.frames[i]));
  assert.deepEqual(walkPose(room,1,0,0.5).right,pose.right);
  assert.equal(walkPose(room,0,1,NaN),null);
});

test('legacy headings take the short path across 180 degrees and missing directions are unavailable', () => {
  const legacy = heading => ({width:64,height:32,camera:[0,0],heading});
  const room={frames:[legacy(170),legacy(-170),legacy(null),{width:64,height:32}]};
  assert.deepEqual(walkFrames(room),[0,1]);
  const p=walkPose(room,0,1,0.5);
  close(p.forward[0],0);close(p.forward[2],-1);
  assert.equal(p.calibrated,false);
  assert.equal(walkPose(room,0,2,0.2),null);
  assert.equal(walkComparison(room,0),null);
});

test('held-photo comparison excludes duplicate pictures, uses source timestamps and has a distance baseline', () => {
  const frames=[picture('one',0,0),picture('two',1,1),picture('duplicate',1,2),picture('three',4,4)];
  frames[2].image=frames[1].image;
  const room={frames};
  const pair=walkComparison(room,1);
  assert.deepEqual(pair,{targetIndex:1, beforeIndex:0,afterIndex:3,nearestIndex:0,distanceMeters:1,angleDegrees:0,
    t:0.25,calibrated:true});
  assert.deepEqual(nearestWalkFrame(room,null),null);
  assert.equal(walkComparison(room,0),null);
  frames[3].image=frames[0].image;
  assert.equal(walkComparison(room,1),null);
  frames[3].image='three.jpg';
  frames[1].timeSeconds=null;
  close(walkComparison(room,1).t,1/3);
  const repeated=[picture('a',0,0),picture('b',1,1),picture('c',2,2),picture('b',1,3)];
  const distinct=walkComparison({frames:repeated},2);
  assert.equal(distinct.beforeIndex,0); assert.equal(distinct.afterIndex,3);
});

test('renders only projected samples, painting closer dots last without altering the scene', () => {
  const scene={objects:[{id:'near'},{id:'far'}],points:[[0,1,1,'near'],[0,4,1,'far'],[0,-1,1],[30,2,1]]};
  const original=structuredClone(scene);
  const calls=[];
  const ctx={fillStyle:'',fillRect(...r){calls.push({style:this.fillStyle,r});}};
  const canvas={width:100,height:80,getContext:()=>ctx};
  const stats=drawWalkFrame(canvas,scene,framePose(picture('a',0,0)));
  assert.deepEqual(stats,{visiblePoints:2,coverage:1/(24*14)});
  assert.equal(calls.length,3);
  assert.deepEqual(calls[0].r,[0,0,100,80]);
  assert.match(calls[2].style,/^rgb\(11[0-9],22[0-9],19[0-9]\)$/);
  assert.deepEqual(scene,original);
  assert.deepEqual(drawWalkFrame(canvas,scene,null),{visiblePoints:0,coverage:0});
  assert.throws(()=>drawWalkFrame({...canvas,width:99999},scene,null));
});
