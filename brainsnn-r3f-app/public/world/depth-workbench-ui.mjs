import {authoredDepthSequence,parseDepthSequence,verifyDepthSource,depthRange,depthColour,probeDepth,depthFramePoints,exportDepthFramePLY,samePixelChange,depthReviewSummary,MAX_DEPTH_SEQUENCE_BYTES} from './depth-sequence.mjs';
import {createLayerJobRunner} from './layer-job-client.mjs';
import {createVisualViewer} from './visual-viewer.mjs';
import {inspectStereoPhoto} from './stereo-photo.mjs';
import {hashSourceFile} from './projects-client.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const metres=value=>`${value.toFixed(value<10?2:1)} m`;
const engines=[['metric-depth-sequence','Photo / video depth · MoGe-2'],['depth-pro-2','Depth Pro 2 · separately licensed worker']];
const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

export function depthWorkbenchMarkup(){return `<div class="depth-workbench">
  <header class="depth-heading"><span class="depth-eyebrow">CAPTURE / DEPTH</span><h3>Review depth across sampled frames</h3><p>Compare your photo or video with its estimated depth. Inspect a frame, read a distance and look around the visible points. Video review uses up to 16 selected frames from a clip of up to 60 seconds.</p></header>
  <div class="depth-actions"><button type="button" data-depth-example>Try an authored example</button><button type="button" data-depth-connect>Connect processing</button></div>
  <div class="depth-inputs">
    <label>Photo or short video<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm" data-depth-source></label>
    <label>Depth engine<select data-depth-engine>${engines.map(([id,label])=>`<option value="${id}" disabled>${label}</option>`).join('')}</select></label>
  </div>
  <p class="depth-note" data-depth-availability>Connect processing to see the engines available to you.</p>
  <label class="depth-check"><input type="checkbox" data-depth-consent><span>Process this selected file using my connected processing service.</span></label>
  <div class="depth-actions"><button type="button" class="primary" data-depth-run disabled>Estimate depth</button><button type="button" data-depth-cancel hidden>Cancel processing</button></div>
  <details class="depth-open"><summary>Open a saved depth result</summary><label>Depth-sequence JSON · up to 16 MiB<input type="file" accept=".json,application/json" data-depth-file></label><label>Results in this workspace<select data-depth-results><option value="">Choose a result</option></select></label><button type="button" data-depth-open-result>Open selected result</button></details>
  <p class="depth-status" data-depth-status role="status">Choose a source, open a saved result, or try the authored example.</p>
  <section data-depth-result hidden aria-label="Depth review">
    <div class="depth-result-head"><div><span class="depth-eyebrow" data-depth-origin></span><h4 data-depth-name></h4></div><span class="depth-badge" data-depth-badge>Estimated metres</span></div>
    <p class="depth-note" data-depth-basis></p>
    <div class="depth-images"><figure><figcaption data-depth-source-caption>Source frame</figcaption><canvas data-depth-image role="img" aria-label="Source frame used for this depth preview"></canvas></figure><figure><figcaption>Estimated depth</figcaption><div class="depth-map"><canvas data-depth-map tabindex="0" aria-label="Depth map. Use arrow keys to inspect a pixel." aria-describedby="depth-probe-help"></canvas><span data-depth-marker hidden></span></div></figure></div>
    <div class="depth-colour-key"><span data-depth-near></span><span class="depth-colour-ramp" aria-hidden="true"></span><span data-depth-far></span><span>Dark = unavailable</span></div>
    <p class="depth-note">The same colour range is used for every frame. Colours beyond the displayed range are clipped; the exported values retain their depth.</p>
    <div class="depth-timeline"><button type="button" data-depth-prev aria-label="Previous depth frame">Previous</button><label>Frame<input type="range" min="0" max="0" step="1" value="0" data-depth-seek></label><button type="button" data-depth-next aria-label="Next depth frame">Next</button></div>
    <p class="depth-frame-label" data-depth-frame-label></p>
    <div class="depth-facts"><div><span>Visible samples</span><strong data-depth-valid></strong></div><div><span>Model input</span><strong data-depth-resolution></strong></div><div><span>Review grid</span><strong data-depth-grid></strong></div></div>
    <p id="depth-probe-help" class="depth-note">Tap a point on the depth map, or focus it and use the arrow keys. Depth is distance along the camera’s forward axis.</p>
    <p class="depth-probe" data-depth-probe role="status">Pick a pixel to read its estimated depth.</p>
    <details><summary>Compare with a known forward distance</summary><p class="depth-note">Use an independently measured distance along the camera’s forward axis to this same point. This checks one sample and does not rescale the scene.</p><label>Measured forward distance · m<input type="number" inputmode="decimal" step="any" min="0.001" max="1000" data-depth-known></label><p data-depth-check-result class="depth-note"></p></details>
    <details data-depth-3d><summary>Look around this frame in 3D</summary><div class="depth-stage"><canvas data-depth-points tabindex="0" aria-label="Depth points. Drag or use the turn buttons to look around."></canvas></div><div class="depth-actions"><button type="button" data-depth-turn="left">Turn left</button><button type="button" data-depth-turn="right">Turn right</button><button type="button" data-depth-reset-view>Reset view</button></div><p class="depth-note">Each frame has its own camera origin. The points have not been aligned into a room or checked for robot collisions.</p></details>
    <details><summary>Check changes between frames</summary><p class="depth-note" data-depth-change></p><p class="depth-note">This compares the same image pixels. Camera movement and moving objects also change depth; this is not an accuracy or stability score.</p></details>
    <div class="depth-actions"><button type="button" data-depth-save-ply>Save this frame’s points</button><button type="button" data-depth-save-json>Save depth result</button><button type="button" data-depth-save-project>Save summary to a project</button><button type="button" data-depth-clear>Clear review</button></div>
    <details><summary>Source and model evidence</summary><dl class="depth-evidence" data-depth-evidence></dl></details>
  </section>
  <p class="depth-footnote">For a shared building or robot map, continue with overlapping-view reconstruction or registered LiDAR, check a known dimension, then review the geometry. Depth Pro 2 requires permission beyond Apple’s published research model licence for use in BrainSNN.</p>
</div>`;}

