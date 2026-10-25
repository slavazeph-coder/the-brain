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
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('cancelled permission cannot revive capture or stop a newer stream',async()=>{
  const f=fixture(),old=stream(),current=stream();
  const first=f.client.start(); assert.equal(f.client.state,'requesting');
  assert.equal(await f.client.start(),false); assert.equal(f.requests.length,1);
  f.client.stop({discard:true}); const second=f.client.start();
  f.requests[1].resolve(current);assert.equal(await second,true);
  f.requests[0].resolve(old);assert.equal(await first,false);
  assert.equal(old.track.stops,1);assert.equal(current.track.stops,0);
  assert.deepEqual(f.previews,[current]);assert.equal(f.recorders.length,1);
  assert.equal(f.requests[0].constraints.audio,false);
  f.client.stop({discard:true});await tick();assert.equal(f.files.length,0);assert.equal(f.timers.size,0);
});

test('clear while recorder is stopping discards final chunks and stale callbacks',async()=>{
  const f=fixture(),source=stream(),started=f.client.start();f.requests[0].resolve(source);await started;
  f.recorders[0].data('partial');f.client.stop();f.client.stop({discard:true});await tick();
  f.recorders[0].onerror();assert.equal(f.files.length,0);assert.equal(f.errors.length,0);
  assert.equal(f.client.state,'idle');assert.equal(f.timers.size,0);assert.ok(source.track.stops>0);
});

test('normal stop includes the final chunk in a supported MP4 and releases camera',async()=>{
  const f=fixture(),source=stream(),started=f.client.start();f.requests[0].resolve(source);await started;
  f.recorders[0].data('first');f.client.stop();f.client.stop();await tick();
  assert.equal(f.files.length,1);assert.equal(await f.files[0].text(),'firstfinal');
  assert.match(f.files[0].name,/\.mp4$/);assert.match(f.files[0].type,/^video\/mp4/);
  assert.equal(f.client.state,'idle');assert.equal(f.errors.length,0);assert.equal(f.timers.size,0);
  assert.ok(source.track.stops>0);
});

test('recorder failure and byte limit never publish partial files',async()=>{
  for(const mode of ['error','limit','start']) {
    const f=fixture({maxBytes:8,startError:mode==='start'}),source=stream(),started=f.client.start();f.requests[0].resolve(source);await started;
    if(mode==='error'){f.recorders[0].data('part');f.recorders[0].onerror();}
    if(mode==='limit')f.recorders[0].data('over limit');
    await tick();assert.equal(f.files.length,0);assert.equal(f.errors.length,1,mode);
    assert.ok(source.track.stops>0);assert.equal(f.client.state,'idle');assert.equal(f.timers.size,0);
  }
});

test('duration expiry and camera interruption finalize once; unsupported browser requests no camera',async()=>{
  for(const mode of ['duration','ended']) {
    const f=fixture(),source=stream(),started=f.client.start();f.requests[0].resolve(source);await started;
    if(mode==='duration')[...f.timers][0]();else source.track.dispatchEvent(new Event('ended'));
    await tick();assert.equal(f.files.length,1);assert.equal(f.timers.size,0);
  }
  const f=fixture({supported:false});assert.equal(f.client.supported,false);assert.equal(await f.client.start(),false);assert.equal(f.requests.length,0);
});

test('late preview failure cannot clear a replacement recording',async()=>{
  const pending=deferred();let count=0;const f=fixture({preview:()=>++count===1?pending.promise:undefined});
  const first=f.client.start();f.requests[0].resolve(stream());await tick();f.client.stop({discard:true});
  const second=f.client.start(),source=stream();f.requests[1].resolve(source);assert.equal(await second,true);
  pending.reject(new Error('old preview rejected'));assert.equal(await first,false);
  assert.equal(f.client.state,'recording');assert.equal(source.track.stops,0);assert.equal(f.errors.length,0);
  f.client.stop({discard:true});await tick();
});

test('permission denial, empty output and overflow in the final chunk publish no file',async()=>{
  for(const mode of ['denied','empty','final-overflow']) {
    const f=fixture({empty:mode==='empty',maxBytes:8}),source=stream(),started=f.client.start();
    if(mode==='denied')f.requests[0].reject(new Error('Permission denied'));
    else f.requests[0].resolve(source);
    await started;
    if(mode==='final-overflow')f.recorders[0].data('123456');
    f.client.stop();await tick();
    assert.equal(f.files.length,0,mode);assert.equal(f.errors.length,1,mode);assert.equal(f.client.state,'idle');assert.equal(f.timers.size,0);
  }
});
