// Deterministic encoder lifecycle tests. The fake canvas is not reconstruction or media evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraPath } from '../../brainsnn-r3f-app/public/world/camera-path.mjs';
import { CAMERA_TOUR_VIDEO, cameraTourLayout, recordCameraTour } from '../../brainsnn-r3f-app/public/world/camera-tour-video.mjs';

const path=()=>createCameraPath({source:{name:'authored-renderer-fixture.ply',bytes:17,sha256:'a'.repeat(64)},provenance:'authored',keyframes:[
  {time:0,eye:[0,1,3],target:[0,0,0],fov:60},
  {time:.5,eye:[1,1,3],target:[0,0,0],fov:50},
]});

async function withRecorder(options,run) {
  const globals=['document','MediaRecorder','requestAnimationFrame','cancelAnimationFrame','performance'];
  const prior=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let clock=0,tick=0,stoppedTracks=0,recorder;
  const pending=new Set(),drawn=[],texts=[],views=[];
  const source=Object.assign(new EventTarget(),{width:640,height:480});
  const doc=Object.assign(new EventTarget(),{hidden:false});
  const g={fillRect(){},drawImage(canvas,...box){drawn.push({canvas,box});},measureText(text){return{width:text.length*10};},fillText(text){texts.push(text);}};
  const stream={getTracks:()=>[{stop(){stoppedTracks++;}}],getVideoTracks:()=>[{requestFrame(){}}]};
  doc.createElement=()=>({getContext:()=>g,captureStream:()=>stream});
  const initial={eye:[9,8,7],target:[0,0,0],fov:42};
  const viewer={getCanvas:()=>source,getView:()=>structuredClone(initial),setView(view){views.push(structuredClone(view));if(options.firstPaintError)throw Error('authored first paint failure');}};
  class FakeRecorder {
    static isTypeSupported(type){return (options.supported||['video/webm']).includes(type);}
    constructor(_stream,config){recorder=this;this.state='inactive';this.mimeType=config.mimeType;}
    start(){this.state='recording';}
    stop(){
      this.state='inactive';
      queueMicrotask(()=>{
        if(options.encoderError)this.onerror?.({error:Error('authored fake encoder failure')});
        this.ondataavailable?.({data:options.oversize?{size:CAMERA_TOUR_VIDEO.maxBytes+1}:new Blob([options.empty||options.emptyTypes?.includes(this.mimeType)?'':'authored fake encoded bytes'])});
        this.onstop?.();
      });
    }
  }
  Object.defineProperties(globalThis,{
    document:{value:doc,configurable:true},MediaRecorder:{value:FakeRecorder,configurable:true},
    performance:{value:{now:()=>clock},configurable:true},
    requestAnimationFrame:{value:fn=>{
      const id=setTimeout(()=>{pending.delete(id);clock+=250;tick++;options.beforeFrame?.({source,doc,viewer,recorder,tick});fn(clock);},0);
      pending.add(id);return id;
    },configurable:true},
    cancelAnimationFrame:{value:id=>{clearTimeout(id);pending.delete(id);},configurable:true},
  });
  try{await run({viewer,source,doc,drawn,texts,views,initial,get stoppedTracks(){return stoppedTracks;},get pendingFrames(){return pending.size;}});}
  finally{
    for(const id of pending)clearTimeout(id);
    for(const key of globals){const descriptor=prior.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
}

test('letterboxing preserves source aspect inside the reserved provenance captions',()=>{
  const box=cameraTourLayout(640,480);
  assert.ok(Math.abs(box.width/box.height-640/480)<1e-12);assert.ok(Math.abs(box.height-500)<1e-9);
  assert.ok(box.y>=82-1e-9&&box.y+box.height<=582+1e-9);
  assert.throws(()=>cameraTourLayout(0,480),/no drawable pixels/);
});

test('records actual viewer frames, captions and detached provenance; restores view and cleans stream',async()=>{
  await withRecorder({},async env=>{
    const requested=path(),result=await recordCameraTour({path:requested,viewer:env.viewer});
    assert.ok(result.blob.size>0);assert.equal(result.type,'video/webm');assert.equal(result.seconds,.5);
    assert.ok(env.drawn.length>=3);assert.ok(env.drawn.every(draw=>draw.canvas===env.source));
    assert.deepEqual(env.views.at(-1),env.initial);
    assert.equal(result.receipt.source.sha256,'a'.repeat(64));
    assert.equal(result.receipt.physicalAccuracyVerified,false);assert.equal(result.receipt.metricScaleVerified,false);
    assert.equal(result.receipt.recording.sourceCanvasWidth,640);assert.equal(result.receipt.recording.sourceCanvasHeight,480);
    assert.equal(result.receipt.recording.encodedDurationVerified,false);
    assert.equal(result.receipt.recording.constantFrameRateVerified,false);
    assert.equal(result.receipt.recording.audio,false);assert.equal(result.receipt.recording.elapsedSeconds,.5);
    assert.ok(env.texts.includes('Authored asset (declared)'));
    assert.ok(env.texts.includes('Appearance only · Scale unverified'));
    assert.ok(env.texts.includes('Source SHA-256 '+'a'.repeat(64)));
    assert.equal(env.stoppedTracks,1);assert.equal(env.pendingFrames,0);
    requested.source.name='changed-after-recording';assert.equal(result.receipt.source.name,'authored-renderer-fixture.ply');
  });
});

test('generated provenance remains readable in each composited frame',async()=>{
  await withRecorder({},async env=>{
    const generated=path();generated.provenance='generated';
    await recordCameraTour({path:generated,viewer:env.viewer});
    assert.equal(env.texts.filter(text=>text==='GENERATED APPEARANCE (declared)').length,env.drawn.length);
  });
});

for(const [name,options,pattern] of [
  ['resize',{beforeFrame:({source,tick})=>{if(tick===1)source.width++;}},/resized/],
  ['hidden tab',{beforeFrame:({doc,tick})=>{if(tick===1){doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));}}},/became hidden/],
  ['context loss',{beforeFrame:({source,tick})=>{if(tick===1)source.dispatchEvent(new Event('webglcontextlost'));}},/context was lost/],
  ['source replacement',{beforeFrame:({viewer,tick})=>{if(tick===1)viewer.getCanvas=()=>({width:640,height:480});}},/source changed/],
  ['preview lamp starts',{beforeFrame:({viewer,tick})=>{if(tick===1)viewer.getCaptureCanvas=()=>null;}},/source changed/],
  ['encoder error',{encoderError:true},/fake encoder failure/],
  ['empty output',{empty:true},/empty video/],
  ['bounded output',{oversize:true},/64 MiB/],
])test(`rejects ${name} and always stops tracks without restoring a stale view`,async()=>{
  await withRecorder(options,async env=>{
    await assert.rejects(recordCameraTour({path:path(),viewer:env.viewer}),pattern);
    assert.equal(env.stoppedTracks,1);assert.equal(env.pendingFrames,0);
    assert.notDeepEqual(env.views.at(-1),env.initial);
  });
});

