import {requestRobotTaskDraft} from './robot-task-authoring.mjs';
import {mountRobotTask, robotTaskMarkup} from './robot-task-panel.mjs';
import {mountScanWorkspace, scanPanel} from './scan-workspace.mjs';
import {mountOpen4DGSTool,open4dgsPanel} from './open4dgs-tool.mjs';
import {mountStereoDepth,stereoDepthPanel} from './stereo-depth-tool.mjs';
import {biomechanicsPanel,mountBiomechanicsTool} from './biomechanics-tool.mjs';
import {parsePLY,STRIDE,MAX_POINTS} from './visual-geometry.mjs';
import {createVisualViewer} from './visual-viewer.mjs';
import {createLayerJobRunner} from './layer-job-client.mjs';
import {hashBytes,jsonBytes,validateMotionPreview,validateLocalizationMap,localizationBinding,validateLocalizationRecording,validateLocalizationTelemetry,createMotionViewer,createLocalizationViewer} from './layer-preview.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsonFile=(value,name)=>new File([JSON.stringify(value)],name,{type:'application/json'});
const IDENTITY=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const Z_TO_Y=[[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]];
const titles = {
  repair: ['Repair appearance', 'Repair a selected area'],
  localization: ['Find my robot', 'See position and tracking'],
  motion: ['Try a movement', 'Compare human and robot motion'],
  biomechanics: ['Understand movement', 'Explore body and muscle geometry'],
  open4dgs: ['Watch a moving scene', 'Play and look around in 3D'],
  stereo: ['See depth with two photos', 'Compare two camera views'],
  scanedit: ['Arrange a room', 'Pick up, move and light objects'],
  robottask: ['Make a robot task', 'Give a robot a goal to try'],
};

