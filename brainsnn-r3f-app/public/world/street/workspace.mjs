import { SceneView } from './scene-view.mjs';
import { createWorld, createSimulation } from './sim-core.mjs';

/** Native World Builder street workspace. No iframe, top-level navigation or worker credentials. */
export async function mountStreetWorkspace(container,{onStatus,onChange,onToolChange,signal}={}){
  if(!(container instanceof HTMLElement))throw new TypeError('A scene workspace container is required.');
  if(container.shadowRoot?.childElementCount)throw new Error('This scene workspace is already mounted.');
  const lifetime=new AbortController();
  const externalAbort=()=>lifetime.abort(signal?.reason);
  if(signal?.aborted)externalAbort();else signal?.addEventListener('abort',externalAbort,{once:true});
  let active=true,disposed=false,animationFrame=0,ready=false,importRevision=0;
  const root=container.shadowRoot||container.attachShadow({mode:'open'});
  let surface;
  const listen=(target,type,handler,options={})=>target.addEventListener(type,handler,{...options,signal:lifetime.signal});
  const effectiveActive=()=>active&&!disposed&&!document.hidden;
  const getState=()=>({sceneId:'green-gardens',active,tool:activeTool,selectedId,cameraMode,renderMode:view?.renderMode,objectCount:scene?.objects.length||0,editRevision,edits:clone(edits),simulation:sim?.getState(),exportVersion:scene?.version});
  const emitChange=()=>{if(ready&&!disposed)onChange?.(getState());};
  function syncActivity(){
    if(!view||disposed)return;
    cancelAnimationFrame(animationFrame);animationFrame=0;lastFrame=0;keys.clear();
    view.setActive(effectiveActive());
    if(effectiveActive()){view.resize();animationFrame=requestAnimationFrame(tick);}
    else{sim.pauseRobot();refreshSimulation();closeExport(false);closePanels();}
  }
  function dispose(){
    if(disposed)return;
    if(ready&&scene)persistEdits();
    disposed=true;active=false;importRevision++;lifetime.abort();signal?.removeEventListener('abort',externalAbort);
    cancelAnimationFrame(animationFrame);clearTimeout(toastTimer);clearTimeout(saveTimer);keys.clear();
    sim?.pauseRobot();view?.dispose();
    const url=$('#prepared-download')?.dataset.objectUrl;if(url)URL.revokeObjectURL(url);
    root.replaceChildren();
  }
const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];
const clone=x=>structuredClone(x), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name,cls='')=>`<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const STORAGE='brainsnn.street-studio.edits.v1';
let baseline,scene,objects,view,sim,selectedId=null,cameraMode='orbit',sourceMode=false,colliderMode=false,contextMode=false,edits={},editRevision=0,lastReplan=-1,lastStatus='',lastFrame=0,toastTimer,saveTimer,uiTime=0;
const keys=new Set();
let activeTool='edit',previousTool='edit';
let look={yaw:0,pitch:0};
const sourceKind=o=>o.sourceStatus==='lidar-2023'?'lidar':o.sourceStatus?.startsWith('municipal')?'reference':'authored';
const sourceName=o=>({'municipal-site-plan':'Municipal · site plan','municipal-lidar-2015':'Municipal · 2015 LiDAR','lidar-2023':'2023 LiDAR · interpreted','authored-assumed':'Authored · assumed'}[o.sourceStatus]||'Source unverified');
const colorHex=rgb=>'#'+(rgb||[.5,.5,.5]).map(x=>Math.round(Math.max(0,Math.min(1,x))*255).toString(16).padStart(2,'0')).join('');
const fromHex=value=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255);
const num=(x,d=2)=>Number.isFinite(x)?x.toFixed(d):'—';
const canColor=o=>o.editableProperties?.includes('material.color')||o.id===scene?.barrier?.id;
function notify(text,error=false){if(disposed)return;if(active)onStatus?.(text,error);clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').className='toast show'+(error?' error':'');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),error?5500:3200);}
function mergeObject(o,p){const n={...o,...p};for(const k of ['transform','material','metadata','collider'])if(p[k])n[k]={...o[k],...p[k]};return n;}
function updateRecord(id,patch,{persist=true}={}){
  const i=scene.objects.findIndex(o=>o.id===id);if(i<0)throw Error('This object is not part of the scene.');
  const next=mergeObject(scene.objects[i],clone(patch));scene.objects[i]=next;objects.set(id,next);view.updateObject(id,patch);
  if(persist){edits[id]=mergeObject(edits[id]||{},clone(patch));editRevision++;scheduleSave();}
  return next;
}
function persistEdits(){try{localStorage.setItem(STORAGE,JSON.stringify({schemaVersion:scene.schemaVersion,version:scene.version,edits,editRevision}));$('#save-state').textContent='Edits saved on this device';}catch{$('#save-state').textContent='Edits active · export to keep them';}}
function scheduleSave(){clearTimeout(saveTimer);$('#save-state').textContent='Saving local edits…';saveTimer=setTimeout(persistEdits,250);emitChange();}
function syncBarrier(result,{persist=true,inspect=true}={}){
  const b=result.barrier||sim.getState().barriers[0];
  scene.barrier={...scene.barrier,...b,y:b.baseY+b.height/2};
  const patch={transform:{position:[b.x,b.baseY+b.height/2,b.z],rotation:[0,b.yaw,0],scale:[1,1,1]},geometry:{type:'box',dimensions:[b.width,b.height,b.depth]}};
  updateRecord(b.id,patch,{persist});
  view.setColliders?.(sim.colliders());if(inspect&&selectedId===b.id)renderInspector();refreshSimulation();
}
function changeBarrier(patch,{silent=false,inspect=true}={}){
  try{const result=sim.setBarrier({id:scene.barrier.id,...patch});syncBarrier(result,{persist:result.changed,inspect});if(result.changed&&!silent)notify(result.state.blocked?'Obstacle updated. No clear route at this placement.':'Barrier moved. The route has been recalculated.');return true;}
  catch(error){const b=sim.getState().barriers[0];syncBarrier({barrier:b},{persist:false,inspect});if(!silent)notify(error.message,true);return false;}
}
function dimensions(o){if(o.geometry.type==='box')return o.geometry.dimensions;const p=o.geometry.positions;let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<p.length;i++) {const a=i%3;min[a]=Math.min(min[a],p[i]);max[a]=Math.max(max[a],p[i]);}return max.map((n,i)=>(n-min[i])*(o.transform?.scale?.[i]??1));}
function objectButton(o,indent=0){return `<button class="object-row${selectedId===o.id?' selected':''}" data-object-id="${esc(o.id)}" style="padding-left:${22+indent*10}px" title="${esc(o.id)}"><svg><use href="#i-${o.class==='building'?'cube':o.class==='terrain'?'grid':o.class==='barrier'?'move':'layers'}"/></svg><span class="object-label">${esc(o.label.replace(/^Authored /,'').replace(/^Municipal form /,'Building '))}</span><span class="source-dot ${sourceKind(o)}"></span></button>`;}
function renderTree(){
  const query=$('#object-search').value.toLowerCase().trim();
  if(query){const rows=scene.objects.filter(o=>[o.id,o.label,o.class,o.sourceStatus].some(s=>s?.toLowerCase().includes(query)));$('#object-tree').innerHTML=rows.length?rows.map(o=>objectButton(o)).join(''):'<p class="no-results">No objects match this search.</p>';return;}
  const old=new Set($$('#object-tree details[open]').map(x=>x.dataset.group));const initial=!$('#object-tree').children.length;
  const groups=[];
  for(const id of scene.focusBuildingIds){const b=objects.get(id),children=scene.objects.filter(o=>o.parentId===id);groups.push({id,label:id===scene.mainBuildingId?'Main frontage':`Neighbour ${id.split('-')[1]}`,items:[b,...children]});}
  groups.push({id:'street',label:'Street & navigation',items:scene.objects.filter(o=>!o.parentId&&o.class!=='building'&&o.class!=='terrain').concat(scene.objects.filter(o=>o.parentId?.startsWith('street/')))});
  groups.push({id:'ground',label:'Ground surface',items:scene.objects.filter(o=>o.class==='terrain')});
  groups.push({id:'context',label:'Municipal context',items:scene.objects.filter(o=>o.class==='building'&&!scene.focusBuildingIds.includes(o.id))});
  $('#object-tree').innerHTML=groups.map(g=>`<details class="object-group" data-group="${g.id}" ${(old.has(g.id)||(initial&&['street',scene.mainBuildingId].includes(g.id)))?'open':''}><summary>${icon('arrow')}${esc(g.label)}<span class="group-count">${g.items.length}</span></summary>${g.items.map((o,i)=>objectButton(o,o.parentId?1:0)).join('')}</details>`).join('');
}
function selectObject(id,{focus=false,mobile=false}={}){
  if(id&&!objects.has(id))return;if(id&&objects.get(id).metadata?.role==='context'&&!contextMode){contextMode=true;view.setLayerVisible('context',true);$('#show-context').setAttribute('aria-pressed','true');}selectedId=id;view.select(id);renderTree();renderInspector();
  if(id){const row=$(`[data-object-id="${CSS.escape(id)}"]`);if(row){row.closest('details')?.setAttribute('open','');if(focus)row.scrollIntoView({block:'nearest'});}if(focus)view.focusObject(id);}
  $('#mobile-inspector').hidden=!id;if(mobile&&matchMedia('(max-width:970px)').matches)openPanel('inspector');
}
function renderInspector(){
  const o=objects.get(selectedId);$('#inspector-empty').hidden=!!o;$('#inspector-content').hidden=!o;$('#inspector-index').textContent=o?'#'+String(scene.objects.indexOf(o)+1).padStart(3,'0'):'—';if(!o)return;
  const d=dimensions(o),tri=o.geometry.type==='box'?12:o.geometry.indices.length/3,b=o.id===scene.barrier.id?sim.getState().barriers[0]:null;
  const sourceText=sourceKind(o)==='authored'?'This component is authored for the demonstration. Appearance and dimensions have not been measured on site.':sourceKind(o)==='lidar'?'A 2 m ground grid interpreted from 179,636 classified ground returns. Small terrain features and curbs are not resolved.':`A geographic reference from the 2025 Toronto massing release. ${o.metadata.heightSource==='Site Plan'?'Height is taken from a site plan.':'Height derives from 2015 LiDAR.'} Current construction state is unverified.`;
  let body=`<div class="selection-title"><span class="type-pill">${esc(o.class.replaceAll('-',' '))}</span><h2>${esc(o.label.replace(/^Authored /,''))}</h2><div class="object-id">${esc(o.id)}</div></div><section class="inspector-section"><h3>PROVENANCE</h3><span class="source-badge"><i class="source-dot ${sourceKind(o)}"></i>${sourceName(o)}</span><p>${sourceText}</p></section>`;
  if(b){
    body+=`<section class="inspector-section"><h3>MOVE OBSTACLE <span class="source-dot authored"></span></h3><div class="transform-control"><div><label for="barrier-x">East / west</label><output id="barrier-x-value">${num(b.x)} m</output></div><input id="barrier-x" type="range" min="${num(Math.max(scene.bounds.minX+3,baseline.barrier.x-22))}" max="${num(Math.min(scene.bounds.maxX-3,baseline.barrier.x+22))}" step="0.01" value="${num(b.x)}"></div><div class="transform-control"><div><label for="barrier-z">North / south</label><output id="barrier-z-value">${num(b.z)} m</output></div><input id="barrier-z" type="range" min="${num(Math.max(scene.bounds.minZ+3,baseline.barrier.z-8))}" max="${num(Math.min(scene.bounds.maxZ-3,baseline.barrier.z+12))}" step="0.01" value="${num(b.z)}"></div><div class="transform-control"><div><label for="barrier-yaw">Rotation</label><output id="barrier-yaw-value">${num(b.yaw*180/Math.PI,0)}°</output></div><input id="barrier-yaw" type="range" min="-180" max="180" step="1" value="${b.yaw*180/Math.PI}"></div><div class="number-inputs"><label>WIDTH (M)<input id="barrier-width" type="number" min="0.3" max="8" step="0.1" value="${num(b.width)}"></label><label>HEIGHT (M)<input id="barrier-height" type="number" min="0.3" max="3" step="0.1" value="${num(b.height)}"></label><label>DEPTH (M)<input id="barrier-depth" type="number" min="0.2" max="4" step="0.1" value="${num(b.depth)}"></label></div><button id="barrier-offset" class="button secondary full-width">${icon('move')}Shift aside / restore</button><p class="edit-hint">Drag the arrows in orbit view, or use these controls. The route updates after each accepted placement.</p></section>`;
  }
  body+=`<section class="inspector-section"><h3>GEOMETRY</h3><dl class="property-grid"><dt>Size · X / Y / Z</dt><dd>${d.map(v=>num(v,1)).join(' / ')} m</dd><dt>Triangles</dt><dd>${tri.toLocaleString()}</dd><dt>Parent</dt><dd>${esc(o.parentId||'Scene root')}</dd><dt>Collision</dt><dd>${o.collider?.enabled?esc(o.collider.type.replaceAll('-',' ')):'Visual component'}</dd>${o.metadata.courtyardCount?`<dt>Courtyards</dt><dd>${o.metadata.courtyardCount} preserved</dd>`:''}${b?'<dt>Configured mass</dt><dd>20 kg · assumed</dd>':''}</dl><div class="inspector-input-row"><label for="object-visible">Visible in export</label><button id="object-visible" class="mini-toggle" role="switch" aria-label="Object visibility" aria-checked="${o.visible!==false}" aria-pressed="${o.visible!==false}"></button></div>${o.collider?.enabled?'<p class="edit-hint">Visibility changes the visual export. Navigation collision remains active.</p>':''}</section>`;
  if(canColor(o))body+=`<section class="inspector-section"><h3>APPEARANCE</h3><div class="inspector-input-row"><label for="material-color">Material tint</label><span class="color-hex" id="color-hex">${colorHex(o.material.color).toUpperCase()}</span><input id="material-color" class="color-input" type="color" value="${colorHex(o.material.color)}"></div><p class="edit-hint">Procedural surface appearance, authored for this demo.</p></section>`;
  body+=`<section class="inspector-section"><div class="inspector-actions"><button id="focus-object" class="button secondary">${icon('frame')}Frame</button><button id="reset-object" class="button secondary">${icon('reset')}Restore</button></div></section>`;
  $('#inspector-content').innerHTML=body;
  $('#focus-object').onclick=()=>{setMode('orbit');view.focusObject(o.id);closePanels();};
  $('#reset-object').onclick=()=>restoreObject(o.id);
  $('#object-visible').onclick=()=>{updateRecord(o.id,{visible:objects.get(o.id).visible===false});renderInspector();};
  if(canColor(o))$('#material-color').oninput=e=>{const c=fromHex(e.target.value);updateRecord(o.id,{material:{color:c}});$('#color-hex').textContent=e.target.value.toUpperCase();};
  if(b){
    for(const key of ['x','z','yaw']){const input=$('#barrier-'+key);let accepted=true;input.oninput=e=>{const value=Number(e.target.value);$('#barrier-'+key+'-value').textContent=num(value,key==='yaw'?0:2)+(key==='yaw'?'°':' m');accepted=changeBarrier({[key]:key==='yaw'?value*Math.PI/180:value},{silent:true,inspect:false});};input.onchange=()=>{renderInspector();notify(accepted?'Obstacle placement accepted. Route updated.':'That placement overlaps solid geometry or an actor. The last valid position was kept.',!accepted);};}
    for(const key of ['width','height','depth'])$('#barrier-'+key).onchange=e=>{const value=Number(e.target.value),limits={width:[.3,8],height:[.3,3],depth:[.2,4]}[key];if(!Number.isFinite(value)||value<limits[0]||value>limits[1]){notify(`Use ${limits[0]}–${limits[1]} metres for ${key}.`,true);renderInspector();return;}changeBarrier({[key]:value});};
    $('#barrier-offset').onclick=()=>{const t=scene.frontage.outward,initial=baseline.barrier,current=sim.getState().barriers[0],away=Math.hypot(current.x-initial.x,current.z-initial.z)>1;changeBarrier({x:initial.x+(away?0:t[0]*5),z:initial.z+(away?0:t[1]*5)});};
  }
}
function restoreObject(id){
  const original=baseline.objects.find(o=>o.id===id);if(!original)return;
  if(id===scene.barrier.id){const b=baseline.barrier;try{const result=sim.setBarrier({id,x:b.x,z:b.z,width:b.width,height:b.height,depth:b.depth,yaw:b.yaw});syncBarrier(result,{persist:false,inspect:false});}catch(error){notify(error.message+' Move the actor clear before restoring this object.',true);return false;}}
  const patch={material:clone(original.material),visible:original.visible!==false};updateRecord(id,patch,{persist:false});delete edits[id];editRevision++;scheduleSave();renderInspector();notify('Original object restored.');
  return true;
}
function resetRoute(){
  const state=sim.getState(),current=state.barriers[0],edit={id:current.id,x:current.x,z:current.z,width:current.width,depth:current.depth,height:current.height,yaw:current.yaw};
  // Check the reset spawn before mutating the live scene. A valid edit may have
  // occupied that spawn after the actors left it.
  try{const trial=createSimulation(createWorld(baseline));trial.setBarrier(edit);trial.setPlayerPose({position:state.player.position,yaw:look.yaw});}
  catch(error){notify('Move the barrier clear of the route start before resetting. '+error.message,true);return false;}
  sim.reset();const result=sim.setBarrier(edit);sim.setPlayerPose({position:state.player.position,yaw:look.yaw});lastReplan=-1;syncBarrier(result,{persist:false,inspect:false});notify('Robot returned to the route start.');return true;
}
function resetAll({silent=false}={}){
  sim.reset();for(const id of Object.keys(edits)){const o=baseline.objects.find(o=>o.id===id);if(o){scene.objects[scene.objects.findIndex(x=>x.id===id)]=clone(o);objects.set(id,scene.objects.find(x=>x.id===id));view.updateObject(id,{...clone(o),visible:o.visible!==false});}}
  edits={};editRevision++;look={yaw:Math.atan2(baseline.goal.x-baseline.start.x,baseline.goal.z-baseline.start.z),pitch:0};sim.setPlayerPose({yaw:look.yaw});syncBarrier({barrier:sim.getState().barriers[0]},{persist:false});scheduleSave();renderInspector();setMode('orbit');view.resetCamera();lastReplan=-1;refreshSimulation();if(!silent)notify('Original scene restored.');
}
function refreshSimulation(){
  const state=sim.getState();view.setRobotPose(state.robotPose);view.setPlayerPose({...state.player,pitch:look.pitch});
  if(state.replans!==lastReplan){view.setPath(state.path);lastReplan=state.replans;$('#route-length').textContent=state.path.length?num(state.route.cost,1):'—';$('#route-revision').textContent=String(state.revision+1).padStart(2,'0');}
  const status={ready:'Clear route · move the barrier to replan',moving:`${num(state.travelled,1)} m travelled · 1.0 m/s`,paused:'Paused · resume when ready',arrived:'Destination reached',unreachable:'No clear route from this placement','blocked-start':'Obstacle overlaps the start','blocked-goal':'Obstacle overlaps the destination','search-limit':'Route exceeds the search budget',blocked:'Movement blocked'}[state.status]||state.status;
  $('#sim-status').textContent=status;$('#robot-toggle span').textContent=state.running?'Pause':state.status==='arrived'?'Run again':'Run route';$('#robot-action-icon use').setAttribute('href',state.running?'#i-pause':'#i-play');
  if(state.status==='arrived'&&lastStatus!=='arrived')notify('Destination reached. Move the barrier and try another route.');lastStatus=state.status;
}
function setMode(mode){cameraMode=mode;surface.dataset.cameraMode=mode;keys.clear();view.setCameraMode(mode==='walk'?'firstPerson':'orbit');$('#camera-orbit').classList.toggle('active',mode==='orbit');$('#camera-walk').classList.toggle('active',mode==='walk');$('#walk-help').hidden=mode!=='walk';$('#touch-pad').hidden=mode!=='walk';$('#interaction-hint').style.visibility=mode==='walk'?'hidden':'visible';$('#mobile-inspector').hidden=mode==='walk'||!selectedId;if(mode==='walk'){$('#scene-canvas').focus();view.setPlayerPose({...sim.getState().player,pitch:look.pitch});}}
function openPanel(name){closePanels();$(name==='objects'?'#object-panel':'#inspector-panel').classList.add('open');$('#panel-backdrop').hidden=false;}
function closePanels(){$$('.panel.open').forEach(x=>x.classList.remove('open'));$('#panel-backdrop').hidden=true;}
function setTab(tab){const evidence=tab==='evidence';$('#objects-content').hidden=evidence;$('#evidence-content').hidden=!evidence;for(const name of ['objects','evidence']){$('#tab-'+name).classList.toggle('active',name===tab);$('#tab-'+name).setAttribute('aria-selected',String(name===tab));}}
// Tool notifications describe internal navigation only. The parent can update
// its toolbar without calling setActive or interrupting a running route.
function rememberTool(tool,notifyParent=false){
  if(activeTool===tool)return;
  if(tool==='export')previousTool=activeTool;else previousTool=tool;
  activeTool=tool;
  if(notifyParent&&active&&!disposed)onToolChange?.(tool);
}
function choosePanel(tab){setTab(tab);rememberTool(tab==='evidence'?'evidence':'edit',true);}
function openExport(notifyParent=false){
  if(disposed||!active)return;
  rememberTool('export',notifyParent);
  if(!$('#export-dialog').open)$('#export-dialog').showModal();
}
function closeExport(notifyParent=false){
  // Change state before close(): the browser dispatches its close event later.
  if(activeTool==='export')rememberTool(previousTool,notifyParent);
  $('#export-dialog')?.close();
}

function download(blob,name){if(disposed)return;const a=$('#prepared-download');if(a.dataset.objectUrl)URL.revokeObjectURL(a.dataset.objectUrl);const url=URL.createObjectURL(blob);a.dataset.objectUrl=url;a.href=url;a.download=name;a.textContent=`Save prepared ${name.split('.').at(-1).toUpperCase()} · ${(blob.size/1048576).toFixed(2)} MB`;a.hidden=false;a.click();}
function currentManifest(){const data=clone(scene);data.editor={schema:'brainsnn.street-studio.edits/1.0',editRevision,createdAt:new Date().toISOString(),edits:clone(edits)};const state=sim.getState();data.runtime={mode:state.mode,revision:state.revision,robotRadiusM:state.robot.radius,playerRadiusM:state.player.radius,robotSpeedMps:state.robot.speed,routeStatus:state.status,route:state.path,physicalSimulationValidated:false};return data;}
async function exportFile(kind){if(disposed)throw Error('The scene workspace is closed.');if(!['glb','usd','json'].includes(kind))throw Error('Choose GLB, USD or JSON.');const button=$('#export-'+kind);button.disabled=true;$('#export-state').textContent='Preparing your '+kind.toUpperCase()+' file…';try{if(kind==='glb'){download(await view.exportGLB(),'BrainSNN_Street_Studio_Edited.glb');}else if(kind==='usd'){const {exportSceneUSD}=await import('./usd-export.mjs');if(disposed)return;download(new Blob([exportSceneUSD(currentManifest())],{type:'text/plain'}),'BrainSNN_Street_Studio_Edited.usda');}else{download(new Blob([JSON.stringify(currentManifest(),null,2)],{type:'application/json'}),'BrainSNN_Street_Studio_Edited.json');}if(disposed)return;$('#export-state').textContent='Export prepared with current edits.';notify(kind.toUpperCase()+' export is ready.');}catch(e){if(disposed)return;$('#export-state').textContent='Export could not be prepared.';notify(e.message||'Export failed.',true);console.error(e);}finally{if(!disposed)button.disabled=false;}}
function validateEdits(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('This is not a supported scene edit file.');
  const out={};for(const [id,patch]of Object.entries(value)){
    const o=baseline.objects.find(x=>x.id===id);if(!o)throw Error('The edit file contains an unknown object ID.');if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Invalid object edit.');const n={};
    if(Object.keys(patch).some(k=>!['visible','material','transform','geometry'].includes(k)))throw Error('The edit file contains an unsupported object property.');
    if(patch.visible!==undefined){if(typeof patch.visible!=='boolean')throw Error('Visibility must be true or false.');n.visible=patch.visible;}
    if(patch.material!==undefined){if(!canColor(o))throw Error('This object does not support appearance edits.');if(!patch.material||typeof patch.material!=='object'||Array.isArray(patch.material)||Object.keys(patch.material).some(k=>k!=='color'))throw Error('Only the material tint can be imported.');const c=patch.material.color;if(!Array.isArray(c)||c.length!==3||c.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>1))throw Error('Material colors must be finite RGB values between zero and one.');n.material={color:clone(c)};}
    if(id!==baseline.barrier.id&&(patch.transform!==undefined||patch.geometry!==undefined))throw Error('Only the movable barrier supports geometry edits.');
    if(id===baseline.barrier.id){
      if(patch.transform!==undefined){const t=patch.transform;if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>!['position','rotation','scale'].includes(k)))throw Error('Invalid barrier transform.');if(t.position!==undefined&&(!Array.isArray(t.position)||t.position.length!==3||t.position.some(x=>!Number.isFinite(x))))throw Error('Barrier position is invalid.');if(t.rotation!==undefined&&(!Array.isArray(t.rotation)||t.rotation.length!==3||t.rotation.some(x=>!Number.isFinite(x))||t.rotation[0]!==0||t.rotation[2]!==0))throw Error('Only horizontal barrier rotation is supported.');if(t.scale!==undefined&&(!Array.isArray(t.scale)||t.scale.length!==3||t.scale.some(x=>x!==1)))throw Error('Change the barrier dimensions instead of its scale.');n.transform={...(t.position!==undefined?{position:clone(t.position)}:{}),...(t.rotation!==undefined?{rotation:clone(t.rotation)}:{}),scale:[1,1,1]};}
      if(patch.geometry!==undefined){if(!patch.geometry||typeof patch.geometry!=='object'||Array.isArray(patch.geometry)||Object.keys(patch.geometry).some(k=>!['type','dimensions'].includes(k))||patch.geometry.type!==undefined&&patch.geometry.type!=='box')throw Error('Only box barrier geometry can be imported.');const d=patch.geometry.dimensions;if(!Array.isArray(d)||d.length!==3||d.some(x=>!Number.isFinite(x))||d[0]<.3||d[0]>8||d[1]<.3||d[1]>3||d[2]<.2||d[2]>4)throw Error('Barrier dimensions are outside the supported range.');n.geometry={type:'box',dimensions:clone(d)};}
    }
    if(Object.keys(n).length)out[id]=n;
  }
  return out;
}
function applyEdits(value,{replace=false}={}){
  const checked=validateEdits(value),barrierPatch=checked[baseline.barrier.id],barrierEdit={id:baseline.barrier.id};
  if(barrierPatch?.transform)barrierEdit.transform=barrierPatch.transform;if(barrierPatch?.geometry)[barrierEdit.width,barrierEdit.height,barrierEdit.depth]=barrierPatch.geometry.dimensions;
  const changesBarrier=Object.keys(barrierEdit).length>1;
  // Validate every edit, including placement against the actors that will exist
  // after import, before resetting the scene or changing any appearance.
  if(changesBarrier){const live=sim.getState(),trial=createSimulation(createWorld(replace?baseline:scene),replace?{}:{start:live.robot.position,playerStart:live.player.position,goal:live.goal});trial.setBarrier(barrierEdit);}
  if(replace)resetAll({silent:true});
  if(changesBarrier){const result=sim.setBarrier(barrierEdit);syncBarrier(result,{persist:result.changed,inspect:false});}
  for(const [id,patch]of Object.entries(checked)){const appearance={};if(patch.material)appearance.material=patch.material;if(patch.visible!==undefined)appearance.visible=patch.visible;if(Object.keys(appearance).length)updateRecord(id,appearance);}
  view.setColliders?.(sim.colliders());renderInspector();refreshSimulation();
}
function wireEvents(){
  $('#object-search').oninput=renderTree;$('#object-tree').onclick=e=>{const b=e.target.closest('[data-object-id]');if(b)selectObject(b.dataset.objectId,{mobile:true});};$('#object-tree').ondblclick=e=>{const b=e.target.closest('[data-object-id]');if(b){selectObject(b.dataset.objectId,{focus:true});closePanels();}};
  $('#collapse-groups').onclick=()=>$$('#object-tree details').forEach(d=>d.open=false);$('#tab-objects').onclick=()=>choosePanel('objects');$('#tab-evidence').onclick=()=>choosePanel('evidence');$('#show-about').onclick=()=>choosePanel('evidence');
  $('#camera-orbit').onclick=()=>setMode('orbit');$('#camera-walk').onclick=()=>setMode('walk');$('#frame-view').onclick=()=>{setMode('orbit');view.resetCamera();};
  $('#show-context').onclick=()=>{contextMode=!contextMode;view.setLayerVisible('context',contextMode);$('#show-context').setAttribute('aria-pressed',contextMode);};
  $('#show-colliders').onclick=()=>{colliderMode=!colliderMode;view.setShowColliders(colliderMode);$('#show-colliders').setAttribute('aria-pressed',colliderMode);};$('#show-sources').onclick=()=>{sourceMode=!sourceMode;view.setSourceView(sourceMode);$('#show-sources').setAttribute('aria-pressed',sourceMode);$('#source-legend').hidden=!sourceMode;};
  for(const id of ['barrier-select','inspect-barrier-empty'])$('#'+id).onclick=()=>{setMode('orbit');selectObject(scene.barrier.id,{mobile:true});notify('Drag the ground arrows or adjust the position in the inspector.');};
  $('#robot-toggle').onclick=()=>{rememberTool('simulate',true);const s=sim.getState();if(s.running)sim.pauseRobot();else{if(s.status==='arrived'&&!resetRoute())return;sim.startRobot();}refreshSimulation();};$('#robot-reset').onclick=resetRoute;$('#reset-all').onclick=resetAll;
  $('#mobile-objects').onclick=()=>openPanel('objects');$('#mobile-inspector').onclick=()=>openPanel('inspector');$('#panel-backdrop').onclick=closePanels;$$('[data-close-panel]').forEach(b=>b.onclick=closePanels);
  $('#export-open').onclick=()=>openExport(true);listen($('#export-dialog'),'close',()=>{if(!$('#export-dialog').open&&activeTool==='export')rememberTool(previousTool,true);});$('#export-close').onclick=()=>$('#export-dialog').close();$('#export-dialog').onclick=e=>{if(e.target===$('#export-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};for(const kind of ['glb','usd','json'])$('#export-'+kind).onclick=()=>exportFile(kind);
  $('#import-scene').onchange=async e=>{
    const input=e.target,file=input.files[0],revision=++importRevision;if(!file)return;
    try{
      if(file.size>15000000)throw Error('Please choose an edit manifest under 15 MB.');
      const text=await file.text();if(disposed||revision!==importRevision)return;
      const data=JSON.parse(text);
      if(data.schemaVersion!==scene.schemaVersion||data.version!==scene.version)throw Error('This file belongs to a different scene version.');
      applyEdits(data.editor?.edits||data.edits,{replace:true});$('#export-dialog').close();notify('Scene edits imported with their original object IDs.');
    }catch(error){if(!disposed&&revision===importRevision)notify(error.message,true);}
    finally{if(!disposed&&revision===importRevision)input.value='';}
  };
  listen(window,'keydown',e=>{if(!effectiveActive()||!root.activeElement||!e.composedPath().includes(container))return;if(e.key==='Escape'){if(cameraMode==='walk')setMode('orbit');closePanels();keys.clear();return;}if(['INPUT','TEXTAREA','SELECT'].includes(root.activeElement?.tagName)||$('#export-dialog').open)return;if(e.key==='/'&&cameraMode!=='walk'){e.preventDefault();$('#object-search').focus();return;}const key=e.key.toLowerCase();if(cameraMode==='walk'&&['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){keys.add(key);e.preventDefault();}});
  listen(window,'keyup',e=>keys.delete(e.key.toLowerCase()));listen(window,'blur',()=>keys.clear());listen(document,'visibilitychange',()=>{keys.clear();syncActivity();});
  for(const button of $$('[data-walk]')){const key={forward:'w',back:'s',left:'a',right:'d'}[button.dataset.walk];button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(key);};for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(button,type,()=>keys.delete(key));}
  view.onLook=pose=>{look={...look,...pose};sim.setPlayerPose({yaw:look.yaw});};
  view.onObjectChange=(id,patch,{final}={})=>{if(id!==scene.barrier.id)return;const accepted=changeBarrier(patch,{silent:!final,inspect:!!final});if(!accepted&&final)renderInspector();};
}
function tick(time){
  animationFrame=0;if(!effectiveActive())return;
  const dt=lastFrame?Math.min((time-lastFrame)/1000,.1):0;lastFrame=time;
  if(cameraMode==='walk'&&keys.size){const forward=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0),right=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);sim.movePlayer({x:Math.sin(look.yaw)*forward-Math.cos(look.yaw)*right,z:Math.cos(look.yaw)*forward+Math.sin(look.yaw)*right},dt);view.setPlayerPose({...sim.getState().player,pitch:look.pitch});}
  const s=sim.step(dt);view.setRobotPose(s.robotPose);if(time-uiTime>100){refreshSimulation();uiTime=time;}animationFrame=requestAnimationFrame(tick);
}
async function init(){
  const response=await fetch(new URL('./assets/scene.json',import.meta.url),{signal:lifetime.signal});if(!response.ok)throw Error('Scene assets could not be loaded. Please reload this page.');baseline=await response.json();lifetime.signal.throwIfAborted();scene=clone(baseline);objects=new Map(scene.objects.map(o=>[o.id,o]));
  sim=createSimulation(createWorld(scene),{cellSize:scene.nav?.cellSize??.65,robotRadius:.42,playerRadius:.3});look.yaw=Math.atan2(scene.goal.x-scene.start.x,scene.goal.z-scene.start.z);sim.setPlayerPose({yaw:look.yaw});
  view=new SceneView($('#scene-canvas'),scene,id=>selectObject(id));surface.dataset.renderMode=view.renderMode;view.setPlayerPose(sim.getState().player);view.setColliders?.(sim.colliders());wireEvents();$('#object-count').textContent=scene.objects.length;renderTree();
  try{const stored=JSON.parse(localStorage.getItem(STORAGE)||'null');if(stored&&stored.schemaVersion===scene.schemaVersion&&stored.version===scene.version)applyEdits(stored.edits);}catch(error){console.warn('Stored edits could not be restored:',error.message);$('#save-state').textContent='Original scene · saved edits skipped';}
  refreshSimulation();$('#loading').hidden=true;syncActivity();
  emitChange();
}
  try{
    const [templateResponse,styleResponse]=await Promise.all([
      fetch(new URL('./template.html',import.meta.url),{signal:lifetime.signal}),
      fetch(new URL('./workspace.css',import.meta.url),{signal:lifetime.signal}),
    ]);
    if(!templateResponse.ok||!styleResponse.ok)throw Error('The scene workspace could not load. Please retry.');
    const [templateText,styleText]=await Promise.all([templateResponse.text(),styleResponse.text()]);
    lifetime.signal.throwIfAborted();
    const template=document.createElement('template');template.innerHTML=templateText;
    const stylesheet=document.createElement('style');stylesheet.textContent=styleText;
    root.replaceChildren(stylesheet,template.content.cloneNode(true));
    surface=$('.street-surface');
    if(!surface||['#scene-canvas','#object-tree','#export-dialog','#robot-toggle','#inspector-content'].some(selector=>!$(selector)))throw new Error('The street scene layout is incomplete. Reload the page or retry the scene.');
    for(const link of $$('[data-local-href]'))link.href=new URL(link.dataset.localHref,import.meta.url).href;
    await init();lifetime.signal.throwIfAborted();ready=true;
    lifetime.signal.addEventListener('abort',dispose,{once:true});
    emitChange();
    return {
      setActive(value){if(disposed)return;active=!!value;syncActivity();emitChange();},
      setTool(tool){
        if(!['edit','simulate','evidence','export'].includes(tool))throw new Error('Unknown street workspace tool.');
        if(disposed||!active)return;
        if(tool==='export'){openExport(false);return;}
        closeExport(false);rememberTool(tool,false);
        if(tool==='evidence'){setTab('evidence');if(matchMedia('(max-width:740px)').matches)openPanel('objects');}
        else if(tool==='edit'){setTab('objects');setMode('orbit');if(matchMedia('(max-width:740px)').matches)openPanel('objects');}
        else if(tool==='simulate'){setTab('objects');closePanels();setMode('orbit');$('#robot-toggle').focus({preventScroll:true});}
      },
      getState,getManifest:currentManifest,exportFile,dispose,
    };
  }catch(error){dispose();throw error;}
}
