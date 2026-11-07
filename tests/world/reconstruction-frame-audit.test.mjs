import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructionFrameAudit,reconstructionFrameCSV} from '../../brainsnn-r3f-app/public/world/reconstruction-frame-audit.mjs';

function example(){
  const sha='a'.repeat(64);
  const frames=Array.from({length:8},(_,i)=>({image:'image_'+String(i).padStart(4,'0')+'.jpg',
    preparation:{preparedSha256:sha},timestamp:null}));
  return {schema:'brainsnn.reconstruction.v1',sources:[{kind:'video',sha256:sha}],
    metric_verified:false,capture:{images:8,registered_images:3,models_found:2,frames},
    cameras:[0,1,5].map(i=>({image:frames[i].image,frame_id:sha}))};
}

test('exports honest per-frame audit with longest gaps and missing telemetry',()=>{
  const audit=reconstructionFrameAudit(example());
  assert.equal(audit.total_frames,8);
  assert.equal(audit.registered_frames,3);
  assert.deepEqual(audit.missing_spans,[{start:2,end:4,length:3},{start:6,end:7,length:2}]);
  assert.equal(audit.original_source_pts_available,false);
  assert.equal(audit.rows[4].registered,false);
  assert.equal(audit.rows[4].blur_score,null);
  assert.equal(audit.rows[4].rejection_reason,null);
  assert.equal(audit.metric_verified,false);
  const csv=reconstructionFrameCSV(example());
  assert.equal(csv.trim().split('\n').length,9);
  assert.match(csv,/4,image_0004.jpg,[a-f0-9]{64},false/);
});

test('rejects partial or ambiguous camera frame lists rather than invent status',()=>{
  const x=example();x.capture.registered_images=4;
  assert.equal(reconstructionFrameAudit(x),null);
  assert.throws(()=>reconstructionFrameCSV(x),/complete/);
  const y=example();y.capture.frames[1].image=y.capture.frames[0].image;
  assert.equal(reconstructionFrameAudit(y),null);
  const z=example();z.cameras[2].image='image_9999.jpg';
  assert.equal(reconstructionFrameAudit(z),null);
});

test('retains legitimate frame timestamps and never uses sample index as PTS',()=>{
  const x=example();x.capture.frames[0].timestamp=0;x.capture.frames[1].timestamp=1.125;
  const audit=reconstructionFrameAudit(x);
  assert.equal(audit.rows[0].source_timestamp_seconds,0);
  assert.equal(audit.rows[1].source_timestamp_seconds,1.125);
  assert.equal(audit.rows[2].source_timestamp_seconds,null);
  assert.equal(audit.original_source_pts_available,false);
});