test('source-reset cancellation stops recording without restoring the previous source view',async()=>{
  const controller=new AbortController();
  await withRecorder({beforeFrame:({tick})=>{if(tick===1)controller.abort();}},async env=>{
    await assert.rejects(recordCameraTour({path:path(),viewer:env.viewer,signal:controller.signal}),{name:'AbortError'});
    assert.equal(env.stoppedTracks,1);assert.equal(env.pendingFrames,0);
    assert.notDeepEqual(env.views.at(-1),env.initial);
  });
});

test('rejects a one-keyframe draft before opening a media stream',async()=>{
  await withRecorder({},async env=>{
    const draft=createCameraPath({source:path().source,keyframes:[path().keyframes[0]]});
    await assert.rejects(recordCameraTour({path:draft,viewer:env.viewer}),/at least two views/);
    assert.equal(env.stoppedTracks,0);assert.equal(env.drawn.length,0);
  });
});

test('does not fall back to a lit viewer canvas when its capture gate rejects it',async()=>{
  await withRecorder({},async env=>{
    env.viewer.getCaptureCanvas = () => null;
    await assert.rejects(recordCameraTour({path:path(),viewer:env.viewer}),/no drawable pixels/);
    assert.equal(env.viewer.getCanvas(),env.source);
    assert.equal(env.stoppedTracks,0);
    assert.equal(env.drawn.length,0);
  });
});

test('first paint failure preserves the rendering error and releases the unstarted stream immediately',async()=>{
  await withRecorder({firstPaintError:true},async env=>{
    await assert.rejects(recordCameraTour({path:path(),viewer:env.viewer}),/authored first paint failure/);
    assert.equal(env.stoppedTracks,1);assert.equal(env.pendingFrames,0);assert.equal(env.drawn.length,0);
  });
});

test('an advertised MP4 recorder that emits no bytes is retried once as WebM from the starting view',async()=>{
  await withRecorder({supported:['video/mp4','video/webm;codecs=vp9'],emptyTypes:['video/mp4']},async env=>{
    const result=await recordCameraTour({path:path(),viewer:env.viewer});
    assert.equal(result.type,'video/webm;codecs=vp9');
    assert.equal(result.receipt.recording.mimeType,'video/webm;codecs=vp9');
    assert.ok(result.blob.size>0);
    assert.deepEqual(env.views.at(-1),env.initial,'the view returns to where the visitor started');
    const firstFrames=env.views.filter(view=>view.fov===60).length;
    assert.ok(firstFrames>=2,'both attempts start from the first keyframe');
  });
});

test('an empty recording with no other container to try still fails honestly',async()=>{
  await withRecorder({supported:['video/mp4;codecs=avc1.42E01E','video/mp4'],emptyTypes:['video/mp4;codecs=avc1.42E01E','video/mp4']},async env=>{
    await assert.rejects(recordCameraTour({path:path(),viewer:env.viewer}),/empty video/);
  });
  await withRecorder({supported:['video/webm'],empty:true},async env=>{
    await assert.rejects(recordCameraTour({path:path(),viewer:env.viewer}),/empty video/);
  });
});
