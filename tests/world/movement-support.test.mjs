import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSupport } from '../../brainsnn-r3f-app/public/world/movement-support.mjs';
import { buildMovementReview } from '../../brainsnn-r3f-app/public/world/movement-analysis.mjs';
const options = {massKg:80,sourceLabel:'Metric whole-body fixture',offsetSeconds:1};
test('whole-body support at rest, in free fall and accelerating upward has correct units and sign',()=>{
  const t = estimateSupport('time_s,com_az_m_s2\n0,0\n1,-9.80665\n2,2',options);
  assert.equal(t.kind,'modelled');
  assert.deepEqual(t.samples.map(s=>s.verticalForceN),[80*9.80665,0,80*11.80665]);
  const review = buildMovementReview({source:{name:'example.mp4',kind:'video',durationSeconds:5,width:100,height:100},
    observations:[{timeSeconds:2,landmarks:[{x:0,y:0},{x:.3,y:.6},{x:.6,y:.9}]}],forceTrace:t});
  assert.equal(review.observations[0].verticalForceN,0);
  assert.equal(review.forceTrace.model.massKg,80);
  assert.deepEqual(review.forceTrace.model.acceleration[1],{timeSeconds:1,accelerationMps2:-9.80665});
});
test('support model rejects unknown units, missing mass and duplicate time',()=>{
  const head='time_s,com_az_m_s2\n',valid=head+'0,0\n1,0';
  for (const bad of [{massKg:0},{massKg:Infinity},{sourceLabel:''},{offsetSeconds:NaN}]) assert.throws(()=>estimateSupport(valid,{...options,...bad}));
  for (const bad of ['time_s,hip_y_px\n0,20\n1,22',head+'0,0\n0,0', head+'0,NaN\n1,0']) assert.throws(()=>estimateSupport(bad,options));
});
