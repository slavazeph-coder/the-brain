import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appearanceSource, renderWalkAppearance, validateWalkDepth, walkRasterSize} from '../../brainsnn-r3f-app/public/world/showroom-walk-appearance.mjs';
import {createShowroomExample, parseShowroomBundle} from '../../brainsnn-r3f-app/public/world/showroom-model.mjs';

const camera = {eye:[0,0,0], right:[1,0,0], down:[0,1,0], forward:[0,0,1], intrinsics:[3,3,1.5,.5], width:3, height:1};
function source(mm, red) {
  const buf = Buffer.alloc(2*mm.length);
  mm.forEach((v,i) => buf.writeUInt16LE(v,2*i));
  const depth = validateWalkDepth({width:3,height:1,millimeters:buf.toString('base64')},3,1);
  const rgba = Uint8Array.from(red.flatMap(r => [r,80,120,255]));
  return appearanceSource({width:3,height:1,pose:camera,depth},rgba);
}
test('calibrated endpoint round-trips pixel centres and millimetre depths', () => {
  const s=source([1000,0,3000],[200,10,30]);
  assert.equal(s.xyz.length,6);
  assert.equal(s.xyz[2],1);
  const r=renderWalkAppearance([s,s],camera,0,3,1);
  assert.deepEqual([...r.valid],[1,0,1]);
  assert.equal(r.coverage,2/3);
  assert.deepEqual([...r.pixels.slice(0,3)],[200,80,120]);
  assert.equal(r.pixels[8],30);
});
test('visible surfaces win across cameras, and only consistent depths blend', () => {
  const front=source([1000,1000,1000],[10,20,30]), back=source([2500,1002,700],[250,220,200]);
  const r=renderWalkAppearance([front,back],camera,.5,3,1);
  assert.deepEqual([...r.pixels.filter((_,i)=>i%4===0)],[10,120,200]);
});
test('optional gap fill borrows from its endpoint without adding depth support or changing visible pixels', () => {
  const a=source([1000,0,0],[11,33,55]), b=source([1100,0,0],[12,62,90]);
  const original=renderWalkAppearance([a,b],camera,.75,3,1);
  const filled=renderWalkAppearance([a,b],camera,.75,3,1,true);
  assert.deepEqual(filled.valid,original.valid);
  assert.equal(filled.coverage,1/3);
  assert.equal(filled.pixels[0],original.pixels[0]);
  assert.equal(filled.pixels[4],62);
  assert.equal(filled.pixels[8],90);
  assert.equal(renderWalkAppearance([a,b],camera,.25,3,1,true).pixels[4],33);
});
test('room importer rejects invalid depth bytes, camera mismatch, aspect or missing calibration', () => {
  const b = createShowroomExample();
  const frame = b.frames[0];
  assert.equal(frame.depth.width,240);
  for (const change of [
    f => {f.depth.millimeters='AAAA';},
    f => {f.depth.width=65536;},
    f => {f.depth.height=1;},
    f => {f.pose.eye[0]+=1;},
    f => {delete f.pose;},
  ]) {
    const copy=structuredClone(b);
    change(copy.frames[0]);
    assert.throws(()=>parseShowroomBundle(copy));
  }
});

test('portrait walk predictions stay within the shared raster limit', () => {
  const portrait = {width:1080, height:1920};
  assert.deepEqual(walkRasterSize([{width:144}, {width:144}], portrait), {width:126,height:224});
  assert.deepEqual(walkRasterSize([{width:240}], {width:1280,height:720}), {width:224,height:126});
});
