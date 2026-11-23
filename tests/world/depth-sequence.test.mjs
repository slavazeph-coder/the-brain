import test from 'node:test';
import assert from 'node:assert/strict';
import {authoredDepthSequence,validateDepthSequence,parseDepthSequence,verifyDepthSource,depthRange,depthColour,probeDepth,depthFramePoints,exportDepthFramePLY,samePixelChange,depthReviewSummary,MAX_DEPTH_SEQUENCE_BYTES} from '../../brainsnn-r3f-app/public/world/depth-sequence.mjs';
import {parsePLY,STRIDE} from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const specimen=()=>{
  const value=authoredDepthSequence();
  value.engine='metric-depth-sequence';value.model={repo:'test/explicit-depth',revision:'fixture',license:'fixture'};
  value.source.sha256='a'.repeat(64);value.temporal.mode='independent-frames';
  value.scale.basis='model-estimated';
  for(const frame of value.frames)frame.timestampBasis='source-pts';
  return value;
};

test('depth example distinguishes authored geometry and time from actual inference',()=>{
  const value=authoredDepthSequence();assert.equal(value.provenance.inferenceExecuted,false);assert.equal(value.source.sha256,null);
  assert.equal(value.frames[0].timestampBasis,'authored-time');assert.equal(value.temporal.mode,'authored-fixture');
  const input=JSON.stringify(value),parsed=parseDepthSequence(new TextEncoder().encode(input));assert.deepEqual(parsed,value);
  value.frames[0].depth[600]=99;assert.notDeepEqual(value.frames[0].depth,parsed.frames[0].depth);
});

test('optical Z and ray distance differ away from the principal point; display transform remains right handed',()=>{
  const frame={width:2,height:2,depth:[2,null,4,8],camera:{fx:2,fy:4,cx:0,cy:0}};
  assert.deepEqual(probeDepth(frame,1,1).position,[4,2,8]);assert.equal(probeDepth(frame,1,1).depthMetres,8);
  assert.equal(probeDepth(frame,1,1).rayDistanceMetres,Math.sqrt(84));assert.equal(probeDepth(frame,1,0),null);
  const points=depthFramePoints(frame,{near:2,far:8});assert.equal(points.length,3*STRIDE);
  assert.deepEqual(Array.from(points.slice(STRIDE*2,STRIDE*2+3)),[4,-2,-8]);
});

test('invalid depth and camera data cannot enter a point preview',()=>{
  for(const z of [0,-1,NaN,Infinity,1001,'2']){
    const value=specimen();value.frames[0].depth[100]=z;assert.throws(()=>validateDepthSequence(value),/Depth values/);
  }
  for(const fx of [0,1e-20,Infinity,1e7]){const value=specimen();value.frames[0].camera.fx=fx;assert.throws(()=>validateDepthSequence(value),/intrinsics/);}
  assert.throws(()=>probeDepth(specimen().frames[0],-1,0),/inside/);
});

test('shape, aggregate byte limits and finite pixel provenance are bounded',()=>{
  const value=specimen();value.frames[0].depth.pop();assert.throws(()=>validateDepthSequence(value),/one value/);
  value.frames=Array(33).fill(specimen().frames[0]);assert.throws(()=>validateDepthSequence(value),/1–32/);
  const wide=specimen();wide.frames[0].width=161;assert.throws(()=>validateDepthSequence(wide),/160/);
  const raster=specimen();raster.frames[0].inputHeight=24000000;assert.throws(()=>validateDepthSequence(raster),/24-megapixel/);
  assert.throws(()=>parseDepthSequence(new Uint8Array(MAX_DEPTH_SEQUENCE_BYTES+1)),/16 MiB/);
  assert.throws(()=>parseDepthSequence(new Uint8Array([0xff])),/UTF-8 JSON/);
});

test('missing video PTS stay missing and cannot be relabelled from frame order',()=>{
  const value=specimen();value.frames[0].timestampBasis='not-available';value.frames[0].timeSeconds=null;
  assert.equal(validateDepthSequence(value).frames[0].timeSeconds,null);
  value.frames[0].timeSeconds=0;assert.throws(()=>validateDepthSequence(value),/remain empty/);
  const repeat=specimen();repeat.frames[1].timeSeconds=repeat.frames[0].timeSeconds;assert.throws(()=>validateDepthSequence(repeat),/increasing/);
  const disorder=specimen();disorder.frames[1].index=0;assert.throws(()=>validateDepthSequence(disorder),/indices/);
});

