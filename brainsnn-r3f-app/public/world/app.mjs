import {SCHEMA,LIMITS,ROBOTS,clone,normalizeWorld,sampleWorld,planningGate,routeWorld,estimate,classifyFile,proofPack,arenaMap,usdScene} from './core.mjs';
import {createRenderer} from './renderer.mjs';
import {createHeroDemo} from './hero-demo.mjs';
import {mountPlaygroundHelp} from './playground-help.mjs';
import {WorkerClient} from './worker-client.mjs';
import {automaticReviewArtifact} from './artifact-review.mjs';
import {SYSTEMS} from './catalog.mjs';
import {mountShowcase} from './showcase.mjs';
import {chapters as studioChapters} from './showcase-features.mjs';
import {createWorkbench,isWorkbenchPage,mountStudioBar} from './studio.mjs';
import {createVisualViewer} from './visual-viewer.mjs';
import {fromDepth,parseVisualAsset,toPLY,toArenaCloud,STRIDE} from './visual-geometry.mjs';
import {decodePhoto,inferDepth} from './depth-client.mjs';
import {detectObjects,framePng} from './detect-client.mjs';
import {DETECTOR} from './detections.mjs';
import {importWorld} from './import-world.mjs';
import {createObservationReview} from './observation-ui.mjs';
import {createCaptureClient} from './capture-client.mjs';
import {readVideoMetadata,videoResolutionIssue} from './video-metadata.mjs';
import {parseHandoffHash, readLocalCapture, clearLocalCapture} from './capture-handoff.mjs';
import {reconstructionRecovery} from './reconstruction-recovery.mjs';
import {reconstructionFrameAudit,reconstructionFrameCSV} from './reconstruction-frame-audit.mjs';
import {captureBefore,compare as compareWhatIf,sameRobot,whatIfCard} from './what-if.mjs';
import {routeReceipt,receiptCard} from './route-receipt.mjs';
import {capturePath,viewAt,pathLength} from './capture-path.mjs';
import {captureReportCard} from './capture-report.mjs';
import {readNativeCapture,prepareNativeCapture,NATIVE_CAPTURE} from './native-capture.mjs';
import {createMeasurementReview} from './measurement-ui.mjs';
import {createBimWorkflow} from './bim-workflow-ui.mjs';
import {createSurfaceReview} from './surface-review-ui.mjs';
import {proposeWorld,readScaleEstimate,PROPOSAL} from './reconstruction-map.mjs';
import {readLocalization,photoOnMap,floorFromTap,proposalAfterApply} from './photo-locator.mjs';
import {recordShareVideo} from './share-video.mjs';
import {mountDemoReplay} from './demo-replay-ui.mjs';
import {reviewQuestions} from './review-questions.mjs';
import {createSandboxUI} from './sandbox-ui.mjs';
import {createWorkspaceResults,sourceJobOptions,shouldOpenCompletedResult} from './workspace-results.mjs';
import {mountUnifiedWorkspace} from './unified-workspace-ui.mjs';
import {createSceneWorkspace} from './scene-workspace.mjs';
import {mountProjectReview} from './project-review-ui.mjs';
import {mountWorldLayerTools} from './world-layer-tools.mjs';
import {mountRobotSetup} from './robot-setup.mjs';
import {mountCameraDock} from './playground-controls.mjs';
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const workspaceResults=createWorkspaceResults(),sourceIds=new WeakMap();
let sourceBindings=new WeakMap(),sourceSequence=0,viewRevision=0,jobExecution=null,unifiedWorkspace=null,sceneContext=null,layerTools=null;
// Robot-first setup and camera buttons. worldOrigin says which world choice made the current map; edits keep it.
let robotSetup=null,cameraDock=null,worldOrigin='sample',nextOrigin=null,runIssue=null;
// Undo/redo for map edits only (mutate). Replacing the map clears it; an undone map always needs review again.
const editHistory={undo:[],redo:[]};
const sourceId=source=>{if(!source)return null;if(!sourceIds.has(source))sourceIds.set(source,`source-${++sourceSequence}`);return sourceIds.get(source);};
const sceneWorkspace=createSceneWorkspace();
let world=sampleWorld(), tab='world', selected='storage', result=null, baseline=null, epoch=0, planner=null, planning=false, sandbox=null;
let robot={...ROBOTS.cleaner,margin:.1}, robotId='cleaner', assumptions={setupMinutes:5,turnSeconds:0,assistanceMinutes:0,robotRate:null,labourRate:null};
let nativeCheckAbort=null;
let sources=[],activeSource=null,events=[],client=null,caps=null,job=null,jobStatus='',remoteAbort=null,poll=null,siteProcessing=null;
let demoVideoDispose=null;
let videoAbort=null,replayFrame=null,replayStart=0,filter='all',systemsOpen=false,renderer=null,cameraHeight=PROPOSAL.cameraHeight;
// Scale calibration: two picked reconstruction points (indices into visual.points) and the distance the user measured between them.
let calibration={visual:null,picks:[],picking:false,distance:''};
// The map proposed from a worker reconstruction keeps that reconstruction's job and its map transform, so a photo located
// in the same reconstruction can be placed on the map. located is that photo, its pose and the floor spot tapped in it.
let mapProposal=null,located=null,whatIf=null,goalSpot=null,pathPlay=null,receipt=null;
const isMainRemoteActive=()=>nativeCheckAbort||remoteAbort||job&&!['complete','failed','cancelled'].includes(job.status);
const isRemoteActive=()=>isMainRemoteActive()||layerTools?.isActive();
let detectAbort=null;
let visualViewer=null,visibleVisual=null,display='visual',depthAbort=null,depthStatus='',artifactAbort=null,connectionAbort=null;
let projectReviewContextKey='',projectReviewLoadAbort=null;
function cancelProjectReviewLoad(){projectReviewLoadAbort?.abort();projectReviewLoadAbort=null;projectReviewContextKey='';}
const projectReview=mountProjectReview({host:$('project-review-host'),getToken:()=>client?.site?client.token:null,onSourceIntent:cancelProjectReviewLoad});
function resetProjectReview(){cancelProjectReviewLoad();projectReview.clear();}
async function openProjectReview(key=''){
  const dialog=$('project-review-dialog'),context=workspaceResults.get(key);
  if(!dialog.open)dialog.showModal();
  const index=context?.job.artifacts.findIndex(a=>a.name==='scene.json')??-1;
  if(!context||index<0){if(projectReviewContextKey)resetProjectReview();$('project-review-host').querySelector('#pr-open-source')?.focus();return;}
  const item=context.job.artifacts[index];
  if(projectReviewContextKey===context.key&&projectReview.sourceSha256===item.sha256)return;
  resetProjectReview();const controller=new AbortController();projectReviewLoadAbort=controller;
  try{
    if(item.size>256*1024)throw Error('Project Review supports scene.json up to 256 KiB. Open a bounded room model.');
    const bytes=await context.sourceClient.previewArtifact(context.job,index,controller.signal);
    if(projectReviewLoadAbort!==controller||controller.signal.aborted||!workspaceResults.isCurrent(context))return;
    const sceneText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    await projectReview.setSource({sceneText,sceneSha256:item.sha256,sourceLabel:(context.sourceNames?.join(', ')||'Compiled building model').slice(0,160)});
    // An older request must never clear a source chosen while it was hashing.
    if(projectReviewLoadAbort!==controller||controller.signal.aborted||!workspaceResults.isCurrent(context))return;
    projectReviewContextKey=context.key;
  }catch(error){if(projectReviewLoadAbort===controller&&!controller.signal.aborted){const note=$('project-review-host').querySelector('#pr-status');note.textContent=error.message;note.dataset.error='true';}}
  finally{if(projectReviewLoadAbort===controller)projectReviewLoadAbort=null;}
}
$('project-review-close').addEventListener('click',()=>$('project-review-dialog').close());
$('project-review-dialog').addEventListener('close',()=>{projectReviewLoadAbort?.abort();projectReviewLoadAbort=null;projectReview.cancel();});
$('scene-project-review').addEventListener('click',()=>void openProjectReview(sceneContext?.jobKey));
// A deliberate same-origin handoff copies one bounded map snapshot, never the
// worker credential or original capture media. The Projects page asks the user
// to select a workspace and explicitly retain these bytes before any upload.
let projectSnapshotHandoff=null;
function saveMapToProject(){
  if(sandbox?.isStreet()){status('Use the street scene export, then upload its bounded source file in Saved projects.',true);return;}
  if(!world){status('Open a map before saving a project snapshot.',true);return;}
  const content_text=JSON.stringify({schema:'brainsnn.workspace-snapshot.v1',captured_at:new Date().toISOString(),source_type:'workspace-snapshot',world:clone(world),robot:clone(robot),assumptions:clone(assumptions),planning_result:result?clone(result):null,planning_result_is_simulation:true,source_files_retained:false,source_names:sources.map(source=>source.name)},null,2);
  if(new TextEncoder().encode(content_text).length>512*1024){status('This map snapshot exceeds 512 KiB. Download your results and retain a smaller exact excerpt in Saved projects.',true);return;}
  projectSnapshotHandoff?.();
  const target=window.open('/world/projects.html','_blank');
  if(!target){status('Allow this page to open Saved projects, or download your map and upload it there.',true);return;}
  const source={name:'brainsnn-workspace-snapshot.json',content_text};
  let timeout;
  function cleanup(){window.removeEventListener('message',receive);clearTimeout(timeout);if(projectSnapshotHandoff===cleanup)projectSnapshotHandoff=null;}
  function receive(message){
    if(message.origin!==location.origin||message.source!==target)return;
    if(message.data?.type==='brainsnn-project-ready')target.postMessage({type:'brainsnn-project-source',source},location.origin);
    if(message.data?.type==='brainsnn-project-source-received'){cleanup();status('Map snapshot copied to Saved projects. Select a project there and choose Save snapshot to retain it.');}
  }
  window.addEventListener('message',receive);timeout=setTimeout(cleanup,60000);projectSnapshotHandoff=cleanup;
  status('Opening Saved projects. The snapshot stays in page memory until you choose to save it there.');
}
$('save-map-to-project')?.addEventListener('click',saveMapToProject);
window.addEventListener('pagehide',()=>projectSnapshotHandoff?.());
function getVisualViewer(){if(!visualViewer)visualViewer=createVisualViewer($('visual-canvas'));return visualViewer;}
try{renderer=createRenderer($('world-canvas'));renderer.setRobot(robot);}catch(e){status(e.message,true);}
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);unifiedWorkspace?.refresh();robotSetup?.refresh();}
function event(type,detail){events.push({time:new Date().toISOString(),type,detail});events=events.slice(-200);}
const observations=createObservationReview({getSources:()=>sources,status,event});
const measurements=createMeasurementReview({getWorld:()=>world,status,event,download});
function stopReplay(){cancelAnimationFrame(replayFrame);replayFrame=null;$('replay').textContent='Replay';}
// A what-if compares one robot's route before and after a map edit. Once the robot's footprint, speed or margin changes,
// that comparison is no longer like for like, so it is dropped rather than shown as "same robot". Returns true if it was.
function dropStaleWhatIf(){if(!whatIf||sameRobot(whatIf,robot))return false;whatIf=null;renderer?.setGhost(null);return true;}
function invalidate(){runIssue=null;epoch++;planner?.terminate();planner=null;planning=false;result=null;receipt=null;stopReplay();renderer?.setResult(null);$('scrub').value=0;update();renderMedia();}
function apply(next,message,{review=false,proposal}={}){const w=normalizeWorld(next);viewRevision++;if(!review){whatIf=null;renderer?.setGhost(null);worldOrigin=w.provenance==='authored'?'sample':(nextOrigin||'own');editHistory.undo=[];editHistory.redo=[];}nextOrigin=null;mapProposal=proposalAfterApply(mapProposal,{review,proposal});if(located?.url)URL.revokeObjectURL(located.url);located=null;renderer?.setMarks(null);if(review){w.mapReviewed=false;}measurements.mapChanged(w,{replaced:!review});world=w;invalidate();renderInspector();renderPanel();renderer?.setWorld(world);updateUndo();if(message)status(message);}
function mutate(fn,kind='edited'){try{const next=clone(world);fn(next);const prior={world:clone(world),selected};const before=captureBefore({goal:result?.goal,result,world,selected,kind,robot});apply(next,'Map updated. Review changed geometry before planning.',{review:true});editHistory.undo.push(prior);if(editHistory.undo.length>60)editHistory.undo.shift();editHistory.redo=[];updateUndo();whatIf=before||whatIf;if(whatIf&&!before)whatIf.after=null;renderer?.setGhost(null);renderPanel();event('geometry_edit',selected||'floor');}catch(e){status(e.message,true);renderInspector();renderPanel();}}
function updateUndo(){const street=!!sandbox?.isStreet();for(const [id,list] of [['undo-edit',editHistory.undo],['redo-edit',editHistory.redo]]){const b=$(id);if(!b)continue;b.hidden=street;b.disabled=street||!world||!list.length;}}
// Undo and redo restore the map geometry. The restored map is never marked reviewed: a person checks it again before planning.
function stepEdit(back){const from=back?editHistory.undo:editHistory.redo,to=back?editHistory.redo:editHistory.undo;if(!from.length||!world||sandbox?.isStreet()){updateUndo();return;}const snap=from.pop();to.push({world:clone(world),selected});selected=snap.selected;whatIf=null;renderer?.setGhost(null);try{apply(snap.world,back?'Change undone. Check the map again before the robot tries a route.':'Change redone. Check the map again before the robot tries a route.',{review:true});}catch(e){status(e.message,true);}renderPanel();updateUndo();event('geometry_edit',back?'undo':'redo');}
function chooseRobot(id){if(!ROBOTS[id])return;robotId=id;robot={...ROBOTS[id],margin:robot.margin};invalidate();dropStaleWhatIf();renderPanel();renderer?.setRobot(robot);robotSetup?.refresh();}
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
/** Real → sim: one button to the robot map. Its scale is the worker's estimate when the reconstruction has one, else the
 *  phone height; a measured distance (calibration card) replaces either. */
