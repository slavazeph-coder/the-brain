import test from 'node:test';
import assert from 'node:assert/strict';
import {readLocalization,photoOnMap,floorFromTap,proposalAfterApply} from '../../brainsnn-r3f-app/public/world/photo-locator.mjs';

// Map metres = 2 x reconstruction units, y up, floor at 0. The camera stands 1.5 units up at (1, 1.5, 1), looking level along +z.
const transform={ex:[1,0,0],up:[0,1,0],ez:[0,0,1],floor:0,scale:2,offset:[0,0]};
const result={schema:'brainsnn.localization.v1',located:true,camera_center:[1,1.5,1],inliers:200,correspondences:240,mean_reprojection_error_pixels:1.2,nearest_frame:'frame_0007.jpg',
  world_to_camera:[[-1,0,0,1],[0,-1,0,1.5],[0,0,1,-1],[0,0,0,1]],camera:{model:'SIMPLE_RADIAL',width:1280,height:960,parameters:[1000,640,480,0]}};

test('a located photo stands where it was taken and faces the way it looked',()=>{
  const photo=readLocalization(result),at=photoOnMap(photo,transform);
  assert.deepEqual([at.x,at.z,at.height],[2,2,3]);
  assert.deepEqual([at.dx,at.dz],[0,1]);
  assert.equal(photo.inliers,200);
});

test('a tap below the horizon finds the floor it points at; the horizon and the sky find nothing',()=>{
  const photo=readLocalization(result);
  // Half a focal length below the centre: the ray drops 0.5 per unit ahead, so it meets the floor 3 units ahead.
  assert.deepEqual(floorFromTap(photo,transform,640,480+500),{x:2,z:8});
  assert.equal(floorFromTap(photo,transform,640,480),null);
  assert.equal(floorFromTap(photo,transform,640,100),null);
  // A spot off the map is refused rather than clamped.
  assert.equal(floorFromTap(photo,transform,640,480+500,{width:10,depth:6}),null);
  assert.deepEqual(floorFromTap(photo,transform,640,480+500,{width:10,depth:10}),{x:2,z:8});
});

test('pinhole cameras use their own focal lengths and principal point',()=>{
  const photo=readLocalization({...result,camera:{model:'PINHOLE',width:1280,height:960,parameters:[1000,800,640,480]}});
  assert.deepEqual(floorFromTap(photo,transform,640,480+400),{x:2,z:8});
});

test('a photo that was not placed carries its reason; broken results are rejected',()=>{
  assert.deepEqual(readLocalization({schema:'brainsnn.localization.v1',located:false,reason:'Only 9 of 40 matched points agree.'}),{located:false,reason:'Only 9 of 40 matched points agree.'});
  assert.throws(()=>readLocalization({schema:'other'}),/not a photo localisation/);
  assert.throws(()=>readLocalization({...result,camera_center:[1,NaN,1]}),/incomplete/);
  assert.throws(()=>readLocalization({...result,camera:{...result.camera,parameters:[0,640,480,0]}}),/invalid/);
});

test('an edit keeps the map\'s reconstruction binding; any other map replaces or drops it',()=>{
  const a={job:'a'.repeat(32)},b={job:'b'.repeat(32)};
  assert.equal(proposalAfterApply(a,{review:true}),a);          // edits of the current proposed map
  assert.equal(proposalAfterApply(a,{proposal:b}),b);           // a new proposal brings its own
  assert.equal(proposalAfterApply(a,{}),null);                  // an import, a restored save, the sample or a scene map
  assert.equal(proposalAfterApply(a),null);
  assert.equal(proposalAfterApply(null,{review:true}),null);
});
