/** Records only the loaded appearance canvas. No geometry, frames or views are generated. */
import { validateCameraPath, sampleCameraPath, cameraPathReceipt } from './camera-path.mjs';
import { pickMime } from './share-video.mjs';

export const CAMERA_TOUR_VIDEO = Object.freeze({width:1280,height:720,fps:30,maxBytes:64*1024**2,bitrate:6_000_000});

const labels = Object.freeze({
  unknown:'Origin unknown',
  'camera-reconstruction':'Camera reconstruction (declared)',
  generated:'GENERATED APPEARANCE (declared)',
  authored:'Authored asset (declared)',
});
const abortError = message => new DOMException(message, 'AbortError');
const cleanText = value => String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0,150);

/** Aspect-preserving content area. Persistent provenance captions sit outside the image. */
export function cameraTourLayout(width,height) {
  if (!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) throw Error('The appearance canvas has no drawable pixels.');
  const scale=Math.min(1232/width,500/height);
  return {x:(1280-width*scale)/2,y:82+(500-height*scale)/2,width:width*scale,height:height*scale};
}

function fittedText(g,text,x,y,maxWidth) {
  let result=cleanText(text);
  while(result.length>1&&g.measureText(result).width>maxWidth) result=result.slice(0,-2)+'…';
  g.fillText(result,x,y);
}

/**
 * Real-time local recording. seconds is the requested path length, not a measured container
 * duration. The receipt records elapsed time and rendered frame count; it never asserts30fps.
 */