/** The engine a worker job most likely wants: one photo gets its metric 3D preview, a walkthrough or capture its reconstruction. */
function preferredEngine(){
  const photoOnly=sources.length===1&&sources[0].kind==='image';
  if(photoOnly&&caps?.engines?.some(e=>e.available&&e.id==='photo-metric'))return 'photo-metric';
  return client?.site||sources.some(s=>s.kind==='capture')?'colmap-sparse':'';
}
/** "Before you plan, check": the map's own open questions, until both review boxes are ticked. */
function checkFirst(w){
  const questions=w.scaleReviewed&&w.mapReviewed?[]:reviewQuestions(w);
  if(!questions.length)return '';
  return `<div class="check-first" role="note"><h4>Before you plan, check</h4><ol>${questions.map(q=>`<li data-question="${esc(q.id)}"><span>${esc(q.ask)}</span>${q.action?`<button class="link-button" ${q.action.workflow?`data-workflow="${esc(q.action.workflow)}"`:`data-action="${esc(q.action.action)}"`}>${esc(q.action.label)} →</button>`:''}</li>`).join('')}</ol></div>`;
}
function proposalCard(source){
  const est=readScaleEstimate(source.reconstruction);
  const scale=est?`<p class="scale-chip"><b>Scale estimated</b><span>1 unit ≈ ${est.metresPerUnit.toFixed(3)} m</span></p><p class="micro">From a metric-depth model (${esc(est.model)}) on ${est.frames??'several'} frames, not measured: on laser-measured test scenes it read 6–16% high. Measure one distance below to replace it.</p>`
    :`${numericField('Phone height while recording · m','camera-height',cameraHeight,PROPOSAL.minCameraHeight,PROPOSAL.maxCameraHeight,.05)}<p class="micro">This worker gave no scale estimate, so scale comes from this height until you confirm a measured distance.</p>`;
  return `<div class="proposal-card"><h4>Real → sim</h4><p class="micro">Turn this reconstruction into a robot planning map: floor from the lowest dense layer of points, obstacles up to robot height, unseen areas blocked.</p>${scale}<button class="primary wide" data-action="propose-map">Make the robot map →</button><p class="micro">The map must be reviewed before planning.</p>${calibrationCard(source.visual)}</div>`;
}
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
  onRecompile:async(cloud,source,entry,previousSceneJob)=>{if(!client||isRemoteActive())throw Error('Wait for the current worker job or reconnect your worker.');const previous=workspaceResults.get(sceneContext?.jobKey);if(!previous||previous.sourceClient!==client||previous.job.id!==previousSceneJob)throw Error('This scene belongs to an earlier worker session. Open its source and compile it in the connected session before rebuilding.');delete cloud.nameObjects;const file=new File([JSON.stringify(cloud)],'brainsnn-point-cloud.json',{type:'application/json'});$('scene-dialog').close();event('bim_recompile_requested',{source:source.name,openings:cloud.bimReview?.openings.length??0,points:cloud.points.length,sourceJob:previousSceneJob});await runJob(entry.id,[{file,kind:'cloud',name:file.name}],{source_job:previousSceneJob},[source]);}});
function metricSceneCard(source){if(!multiView(source))return '';const entry=sceneEngine();
  if(entry&&(!entry.dimension_checks||!entry.bim_review))return '<p class="note">Update this worker with dimensional checks and BIM review, then reconnect before compiling your demo. See the <a href="./api.html" target="_blank" rel="noopener">worker guide ↗</a>.</p>';
  // Naming reads this worker's own reconstruction job (its frames and camera poses), so it is offered only for those.
  const naming=entry?.object_naming&&sourceJobOptions(sourceBindings.get(source),client).source_job?`<label class="check"><input id="scene-naming" type="checkbox">Also send crops of each separated object from your walkthrough frames to ${esc(entry.object_naming.provider||'the naming model')} (${esc(entry.object_naming.model||'')}) to suggest its name. Names are suggestions for you to review.</label>`:'';
  return entry?`<label class="check"><input id="scene-consent" type="checkbox">Upload this measured point cloud to your worker to compile a simulation scene.</label>${naming}<button class="wide" data-action="metric-scene" ${isRemoteActive()?'disabled':''}>Build metric simulation scene (GLB, USD, IFC) →</button><p class="micro">${esc(entry.label)}. The scene uses your measured distance, so it is in metres but self-reported, not verified.</p>`
    :`<p class="micro">Connect a worker with a simulation scene engine to compile this measured cloud into a metric scene (GLB, USD, IFC).</p>`;}
function calibrationCard(visual){const c=calibrationFor(visual),done=c.picks.length===2&&!c.picking;
  return `<div class="calibration"><p class="micro"><b>Measured scale (recommended).</b> Measure a distance in the room, such as a doorway's width, then tap both ends in the 3D view.</p><button class="wide" data-action="pick-scale" aria-pressed="${c.picking}">${c.picking?`Cancel picking · ${c.picks.length} of 2 points`:done?'Pick the two points again':'Pick two measured points'}</button>${c.picking?`<p class="micro" role="status">Tap point ${c.picks.length+1} of 2 in the 3D view. Drag still orbits; zoom in for precision.</p>`:''}${done?`<p class="micro" id="picked-span">Picked span: ${pickedSpan(visual,c.picks).toPrecision(5)} reconstruction units.</p>${numericField('Measured distance · m','measured-distance',c.distance,PROPOSAL.minMeasuredDistance,PROPOSAL.maxMeasuredDistance,.01)}${activeSource?.reconstruction?'<button class="primary wide" data-action="propose-measured">Propose map at measured scale →</button>':'<p class="micro">Without camera poses there is no map proposal here; the measured scale is applied when you open this cloud in Arena sim.</p>'}${metricSceneCard(activeSource)}<div id="dimension-review-slot">${bimWorkflow.captureHTML(activeSource,measuredScale(visual),c,sceneEngine())}</div>`:''}</div>`;}
