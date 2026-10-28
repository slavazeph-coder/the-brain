import {SCHEMA,LIMITS,ROBOTS,clone,normalizeWorld,sampleWorld,planningGate,estimate,classifyFile,proofPack,arenaMap,usdScene} from './core.mjs';
import {createRenderer} from './renderer.mjs';
import {WorkerClient} from './worker-client.mjs';
import {automaticReviewArtifact} from './artifact-review.mjs';
import {SYSTEMS} from './catalog.mjs';
import {createVisualViewer} from './visual-viewer.mjs';
import {fromDepth,parseVisualAsset,toPLY,toArenaCloud,STRIDE} from './visual-geometry.mjs';
import {decodePhoto,inferDepth} from './depth-client.mjs';
import {detectObjects,framePng} from './detect-client.mjs';
import {DETECTOR} from './detections.mjs';
import {importWorld} from './import-world.mjs';
import {createObservationReview} from './observation-ui.mjs';
import {createCaptureClient} from './capture-client.mjs';
import {readNativeCapture,prepareNativeCapture,NATIVE_CAPTURE} from './native-capture.mjs';
import {createMeasurementReview} from './measurement-ui.mjs';
import {createBimWorkflow} from './bim-workflow-ui.mjs';
import {proposeWorld,PROPOSAL} from './reconstruction-map.mjs';
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let world=sampleWorld(), tab='world', selected='storage', result=null, baseline=null, epoch=0, planner=null, planning=false;
let robot={...ROBOTS.cleaner,margin:.1}, robotId='cleaner', assumptions={setupMinutes:5,turnSeconds:0,assistanceMinutes:0,robotRate:null,labourRate:null};
let nativeCheckAbort=null;
let sources=[],activeSource=null,events=[],client=null,caps=null,job=null,jobStatus='',remoteAbort=null,poll=null,siteProcessing=null;
let replayFrame=null,replayStart=0,filter='all',renderer=null,cameraHeight=PROPOSAL.cameraHeight;
// Scale calibration: two picked reconstruction points (indices into visual.points) and the distance the user measured between them.
let calibration={visual:null,picks:[],picking:false,distance:''};
const isRemoteActive=()=>nativeCheckAbort||remoteAbort||job&&!['complete','failed','cancelled'].includes(job.status);
let detectAbort=null;
let visualViewer=null,visibleVisual=null,display='visual',depthAbort=null,depthStatus='',artifactAbort=null,connectionAbort=null;
function getVisualViewer(){if(!visualViewer)visualViewer=createVisualViewer($('visual-canvas'));return visualViewer;}
try{renderer=createRenderer($('world-canvas'));}catch(e){status(e.message,true);}
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function event(type,detail){events.push({time:new Date().toISOString(),type,detail});events=events.slice(-200);}
const observations=createObservationReview({getSources:()=>sources,status,event});
const measurements=createMeasurementReview({getWorld:()=>world,status,event,download});
function stopReplay(){cancelAnimationFrame(replayFrame);replayFrame=null;$('replay').textContent='Replay';}
function invalidate(){epoch++;planner?.terminate();planner=null;planning=false;result=null;stopReplay();renderer?.setResult(null);$('scrub').value=0;update();renderMedia();}
function apply(next,message,{review=false}={}){const w=normalizeWorld(next);if(review){w.mapReviewed=false;}measurements.mapChanged(w,{replaced:!review});world=w;invalidate();renderInspector();renderPanel();renderer?.setWorld(world);if(message)status(message);}
function mutate(fn){try{const next=clone(world);fn(next);apply(next,'Map updated. Review changed geometry before planning.',{review:true});event('geometry_edit',selected||'floor');}catch(e){status(e.message,true);renderInspector();renderPanel();}}
// Exports: on touch devices with the Web Share API the files go to the native share sheet (Files, AirDrop, Mail…); anywhere
// else, or if sharing fails, each file downloads. One share per gesture, so multi-file exports pass every file in one call.
function asFile(name,data,type){return new File([data instanceof Blob?data:typeof data==='string'||data instanceof ArrayBuffer||ArrayBuffer.isView(data)?data:JSON.stringify(data,null,2)],name,{type});}
function canShareFiles(files){return navigator.maxTouchPoints>0&&typeof navigator.canShare==='function'&&navigator.canShare({files})&&(iOS()||/Android/.test(navigator.userAgent));}
function saveFiles(files){for(const f of files){const u=URL.createObjectURL(f),a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}}
function deliver(...specs){const files=specs.map(([name,data,type='application/json'])=>asFile(name,data,type));
  if(!canShareFiles(files)){saveFiles(files);return;}
  return navigator.share({files,title:'BrainSNN World Builder'}).then(()=>event('export_shared',files.map(f=>f.name).join(', ')),e=>{if(e?.name!=='AbortError')saveFiles(files);});}
function download(name,data,type){return deliver([name,data,type]);}
// Installable app: Chromium hands us the prompt; iOS Safari has no API, so the button explains Share → Add to Home Screen.
let installPrompt=null;
function standalone(){return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;}
function iOS(){return /iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
function installable(){return !standalone()&&(installPrompt||iOS());}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;renderPanel();});
window.addEventListener('appinstalled',()=>{installPrompt=null;event('app_installed','home screen');renderPanel();});
// Home-screen installs act on the top-level page. Inside the homepage iframe that is the site shell, so open this app's
// own document at the top level first, where its manifest and offline shell apply.
function framed(){try{return window.top!==window.self;}catch{return true;}}
async function installApp(){if(framed()){window.top.location.href=new URL('./index.html?install=1',location.href).href;return;}
  if(installPrompt){installPrompt.prompt();const {outcome}=await installPrompt.userChoice;if(outcome==='accepted')installPrompt=null;renderPanel();return;}
  status(iOS()?'In Safari: tap Share, then "Add to Home Screen". The app opens full screen with the camera, worker and exports.':'Use your browser menu to install this page as an app.');}
