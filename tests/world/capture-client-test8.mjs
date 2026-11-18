import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureClient} from '../../brainsnn-r3f-app/public/world/capture-client.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
function stream() {
  const track=new EventTarget(); track.stops=0; track.stop=()=>{track.stops++;};
  return {track,getTracks:()=>[track]};
}
function fixture(options={}) {
  const requests=[],recorders=[],files=[],errors=[],states=[],previews=[],timers=new Set();
  class Recorder {
    static isTypeSupported(type) { return options.supported!==false && type.startsWith('video/mp4'); }
    constructor(source,config) { this.source=source;this.mimeType=config.mimeType;this.state='inactive';recorders.push(this); }
    start() { if(options.startError)throw new Error('Start failed');this.state='recording'; }
    stop() { this.state='inactive'; queueMicrotask(()=>{if(!options.empty)this.ondataavailable?.({data:new Blob(['final'])});this.onstop?.();}); }
    data(data) { this.ondataavailable?.({data:new Blob([data])}); }
  }
  const client=createCaptureClient({Recorder, mediaDevices:{getUserMedia:constraints=>{const pending=deferred();requests.push({...pending,constraints});return pending.promise;}},
    onFile:file=>files.push(file),onError:error=>errors.push(error.message),onState:state=>states.push(state),onStream:source=>{previews.push(source);return options.preview?.(source);},
    maxBytes:options.maxBytes??1000,setTimer:fn=>{timers.add(fn);return fn;},clearTimer:fn=>timers.delete(fn)});
  return {client,requests,recorders,files,errors,states,previews,timers};
}
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));

// Test 8: iPhone Safari bounded codec list validates correctly
test('iPhone Safari bounded codec list validates correctly',async()=>{
  const codecs=['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=hvc1','video/mp4;codecs=av1','video/mp4'];
  for(const c of codecs){
    const f=fixture({supported:true});
    assert.equal(f.client.supported,true);
    assert.equal(await f.client.start(),true);
    assert.equal(f.requests.length,1);
    assert.equal(f.requests[0].constraints.video.facingMode.ideal,'environment');
    assert.equal(f.recorders.length,1);
    assert.equal(f.recorders[0].mimeType,c);
    f.client.stop();
    // Wait for onstop callback to fire and onFile to push the file
    // Use a microtask drain loop to ensure the queueMicrotask chain completes
    // Two microtasks: Recorder.stop() queues one, then onstop calls onFile synchronously
    await new Promise(r=>{
      let drained = false;
      const t = setTimeout(()=>r(), 500);
      const check = ()=>{ if(!drained){ drained=true; queueMicrotask(check); } else { clearTimeout(t); r(); } };
      queueMicrotask(check);
      // Extra microtask to catch any late onstop callbacks
      queueMicrotask(()=>{ if(!drained){ drained=true; queueMicrotask(check); } });
    });
    assert.equal(f.files.length,1);
    assert.match(f.files[0].type,/^video\/mp4/);
  }
  // Unsupported codec
  const f2=fixture({supported:false});
  assert.equal(f2.client.supported,false);
  assert.equal(await f2.client.start(),false);
  assert.equal(f2.requests.length,0);
  // HDR path
  const hdr=fixture({supported:true});
  assert.equal(await hdr.client.start(),true);
  assert.equal(hdr.recorders[0].mimeType,'video/mp4;codecs=avc1.42E01E');
  hdr.client.stop();
  await new Promise(r=>{const t=setTimeout(r,500);queueMicrotask(()=>{clearTimeout(t);r();});});
  assert.equal(hdr.files.length,1);
});
