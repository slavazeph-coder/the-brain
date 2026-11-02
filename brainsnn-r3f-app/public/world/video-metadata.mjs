// Read only the browser's local metadata. Unsupported codecs still reach the worker's own checks.
export function readVideoMetadata(file) {
  return new Promise(resolve => {
    const node=document.createElement('video'),url=URL.createObjectURL(file);
    let timer;
    const done=value=>{
      clearTimeout(timer);node.onloadedmetadata=node.onerror=null;
      node.removeAttribute('src');node.load();URL.revokeObjectURL(url);resolve(value);
    };
    timer=setTimeout(()=>done(null),8000);
    node.preload='metadata';node.muted=true;
    node.onloadedmetadata=()=>done({
      seconds:Number.isFinite(node.duration)&&node.duration>0?node.duration:null,
      width:node.videoWidth,height:node.videoHeight,
    });
    node.onerror=()=>done(null);node.src=url;
  });
}

// These first-party adapters share sparse_colmap.extract_video / prepare_photo's 256 px minimum.
const RECONSTRUCTION_ENGINES=new Set(['colmap-sparse','colmap-dense-cpu','mapanything-apache','lingbot-map-stream','scene-usd']);
export function videoResolutionIssue(source,engine='colmap-sparse') {
  if(source?.kind!=='video'||!RECONSTRUCTION_ENGINES.has(engine))return null;
  const {width,height}=source;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||Math.min(width,height)>=256)return null;
  return `${source.name||'This video'} is ${width}×${height} pixels. Reconstruction needs at least 256 pixels on the shorter side. Choose the original full-resolution file; enlarging this copy cannot restore its detail. This copy can still be previewed locally.`;
}
