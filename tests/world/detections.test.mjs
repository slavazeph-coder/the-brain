import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DETECTOR,DETECTION_CONFIG,detectionSidecar,detectionBox} from '../../brainsnn-r3f-app/public/world/detections.mjs';
import {importObservations,reviewObservation,exportObservationProof} from '../../brainsnn-r3f-app/public/world/observations.mjs';

const sha=text=>createHash('sha256').update(text).digest('hex');
const sourceSha256=sha('photo bytes'),frame={sha256:sha('frame png'),width:512,height:384};
const binding={sha256:sourceSha256,kind:'photo',frames:[{id:'photo',...frame,timestamp:null}]};
const raw=[
  {label:'chair',score:.93,box:{xmin:.1,ymin:.4,xmax:.3,ymax:.9}},
  {label:'dining table',score:.88,box:{xmin:.35,ymin:.5,xmax:.8,ymax:.95}},
  {label:'couch',score:.5,box:{xmin:.1,ymin:.1,xmax:.2,ymax:.2}},          // below threshold
  {label:'tv',score:.9,box:{xmin:.6,ymin:.2,xmax:.6,ymax:.4}},             // no area
  {label:'',score:.99,box:{xmin:.1,ymin:.1,xmax:.2,ymax:.2}},              // no label
  {label:'person',score:1.4,box:{xmin:.1,ymin:.1,xmax:.2,ymax:.2}},        // not a score
  {label:'bed',score:.95,box:{xmin:-.2,ymin:.3,xmax:1.3,ymax:.7}},         // clamped into the frame
];

test('on-device detections become a frame-bound observation sidecar that passes the shared validator',()=>{
  const sidecar=detectionSidecar({sourceSha256,frame,detections:raw,configSha256:sha(DETECTION_CONFIG)});
  const session=importObservations(JSON.stringify(sidecar),[binding]);
  assert.deepEqual(session.observations.map(o=>o.label),['bed','chair','dining table']);
  assert.deepEqual(session.observations[0].box,[0,.3,1,.7]);
  assert.equal(session.model.id,DETECTOR.id);assert.equal(session.model.revision,DETECTOR.revision);
  assert.equal(session.model.promptSha256,sha(DETECTION_CONFIG));
  assert.ok(session.observations.every(o=>/not a calibrated probability/.test(o.uncertainty)&&/not evidence of free space/.test(o.uncertainty)));
  assert.ok(session.reviews.every(r=>r.status==='pending'),'every suggestion waits for review');
});

test('a review decision is recorded in the proof without changing the model original',()=>{
  const session=importObservations(JSON.stringify(detectionSidecar({sourceSha256,frame,detections:raw,configSha256:sha(DETECTION_CONFIG)})),[binding]);
  const accepted=reviewObservation(session,'object-2',{action:'accept'},[binding],{now:()=>'2026-10-22T13:00:00.000Z'});
  const proof=exportObservationProof(accepted,[binding],{now:()=>'2026-10-22T13:00:01.000Z'});
  assert.equal(proof.sidecar.observations.find(o=>o.id==='object-2').label,'chair');
  assert.equal(proof.reviews.find(r=>r.observationId==='object-2').status,'accepted');
});

test('detections are bounded, and the frame must match the bound source',()=>{
  const many=Array.from({length:40},(_,i)=>({label:'chair',score:.71+i/1000,box:{xmin:.1,ymin:.1,xmax:.2,ymax:.2}}));
  assert.equal(detectionSidecar({sourceSha256,frame,detections:many,configSha256:sha('x')}).observations.length,DETECTOR.maxDetections);
  assert.equal(detectionSidecar({sourceSha256,frame,detections:null,configSha256:sha('x')}).observations.length,0);
  assert.equal(detectionBox({xmin:NaN,ymin:0,xmax:1,ymax:1}),null);
  const otherFrame={...binding,frames:[{id:'photo',...frame,sha256:sha('different png'),timestamp:null}]};
  assert.throws(()=>importObservations(JSON.stringify(detectionSidecar({sourceSha256,frame,detections:raw,configSha256:sha('x')})),[otherFrame]),/unbound or stale/);
});