/** Native tools inside the shared workspace. Remote files use their original private client. */
export function mountWorldLayerTools({root,getConnection,getResults,getResult,rememberResult,connect,getDraftToken,onChange=()=>{}}) {
  const abort=new AbortController(),signal=abort.signal;
  let disposed=false,epoch=0,active=null,busy=false,repair=null,selection=new Set(),selecting=false,drag=null,repairViewer=null;
  let map=null,mapRaw=null,mapBinding=null,mapPoints=null,recording=null,motion=null,motionViewer=null,mapViewer=null,live=null,lastResults='';
  root.className='world-layer-tools';
  root.innerHTML=`<div class="layer-tools-heading"><div><p class="eyebrow">MORE WAYS TO USE YOUR WORLD</p><h3>Make it yours.</h3></div><button type="button" data-layer-connect>Connect processing</button></div>
    <div class="layer-tool-choices" role="tablist" aria-label="World tools">${Object.entries(titles).map(([id,[label,description]],i)=>`<button type="button" id="layer-tab-${id}" role="tab" aria-selected="false" aria-controls="layer-panel-${id}" tabindex="${i?'-1':'0'}" data-layer-tab="${id}"><strong>${label}</strong><span>${description}</span></button>`).join('')}</div>
    <section id="layer-panel-repair" role="tabpanel" aria-labelledby="layer-tab-repair" hidden>
      <p>Open a Gaussian capture, select the area to repair, then compare the result. Your original stays unchanged.</p>
      <div class="layer-input-row"><label>Open Gaussian PLY<input data-repair-file type="file" accept=".ply"></label><label>Or use a result from this workspace<select data-layer-result="repair"><option value="">Choose a result</option></select></label><button type="button" data-layer-use="repair">Open selected result</button></div>
      <div class="layer-stage"><canvas data-repair-canvas aria-label="Gaussian appearance preview. Use selection mode to drag a rectangle." tabindex="0"></canvas><div data-repair-box class="layer-selection-box" hidden></div></div>
      <div class="layer-toolbar"><button type="button" data-repair-select aria-pressed="false">Select an area</button><button type="button" data-repair-clear>Clear selection</button><button type="button" data-repair-before>Show original</button><button type="button" data-repair-after disabled>Show repaired</button></div>
      <details><summary>Select with numbers · keyboard friendly</summary><p class="layer-note">Set a rectangle as percentages of this view. Left and top start at zero.</p><div class="layer-input-row"><label>Left · %<input data-repair-left type="number" min="0" max="100" value="40"></label><label>Top · %<input data-repair-top type="number" min="0" max="100" value="40"></label><label>Right · %<input data-repair-right type="number" min="0" max="100" value="60"></label><label>Bottom · %<input data-repair-bottom type="number" min="0" max="100" value="60"></label><button type="button" data-repair-rectangle>Select this rectangle</button></div></details><p data-repair-info class="layer-note">Choose a Gaussian PLY, up to 64 MiB and 200,000 source points.</p>
      <p class="layer-note">Selection passes through all depths. Turn the view and check the highlighted area before repairing. This preview shows basic colour; the saved file keeps the full Gaussian appearance.</p>
      <details><summary>Repair settings</summary><div class="layer-input-row"><label>Method<select data-repair-mode><option value="auto">Choose automatically</option><option value="rim">Fill from the edge</option><option value="patch">Copy a nearby patch</option></select></label><label>Detail density<input data-repair-density type="number" min="0.25" max="2" step="0.25" value="1"></label><label>Repeatable seed<input data-repair-seed type="number" min="0" max="4294967295" step="1" value="0"></label></div></details>
      <label class="layer-check"><input data-repair-consent type="checkbox"><span>I checked this selection and agree to send the original file for appearance repair.</span></label>
      <button type="button" class="primary" data-repair-run>Repair selected area</button>
      <p class="layer-note">A repaired surface is an appearance edit. Measurements, drawings and robot maps keep their original evidence.</p>
    </section>
    <section id="layer-panel-localization" role="tabpanel" aria-labelledby="layer-tab-localization" hidden>
      <p>Prepare a map from a measured LiDAR scan, then open a robot recording or connect its live position stream.</p>
      <details open><summary>1. Prepare a robot map</summary><div class="layer-input-row"><label>Measured scan · PLY<input data-localization-file type="file" accept=".ply"></label><label>Scan’s up direction<select data-localization-axis><option value="right-handed-z-up">Z is up · ROS / LiDAR</option><option value="right-handed-y-up">Y is up</option></select></label><label>Point spacing · metres<input data-localization-voxel type="number" value="0.05" min="0.01" max="1" step="0.01"></label></div>
        <details><summary>Align to an existing building model</summary><label>Building model<select data-layer-scene><option value="">Use the scan’s own coordinates</option></select></label><label>Reviewed source-to-model transform · 4 × 4<textarea data-localization-transform rows="4">${JSON.stringify(IDENTITY)}</textarea></label><p class="layer-note">Use a reviewed rigid transform in metres. An identity matrix is correct only when the scan and model already share the same coordinates.</p></details>
        <label class="layer-check"><input data-localization-consent type="checkbox"><span>This is a registered LiDAR scan in metres, and I agree to send it to prepare a map.</span></label><button type="button" class="primary" data-localization-run>Prepare map</button>
      </details>
      <details><summary>2. Open a saved map and recording</summary><div class="layer-input-row"><label>Map bundle JSON + map PLY<input data-localization-map-files type="file" accept=".json,.ply" multiple></label><label>Or use a workspace map<select data-layer-result="localization"><option value="">Choose a map</option></select></label><button type="button" data-layer-use="localization">Open selected map</button><label>Robot recording · JSON<input data-localization-recording type="file" accept=".json,application/json"></label></div></details>
      <details><summary>Connect a live robot position stream</summary><p class="layer-note">Run the supplied ROS 2 bridge near your robot. Use its HTTPS read-only endpoint and a separate access token. This connection displays positions; it cannot drive the robot.</p><div class="layer-input-row"><label>Position endpoint<input data-live-url type="url" placeholder="https://robot.example/v1/localization" autocomplete="off"></label><label>Position access token<input data-live-token type="password" autocomplete="off"></label></div><button type="button" data-live-connect>Connect position stream</button><button type="button" data-live-stop>Disconnect</button></details>
      <div class="layer-stage"><canvas data-localization-canvas aria-label="Measured map and reported robot position, top-down view"></canvas></div>
      <div class="layer-toolbar"><button type="button" data-localization-play>Play recording</button><button type="button" data-localization-pause>Pause</button><label>Recording position<input data-localization-seek type="range" min="0" max="0" value="0"></label></div><p data-localization-info role="status">Open or prepare a measured map to begin.</p>
      <p class="layer-note">Tracking quality is reported by the robot. The map and recording do not certify physical accuracy or safe navigation. Existing routes stay unchanged.</p>
    </section>
    <section id="layer-panel-motion" role="tabpanel" aria-labelledby="layer-tab-motion" hidden>
      <p>Adapt a 3D human movement to Unitree G1, then compare both skeletons at the same moment.</p>
      <div class="layer-input-row"><label>Human motion · SOMA BVH<input data-motion-file type="file" accept=".bvh"></label><label>Source units<select data-motion-units><option value="cm">Centimetres</option><option value="m">Metres</option></select></label><label>Facing convention<select data-motion-facing><option value="Mujoco">MuJoCo</option><option value="Maya">Maya</option></select></label></div>
      <p class="layer-note">Use a SOMA skeleton with Y up, up to 60 seconds and 1,800 frames. Timing comes from the motion file. A regular video needs 3D motion reconstruction first.</p>
      <label class="layer-check"><input data-motion-consent type="checkbox"><span>I have permission to use this motion and agree to send it for retargeting.</span></label><button type="button" class="primary" data-motion-run>Create G1 motion reference</button>
      <details><summary>Open a previous motion reference</summary><div class="layer-input-row"><label>Preview JSON<input data-motion-preview type="file" accept=".json,application/json"></label><label>Or choose a workspace result<select data-layer-result="motion"><option value="">Choose a motion</option></select></label><button type="button" data-layer-use="motion">Open selected motion</button></div></details>
      <div class="layer-stage"><canvas data-motion-canvas aria-label="Synchronized human and G1 reference skeletons. Drag or use left and right arrow keys to turn the view." tabindex="0"></canvas></div>
      <div class="layer-toolbar"><button type="button" data-motion-play>Play movement</button><button type="button" data-motion-pause>Pause</button><label>Movement frame<input data-motion-seek type="range" min="0" max="0" value="0"></label></div><p data-motion-info role="status">Create or open a motion reference to begin.</p>
      <p class="layer-note">Skeletons are shown side by side for comparison. Source motion is retained. This is a movement reference; physics testing and a tracking controller are separate steps.</p>
    </section>
    ${biomechanicsPanel}
    ${open4dgsPanel}
    ${stereoDepthPanel}
    ${scanPanel}
    <section id="layer-panel-robottask" role="tabpanel" aria-labelledby="layer-tab-robottask" hidden>${robotTaskMarkup()}</section>
    <div class="layer-result-footer" hidden><p data-layer-status role="status"></p><button type="button" data-layer-cancel hidden>Cancel processing</button><div data-layer-downloads class="layer-toolbar"></div></div>`;
  const $=s=>root.querySelector(s),on=(selector,event,fn)=>$(selector).addEventListener(event,fn,{signal});
  const status=(message,error=false)=>{$('.layer-result-footer').hidden=false;$('[data-layer-status]').textContent=message;$('[data-layer-status]').classList.toggle('error',error);};
  const attempt=fn=>Promise.resolve().then(fn).catch(error=>{if(!disposed&&error.name!=='AbortError')status(error.message,true);});
  const runner=createLayerJobRunner({getConnection,onComplete:rememberResult,onStatus:status,onBusy(value){busy=value;$('[data-layer-cancel]').hidden=!value;for(const button of root.querySelectorAll('[data-repair-run],[data-localization-run],[data-motion-run],[data-biomech-run]'))button.disabled=value;onChange();}});
  function open(name) {
    if(!Object.hasOwn(titles,name))return;
    active=name;motionViewer?.pause();mapViewer?.pause();biomechanics?.pause();if(name!=='localization')stopLive();
    if(name!=='open4dgs')movingScene.pause();
    if(name!=='stereo')stereo.suspend();
    if(name!=='robottask')robotTask.suspend();
    for(const button of root.querySelectorAll('[data-layer-tab]')){const selected=button.dataset.layerTab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    for(const id of Object.keys(titles))$(`#layer-panel-${id}`).hidden=id!==name;
    if(name==='scanedit')scanWorkspace.open();else scanWorkspace.suspend();
    if(name==='repair'&&!repairViewer)repairViewer=createVisualViewer($('[data-repair-canvas]'),message=>status(message));
    if(name==='motion'&&!motionViewer)motionViewer=createMotionViewer($('[data-motion-canvas]'),(i,t)=>{$('[data-motion-seek]').value=i;$('[data-motion-info]').textContent=`Frame ${i+1} of ${motion?.frame_count||0} · ${t.toFixed(2)} seconds · skeleton reference, no robot control`;});
    if(name==='localization'&&!mapViewer)mapViewer=createLocalizationViewer($('[data-localization-canvas]'),(i,t,state)=>{$('[data-localization-seek]').value=i;$('[data-localization-info]').textContent=`${live?'Live stream':'Recording'} · ${state==='odometry-only'?'motion prediction only':state} · ${t.toFixed(2)} seconds`;});
  }
  function refresh() {
    const results=getResults(),signature=JSON.stringify(results.map(r=>[r.key,r.artifacts.length]));if(signature===lastResults)return;lastResults=signature;
    for(const kind of Object.keys(titles)) {
      const select=$(`[data-layer-result="${kind}"]`);
      if(!select)continue; // local-only tools have no worker result selector
      const chosen=select.value;
      const rows=results.filter(r=>kind==='repair'?r.artifacts.some(a=>a.name.endsWith('.ply')):r.engine===(kind==='motion'?'motion-retarget':kind==='biomechanics'?'biomechanics':'localization-map'));
      select.innerHTML='<option value="">Choose a result</option>'+rows.map(r=>`<option value="${esc(r.key)}">${esc(r.sourceNames.join(', ')||r.engine)} · ${esc(r.id.slice(0,8))}</option>`).join('');select.value=chosen;
    }
    const select=$('[data-layer-scene]'),chosen=select.value;select.innerHTML='<option value="">Use the scan’s own coordinates</option>'+results.filter(r=>r.artifacts.some(a=>a.name==='scene.json')).map(r=>`<option value="${esc(r.key)}">${esc(r.sourceNames.join(', ')||'Building model')} · ${esc(r.id.slice(0,8))}</option>`).join('');select.value=chosen;
  }
  async function read(context,name) {const index=context.job.artifacts.findIndex(a=>a.name===name);if(index<0)throw Error(`This result has no ${name}.`);return context.sourceClient.previewArtifact(context.job,index);}
  function downloads(context) {
    const labels={'original.ply':'original 3D','repaired.ply':'repaired 3D','repair-request.json':'repair settings','repair-mapping.json':'point mapping','repair-receipt.json':'repair receipt','localization-map.pcd':'robot map · PCD','localization-map.ply':'map points · PLY','localization-map.json':'map bundle','localization-edge.zip':'robot setup package','original-motion.bvh':'original motion','normalized-soma.bvh':'normalized motion','retarget-options.json':'motion settings','robot-reference.csv':'G1 motion · CSV','motion-preview.json':'motion preview','motion-reference.json':'motion receipt','original-model.osim':'Original body model','original-motion.mot':'Original motion','analysis-model.osim':'Analysis model','biomechanics-coordinates.csv':'Coordinates CSV','biomechanics-muscles.csv':'Muscle lengths CSV','biomechanics-inverse-dynamics.csv':'Net joint forces CSV','biomechanics-preview.json':'Analysis preview','biomechanics-report.json':'Analysis receipt','biomechanics-options.json':'Analysis options','external-loads.json':'External loads'};
    const container=$('[data-layer-downloads]');container.replaceChildren();
    for(let i=0;i<context.job.artifacts.length;i++){const a=context.job.artifacts[i],button=document.createElement('button');button.type='button';button.textContent=`Save ${labels[a.name]||a.name}`;button.title=a.name;button.addEventListener('click',()=>void attempt(async()=>{const href=await context.sourceClient.download(context.job.id,i);if(disposed)return;const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.click();}),{signal});container.append(button);}
    $('.layer-result-footer').hidden=false;
  }
  function displayed(parsed) {
    const stride=Math.max(1,Math.ceil(parsed.points.length/STRIDE/MAX_POINTS)),rows=[],indices=[];
    for(let i=0;i<parsed.points.length/STRIDE;i+=stride){rows.push(...parsed.points.subarray(i*STRIDE,i*STRIDE+STRIDE));indices.push(i);}
    return {points:new Float32Array(rows),indices};
  }
  function highlight() {
    if(!repair||!repairViewer)return;
    repairViewer.setSelection(repair.display.indices.flatMap((index,i)=>selection.has(index)?[i]:[]));
    $('[data-repair-info]').textContent=`${repair.parsed.total.toLocaleString()} original points · ${selection.size.toLocaleString()} selected${repair.repaired?' · repaired copy available':''}`;
    $('[data-repair-consent]').checked=false;
  }
  function setSelecting(value){selecting=value;$('[data-repair-select]').setAttribute('aria-pressed',String(value));$('[data-repair-select]').textContent=value?'Finish selecting':'Select an area';}
  function showRepair(which){
    if(!repair||which==='repaired'&&!repair.repaired)return;
    if(repair.showing!==which){const view=repairViewer.getView(),parsed=which==='original'?{points:repair.display.points,kind:repair.parsed.kind}:repair.repaired;repairViewer.setPoints(parsed.points,{kind:parsed.kind});repairViewer.setView(view);repair.showing=which;}
    if(which==='original')highlight();
  }
  async function loadRepair(file,token=++epoch,reviewed=null,isCurrent=()=>true) {
    if(file.size>64*1024*1024)throw Error('Use a Gaussian PLY no larger than 64 MiB.');
    const buffer=await file.arrayBuffer(),parsed=parsePLY(buffer,{maxPoints:200000});
    if(parsed.kind!=='gaussian-splat'||parsed.total>200000||parsed.sampled||parsed.skipped)throw Error('Use a complete Gaussian PLY with at most 200,000 finite source points.');
    const sha=await hashBytes(buffer);if(token!==epoch||disposed||!isCurrent())return;
    let selected = new Set();
    if (reviewed) {
      const ids = reviewed.sourceIndices;
      if (reviewed.sourceSha256 !== sha || !Array.isArray(ids) || !ids.length || ids.length > parsed.total ||
          ids.some(id => !Number.isInteger(id) || id < 0 || id >= parsed.total) || new Set(ids).size !== ids.length) {
        throw Error('The selection could not be matched to the original scan. Open the original and select it again.');
      }
      // A complete, unsampled PLY with no skipped rows has one retained row per original vertex.
      selected = new Set(ids);
    }
    open('repair');repair={file,buffer,parsed,sha,display:displayed(parsed),repaired:null,showing:"original"};selection=selected;setSelecting(false);repairViewer.setPoints(repair.display.points,{kind:parsed.kind});$('[data-repair-after]').disabled=true;highlight();
    if (reviewed) {
      $('[data-repair-file]').value='';
      $('[data-layer-result="repair"]').value='';
      status(`Opened “${reviewed.name}” in ${file.name}. Check the highlighted area before choosing whether to send it for repair.`);
      $('#layer-tab-repair').focus();
    } else status('Original ready. Select a small area and check it from another angle.');
  }
  async function loadMap(raw,ply,token=++epoch) {
    const bundle=validateLocalizationMap(jsonBytes(raw,100000)),hash=await hashBytes(raw);
    if(ply.byteLength!==bundle.artifacts['localization-map.ply'].bytes||await hashBytes(ply)!==bundle.artifacts['localization-map.ply'].sha256)throw Error('The map PLY does not match this map bundle.');
    const parsed=parsePLY(ply);if(parsed.kind!=='point-cloud')throw Error('A localization map must contain measured points, not visual Gaussians.');
    if(token!==epoch||disposed)return;stopLive();open('localization');map=bundle;mapRaw=raw;mapBinding=localizationBinding(bundle,hash);mapPoints=parsed.points;recording=null;mapViewer.setMap(mapPoints);$('[data-localization-seek]').max='0';$('[data-localization-info]').textContent=`Map ready · ${parsed.total.toLocaleString()} map points · ${bundle.source.mode==='scan-local'?'scan coordinates':'linked building model'}`;status('Map files checked. Open a matching recording or connect the read-only position stream.');
  }
  async function openResult(context) {
    const token=++epoch;
    if(context.job.engine==='splat-repair') {
      const raw=await read(context,'original.ply'),file=new File([raw],'original.ply');if(token!==epoch)return;await loadRepair(file,token);if(token!==epoch||disposed)return;
      const [edited,receiptRaw]=await Promise.all([read(context,'repaired.ply'),read(context,'repair-receipt.json')]);
      const receipt=jsonBytes(receiptRaw,1024*1024);if(token!==epoch||disposed)return;
      if(receipt.schema!=='brainsnn.splat-repair.v1'||receipt.originalSha256!==repair.sha||receipt.repairedSha256!==await hashBytes(edited)||receipt.appearanceOnly!==true)throw Error('Repair receipt does not match its original and edited files.');
      if(token!==epoch||disposed)return;const parsed=parsePLY(edited);if(parsed.kind!=='gaussian-splat')throw Error('The repair is not a Gaussian asset.');repair.repaired=parsed;showRepair('repaired');$('[data-repair-after]').disabled=false;status('Repaired copy ready. Compare it with the original; your measured world is unchanged.');
    } else if(context.job.engine==='motion-retarget') {
      const raw=await read(context,'motion-preview.json');if(token!==epoch||disposed)return;motion=validateMotionPreview(jsonBytes(raw));open('motion');motionViewer.set(motion);$('[data-motion-seek]').max=motion.frame_count-1;status('Human and G1 reference motion are ready to compare.');
    } else if(context.job.engine==='localization-map') {
      const [raw,ply]=await Promise.all([read(context,'localization-map.json'),read(context,'localization-map.ply')]);if(token!==epoch||disposed)return;await loadMap(raw,ply,token);
    } else if(context.job.engine==='biomechanics'){
      await biomechanics.openResult(context,token);
    } else throw Error('This result is not supported by these workspace tools.');
    if(token===epoch&&!disposed)downloads(context);
  }
  async function run(engine,inputs,sourceJob=null,expectedClient=null) {
    const token=epoch,context=await runner.run({engine,inputs,sourceJob,expectedClient,sourceNames:inputs.filter(i=>['splat','survey','motion','biomech-model','biomech-motion'].includes(i.kind)).map(i=>i.file.name)});
    refresh();if(token!==epoch||disposed){status('Result saved in your files. Your newer view was kept.');return;}await openResult(context);
  }
  const movingScene=mountOpen4DGSTool({root,signal});
  const scanWorkspace = mountScanWorkspace($('[data-scan-host]'), (file, reviewed, isCurrent) => {
    if (disposed || active !== 'scanedit') throw Error('Open Arrange a room to use its selection.');
    // Rewrap the child document’s File so the parser receives a local ArrayBuffer.
    const original = new File([file], file.name, {type:file.type, lastModified:file.lastModified});
    return loadRepair(original, ++epoch, reviewed, isCurrent);
  });
  const robotTask = mountRobotTask({
    root, signal,
    draftWithGemini: options => requestRobotTaskDraft({...options, token: getDraftToken?.()}),
  });
  const stereo=mountStereoDepth({root,signal});
  const biomechanics=mountBiomechanicsTool({root,signal,run,status,intent:()=>{epoch++;},version:()=>epoch,isCurrent:token=>token===epoch&&!disposed,show:()=>open('biomechanics'),read});
  function stopLive(){if(live){clearTimeout(live.timer);clearInterval(live.watchdog);live.controller.abort();live=null;mapViewer?.markStale();$('[data-localization-info]').textContent='Position stream disconnected.';} $('[data-live-token]').value='';}
  async function connectLive() {
    if(!mapBinding)throw Error('Open the exact map bundle before connecting a robot.');
    const url=new URL($('[data-live-url]').value),token=$('[data-live-token]').value;
    if(url.username||url.password||url.hash||url.search||url.pathname!=='/v1/localization'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use an HTTPS /v1/localization endpoint, or a loopback endpoint for local testing.');
    if(!/^[\x21-\x7e]{32,128}$/.test(token))throw Error('Use the separate position token supplied by your robot bridge.');
    stopLive();const connection={controller:new AbortController(),timer:null,watchdog:null,lastStamp:0n,lastChange:performance.now(),binding:{...mapBinding}};live=connection;$('[data-live-token]').value='';
    const poll=async()=>{
      if(live!==connection||disposed)return;
      try {
        const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),5000),relay=()=>deadline.abort();connection.controller.signal.addEventListener('abort',relay,{once:true});
        let response,buffer;
        try {response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:deadline.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});const reader=response.body?.getReader();if(!reader)throw Error('Empty position response.');const parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('Position response is too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}buffer=bytes.buffer;}
        finally{clearTimeout(timer);connection.controller.signal.removeEventListener('abort',relay);}
        if(live!==connection)return;if(response.status!==200&&response.status!==409)throw Error(`Position connection refused (${response.status}).`);
        const value=validateLocalizationTelemetry(jsonBytes(buffer,65536),connection.binding);
        if(value.sample){const stamp=BigInt(value.sample.timestampNs);if(stamp<connection.lastStamp)throw Error('Position timestamps moved backwards.');if(stamp>connection.lastStamp){connection.lastStamp=stamp;connection.lastChange=performance.now();}}
        const state=performance.now()-connection.lastChange>2500?'stale':value.state;mapViewer.setLive(value.sample,state);$('[data-localization-info]').textContent=`Live position stream · ${state==='odometry-only'?'motion prediction only':state}`;
      } catch(error) {if(live!==connection)return;mapViewer?.markStale();$('[data-localization-info]').textContent=`Position stream unavailable · ${error.message}`;}
      if(live===connection)connection.timer=setTimeout(poll,500);
    };open('localization');connection.watchdog=setInterval(()=>{if(live===connection&&performance.now()-connection.lastChange>2500){mapViewer?.markStale();$('[data-localization-info]').textContent='Live position stream · stale';}},250);void poll();
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.layerTab){epoch++;open(button.dataset.layerTab);return;}
    if(button.dataset.layerUse)void attempt(async()=>{const kind=button.dataset.layerUse,key=$(`[data-layer-result="${kind}"]`).value;if(!key)throw Error('Choose a workspace result first.');const context=getResult(key);if(kind==='repair'&&context.job.engine!=='splat-repair'){const token=++epoch,artifact=context.job.artifacts.find(a=>a.name.endsWith('.ply')),raw=await read(context,artifact.name);if(token!==epoch||disposed)return;await loadRepair(new File([raw],artifact.name),token);}else await openResult(context);});
  },{signal});
  root.querySelector('[role="tablist"]').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...root.querySelectorAll('[data-layer-tab]')],at=buttons.indexOf(document.activeElement);if(at<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length;buttons[next].click();buttons[next].focus();},{signal});
  on('[data-layer-connect]','click',connect);on('[data-layer-cancel]','click',()=>void attempt(()=>runner.cancel()));
  on('[data-repair-file]','change',event=>void attempt(()=>{const file=event.target.files[0];if(file)return loadRepair(file);}));
  on('[data-repair-select]','click',()=>{if(!repair)return status('Open a Gaussian PLY first.',true);setSelecting(!selecting);if(selecting)showRepair("original");});
  on('[data-repair-clear]','click',()=>{epoch++;selection.clear();showRepair('original');highlight();});
  on('[data-repair-before]','click',()=>showRepair('original'));
  on('[data-repair-after]','click',()=>{setSelecting(false);showRepair('repaired');});
  const repairCanvas=$('[data-repair-canvas]');
  on('[data-repair-rectangle]','click',()=>void attempt(()=>{
    if(!repair)throw Error('Open a Gaussian PLY first.');
    const [left,top,right,bottom]=['left','top','right','bottom'].map(k=>Number($(`[data-repair-${k}]`).value));
    if([left,top,right,bottom].some(n=>!Number.isFinite(n)||n<0||n>100)||left>=right||top>=bottom)throw Error('Use a rectangle between 0 and 100%, with left before right and top before bottom.');
    showRepair('original');const r=repairCanvas.getBoundingClientRect();epoch++;
    selection=new Set(repairViewer.selectPointsRectangle(repair.parsed.points,{left:r.left+r.width*left/100,top:r.top+r.height*top/100,right:r.left+r.width*right/100,bottom:r.top+r.height*bottom/100}));highlight();
  }));
  repairCanvas.addEventListener('pointerdown',event=>{if(!selecting||!repair)return;event.preventDefault();event.stopImmediatePropagation();showRepair("original");drag={x:event.clientX,y:event.clientY};repairCanvas.setPointerCapture(event.pointerId);},{signal,capture:true});
  repairCanvas.addEventListener('pointermove',event=>{if(!drag)return;event.preventDefault();event.stopImmediatePropagation();const r=repairCanvas.getBoundingClientRect(),box=$('[data-repair-box]');box.hidden=false;Object.assign(box.style,{left:`${Math.min(drag.x,event.clientX)-r.left}px`,top:`${Math.min(drag.y,event.clientY)-r.top}px`,width:`${Math.abs(event.clientX-drag.x)}px`,height:`${Math.abs(event.clientY-drag.y)}px`});},{signal,capture:true});
  repairCanvas.addEventListener('pointerup',event=>{if(!drag||!repair)return;event.preventDefault();event.stopImmediatePropagation();const indices=repairViewer.selectPointsRectangle(repair.parsed.points,{left:drag.x,top:drag.y,right:event.clientX,bottom:event.clientY});epoch++;selection=new Set(indices);drag=null;$('[data-repair-box]').hidden=true;highlight();},{signal,capture:true});
  repairCanvas.addEventListener('pointercancel',()=>{drag=null;$('[data-repair-box]').hidden=true;},{signal});
  on('[data-repair-run]','click',()=>void attempt(async()=>{if(!repair||selection.size<30||selection.size>20000||selection.size>repair.parsed.total*.25)throw Error('Select between 30 and 20,000 source points, covering at most one quarter of the capture.');if(!$('[data-repair-consent]').checked)throw Error('Review the selection and approve this upload first.');const options={schema:'brainsnn.splat-repair-request.v1',sourceSha256:repair.sha,method:'fast-fill',selection:{indices:[...selection].map(i=>repair.parsed.sourceIndices[i]).sort((a,b)=>a-b)},parameters:{mode:$('[data-repair-mode]').value,density:Number($('[data-repair-density]').value),seed:Number($('[data-repair-seed]').value)},reviewed:true};await run('splat-repair',[{file:repair.file,kind:'splat'},{file:jsonFile(options,'repair-request.json'),kind:'repair'}]);}));
  on('[data-localization-run]','click',()=>void attempt(async()=>{const token=epoch,file=$('[data-localization-file]').files[0];if(!file)throw Error('Choose a registered LiDAR PLY first.');if(!$('[data-localization-consent]').checked)throw Error('Confirm the scan’s measured units and approve the upload.');if(file.size>64*1024*1024)throw Error('Use a scan no larger than 64 MiB.');const frame=$('[data-localization-axis]').value,key=$('[data-layer-scene]').value,context=key?getResult(key):null,scene=context?.job.artifacts.find(a=>a.name==='scene.json');const options={schema:'brainsnn.localization-request.v1',action:'prepare-map',sceneSha256:scene?.sha256||null,scanSha256:await hashBytes(await file.arrayBuffer()),sourceFrame:frame,sourceToScene:context?JSON.parse($('[data-localization-transform]').value):frame==='right-handed-z-up'?Z_TO_Y:IDENTITY,declaration:{kind:'registered-lidar',units:'m',registered:true},baseFrame:'base_link',voxelMeters:Number($('[data-localization-voxel]').value)};if(token!==epoch||disposed)throw Error('Your scan settings changed. Review them and start again.');const connection=await getConnection();if(context&&context.sourceClient!==connection.client)throw Error('Connect to this model’s original processing service before preparing its map.');await run('localization-map',[{file,kind:'survey'},{file:jsonFile(options,'localization-request.json'),kind:'localization'}],context?.job.id||null,context?.sourceClient||null);}));
  on('[data-localization-map-files]','change',event=>void attempt(async()=>{const token=++epoch,files=[...event.target.files],json=files.find(f=>f.name==='localization-map.json'),ply=files.find(f=>f.name==='localization-map.ply');if(!json||!ply)throw Error('Choose both localization-map.json and localization-map.ply.');if(json.size>100000||ply.size>32*1024*1024)throw Error('Map files exceed their supported size.');const [raw,points]=await Promise.all([json.arrayBuffer(),ply.arrayBuffer()]);if(token!==epoch||disposed)return;await loadMap(raw,points,token);}));
  on('[data-localization-recording]','change',event=>void attempt(async()=>{if(!mapBinding)throw Error('Open the matching map first.');const file=event.target.files[0];if(!file)return;if(file.size>16*1024*1024)throw Error('Recordings are limited to 16 MiB.');const expected=mapBinding,token=epoch,parsed=validateLocalizationRecording(jsonBytes(await file.arrayBuffer(),16*1024*1024),expected);if(token!==epoch||expected!==mapBinding)return;stopLive();recording=parsed;open('localization');mapViewer.setRecording(recording);$('[data-localization-seek]').max=recording.samples.length-1;status('Recording checked against this exact map. Press Play recording.');}));
  on('[data-localization-play]','click',()=>mapViewer?.play());on('[data-localization-pause]','click',()=>mapViewer?.pause());on('[data-localization-seek]','input',event=>mapViewer?.seek(Number(event.target.value)));
  on('[data-live-connect]','click',()=>void attempt(connectLive));on('[data-live-stop]','click',()=>{stopLive();mapViewer?.markStale();$('[data-localization-info]').textContent='Position stream disconnected.';});
  on('[data-motion-run]','click',()=>void attempt(async()=>{const file=$('[data-motion-file]').files[0];if(!file)throw Error('Choose a SOMA BVH motion first.');if(file.size>8*1024*1024)throw Error('Use a BVH no larger than 8 MiB.');if(!$('[data-motion-consent]').checked)throw Error('Confirm motion permission and approve the upload first.');const options={schema:'brainsnn.motion-retarget-options.v1',target:'unitree_g1',source_units:$('[data-motion-units]').value,source_up_axis:'Y',source_facing:$('[data-motion-facing]').value};await run('motion-retarget',[{file,kind:'motion'},{file:jsonFile(options,'retarget-options.json'),kind:'retarget'}]);}));
  on('[data-motion-preview]','change',event=>void attempt(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>32*1024*1024)throw Error('Motion previews are limited to 32 MiB.');const token=++epoch,parsed=validateMotionPreview(jsonBytes(await file.arrayBuffer()));if(token!==epoch||disposed)return;motion=parsed;open('motion');motionViewer.set(motion);$('[data-motion-seek]').max=motion.frame_count-1;status('Motion reference opened locally.');}));
  on('[data-motion-play]','click',()=>motionViewer?.play());on('[data-motion-pause]','click',()=>motionViewer?.pause());on('[data-motion-seek]','input',event=>motionViewer?.seek(Number(event.target.value)));
  root.addEventListener('change',event=>{if(event.target.matches('[data-repair-mode],[data-repair-density],[data-repair-seed],[data-localization-file],[data-localization-axis],[data-localization-voxel],[data-layer-scene],[data-localization-transform],[data-motion-file],[data-motion-units],[data-motion-facing]')){epoch++;for(const input of root.querySelectorAll('[data-repair-consent],[data-localization-consent],[data-motion-consent]'))input.checked=false;}},{signal});
  function followPreviewLink() {
    const target = location.hash;
    const linked = target.replace(/^#layer-tab-/, '');
    if (!target.startsWith('#layer-tab-') || !Object.hasOwn(titles, linked)) return;
    epoch++;
    open(linked);
    // The tab is built here, so scroll after the anchor has been mounted.
    requestAnimationFrame(() => {
      if (!signal.aborted && active === linked && location.hash === target) {
        $(target).scrollIntoView({block:'start',behavior:'instant'});
      }
    });
  }
  window.addEventListener('hashchange',followPreviewLink,{signal});
  followPreviewLink();
  refresh();
  return {refresh,isActive:runner.isActive,openResult,open,suspend(){epoch++;scanWorkspace.suspend();stopLive();mapViewer?.pause();motionViewer?.pause();biomechanics.pause();movingScene.pause();stereo.suspend();robotTask.suspend();},async clear(){epoch++;stopLive();await runner.cancel();repair=null;selection.clear();setSelecting(false);drag=null;$("[data-repair-box]").hidden=true;map=null;mapRaw=null;mapBinding=null;mapPoints=null;recording=null;motion=null;biomechanics.clear();movingScene.clearSession();stereo.clear();robotTask.clear();scanWorkspace.clear();if(active==='scanedit')scanWorkspace.open();repairViewer?.clear();mapViewer?.clear();motionViewer?.clear();for(const input of root.querySelectorAll('input')){if(input.type==='checkbox')input.checked=false;else if(['file','password'].includes(input.type))input.value='';}$('[data-layer-downloads]').replaceChildren();status('Tool session cleared.');},dispose(){disposed=true;epoch++;robotTask.dispose();scanWorkspace.clear();stopLive();runner.dispose();abort.abort();biomechanics.dispose();repairViewer?.destroy();motionViewer?.dispose();mapViewer?.dispose();}};
}
