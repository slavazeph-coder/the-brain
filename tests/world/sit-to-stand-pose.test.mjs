import test from 'node:test';
import assert from 'node:assert/strict';
import {poseImageRect,nextPoseImageRect,readPoseSide,poseSampleTimes} from '../../brainsnn-r3f-app/public/world/sit-to-stand-pose.mjs';
test('pose crop inverts portrait and landscape letterboxing and preserves one anatomical side',()=>{
  for(const [width,height] of [[720,1280],[1280,720]]) {
    const rect=poseImageRect(width,height), output=Array(51).fill(0);
    for(const index of [11,13,15]) {
      output[index*3]=(rect.y+.75*rect.h)/192;
      output[index*3+1]=(rect.x+.25*rect.w)/192;
      output[index*3+2]=.8;
    }
    const left=readPoseSide(output,'left',rect);
    assert.deepEqual(left.landmarks,Array(3).fill({x:.25,y:.75,score:.8}));
    assert.equal(readPoseSide(output,'right',rect).landmarks,null);
    output[13*3+2]=.299;
    assert.equal(readPoseSide(output,'left',rect).landmarks,null);
    output[13*3+2]=1;output[11*3+1]=1.2;
    assert.equal(readPoseSide(output,'left',rect).landmarks,null);
  }
});
test('detector uses a bounded half-open sample window, including fractional starts',()=>{
  assert.deepEqual(poseSampleTimes(.5,1),[.5,.7,.9]);
  assert.equal(poseSampleTimes(2,62).length,300);
  for (const [a,b] of [[NaN,1],[0,61],[1,1],[-1,1]]) assert.throws(()=>poseSampleTimes(a,b));
});

test('a torso-guided crop is invertible and returns to the full frame after tracking loss',()=>{
  const width=720, height=1280, full=poseImageRect(width,height);
  const points=new Map([[5,[.48,.50]],[6,[.52,.50]],[11,[.48,.60]],[12,[.52,.60]],[13,[.48,.69]],[15,[.48,.76]]]);
  const outputFor = rect => {
    const output=Array(51).fill(0);
    for (const [i,[x,y]] of points) {
      output[i*3]=(rect.y+y*rect.h)/192; output[i*3+1]=(rect.x+x*rect.w)/192; output[i*3+2]=.9;
    }
    return output;
  };
  const crop=nextPoseImageRect(outputFor(full),full,width,height);
  assert.ok(crop.h>full.h);
  for (const [i,p] of readPoseSide(outputFor(crop),'left',crop).landmarks.entries()) {
    const [x,y]=points.get([11,13,15][i]);
    assert.ok(Math.abs(p.x-x)<1e-8 && Math.abs(p.y-y)<1e-8);
  }
  assert.deepEqual(nextPoseImageRect(Array(51).fill(0),crop,width,height),full);
});
