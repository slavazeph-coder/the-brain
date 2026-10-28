import test from 'node:test';
import assert from 'node:assert/strict';
import {readNativeCapture,prepareNativeCapture,nativeCaptureItems,NATIVE_CAPTURE} from '../../brainsnn-r3f-app/public/world/native-capture.mjs';
const entry={id:'colmap-sparse',available:true,input_kinds:['image','video','capture'],max_inputs:12};
const hash=async file=>Buffer.from(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())).toString('hex');
async function fixture(){
  const images=Array.from({length:3},(_,i)=>({kind:'image',file:new File([`unchanged bytes ${i}`],`frame-${i}.png`)}));
  const frames=await Promise.all(images.map(async ({file},i)=>({id:`${i}`,image:file.name,image_sha256:await hash(file),image_size:[400,300],timestamp_seconds:i*.2,tracking_state:'normal',intrinsics:[[330,0,199.5],[0,330,149.5],[0,0,1]],camera_to_world:[[1,0,0,i*.2],[0,1,0,0],[0,0,1,0],[0,0,0,1]]})));
  const bundle={schema:NATIVE_CAPTURE.schema,pose_convention:'arkit-camera-to-world',units:'m',pixel_convention:'integer-centres',frames};
  const capture={kind:'capture',file:new File([JSON.stringify(bundle)],'capture.json')};
  return {images,bundle,capture};
}
const withBundle=(capture,bundle)=>({...capture,file:new File([JSON.stringify(bundle)],'capture.json')});
test('preflight hashes original Files and orders them by capture metadata without rewriting bytes',async()=>{
  const {images,capture}=await fixture(),progress=[];
  const items=await prepareNativeCapture([images[2],capture,images[0],images[1]],entry,{progress:(...p)=>progress.push(p)});
  assert.deepEqual(items,[capture,...images]);assert.deepEqual(progress,[[0,3],[1,3],[2,3],[3,3]]);
  assert.equal(items[1].file,images[0].file);assert.equal(await items[1].file.text(),'unchanged bytes 0');
});
test('wrong engine, videos, missing photos, extra photos and duplicate names cannot become upload items',async()=>{
  const {images,capture}=await fixture();
  assert.throws(()=>nativeCaptureItems([capture,...images],{...entry,input_kinds:['image']}),/supports calibrated/);
  await assert.rejects(prepareNativeCapture([capture,...images,{kind:'video',file:new File(['x'],'walk.mp4')}],entry),/Remove the walkthrough/);
  await assert.rejects(prepareNativeCapture([capture,...images.slice(1)],entry),/frame-0.png/);
  await assert.rejects(prepareNativeCapture([capture,...images,{kind:'image',file:new File(['x'],'extra.png')}],entry),/not listed/);
  await assert.rejects(prepareNativeCapture([capture,...images,images[0]],entry),/same name/);
  await assert.rejects(prepareNativeCapture([capture,capture,...images],entry),/exactly one/);
});
test('changed source fails before any image can be offered for upload',async()=>{
  const {images,capture}=await fixture();images[1]={kind:'image',file:new File(['edited'],images[1].file.name)};
  await assert.rejects(prepareNativeCapture([capture,...images],entry),/frame-1.png differs from the original/);
});
test('metadata preflight rejects unsupported calibration and unsafe frame identities',async()=>{
  for(const mutate of [b=>b.frames[0].image='../photo.png',b=>b.frames[0].tracking_state='limited',b=>b.frames[0].image_sha256='fake',b=>b.frames[1].timestamp_seconds=0,b=>b.frames[0].intrinsics[0][1]=.2,b=>b.frames[0].intrinsics[1][1]=0,b=>b.frames[0].distortion=[0],b=>b.frames[0].image_size=[0,300],b=>b.frames.pop(),b=>b.pose_convention='unknown',b=>b.frames[0].camera_to_world=[]]){
    const {bundle,capture}=await fixture();mutate(bundle);await assert.rejects(readNativeCapture(withBundle(capture,bundle).file));
  }
  await assert.rejects(readNativeCapture(new File(['x'.repeat(NATIVE_CAPTURE.metadataBytes+1)],'capture.json')),/1 MiB/);
  await assert.rejects(readNativeCapture(new File(['{'],'capture.json')),/could not be read/);
});
test('cancellation during local hashing cannot return a stale upload selection',async()=>{
  const {images,capture}=await fixture(),controller=new AbortController();
  await assert.rejects(prepareNativeCapture([capture,...images],entry,{signal:controller.signal,progress:()=>controller.abort()}),{name:'AbortError'});
});