export async function recordCameraTour({path,viewer,onProgress,signal}={}) {
  const recordedPath=validateCameraPath(path);
  const duration=recordedPath.duration;
  if(recordedPath.keyframes.length<2||duration<.25) throw Error('Record at least two views with a path lasting at least 0.25 seconds.');
  if(!viewer?.getCanvas||!viewer?.getView||!viewer?.setView) throw Error('This viewer cannot record a camera tour.');
  if(typeof MediaRecorder==='undefined'||typeof document==='undefined') throw Error('Video recording is unavailable. Try a current Chrome or Safari.');
  if(signal?.aborted) throw abortError('Recording cancelled.');
  if(document.hidden) throw Error('Keep this tab visible while recording the camera tour.');
  const type=pickMime(value=>MediaRecorder.isTypeSupported(value));
  if(!type) throw Error('No supported MP4 or WebM recorder was found on this device.');
  const captureCanvas = () => viewer.getCaptureCanvas ? viewer.getCaptureCanvas() : viewer.getCanvas();
  const source = captureCanvas();
  if(!source?.width||!source?.height) throw Error('The appearance canvas has no drawable pixels.');
  const sourceWidth=source.width,sourceHeight=source.height;
  const initialView=viewer.getView();
  const stage=document.createElement('canvas');
  stage.width=CAMERA_TOUR_VIDEO.width;stage.height=CAMERA_TOUR_VIDEO.height;
  const g=stage.getContext('2d',{alpha:false});
  if(!g||!stage.captureStream) throw Error('Canvas video capture is unavailable on this device.');
  const stream=stage.captureStream(CAMERA_TOUR_VIDEO.fps);
  let recorder,raf=0,watchdog=0,stopWatchdog=0,started=false,stopping=false,finished=false,recordedFrames=0,totalBytes=0,start=0,elapsed=0;
  let rejectFrames,failure=null;
  const chunks=[];
  let stoppedResolve;
  const stopped=new Promise(resolve=>{stoppedResolve=resolve;});
  const fail=error=>{
    if(finished)return;
    failure=error instanceof Error?error:Error(String(error));
    finished=true;cancelAnimationFrame(raf);
    rejectFrames?.(failure);
  };
  const abort=()=>fail(abortError('Camera tour recording cancelled.'));
  const hidden=()=>{if(document.hidden)fail(Error('Recording stopped because the tab became hidden. Keep the tab visible and try again.'));};
  const contextLost=()=>fail(Error('The 3D rendering context was lost. No completed video was exported.'));

  function paint(t) {
    viewer.setView(sampleCameraPath(recordedPath,t));
    if(captureCanvas()!==source)throw Error('The appearance source changed during recording.');
    if(source.width!==sourceWidth||source.height!==sourceHeight)throw Error('The appearance canvas was resized during recording. Keep the view size fixed and try again.');
    const box=cameraTourLayout(source.width,source.height);
    g.fillStyle='#05070b';g.fillRect(0,0,1280,720);
    g.drawImage(source,box.x,box.y,box.width,box.height);
    g.textAlign='left';g.font='600 22px system-ui,sans-serif';g.fillStyle='#68eaff';
    g.fillText('BRAINSNN · WORLD BUILDER',28,36);
    g.textAlign='right';g.font='600 20px system-ui,sans-serif';g.fillStyle=recordedPath.provenance==='generated'?'#ffcf78':'#e8eef8';
    g.fillText(labels[recordedPath.provenance]||labels.unknown,1252,36);
    g.textAlign='left';g.fillStyle='#c7cedb';g.font='18px ui-monospace,monospace';
    fittedText(g,recordedPath.source.name,28,65,880);
    g.textAlign='right';g.fillText(`${t.toFixed(1)} / ${duration.toFixed(1)} s`,1252,65);
    g.textAlign='left';g.font='600 24px system-ui,sans-serif';g.fillStyle='#e8eef8';
    g.fillText('Appearance only · Scale unverified',28,623);
    g.font='20px system-ui,sans-serif';g.fillStyle='#c7cedb';
    g.fillText('No measured accuracy, collision or physical robot validation',28,656);
    g.font='17px ui-monospace,monospace';g.fillStyle='#68eaff';
    g.fillText(`Source SHA-256 ${recordedPath.source.sha256}`,28,692);
    recordedFrames++;
    for(const track of stream.getVideoTracks())track.requestFrame?.();
  }

  async function stopRecorder() {
    stopping=true;
    // A first paint or start() failure has no future stop event to await.
    if(!recorder||(!started&&recorder.state==='inactive'))return;
    if(recorder&&recorder.state!=='inactive')recorder.stop();
    await Promise.race([stopped,new Promise((_,reject)=>{stopWatchdog=setTimeout(()=>reject(Error('The browser did not finish the video container. Try a shorter tour.')),3000);})]);
    clearTimeout(stopWatchdog);
  }

  try {
    recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:CAMERA_TOUR_VIDEO.bitrate});
    recorder.ondataavailable=event=>{
      if(!event.data?.size)return;
      totalBytes+=event.data.size;
      if(totalBytes>CAMERA_TOUR_VIDEO.maxBytes){fail(Error('Recording exceeded the 64 MiB limit. Try a shorter tour.'));return;}
      chunks.push(event.data);
    };
    recorder.onerror=event=>fail(Error(`Video recording failed: ${event.error?.message||'encoder error'}`));
    recorder.onstop=()=>{stoppedResolve();if(!stopping)fail(Error('The video encoder stopped before the tour was complete.'));};
    signal?.addEventListener('abort',abort,{once:true});
    document.addEventListener('visibilitychange',hidden);
    source.addEventListener('webglcontextlost',contextLost);
    await new Promise((resolve,reject)=>{
      rejectFrames=reject;
      try{
        paint(0);recorder.start(250);started=true;start=performance.now();
        watchdog=setTimeout(()=>fail(Error('Recording timed out. Keep this tab visible and try a shorter tour.')),Math.min(90_000,(duration+10)*1000));
        const frame=now=>{
          if(finished)return;
          try{
            if(signal?.aborted){abort();return;}
            const t=Math.min(duration,Math.max(0,(now-start)/1000));
            paint(t);onProgress?.(t/duration);
            if(t>=duration){elapsed=(performance.now()-start)/1000;resolve();}
            else raf=requestAnimationFrame(frame);
          }catch(error){fail(error);}
        };
        raf=requestAnimationFrame(frame);
      }catch(error){fail(error);}
    });
    await stopRecorder();
    if(failure)throw failure;
    if(signal?.aborted)throw abortError('Camera tour recording cancelled.');
    if(totalBytes>CAMERA_TOUR_VIDEO.maxBytes)throw Error('Recording exceeded the 64 MiB limit.');
    const outputType=recorder.mimeType||type;
    const blob=new Blob(chunks,{type:outputType});
    if(!blob.size)throw Error('The browser produced an empty video. No completed video was exported.');
    viewer.setView(initialView);
    finished=true;
    return {blob,type:outputType,seconds:duration,receipt:{
      ...cameraPathReceipt(recordedPath),
      recording:{method:'local-appearance-canvas',mimeType:outputType,bytes:blob.size,width:1280,height:720,
        sourceCanvasWidth:sourceWidth,sourceCanvasHeight:sourceHeight,
        requestedFramesPerSecond:30,requestedPathSeconds:duration,elapsedSeconds:elapsed,renderedFrames:recordedFrames,
        encodedDurationVerified:false,constantFrameRateVerified:false,audio:false,
        captioned:true,sourceGeometryChanged:false,limitations:['The current preview can use sampled points and DC-only Gaussian colour; it is not full view-dependent Gaussian rendering.','Real-time capture can drop frames.','Container duration and frame rate were not independently measured.','Camera path is not checked for collision.']},
    }};
  }finally{
    finished=true;cancelAnimationFrame(raf);clearTimeout(watchdog);clearTimeout(stopWatchdog);
    signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',hidden);
    source.removeEventListener('webglcontextlost',contextLost);
    try{if(recorder?.state!=='inactive')await stopRecorder();}finally{
      clearTimeout(stopWatchdog);stream.getTracks().forEach(track=>track.stop());
      if(recorder){recorder.ondataavailable=null;recorder.onerror=null;recorder.onstop=null;}
    }
  }
}
