import test from 'node:test';
import assert from 'node:assert/strict';
import { kneeFlexion, readForceCsv, forceAt, buildMovementReview } from '../../brainsnn-r3f-app/public/world/movement-analysis.mjs';
const source = { kind: 'video', name: 'side-view.mp4', width: 200, height: 100, durationSeconds: 3 };
const landmarks = [{x:0,y:0}, {x:.25,y:.5}, {x:.5,y:.5}];
const observations = [{timeSeconds:1, landmarks}];
const trace = (csv, options = {}) => readForceCsv(csv, { kind:'measured', label:'Left force plate', offsetSeconds:1, ...options });
test('projected knee bend uses the video aspect ratio and zero for a straight limb', () => {
  assert.equal(kneeFlexion(landmarks, 200, 100), 45);
  assert.equal(kneeFlexion([{x:0,y:.1},{x:.5,y:.1},{x:1,y:.1}],200,100),0);
  assert.throws(() => kneeFlexion(Array(3).fill(landmarks[0]), 200, 100));
  assert.throws(() => kneeFlexion([{x:-1,y:0}, ...landmarks.slice(1)], 200, 100));
});
test('trace interpolation respects signed clock offset, data bounds, and explicit zero readings', () => {
  const force = trace('time_s,vertical_force_n\r\n-1,0\r\n0.5,150\r\n2,30');
  assert.deepEqual([-.5,0,1,1.5,3,3.1].map(t=>forceAt(force,t)),[null,0,100,150,30,null]);
  assert.equal(forceAt(null,1),null);
});
test('malformed units, times, rows or provenance cannot produce a force trace', () => {
  for (const rows of ['0,\n1,22','0,3','0,2\n0,3','1,2\n0,3','0,2\n1,1e999','0,3\n1,3,0']) {
    assert.throws(()=>trace('time_s,vertical_force_n\n'+rows));
  }
  assert.throws(()=>trace('time_ms,force_kg\n0,3\n1,2'));
  for(const opts of [{kind:'camera'},{label:' '},{offsetSeconds:NaN}]) assert.throws(()=>trace('time_s,vertical_force_n\n0,3\n1,2',opts));
});
test('exports the supplied force provenance, exact annotations, and missing evidence without guessing', () => {
  const forceTrace = trace('time_s,vertical_force_n\n0,300\n1,500',{kind:'modelled'});
  const review = buildMovementReview({source, observations:[{timeSeconds:3,landmarks},...observations], forceTrace});
  assert.deepEqual(review.observations.map(o=>[o.timeSeconds,o.kneeFlexionDegrees,o.verticalForceN]),[[1,45,300],[3,45,null]]);
  assert.equal(review.forceTrace.kind,'modelled');
  assert.equal(buildMovementReview({source, observations}).observations[0].verticalForceN,null);
  assert.throws(()=>buildMovementReview({source,observations:[...observations,...observations]}));
  assert.throws(()=>buildMovementReview({source,observations:[{timeSeconds:4,landmarks}]}));
  assert.throws(()=>buildMovementReview({source:{...source,kind:'synthetic'},observations,forceTrace}));
});

test('side-specific annotations share a timestamp and preserve legacy untagged records', () => {
  const observation=observations[0], left={...observation,side:'left'}, right={...observation,side:'right'};
  const review=buildMovementReview({source,observations:[left,observation,right]});
  assert.deepEqual(review.observations.map(o=>o.side),['left',undefined,'right']);
  assert.equal(Object.hasOwn(review.observations[1],'side'),false);
  assert.throws(()=>buildMovementReview({source,observations:[left,right,left]}));
  assert.throws(()=>buildMovementReview({source,observations:[{...left,side:'unknown'}]}));
});