if('serviceWorker' in navigator&&isSecureContext&&!new URLSearchParams(location.search).has('nosw'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
// The bundled sample exactly as loaded; any edit or an imported authored map is the user's work and is kept.
function untouchedSample(w){return JSON.stringify(w)===JSON.stringify(normalizeWorld(sampleWorld()));}
function calibrationFor(visual){if(calibration.visual!==visual){calibration={visual,picks:[],picking:false,distance:''};visualViewer?.setMarkers([]);}return calibration;}
function pickedPoint(visual,index){const at=index*STRIDE;return [visual.points[at],visual.points[at+1],visual.points[at+2]];}
function pickedSpan(visual,picks){const [a,b]=picks.map(i=>pickedPoint(visual,i));return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
// Metres per reconstruction unit from the user's two picks + measured distance; null until both exist and are sane.
function measuredScale(visual){const c=calibrationFor(visual),d=Number(c.distance);if(c.picks.length!==2||c.picking||!(d>=PROPOSAL.minMeasuredDistance&&d<=PROPOSAL.maxMeasuredDistance))return null;const span=pickedSpan(visual,c.picks);return span>1e-6?{metresPerUnit:d/span,distance:d,span}:null;}
// COLMAP-frame points (multi-view reconstructions) are flipped to Y-up on hand-off; anything else is already Y-up.
function arenaFrame(source){return source?.derivation?.engine==='colmap-sparse'||source?.derivation?.coordinateFrame==='colmap'||source?.reconstruction?.coordinate_frame==='colmap'?'colmap':'right-handed-y-up';}
// Only the scene compiler's engine promises a GLB/USD scene; accepting clouds alone does not.
const SCENE_ENGINES=['scene-usd'],sceneEngine=()=>caps?.engines?.find(e=>e.available&&SCENE_ENGINES.includes(e.id)&&e.input_kinds?.includes('cloud'));
// Multi-view comes from provenance, not axis names: camera poses from at least two views (COLMAP or dense MapAnything).
// A single-photo depth preview never qualifies.
const multiView=source=>source?.visual?.origin!=='depth'&&(source?.reconstruction?.cameras?.length??0)>=2;
// Normalize exactly as uploaded before hashing. JSON's conversion of -0 must not change a bound point cloud.
function metricCloud(){const source=activeSource,scale=source?.visual&&measuredScale(source.visual);if(!source?.visual||!scale)throw Error('Open the matching reconstruction and set its measured scale first.');return JSON.parse(JSON.stringify({...toArenaCloud(source.visual.points,{source:source.name,coordinateFrame:arenaFrame(source),metresPerUnit:scale.metresPerUnit,measurement:scale}),multiView:true}));}
const bimWorkflow=createBimWorkflow({status,event,onRender:()=>{renderPanel();update();},onMarkers:picks=>visualViewer?.setMarkers(picks),makeCloud:metricCloud,
  getContext:()=>({source:activeSource,scale:activeSource?.visual?measuredScale(activeSource.visual):null,calibration,entry:sceneEngine()}),download,
  onRecompile:async(cloud,source,entry,previousSceneJob)=>{if(!client||isRemoteActive())throw Error('Wait for the current worker job or reconnect your worker.');delete cloud.nameObjects;const file=new File([JSON.stringify(cloud)],'brainsnn-point-cloud.json',{type:'application/json'});$('scene-dialog').close();event('bim_recompile_requested',{source:source.name,openings:cloud.bimReview?.openings.length??0,points:cloud.points.length,sourceJob:previousSceneJob});await runJob(entry.id,[{file,kind:'cloud',name:file.name}],{source_job:previousSceneJob});}});
function metricSceneCard(source){if(!multiView(source))return '';const entry=sceneEngine();
  if(entry&&(!entry.dimension_checks||!entry.bim_review))return '<p class="note">Update this worker with dimensional checks and BIM review, then reconnect before compiling your demo. See the <a href="./api.html" target="_blank" rel="noopener">worker guide ↗</a>.</p>';
  // Naming reads this worker's own reconstruction job (its frames and camera poses), so it is offered only for those.
  const naming=entry?.object_naming&&source?.derivation?.job?`<label class="check"><input id="scene-naming" type="checkbox">Also send crops of each separated object from your walkthrough frames to ${esc(entry.object_naming.provider||'the naming model')} (${esc(entry.object_naming.model||'')}) to suggest its name. Names are suggestions for you to review.</label>`:'';
  return entry?`<label class="check"><input id="scene-consent" type="checkbox">Upload this measured point cloud to your worker to compile a simulation scene.</label>${naming}<button class="wide" data-action="metric-scene" ${isRemoteActive()?'disabled':''}>Build metric simulation scene (GLB, USD, IFC) →</button><p class="micro">${esc(entry.label)}. The scene uses your measured distance, so it is in metres but self-reported, not verified.</p>`
    :`<p class="micro">Connect a worker with a simulation scene engine to compile this measured cloud into a metric scene (GLB, USD, IFC).</p>`;}
function calibrationCard(visual){const c=calibrationFor(visual),done=c.picks.length===2&&!c.picking;
  return `<div class="calibration"><p class="micro"><b>Measured scale (recommended).</b> Measure a distance in the room, such as a doorway's width, then tap both ends in the 3D view.</p><button class="wide" data-action="pick-scale" aria-pressed="${c.picking}">${c.picking?`Cancel picking · ${c.picks.length} of 2 points`:done?'Pick the two points again':'Pick two measured points'}</button>${c.picking?`<p class="micro" role="status">Tap point ${c.picks.length+1} of 2 in the 3D view. Drag still orbits; zoom in for precision.</p>`:''}${done?`<p class="micro" id="picked-span">Picked span: ${pickedSpan(visual,c.picks).toPrecision(5)} reconstruction units.</p>${numericField('Measured distance · m','measured-distance',c.distance,PROPOSAL.minMeasuredDistance,PROPOSAL.maxMeasuredDistance,.01)}${activeSource?.reconstruction?'<button class="primary wide" data-action="propose-measured">Propose map at measured scale →</button>':'<p class="micro">Without camera poses there is no map proposal here; the measured scale is applied when you open this cloud in Arena sim.</p>'}${metricSceneCard(activeSource)}<div id="dimension-review-slot">${bimWorkflow.captureHTML(activeSource,measuredScale(visual),c,sceneEngine())}</div>`:''}</div>`;}
function numericField(title,id,value,min,max,step=.1,disabled=false){return `<label>${title}<input ${disabled?'disabled':''} id="${id}" type="number" value="${value??''}" min="${min}" max="${max}" step="${step}"></label>`;}
function setTab(next,focus=false){tab=next;document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});$('panel').setAttribute('aria-labelledby','tab-'+tab);renderPanel();renderMedia();update();if(focus)$('tab-'+tab).focus();}
function visualHelp(){return calibration.picking||bimWorkflow.picking?'Tap both measured endpoints. Selected points turn cyan. Drag to orbit.':'Drag to orbit · Pinch or scroll to zoom · Missing surfaces remain unknown';}
function renderMedia(){
  const box=$('media-preview'), source=activeSource, capture=!!source&&(tab==='capture'||!world);
  const visual=capture&&source.visual&&display==='visual';
  box.replaceChildren();box.hidden=!capture||!!visual;
  $('world-canvas').style.visibility=capture?'hidden':'visible';
  $('visual-canvas').hidden=!visual;
  $('capture-views').hidden=!capture;$('map-views').hidden=capture;
  $('show-visual').disabled=!source?.visual;
  $('flip-visual').hidden=!visual;
  $('show-source').disabled=source?.kind==='visual';
  $('show-visual').setAttribute('aria-pressed',String(!!visual));
  $('show-source').setAttribute('aria-pressed',String(capture&&!visual));
  document.querySelector('.legend').hidden=capture;
  if(visual){
    try{if(visibleVisual!==source.visual){getVisualViewer().setPoints(source.visual.points,{photo:source.visual.photo,kind:source.visual.kind,orbit:source.visual.origin==='worker'});visibleVisual=source.visual;}}
    catch(e){$('visual-canvas').hidden=true;box.hidden=false;const p=document.createElement('p');p.textContent=e.message;box.append(p);status(e.message,true);}
    $('scene-basis').textContent=source.visual.origin==='depth'?'GENERATIVE VISUAL PREVIEW / RELATIVE DEPTH / NOT METRIC':source.visual.kind==='gaussian-splat'?'IMPORTED GAUSSIAN SPLATS / SCALE UNVERIFIED':'POINT CLOUD / SCALE UNVERIFIED';
    $('scene-help').textContent=visualHelp();
    return;
  }
  if(!capture){
    $('scene-basis').textContent=world?.provenance==='authored'?'AUTHORED SAMPLE / NOT A RECONSTRUCTION':world?.provenance==='generated'?'GENERATED / UNVERIFIED':world?.scaleReviewed&&world?.mapReviewed?'USER-REVIEWED GEOMETRY / PLANNING ONLY':'GEOMETRY REVIEW REQUIRED / NOT VERIFIED';
    $('scene-help').textContent='Drag to orbit · Keyboard arrows to rotate · Select an object to edit';
    return;
  }
  if(source.kind==='image'||source.kind==='video'){
    const node=document.createElement(source.kind==='image'?'img':'video');node.src=source.url;
    if(source.kind==='image'){node.alt='Your local capture reference';node.onerror=()=>status('This image could not be decoded. Try a JPEG or PNG export.',true);}
    else{node.controls=true;node.playsInline=true;node.preload='metadata';node.onerror=()=>status('This browser cannot preview this video, but it is added. A processing worker can still read it.');}
    box.append(node);
  }
  const p=document.createElement('p');p.textContent=source.kind==='capture'?`Capture metadata for ${source.capture.frames.length} original photos. Add their unchanged JPEG/PNG files and use a compatible processing worker. Calibration and poses will be checked on the worker; scale still requires independent measurements.`:source.visual?'Original source. Switch to 3D preview to explore the inferred visible surfaces.':source.kind==='visual'?'Open this asset in the separate viewer. PLY and SPLAT files can be previewed here.':'Source preview. Choose Create 3D preview for a photo, or a reconstruction worker for overlapping views.';box.append(p);if(source.kind==='visual'&&!source.visual){const a=document.createElement('a');a.href='./splat.html';a.target='_blank';a.rel='noopener';a.className='ghost';a.textContent='Open local 3D asset viewer ↗';box.append(a);}
  $('scene-basis').textContent='LOCAL SOURCE / ORIGINAL CAPTURE';$('scene-help').textContent='Source media stays on your device unless you approve a worker upload';
}
function renderPanel(){
  if(!$('visual-canvas').hidden)$('scene-help').textContent=visualHelp();
  const p=$('panel');
  if(tab==='capture'){
    p.innerHTML=`<h3>Bring your world.</h3><p>One photo for a visual idea. Overlapping walkthrough views for reconstruction. Nothing is uploaded automatically.</p><button class="upload-drop wide" data-action="video"><span>↑</span>Choose walkthrough video</button><button class="wide" data-action="files">Choose photos, video or map</button><details class="native-capture-options"><summary>Have a calibrated capture?</summary><p class="micro">Choose its capture JSON and 3–11 unchanged JPEG/PNG photos together. JSON up to 1 MiB; each photo up to 64 MiB. Keep the original filenames. Ordinary phone photos and browser recordings do not contain this calibration.</p><button class="wide" data-action="native-capture">Import calibrated capture</button></details><button class="wide" data-action="phone">Use iPhone camera ↗</button><button class="wide" data-action="record">${capture.state==='requesting'?'Cancel camera request':capture.state==='stopping'?'Finishing recording…':capture.state==='recording'?'Stop recording':'Record walkthrough'}</button><p class="micro">Up to 12 files · photos 200 MiB · videos 5 min, 2 GiB<br>On iPhone, Photo Library converts a video before this page gets it, which can take minutes for a long 4K video. Faster: in Photos, Share → Save to Files, then pick it here with Choose File.<br>Browser recording: 90 seconds, no audio.</p>${installable()?'<button class="wide" data-action="install">Add to Home Screen</button>':''}<div>${sources.map((s,i)=>`<div class="source-row"><button data-source="${i}">${esc(s.name)}${s.kind==='capture'?` · calibration for ${s.capture.frames.length} photos`:''}</button><button data-remove="${i}" aria-label="Remove ${esc(s.name)}">×</button></div>`).join('')}</div>${activeSource?.kind==='image'?`<button class="primary wide" data-action="depth" ${depthAbort?'disabled':''}>${activeSource.visual?'Rebuild':'Create'} 3D preview</button><p class="micro">Runs on this device. Relative depth only; hidden surfaces are unknown.</p><button class="wide" data-action="${detectAbort?'cancel-detect':'detect'}">${detectAbort?'Cancel object detection':'Identify objects on this device'}</button><p class="micro" id="detect-status" role="status">Suggests labels for you to review. 80 common categories; never changes the map.</p>`:''}${activeSource?.visual?'<button class="wide" data-action="visual-export">Export visible points (PLY) ↗</button><button class="wide" data-action="arena-cloud">Open in Arena sim (point cloud JSON) ↗</button>':''}${activeSource?.visual&&activeSource.reconstruction?`<div class="proposal-card"><h4>Real → sim</h4><p class="micro">Turn this reconstruction into a robot planning map: floor from the lowest dense layer of points, obstacles up to robot height, unseen areas blocked.</p>${numericField('Phone height while recording · m','camera-height',cameraHeight,PROPOSAL.minCameraHeight,PROPOSAL.maxCameraHeight,.05)}<button class="primary wide" data-action="propose-map">Propose planning map →</button><p class="micro">Scale comes from this height until you confirm a measured distance. The map must be reviewed before planning.</p>${calibrationCard(activeSource.visual)}</div>`:activeSource?.visual&&activeSource.visual.origin!=='depth'?`<p class="micro">Import the matching reconstruction.json to propose a planning map from these points.</p>${calibrationCard(activeSource.visual)}`:activeSource?.visual?calibrationCard(activeSource.visual):''}${depthAbort?'<button class="wide" data-action="cancel-depth">Cancel 3D preview</button>':''}<p id="depth-status" role="status">${esc(depthStatus)}</p><details class="processing-options"><summary>Process capture / use an API worker</summary><p><a href="./api.html" target="_blank" rel="noopener">Worker API guide ↗</a></p><p>Overlapping views can produce an unscaled reconstruction with a configured worker. Review scale and obstacles before planning.</p><button class="wide${!client&&siteProcessing?.available?' primary':''}" data-action="connection">${client?'Worker connection':siteProcessing?.available?'Process on BrainSNN':'Connect processing worker'}</button>${caps?`<label>Configured engine<select id="engine"><option value="">Select an available engine</option>${caps.engines.filter(e=>e.available).map(e=>`<option value="${esc(e.id)}"${(client?.site||sources.some(s=>s.kind==='capture'))&&e.id==='colmap-sparse'?' selected':''}>${esc(e.label||e.id)}</option>`).join('')}</select></label><p class="micro">Reconstruction needs overlapping views. Observation workers accept one photo or video. ${sources.some(s=>s.kind==='capture')?'The capture JSON and its matching original photos are sent together. Their hashes are checked locally first; the worker validates calibration and poses.':'All photo/video files in this session are sent.'}</p><label class="check"><input id="consent" type="checkbox"><span>I approve sending the selected source files to ${esc(new URL(client.base).host)} for this job.</span></label><button class="primary wide" data-action="process" ${isRemoteActive()?'disabled':''}>Process all capture files</button>`:''}${isRemoteActive()?'<button class="wide" data-action="cancel-job">Cancel upload / job</button>':''}<p id="job-status">${esc(jobStatus)}</p></details><p class="note">Walk slowly around the floor, return to your start, and revisit narrow or occluded passages. Keep bystanders out of frame.</p>`;
  }else if(tab==='world'){
    p.innerHTML=`<h3>Make the map testable.</h3>${world?`<label>World name<input id="map-name" value="${esc(world.name)}" maxlength="160"></label><div class="field-row">${numericField('Width · m','floor-width',world.width,1,80,.1,!!world.floor)}${numericField('Depth · m','floor-depth',world.depth,1,80,.1,!!world.floor)}</div>${world.geometrySource?`<p class="note">Imported ${esc(world.geometrySource.kind)} geometry. The original floor polygon is preserved.</p>${world.geometrySource.warnings.map(w=>`<p class="micro">${esc(w)}</p>`).join('')}`:''}<div class="field-row">${numericField('Start X · m','start-x',world.start.x,0,world.width)}${numericField('Start Z · m','start-z',world.start.z,0,world.depth)}</div><label class="check"><input id="scale-reviewed" type="checkbox" ${world.scaleReviewed?'checked':''} ${world.provenance==='generated'?'disabled':''}><span>I checked scale and critical clearances against independent measurements.</span></label><label class="check"><input id="map-reviewed" type="checkbox" ${world.mapReviewed?'checked':''} ${world.provenance==='generated'?'disabled':''}><span>I reviewed obstacles, unknown areas and the start position.</span></label><button class="wide" data-action="add-object">Add obstacle / unknown zone</button><button class="wide" data-action="save-map">Save map in this browser</button><button class="wide" data-action="map-export">Export map JSON ↗</button>`:'<p>Import RoomPlan or a BrainSNN floor map, or create a measured map. Visual depth alone does not establish collision geometry.</p>'}<button class="wide" data-action="new-map">Create measured map</button><button class="wide" data-action="restore">Restore saved map</button><p class="note">Sample dimensions are authored, not captured. Imported and changed maps must be reviewed again.</p><div id="geometry-evidence"></div>`;measurements.render($('geometry-evidence'));
  }else if(tab==='understand'){
    const unknowns=world?.objects.filter(o=>o.kind==='unknown')||[];
    p.innerHTML=`<h3>Evidence, not guesses.</h3><p>There are ${unknowns.length} marked unknown regions. These are blocked in planning, not filled in by imagination.</p>${unknowns.map(o=>`<div class="event"><b>${esc(o.name)}</b>${esc(o.note||'Capture this area from another angle.')}</div>`).join('')}<label>Reference<select id="note-source"><option value="">Reviewed map</option>${sources.map((s,i)=>`<option value="${i}">${esc(s.name)}</option>`).join('')}</select></label>${numericField('Observed timestamp · seconds','note-time',0,0,86400,1)}<label>Your observation<textarea id="note-text" rows="3" maxlength="400" placeholder="For example: the passage was blocked at 00:18."></textarea></label><button class="wide" data-action="add-note">Save human observation</button><p class="note">Your notes are human-authored. Model suggestions retain separate frame evidence and review records.</p><div id="observation-reviews"></div>`;observations.render($('observation-reviews'));
  }else if(tab==='test'){
    p.innerHTML=`<h3>Test the next move.</h3><label>Illustrative robot envelope<select id="robot">${Object.entries(ROBOTS).map(([id,r])=>`<option value="${id}" ${id===robotId?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><div class="field-row">${numericField('Width · m','robot-width',robot.width,.1,5)}${numericField('Depth · m','robot-depth',robot.depth,.1,5)}${numericField('Speed · m/s','robot-speed',robot.speed,.01,3,.01)}${numericField('Margin · m','robot-margin',robot.margin,0,2,.01)}</div><div class="field-row">${numericField('Setup · min','setupMinutes',assumptions.setupMinutes,0,240,1)}${numericField('Each turn · sec','turnSeconds',assumptions.turnSeconds,0,120,.1)}${numericField('Help · min','assistanceMinutes',assumptions.assistanceMinutes,0,240,1)}${numericField('Robot · C$/h','robotRate',assumptions.robotRate,0,10000,1)}${numericField('Labour · C$/h','labourRate',assumptions.labourRate,0,10000,1)}</div>${result?`<p>${estimate(result,assumptions).minutes.toFixed(1)} min including your allowances.<br>Unreachable free grid: ${result.unreachableArea.toFixed(1)} m².</p>`:''}${baseline?`<p class="note">Baseline saved${result?`: route ${(result.distance-baseline.result.distance).toFixed(1)} m; time ${(estimate(result,assumptions).minutes-estimate(baseline.result,baseline.assumptions).minutes).toFixed(1)} min versus baseline.`:'. Run this scenario to compare.'}</p>`:''}<p class="note">Conservative planar traversal. Not optimized cleaning, humanoid balance or real robot execution. Verify every robot parameter.</p>`;
  }else{
    p.innerHTML=`<h3>Keep the evidence.</h3><p>Export geometry, assumptions and the actual planning trace. A content hash detects changes; it does not certify the result.</p><button class="wide" data-action="proof">Export proof pack ↗</button><button class="wide" data-action="arena-export">Export Arena map ↗</button><button class="wide" data-action="usd-export">Export static OpenUSD ↗</button><button class="wide" data-action="scenario-export" ${baseline?'':'disabled'}>Export scenario comparison ↗</button>${job?.status==='complete'?`<p>Worker artifacts (${esc(job.engine)})</p>${(job.artifacts||[]).map((a,i)=>`<button class="wide" data-artifact="${i}">Download ${esc(a.name)} ↗</button>${a.name==='observations.json'&&a.kind==='observations'?`<button class="wide" data-review-artifact="${i}">Review model observations</button>`:''}${/\.(ply|splat)$/i.test(a.name)?`<button class="wide" data-preview-artifact="${i}">Explore ${esc(a.name)} in 3D</button>`:''}${/\.glb$/i.test(a.name)?`<button class="wide" data-scene-artifact="${i}">Explore ${esc(a.name)} in 3D</button>`:''}`).join('')}`:''}<div>${events.slice(-5).reverse().map(e=>`<div class="event"><b>${esc(e.type.replaceAll('_',' '))}</b>${esc(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail))}</div>`).join('')}</div><button class="wide" data-action="clear">Clear local session</button>`;
  }
}
function renderInspector(){const options=$('objects');options.replaceChildren();for(const o of world?.objects||[]){const op=document.createElement('option');op.value=o.id;op.textContent=o.name;options.append(op);}if(!world?.objects.some(o=>o.id===selected))selected=world?.objects[0]?.id||'';options.value=selected;const o=world?.objects.find(o=>o.id===selected);$('object-fields').innerHTML=o?`<label>Object name<input id="object-name" maxlength="160" value="${esc(o.name)}"></label><div class="field-row">${numericField('X · m','object-x',o.x,0,world.width-o.w)}${numericField('Z · m','object-z',o.z,0,world.depth-o.d)}${numericField('Width · m','object-w',o.w,.05,world.width-o.x)}${numericField('Depth · m','object-d',o.d,.05,world.depth-o.z)}</div><label>Object type<select id="object-kind">${['obstacle','unknown','no-go'].map(k=>`<option ${o.kind===k?'selected':''}>${k}</option>`).join('')}</select></label><button class="small" data-action="remove-object">Remove object</button>`:'<p class="micro">Import or create geometry to edit objects.</p>';renderer?.setSelected(selected);}
function update(){
  updateWorkflow();
  const capture=activeSource&&(tab==='capture'||!world);$('world-title').textContent=capture?activeSource.name:world?.name||'Your capture';$('provenance').textContent=capture&&activeSource.visual?'VISUAL / SCALE UNVERIFIED':!world?'LOCAL SOURCE':world.provenance==='authored'?'AUTHORED SAMPLE':world.provenance==='generated'?'GENERATED / UNVERIFIED':world.mapReviewed&&world.scaleReviewed?'USER-REVIEWED MAP':'REVIEW REQUIRED';
  const gate=planningGate(world);$('run').textContent=planning?'Cancel planning':'Run planning preview →';$('run').title=gate||'Run conservative geometric traversal';$('run').disabled=!world||!!capture;
  $('replay').disabled=!result;$('scrub').disabled=!result;
  for(const id of ['area','distance','time','cost'])$('metric-'+id).textContent='—';
  if(result){const est=estimate(result,assumptions);$('metric-area').textContent=result.reachableArea.toFixed(1)+' m²';$('metric-distance').textContent=result.distance.toFixed(1)+' m';$('metric-time').textContent=(result.travelSeconds/60).toFixed(1)+' min';$('metric-cost').textContent=est.cost===null?'Enter rates':'C$'+est.cost.toFixed(2);}
}
function updateWorkflow(){
  const hasCapture=sources.some(s=>s.file),hasGeometry=!!activeSource?.visual,scaled=!!(hasGeometry&&measuredScale(activeSource.visual)),hasScene=bimWorkflow.hasScene;
  const states=[hasCapture?'Source ready':'Choose video',scaled?'Entered scale':hasGeometry?'Set a distance':'Await geometry',hasScene?'Scene available':scaled?'Add checks':'Await scale',hasScene?'Artifacts available':'Await compilation'];
  ['capture','scale','review','export'].forEach((step,i)=>{const node=$('workflow-'+step);if(!node)return;node.querySelector('small').textContent=states[i];node.classList.toggle('complete',[hasCapture,scaled,hasScene,hasScene][i]);});
}
/** A video's length from its metadata, without reading the file into memory; null when this browser cannot tell (the worker checks again). */
function videoSeconds(file){return new Promise(resolve=>{const node=document.createElement('video'),url=URL.createObjectURL(file);let timer=0;const done=value=>{if(!timer)return;clearTimeout(timer);timer=0;node.onloadedmetadata=node.onerror=null;node.removeAttribute('src');node.load();URL.revokeObjectURL(url);resolve(Number.isFinite(value)&&value>0?value:null);};timer=setTimeout(()=>done(null),8000);node.preload='metadata';node.muted=true;node.onloadedmetadata=()=>done(node.duration);node.onerror=()=>done(null);node.src=url;});}
async function addFiles(list,{nativeCapture=false}={}){
  if(nativeCheckAbort){nativeCheckAbort.abort();nativeCheckAbort=null;jobStatus='';}
  capture.stop();
  for(const file of Array.from(list)){
    depthAbort?.abort();artifactAbort?.abort();depthStatus='';
    status(`Received ${file.name||'a file'} (${(file.size/1024**2).toFixed(file.size<10*1024**2?1:0)} MB${file.type?`, ${file.type}`:''}). Checking it…`);
    try{if(nativeCapture&&/\.json$/i.test(file.name)&&file.size>NATIVE_CAPTURE.metadataBytes)throw new Error('Capture JSON must be no larger than 1 MiB.');
      if(nativeCapture&&!/\.(json|jpe?g|png)$/i.test(file.name))throw new Error('Choose capture JSON and its unchanged JPEG/PNG photos.');
      let kind=classifyFile(file),nativeMetadata=null;if(kind==='map'){const json=JSON.parse(await file.text());
      if(json?.schema==='brainsnn.capture.v1'){if(sources.some(s=>s.kind==='capture'))throw new Error('A capture JSON is already selected. Remove it before adding another.');nativeMetadata=await readNativeCapture(file);kind='capture';}
      else {
      if(nativeCapture)throw new Error('Choose the original brainsnn.capture.v1 JSON for this capture.');
      if(json?.schema==='brainsnn.reconstruction.v1'){const target=[...sources].reverse().find(s=>s.visual&&s.visual.origin!=='depth');if(!target)throw new Error('Import the reconstruction point cloud (PLY) first, then its reconstruction.json.');
        target.reconstruction=json;activeSource=target;display='visual';event('reconstruction_evidence_attached',{source:target.name,file:file.name,cameras:Array.isArray(json.cameras)?json.cameras.length:0});setTab('capture');update();status('Reconstruction evidence attached. Propose a planning map from the Capture panel.');continue;}
      const map=importWorld(json,file.name);map.scaleReviewed=false;map.mapReviewed=false;apply(map,'Map imported. Confirm scale and geometry before planning.');setTab('world');event('map_import',file.name);continue;}}
      if(sources.filter(s=>s.file).length>=LIMITS.sources||sources.reduce((s,x)=>s+x.size,0)+file.size>LIMITS.session)throw new Error('This local session is limited to 12 sources and 4 GiB total.');
      const seconds=kind==='video'?await videoSeconds(file):null;if(seconds!==null&&seconds>LIMITS.videoSeconds+1)throw new Error(`This video is ${(seconds/60).toFixed(1)} minutes long. Walkthroughs can be up to five minutes; trim it, then add it again.`);
      if(/\.(spz|ksplat)$/i.test(file.name))throw new Error('Convert SPZ or KSPLAT to PLY / SPLAT before opening it in this viewer.');
      const source={file,name:file.name,size:file.size,kind,url:null,seconds,...(nativeMetadata?{capture:nativeMetadata}:{})};let nextDisplay='source';if(kind==='visual'&&/\.(ply|splat)$/i.test(file.name)){if(file.size>64*1024**2)throw new Error('Preview limit is 64 MiB. Open larger files in a desktop viewer.');const parsed=parseVisualAsset(await file.arrayBuffer(),file.name);source.visual={...parsed,origin:'import',photo:false};nextDisplay='visual';}if(world?.provenance==='authored'&&untouchedSample(world)){world=null;renderer?.setWorld(null);}display=nextDisplay;source.url=URL.createObjectURL(file);sources.push(source);bimWorkflow.reset();activeSource=source;invalidate();event('source_added',`${file.name} (${kind}), local only`);setTab('capture');renderInspector();update();status(kind==='capture'?`Capture metadata ready for ${nativeMetadata.frames.length} photos. Add the unchanged originals, connect a compatible worker and approve processing.`:kind==='image'?'Photo ready. Create a 3D preview on this device.':kind==='visual'?'Visual asset loaded. Scale and collision geometry remain unverified.':'Walkthrough ready. Connect a reconstruction worker to process overlapping views.');
    }catch(e){status(e.message,true);}
  }
  $('files').value='';$('video-file').value='';$('phone-camera').value='';$('native-capture-files').value='';
}
async function run(){if(planning){invalidate();status('Planning cancelled.');return;}const gate=planningGate(world);if(gate){status(gate,true);setTab('world');return;}
  invalidate();planning=true;update();const id=epoch;try{planner=new Worker('./planner-worker.mjs',{type:'module'});}catch(e){planning=false;update();status('A browser planning worker could not start. Check your browser settings.',true);return;}
  const timeout=setTimeout(()=>{if(id===epoch){invalidate();status('Planning timed out. Try a smaller map.',true);}},15000);
  planner.onmessage=({data})=>{clearTimeout(timeout);if(data.id!==epoch)return;planner?.terminate();planner=null;planning=false;if(data.error){status(data.error,true);update();return;}result=data.result;renderer?.setResult(result);renderer?.setCursor(.015);event('plan_completed',{algorithm:result.algorithm,metres:result.distance,policyExecuted:false});setTab('test');update();status('Planning preview complete. No learned policy or physical robot executed.');};
  planner.onerror=()=>{clearTimeout(timeout);if(id===epoch){invalidate();status('Planning worker failed.',true);}};planner.postMessage({id,world:clone(world),robot:clone(robot)});
}
function replay(){if(!result)return;if(replayFrame){stopReplay();return;}replayStart=performance.now()-Number($('scrub').value)/1000*12000;$('replay').textContent='Pause';function tick(t){const c=Math.min(1,(t-replayStart)/12000);$('scrub').value=Math.round(c*1000);renderer?.setCursor(c);if(c<1)replayFrame=requestAnimationFrame(tick);else stopReplay();}replayFrame=requestAnimationFrame(tick);}
const capture=createCaptureClient({
  maxBytes:LIMITS.file,
  onState:()=>renderPanel(),
  onFile:file=>{void addFiles([file]);},
  onError:error=>{renderMedia();status(error.message+' You can use the native camera upload instead.',true);},
  onStream:async stream=>{
    setTab('capture');status('Recording without audio. Stop within 90 seconds; walk slowly and overlap your views.');
    const box=$('media-preview');box.replaceChildren();box.hidden=false;$('world-canvas').style.visibility='hidden';$('visual-canvas').hidden=true;
    const video=document.createElement('video');video.srcObject=stream;video.muted=true;video.playsInline=true;box.append(video);await video.play();
  },
});
async function record(){
  if(capture.state!=='idle'){capture.stop();return;}
  if(!capture.supported){status('This browser cannot record a supported MP4. Use a photo or MP4/MOV from the native camera.');$('phone-camera').click();return;}
  status('Waiting for camera permission. Cancel the request here to keep the camera off.');
  await capture.start();
}
function cancelConnection(){connectionAbort?.abort();connectionAbort=null;$('connect').disabled=false;$('site-connect').disabled=false;$('worker-token').value='';$('site-passcode').value='';$('connection-status').textContent='';}
async function connect(){
  connectionAbort?.abort();const controller=new AbortController();connectionAbort=controller;const button=$('connect');button.disabled=true;$('connection-status').textContent='Checking worker capabilities…';
  try{
    if(isRemoteActive())throw new Error('Cancel the active job before changing workers.');
    const next=new WorkerClient($('worker-url').value.trim(),$('worker-token').value),nextCaps=await next.capabilities(controller.signal);
    if(controller.signal.aborted||connectionAbort!==controller)return;
    adoptWorker(next,nextCaps,'Operator worker connected');$('worker-token').value='';$('connection-status').textContent=`Connected. ${caps.engines.filter(e=>e.available).length} engine(s) configured. Model quality is not implied.`;
  }catch(e){if(!controller.signal.aborted&&connectionAbort===controller)$('connection-status').textContent=e.message;}
  finally{if(connectionAbort===controller){connectionAbort=null;button.disabled=false;}}
}
function adoptWorker(next,nextCaps,summary){bimWorkflow.clearScene();client=next;caps=nextCaps;job=null;$('worker-summary').textContent=summary;$('worker-note').textContent='No inference verified until a job succeeds.';event('worker_connected',new URL(client.base).origin);renderPanel();}
/** brainsnn.com's own processing: the site holds the worker credentials and gives this page a session in memory only. */
async function loadSiteProcessing(){
  try{const r=await fetch('/api/world/processing',{cache:'no-store',credentials:'same-origin'});const s=r.ok?await r.json():null;siteProcessing=s&&s.available===true?s:null;}catch{siteProcessing=null;}
  $('site-processing').hidden=!siteProcessing;$('site-passcode-row').hidden=!siteProcessing?.passcode;
  if(siteProcessing?.passcode&&siteProcessing.visitors)$('site-passcode-row').firstChild.textContent='Owner passcode (optional)';
  renderPanel();
}
async function connectSite(){
  connectionAbort?.abort();const controller=new AbortController();connectionAbort=controller;const button=$('site-connect');button.disabled=true;$('site-processing-status').textContent='Opening a processing session…';
  try{
    if(isRemoteActive())throw new Error('Cancel the active job before changing workers.');
    const passcode=$('site-passcode').value;
    const r=await fetch('/api/world/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(passcode?{passcode}:{}),cache:'no-store',credentials:'same-origin',signal:controller.signal});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail.slice(0,300):'BrainSNN processing is unavailable.');
    const next=new WorkerClient(location.origin+'/api/world/worker',data.token);next.site=true;
    const nextCaps=await next.capabilities(controller.signal);
    if(controller.signal.aborted||connectionAbort!==controller)return;
    adoptWorker(next,nextCaps,'BrainSNN processing');$('site-passcode').value='';
    $('site-processing-status').textContent=data.kind==='visitor'?`Connected. Free processing: ${siteProcessing?.visitorJobsPerDay??1} job(s) a day.`:'Connected. Choose your video, tick the consent box, then Process.';
    $('connection').close();status('BrainSNN processing connected. Tick the consent box, then Process all capture files.');
  }catch(e){if(!controller.signal.aborted&&connectionAbort===controller)$('site-processing-status').textContent=e.message;}
  finally{if(connectionAbort===controller){connectionAbort=null;button.disabled=false;}}
}
async function processSources(){
  if(!client||isRemoteActive())return;
  const engine=$('engine')?.value,consent=$('consent')?.checked;
  if(!engine||!consent){status('Select an available engine and explicitly approve the upload.',true);return;}
  const entry=caps.engines.find(e=>e.id===engine&&e.available);let items=sources.filter(s=>['image','video','capture'].includes(s.kind));
  if(!entry||!items.length){status('Add photos, a video or a calibrated capture before processing.',true);return;}
  if(items.some(s=>s.kind==='capture')){
    const controller=new AbortController(),connection=client;nativeCheckAbort=controller;
    jobStatus='Checking original capture files locally…';status(jobStatus);renderPanel();
    try{
      items=await prepareNativeCapture(items,entry,{signal:controller.signal,progress:(done,total)=>{
        jobStatus=`Checking original photos: ${done}/${total}. Nothing uploaded yet.`;
        if($('job-status'))$('job-status').textContent=jobStatus;
      }});
      controller.signal.throwIfAborted();
      if(client!==connection)throw new Error('Worker connection changed. Approve the capture upload again.');
    }catch(error){
      if(!controller.signal.aborted){jobStatus=error.message;status(jobStatus,true);}
      if(nativeCheckAbort===controller){nativeCheckAbort=null;renderPanel();}return;
    }
    if(nativeCheckAbort===controller)nativeCheckAbort=null;
  }
  if(items.length>(entry.max_inputs||12)||items.some(s=>!entry.input_kinds?.includes(s.kind))){status('The selected engine does not support this combination of source files.',true);return;}
  // Older workers advertise no large-video support.
  if(!Number.isSafeInteger(caps.limits?.video_bytes)&&items.some(s=>s.kind==='video'&&(s.size>200*1024**2||s.seconds>121))){status('This worker runs an older version that takes videos up to 2 minutes and 200 MiB. Update the worker to the current release and restart it, or trim the video.',true);return;}
  await runJob(engine,items);
}
// Uploads approved items ({file,kind,name}) to the connected worker, then starts and follows one job.
async function runJob(engine,items,extra={}){
  bimWorkflow.clearScene();update();remoteAbort=new AbortController();const signal=remoteAbort.signal;job=null;jobStatus='Uploading approved sources…';status(jobStatus);renderPanel();try{const uploads=[];for(let i=0;i<items.length;i++){uploads.push(await client.upload(items[i].file,items[i].kind,signal,p=>{jobStatus=`Uploading ${i+1}/${items.length}: ${Math.round(p*100)}%`;if($('job-status'))$('job-status').textContent=jobStatus;}));}
    job=await client.request('/v1/jobs',{method:'POST',body:{engine,upload_ids:uploads,consent:true,...extra},signal});if(!/^[a-f0-9]{32}$/.test(job.id))throw new Error('Invalid job identifier.');event('job_submitted',{engine,files:items.map(s=>s.name)});if(signal.aborted){await client.request(`/v1/jobs/${job.id}`,{method:'DELETE'});throw new DOMException('Aborted','AbortError');}job=await client.request(`/v1/jobs/${job.id}/start`,{method:'POST',body:{},signal});await checkJob(signal);
  }catch(e){jobStatus=signal.aborted?'Upload cancelled. The same selected file can resume in this session.':e.message;status(jobStatus,true);remoteAbort=null;renderPanel();}}
async function checkJob(signal){
  if(signal.aborted||!job)return;
  job=await client.request(`/v1/jobs/${job.id}`,{signal});
  jobStatus=`${job.engine}: ${job.status}${job.error?' · '+job.error:''}`;
  if($('job-status'))$('job-status').textContent=jobStatus;
  if(['complete','failed','cancelled'].includes(job.status)){
    remoteAbort=null;event('worker_'+job.status,{engine:job.engine,job:job.id});
    $('worker-note').textContent=job.status==='complete'?job.engine==='inspect'?'Capture integrity receipt produced. No AI model executed.':`${job.engine} produced artifacts. Outputs remain unverified until reviewed.`:'No successful model output for this job.';
    renderPanel();status(jobStatus,job.status!=='complete');
    if(job.status==='complete'){
      setTab('evidence');const review=automaticReviewArtifact(job);
      if(review?.type==='visual')void openArtifact(review.index);
      else if(review?.type==='observations')void openObservationArtifact(review.index);
      else if(review?.type==='scene')void openSceneArtifact(review.index);
    }
    return;
  }
  schedulePoll(signal);
}
// A long reconstruction outlives network blips: retry status checks with backoff (cancel stays available), and only
// give up after repeated failures, saying so.
function schedulePoll(signal,failures=0){poll=setTimeout(()=>checkJob(signal).catch(e=>{if(signal.aborted)return;
  if(failures>=7){remoteAbort=null;jobStatus=`${e.message} Status checks stopped after repeated failures; cancel the job or reconnect to the worker.`;renderPanel();status(jobStatus,true);return;}
  jobStatus=`Status check failed (${e.message}). Retrying…`;if($('job-status'))$('job-status').textContent=jobStatus;schedulePoll(signal,failures+1);}),failures?Math.min(30000,1500*2**failures):1500);}
async function cancelRemote(){nativeCheckAbort?.abort();nativeCheckAbort=null;clearTimeout(poll);remoteAbort?.abort();remoteAbort=null;if(job&&client&&!['complete','failed','cancelled'].includes(job.status)){try{job=await client.request(`/v1/jobs/${job.id}`,{method:'DELETE'});}catch(e){status('Local polling stopped; server cancellation was not confirmed: '+e.message,true);return;}}jobStatus='Cancelled. Retained uploads expire under the worker retention policy.';renderPanel();status(jobStatus);}
// On-device object labels for a photo: suggestions that go to review, never into scale or collision geometry.
async function identifyObjects(){
  if(detectAbort||activeSource?.kind!=='image')return;
  const source=activeSource,controller=new AbortController();detectAbort=controller;const signal=controller.signal;
  $('detect-consent').close();renderPanel();
  const progress=text=>{if($('detect-status'))$('detect-status').textContent=text;status(text);};
  try{
    progress('Preparing your photo…');
    const photo=await decodePhoto(source.file,{signal,maxEdge:DETECTOR.maxEdge}),png=await framePng(photo);
    const output=await detectObjects(photo,{signal,onStatus:progress});
    if(signal.aborted||!sources.includes(source))return;
    const count=await observations.loadDetections(source,{png,width:photo.width,height:photo.height,detections:output.detections});
    if(signal.aborted||!sources.includes(source))return;
    event('local_detection_completed',{source:source.name,model:{id:DETECTOR.id,revision:DETECTOR.revision},proposed:count,inferenceMs:output.inferenceMs});
    $('worker-summary').textContent='On-device object detection completed';$('worker-note').textContent='Label suggestions for review only. No scale, collision geometry or robot safety inferred.';
    detectAbort=null;setTab('understand');
    status(`${count} object${count===1?'':'s'} proposed on this device in ${(output.inferenceMs/1000).toFixed(1)} s. Review each one; labels never change the map.`);
  }catch(e){if(!signal.aborted)status(e.message,true);else status('Object detection cancelled.');}
  finally{if(detectAbort===controller){detectAbort=null;renderPanel();}}
}
async function buildDepth(){
  if(depthAbort||activeSource?.kind!=='image')return;
  const source=activeSource,controller=new AbortController();depthAbort=controller;const signal=controller.signal;
  $('depth-consent').close();depthStatus='Preparing your photo…';renderPanel();
  const progress=text=>{depthStatus=text;if($('depth-status'))$('depth-status').textContent=text;status(text);};
  try{
    const photo=await decodePhoto(source.file,{signal});
    const output=await inferDepth(photo,{signal,onStatus:progress});
    if(signal.aborted||!sources.includes(source))return;
    const points=fromDepth(photo.rgba,photo.width,photo.height,output.depth,output.width,output.height);
    const sourceDigest=await crypto.subtle.digest('SHA-256',photo.rgba);
    if(signal.aborted||!sources.includes(source))return;
    source.visual={points,kind:'point-cloud',origin:'depth',photo:true,model:output.model,inferenceMs:output.inferenceMs};
    source.derivation={inputSHA256:Array.from(new Uint8Array(sourceDigest),v=>v.toString(16).padStart(2,'0')).join(''),inputHashScope:'decoded-downsampled-RGBA',inputWidth:photo.width,inputHeight:photo.height,model:output.model,inferenceMs:output.inferenceMs,pointCount:points.length/STRIDE,metricVerified:false,assumedHorizontalFov:60,representation:'relative-depth-point-cloud'};
    activeSource=source;display='visual';event('local_depth_completed',{source:source.name,...source.derivation});
    depthStatus=`${(points.length/STRIDE).toLocaleString()} visible points · relative depth · ${(output.inferenceMs/1000).toFixed(1)} seconds inference`;
    $('worker-summary').textContent='On-device depth completed';$('worker-note').textContent='Photo-derived visual preview. No metric scale, unseen geometry or robot safety inferred.';
    setTab('capture');update();status('3D preview ready. Orbit the visible surfaces, or compare with the original photo.');
  }catch(e){if(!signal.aborted){depthStatus='Could not create a depth preview: '+e.message;status(depthStatus,true);}else{depthStatus='3D preview cancelled. Your photo remains local.';status(depthStatus);}}
  finally{if(depthAbort===controller)depthAbort=null;renderPanel();}
}
async function openArtifact(index){
  if(!job||!client)return;artifactAbort?.abort();const controller=new AbortController();artifactAbort=controller;
  const sourceJob=job,sourceClient=client,item=sourceJob.artifacts[index];
  try{
    status('Loading and checking the 3D artifact…');
    const buffer=await sourceClient.previewArtifact(sourceJob,index,controller.signal);
    if(controller.signal.aborted)return;
    const parsed=parseVisualAsset(buffer,item.name);
    const existing=sources.find(s=>s.derivation?.job===sourceJob.id&&s.derivation?.sha256===item.sha256);if(existing){bimWorkflow.reset();activeSource=existing;display='visual';setTab('capture');status('Reconstruction loaded. Scale remains unverified.');return;}
    if(sources.filter(s=>s.derivation?.job).length>=4)throw new Error('Remove an earlier worker artifact before opening another.');
    const source={name:item.name,size:item.size,kind:'visual',url:null,visual:{...parsed,origin:'worker',photo:false},derivation:{job:sourceJob.id,engine:sourceJob.engine,sha256:item.sha256,coordinateFrame:item.coordinate_frame,metricVerified:false}};
    const evidenceIndex=sourceJob.artifacts.findIndex(a=>a.name==='reconstruction.json');
    if(evidenceIndex>=0){try{const evidence=JSON.parse(new TextDecoder().decode(await sourceClient.previewArtifact(sourceJob,evidenceIndex,controller.signal)));if(evidence?.schema==='brainsnn.reconstruction.v1'){source.reconstruction=evidence;source.derivation.evidenceSha256=sourceJob.artifacts[evidenceIndex].sha256;}}catch(e){if(controller.signal.aborted)return;event('reconstruction_evidence_unavailable',e.message);}}
    sources.push(source);bimWorkflow.reset();activeSource=source;display='visual';event('artifact_opened',source.derivation);setTab('capture');update();
    // The worker checks a video's model against its own consecutive frames; a model that contradicts them is folded.
    const folded=source.reconstruction?.capture?.consistency?.status==='folded';
    status(folded?'This reconstruction contradicts its own frames: the room is likely folded onto itself. Do not use its layout or dimensions; recapture the room.':'Reconstruction loaded. Compare with the source; independently review scale and obstacles before planning.'+(sourceJob.artifacts.some(a=>/\.glb$/i.test(a.name))?' Its simulation scene is under Evidence.':''),folded);
  }catch(e){if(!controller.signal.aborted)status('Artifact preview failed: '+e.message,true);}
  finally{if(artifactAbort===controller)artifactAbort=null;}
}
async function openObservationArtifact(index){
  if(!job||!client)return;artifactAbort?.abort();const controller=new AbortController();artifactAbort=controller;
  try{status('Checking the original source, frame receipts and model observations…');await observations.load(job,client,index,controller.signal);if(controller.signal.aborted)return;setTab('understand');status('Model suggestions are ready for review. No planning geometry was changed.');}
  catch(error){if(!controller.signal.aborted)status('Observation review could not open: '+error.message,true);}
  finally{if(artifactAbort===controller)artifactAbort=null;}
}
// A worker's simulation scene opens in a dialog with the Arena's mesh viewer, loaded only when first needed.
// sceneMap holds the open scene's metric scene.json, the only input to a planning map built from a scene.
let sceneAbort=null,sceneViewer=null,scenePromise=null,sceneMap=null;
function sceneStatus(message,error=false){$('scene-status').textContent=message;$('scene-status').classList.toggle('error',error);}
async function openSceneArtifact(index){
  if(!job||!client)return;sceneAbort?.abort();const controller=new AbortController();sceneAbort=controller;
  const sourceJob=job,sourceClient=client,item=sourceJob.artifacts[index],dialog=$('scene-dialog');
  // Open at once and drop the previous scene's status and facts, so nothing stale shows while modules and bytes load.
  $('scene-facts').replaceChildren();bimWorkflow.clearScene();sceneMap=null;$('scene-plan').hidden=true;sceneStatus(`Downloading and checking ${item?.name??'the scene'}…`);sceneViewer?.clear();
  if(!dialog.open)dialog.showModal();
  try{
    const {SCENE_PREVIEW_BYTES,sceneFacts}=await import('./scene-preview.mjs');
    if(controller.signal.aborted)return;
    if(!(item?.size<=SCENE_PREVIEW_BYTES))throw new Error('In-browser scene previews are limited to 50 MiB. Download the GLB for a desktop viewer.');
    const buffer=await sourceClient.previewArtifact(sourceJob,index,controller.signal);
    // scene.json describes the compiler's scene.glb only; any other GLB is shown without borrowed facts.
    const sceneIndex=item.name==='scene.glb'?sourceJob.artifacts.findIndex(a=>a.name==='scene.json'&&a.kind==='evidence'):-1;let scene=null;
    if(sceneIndex>=0){try{scene=JSON.parse(new TextDecoder().decode(await sourceClient.previewArtifact(sourceJob,sceneIndex,controller.signal)));}catch(e){if(controller.signal.aborted)return;}}
    if(controller.signal.aborted)return;
    // A clear or page hide while the viewer is being created replaces scenePromise; that late viewer is disposed, not kept.
    if(!sceneViewer){const pending=scenePromise||=import('./mesh-viewer.mjs').then(m=>m.createMeshViewer($('scene-stage'),message=>sceneStatus(message,true))).catch(e=>{scenePromise=null;throw e;});const viewer=await pending;if(pending!==scenePromise){viewer.destroy();return;}sceneViewer=viewer;}
    if(controller.signal.aborted)return;
    const parsed=await sceneViewer.setFile(new File([buffer],item.name,{type:'model/gltf-binary'}));
    if(controller.signal.aborted)return;
    $('scene-facts').replaceChildren(...sceneFacts(scene).map(text=>Object.assign(document.createElement('li'),{textContent:text})));
    sceneStatus(`${item.name} from ${sourceJob.engine} · ${parsed.meshes.toLocaleString('en')} meshes · ${parsed.vertices.toLocaleString('en')} vertices · SHA-256 checked`);
    event('scene_opened',{job:sourceJob.id,engine:sourceJob.engine,sha256:item.sha256,sceneJsonSha256:sceneIndex>=0?sourceJob.artifacts[sceneIndex].sha256:null});
    if(scene?.schema==='brainsnn.scene.v1'&&scene.units==='m'){sceneMap={scene,job:sourceJob.id,engine:sourceJob.engine,source:typeof scene.source==='string'?scene.source.slice(0,80):item.name};$('scene-plan').hidden=false;}
    // Evidence and review are scoped to this job, never borrowed from the currently active capture.
    const cloudIndex=sceneIndex>=0?sourceJob.artifacts.findIndex(a=>a.name==='arena-cloud.json'):-1;
    const reportIndex=sceneIndex>=0?sourceJob.artifacts.findIndex(a=>a.name==='scene-measurements.json'):-1;
    let cloud=null,report=null;
    if(cloudIndex>=0){try{cloud=JSON.parse(new TextDecoder().decode(await sourceClient.previewArtifact(sourceJob,cloudIndex,controller.signal)));}catch(error){if(controller.signal.aborted)return;event('scene_cloud_unavailable',error.message);}}
    if(reportIndex>=0){try{report=JSON.parse(new TextDecoder().decode(await sourceClient.previewArtifact(sourceJob,reportIndex,controller.signal)));}catch(error){if(controller.signal.aborted)return;event('dimension_report_unavailable',error.message);}}
    if(controller.signal.aborted)return;
    await bimWorkflow.showScene({scene,cloud,report,job:sourceJob.id,artifacts:sourceJob.artifacts,sourceClient,signal:controller.signal,sceneSha:sceneIndex>=0?sourceJob.artifacts[sceneIndex].sha256:null});
    update();status('Simulation scene opened. Review dimensions and openings before using its BIM exports. Routes remain planning previews.');
  }catch(e){if(!controller.signal.aborted){sceneStatus('Scene preview failed: '+e.message,true);status('Scene preview failed: '+e.message,true);}}
  finally{if(sceneAbort===controller)sceneAbort=null;}
}
function renderSystems(){const q=$('system-search').value.toLowerCase().trim();const list=SYSTEMS.filter(s=>(filter==='all'||s.state===filter)&&[s.name,s.description,s.gate].join(' ').toLowerCase().includes(q));$('systems-grid').innerHTML=list.length?list.map(s=>`<article class="system-card" data-state="${s.state}"><div class="system-top"><span>${s.id} / SYSTEM</span><span>${s.state==='local'?'LOCAL TOOL':s.state==='adapter'?'WORKER / LOADER INTERFACE':s.state==='gated'?'GATED CANDIDATE':'PLANNED'}</span></div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><p class="system-gate">${esc(s.gate)}</p>${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Primary source ↗</a>`:''}</article>`).join(''):'<p class="micro">No matching systems.</p>';}
async function action(name){try{
  if(name==='files')$('files').click();
  if(name==='native-capture')$('native-capture-files').click();
  if(name==='video')$('video-file').click();
  if(name==='depth'&&activeSource?.kind==='image')$('depth-consent').showModal();
  if(name==='detect'&&activeSource?.kind==='image')$('detect-consent').showModal();
  if(name==='cancel-detect')detectAbort?.abort();
  if(name==='cancel-depth')depthAbort?.abort();
  if(name==='visual-export'&&activeSource?.visual)deliver(['brainsnn-visible-points.ply',toPLY(activeSource.visual.points),'application/octet-stream'],['brainsnn-preview-provenance.json',{schema:'brainsnn.visual-provenance.v1',source:activeSource.name,...activeSource.derivation,metricVerified:false,collisionGeometry:null}]);
  if(name==='arena-cloud'&&activeSource?.visual){const scale=measuredScale(activeSource.visual);download('brainsnn-point-cloud.json',toArenaCloud(activeSource.visual.points,{source:activeSource.name,coordinateFrame:arenaFrame(activeSource),metresPerUnit:scale?.metresPerUnit,measurement:scale}));if(!matchMedia('(pointer: coarse)').matches)window.open('../arena/#playground?robot=g1&view=site','_blank','noopener');status(`Point cloud saved${scale?` at your measured scale (${scale.metresPerUnit.toPrecision(4)} m per unit)`:' in arbitrary units'}. In Robot Arena: Capture → Add 3D visual → choose brainsnn-point-cloud.json. It is a visual reference only; ${scale?'confirm the scale and ':'measure and '}mark obstacles before planning.`);}
  if(name==='install')await installApp();
  if(name==='phone')$('phone-camera').click();
  if(name==='record')await record();
  if(name==='connection')$('connection').showModal();
  if(name==='process')await processSources();
  if(name==='cancel-job')await cancelRemote();
  if(name==='new-map'){if(world&&!confirm('Replace the current map with an empty measured-map draft? Captures stay in this session.'))return;apply({schema:SCHEMA,name:'My measured space',width:12,depth:9,start:{x:1,z:1},objects:[],provenance:'observed',scaleReviewed:false,mapReviewed:false},'Measured-map draft created. Enter actual dimensions and obstacles.');setTab('world');}
  if(name==='add-object'&&world){const id=crypto.randomUUID();selected=id;mutate(w=>w.objects.push({id,name:'New obstacle',x:Math.max(0,w.width/2-.5),z:Math.max(0,w.depth/2-.5),w:Math.min(1,w.width/2),d:Math.min(1,w.depth/2),h:1,kind:'unknown'}));}
  if(name==='remove-object'&&world)mutate(w=>{w.objects=w.objects.filter(o=>o.id!==selected);});
  if(name==='save-map'&&world){localStorage.setItem('brainsnn.world.v1',JSON.stringify(world));status('Map saved locally. Source media and worker tokens were not saved.');}
  if(name==='restore'){const stored=localStorage.getItem('brainsnn.world.v1');if(!stored)throw new Error('No saved World Studio map in this browser.');const w=normalizeWorld(JSON.parse(stored));w.mapReviewed=false;w.scaleReviewed=false;apply(w,'Saved map restored. Reconfirm the current site.');}
  if(name==='map-export'&&world)download('brainsnn-world.json',world);
  if(name==='pick-dimension'){calibration.picking=false;display='visual';renderMedia();visualViewer?.orbit(false);if(bimWorkflow.startPicking())$('visual-canvas').scrollIntoView({block:'center'});return;}
  if(name==='add-dimension'){await bimWorkflow.addReading();return;}
  if(name==='pick-scale'&&activeSource?.visual){bimWorkflow.reset();const c=calibrationFor(activeSource.visual);
    if(c.picking){c.picking=false;c.picks=[];visualViewer?.setMarkers([]);status('Point picking cancelled.');}
    else{c.picking=true;c.picks=[];display='visual';renderMedia();visualViewer?.orbit(false);visualViewer?.setMarkers([]);status('Tap the first end of the distance you measured.');}
    renderPanel();if(c.picking)$('visual-canvas').scrollIntoView({block:'center'});return;}
  if(name==='metric-scene'&&activeSource?.visual){
    const source=activeSource,c=calibrationFor(source.visual),entry=sceneEngine();c.distance=$('measured-distance')?.value??c.distance;
    const scale=measuredScale(source.visual);
    if(!client||!entry)throw new Error('Connect a worker with a simulation scene engine first.');
    if(!entry.dimension_checks||!entry.bim_review)throw new Error('Update this worker with dimensional checks and BIM review, then reconnect before compiling.');
    if(isRemoteActive())throw new Error('Wait for the current worker job to finish or cancel it.');
    if(!multiView(source))throw new Error('A simulation scene needs a multi-view reconstruction with camera poses, not a single-photo preview.');
    if(!scale)throw new Error(`Enter the distance you measured between the two points (${PROPOSAL.minMeasuredDistance}–${PROPOSAL.maxMeasuredDistance} m).`);
    if(!$('scene-consent')?.checked)throw new Error('Approve uploading the measured point cloud to your worker first.');
    // Naming is a second, separate approval: crops of the person's frames go to a third-party model.
    const naming=!!(entry.object_naming&&source.derivation?.job&&$('scene-naming')?.checked);
    // A detector on the worker names objects from the same job's frames without sending them anywhere, so it needs no second approval.
    const cloud=await bimWorkflow.attach(metricCloud());if(naming)cloud.nameObjects=true;
    const file=new File([JSON.stringify(cloud)],'brainsnn-point-cloud.json',{type:'application/json'});
    event('metric_scene_requested',{source:source.name,...(source.derivation||{}),points:cloud.points.length,metresPerUnit:scale.metresPerUnit,distance:scale.distance,selfReported:true,nameObjects:naming,...(naming?{namingModel:entry.object_naming.model}:{})});
    await runJob(entry.id,[{file,kind:'cloud',name:file.name}],naming||(entry.object_detection&&source.derivation?.job)?{source_job:source.derivation.job}:{});return;}
  if((name==='propose-map'||name==='propose-measured')&&activeSource?.visual&&activeSource.reconstruction){
    const visual=activeSource.visual,c=calibrationFor(visual);let measurement=null;
    if(name==='propose-measured'){c.distance=$('measured-distance')?.value??'';if(c.picks.length!==2)throw new Error('Pick two points first.');
      measurement={a:pickedPoint(visual,c.picks[0]),b:pickedPoint(visual,c.picks[1]),distance:c.distance===''?NaN:Number(c.distance)};}
    else cameraHeight=Number($('camera-height')?.value);
    const {world:proposed,report}=proposeWorld({points:visual.points,reconstruction:activeSource.reconstruction,name:`Proposed map / ${activeSource.name}`,cameraHeight,measurement});
    if(world&&world.provenance!=='authored'&&!confirm('Replace the current map with a map proposed from this reconstruction?'))return;
    apply(proposed,`Map proposed from ${report.cameras} camera poses and ${report.points.toLocaleString()} points${measurement?` at your measured ${measurement.distance} m scale (phone ${report.impliedCameraHeight} m above the floor)`:''}: ${report.area.free} m² seen free, ${report.area.obstacle} m² obstacles, ${report.area.unknown} m² unknown. Review scale and obstacles, then plan.`);
    event('map_proposed',{source:activeSource.name,...(activeSource.derivation||{}),method:report.method,cameras:report.cameras,points:report.points,scaleSource:report.scaleSource,assumedCameraHeight:report.assumedCameraHeight,impliedCameraHeight:report.impliedCameraHeight,
      ...(report.measurement?{measurement:{a:report.measurement.a,b:report.measurement.b,distance:report.measurement.distance,spanUnits:report.measurement.span,selfReported:true}}:{}),metresPerUnit:report.metresPerUnit,area:report.area,scaleVerified:false});
    setTab('world');
  }
  if(name==='proof')download('brainsnn-proof.json',await proofPack(world,result,assumptions,sources,events,observations.proofs(),measurements.session()));
  if(name==='arena-export')download('brainsnn-arena-map.json',arenaMap(world));
  if(name==='usd-export')download('brainsnn-world.usda',usdScene(world),'text/plain');
  if(name==='scenario-export'&&baseline)download('brainsnn-scenarios.json',{schema:'brainsnn.comparison.v1',baseline,current:{world,result,assumptions},claim:'Scenario estimates, not measured outcomes.'});
  if(name==='add-note'){const text=$('note-text').value.trim(),s=$('note-source').value,t=Number($('note-time').value);if(!text||!Number.isFinite(t)||t<0||t>86400)throw new Error('Enter an observation and valid timestamp.');event('human_observation',{source:s===''?'reviewed map':sources[Number(s)]?.name,seconds:t,text:text.slice(0,400)});$('note-text').value='';status('Human-authored observation saved in this session.');}
  if(name==='clear'){if(!confirm('Clear the local map, captures and observations? Remote uploads expire separately on the worker.'))return;cancelConnection();capture.stop({discard:true});await cancelRemote();depthAbort?.abort();detectAbort?.abort();artifactAbort?.abort();sceneAbort?.abort();$('scene-dialog').close();sceneViewer?.destroy();sceneViewer=null;scenePromise=null;depthStatus='';observations.clear();measurements.clear();bimWorkflow.reset();visibleVisual=null;calibration={visual:null,picks:[],picking:false,distance:''};visualViewer?.destroy();visualViewer=null;sources.forEach(s=>URL.revokeObjectURL(s.url));sources=[];activeSource=null;events=[];baseline=null;client=null;caps=null;job=null;localStorage.removeItem('brainsnn.world.v1');apply(sampleWorld(),'Local session cleared. Authored sample restored.');setTab('world');$('worker-summary').textContent='Local planning available';$('worker-note').textContent='No model is connected.';}
}catch(e){status(e.message,true);}}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.workflow){const step=b.dataset.workflow;if(step==='review'&&bimWorkflow.hasScene&&job?.status==='complete'){const index=job.artifacts?.findIndex(a=>a.name==='scene.glb')??-1;if(index>=0){void openSceneArtifact(index);return;}}setTab(step==='export'?'evidence':'capture');$('workspace').scrollIntoView({block:'start',behavior:'smooth'});if(step==='scale')($('measured-distance')||document.querySelector('[data-action=pick-scale]'))?.focus({preventScroll:true});if(step==='review')$('dimension-review')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
  if(b.dataset.dimensionRemove!==undefined){bimWorkflow.removeReading(Number(b.dataset.dimensionRemove));return;}
  if(b.dataset.bimRemove!==undefined){bimWorkflow.removeOpening(Number(b.dataset.bimRemove));return;}
  if(b.dataset.bimAction){try{if(b.dataset.bimAction==='add')bimWorkflow.addOpening();else if(b.dataset.bimAction==='recompile')void bimWorkflow.recompile().catch(error=>sceneStatus(error.message,true));}catch(error){sceneStatus(error.message,true);}return;}
  if(b.dataset.sceneDownload!==undefined){void bimWorkflow.downloadScene(Number(b.dataset.sceneDownload)).catch(error=>sceneStatus(error.message,true));return;}
  if(b.dataset.tab){setTab(b.dataset.tab);return;}if(b.dataset.action){void action(b.dataset.action);return;}
  if(b.dataset.view){renderer?.setMode(b.dataset.view);document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));setTab('world');return;}
  if(b.dataset.filter){filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderSystems();return;}
  if(b.dataset.reviewArtifact!==undefined){void openObservationArtifact(Number(b.dataset.reviewArtifact));return;}
  if(b.dataset.previewArtifact!==undefined){void openArtifact(Number(b.dataset.previewArtifact));return;}
  if(b.dataset.sceneArtifact!==undefined){void openSceneArtifact(Number(b.dataset.sceneArtifact));return;}
  if(b.dataset.source!==undefined){bimWorkflow.reset();depthAbort?.abort();activeSource=sources[Number(b.dataset.source)];display=activeSource.visual?'visual':'source';renderPanel();renderMedia();update();return;}
  if(b.dataset.remove!==undefined){if(nativeCheckAbort){nativeCheckAbort.abort();nativeCheckAbort=null;jobStatus='';}bimWorkflow.reset();const i=Number(b.dataset.remove),s=sources[i];observations.removeSource(s);URL.revokeObjectURL(s.url);sources.splice(i,1);if(activeSource===s){depthAbort?.abort();activeSource=sources[0]||null;}renderPanel();renderMedia();update();return;}
  if(b.dataset.artifact!==undefined&&client&&job){client.download(job.id,Number(b.dataset.artifact)).then(url=>{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';a.click();status('Download started using a short-lived ticket; the file is not buffered by the page.');}).catch(e=>status(e.message,true));}
});
// A picker that returns no file (closed, or on iPhone a video whose conversion failed) says so instead of doing nothing.
const PICKERS=['files','video-file','phone-camera','native-capture-files'],NO_FILE='No file came back from your phone\'s picker. On iPhone, a video picked from Photo Library is converted first and that can fail for a long video: in Photos, tap Share → Save to Files, then pick it here with Choose File.';
document.addEventListener('cancel',e=>{if(PICKERS.includes(e.target?.id))status(NO_FILE,true);},true);
document.addEventListener('change',e=>{const id=e.target.id,v=e.target.value;if(PICKERS.includes(id)){if(!e.target.files?.length){status(NO_FILE,true);return;}void addFiles(e.target.files,{nativeCapture:id==='native-capture-files'});return;}if(id==='objects'){selected=v;renderInspector();return;}
  if(id==='robot'){robotId=v;robot={...ROBOTS[v],margin:robot.margin};invalidate();renderPanel();return;}
  if(id.startsWith('robot-')){const k=id.slice(6),next=Number(v),range={width:[.1,5],depth:[.1,5],speed:[.01,3],margin:[0,2]}[k];if(!range||!Number.isFinite(next)||next<range[0]||next>range[1]){status('Robot parameter is outside the supported range.',true);renderPanel();return;}robot[k]=next;invalidate();return;}
  if(Object.hasOwn(assumptions,id)){const next={...assumptions,[id]:v===''?null:Number(v)};try{estimate(result||{travelSeconds:0,turns:0},next);assumptions=next;update();renderPanel();}catch(err){status(err.message,true);renderPanel();}return;}
  if(id==='bim-host-wall'){bimWorkflow.selectHost(Number(v));return;}
  if(id==='camera-height'){cameraHeight=Number(v);return;}
  if(id==='measured-distance'){calibration.distance=v;bimWorkflow.reset();visualViewer?.setMarkers(calibration.picks);const slot=$('dimension-review-slot');if(slot&&activeSource?.visual)slot.innerHTML=bimWorkflow.captureHTML(activeSource,measuredScale(activeSource.visual),calibration,sceneEngine());update();status('Scale updated. Independent checks and opening reviews must be added again.');return;}
  if(!world)return;
  if(id==='scale-reviewed'||id==='map-reviewed'){world[id==='scale-reviewed'?'scaleReviewed':'mapReviewed']=e.target.checked;invalidate();event('human_review',id+': '+e.target.checked);return;}
  if(id==='map-name'){world.name=v.slice(0,160);update();return;}
  if(id==='floor-width'||id==='floor-depth'){if(world.floor){status('Edit dimensions in the source map and reimport to preserve the captured floor polygon.',true);renderPanel();return;}mutate(w=>{w[id==='floor-width'?'width':'depth']=Number(v);w.scaleReviewed=false;});return;}
  if(id==='start-x'||id==='start-z'){mutate(w=>{w.start[id.slice(-1)]=Number(v);});return;}
  if(id.startsWith('object-')){const key=id.slice(7);mutate(w=>{const o=w.objects.find(o=>o.id===selected);if(o)o[key]=['name','kind'].includes(key)?v:Number(v);});}
});
$('hero-capture').onclick=()=>{setTab('capture');$('workspace').scrollIntoView();};$('hero-sample').onclick=()=>{if(world&&world.provenance!=='authored'&&!confirm('Replace the current map with the authored sample?'))return;apply(sampleWorld(),'Authored sample loaded, not a reconstruction of your media.');setTab('world');$('workspace').scrollIntoView();};
$('run').onclick=run;$('replay').onclick=replay;$('scrub').oninput=()=>{stopReplay();renderer?.setCursor(Number($('scrub').value)/1000);};$('reset-view').onclick=()=>{if(!$('visual-canvas').hidden)visualViewer?.reset();else renderer?.reset();};$('show-source').onclick=()=>{display='source';renderMedia();};$('show-visual').onclick=()=>{display='visual';renderMedia();};$('depth-start').onclick=()=>void buildDepth();$('detect-start').onclick=()=>void identifyObjects();$('flip-visual').onclick=()=>visualViewer?.flip();$('export').onclick=()=>action('proof');$('fork').onclick=()=>{if(!result){status('Run a planning preview before saving a comparison baseline.',true);return;}baseline={world:clone(world),result:clone(result),assumptions:clone(assumptions)};event('scenario_forked',{distance:result.distance,minutes:estimate(result,assumptions).minutes});status('Baseline saved. Edit an obstacle or robot parameter and run again to compare.');setTab('test');};$('connect').onclick=connect;$('site-connect').onclick=connectSite;$('system-search').oninput=renderSystems;
// A tap (not a drag) on the 3D view picks a calibration point while picking is on; the viewer keeps handling orbit and zoom.
{let down=null;const canvas=$('visual-canvas');
  canvas.addEventListener('pointerdown',e=>{down=e.isPrimary&&e.button===0?[e.clientX,e.clientY]:null;});
  canvas.addEventListener('pointerup',e=>{const c=calibration,visual=activeSource?.visual;if(!down||!visualViewer||(!c.picking&&!bimWorkflow.picking)||c.visual!==visual||visibleVisual!==visual||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;down=null;
    const index=visualViewer.pick(e.clientX,e.clientY);if(index<0){status('No reconstructed point there. Zoom in and tap directly on a point.',true);return;}
    if(bimWorkflow.pick(index)){if(!bimWorkflow.picking)$('dimension-distance')?.scrollIntoView({block:'center'});return;}
    if(c.picks.includes(index)){status('That point is already picked. Tap the other end of the distance.',true);return;}
    c.picks.push(index);visualViewer.setMarkers(c.picks);if(c.picks.length===2)c.picking=false;
    renderPanel();status(c.picks.length===2?'Both points picked. Enter the distance you measured between them.':'Now tap the other end of the distance you measured.');
    if(c.picks.length===2){$('measured-distance')?.focus({preventScroll:true});$('measured-distance')?.scrollIntoView({block:'center'});}});}
document.querySelector('.tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const ids=['capture','world','understand','test','evidence'];const i=ids.indexOf(tab),n=e.key==='Home'?0:e.key==='End'?4:(i+(['ArrowRight','ArrowDown'].includes(e.key)?1:4))%5;setTab(ids[n],true);});
$('workspace').addEventListener('dragover',e=>{e.preventDefault();});$('workspace').addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer?.files.length)void addFiles(e.dataTransfer.files);});
$('connection').addEventListener('close',cancelConnection);
$('scene-dialog').addEventListener('close',()=>sceneAbort?.abort());$('scene-reset').onclick=()=>sceneViewer?.reset();
// A metric scene's walls, separated objects and unobserved floor become an unreviewed planning map; the robot waits for review.
$('scene-plan').onclick=async()=>{try{if(!sceneMap)return;const {worldFromScene}=await import('./scene-preview.mjs');
  const {world:proposed,counts,summary}=worldFromScene(sceneMap.scene,`Scene map / ${sceneMap.source}`);
  if(world&&world.provenance!=='authored'&&!confirm('Replace the current map with a map built from this simulation scene?'))return;
  $('scene-dialog').close();
  apply(proposed,summary);
  event('scene_map_proposed',{job:sceneMap.job,engine:sceneMap.engine,...counts,boxes:proposed.objects.length,scaleVerified:false});setTab('world');
}catch(e){sceneStatus('A planning map could not be built from this scene: '+e.message,true);}};
window.addEventListener('pagehide',e=>{nativeCheckAbort?.abort();nativeCheckAbort=null;cancelConnection();depthAbort?.abort();detectAbort?.abort();artifactAbort?.abort();sceneAbort?.abort();capture.stop({discard:true});stopReplay();planner?.terminate();planner=null;planning=false;remoteAbort?.abort();remoteAbort=null;clearTimeout(poll);if(e.persisted)return;observations.clear();visualViewer?.destroy();sceneViewer?.destroy();sceneViewer=null;scenePromise=null;sources.forEach(s=>URL.revokeObjectURL(s.url));renderer?.destroy();});
window.addEventListener('pageshow',e=>{if(!e.persisted)return;renderPanel();renderMedia();update();if(job&&client&&!['complete','failed','cancelled'].includes(job.status)){remoteAbort=new AbortController();void checkJob(remoteAbort.signal).catch(error=>{remoteAbort=null;status('Could not resume job status: '+error.message,true);});}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopReplay();capture.stop();}});
renderer?.setWorld(world);renderInspector();setTab('world');renderSystems();update();void loadSiteProcessing();
// Arriving from the homepage's install button: show the iOS steps on the page they apply to.
if(new URLSearchParams(location.search).has('install')&&!standalone())void installApp();