function recoveryCard(evidence) {
  const result=reconstructionRecovery(evidence),audit=reconstructionFrameAudit(evidence);
  if (!result) return '';
  const displayed=audit?.rows.length>260?Array.from({length:260},(_,i)=>audit.rows[Math.min(audit.rows.length-1,Math.floor(i*audit.rows.length/260))]):audit?.rows;
  const track=audit?`<div class="pose-audit"><div class="pose-audit-heading"><strong>${audit.registered_frames}/${audit.total_frames} cameras registered</strong><span>${audit.models_found??'—'} camera models</span></div>
    <div class="pose-strip" role="img" aria-label="Cyan registered frames; red unregistered frames in sampled-video order">${displayed.map(frame=>`<span class="${frame.registered?'pose-ok':'pose-missing'}" title="Sample ${frame.sample_index}: ${frame.registered?'registered':'not registered'}"></span>`).join('')}</div>
    <p class="micro">Largest missing spans (sample indices): ${audit.missing_spans.slice(0,3).map(run=>`${run.start}–${run.end} (${run.length})`).join(' · ')||'none'}. Camera registration is not verified room coverage.</p>
    <button class="wide" data-action="reconstruction-audit">Export pose timeline + frame ledger (CSV / JSON)</button>
    <p class="micro">Unavailable per-frame blur, match counts, source timestamps and rejection causes remain blank in the export. Metric scale is not inferred.</p></div>`:'';
  return `<section class="capture-recovery" aria-label="Reconstruction completeness review">
    <h4>${esc(result.label)}</h4>
    <p>${esc(result.summary)}</p>
    ${track}
    <ol>${result.actions.map(action=>`<li>${esc(action)}</li>`).join('')}</ol>
    <p class="micro">${esc(result.note)}</p>
    <button class="wide" data-action="files">Add another photo or walkthrough</button>
    <p class="micro">Photo-only previews can still be useful for exploring what was seen, but have no measured scale.</p>
  </section>`;
}
function numericField(title,id,value,min,max,step=.1,disabled=false){return `<label>${title}<input ${disabled?'disabled':''} id="${id}" type="number" value="${value??''}" min="${min}" max="${max}" step="${step}"></label>`;}
function setTab(next,focus=false){if(tab!==next){viewRevision++;sceneWorkspace.close();}tab=next;$('workspace').dataset.activeTab=next;document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});$('panel').setAttribute('aria-labelledby','tab-'+tab);renderPanel();renderMedia();update();sandbox?.observeMapTab(next);if(focus)$('tab-'+tab).focus();}
function renderCapturePath(source){
  let strip=$('capture-path');if(!strip){strip=document.createElement('div');strip.id='capture-path';strip.className='capture-path';$('visual-canvas').insertAdjacentElement('afterend',strip);}
  const path=source?.reconstruction?capturePath(source.reconstruction):[];strip.hidden=!path.length;if(!path.length){stopPathPlay();return;}
  const n=path.length,len=pathLength(path);
  strip.innerHTML=`<span class="micro">View from the capture path · ${n} camera${n===1?'':'s'} · ${len.toFixed(1)} along the walk (units as the scale says)</span><div class="field-row"><button data-action="path-step" data-value="-1" title="Previous camera">‹</button><input id="path-scrub" type="range" min="0" max="${n-1}" step="0.05" value="${$('path-scrub')?.value??0}" aria-label="Camera along the capture path"><button data-action="path-step" data-value="1" title="Next camera">›</button><button data-action="path-play">${pathPlay?'Stop':'Fly along'}</button><button data-action="path-exit" title="Back to the orbit view">Orbit</button></div><p class="micro">The view the phone had, inside the room. Appearance only: the reviewed map stays the collision surface.</p>`;
}
function pathView(source,t){const path=source?.reconstruction?capturePath(source.reconstruction):[];const v=viewAt(path,t);if(!v)return false;const ok=getVisualViewer().lookFrom(v.eye,v.forward);if(ok){$('scene-help').textContent=`Camera ${v.index+1} of ${path.length}${v.fraction>0.01?' (between cameras)':''} · drag to look around from here`;}return ok;}
function stopPathPlay(){if(pathPlay){cancelAnimationFrame(pathPlay.raf);pathPlay=null;}}
function visualHelp(){return calibration.picking||bimWorkflow.picking?'Tap both measured endpoints. Selected points turn cyan. Drag to orbit.':'Drag to orbit · Pinch or scroll to zoom · Missing surfaces remain unknown';}
function revealMeasurement(id){
  const field=$(id);
  // Finish pointer dispatch before transferring focus from the canvas. This handoff should not
  // compete with the document's smooth scroll or leave the next required field offscreen.
  requestAnimationFrame(()=>{if(!field?.isConnected||$(id)!==field)return;field.focus({preventScroll:true});field.scrollIntoView({block:'center',behavior:'instant'});});
}
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
  // Route replay and metrics describe the map, so they stay out of the way while a photo is on the stage.
  for(const el of document.querySelectorAll('.transport,.metrics'))el.hidden=capture&&source?.kind==='image';
  if(visual){
    try{if(visibleVisual!==source.visual){getVisualViewer().setPoints(source.visual.points,{photo:source.visual.photo,kind:source.visual.kind,orbit:source.visual.origin==='worker'});visibleVisual=source.visual;if(source.visual.origin==='depth')visualViewer.sway();}}
    catch(e){$('visual-canvas').hidden=true;box.hidden=false;const p=document.createElement('p');p.textContent=e.message;box.append(p);status(e.message,true);}
    $('scene-basis').textContent=source.visual.origin==='depth'?'GENERATIVE VISUAL PREVIEW / RELATIVE DEPTH / NOT METRIC':source.visual.kind==='gaussian-splat'?'IMPORTED GAUSSIAN SPLATS / SCALE UNVERIFIED':'POINT CLOUD / SCALE UNVERIFIED';
    $('scene-help').textContent=visualHelp();
    renderCapturePath(source);
    return;
  }
  if(!capture){
    $('scene-basis').textContent=world?.provenance==='authored'?'AUTHORED SAMPLE / NOT A RECONSTRUCTION':world?.provenance==='generated'?'GENERATED / UNVERIFIED':world?.scaleReviewed&&world?.mapReviewed?'USER-REVIEWED GEOMETRY / PLANNING ONLY':'GEOMETRY REVIEW REQUIRED / NOT VERIFIED';
    $('scene-help').textContent='Turn and zoom with the buttons, or drag · Tap a box to choose it';
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
  demoVideoDispose?.();demoVideoDispose=null;
  if(!$('visual-canvas').hidden)$('scene-help').textContent=visualHelp();
  const p=$('panel');
  if(tab==='capture'){
    // A photo has one job here, a 3D preview: its steps come first, and the other ways in fold away while it is open.
    const photo=activeSource?.kind==='image',ways=`<button class="upload-drop wide" data-action="video"><span>↑</span>Choose walkthrough video</button><button class="wide" data-action="files">Choose photos, video or map</button><details class="native-capture-options"><summary>More: calibrated capture files</summary><p class="micro">Choose its capture JSON and 3–11 unchanged JPEG/PNG photos together. JSON up to 1 MiB; each photo up to 64 MiB. Keep the original filenames. Ordinary phone photos and browser recordings do not contain this calibration.</p><button class="wide" data-action="native-capture">Import calibrated capture</button></details><button class="wide" data-action="phone">Use iPhone camera ↗</button><button class="wide" data-action="record">${capture.state==='requesting'?'Cancel camera request':capture.state==='stopping'?'Finishing recording…':capture.state==='recording'?'Stop recording':'Record walkthrough'}</button><p class="micro">Up to 12 files · photos 200 MiB · videos 5 min, 2 GiB<br>On iPhone, Photo Library converts a video before this page gets it, which can take minutes for a long 4K video. Faster: in Photos, Share → Save to Files, then pick it here with Choose File.<br>Browser recording: 90 seconds, no audio.</p>${installable()?'<button class="wide" data-action="install">Add to Home Screen</button>':''}`;
    p.innerHTML=`${photo?`<h3>Your photo is ready.</h3><p>${activeSource.visual?'Drag the preview to look around. You can also find and review objects in the photo.':`Make a 3D preview you can look around. Your photo stays on this device. The first use downloads a 50 MB model.${siteProcessing||caps?.engines?.some(e=>e.available&&e.id==='photo-metric')?' For a preview in estimated metres, open “Process capture” below and approve an upload.':''}`}</p>`:`<h3>Add a photo or video.</h3><p>Use a photo for a 3D preview, or a slow walkthrough video to build a space. Files stay on your device until you approve an upload.</p>${ways}`}<div>${sources.map((s,i)=>`<div class="source-row"><button data-source="${i}">${esc(s.name)}${s.kind==='video'&&s.width&&s.height?` · ${s.width}×${s.height}`:''}${s.kind==='capture'?` · calibration for ${s.capture.frames.length} photos`:''}</button><button data-remove="${i}" aria-label="Remove ${esc(s.name)}">×</button></div>`).join('')}</div>${recoveryCard(activeSource?.reconstruction)}${captureReportCard(activeSource?.captureReport)}${activeSource?.kind==='image'?`<button class="${activeSource.visual?'':'primary '}wide" data-action="depth" ${depthAbort?'disabled':''}>${activeSource.visual?'Rebuild':'Create'} 3D preview</button><p class="micro">Runs on this device. Relative depth only; hidden surfaces are unknown.</p><button class="${activeSource.visual&&!detectAbort?'primary ':''}wide" data-action="${detectAbort?'cancel-detect':'detect'}">${detectAbort?'Cancel object detection':activeSource.visual?'Find objects in this photo':'Find objects in this photo'}</button><p class="micro" id="detect-status" role="status">Suggests names from 80 common object categories. You review them; the map is not changed.</p>`:''}${activeSource?.visual?'<button class="wide" data-action="visual-export">Download visible points (PLY) ↗</button><button class="wide" data-action="arena-cloud">Download point cloud (JSON) ↗</button>':''}${activeSource?.visual&&activeSource.reconstruction?`${proposalCard(activeSource)}`:activeSource?.visual&&activeSource.visual.origin!=='depth'?`<p class="micro">Import the matching reconstruction.json to propose a planning map from these points.</p>${calibrationCard(activeSource.visual)}`:activeSource?.visual?calibrationCard(activeSource.visual):''}${depthAbort?'<button class="wide" data-action="cancel-depth">Cancel 3D preview</button>':''}<p id="depth-status" role="status">${esc(depthStatus)}</p><details class="processing-options"><summary>Process capture · more 3D options</summary><p><a href="./api.html" target="_blank" rel="noopener">Developer guide: processing API ↗</a></p><p>A processing service can combine overlapping views into a 3D space. Check its scale and obstacles before planning a route.</p><button class="wide${!client&&siteProcessing?.available?' primary':''}" data-action="connection">${client?'Worker connection':siteProcessing?.available?'Process on BrainSNN':'Connect processing worker'}</button>${caps?`<label>Choose what to create<select id="engine"><option value="">Choose an available option</option>${caps.engines.filter(e=>e.available&&!['locate-photo','demo-replay','omniverse-pack','asbuilt-update','asbuilt-evidence','splat-repair','localization-map','motion-retarget'].includes(e.id)).map(e=>`<option value="${esc(e.id)}"${e.id===preferredEngine()?' selected':''}>${esc(e.label||e.id)}</option>`).join('')}</select></label><p class="micro">Building a space needs overlapping views. Object suggestions can use one photo or video. ${sources.some(s=>s.kind==='capture')?'The capture JSON and its matching original photos are sent together. Their hashes are checked locally first; the worker validates calibration and poses.':'All photo/video files in this session are sent.'}</p><label class="check"><input id="consent" type="checkbox"><span>I approve sending the selected source files to ${esc(new URL(client.base).host)} for this job.</span></label><button class="primary wide" data-action="process" ${isRemoteActive()?'disabled':''}>Process these files</button>`:''}${isMainRemoteActive()?'<button class="wide" data-action="cancel-job">Cancel upload / job</button>':''}<p id="job-status">${esc(jobStatus)}</p></details>${photo?`<details class="more-sources"><summary>Add a walkthrough video or more photos</summary>${ways}</details>`:''}<p class="note">Walk slowly around the floor, return to your start, and revisit narrow or occluded passages. Keep bystanders out of frame.</p>`;
  }else if(tab==='world'){
    p.innerHTML=`<h3>Change your space.</h3><p>Name the map, set its size, then add or select objects. Sizes and positions are in metres.</p>${world?`<label>Map name<input id="map-name" value="${esc(world.name)}" maxlength="160"></label><div class="field-row">${numericField('Width · m','floor-width',world.width,1,80,.1,!!world.floor)}${numericField('Depth · m','floor-depth',world.depth,1,80,.1,!!world.floor)}</div>${world.geometrySource?`<p class="note">Imported ${esc(world.geometrySource.kind)} geometry. The original floor polygon is preserved.</p>${world.geometrySource.warnings.map(w=>`<p class="micro">${esc(w)}</p>`).join('')}`:''}<div class="field-row">${numericField('Robot start X · m','start-x',world.start.x,0,world.width)}${numericField('Robot start Z · m','start-z',world.start.z,0,world.depth)}</div>${checkFirst(world)}<label class="check"><input id="scale-reviewed" type="checkbox" ${world.scaleReviewed?'checked':''} ${world.provenance==='generated'?'disabled':''}><span>I checked scale and critical clearances against independent measurements.</span></label><label class="check"><input id="map-reviewed" type="checkbox" ${world.mapReviewed?'checked':''} ${world.provenance==='generated'?'disabled':''}><span>I reviewed obstacles, unknown areas and the start position.</span></label><button class="wide" data-action="add-object">Add an obstacle or unknown area</button><button class="wide" data-action="save-map">Save map in this browser</button><button class="wide" data-action="map-export">Download map (JSON) ↗</button>`:'<p>Import RoomPlan or a BrainSNN floor map, or create a measured map. Visual depth alone does not establish collision geometry.</p>'}<button class="wide" data-action="new-map">Start a blank measured map</button><button class="wide" data-action="restore">Open saved map</button><p class="note">Sample dimensions are authored, not captured. Imported and changed maps must be reviewed again.</p><div id="geometry-evidence"></div>`;measurements.render($('geometry-evidence'));
  }else if(tab==='understand'){
    const unknowns=world?.objects.filter(o=>o.kind==='unknown')||[];
    p.innerHTML=`<h3>Check what we know.</h3><p>There are ${unknowns.length} areas we have not confirmed. The robot avoids these areas in the preview.</p>${unknowns.map(o=>`<div class="event"><b>${esc(o.name)}</b>${esc(o.note||'Capture this area from another angle.')}</div>`).join('')}<label>What is this note about?<select id="note-source"><option value="">Reviewed map</option>${sources.map((s,i)=>`<option value="${i}">${esc(s.name)}</option>`).join('')}</select></label>${numericField('Time in the video · seconds','note-time',0,0,86400,1)}<label>What did you notice?<textarea id="note-text" rows="3" maxlength="400" placeholder="For example: the passage was blocked at 00:18."></textarea></label><button class="wide" data-action="add-note">Save your note</button><p class="note">These are your own notes. AI suggestions keep their source images and review records separately.</p><div id="observation-reviews"></div>`;observations.render($('observation-reviews'));
  }else if(tab==='test'){
    p.innerHTML=whatIfCard(whatIf,planningGate(world))+`<h3>Try a robot.</h3><p>Choose a robot for the planning preview. These example sizes can be changed to match your robot.</p><label>Robot shape<select id="robot">${Object.entries(ROBOTS).map(([id,r])=>`<option value="${id}" ${id===robotId?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><div class="field-row">${numericField('Width · m','robot-width',robot.width,.1,5)}${numericField('Depth · m','robot-depth',robot.depth,.1,5)}${numericField('Speed · m/s','robot-speed',robot.speed,.01,3,.01)}${numericField('Extra clearance · m','robot-margin',robot.margin,0,2,.01)}</div><details class="goal-spot"><summary>Route to a spot</summary><div class="field-row">${numericField('Goal x · m','goal-x',goalSpot?.x??'',0,world?.width??80,.1)}${numericField('Goal z · m','goal-z',goalSpot?.z??'',0,world?.depth??80,.1)}</div><button class="wide" data-action="route-spot" ${world?'':'disabled'}>Route to the spot</button><button class="wide" data-action="record-map-route" ${world?'':'disabled'}>Record a delivery cart going here</button><p class="micro">Shortest route on the reviewed grid, this robot's footprint and margin. Edit the map afterwards and route again to compare.</p></details><details class="fleet-edit"><summary>Add more robots to this map${world?.fleet?.length?` · ${world.fleet.length}`:''}</summary>${(world?.fleet||[]).map(f=>`<div class="field-row fleet-row"><span>${esc(f.name)} · ${esc(ROBOTS[f.robot]?.name||f.robot)} at (${f.start.x}, ${f.start.z})</span><button data-action="fleet-remove" data-value="${esc(f.id)}">Remove</button></div>`).join('')}<label>Robot<select id="fleet-robot">${Object.entries(ROBOTS).map(([id,r])=>`<option value="${id}">${esc(r.name)}</option>`).join('')}</select></label><div class="field-row">${numericField('Start x · m','fleet-x','',0,world?.width??80,.1)}${numericField('Start z · m','fleet-z','',0,world?.depth??80,.1)}</div><button class="wide" data-action="fleet-add" ${world?'':'disabled'}>Add robot at this start</button><p class="micro">Adding or removing a robot sends the map back to review. Route to a spot to check fleet separation. Each robot occupies its start until it departs.</p></details>${receiptCard(receipt)}<h4>Optional time and cost estimates</h4><p class="micro">Use your own times and hourly rates. Leave rates blank if you do not need a cost estimate.</p><div class="field-row">${numericField('Setup time · min','setupMinutes',assumptions.setupMinutes,0,240,1)}${numericField('Time per turn · sec','turnSeconds',assumptions.turnSeconds,0,120,.1)}${numericField('Help needed · min','assistanceMinutes',assumptions.assistanceMinutes,0,240,1)}${numericField('Robot · C$/h','robotRate',assumptions.robotRate,0,10000,1)}${numericField('Labour · C$/h','labourRate',assumptions.labourRate,0,10000,1)}</div>${result?`<p>${estimate(result,assumptions).minutes.toFixed(1)} min including your allowances.<br>Unreachable free grid: ${result.unreachableArea.toFixed(1)} m².</p>`:''}${baseline?`<p class="note">Baseline saved${result?`: route ${(result.distance-baseline.result.distance).toFixed(1)} m; time ${(estimate(result,assumptions).minutes-estimate(baseline.result,baseline.assumptions).minutes).toFixed(1)} min versus baseline.`:'. Run this scenario to compare.'}</p>`:''}<p class="note">This preview checks routes on a flat map. It does not run a real robot, test balance or optimize cleaning. Check the settings for your robot.</p>${mapProposal?locatorCard():''}`;
  }else{
    p.innerHTML=`<h3>Save and share.</h3><p>Make a short video, or download the map, assumptions and route. File checks detect changes; they do not verify accuracy.</p><button class="wide${result?' primary':''}" data-action="share-video" ${world?'':'disabled'}>${videoAbort?'Cancel the share video':'Make a share video ↗'}</button><p class="micro" id="share-video-status">${videoAbort?'Recording… keep this tab open.':`About 25 s, made on this device: the map, its largest obstacles with their sizes${result?', and this robot run':''}, with the scale labelled as it is.`}</p><button class="wide" data-action="proof">Download evidence pack ↗</button><button class="wide" data-action="arena-export">Download Robot Arena map ↗</button><button class="wide" data-action="usd-export">Download 3D scene (OpenUSD) ↗</button><button class="wide" data-action="scenario-export" ${baseline?'':'disabled'}>Download scenario comparison ↗</button>${job?.status==='complete'?`<h4>Your processed files</h4><p class="micro">Created with ${esc(job.engine)}. Choose a file to download or explore.</p>${(job.artifacts||[]).map((a,i)=>`<button class="wide" data-artifact="${i}">Download ${esc(a.name)} ↗</button>${a.name==='observations.json'&&a.kind==='observations'?`<button class="wide" data-review-artifact="${i}">Review model observations</button>`:''}${job.engine==='locate-photo'&&a.name==='localization.json'&&located?.url?`<button class="wide" data-locate-artifact="${i}">Place this photo on the map</button>`:''}${/\.(ply|splat)$/i.test(a.name)?`<button class="wide" data-preview-artifact="${i}">Explore ${esc(a.name)} in 3D</button>`:''}${/\.glb$/i.test(a.name)?`<button class="wide" data-scene-artifact="${i}">Explore ${esc(a.name)} in 3D</button>`:''}`).join('')}`:''}<div>${events.slice(-5).reverse().map(e=>`<div class="event"><b>${esc(e.type.replaceAll('_',' '))}</b>${esc(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail))}</div>`).join('')}</div><button class="wide" data-action="clear">Clear this local session</button>`;
  }
  if(tab==='evidence'&&job?.status==='complete'&&client&&job.artifacts?.some(a=>['reconstruction.json','scene.json'].includes(a.name))){
    const sourceJob=job,sourceClient=client;
    demoVideoDispose=mountDemoReplay({host:p,context:{job:sourceJob.id,artifacts:sourceJob.artifacts,sourceClient},isCurrent:()=>job===sourceJob&&client===sourceClient&&tab==='evidence',status,event});
  }
  unifiedWorkspace?.refresh();layerTools?.refresh();
}
function renderInspector(){const options=$('objects');options.replaceChildren();for(const o of world?.objects||[]){const op=document.createElement('option');op.value=o.id;op.textContent=o.name;options.append(op);}if(!world?.objects.some(o=>o.id===selected))selected=world?.objects[0]?.id||'';options.value=selected;{const chips=$('object-chips'),list=world?.objects||[];if(chips){chips.innerHTML=list.slice(0,40).map(o=>`<button type="button" class="object-chip" data-object-chip="${esc(o.id)}" aria-pressed="${o.id===selected}">${esc(o.name)}</button>`).join('')+(list.length>40?`<p class="micro">${list.length-40} more in the list below.</p>`:'');}const chooser=$('object-chooser');if(chooser)chooser.hidden=!list.length;}const o=world?.objects.find(o=>o.id===selected);$('object-fields').innerHTML=o?`<label>Object name<input id="object-name" maxlength="160" value="${esc(o.name)}"></label><div class="field-row">${numericField('X · m','object-x',o.x,0,world.width-o.w)}${numericField('Z · m','object-z',o.z,0,world.depth-o.d)}${numericField('Width · m','object-w',o.w,.05,world.width-o.x)}${numericField('Depth · m','object-d',o.d,.05,world.depth-o.z)}</div><label>Object type<select id="object-kind">${['obstacle','unknown','no-go'].map(k=>`<option ${o.kind===k?'selected':''}>${k}</option>`).join('')}</select></label><button class="small" data-action="remove-object">Remove object</button>`:'<p class="micro">Import or create geometry to edit objects.</p>';renderer?.setSelected(selected);}
function update(){
  updateWorkflow();robotSetup?.refresh();cameraDock?.sync();updateUndo();
  const capture=activeSource&&(tab==='capture'||!world);$('world-title').textContent=capture?activeSource.name:world?.name||'Your capture';$('provenance').textContent=capture&&activeSource.visual?'VISUAL / SCALE UNVERIFIED':!world?'LOCAL SOURCE':world.provenance==='authored'?'AUTHORED SAMPLE':world.provenance==='generated'?'GENERATED / UNVERIFIED':world.mapReviewed&&world.scaleReviewed?'USER-REVIEWED MAP':'REVIEW REQUIRED';
  const gate=planningGate(world);$('run').textContent=planning?'Stop planning':'Try this robot route →';$('run').title=gate||'Calculate a simulated route on this map';$('run').disabled=!world||!!capture;
  $('replay').disabled=!result;$('scrub').disabled=!result;
  for(const id of ['area','distance','time','cost'])$('metric-'+id).textContent='—';
  if(result){const est=estimate(result,assumptions);$('metric-area').textContent=result.reachableArea.toFixed(1)+' m²';$('metric-distance').textContent=result.distance.toFixed(1)+' m';$('metric-time').textContent=(result.travelSeconds/60).toFixed(1)+' min';$('metric-cost').textContent=est.cost===null?'Enter rates':'C$'+est.cost.toFixed(2);}
  sandbox?.sync();
  unifiedWorkspace?.refresh();layerTools?.refresh();
}
function updateWorkflow(){
  const hasCapture=sources.some(s=>s.file),hasGeometry=!!activeSource?.visual,scaled=!!(hasGeometry&&measuredScale(activeSource.visual)),hasScene=bimWorkflow.hasScene;
  const states=[hasCapture?'Source ready':'Choose video',scaled?'Entered scale':hasGeometry?'Set a distance':'Await geometry',hasScene?'Scene available':scaled?'Add checks':'Await scale',hasScene?'Artifacts available':'Await compilation'];
  ['capture','scale','review','export'].forEach((step,i)=>{const node=$('workflow-'+step);if(!node)return;node.querySelector('small').textContent=states[i];node.classList.toggle('complete',[hasCapture,scaled,hasScene,hasScene][i]);});
  // These steps take a walkthrough to a building model. They show while one is under way, or on the Capture tab as the way ahead;
  // a single photo cannot take them, and the sample map does not need them.
  const walkthrough=sources.some(s=>s.kind==='video')||!!job||hasScene;
  $('capture-progress').classList.toggle('off-path',!walkthrough&&(tab!=='capture'||activeSource?.kind==='image'));
}
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
      const metadata=kind==='video'?await readVideoMetadata(file):null,seconds=metadata?.seconds??null;if(seconds!==null&&seconds>LIMITS.videoSeconds+1)throw new Error(`This video is ${(seconds/60).toFixed(1)} minutes long. Walkthroughs can be up to five minutes; trim it, then add it again.`);
      if(/\.(spz|ksplat)$/i.test(file.name))throw new Error('Convert SPZ or KSPLAT to PLY / SPLAT before opening it in this viewer.');
      const source={file,name:file.name,size:file.size,kind,url:null,seconds,width:metadata?.width??null,height:metadata?.height??null,...(nativeMetadata?{capture:nativeMetadata}:{})};let nextDisplay='source';if(kind==='visual'&&/\.(ply|splat)$/i.test(file.name)){if(file.size>64*1024**2)throw new Error('Preview limit is 64 MiB. Open larger files in a desktop viewer.');const parsed=parseVisualAsset(await file.arrayBuffer(),file.name);source.visual={...parsed,origin:'import',photo:false};nextDisplay='visual';}if(world?.provenance==='authored'&&untouchedSample(world)){world=null;renderer?.setWorld(null);}display=nextDisplay;source.url=URL.createObjectURL(file);sources.push(source);bimWorkflow.reset();resetProjectReview();activeSource=source;invalidate();event('source_added',`${file.name} (${kind}), local only`);setTab('capture');renderInspector();update();status(videoResolutionIssue(source)??(kind==='capture'?`Capture metadata ready for ${nativeMetadata.frames.length} photos. Add the unchanged originals, connect a compatible worker and approve processing.`:kind==='image'?'Photo ready. Create a 3D preview on this device.':kind==='visual'?'Visual asset loaded. Scale and collision geometry remain unverified.':'Walkthrough ready. Connect a reconstruction worker to process overlapping views.'));
    }catch(e){status(e.message,true);}
  }
  $('files').value='';$('video-file').value='';$('phone-camera').value='';$('native-capture-files').value='';
}
async function run(){if(planning){invalidate();status('Planning cancelled.');return;}const gate=planningGate(world);if(gate){status(gate,true);setTab('world');return;}
  invalidate();planning=true;update();const id=epoch;try{planner=new Worker('./planner-worker.mjs',{type:'module'});}catch(e){planning=false;update();status('A browser planning worker could not start. Check your browser settings.',true);return;}
  const timeout=setTimeout(()=>{if(id===epoch){invalidate();status('Planning timed out. Try a smaller map.',true);}},15000);
  planner.onmessage=({data})=>{clearTimeout(timeout);if(data.id!==epoch)return;planner?.terminate();planner=null;planning=false;if(data.error){runIssue={message:data.error,advice:data.advice||null};status(data.error,true);update();return;}result=data.result;renderer?.setResult(result);renderer?.setCursor(.015);event('plan_completed',{algorithm:result.algorithm,metres:result.distance,policyExecuted:false});setTab('test');update();status('Planning preview complete. No learned policy or physical robot executed.');};
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
function adoptWorker(next,nextCaps,summary){artifactAbort?.abort();sceneAbort?.abort();sceneWorkspace.close();sceneContext=null;bimWorkflow.clearScene();client=next;caps=nextCaps;job=null;jobExecution=null;jobStatus='';$('worker-summary').textContent=summary;$('worker-note').textContent='No inference verified until a job succeeds.';event('worker_connected',new URL(client.base).origin);renderPanel();}
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
    const next=new WorkerClient(location.origin+'/api/world/worker',data.token);next.site=true;next.siteRole=data.kind;
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
  const entry=caps.engines.find(e=>e.id===engine&&e.available);let items=sources.filter(s=>['image','video','capture'].includes(s.kind));const inputSources=[...items];
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
  const resolutionIssue=items.map(source=>videoResolutionIssue(source,engine)).find(Boolean);
  if(resolutionIssue){jobStatus=resolutionIssue;status(jobStatus,true);renderPanel();return;}
  // Older workers advertise no large-video support.
  if(!Number.isSafeInteger(caps.limits?.video_bytes)&&items.some(s=>s.kind==='video'&&(s.size>200*1024**2||s.seconds>121))){status('This worker runs an older version that takes videos up to 2 minutes and 200 MiB. Update the worker to the current release and restart it, or trim the video.',true);return;}
  await runJob(engine,items,{},inputSources);
}
// Uploads approved items ({file,kind,name}) to the connected worker, then starts and follows one job.
function locatorCard(){
  const offered=caps?.engines?.some(e=>e.id==='locate-photo'&&e.available),ready=!!(client&&offered&&mapProposal.job&&mapProposal.sourceClient===client),photo=located?.photo;
  const why=!mapProposal.job?'This map was not proposed from a worker reconstruction, so there is nothing to find a photo in.':!client||mapProposal.sourceClient!==client?'Use the worker session that reconstructed this place to locate photos.':'Your worker does not offer photo localisation (locate-photo).';
  return `<div class="locator"><h4>Send the robot to a photo</h4><p class="micro">Take a photo anywhere in this place. Your worker finds where it was taken in the scan; tap the floor in it to send the robot there. The photo goes only to your connected worker.</p><button class="wide" data-action="locate-photo" ${ready&&!isRemoteActive()?'':'disabled'}>${located?.url?'Locate another photo':'Locate a photo in this scan'}</button>${ready?'':`<p class="micro">${esc(why)}</p>`}${located?.url&&photo?.located?`<div class="located-photo" id="located-photo"><img src="${located.url}" alt="Your photo, placed in the scan. Tap the floor in it to send the robot there."><i class="located-goal" ${located.tap?`style="left:${located.tap.left}%;top:${located.tap.top}%"`:'hidden'}></i></div>`:''}${located?.note?`<p class="micro" id="locate-status" role="status">${esc(located.note)}</p>`:''}</div>`;
}
async function locatePhoto(file){
  if(!client||!mapProposal?.job||mapProposal.sourceClient!==client){status('Use the worker session that reconstructed this place to locate a photo.',true);return;}
  if(isRemoteActive()){status('Wait for the current worker job to finish.',true);return;}
  if(located?.url)URL.revokeObjectURL(located.url);
  located={url:URL.createObjectURL(file),photo:null,note:''};renderer?.setMarks(null);
  event('photo_locate_requested',{sourceJob:mapProposal.job});
  await runJob('locate-photo',[{file,kind:'image',name:file.name}],{source_job:mapProposal.job});
}
async function openLocalization(index){
  const sourceJob=job,request=located;
  try{
    const data=JSON.parse(new TextDecoder().decode(await client.previewArtifact(sourceJob,index)));
    // Choosing another photo, or another map, replaces `located` while this result downloads: the result belongs to the
    // photo that asked for it, so a late one is dropped rather than placing the newer photo with the older one's camera.
    if(!request||located!==request)return;
    const photo=readLocalization(data);
    located={...request,photo,tap:null,goal:null,camera:null};
    if(photo.located&&mapProposal?.transform&&data.source_job===mapProposal.job){
      located.camera=photoOnMap(photo,mapProposal.transform);renderer?.setMarks({camera:located.camera});
      located.note=`Placed in the scan: ${photo.inliers} of ${photo.correspondences} matched points agree, ${photo.reprojection} px apart. Tap a spot on the floor in the photo to send the robot there.`;
    }else located.note=photo.located?'Placed, but in a different reconstruction from the one this map came from.':`Not placed: ${photo.reason}`;
    setTab('test');status(located.note,!located.camera);
    event('photo_located',{job:sourceJob.id,sourceJob:data.source_job,located:photo.located,inliers:data.inliers??0});
  }catch(e){status('The localisation result could not be read: '+e.message,true);}
}
function tapPhoto(e,box){
  const photo=located?.photo;if(!photo?.located||!located.camera||!mapProposal)return;
  const r=box.querySelector('img').getBoundingClientRect(),left=(e.clientX-r.left)/r.width,top=(e.clientY-r.top)/r.height;
  const goal=floorFromTap(photo,mapProposal.transform,left*photo.width,top*photo.height,world);
  if(!goal){status('Tap a spot on the floor: below the horizon and inside the map.',true);return;}
  const gate=planningGate(world);if(gate){status(gate,true);setTab('world');return;}
  let route;try{route=routeWorld(world,robot,goal);}catch(error){renderer?.setMarks({camera:located.camera,goal});status(error.message,true);return;}
  located.goal=goal;located.tap={left:left*100,top:top*100};
  invalidate();result=route;renderer?.setResult(result);renderer?.setMarks({camera:located.camera,goal});renderer?.setCursor(.015);
  located.note=`Route to the spot you tapped: ${route.distance.toFixed(1)} m, about ${Math.max(1,Math.round(route.travelSeconds/60))} min for this robot. A simulation on the reviewed map; no robot was moved.`;
  event('photo_goal_routed',{metres:route.distance,goal,policyExecuted:false});
  setTab('test');status(located.note);replay();
}
async function runJob(engine,items,extra={},inputSources=items.filter(item=>sources.includes(item))){
  if(!client)throw new Error('Connect a worker before processing.');
  const sourceClient=client,parent=extra.source_job?workspaceResults.find({id:extra.source_job},sourceClient):null;
  const ancestors=inputSources.map(source=>sourceBindings.get(source)).filter(Boolean);
  const execution={sourceClient,sourceIds:[...new Set([...inputSources.map(sourceId),...ancestors.flatMap(binding=>binding.sourceIds||[]),...(parent?.sourceIds||[])])],sourceNames:[...new Set([...(parent?.sourceNames||[]),...ancestors.flatMap(binding=>binding.sourceNames||[]),...(inputSources.length?inputSources:items).map(source=>source.name)])],sourceId:sourceId(activeSource),viewRevision};
  jobExecution=execution;sceneWorkspace.close();sceneContext=null;bimWorkflow.clearScene();update();remoteAbort=new AbortController();const signal=remoteAbort.signal;job=null;jobStatus='Uploading approved sources…';status(jobStatus);renderPanel();
  try{
    const uploads=[];
    for(let i=0;i<items.length;i++)uploads.push(await sourceClient.upload(items[i].file,items[i].kind,signal,p=>{if(jobExecution!==execution||signal.aborted)return;jobStatus=`Uploading ${i+1}/${items.length}: ${Math.round(p*100)}%`;if($('job-status'))$('job-status').textContent=jobStatus;unifiedWorkspace?.refresh();}));
    const prepared=await sourceClient.request('/v1/jobs',{method:'POST',body:{engine,upload_ids:uploads,consent:true,...extra},signal});
    if(!/^[a-f0-9]{32}$/.test(prepared.id))throw new Error('Invalid job identifier.');
    if(signal.aborted||jobExecution!==execution){await sourceClient.request(`/v1/jobs/${prepared.id}`,{method:'DELETE'});return;}
    job=prepared;event('job_submitted',{engine,files:items.map(s=>s.name)});
    const started=await sourceClient.request(`/v1/jobs/${job.id}/start`,{method:'POST',body:{},signal});
    if(signal.aborted||jobExecution!==execution)return;
    job=started;await checkJob(signal);
  }catch(e){if(jobExecution!==execution)return;jobStatus=signal.aborted?'Upload cancelled. The same selected file can resume in this session.':e.message;status(jobStatus,true);remoteAbort=null;renderPanel();}
}
async function checkJob(signal){
  if(signal.aborted||!job)return;
  const execution=jobExecution,sourceClient=execution?.sourceClient||client,currentJob=job;
  const next=await sourceClient.request(`/v1/jobs/${currentJob.id}`,{signal});
  if(signal.aborted||jobExecution!==execution||job!==currentJob)return;
  job=next;
  jobStatus=`${job.engine}: ${job.status}${job.error?' · '+job.error:''}`;
  if($('job-status'))$('job-status').textContent=jobStatus;
  if(['complete','failed','cancelled'].includes(job.status)){
    const context=job.status==='complete'?workspaceResults.remember(job,sourceClient,{sourceIds:execution?.sourceIds||[],sourceNames:execution?.sourceNames||[]}):null;
    remoteAbort=null;event('worker_'+job.status,{engine:job.engine,job:job.id});
    $('worker-note').textContent=job.status==='complete'?job.engine==='inspect'?'Capture integrity receipt produced. No AI model executed.':`${job.engine} produced artifacts. Outputs remain unverified until reviewed.`:'No successful model output for this job.';
    renderPanel();status(jobStatus,job.status!=='complete');
    if(job.status==='complete'){
      // A capture may finish while the person is editing a different scene.
      // Keep its artifacts available through the existing checked review path,
      // without replacing the street tools or opening a modal over that scene.
      if(!shouldOpenCompletedResult(execution,{sourceId:sourceId(activeSource),viewRevision,street:!!sandbox?.isStreet()})){
        status('Processing finished. Your results are ready in this workspace; the view you are using is kept.');
        return;
      }
      setTab('evidence');const review=automaticReviewArtifact(job);
      if(review?.type==='visual')void openArtifact(review.index,context);
      else if(review?.type==='observations')void openObservationArtifact(review.index,context);
      else if(review?.type==='scene')void openSceneArtifact(review.index,context);
      else if(review?.type==='localization')void openLocalization(review.index);
    }
    return;
  }
  unifiedWorkspace?.refresh();
  schedulePoll(signal);
}
// A long reconstruction outlives network blips: retry status checks with backoff (cancel stays available), and only
// give up after repeated failures, saying so.
function schedulePoll(signal,failures=0){poll=setTimeout(()=>checkJob(signal).catch(e=>{if(signal.aborted)return;
  if(failures>=7){remoteAbort=null;jobStatus=`${e.message} Status checks stopped after repeated failures; cancel the job or reconnect to the worker.`;renderPanel();status(jobStatus,true);return;}
  jobStatus=`Status check failed (${e.message}). Retrying…`;if($('job-status'))$('job-status').textContent=jobStatus;schedulePoll(signal,failures+1);}),failures?Math.min(30000,1500*2**failures):1500);}