export function mountDepthWorkbench({root,getConnection,getCapabilities=()=>null,getResults=()=>[],getResult,rememberResult,connect,saveToProject,onChange=()=>{}}){
  const abort=new AbortController(),signal=abort.signal,$=selector=>root.querySelector(selector);
  const on=(selector,type,callback)=>$(selector).addEventListener(type,callback,{signal});
  let sequence=null,rawBytes=null,range=null,artifactSha=null,sourceMatched=false,index=0,pixel=null,epoch=0,paintEpoch=0,disposed=false,busy=false,preparing=null,viewer=null,shown=false,lastResults='',lastCaps='',lastCapabilities=null,sourceBindings=new WeakMap();
  const status=(message,error=false)=>{$('[data-depth-status]').textContent=message;$('[data-depth-status]').classList.toggle('error',error);};
  const attempt=fn=>Promise.resolve().then(fn).catch(error=>{if(!disposed&&error.name!=='AbortError')status(error.message,true);});
  const runner=createLayerJobRunner({getConnection,onComplete:rememberResult,onStatus:status,onBusy(value){busy=value;renderControls();onChange();}});
  function selectedFile(){return $('[data-depth-source]').files[0]||null;}
  function renderControls(){
    const working=busy||!!preparing;
    const selected=$('[data-depth-engine]').selectedOptions[0];
    $('[data-depth-run]').disabled=working||!selectedFile()||!$('[data-depth-consent]').checked||!selected||selected.disabled;
    $('[data-depth-cancel]').hidden=!working;
    for(const selector of ['[data-depth-source]','[data-depth-engine]','[data-depth-consent]'])$(selector).disabled=working;
  }
  function refresh(){
    if(disposed)return;
    const caps=getCapabilities(),signature=JSON.stringify(engines.map(([id])=>[id,!!caps?.engines?.find(e=>e.id===id&&e.available)]));
    if(signature!==lastCaps||caps!==lastCapabilities){
      lastCaps=signature;lastCapabilities=caps;$('[data-depth-consent]').checked=false;
      const select=$('[data-depth-engine]'),previous=select.value;
      for(const option of select.options)option.disabled=!caps?.engines?.some(e=>e.id===option.value&&e.available);
      select.value=[...select.options].find(o=>o.value===previous&&!o.disabled)?.value||[...select.options].find(o=>!o.disabled)?.value||engines[0][0];
      const available=[...select.options].filter(o=>!o.disabled);
      $('[data-depth-availability]').textContent=available.length?`${available.length} depth engine${available.length===1?' is':'s are'} available. MoGe-2 processes video frames independently.`:caps?'Depth processing is not enabled on this connection. Saved results and the example can still be reviewed.':'Connect processing to see the engines available to you.';
    }
    const results=getResults().filter(r=>r.artifacts?.some(a=>a.name==='depth-sequence.json')),resultsSignature=JSON.stringify(results.map(r=>[r.key,r.id]));
    if(resultsSignature!==lastResults){lastResults=resultsSignature;const select=$('[data-depth-results]'),previous=select.value;select.innerHTML='<option value="">Choose a result</option>'+results.map(r=>`<option value="${esc(r.key)}">${esc(r.sourceNames.join(', ')||r.engine)} · ${esc(r.id.slice(0,8))}</option>`).join('');select.value=previous;}
    renderControls();
  }
  function download(name,blob){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),4000);}
  function updateProbe(){
    const frame=sequence?.frames[index];if(!frame)return;
    const marker=$('[data-depth-marker]');marker.hidden=!pixel;
    if(!pixel){$('[data-depth-probe]').textContent='Pick a pixel to read its estimated depth.';$('[data-depth-check-result]').textContent='';return;}
    marker.style.left=`${(pixel.x+.5)/frame.width*100}%`;marker.style.top=`${(pixel.y+.5)/frame.height*100}%`;
    const sample=probeDepth(frame,pixel.x,pixel.y);
    $('[data-depth-probe]').textContent=sample?`Pixel ${pixel.x}, ${pixel.y} · forward depth ${metres(sample.depthMetres)} · distance along the ray ${metres(sample.rayDistanceMetres)}.`:`Pixel ${pixel.x}, ${pixel.y} · no usable depth for this pixel.`;
    const field=$('[data-depth-known]'),known=field.value===''?null:Number(field.value);
    $('[data-depth-check-result]').textContent=known===null?'':!sample?'Pick a pixel with a depth estimate first.':!Number.isFinite(known)||known<=0||known>1000?'Use a positive measured distance up to 1,000 m.':`Estimate minus measurement: ${(sample.depthMetres-known).toFixed(3)} m (${((sample.depthMetres/known-1)*100).toFixed(1)}%). Applies only to this pixel and frame.`;
  }
  function updatePoints(){
    if(!shown||!sequence||!$('[data-depth-3d]').open)return;
    try{
      viewer??=createVisualViewer($('[data-depth-points]'));
      const points=depthFramePoints(sequence.frames[index],range);
      if(points.length)viewer.setPoints(points,{photo:true,kind:'point-cloud'});else viewer.clear();
    }catch(error){status(error.message,true);}
  }
  function drawPlaceholder(frame,canvas){
    canvas.width=frame.width;canvas.height=frame.height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(frame.width,frame.height);
    for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
      const at=y*frame.width+x,z=frame.depth[at],authored=sequence.engine==='authored-depth-example';
      const colour=authored?(z===null?[19,27,37,255]:z<4?[221,153,86,255]:[(x+y)%8<4?98:91,116,137,255]):[19,27,37,255];image.data.set(colour,at*4);
    }
    ctx.putImageData(image,0,0);
  }
  async function paintSource(frame,token){
    const canvas=$('[data-depth-image]');drawPlaceholder(frame,canvas);
    if(!frame.imageDataUrl)return;
    const [header,base64]=frame.imageDataUrl.split(','),binary=atob(base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:header.slice(5,header.indexOf(';'))});
    const size=await inspectStereoPhoto(blob);
    if(size.width!==frame.width||size.height!==frame.height)throw Error('The source preview dimensions do not match its depth grid.');
    let bitmap;try{bitmap=await createImageBitmap(blob);if(token!==paintEpoch||disposed)return;
      if(bitmap.width!==frame.width||bitmap.height!==frame.height)throw Error('The browser rotated or resized a source preview.');
      canvas.getContext('2d').drawImage(bitmap,0,0);
    }finally{bitmap?.close();}
  }
  function showFrame(next){
    if(!sequence||disposed)return;
    index=Math.max(0,Math.min(sequence.frames.length-1,Math.trunc(Number(next)||0)));const frame=sequence.frames[index];
    if(pixel){pixel.x=Math.min(pixel.x,frame.width-1);pixel.y=Math.min(pixel.y,frame.height-1);}
    $('[data-depth-known]').value='';$('[data-depth-seek]').value=String(index);$('[data-depth-seek]').max=String(sequence.frames.length-1);
    $('[data-depth-prev]').disabled=index===0;$('[data-depth-next]').disabled=index===sequence.frames.length-1;
    const timing=frame.timestampBasis==='still-image'?'still photo':frame.timeSeconds===null?'source time unavailable':sequence.engine==='authored-depth-example'?`authored time ${frame.timeSeconds.toFixed(2)} s`:`source time ${frame.timeSeconds.toFixed(3)} s`;
    $('[data-depth-frame-label]').textContent=`Frame ${index+1} of ${sequence.frames.length} · ${timing}`;
    $('[data-depth-valid]').textContent=`${frame.depth.filter(z=>z!==null).length.toLocaleString()} / ${frame.depth.length.toLocaleString()}`;
    $('[data-depth-resolution]').textContent=`${frame.inputWidth} × ${frame.inputHeight}`;$('[data-depth-grid]').textContent=`${frame.width} × ${frame.height}`;
    $('[data-depth-source-caption]').textContent=sequence.engine==='authored-depth-example'?'Authored illustration':frame.imageDataUrl?'Source frame · review sample':'Source preview unavailable';
    const canvas=$('[data-depth-map]');canvas.width=frame.width;canvas.height=frame.height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(frame.width,frame.height);frame.depth.forEach((z,i)=>image.data.set(depthColour(z,range),i*4));ctx.putImageData(image,0,0);
    const token=++paintEpoch;void paintSource(frame,token).catch(error=>{if(token===paintEpoch&&!disposed)status(error.message,true);});
    const change=samePixelChange(sequence.frames[index-1],frame);
    $('[data-depth-change]').textContent=change?`Against the preceding review frame: median absolute same-pixel change ${metres(change.medianAbsoluteMetres)} across ${change.pairs.toLocaleString()} pairs. No camera-motion compensation.`:'Choose a later frame with matching dimensions to compare pixels.';
    $('[data-depth-save-ply]').disabled=!frame.depth.some(z=>z!==null);updateProbe();updatePoints();
  }
  function adopt(value,hash=null,bytes=null,matched=false){
    sequence=value;rawBytes=bytes;range=depthRange(value);artifactSha=hash;sourceMatched=matched;pixel=null;index=0;
    $('[data-depth-result]').hidden=false;$('[data-depth-name]').textContent=value.source.name;
    const authored=value.engine==='authored-depth-example';
    $('[data-depth-origin]').textContent=authored?'AUTHORED EXAMPLE · NO INFERENCE':matched?'SOURCE FILE MATCHED · DEPTH REVIEW':'IMPORTED DEPTH · DECLARED SOURCE';
    $('[data-depth-badge]').textContent=authored?'Authored geometry':'Estimated metres';
    $('[data-depth-basis]').textContent=authored?'These test frames demonstrate the controls. They are authored geometry, not a camera recording or a model result.':`${value.model.repo} · ${value.temporal.mode==='joint-video'?'Frames processed jointly by the declared video model.':'Frames estimated independently; temporal consistency has not been established.'} Scale is model-estimated and has not been verified.`;
    $('[data-depth-near]').textContent=metres(range.near);$('[data-depth-far]').textContent=metres(range.far);
    const evidence=[['Source SHA-256',value.source.sha256||'Authored example; no source file'],['Source identity',matched?'Checked against the exact file submitted from this tab':authored?'Authored example':'Declared by the producer; original source not independently matched'],['Result SHA-256',hash||'Generated locally for the example'],['Model',value.model.repo],['Model revision',value.model.revision||'Not supplied'],['Model licence',value.model.license],['Depth convention','Camera Z, in estimated metres'],['Registration','No camera trajectory or shared world alignment'],['Inference',authored?'None':value.provenance.inferenceExecuted?'Declared by the producer; not independently attested':'Not declared as executed']];
    $('[data-depth-evidence]').innerHTML=evidence.map(([name,value])=>`<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join('');showFrame(0);
  }
  async function openResult(context){
    const token=++epoch,artifactIndex=context.job.artifacts.findIndex(a=>a.name==='depth-sequence.json'&&a.kind==='evidence');
    if(artifactIndex<0)throw Error('This result has no depth-sequence.json evidence.');
    if(context.job.artifacts[artifactIndex].size>MAX_DEPTH_SEQUENCE_BYTES)throw Error('Depth review files are limited to 16 MiB.');
    const bytes=await context.sourceClient.previewArtifact(context.job,artifactIndex),value=parseDepthSequence(bytes),hash=await sha256(bytes);
    if(token!==epoch||disposed)return;
    if(value.engine!==context.job.engine)throw Error('The depth sequence belongs to a different processing engine.');
    const expected=sourceBindings.get(context);if(expected)verifyDepthSource(value,expected);
    adopt(value,hash,bytes,!!expected);status('Depth result opened. Inspect frames and estimated distances.');
  }
  async function run(){
    const file=selectedFile();if(!file||!$('[data-depth-consent]').checked)throw Error('Choose a source and approve processing it first.');
    const image=/\.(jpe?g|png|webp)$/i.test(file.name),video=/\.(mp4|mov|webm)$/i.test(file.name);
    if(!image&&!video)throw Error('Choose a JPEG, PNG, WebP, MP4, MOV or WebM source.');
    if(file.size<1||file.size>256*1024*1024)throw Error('Use a source no larger than 256 MiB.');
    if(busy||preparing)throw Error('Wait for the current depth task or cancel it first.');
    const engine=$('[data-depth-engine]').value,kind=image?'image':'video',token=++epoch,controller=new AbortController();preparing=controller;renderControls();onChange();
    let expected,connection;
    try{
      connection=await getConnection();
      status('Checking the selected source file…');
      expected={kind,sha256:await hashSourceFile(file,{signal:controller.signal})};
      if(token!==epoch||disposed||controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
    }catch(error){if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');throw error;}
    finally{if(preparing===controller)preparing=null;renderControls();onChange();}
    const context=await runner.run({engine,inputs:[{file,kind}],expectedClient:connection.client,sourceNames:[file.name]});
    sourceBindings.set(context,expected);
    refresh();if(token!==epoch||disposed){status('Depth processing finished. The result is in your workspace files.');return;}await openResult(context);
  }
  function clearReview(){epoch++;paintEpoch++;sequence=null;rawBytes=null;range=null;artifactSha=null;sourceMatched=false;pixel=null;viewer?.clear();$('[data-depth-result]').hidden=true;$('[data-depth-file]').value='';$('[data-depth-known]').value='';status('Depth review cleared.');}
  async function cancelWork(){preparing?.abort();await runner.cancel();status('Depth processing cancelled.');}
  on('[data-depth-connect]','click',()=>connect?.());
  on('[data-depth-source]','change',()=>{epoch++;$('[data-depth-consent]').checked=false;renderControls();});
  on('[data-depth-consent]','change',renderControls);on('[data-depth-engine]','change',()=>{$('[data-depth-consent]').checked=false;renderControls();});
  on('[data-depth-run]','click',()=>void attempt(run));on('[data-depth-cancel]','click',()=>void attempt(cancelWork));
  on('[data-depth-example]','click',()=>{epoch++;adopt(authoredDepthSequence());status('Authored example ready. No source was uploaded and no model ran.');});
  on('[data-depth-file]','change',()=>void attempt(async()=>{const file=$('[data-depth-file]').files[0];if(!file)return;if(file.size<1||file.size>MAX_DEPTH_SEQUENCE_BYTES)throw Error('Choose a depth-sequence JSON file up to 16 MiB.');const token=++epoch,bytes=await file.arrayBuffer(),value=parseDepthSequence(bytes),hash=await sha256(bytes);if(token===epoch&&!disposed){adopt(value,hash,bytes);status('Saved depth opened locally. Model provenance comes from the file.');}}));
  on('[data-depth-open-result]','click',()=>void attempt(async()=>{const key=$('[data-depth-results]').value;if(!key)throw Error('Choose a saved workspace result.');await openResult(getResult(key));}));
  on('[data-depth-prev]','click',()=>showFrame(index-1));on('[data-depth-next]','click',()=>showFrame(index+1));on('[data-depth-seek]','input',()=>showFrame(Number($('[data-depth-seek]').value)));
  on('[data-depth-map]','click',event=>{if(!sequence)return;const frame=sequence.frames[index],rect=event.currentTarget.getBoundingClientRect();pixel={x:Math.max(0,Math.min(frame.width-1,Math.floor((event.clientX-rect.left)/rect.width*frame.width))),y:Math.max(0,Math.min(frame.height-1,Math.floor((event.clientY-rect.top)/rect.height*frame.height)))};$('[data-depth-known]').value='';updateProbe();});
  on('[data-depth-map]','keydown',event=>{if(!sequence||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const frame=sequence.frames[index];pixel??={x:Math.floor(frame.width/2),y:Math.floor(frame.height/2)};pixel.x=Math.max(0,Math.min(frame.width-1,pixel.x+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0)));pixel.y=Math.max(0,Math.min(frame.height-1,pixel.y+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0)));$('[data-depth-known]').value='';updateProbe();});
  on('[data-depth-known]','input',updateProbe);on('[data-depth-3d]','toggle',updatePoints);
  for(const button of root.querySelectorAll('[data-depth-turn]'))button.addEventListener('click',()=>viewer?.rotateYaw(button.dataset.depthTurn==='left'?.2:-.2),{signal});
  on('[data-depth-reset-view]','click',()=>viewer?.reset());
  on('[data-depth-save-ply]','click',()=>{if(sequence)download(`depth-frame-${sequence.frames[index].index}.ply`,new Blob([exportDepthFramePLY(sequence.frames[index],range,{sourceSha256:sequence.source.sha256})],{type:'text/plain'}));});
  on('[data-depth-save-json]','click',()=>{if(sequence)download('depth-sequence.json',new Blob([rawBytes??JSON.stringify(sequence)],{type:'application/json'}));});
  on('[data-depth-save-project]','click',()=>void attempt(()=>{if(!sequence)throw Error('Open a depth review first.');if(!saveToProject)throw Error('Project saving is unavailable in this view.');return saveToProject({name:'brainsnn-depth-review.json',content_text:JSON.stringify(depthReviewSummary(sequence,{artifactSha256:artifactSha,selectedFrame:index,sourceMatched}),null,2)});}));
  on('[data-depth-clear]','click',clearReview);refresh();
  return {refresh,open(){shown=true;refresh();updatePoints();},suspend(){shown=false;epoch++;preparing?.abort();},openResult,
    isActive:()=>!!preparing||runner.isActive(),getReport:()=>sequence?depthReviewSummary(sequence,{artifactSha256:artifactSha,selectedFrame:index,sourceMatched}):null,
    async clear(){await cancelWork();clearReview();sourceBindings=new WeakMap();$('[data-depth-source]').value='';$('[data-depth-consent]').checked=false;renderControls();},
    dispose(){disposed=true;epoch++;paintEpoch++;preparing?.abort();runner.dispose();abort.abort();viewer?.destroy();}};
}
