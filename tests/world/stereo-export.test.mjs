import test from 'node:test';
import assert from 'node:assert/strict';
import {readStereoGaussians, readRenderCameras, toViewerPoints} from '../../brainsnn-r3f-app/public/world/stereo-export-data.mjs';

function ply(count) {
  const fields='x y z f_dc_0 f_dc_1 f_dc_2 opacity scale_0 scale_1 scale_2 rot_0 rot_1 rot_2 rot_3'.split(' ');
  const header=['ply','format binary_little_endian 1.0','element vertex '+count,...fields.map(f=>'property float '+f),'end_header',''].join('\r\n');
  const rows=new Float32Array(count*fields.length);
  for (let i=0;i<count;i++) {
    rows[i*fields.length]=i;
    rows[i*fields.length+2]=2;
    rows[i*fields.length+10]=1;
  }
  return new Blob([header, rows]);
}

test('samples whole Gaussian records across the export and rotates OpenCV to viewer axes',async()=>{
  const data=await readStereoGaussians(ply(40001));
  assert.equal(data.total,40001);
  assert.equal(data.displayed,13334);
  assert.equal(data.points.at(-14),39999);
  const display=toViewerPoints(data.points);
  assert.equal(display[2],-2);
  assert.equal(display[10],1);
  assert.equal(data.points[2],2);
  await assert.rejects(readStereoGaussians(ply(2).slice(0,-1)),/length/);
});

test('render camera centers use the inverse rigid transform',()=>{
  const side={image_size:[320,640],intrinsics:[[240,0,320],[0,240,160],[0,0,1]],
    convention:'OpenCV axes; world = first input left camera; meters',world_to_camera:[[[0,0,1,3],[0,1,0,4],[-1,0,0,5],[0,0,0,1]]]};
  const rig=readRenderCameras(side);
  assert.deepEqual(rig.centers[0],[5,-4,-3]);
  assert.equal(rig.width,640);
  assert.equal(rig.height,320);
  assert.throws(()=>readRenderCameras({...side,convention:'unknown'}),/export/);
  side.world_to_camera[0][0][2]=-1;
  assert.throws(()=>readRenderCameras(side),/rotation/);
});