async function cancelRemote(){nativeCheckAbort?.abort();nativeCheckAbort=null;clearTimeout(poll);remoteAbort?.abort();remoteAbort=null;const execution=jobExecution,currentJob=job,sourceClient=execution?.sourceClient||client;if(currentJob&&sourceClient&&!['complete','failed','cancelled'].includes(currentJob.status)){try{const cancelled=await sourceClient.request(`/v1/jobs/${currentJob.id}`,{method:'DELETE'});if(jobExecution!==execution||job!==currentJob)return;job=cancelled;}catch(e){if(jobExecution===execution)status('Local polling stopped; server cancellation was not confirmed: '+e.message,true);return;}}jobStatus='Cancelled. Retained uploads expire under the worker retention policy.';renderPanel();status(jobStatus);}
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
function currentResultContext(){return job?workspaceResults.find(job,jobExecution?.sourceClient||client):null;}
function requireResultContext(key){const context=workspaceResults.get(key);if(!context)throw new Error('This result is no longer kept in this tab. Reopen its original files or process the source again.');return context;}
// A preview is a deliberate view choice, including when it keeps the same tab.
// Retire both old requests before assigning the new controller so an older
// cloud/observation cannot replace a model or steal focus when a job finishes.
function beginWorkspacePreview(kind){
  viewRevision++;artifactAbort?.abort();artifactAbort=null;sceneAbort?.abort();sceneAbort=null;
  if(kind!=='scene'){sceneWorkspace.close();sceneContext=null;bimWorkflow.clearScene();}
  const controller=new AbortController();
  if(kind==='scene')sceneAbort=controller;else artifactAbort=controller;
  return controller;
}
function workspaceSnapshot(){
  const jobs=workspaceResults.list(),sandboxState=sandbox?.getState();
  return {
    workspace:{kind:sandboxState?.workspace||'map',tool:sandboxState?.tool||'edit',name:sandboxState?.workspace==='street'?'Green Gardens / Toronto block':null},
    sources:sources.map(source=>{const id=sourceId(source),binding=sourceBindings.get(source);return {id,name:source.name,kind:source.kind,hasVisual:!!source.visual,hasReconstruction:!!source.reconstruction,sourceIds:[...(binding?.sourceIds||[])],jobKey:binding?.jobKey||jobs.findLast(result=>result.sourceIds.includes(id))?.key||null};}),
    activeSourceId:sourceId(activeSource),view:activeSource&&(tab==='capture'||!world)?activeSource.visual&&display==='visual'?'points':'source':'map',tab,
    world:world?{name:world.name,provenance:world.provenance,scaleReviewed:world.scaleReviewed,mapReviewed:world.mapReviewed,objects:world.objects.map(({id,name,kind})=>({id,name,kind})),fleetCount:world.fleet?.length||0}:null,
    robot:{id:robotId,name:robot.label||robot.name||robotId},result:result?{distance:result.distance,travelSeconds:result.travelSeconds}:null,
    processing:{active:!!isRemoteActive(),status:jobStatus,connected:!!client,available:!!siteProcessing},jobs,
    scene:sceneContext?{...sceneContext,ready:sceneContext.ready&&sceneWorkspace.isOpen()}:null,
  };
}
async function selectWorkspaceSource(id,view='source'){
  const source=sources.find(item=>sourceId(item)===id);if(!source)throw new Error('That source has been removed from this tab.');
  if(activeSource!==source)resetProjectReview();
  viewRevision++;sceneWorkspace.close();artifactAbort?.abort();depthAbort?.abort();bimWorkflow.reset();activeSource=source;display=view==='points'||source.kind==='visual'?'visual':'source';
  if(sandbox)await sandbox.select('capture');else setTab('capture');renderPanel();renderMedia();update();
}
async function showWorkspaceTab(next){
  if(!['capture','world','test','understand','evidence'].includes(next))return;
  sceneWorkspace.close();artifactAbort?.abort();viewRevision++;
  const tools={world:'edit',test:'simulate',understand:'evidence',evidence:'export'};
  if(sandbox)await sandbox.select(['capture','understand','evidence'].includes(next)?'capture':'map',tools[next]);else setTab(next);
  update();
}
async function showProcessingOptions() {
  await showWorkspaceTab('capture');
  const options = document.querySelector('.processing-options');
  if (options) { options.open = true; options.scrollIntoView({block:'center'}); }
  return options;
}
async function downloadResultArtifact(context,index){
  if(!workspaceResults.isCurrent(context)||!Number.isInteger(index)||!context.job.artifacts[index])throw new Error('Choose an available result file.');
  const url=await context.sourceClient.download(context.job.id,index);
  if(!workspaceResults.isCurrent(context))return;
  const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';a.click();status('Download started using a short-lived ticket from this result’s original worker.');
}
async function openResultArtifact(key,index){
  const context=requireResultContext(key),item=context.job.artifacts[index];
  if(!Number.isInteger(index)||!item)throw new Error('Choose an available result file.');
  if(['splat-repair','localization-map','motion-retarget','biomechanics'].includes(context.job.engine)){
    const requested=++viewRevision;artifactAbort?.abort();sceneWorkspace.close();
    await layerTools.openResult(context);if(requested===viewRevision&&workspaceResults.isCurrent(context))$('world-layer-tools').scrollIntoView({block:'start'});return;
  }
  if(item.kind==='visual'&&/\.glb$/i.test(item.name))return openSceneArtifact(index,context);
  if(item.kind==='visual'&&/\.(ply|splat)$/i.test(item.name))return openArtifact(index,context,{autoPropose:false});
  if(item.kind==='observations'&&item.name==='observations.json')return openObservationArtifact(index,context);
  return downloadResultArtifact(context,index);
}
async function openArtifact(index,context=currentResultContext(),{autoPropose=true}={}){
  if(!workspaceResults.isCurrent(context))return;const controller=beginWorkspacePreview('points');
  const {job:sourceJob,sourceClient}=context,item=sourceJob.artifacts[index],openingRevision=viewRevision;
  const valid=()=>!controller.signal.aborted&&workspaceResults.isCurrent(context)&&viewRevision===openingRevision;
  try{
    status('Loading and checking the 3D artifact…');
    const buffer=await sourceClient.previewArtifact(sourceJob,index,controller.signal);
    if(!valid())return;
    const parsed=parseVisualAsset(buffer,item.name);
    const existing=sources.find(s=>s.derivation?.job===sourceJob.id&&s.derivation?.sha256===item.sha256&&sourceBindings.get(s)?.sourceClient===sourceClient);if(existing){bimWorkflow.reset();activeSource=existing;display='visual';if(sandbox)await sandbox.select('capture');else setTab('capture');status('Reconstruction loaded. Scale remains unverified.');return;}
    if(sources.filter(s=>s.derivation?.job).length>=4)throw new Error('Remove an earlier worker artifact before opening another.');
    const source={name:item.name,size:item.size,kind:'visual',url:null,visual:{...parsed,origin:'worker',photo:false},derivation:{job:sourceJob.id,engine:sourceJob.engine,sha256:item.sha256,coordinateFrame:item.coordinate_frame,metricVerified:false}};
    const metricIndex=sourceJob.engine==='photo-metric'?sourceJob.artifacts.findIndex(a=>a.name==='photo-metric.json'):-1;
    if(metricIndex>=0){try{const evidence=JSON.parse(new TextDecoder().decode(await sourceClient.previewArtifact(sourceJob,metricIndex,controller.signal)));if(evidence?.schema==='brainsnn.photo-metric.v1')source.photoMetric=evidence;}catch(e){if(controller.signal.aborted)return;event('photo_metric_evidence_unavailable',e.message);}}
    const evidenceIndex=sourceJob.artifacts.findIndex(a=>a.name==='reconstruction.json');
    const reportIndex=sourceJob.artifacts.findIndex(a=>a.name==='capture-report.json');
    if(reportIndex>=0){try{const report=JSON.parse(new TextDecoder().decode(await sourceClient.previewArtifact(sourceJob,reportIndex,controller.signal)));if(report?.schema==='brainsnn.capture-report.v1')source.captureReport=report;}catch(e){if(controller.signal.aborted)return;event('capture_report_unavailable',e.message);}}
    if(evidenceIndex>=0){try{const evidence=JSON.parse(new TextDecoder().decode(await sourceClient.previewArtifact(sourceJob,evidenceIndex,controller.signal)));if(evidence?.schema==='brainsnn.reconstruction.v1'){source.reconstruction=evidence;source.derivation.evidenceSha256=sourceJob.artifacts[evidenceIndex].sha256;}}catch(e){if(controller.signal.aborted)return;event('reconstruction_evidence_unavailable',e.message);}}
    if(!valid())return;
    sourceBindings.set(source,{job:sourceJob.id,jobKey:context.key,sourceClient,sourceIds:context.sourceIds,sourceNames:context.sourceNames});sourceId(source);
    sources.push(source);bimWorkflow.reset();activeSource=source;display='visual';event('artifact_opened',source.derivation);if(sandbox)await sandbox.select('capture');else setTab('capture');update();
    // The worker checks a video's model against its own consecutive frames; a model that contradicts them is folded.
    const folded=source.reconstruction?.capture?.consistency?.status==='folded';
    const est=readScaleEstimate(source.reconstruction),depth=source.photoMetric?.depth_metres;
    if(sourceJob.engine==='photo-metric'){status(`3D preview of your photo in estimated metres${Number.isFinite(depth?.median)?`: most of it ${depth.p5}–${depth.p95} m from the camera`:''}. A depth model's estimate, not a measurement, and only what the photo shows. Drag to look around; for a robot map, walk the space and reconstruct it.`);return;}
    status(folded?'This reconstruction contradicts its own frames: the room is likely folded onto itself. Do not use its layout or dimensions; recapture the room.':(est?`Reconstruction loaded with an estimated scale (1 unit ≈ ${est.metresPerUnit.toFixed(3)} m, not measured). Next: Make the robot map.`:'Reconstruction loaded. Compare with the source; independently review scale and obstacles before planning.')+(sourceJob.artifacts.some(a=>/\.glb$/i.test(a.name))?' Its simulation scene is under Evidence.':''),folded);
    // Real to sim straight away: with an estimated scale nothing more is needed to propose the robot map, so it is proposed
    // now, unless that would replace a map the person made, edited or imported: only an empty map or the untouched sample
    // (adding a capture clears it) is replaced. It stays unreviewed and blocked until they check it.
    if(autoPropose&&est&&!folded&&(!world||untouchedSample(world))&&activeSource===source)await action('propose-map');
  }catch(e){if(!controller.signal.aborted)status('Artifact preview failed: '+e.message,true);}
  finally{if(artifactAbort===controller)artifactAbort=null;}
}
async function openObservationArtifact(index,context=currentResultContext()){
  if(!workspaceResults.isCurrent(context))return;const controller=beginWorkspacePreview('observations'),openingRevision=viewRevision;
  try{status('Checking the original source, frame receipts and model observations…');await observations.load(context.job,context.sourceClient,index,controller.signal);if(controller.signal.aborted||!workspaceResults.isCurrent(context)||viewRevision!==openingRevision)return;if(sandbox)await sandbox.select('capture','evidence');else setTab('understand');status('Model suggestions are ready for review. No planning geometry was changed.');}
  catch(error){if(!controller.signal.aborted)status('Observation review could not open: '+error.message,true);}
  finally{if(artifactAbort===controller)artifactAbort=null;}
}
// A worker's simulation scene opens in a dialog with the Arena's mesh viewer, loaded only when first needed.
// sceneMap holds the open scene's metric scene.json, the only input to a planning map built from a scene.
let sceneAbort=null,sceneViewer=null,scenePromise=null,sceneMap=null;
const surfaceReview=createSurfaceReview($('scene-stage'));
function sceneStatus(message,error=false){$('scene-status').textContent=message;$('scene-status').classList.toggle('error',error);}
async function openSceneArtifact(index,context=currentResultContext()){
  if(!workspaceResults.isCurrent(context))return;const controller=beginWorkspacePreview('scene');
  if(projectReviewContextKey&&projectReviewContextKey!==context.key)resetProjectReview();
  const {job:sourceJob,sourceClient}=context,item=sourceJob.artifacts[index];
  sceneContext={jobKey:context.key,name:item?.name||'Scene',ready:false};
  // Open at once and drop the previous scene's status and facts, so nothing stale shows while modules and bytes load.
  surfaceReview.clear();$('scene-facts').replaceChildren();bimWorkflow.clearScene();sceneMap=null;$('scene-plan').hidden=true;sceneStatus(`Downloading and checking ${item?.name??'the scene'}…`);sceneViewer?.clear();
  sceneWorkspace.open({title:item?.name});unifiedWorkspace?.refresh();
  try{
    const {SCENE_PREVIEW_BYTES,sceneFacts}=await import('./scene-preview.mjs');
    if(controller.signal.aborted||!workspaceResults.isCurrent(context))return;
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
    surfaceReview.set(sceneViewer,{job:sourceJob.id,engine:sourceJob.engine,name:item.name,bytes:item.size,sha256:item.sha256});
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
    if(controller.signal.aborted||!workspaceResults.isCurrent(context))return;
    sceneContext={jobKey:context.key,name:item.name,ready:true};
    update();status('Simulation scene opened. Review dimensions and openings before using its BIM exports. Routes remain planning previews.');
  }catch(e){if(!controller.signal.aborted){sceneStatus('Scene preview failed: '+e.message,true);status('Scene preview failed: '+e.message,true);}}
  finally{if(sceneAbort===controller)sceneAbort=null;}
}
function renderSystems(){const q=$('system-search').value.toLowerCase().trim();const list=SYSTEMS.filter(s=>(filter==='all'||s.state===filter)&&[s.name,s.description,s.gate].join(' ').toLowerCase().includes(q));$('systems-grid').innerHTML=list.length?list.map(s=>`<article class="system-card" data-state="${s.state}"><div class="system-top"><span>${s.id} / SYSTEM</span><span>${s.state==='local'?'LOCAL TOOL':s.state==='adapter'?'WORKER / LOADER INTERFACE':s.state==='gated'?'GATED CANDIDATE':'PLANNED'}</span></div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><p class="system-gate">${esc(s.gate)}</p>${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Primary source ↗</a>`:''}</article>`).join(''):'<p class="micro">No matching systems.</p>';
  // The full catalog folds to its first rows until asked for; a search or filter always shows every match.
  const browsing=filter==='all'&&!q,more=$('systems-more');$('systems-grid').toggleAttribute('data-collapsed',browsing&&!systemsOpen);more.hidden=!browsing;more.setAttribute('aria-expanded',String(systemsOpen));more.textContent=systemsOpen?'Show fewer systems':`Show all ${list.length} systems`;}
async function action(name,value){try{
  if(name==='files')$('files').click();
  if(name==='locate-photo')$('locate-file').click();
  if(name==='native-capture')$('native-capture-files').click();
  if(name==='video')$('video-file').click();
  if(name==='depth'&&activeSource?.kind==='image')$('depth-consent').showModal();
  if(name==='detect'&&activeSource?.kind==='image')$('detect-consent').showModal();
  if(name==='cancel-detect')detectAbort?.abort();
  if(name==='cancel-depth')depthAbort?.abort();
  if(name==='reconstruction-audit'){
     const evidence=activeSource?.reconstruction,audit=reconstructionFrameAudit(evidence);
     if(!audit)throw Error('Open a reconstruction with a complete camera-frame ledger before exporting diagnostics.');
     await deliver(['brainsnn-frame-audit.csv',reconstructionFrameCSV(evidence),'text/csv'],['brainsnn-frame-audit.json',audit,'application/json']);
     event('reconstruction_frame_audit_exported',{total:audit.total_frames,registered:audit.registered_frames,largestGap:audit.longest_gap});
     status('Camera frame ledger exported. Blank diagnostics were not measured, and the source has no verified scale.');
   }
   if(name==='visual-export'&&activeSource?.visual)deliver(['brainsnn-visible-points.ply',toPLY(activeSource.visual.points),'application/octet-stream'],['brainsnn-preview-provenance.json',{schema:'brainsnn.visual-provenance.v1',source:activeSource.name,...activeSource.derivation,metricVerified:false,collisionGeometry:null}]);
  if(name==='arena-cloud'&&activeSource?.visual){const scale=measuredScale(activeSource.visual);download('brainsnn-point-cloud.json',toArenaCloud(activeSource.visual.points,{source:activeSource.name,coordinateFrame:arenaFrame(activeSource),metresPerUnit:scale?.metresPerUnit,measurement:scale}));status(`Point cloud saved${scale?` at your measured scale (${scale.metresPerUnit.toPrecision(4)} m per unit)`:' in arbitrary units'}. In Robot Arena: Capture → Add 3D visual → choose brainsnn-point-cloud.json. It is a visual reference only; ${scale?'confirm the scale and ':'measure and '}mark obstacles before planning.`);}
  if(name==='install')await installApp();
  if(name==='phone')$('phone-camera').click();
  if(name==='record')await record();
  if(name==='connection')$('connection').showModal();
  if(name==='process')await processSources();
  if(name==='cancel-job')await cancelRemote();
  if(name==='new-map'){if(world&&!confirm('Replace the current map with an empty measured-map draft? Captures stay in this session.'))return;nextOrigin='empty';apply({schema:SCHEMA,name:'My measured space',width:12,depth:9,start:{x:1,z:1},objects:[],provenance:'observed',scaleReviewed:false,mapReviewed:false},'Measured-map draft created. Enter actual dimensions and obstacles.');setTab('world');}
  if(name==='add-object'&&world){const id=crypto.randomUUID();selected=id;mutate(w=>w.objects.push({id,name:'New obstacle',x:Math.max(0,w.width/2-.5),z:Math.max(0,w.depth/2-.5),w:Math.min(1,w.width/2),d:Math.min(1,w.depth/2),h:1,kind:'unknown'}));}
  if(name==='what-if-route'&&world&&whatIf){if(dropStaleWhatIf()){renderPanel();status('The robot changed since that route, so there is no like-for-like comparison. Route to the spot again.',true);return;}const gate=planningGate(world);if(gate){status(gate,true);return;}let route;try{route=routeWorld(world,robot,whatIf.goal);}catch(error){status(error.message,true);return;}
    invalidate();result=route;receipt=routeReceipt(world,robot,whatIf.goal,route);renderer?.setResult(result);renderer?.setGhost(whatIf.previous.route);renderer?.setMarks({goal:whatIf.goal});renderer?.setCursor(.015);whatIf.after=compareWhatIf(whatIf,route);
    event('what_if_rerouted',{metres:route.distance,before:whatIf.previous.distance,edit:whatIf.edit.kind,policyExecuted:false});setTab('test');status(whatIf.after.text);replay();return;}
  if(name==='record-map-route'&&world){
    const x=$('goal-x').valueAsNumber, z=$('goal-z').valueAsNumber;
    if(!Number.isFinite(x)||!Number.isFinite(z)){status('Enter the goal X and Z in metres first.',true);return;}
    const {openReviewedMapRun}=await import('./reviewed-map-run-ui.mjs');
    openReviewedMapRun(world,{x,z},mapProposal,document.querySelector('[data-action="record-map-route"]'));return;
  }
  if(name==='route-spot'&&world){const goal={x:Number($('goal-x').value),z:Number($('goal-z').value)};if(!Number.isFinite(goal.x)||!Number.isFinite(goal.z)){status('Enter the goal as x and z in metres.',true);return;}const gate=planningGate(world);if(gate){status(gate,true);setTab('world');return;}
    let route;try{route=routeWorld(world,robot,goal);}catch(error){renderer?.setMarks({goal});status(error.message,true);return;}goalSpot=goal;invalidate();result=route;receipt=routeReceipt(world,robot,goal,route);renderer?.setResult(result);renderer?.setMarks({goal});renderer?.setCursor(.015);renderPanel();
    status(`Route to the spot: ${route.distance.toFixed(1)} m, about ${Math.max(1,Math.round(route.travelSeconds/60))} min for this robot. A simulation on the reviewed map; no robot was moved.`);event('goal_routed',{metres:route.distance,goal,policyExecuted:false});replay();return;}
  if(name==='path-step'&&activeSource?.reconstruction){stopPathPlay();const s=$('path-scrub');s.value=String(Math.max(0,Math.min(Number(s.max),Math.round(Number(s.value))+Number(value))));pathView(activeSource,Number(s.value));renderCapturePath(activeSource);return;}
  if(name==='path-play'&&activeSource?.reconstruction){if(pathPlay){stopPathPlay();renderCapturePath(activeSource);return;}const s=$('path-scrub'),max=Number(s.max),source=activeSource;let t=Number(s.value)>=max-.01?0:Number(s.value),last=performance.now();
    const tick=now=>{if(activeSource!==source||$('visual-canvas').hidden){stopPathPlay();return;}t+=(now-last)/1000*0.8;last=now;if(t>=max){t=max;pathView(source,t);stopPathPlay();renderCapturePath(source);return;}pathView(source,t);const scrub=$('path-scrub');if(scrub)scrub.value=String(t);pathPlay.raf=requestAnimationFrame(tick);};
    pathPlay={raf:requestAnimationFrame(tick)};event('capture_path_flyalong',{cameras:max+1});renderCapturePath(activeSource);return;}
  if(name==='path-exit'){stopPathPlay();getVisualViewer().reset();$('scene-help').textContent=visualHelp();renderCapturePath(activeSource);return;}
  if(name==='what-if-clear'){whatIf=null;renderer?.setGhost(null);renderPanel();return;}
  if(name==='remove-object'&&world)mutate(w=>{w.objects=w.objects.filter(o=>o.id!==selected);},'removed');
  if(name==='fleet-add'&&world){const robotKey=$('fleet-robot').value,x=Number($('fleet-x').value),z=Number($('fleet-z').value);if(!ROBOTS[robotKey]||!Number.isFinite(x)||!Number.isFinite(z)){status('Choose a robot and its start as x and z in metres.',true);return;}const n=(world.fleet||[]).length+1;mutate(w=>{w.fleet=[...(w.fleet||[]),{id:crypto.randomUUID(),robot:robotKey,name:`${ROBOTS[robotKey].name} ${n}`,start:{x,z}}];},'fleet-add');return;}
  if(name==='fleet-remove'&&world){mutate(w=>{w.fleet=(w.fleet||[]).filter(f=>f.id!==value);if(!w.fleet.length)delete w.fleet;},'fleet-remove');return;}
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
    const ancestry=sourceJobOptions(sourceBindings.get(source),client),sourceClient=client;
    const naming=!!(entry.object_naming&&ancestry.source_job&&$('scene-naming')?.checked);
    // A detector on the worker names objects from the same job's frames without sending them anywhere, so it needs no second approval.
    const cloud=await bimWorkflow.attach(metricCloud());if(client!==sourceClient||activeSource!==source)throw new Error('The source or worker changed. Review and approve the measured cloud again.');if(naming)cloud.nameObjects=true;
    const file=new File([JSON.stringify(cloud)],'brainsnn-point-cloud.json',{type:'application/json'});
    event('metric_scene_requested',{source:source.name,...(source.derivation||{}),points:cloud.points.length,metresPerUnit:scale.metresPerUnit,distance:scale.distance,selfReported:true,nameObjects:naming,...(naming?{namingModel:entry.object_naming.model}:{})});
    // Carry the same-worker reconstruction's evidence even when optional naming
    // is off. source_job is read-only ancestry; nameObjects remains consented above.
    await runJob(entry.id,[{file,kind:'cloud',name:file.name}],ancestry,[source]);return;}
  if((name==='propose-map'||name==='propose-measured')&&activeSource?.visual&&activeSource.reconstruction){
    const visual=activeSource.visual,c=calibrationFor(visual);let measurement=null;
    if(name==='propose-measured'){c.distance=$('measured-distance')?.value??'';if(c.picks.length!==2)throw new Error('Pick two points first.');
      measurement={a:pickedPoint(visual,c.picks[0]),b:pickedPoint(visual,c.picks[1]),distance:c.distance===''?NaN:Number(c.distance)};}
    else if($('camera-height'))cameraHeight=Number($('camera-height').value);
    const {world:proposed,report}=proposeWorld({points:visual.points,reconstruction:activeSource.reconstruction,name:`Proposed map / ${activeSource.name}`,cameraHeight,measurement});
    if(world&&world.provenance!=='authored'&&!confirm('Replace the current map with a map proposed from this reconstruction?'))return;
    const derived=activeSource.derivation||{},origin=sourceBindings.get(activeSource),binding={transform:report.transform,sourceSha256:derived.sha256,scaleMethod:measurement?'measured point pair':report.scaleEstimate?'reconstruction estimate':'camera-height estimate',job:/^colmap-/.test(derived.engine||'')&&origin?derived.job:null,source:activeSource.name,sourceClient:origin?.sourceClient};
    apply(proposed,`Map proposed from ${report.cameras} camera poses and ${report.points.toLocaleString()} points${measurement?` at your measured ${measurement.distance} m scale (phone ${report.impliedCameraHeight} m above the floor)`:report.scaleEstimate?` at the estimated scale, 1 unit ≈ ${report.metresPerUnit.toFixed(3)} m (not measured)`:''}: ${report.area.free} m² seen free, ${report.area.obstacle} m² obstacles, ${report.area.unknown} m² unknown. Review scale and obstacles, then plan.`,{proposal:binding});
    event('map_proposed',{source:activeSource.name,...(activeSource.derivation||{}),method:report.method,cameras:report.cameras,points:report.points,scaleSource:report.scaleSource,assumedCameraHeight:report.assumedCameraHeight,impliedCameraHeight:report.impliedCameraHeight,...(report.scaleEstimate?{scaleEstimate:report.scaleEstimate}:{}),
      ...(report.measurement?{measurement:{a:report.measurement.a,b:report.measurement.b,distance:report.measurement.distance,spanUnits:report.measurement.span,selfReported:true}}:{}),metresPerUnit:report.metresPerUnit,area:report.area,scaleVerified:false});
    setTab('world');
  }
  if(name==='proof')download('brainsnn-proof.json',await proofPack(world,result,assumptions,sources,events,observations.proofs(),measurements.session(),{routeReceipt:receipt}));
  if(name==='share-video'&&world){
    if(videoAbort){videoAbort.abort();return;}
    const controller=new AbortController();videoAbort=controller;renderPanel();
    try{
      const {blob,type,seconds}=await recordShareVideo({world:clone(world),result:result?clone(result):null,robot:clone(robot),signal:controller.signal,
        onProgress:p=>{const s=$('share-video-status');if(s)s.textContent=`Recording… ${Math.round(p*100)}%. Keep this tab open.`;}});
      const ext=/mp4/.test(type)?'mp4':'webm',slug=String(world.name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'map';
      const url=URL.createObjectURL(blob),a=Object.assign(document.createElement('a'),{href:url,download:`brainsnn-${slug}.${ext}`});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      event('share_video_made',{seconds,type,bytes:blob.size,route:!!result});
      status(`Share video saved (${seconds} s, ${ext.toUpperCase()}). It shows this map${result?' and this robot run':''} with the labels it carries.`);
    }catch(e){if(e.name!=='AbortError')throw e;status('Share video cancelled.');}
    finally{if(videoAbort===controller)videoAbort=null;renderPanel();}
    return;}
  if(name==='arena-export')download('brainsnn-arena-map.json',arenaMap(world));
  if(name==='usd-export')download('brainsnn-world.usda',usdScene(world),'text/plain');
  if(name==='scenario-export'&&baseline)download('brainsnn-scenarios.json',{schema:'brainsnn.comparison.v1',baseline,current:{world,result,assumptions},claim:'Scenario estimates, not measured outcomes.'});
  if(name==='add-note'){const text=$('note-text').value.trim(),s=$('note-source').value,t=Number($('note-time').value);if(!text||!Number.isFinite(t)||t<0||t>86400)throw new Error('Enter an observation and valid timestamp.');event('human_observation',{source:s===''?'reviewed map':sources[Number(s)]?.name,seconds:t,text:text.slice(0,400)});$('note-text').value='';status('Human-authored observation saved in this session.');}
  if(name==='clear'){if(!confirm('Clear the local map, captures and observations? Remote uploads expire separately on the worker.'))return;resetProjectReview();await layerTools?.clear();workspaceResults.clear();sourceBindings=new WeakMap();sceneContext=null;artifactAbort?.abort();sceneAbort?.abort();cancelConnection();capture.stop({discard:true});await cancelRemote();depthAbort?.abort();detectAbort?.abort();artifactAbort?.abort();sceneAbort?.abort();$('scene-dialog').close();sceneViewer?.destroy();sceneViewer=null;scenePromise=null;depthStatus='';observations.clear();measurements.clear();bimWorkflow.reset({clearDrafts:true});visibleVisual=null;calibration={visual:null,picks:[],picking:false,distance:''};visualViewer?.destroy();visualViewer=null;sources.forEach(s=>URL.revokeObjectURL(s.url));sources=[];activeSource=null;events=[];baseline=null;client=null;caps=null;job=null;jobExecution=null;localStorage.removeItem('brainsnn.world.v1');apply(sampleWorld(),'Local session cleared. Authored sample restored.');setTab('world');$('worker-summary').textContent='Local planning available';$('worker-note').textContent='No model is connected.';}
}catch(e){status(e.message,true);}}
$('panel').addEventListener('click',e=>{const box=e.target.closest?.('#located-photo');if(box)tapPhoto(e,box);});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.objectChip!==undefined){selected=b.dataset.objectChip;renderInspector();return;}
  if(b.dataset.workflow){const step=b.dataset.workflow;if(step==='review'&&bimWorkflow.hasScene){const context=workspaceResults.get(sceneContext?.jobKey)||currentResultContext(),index=context?.job.artifacts.findIndex(a=>a.name==='scene.glb')??-1;if(index>=0){void openSceneArtifact(index,context);return;}}setTab(step==='export'?'evidence':'capture');$('workspace').scrollIntoView({block:'start',behavior:'smooth'});if(step==='scale')($('measured-distance')||document.querySelector('[data-action=pick-scale]'))?.focus({preventScroll:true});if(step==='review')$('dimension-review')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
  if(b.dataset.dimensionRemove!==undefined){bimWorkflow.removeReading(Number(b.dataset.dimensionRemove));return;}
  if(b.dataset.bimRemove!==undefined){bimWorkflow.removeOpening(Number(b.dataset.bimRemove));return;}
  if(b.dataset.bimAction){try{if(b.dataset.bimAction==='add')bimWorkflow.addOpening();else if(b.dataset.bimAction==='recompile')void bimWorkflow.recompile().catch(error=>sceneStatus(error.message,true));}catch(error){sceneStatus(error.message,true);}return;}
  if(b.dataset.sceneDownload!==undefined){void bimWorkflow.downloadScene(Number(b.dataset.sceneDownload)).catch(error=>sceneStatus(error.message,true));return;}
  if(b.dataset.tab){layerTools?.suspend();viewRevision++;artifactAbort?.abort();sceneWorkspace.close();if(sandbox)void sandbox.handleTab(b.dataset.tab);else setTab(b.dataset.tab);return;}if(b.dataset.action){void action(b.dataset.action,b.dataset.value);return;}
  if(b.dataset.view){renderer?.setMode(b.dataset.view);document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));setTab('world');return;}
  if(b.dataset.filter){filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderSystems();return;}
  if(b.dataset.reviewArtifact!==undefined){void openObservationArtifact(Number(b.dataset.reviewArtifact));return;}
  // A localisation that finished while the street block was open is placed from Evidence, without locating the photo again.
  if(b.dataset.locateArtifact!==undefined){if(sandbox?.isStreet())void sandbox.select('map','simulate');void openLocalization(Number(b.dataset.locateArtifact));return;}
  if(b.dataset.previewArtifact!==undefined){void openArtifact(Number(b.dataset.previewArtifact));return;}
  if(b.dataset.sceneArtifact!==undefined){void openSceneArtifact(Number(b.dataset.sceneArtifact));return;}
  if(b.dataset.source!==undefined){const source=sources[Number(b.dataset.source)];if(source)void selectWorkspaceSource(sourceId(source),source.visual?'points':'source');return;}
  if(b.dataset.remove!==undefined){if(nativeCheckAbort){nativeCheckAbort.abort();nativeCheckAbort=null;jobStatus='';}bimWorkflow.reset();const i=Number(b.dataset.remove),s=sources[i];resetProjectReview();observations.removeSource(s);URL.revokeObjectURL(s.url);sources.splice(i,1);if(activeSource===s){depthAbort?.abort();activeSource=sources[0]||null;}renderPanel();renderMedia();update();return;}
  if(b.dataset.artifact!==undefined){void downloadResultArtifact(currentResultContext(),Number(b.dataset.artifact)).catch(e=>status(e.message,true));}
});
// A picker that returns no file (closed, or on iPhone a video whose conversion failed) says so instead of doing nothing.
const PICKERS=['files','video-file','phone-camera','native-capture-files'],NO_FILE='No file came back from your phone\'s picker. On iPhone, a video picked from Photo Library is converted first and that can fail for a long video: in Photos, tap Share → Save to Files, then pick it here with Choose File.';
document.addEventListener('cancel',e=>{if(PICKERS.includes(e.target?.id))status(NO_FILE,true);},true);
document.addEventListener('input',e=>{if(e.target.id==='path-scrub'&&activeSource?.reconstruction){stopPathPlay();pathView(activeSource,Number(e.target.value));}});
document.addEventListener('change',e=>{const id=e.target.id,v=e.target.value;if(id==='locate-file'){const file=e.target.files?.[0];e.target.value='';if(file)void locatePhoto(file);return;}if(PICKERS.includes(id)){if(!e.target.files?.length){status(NO_FILE,true);return;}void addFiles(e.target.files,{nativeCapture:id==='native-capture-files'});return;}if(id==='objects'){selected=v;renderInspector();return;}
  if(id==='robot'){chooseRobot(v);return;}
  if(id==='goal-x'||id==='goal-z'){goalSpot={x:Number($('goal-x').value),z:Number($('goal-z').value)};return;}
  if(id.startsWith('robot-')){const k=id.slice(6),next=Number(v),range={width:[.1,5],depth:[.1,5],speed:[.01,3],margin:[0,2]}[k];if(!range||!Number.isFinite(next)||next<range[0]||next>range[1]){status('Robot parameter is outside the supported range.',true);renderPanel();return;}robot[k]=next;invalidate();renderer?.setRobot(robot);if(dropStaleWhatIf())renderPanel();return;}
  if(Object.hasOwn(assumptions,id)){const next={...assumptions,[id]:v===''?null:Number(v)};try{estimate(result||{travelSeconds:0,turns:0},next);assumptions=next;update();renderPanel();}catch(err){status(err.message,true);renderPanel();}return;}
  if(id==='bim-host-wall'){bimWorkflow.selectHost(Number(v));return;}
  if(id==='camera-height'){cameraHeight=Number(v);return;}
  if(id==='measured-distance'){calibration.distance=v;bimWorkflow.reset();visualViewer?.setMarkers(calibration.picks);const slot=$('dimension-review-slot');if(slot&&activeSource?.visual)slot.innerHTML=bimWorkflow.captureHTML(activeSource,measuredScale(activeSource.visual),calibration,sceneEngine());update();status('Scale updated. Independent checks and opening reviews must be added again.');return;}
  if(!world)return;
  if(id==='scale-reviewed'||id==='map-reviewed'){world[id==='scale-reviewed'?'scaleReviewed':'mapReviewed']=e.target.checked;invalidate();event('human_review',id+': '+e.target.checked);return;}
  if(id==='map-name'){world.name=v.slice(0,160);update();return;}
  if(id==='floor-width'||id==='floor-depth'){if(world.floor){status('Edit dimensions in the source map and reimport to preserve the captured floor polygon.',true);renderPanel();return;}mutate(w=>{w[id==='floor-width'?'width':'depth']=Number(v);w.scaleReviewed=false;});return;}
  if(id==='start-x'||id==='start-z'){mutate(w=>{w.start[id.slice(-1)]=Number(v);});return;}
  if(id.startsWith('object-')){const key=id.slice(7);mutate(w=>{const o=w.objects.find(o=>o.id===selected);if(o)o[key]=['name','kind'].includes(key)?v:Number(v);},['x','z'].includes(key)?'moved':['w','d','h'].includes(key)?'resized':'edited');}
});
$('hero-capture').onclick=()=>{if(sandbox)void sandbox.select('capture');else setTab('capture');$('workspace').scrollIntoView();};$('hero-sample').onclick=()=>{if(world&&world.provenance!=='authored'&&!confirm('Replace the current map with the authored sample?'))return;apply(sampleWorld(),'Authored sample loaded, not a reconstruction of your media.');if(sandbox)void sandbox.select('map','edit');else setTab('world');$('workspace').scrollIntoView();};
// The hero demo opens the same training floor as the hero link; its reviewed state lands on Simulate, where the route runs.
createHeroDemo($('hero-demo'),{onOpen:state=>{$('hero-sample').click();if(state==='reviewed'&&world?.provenance==='authored'){if(sandbox)void sandbox.select('map','simulate');else setTab('test');}}});
$('undo-edit').onclick=()=>stepEdit(true);$('redo-edit').onclick=()=>stepEdit(false);
// Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (or Ctrl+Y) undo map edits, but never take over typing in a field or an open dialog.
document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.altKey)return;const k=e.key.toLowerCase();if(k!=='z'&&k!=='y')return;if(e.target?.closest?.('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]')||sandbox?.isStreet())return;const back=k==='z'&&!e.shiftKey;if(!(back?editHistory.undo:editHistory.redo).length)return;e.preventDefault();stepEdit(back);});
$('run').onclick=run;$('replay').onclick=replay;$('scrub').oninput=()=>{stopReplay();renderer?.setCursor(Number($('scrub').value)/1000);};$('reset-view').onclick=()=>{if(!$('visual-canvas').hidden)visualViewer?.reset();else renderer?.reset();};$('show-source').onclick=()=>{viewRevision++;display='source';renderMedia();unifiedWorkspace?.refresh();};$('show-visual').onclick=()=>{viewRevision++;display='visual';renderMedia();unifiedWorkspace?.refresh();};$('depth-start').onclick=()=>void buildDepth();$('detect-start').onclick=()=>void identifyObjects();$('flip-visual').onclick=()=>visualViewer?.flip();$('export').onclick=()=>sandbox?.isStreet()?sandbox.openExport():action('proof');$('fork').onclick=()=>{if(!result){status('Run a planning preview before saving a comparison baseline.',true);return;}baseline={world:clone(world),result:clone(result),assumptions:clone(assumptions)};event('scenario_forked',{distance:result.distance,minutes:estimate(result,assumptions).minutes});status('Baseline saved. Edit an obstacle or robot parameter and run again to compare.');setTab('test');};$('connect').onclick=connect;$('site-connect').onclick=connectSite;$('system-search').oninput=renderSystems;$('systems-more').onclick=()=>{systemsOpen=!systemsOpen;renderSystems();if(!systemsOpen)$('systems').scrollIntoView({block:'start'});};
// A tap (not a drag) on the map chooses the object under it, the same as choosing it in the list.
{let down=null;const canvas=$('world-canvas');
  canvas.addEventListener('pointerdown',e=>{down=e.isPrimary&&(e.button===0||e.pointerType!=='mouse')?[e.clientX,e.clientY]:null;});
  canvas.addEventListener('pointerup',e=>{const at=down;down=null;if(!at||!world||!renderer||Math.hypot(e.clientX-at[0],e.clientY-at[1])>6)return;const id=renderer.pick(e.clientX,e.clientY);if(!id||id===selected)return;selected=id;renderInspector();const o=world.objects.find(o=>o.id===id);if(o)status(`${o.name} chosen. Change it with the object controls.`);});}
// A tap (not a drag) on the 3D view picks a calibration point while picking is on; the viewer keeps handling orbit and zoom.
{let down=null;const canvas=$('visual-canvas');
  canvas.addEventListener('pointerdown',e=>{down=e.isPrimary&&e.button===0?[e.clientX,e.clientY]:null;});
  canvas.addEventListener('pointerup',e=>{const c=calibration,visual=activeSource?.visual;if(!down||!visualViewer||(!c.picking&&!bimWorkflow.picking)||c.visual!==visual||visibleVisual!==visual||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;down=null;
    const index=visualViewer.pick(e.clientX,e.clientY);if(index<0){status('No reconstructed point there. Zoom in and tap directly on a point.',true);return;}
    if(bimWorkflow.pick(index)){if(!bimWorkflow.picking)revealMeasurement('dimension-distance');return;}
    if(c.picks.includes(index)){status('That point is already picked. Tap the other end of the distance.',true);return;}
    c.picks.push(index);visualViewer.setMarkers(c.picks);if(c.picks.length===2)c.picking=false;
    renderPanel();status(c.picks.length===2?'Both points picked. Enter the distance you measured between them.':'Now tap the other end of the distance you measured.');
    if(c.picks.length===2)revealMeasurement('measured-distance');});}
// The header's More menu closes like a menu: on a tap elsewhere, or on Escape.
const navMore=document.querySelector('.nav-more');document.addEventListener('pointerdown',e=>{if(navMore?.open&&!navMore.contains(e.target))navMore.open=false;});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&navMore?.open){navMore.open=false;navMore.querySelector('summary').focus();}});
document.querySelector('.tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll('[role=tab]')),current=e.target.closest('[role=tab]')||e.currentTarget.querySelector('[aria-selected=true]'),i=Math.max(0,buttons.indexOf(current)),n=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(['ArrowRight','ArrowDown'].includes(e.key)?1:buttons.length-1))%buttons.length;buttons[n].focus();buttons[n].click();});
$('workspace').addEventListener('dragover',e=>{e.preventDefault();});$('workspace').addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer?.files.length){void sandbox?.select('capture');void addFiles(e.dataTransfer.files);}});
$('connection').addEventListener('close',cancelConnection);
$('scene-dialog').addEventListener('close',()=>{if($('scene-dialog').open)return;sceneAbort?.abort();sceneAbort=null;surfaceReview.clear();bimWorkflow.clearScene();sceneContext=null;sceneMap=null;update();});$('scene-reset').onclick=()=>sceneViewer?.reset();
// A metric scene's walls, separated objects and unobserved floor become an unreviewed planning map; the robot waits for review.
$('scene-plan').onclick=async()=>{try{const sourceMap=sceneMap;if(!sourceMap)return;const {worldFromScene}=await import('./scene-preview.mjs');if(sceneMap!==sourceMap)return;
  const {world:proposed,counts,summary}=worldFromScene(sourceMap.scene,`Scene map / ${sourceMap.source}`);
  if(world&&world.provenance!=='authored'&&!confirm('Replace the current map with a map built from this simulation scene?'))return;
  $('scene-dialog').close();
  apply(proposed,summary);
  event('scene_map_proposed',{job:sourceMap.job,engine:sourceMap.engine,...counts,boxes:proposed.objects.length,scaleVerified:false});setTab('world');
}catch(e){sceneStatus('A planning map could not be built from this scene: '+e.message,true);}};
window.addEventListener('pagehide',e=>{projectReviewLoadAbort?.abort();projectReviewLoadAbort=null;if(e.persisted)projectReview.cancel();else projectReview.dispose();if(e.persisted)layerTools?.suspend();else layerTools?.dispose();if(e.persisted)sandbox?.suspend();else sandbox?.dispose();nativeCheckAbort?.abort();nativeCheckAbort=null;cancelConnection();depthAbort?.abort();detectAbort?.abort();artifactAbort?.abort();sceneAbort?.abort();capture.stop({discard:true});stopReplay();planner?.terminate();planner=null;planning=false;remoteAbort?.abort();remoteAbort=null;clearTimeout(poll);if(e.persisted)return;workspaceResults.clear();sourceBindings=new WeakMap();unifiedWorkspace?.dispose();observations.clear();bimWorkflow.reset({clearDrafts:true});visualViewer?.destroy();sceneViewer?.destroy();sceneViewer=null;scenePromise=null;sources.forEach(s=>URL.revokeObjectURL(s.url));renderer?.destroy();});
window.addEventListener('pageshow',e=>{if(!e.persisted)return;sandbox?.resume();renderPanel();renderMedia();update();if(job&&client&&!['complete','failed','cancelled'].includes(job.status)){remoteAbort=new AbortController();void checkJob(remoteAbort.signal).catch(error=>{remoteAbort=null;status('Could not resume job status: '+error.message,true);});}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopReplay();capture.stop();layerTools?.suspend();}});
// One-time same-origin handoff from /scan. The fragment does not enter HTTP requests.
// Importing a File is not worker consent; the operator still must check the upload box.
async function receiveCaptureHandoff(id) {
  if (!id) return;
  void sandbox.select('capture');
  status('Opening your private capture from this browser…');
  let alreadyLoaded=false;
  try {
    const record=await readLocalCapture(id);
    if (!record) throw new Error('The local transfer expired, was cleared, or belongs to another browser.');
    const previous=sources.length;
    await addFiles(record.files);
    const imported=sources.length-previous;
    if (imported!==record.files.length) throw new Error('Some selected files could not be opened.');
    alreadyLoaded=true;
    await clearLocalCapture(id);
    event('local_capture_handoff_received',{goal:record.goal,files:imported});
    const photoOnly=imported===1&&activeSource?.kind==='image';
    status(`Loaded ${imported} local capture file${imported===1?'':'s'} from Capture Studio. No upload was made. ${photoOnly?'Next: create a 3D preview on this device.':'To reconstruct, connect a worker and explicitly approve processing.'}`);
    if(photoOnly)requestAnimationFrame(()=>{const next=document.querySelector('[data-action=depth]');next?.scrollIntoView({block:'center'});next?.focus({preventScroll:true});});
  } catch (error) {
    status((alreadyLoaded?'Your file opened, but its temporary browser copy could not be deleted. Clear site storage if it contains sensitive media. ':'Private handoff unavailable. Open the file picker and choose the original media again. ')+(error?.message||'Local storage failed.'),true);
  } finally {
    // No personal file details or local transfer token remain in browser history.
    history.replaceState(history.state,'',location.pathname+location.search+'#workspace');
    setTab('capture');
  }
}
renderer?.setWorld(world);renderInspector();setTab('world');renderSystems();update();void loadSiteProcessing();
// Capture the private transfer token before sandbox navigation canonicalizes the URL.
const handoffId=parseHandoffHash(location.hash);
sandbox=createSandboxUI({setMapTab:setTab,getMap:()=>world,getSourceCount:()=>sources.length,status,event,pauseMap:stopReplay,onWorkspaceChange:()=>{unifiedWorkspace?.refresh();robotSetup?.refresh();updateUndo();cameraDock?.sync();}});
unifiedWorkspace=mountUnifiedWorkspace({getSnapshot:workspaceSnapshot,actions:{
  selectSource:selectWorkspaceSource,showMap:showWorkspaceTab,showTab:showWorkspaceTab,openArtifact:openResultArtifact,
  reviewProject:openProjectReview,
  downloadArtifact:(key,index)=>downloadResultArtifact(requireResultContext(key),index),
  showProcessing:showProcessingOptions,
}});
// Robot-first setup (choose a robot, build its world, let it try) drives the controls the playground already has.
function activeCanvas(){if(!$('visual-canvas').hidden)return $('visual-canvas');if(!$('map-workspace').hidden&&!$('world-canvas').hidden)return $('world-canvas');return null;}
function robotSetupState(){const capture=sandbox?.getState?.().workspace==='capture'||!!(activeSource&&(tab==='capture'||!world));return {robotId,robotName:ROBOTS[robotId]?.name||'robot',origin:sandbox?.isStreet()?'street':capture?'capture':world?worldOrigin:'',worldName:world?.name||'',planning,runDisabled:!world||capture,gate:world&&!capture?planningGate(world):'',issue:runIssue};}
// A robot too big for its start: move the start to the nearest spot the planner found. That is a map edit, so the map needs review again.
function moveStart(spot){if(!world||!Number.isFinite(spot?.x)||!Number.isFinite(spot?.z))return;mutate(w=>{w.start={x:+spot.x.toFixed(2),z:+spot.z.toFixed(2)};},'moved');status(`Start moved to where the ${(ROBOTS[robotId]?.name||'robot').toLowerCase()} fits. Check the map, then let it try.`);}
async function showCheck(){$('tab-world').click();for(let i=0;i<20&&!$('map-reviewed');i++)await new Promise(r=>setTimeout(r,50));const box=['scale-reviewed','map-reviewed'].map($).find(b=>b&&!b.checked&&!b.disabled);box?.scrollIntoView({block:'center'});box?.focus({preventScroll:true});}
async function showRobotSettings(){$('tab-test').click();for(let i=0;i<20&&!$('robot-width');i++)await new Promise(r=>setTimeout(r,50));const field=$('robot-width');field?.scrollIntoView({block:'center'});field?.focus({preventScroll:true});}
function revealWorld(kind){const narrow=matchMedia('(max-width: 760px)').matches,street=sandbox?.isStreet();(narrow?(street?$('street-workspace'):kind==='capture'?$('workspace'):$('viewport')):document.querySelector('#robot-setup .setup-worlds'))?.scrollIntoView({block:narrow&&!street&&kind!=='capture'?'center':'start'});}
async function chooseWorld(kind){const street=!!sandbox?.isStreet(),inCapture=sandbox?.getState?.().workspace==='capture';
  if(kind==='street'){if(!street)$('hero-street').click();}
  else if(kind==='capture')$('hero-capture').click();
  else{if(street||inCapture)await sandbox?.select('map','edit');
    if(kind==='sample'){if(worldOrigin!=='sample'||!world)$('hero-sample').click();else if(editHistory.undo.length&&confirm('Start the example room again? Your changes to it will be lost.'))$('hero-sample').click();}
    else if(kind==='empty'){if(worldOrigin!=='empty'||editHistory.undo.length)await action('new-map');}
    else if(kind==='saved')await action('restore');}
  robotSetup?.refresh();revealWorld(kind);}
async function letItTry(){if(sandbox?.isStreet()){$('tab-test').click();$('street-workspace').scrollIntoView({block:'start'});return;}if(!world)return;$('viewport').scrollIntoView({block:'center'});await run();robotSetup?.refresh();}
robotSetup=mountRobotSetup({host:$('robot-setup'),robots:ROBOTS,getState:robotSetupState,actions:{chooseRobot,chooseWorld,run:letItTry,moveStart,showCheck,showRobotSettings}});
cameraDock=mountCameraDock({getCanvas:activeCanvas,getPreviewViewer:()=>activeCanvas()===$('visual-canvas')?visualViewer:null,setNames:on=>renderer?.setLabels(on)});
updateUndo();
layerTools=mountWorldLayerTools({root:$('world-layer-tools'),
  getDraftToken:()=>{
    if(client?.site && client.siteRole==='owner')return client.token;
    if(siteProcessing?.passcode)$('connection').showModal();
    return null;
  },
  getConnection:()=>{if(isMainRemoteActive())throw Error('Wait for the current capture job or cancel it first.');if(!client){$('connection').showModal();throw Error('Connect processing, then start this tool.');}return {client,caps};},
  getResults:()=>workspaceResults.list(),getResult:requireResultContext,
  rememberResult:(result,originalClient,metadata)=>{const context=workspaceResults.remember(result,originalClient,{...metadata,sourceIds:[]});unifiedWorkspace.refresh();layerTools?.refresh();return context;},
  connect:()=>$('connection').showModal(),onChange:()=>{renderPanel();update();},
});
// One studio: the bar reaches every tool, and separate tool pages open in the workbench beside the world.
const workbench=createWorkbench({root:$('studio-workbench')});
const showcaseNavigator=mountShowcase({
  root:$('showcase'), showTab:showWorkspaceTab, showProcessing:showProcessingOptions,
  openPage:(feature,chapter,origin)=>workbench.show(feature,chapter,origin),
  leaveLayer:() => layerTools.suspend(),
  showProject:() => {
    if (projectReview.hasSource) {
      const dialog = $('project-review-dialog');
      if (!dialog.open) dialog.showModal();
      return;
    }
    return openProjectReview(sceneContext?.jobKey);
  },
});
function studioStatus(message){const node=$('studio-status');node.textContent=message;node.hidden=!message;}
mountStudioBar({root:$('studio-sticky'),chapters:studioChapters,
  onHome:()=>{studioStatus('');workbench.hide({restoreFocus:false});$('workspace').scrollIntoView({block:'start'});$('workspace').focus?.({preventScroll:true});},
  openFeature:async(feature,chapter,origin)=>{
    studioStatus('');
    if(isWorkbenchPage(feature.target))return workbench.show(feature,chapter,origin);
    workbench.hide({restoreFocus:false});
    if(feature.target==='#showroom'){if(location.hash==='#showroom')window.dispatchEvent(new HashChangeEvent('hashchange'));else location.hash='showroom';return;}
    try{await showcaseNavigator.openInPlace(feature);}catch(error){studioStatus(error?.message||'That tool could not open. Try it again.');}
  }});
// A local handoff opens Capture even when a shared Street route is also present.
// Do not start a competing lazy Street activation before the file is received.
if(handoffId)void receiveCaptureHandoff(handoffId);else void sandbox.start();
// Arriving from the homepage's install button: show the iOS steps on the page they apply to.
if(new URLSearchParams(location.search).has('install')&&!standalone())void installApp();

// Optional reading help uses the same tools, so existing scenes and edits stay in place.
mountPlaygroundHelp({onTool:tool=>{$('tab-'+tool).click();$('workspace').scrollIntoView({block:'start'});$('tab-'+tool).focus({preventScroll:true});}});
