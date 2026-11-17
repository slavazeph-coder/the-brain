import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFrame,rebasePoint,sourcePoint,rebaseRestMatrix,rebaseWorldTransform,checkedClip,insideClip} from '../../brainsnn-r3f-app/public/world/render-frame.mjs';

const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const apply=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]);
const near=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-8,`${a} differs from ${b}`));

test('source coordinates are rebased before Float32 conversion without changing the source',()=>{
  const point=[1e7+.01,2e6+.02,-3e6+.03,100,120,140],before=JSON.stringify(point),origin=[1e7,2e6,-3e6];
  assert.equal(Math.fround(point[0])-Math.fround(origin[0]),0);
  const local=new Float32Array(rebasePoint(point,origin));
  assert.ok(Math.abs(local[0]-.01)<1e-8);near(sourcePoint([...local],origin),point.slice(0,3));assert.equal(JSON.stringify(point),before);
});

test('frame bounds include rotated model corners and cloud beyond the model',()=>{
  const parts=[{centre:[10,2,20],size:[4,2,1],yaw:90}],points=[[30,3,40,1,2,3]],before=JSON.stringify([parts,points]);
  const frame=renderFrame(parts,points);near(frame.min,[9.5,1,18]);near(frame.max,[30,3,40]);near(frame.origin,[19.75,2,29]);assert.equal(frame.span,22);assert.equal(JSON.stringify([parts,points]),before);
  assert.deepEqual(renderFrame(parts,points,{centre:[1,2,3],span:50}).origin,[1,2,3]);
  assert.throws(()=>renderFrame(parts,points,{centre:[1,2,3],span:NaN}),/positive finite/);
  assert.deepEqual(renderFrame([],[]),{origin:[0,0,0],span:5,min:[0,0,0],max:[0,0,0]});
});

test('rebased rest and world poses preserve source-frame rotations and translations',()=>{
  const origin=[1000000,2000000,3000000],rest=[...identity];rest.splice(12,3,1000001,2000002,3000003);
  near(apply(rebaseRestMatrix(rest,origin),[.2,.3,.4]),rebasePoint(apply(rest,[.2,.3,.4]),origin));
  const transform=[0,0,-1,0,0,1,0,0,1,0,0,0,5,6,7,1],local=[1,2,3];
  near(apply(rebaseWorldTransform(transform,origin),local),rebasePoint(apply(transform,sourcePoint(local,origin)),origin));
  assert.deepEqual(rebaseWorldTransform(identity,origin),identity);
});

test('sections use source coordinates, retain boundary points and reject invalid boxes',()=>{
  const clip=checkedClip({min:[1000000,2,3],max:[1000010,4,5]});assert.equal(insideClip([1000000,2,3],clip),true);assert.equal(insideClip([1000011,3,4],clip),false);assert.equal(insideClip([0,0,0],null),true);
  assert.throws(()=>checkedClip({min:[0,0,0],max:[-1,1,1]}),/maxima/);assert.throws(()=>checkedClip({min:[0,0,0],max:[1,NaN,1]}),/finite/);assert.equal(checkedClip(null),null);
});