test('a real photo uses no video timestamp and opens as a single depth frame',()=>{
  const value=specimen();value.source.kind='image';value.frames=value.frames.slice(0,1);value.frames[0].timestampBasis='still-image';value.frames[0].timeSeconds=null;
  assert.equal(validateDepthSequence(value).frames[0].timeSeconds,null);
  value.frames[0].timeSeconds=0;assert.throws(()=>validateDepthSequence(value),/no video timestamp/);
});

test('depth identity and measurement claims are fail closed',()=>{
  for(const mutate of [v=>v.scale.verified=true,v=>v.registration.available=true,v=>v.source.sha256='',v=>v.depthConvention='ray-distance',v=>v.units='mm']){
    const value=specimen();mutate(value);assert.throws(()=>validateDepthSequence(value));
  }
  const image=specimen();image.source.kind='image';assert.throws(()=>validateDepthSequence(image),/exactly one/);
  const source=specimen();source.frames[0].timestampBasis='authored-time';assert.throws(()=>validateDepthSequence(source),/timing/);
});

test('source previews cannot load external URLs or active image types',()=>{
  for(const url of ['https://tracker.invalid/image.jpg','data:image/svg+xml;base64,PHN2Zz4=','data:text/html;base64,AAAA']){
    const value=specimen();value.frames[0].imageDataUrl=url;assert.throws(()=>validateDepthSequence(value),/embedded PNG or JPEG/);
  }
});

test('fresh worker output must match the exact selected source hash and kind',()=>{
  const value=specimen();assert.equal(verifyDepthSource(value,{sha256:'a'.repeat(64),kind:'video'}),true);
  assert.throws(()=>verifyDepthSource(value,{sha256:'b'.repeat(64),kind:'video'}),/does not match/);
  assert.throws(()=>verifyDepthSource(value,{sha256:'a'.repeat(64),kind:'image'}),/does not match/);
  assert.equal(depthReviewSummary(value).sourceIdentity,'producer-declared');
  assert.equal(depthReviewSummary(value,{sourceMatched:true}).sourceIdentity,'checked-against-selected-file');
});

test('one sequence-wide colour range retains numerical depths and missing values',()=>{
  const value=specimen(),range=depthRange(value);assert.equal(range.near,2);assert.equal(range.far,5);
  assert.deepEqual(depthColour(null,range),[12,19,30,255]);assert.deepEqual(depthColour(5,range),depthColour(50,range));
  assert.equal(value.frames[0].depth[64*20+20],2);assert.equal(range.valid<range.total,true);
});

test('same-pixel changes exclude unavailable pairs and never claim motion-compensated accuracy',()=>{
  const a={width:2,height:2,depth:[1,null,4,8]},b={width:2,height:2,depth:[2,3,null,11]};
  assert.deepEqual(samePixelChange(a,b),{pairs:2,medianAbsoluteMetres:1,meanAbsoluteMetres:2,motionCompensated:false,accuracyVerified:false});
  assert.equal(samePixelChange(a,{...b,width:3}),null);assert.equal(samePixelChange(null,b),null);
});

test('PLY exports preserve depth geometry, missing samples and source binding',()=>{
  const value=specimen(),frame=value.frames[0],ply=exportDepthFramePLY(frame,depthRange(value),{sourceSha256:value.source.sha256});
  assert.match(ply,/not measured or registered/);assert.match(ply,new RegExp('source_sha256 '+'a'.repeat(64)));
  const parsed=parsePLY(new TextEncoder().encode(ply).buffer);assert.equal(parsed.total,frame.depth.filter(z=>z!==null).length);
  const sample=probeDepth(frame,3,5),first=Array.from(parsed.points.slice(0,3));
  assert.ok(first.every((v,i)=>Math.abs(v-[sample.position[0],-sample.position[1],-sample.position[2]][i])<1e-6));
});

test('project summaries retain provenance without thumbnails, raw samples or capability claims',()=>{
  const value=specimen(),summary=depthReviewSummary(value,{artifactSha256:'b'.repeat(64),selectedFrame:2});
  assert.equal(summary.artifactSha256,'b'.repeat(64));assert.equal(summary.selectedFrame,2);
  assert.equal(summary.measured,false);assert.equal(summary.collisionReady,false);assert.equal(summary.producerAttested,false);
  assert.equal(JSON.stringify(summary).includes('imageDataUrl'),false);assert.ok(JSON.stringify(summary).length<4096);
});
