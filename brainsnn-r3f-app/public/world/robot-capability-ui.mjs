import {createRobotCapability,normalizeRobotCapability} from './robot-capability.mjs';
import {buildReviewedMapEpisodeScene} from './reviewed-map-episode.mjs';
import {mountShowroomRun} from './showroom-run-ui.mjs';
import {analyzeDrive} from './robot-drive-analysis.mjs';
import {GENERIC_ARM_PROFILE,solveArmTarget} from './robot-arm.mjs';
import {quaternionFromEuler,normalizePose,normalizeQuaternion,invertTransform,transformPoint} from './robot-frames.mjs';
import {parseRobotTelemetry,compareRobotTelemetry,calibrateWheelScale} from './robot-telemetry.mjs';
import {planningGate} from './core.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(value,digits=2)=>Number.isFinite(value)?value.toFixed(digits):'Unavailable';
const clone=value=>structuredClone(value);
const input=(key,label,value,min,max,step=.01)=>`<label>${label}<input data-cap-field="${key}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
const optional=(key,label)=>`<label>${label}<input data-cap-motor="${key}" type="number" min="0" step="any" placeholder="Unknown"></label>`;
const list=items=>`<ul>${items.map(item=>`<li>${esc(typeof item==='string'?item:JSON.stringify(item))}</li>`).join('')}</ul>`;
const fact=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;

export function robotCapabilityMarkup(){return `<div class="cap-workbench">
  <header class="cap-heading"><div><p class="cap-eyebrow">Robot capability</p><h3>From a route to a test you can check</h3><p>Use one robot profile for your map, physics recording and comparison with a real run.</p></div><span class="cap-badge" data-cap-basis>Authored assumptions</span></header>
  <dl class="cap-summary" data-cap-summary></dl>
  <details class="cap-profile" data-cap-profile><summary>Robot dimensions, drivetrain and motor settings</summary>
    <p class="cap-note">The starting values are a wheeled example derived from your selected footprint. Enter the actual robot’s specifications before drawing conclusions about hardware.</p>
    <div class="cap-fields"><label>Profile name<input data-cap-name type="text" maxlength="160"></label><label>Drivetrain<select data-cap-drive><option value="differential">Differential · two driven wheels</option><option value="holonomic">Holonomic · planar approximation</option></select></label></div>
    <div class="cap-fields">${input('width','Body width · m',.58,.1,5)}${input('depth','Body depth · m',.68,.1,5)}${input('height','Body height · m',.58,.08,4)}${input('massKg','Body mass · kg',20,.1,3000,.1)}${input('payloadKg','Payload · kg',0,0,2000,.1)}${input('marginM','Extra clearance · m',.1,0,2)}${input('speedMps','Maximum speed · m/s',.3,.01,3)}${input('yawRateRps','Maximum turning rate · rad/s',1.2,.05,6)}${input('accelerationMps2','Acceleration · m/s²',.6,.02,10)}${input('brakingMps2','Braking · m/s²',.8,.02,15)}${input('latencySeconds','Command delay · seconds',0,0,2)}${input('wheelRadiusM','Wheel radius · m',.075,.015,.5)}${input('wheelSeparationM','Wheel separation · m',.42,.06,4.9)}</div>
    <details><summary>Optional motor, driver and thermal model</summary><p class="cap-note">Enter supplied or measured parameters per motor. Leave this section blank when they are unknown. Transmission efficiency describes the gearbox and drivetrain.</p>
      <div class="cap-fields">${optional('voltageV','Supply voltage · V')}${optional('currentLimitA','Motor current limit · A')}${optional('torqueConstantNmPerA','Torque constant · N m/A')}${optional('resistanceOhm','Motor resistance · Ω')}${optional('gearRatio','Gear ratio')}${optional('efficiency','Transmission efficiency · 0–1')}${optional('backEmfVPerRadPerSecond','Back-EMF constant · V/(rad/s)')}${optional('noLoadCurrentA','No-load current · A')}${optional('driverResistanceOhm','Driver conduction resistance · Ω')}${optional('auxiliaryPowerW','Computers and sensors · W')}${optional('thermalResistanceKPerW','Thermal resistance · K/W')}${optional('thermalCapacityJPerK','Thermal capacity · J/K')}${optional('ambientC','Ambient temperature · °C')}${optional('temperatureLimitC','Motor temperature limit · °C')}</div>
      <p class="cap-note">The model estimates current, voltage demand and heating from recorded wheel torque. MOSFET switching and commutation are outside this model.</p>
    </details>
    <label>Parameter source or measurement notes<textarea data-cap-evidence rows="2" maxlength="2000" placeholder="For example: chassis measured on site; motor constants from the manufacturer’s datasheet."></textarea></label>
    <div class="cap-actions"><button type="button" class="primary" data-cap-apply>Apply robot profile</button><button type="button" data-cap-current-profile>Use selected robot</button><button type="button" data-cap-export-profile>Download profile</button><label class="cap-file">Import profile JSON<input data-cap-import-profile type="file" accept=".json,application/json"></label></div><p data-cap-profile-status class="cap-note" role="status"></p>
  </details>
  <div class="cap-tabs" role="tablist" aria-label="Robot checks">${[['route','Drive a route'],['arm','Reach a target'],['compare','Compare a real run']].map(([id,title],i)=>`<button type="button" id="cap-tab-${id}" data-cap-view="${id}" role="tab" aria-controls="cap-panel-${id}" aria-selected="${i===0}" tabindex="${i===0?0:-1}">${title}</button>`).join('')}</div>
  <section id="cap-panel-route" role="tabpanel" aria-labelledby="cap-tab-route">
    <div class="cap-section-head"><h4>Test the route in physics</h4><p data-cap-map>Open a reviewed map to prepare a route.</p></div>
    <div class="cap-fields cap-goal">${input('goalX','Goal X on the map · m',8,0,80,.1)}${input('goalZ','Goal Z on the map · m',5,0,80,.1)}<button type="button" class="primary" data-cap-prepare>Apply profile and prepare route</button></div>
    <p class="cap-note" data-cap-frozen>Choose a goal on the current map. The recording keeps a copy of the map and robot profile.</p>
    <div data-cap-recorder></div>
    <section class="cap-analysis" data-cap-drive-result hidden><h4>Drive, electrical and thermal results</h4><dl class="cap-metrics" data-cap-drive-metrics></dl><div data-cap-drive-notes></div><svg data-cap-motor-chart viewBox="0 0 640 180" role="img" aria-label="Modelled motor current over recording time" hidden></svg></section>
  </section>
  <section id="cap-panel-arm" role="tabpanel" aria-labelledby="cap-tab-arm" hidden>
    <div class="cap-section-head"><h4>Can the arm reach this pose?</h4><p>A generic six-joint arm checks the target, joint limits and a sampled joint-space path against link capsules and box obstacles. This is a kinematic check.</p></div>
    <div class="cap-split"><div><div class="cap-fields">${input('targetX','Forward X · m',.48,-2,2)}${input('targetY','Left Y · m',.12,-2,2)}${input('targetZ','Height Z · m',.46,-1,3)}${input('roll','Roll · degrees',0,-180,180,1)}${input('pitch','Pitch · degrees',0,-180,180,1)}${input('yaw','Yaw · degrees',0,-180,180,1)}</div>
      <label class="cap-check"><input data-cap-map-obstacles type="checkbox" checked>Include map obstacle proxies at the robot start</label><p class="cap-note">Map proxies use an assumed height of 0.5 m. Targets use a right-handed robot frame: X forward, Y left, Z up. A completed route supplies the initial body pose and frozen map. Before a route, the base is assumed at the current map’s start, facing +X at floor height.</p>
      <div class="cap-actions"><button type="button" class="primary" data-cap-arm-solve>Check target and path</button><button type="button" data-cap-arm-example>Load reachable example</button></div>
      <details><summary>Arm geometry and starting joints</summary><p class="cap-note">Edit the example joint chain to match your mechanism. Link dimensions and joint limits are retained in the report.</p><label>Arm profile JSON<textarea data-cap-arm-profile rows="9" spellcheck="false"></textarea></label><label>Starting joint angles · radians<textarea data-cap-arm-start rows="2" spellcheck="false"></textarea></label></details>
    </div><figure class="cap-arm-figure"><svg data-cap-arm-svg viewBox="0 0 480 360" role="img" aria-label="Robot arm and target in a projected 3D view"></svg><figcaption>Cyan: checked arm configuration. Amber: target. Boxes: obstacle proxies.</figcaption></figure></div>
    <p data-cap-arm-status role="status">Load the reachable example, then check the target and path.</p><dl class="cap-metrics" data-cap-arm-metrics></dl><div data-cap-arm-reasons></div><label class="cap-arm-seek" hidden>Inspect path step<input data-cap-arm-step type="range" min="0" max="0" value="0" step="1"></label>
  </section>
  <section id="cap-panel-compare" role="tabpanel" aria-labelledby="cap-tab-compare" hidden>
    <div class="cap-section-head"><h4>Compare a prediction with a robot recording</h4><p>Load positions or encoder data, declare the frame and units, then align the clocks. A comparison needs a completed physics recording above.</p></div>
    <div class="cap-fields"><label>Robot telemetry · CSV or JSON<input data-cap-telemetry type="file" accept=".csv,.json,text/csv,application/json"></label><label>Coordinates<select data-cap-convention><option value="ros">ROS · Z up, quaternion XYZW</option><option value="world-y-up">World Builder · Y up, XYZW</option><option value="mujoco">MuJoCo · Z up, WXYZ</option></select></label><label>Length unit<select data-cap-length><option value="m">Metres</option><option value="mm">Millimetres</option></select></label><label>Time unit<select data-cap-time><option value="s">Seconds</option><option value="ms">Milliseconds</option></select></label><label>Angle unit<select data-cap-angle><option value="rad">Radians</option><option value="deg">Degrees</option></select></label><label>Telemetry frame name<input data-cap-frame value="map" maxlength="96"></label>${input('timeOffset','Add to telemetry time · seconds',0,-86400,86400,.001)}</div>
    <details><summary>Measured alignment to the map</summary><p class="cap-note">Supply the telemetry-frame origin in the map’s canonical Z-up coordinates. An identity transform is appropriate only when the frames already coincide.</p><div class="cap-fields">${input('alignX','Map X translation · m',0,-100000,100000)}${input('alignY','Map Y translation · m',0,-100000,100000)}${input('alignZ','Map Z translation · m',0,-100000,100000)}${input('alignYaw','Map yaw · degrees',0,-180,180,1)}</div><label>Alignment evidence<input data-cap-alignment-note maxlength="500" placeholder="Survey control points, map registration receipt or shared frame declaration"></label></details>
    <label class="cap-check"><input data-cap-registered type="checkbox">I checked this log’s spatial alignment to the recorded map</label><label class="cap-check"><input data-cap-time-confirmed type="checkbox">I checked the clock offset and matched the start of this task</label><label class="cap-check"><input data-cap-held-out type="checkbox">This is an independent run held out from parameter tuning</label>
    <div class="cap-actions"><button type="button" class="primary" data-cap-compare>Compare recording</button><button type="button" data-cap-template>Download CSV template</button></div>
    <p data-cap-telemetry-status role="status">No telemetry loaded.</p><dl class="cap-metrics" data-cap-comparison-metrics></dl><svg data-cap-comparison-svg viewBox="0 0 640 320" role="img" aria-label="Predicted and observed robot paths" hidden></svg><div data-cap-comparison-notes></div>
    <details class="cap-encoders"><summary>Wheel encoders and a calibration proposal</summary><p class="cap-note">Wheel angles are recorded measurements; a motion command is shown separately in the evidence bundle. CSV wheel angles use leftEncoderRad and rightEncoderRad in radians.</p><svg data-cap-encoder-svg viewBox="0 0 640 210" role="img" aria-label="Imported left and right wheel encoder angles" hidden></svg><p data-cap-encoder-status>No wheel measurements loaded.</p><label class="cap-check"><input data-cap-independent type="checkbox">The positions are from an independent reference, separate from wheel odometry</label><p class="cap-note">For a wheel-radius fit, the JSON source must also declare referenceIndependent: true and poseSource: independent-reference. The proposal never changes the robot automatically; evaluate it on another run.</p><button type="button" data-cap-calibrate>Propose a wheel-radius correction</button><p data-cap-calibration-status role="status"></p></details>
  </section>
  <footer class="cap-footer"><div><strong>Keep the test and its evidence together</strong><p class="cap-note">The report retains assumptions, frame declarations and source hashes. Simulation and kinematics remain labelled as model results.</p></div><div class="cap-actions"><button type="button" data-cap-report>Download evidence bundle</button><button type="button" data-cap-save>Add test summary to a project</button></div></footer>
  <p data-cap-status role="status"></p>
</div>`;}

function download(value,name,type='application/json'){
  const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function sha(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}

/** Native activity; no hardware control or worker credentials are stored in reports. */
export function mountRobotCapability({root,getWorld,getRobotProfile,getMapSource=()=>null,onApplyProfile=()=>{},saveToProject}){
  const $=selector=>root.querySelector(selector),abort=new AbortController();
  let disposed=false,revision=0,profileLoad=0,telemetryLoad=0,profile=createRobotCapability(),lastExternal='',dirty=false,recorder=null,episode=null,trialSource=null;
  let drive=null,arm=null,armInput=null,telemetry=null,telemetryText=null,telemetryName='',telemetryHash=null,comparison=null,calibration=null;
  const calibrationSources=new Set();
  const number=key=>{const field=$(`[data-cap-field="${key}"]`),value=field.valueAsNumber;if(!Number.isFinite(value)||(field.min!==''&&value<Number(field.min))||(field.max!==''&&value>Number(field.max)))throw Error(`Check ${field.parentElement.textContent.trim()}.`);return value;};
  function status(message,error=false){$('[data-cap-status]').textContent=message;$('[data-cap-status]').classList.toggle('error',error);}
  const attempt=fn=>Promise.resolve().then(fn).catch(error=>{if(!disposed)status(error.message,true);});
  function fillProfile(value){
    calibration=null;$('[data-cap-calibration-status]').textContent='';
    profile=normalizeRobotCapability(value);$('[data-cap-name]').value=profile.name;$('[data-cap-drive]').value=profile.drive.kind;
    const fields={...profile.body,...profile.limits,...profile.drive,marginM:profile.marginM};
    for(const [key,value] of Object.entries(fields)){const node=$(`[data-cap-field="${key}"]`);if(node)node.value=value;}
    for(const node of root.querySelectorAll('[data-cap-motor]'))node.value=profile.motor?.[node.dataset.capMotor]??'';
    $('[data-cap-evidence]').value='';dirty=false;$('[data-cap-profile-status]').textContent='These settings are shared with the map planner.';renderSummary();
  }
  function readProfile(){
    const next=clone(profile);next.name=$('[data-cap-name]').value.trim();next.drive.kind=$('[data-cap-drive]').value;
    for(const key of ['width','depth','height','massKg','payloadKg'])next.body[key]=number(key);
    for(const key of ['speedMps','yawRateRps','accelerationMps2','brakingMps2','latencySeconds'])next.limits[key]=number(key);
    for(const key of ['wheelRadiusM','wheelSeparationM'])next.drive[key]=number(key);next.marginM=number('marginM');
    const motor={};for(const field of root.querySelectorAll('[data-cap-motor]'))if(field.value!==''){if(!Number.isFinite(field.valueAsNumber))throw Error('Motor parameters must be finite numbers.');motor[field.dataset.capMotor]=field.valueAsNumber;}
    next.motor=Object.keys(motor).length?motor:null;
    if(dirty){next.basis='user-entered';next.source={...next.source,physicalModelMatched:false};const note=$('[data-cap-evidence]').value.trim();next.evidence=[...next.evidence.slice(-62),{kind:'user-entered',field:'profile',note:note||'Edited in Robot capability; independently verify the supplied parameters.'}];}
    return normalizeRobotCapability(next);
  }
  function applyProfile(){const next=readProfile();profile=next;dirty=false;lastExternal=JSON.stringify(next);onApplyProfile(clone(next));fillProfile(next);status('Robot profile applied to the planner. Previous recordings keep their original profile.');return next;}
  function renderSummary(){
    const p=profile;$('[data-cap-summary]').innerHTML=fact('Robot',p.name)+fact('Footprint',`${fmt(p.body.width)} × ${fmt(p.body.depth)} m`)+fact('Drive',p.drive.kind==='differential'?'Differential':'Holonomic approximation')+fact('Speed limit',`${fmt(p.limits.speedMps)} m/s`);
    $('[data-cap-basis]').textContent=p.basis==='assumed'?'Authored assumptions':`${p.basis} parameters`;
  }
  function show(view){for(const button of root.querySelectorAll('[data-cap-view]')){const selected=button.dataset.capView===view;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}for(const name of ['route','arm','compare'])$(`#cap-panel-${name}`).hidden=name!==view;if(view!=='route')recorder?.pause();}
  function refresh(){
    if(disposed)return;
    const external=normalizeRobotCapability(getRobotProfile?.()??profile),signature=JSON.stringify(external);
    if(signature!==lastExternal){lastExternal=signature;if(!dirty)fillProfile(external);else $('[data-cap-profile-status]').textContent='The main robot selection changed. Apply this draft to use it, or choose Use selected robot to load the current profile.';}
    const world=getWorld?.();$('[data-cap-map]').textContent=world?`${world.name} · ${fmt(world.width,1)} × ${fmt(world.depth,1)} m · ${planningGate(world)||'Reviewed for route planning'}`:'Open a reviewed map in the workspace first.';
    $('[data-cap-prepare]').disabled=!world;
    if(world){$('[data-cap-field="goalX"]').max=world.width;$('[data-cap-field="goalZ"]').max=world.depth;}
    if(trialSource){const changed=JSON.stringify(world)!==JSON.stringify(trialSource.world)||JSON.stringify(external)!==JSON.stringify(trialSource.robotCapability);$('[data-cap-frozen]').textContent=changed?'The map or profile has changed. This recording still refers to its earlier snapshot. Prepare a new route to test the changes.':`Prepared with ${trialSource.robotCapability.name}. The recording and analysis retain this exact map and profile.`;}
  }
  function driveResult(){
    if(!episode)return;drive=analyzeDrive(trialSource.robotCapability,episode);$('[data-cap-drive-result]').hidden=false;
    const m=drive.metrics;$('[data-cap-drive-metrics]').innerHTML=fact('Wheel work',`${fmt(m.mechanicalEnergyWh,4)} Wh`)+fact('Modelled peak current',Number.isFinite(m.maximumMotorCurrentA)?`${fmt(m.maximumMotorCurrentA)} A`:'Needs motor constants')+fact('Modelled peak temperature',Number.isFinite(m.maximumModelledTemperatureC)?`${fmt(m.maximumModelledTemperatureC,1)} °C`:'Needs thermal constants')+fact('Limit exceedances',drive.violations.length)+fact('Covered duration',`${fmt(m.coveredSeconds,1)} s`);
    $('[data-cap-drive-notes]').innerHTML=`<details><summary>Assumptions and unavailable results</summary>${list([...drive.unavailable,...drive.assumptions])}</details>${drive.violations.length?`<p class="cap-warning">The model exceeded at least one supplied limit. Inspect the evidence bundle for sample times and affected wheels.</p>`:''}`;
    drawSeries($('[data-cap-motor-chart]'),drive.series.filter(p=>p.currentA).map(p=>[p.t,Math.max(...p.currentA)]),'Modelled peak motor current · A');
  }
  function prepare(){
    const world=getWorld?.();if(!world)throw Error('Open a reviewed map first.');const chosen=applyProfile();
    const scene=buildReviewedMapEpisodeScene(world,{x:number('goalX'),z:number('goalZ')},getMapSource?.(),chosen);
    revision++;recorder?.dispose();episode=null;drive=null;comparison=null;trialSource={world:clone(world),robotCapability:clone(chosen),goal:{x:number('goalX'),z:number('goalZ')},createdAt:new Date().toISOString()};
    $('[data-cap-drive-result]').hidden=true;clearComparison();const details=document.createElement('details');details.className='showroom-run';details.open=true;$('[data-cap-recorder]').replaceChildren(details);
    const [x0,z0,x1,z1]=scene.bounds,scale=Math.min(468/(x1-x0),258/(z1-z0)),project=(x,z)=>[250+(x-(x0+x1)/2)*scale,145+(z-(z0+z1)/2)*scale];const token=revision;
    recorder=mountShowroomRun(details,null,{initialScene:scene,project,onReset:()=>{if(disposed||token!==revision)return;episode=drive=comparison=null;$('[data-cap-drive-result]').hidden=true;clearComparison();},onComplete:value=>{if(disposed||token!==revision)return;episode=value;comparison=null;clearComparison();try{driveResult();status('Physics recording complete. Review drive results or load telemetry to compare a real run.');}catch(error){status(error.message,true);}}});
    refresh();status('Route ready. Choose a driver and record the physics run.');
  }
  function armContext(){
    const frame=episode?.frames?.[0],world=frame&&trialSource?trialSource.world:getWorld?.();
    const pose=normalizePose({frameId:'map',childFrameId:'base_link',position:frame?.positionXYZ??[world?.start.x??0,-(world?.start.z??0),frame?.heightMeters??0],orientation:frame?.quaternionWxyz?normalizeQuaternion(frame.quaternionWxyz,'wxyz'):{x:0,y:0,z:0,w:1}});
    return {world,pose,basis:frame?'Initial body pose and frozen map from the completed simulation.':'Authored base at current map start; heading +X and origin at floor height are assumed.'};
  }
  function mapObstacles(context){
    const {world,pose}=context;if(!$('[data-cap-map-obstacles]').checked||!world)return [];
    const transform=invertTransform(pose);
    return world.objects.map(item=>{
      const corners=[];for(const x of [item.x,item.x+item.w])for(const y of [-item.z,-item.z-item.d])for(const z of [0,.5])corners.push(transformPoint(transform,{x,y,z}));
      return {id:item.id,min:['x','y','z'].map(k=>Math.min(...corners.map(p=>p[k]))),max:['x','y','z'].map(k=>Math.max(...corners.map(p=>p[k])))};
    });
  }
  function armTarget(){return normalizePose({frameId:'base_link',childFrameId:'tool_target',position:{x:number('targetX'),y:number('targetY'),z:number('targetZ')},orientation:quaternionFromEuler(number('roll')*Math.PI/180,number('pitch')*Math.PI/180,number('yaw')*Math.PI/180)});}
  function solveArm(){
    if($('[data-cap-arm-profile]').value.length>65536)throw Error('Use an arm profile under 64 KiB.');
    const armProfile=JSON.parse($('[data-cap-arm-profile]').value),startJoints=JSON.parse($('[data-cap-arm-start]').value),target=armTarget(),context=armContext(),obstacles=mapObstacles(context);
    if(armProfile.basePose?.frameId!=='base_link')throw Error('Express this arm profile in base_link, the same local frame as the target and map proxies.');
    armInput={profile:armProfile,target,startJoints,obstacles,baseRegistration:{pose:context.pose,basis:context.basis,sceneSha256:episode?.sceneSha256??null},obstacleBasis:'Map rectangles extruded to assumed 0.5 m boxes, transformed into base_link and conservatively enclosed by local axis-aligned boxes. No measured 3D collision geometry or chassis collider.',mapName:context.world?.name??null};
    arm=solveArmTarget(armProfile,target,{startJoints,obstacles});
    const good=arm.reachable&&arm.configurationValid&&arm.pathValid;$('[data-cap-arm-status]').textContent=good?'Target reached; joint limits and the sampled path passed the supplied proxy collision checks.':'The target or path did not pass every check. Review the reasons below.';
    $('[data-cap-arm-status]').classList.toggle('error',!good);
    $('[data-cap-arm-metrics]').innerHTML=fact('Target pose',arm.reachable?'Reached':'Not reached')+fact('Configuration',arm.configurationValid?'Valid':'Invalid')+fact('Sampled path',arm.pathValid?'Valid':'Blocked or unavailable')+fact('Position error',`${fmt(arm.positionErrorM,4)} m`)+fact('Orientation error',`${fmt(arm.orientationErrorRad,3)} rad`);
    $('[data-cap-arm-reasons]').innerHTML=list([...(arm.reasons||[]),'Dynamics, motor torque, contact force and hardware execution are not validated by this kinematic check.']);
    const slider=$('[data-cap-arm-step]');slider.max=Math.max(0,(arm.path?.length??0)-1);slider.value=slider.max;slider.parentElement.hidden=!arm.path?.length;drawArm(arm.path?.at(-1)?.points??arm.points,target.position,obstacles);status('Arm check saved in the evidence bundle.');
  }
  function clearComparison(){$('[data-cap-comparison-metrics]').replaceChildren();$('[data-cap-comparison-notes]').replaceChildren();$('[data-cap-comparison-svg]').setAttribute('hidden','');}
  function parseTelemetry(){
    if(!telemetryText)throw Error('Choose a telemetry CSV or JSON file first.');
    telemetry=parseRobotTelemetry(telemetryText,{format:telemetryName.toLowerCase().endsWith('.csv')?'csv':'json',sourceId:`sha256:${telemetryHash}`,frameId:$('[data-cap-frame]').value.trim(),convention:$('[data-cap-convention]').value,lengthUnit:$('[data-cap-length]').value,timeUnit:$('[data-cap-time]').value,angleUnit:$('[data-cap-angle]').value,referenceIndependent:$('[data-cap-independent]').checked});
    drawEncoders();
    return telemetry;
  }
  function loadTelemetryOptions(source,name){
    let meta={};if(name.toLowerCase().endsWith('.json')){try{const parsed=JSON.parse(source);if(parsed&&!Array.isArray(parsed))meta=parsed;}catch{throw Error('Telemetry is not valid JSON.');}}
    const native=String(meta.schema||'').startsWith('brainsnn.localization-'),settings=[['[data-cap-convention]',native?'ros':meta.convention??'ros',['ros','world-y-up','mujoco']],['[data-cap-length]',native?'m':meta.units?.length??'m',['m','mm']],['[data-cap-time]',native?'s':meta.units?.time??'s',['s','ms']],['[data-cap-angle]',native?'rad':meta.units?.angle??'rad',['rad','deg']]];
    for(const [selector,value,allowed] of settings){if(!allowed.includes(value))throw Error(`Unsupported telemetry metadata value: ${value}.`);$(selector).value=value;}
    $('[data-cap-frame]').value=meta.frameId??meta.binding?.mapFrame??'map';
    for(const key of ['timeOffset','alignX','alignY','alignZ','alignYaw'])$(`[data-cap-field="${key}"]`).value=0;
    $('[data-cap-alignment-note]').value='';
  }
  function compare(){
    if(!episode)throw Error('Complete a physics recording before comparing a real run.');parseTelemetry();
    const frame=telemetry.frameId||$('[data-cap-frame]').value.trim();
    const position={x:number('alignX'),y:number('alignY'),z:number('alignZ')},yaw=number('alignYaw');
    if(frame==='map'&&(position.x||position.y||position.z||yaw))throw Error('Give the telemetry frame a distinct name, such as robot_map, before applying a nonidentity alignment to map.');
    const registration={confirmed:$('[data-cap-registered]').checked,sourceId:telemetry.sourceId,frameId:'map',evidence:$('[data-cap-alignment-note]').value.trim(),transform:frame==='map'?undefined:{frameId:'map',childFrameId:frame,position,orientation:quaternionFromEuler(0,0,yaw*Math.PI/180)}};
    comparison=compareRobotTelemetry(episode,telemetry,{registration,timeOffsetSeconds:number('timeOffset'),timeAlignmentConfirmed:$('[data-cap-time-confirmed]').checked,heldOut:$('[data-cap-held-out]').checked,calibrationSourceIds:[...calibrationSources]});
    const m=comparison.metrics||{};$('[data-cap-comparison-metrics]').innerHTML=fact('Matched samples',comparison.matchedSamples??0)+fact('Position sample coverage',`${fmt((comparison.coverage??0)*100,1)}%`)+fact('Position RMSE',Number.isFinite(m.positionErrorM?.rms)?`${fmt(m.positionErrorM.rms,3)} m`:'Needs registered positions')+fact('Orientation RMSE',Number.isFinite(m.orientationErrorRad?.rms)?`${fmt(m.orientationErrorRad.rms,3)} rad`:'Needs orientation evidence');
    $('[data-cap-comparison-notes]').innerHTML=list(comparison.issues||[]);$('[data-cap-telemetry-status]').textContent=`${telemetryName} · ${telemetry.samples?.length??0} samples · ${comparison.status}. Imported evidence remains operator supplied.`;
    drawComparison();status('Comparison completed. The report retains time alignment, frame transform and telemetry source hash.');
  }
  function report({summary=false}={}){
    return {schema:'brainsnn.robot-capability-report.v1',createdAt:new Date().toISOString(),physicalValidated:false,
      activeProfile:clone(profile),trialSource:trialSource?clone(trialSource):null,
      recording:episode?(summary?{schema:episode.schema,engine:episode.engine,provenance:episode.provenance,score:episode.score,controller:episode.controller,frameCount:episode.frames?.length,robotCapability:episode.robotCapability,capabilitySha256:episode.capabilitySha256,sceneSha256:episode.sceneSha256,frameConvention:episode.frameConvention}:clone(episode)):null,
      drive:drive?(summary?{...drive,series:undefined,violations:drive.violations.slice(0,100)}:clone(drive)):null,
      arm:arm?{input:clone(armInput),result:summary?{...arm,path:undefined}:clone(arm)}:null,
      telemetry:telemetry?{sourceName:telemetryName,sha256:telemetryHash,recording:summary?undefined:clone(telemetry)}:null,
      comparison:comparison?(summary?{...comparison,pairs:undefined}:clone(comparison)):null,
      wheelCalibration:calibration?clone(calibration):null,calibrationSourceIds:[...calibrationSources],
      limitations:['Wheeled physics, motor and arm checks depend on their supplied parameters and proxy geometry.','An imported robot log and a comparison do not certify hardware performance.','The project summary omits dense recording samples; retain the full evidence bundle alongside it.']};
  }
  function drawArm(points,target,obstacles=[]){
    const svg=$('[data-cap-arm-svg]'),toArray=p=>Array.isArray(p)?p:[p.x,p.y,p.z],project=p=>{const [x,y,z]=toArray(p);return [220+150*x-95*y,300-175*z-42*x-35*y];};
    const line=(a,b,colour,width=1)=>`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${colour}" stroke-width="${width}"/>`;
    let content='';for(let n=-4;n<=4;n++)content+=line(project([n*.2,-.8,0]),project([n*.2,.8,0]),'#253f50')+line(project([-.8,n*.2,0]),project([.8,n*.2,0]),'#253f50');
    for(const box of obstacles){const a=box.min,b=box.max,corners=[[a[0],a[1],a[2]],[b[0],a[1],a[2]],[b[0],b[1],a[2]],[a[0],b[1],a[2]],[a[0],a[1],b[2]],[b[0],a[1],b[2]],[b[0],b[1],b[2]],[a[0],b[1],b[2]]];for(const [i,j] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]])content+=line(project(corners[i]),project(corners[j]),'#b28662',1.5);}
    if(points?.length){const projected=points.map(project);for(let i=1;i<projected.length;i++)content+=line(projected[i-1],projected[i],'#6ae4eb',8);for(const [x,y] of projected)content+=`<circle cx="${x}" cy="${y}" r="5" fill="#c9fbff"/>`;}
    if(target){const [x,y]=project(target);content+=`<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#ffc376" stroke-width="3"/><path d="M ${x-14} ${y}h28 M ${x} ${y-14}v28" stroke="#ffc376"/>`;}
    svg.innerHTML=`${content}<text x="18" y="27" fill="#9cb4ca" font-size="13">Z up · metres · generic arm</text>`;
  }
  function drawComparison(){
    const svg=$('[data-cap-comparison-svg]');
    const pairs=comparison?.pairs??[],predicted=pairs.map(p=>[p.predicted.x,p.predicted.y]),actual=pairs.map(p=>[p.observed.x,p.observed.y]);
    if(!pairs.length||comparison?.status!=='compared'){svg.setAttribute('hidden','');return;}
    const all=[...predicted,...actual],xmin=Math.min(...all.map(p=>p[0])),xmax=Math.max(...all.map(p=>p[0])),ymin=Math.min(...all.map(p=>p[1])),ymax=Math.max(...all.map(p=>p[1]));
    const scale=Math.min(590/Math.max(.1,xmax-xmin),250/Math.max(.1,ymax-ymin)),path=rows=>rows.map(([x,y])=>`${25+(x-xmin)*scale},${280-(y-ymin)*scale}`).join(' ');
    const spans=[];let start=0;for(let i=1;i<=pairs.length;i++)if(i===pairs.length||pairs[i].t-pairs[i-1].t>.5){spans.push([start,i]);start=i;}
    svg.innerHTML=spans.map(([a,b])=>`<polyline points="${path(predicted.slice(a,b))}" fill="none" stroke="#6ae4eb" stroke-width="3"/><polyline points="${path(actual.slice(a,b))}" fill="none" stroke="#ffc376" stroke-width="2"/>`).join('')+'<text x="20" y="22" fill="#6ae4eb" font-size="14">Matched prediction</text><text x="195" y="22" fill="#ffc376" font-size="14">Matched imported positions</text>';svg.removeAttribute('hidden');
  }
  function drawEncoders(){
    const svg=$('[data-cap-encoder-svg]'),samples=telemetry?.samples.filter(s=>s.encoder?.wheelPositionRad)??[];
    $('[data-cap-encoder-status]').textContent=samples.length?`${samples.length} samples with measured left and right wheel angles. Position accuracy requires a separate registered pose reference.`:'This file has no paired wheel-angle measurements. Position and command channels remain separate.';
    if(samples.length<2){svg.setAttribute('hidden','');return;}
    const t0=samples[0].t,dt=Math.max(.001,samples.at(-1).t-t0),values=samples.flatMap(s=>s.encoder.wheelPositionRad),lo=Math.min(...values),hi=Math.max(...values),range=Math.max(.01,hi-lo);
    const points=(rows,index)=>rows.map(s=>`${30+580*(s.t-t0)/dt},${170-120*(s.encoder.wheelPositionRad[index]-lo)/range}`).join(' ');
    const spans=[];let start=0;for(let i=1;i<=samples.length;i++)if(i===samples.length||samples[i].t-samples[i-1].t>1){spans.push(samples.slice(start,i));start=i;}
    svg.innerHTML=spans.map(rows=>[0,1].map(i=>`<polyline points="${points(rows,i)}" fill="none" stroke="${i?'#ffc376':'#6ae4eb'}" stroke-width="${i?2:3}"/>`).join('')).join('')+`<text x="20" y="25" fill="#6ae4eb" font-size="14">Left wheel · rad</text><text x="200" y="25" fill="#ffc376" font-size="14">Right wheel · rad</text><text x="20" y="200" fill="#9cb4ca" font-size="12">${fmt(t0,1)}–${fmt(samples.at(-1).t,1)} seconds · ${fmt(lo)}–${fmt(hi)} radians</text>`;svg.removeAttribute('hidden');
  }
  root.addEventListener('input',event=>{if(event.target.closest('[data-cap-profile]')){dirty=true;$('[data-cap-profile-status]').textContent='Draft changed. Apply the profile to update the planner and future trials.';}if(event.target.closest('#cap-panel-compare')){comparison=calibration=null;clearComparison();$('[data-cap-calibration-status]').textContent='';}if(event.target.matches('[data-cap-arm-step]')&&arm){const item=arm.path[Number(event.target.value)];drawArm(item.points,armInput.target.position,armInput.obstacles);}else if(event.target.closest('#cap-panel-arm')&&arm){$('[data-cap-arm-status]').textContent='Arm settings changed. Check the target again; the saved report still contains the previous check.';}},{signal:abort.signal});
  root.addEventListener('keydown',event=>{const tab=event.target.closest('[data-cap-view]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...root.querySelectorAll('[data-cap-view]')],i=tabs.indexOf(tab),next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];show(next.dataset.capView);next.focus();},{signal:abort.signal});
  root.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.capView){show(b.dataset.capView);return;}
    if(b.hasAttribute('data-cap-apply'))void attempt(applyProfile);
    if(b.hasAttribute('data-cap-current-profile'))void attempt(()=>{fillProfile(getRobotProfile?.()??createRobotCapability());lastExternal=JSON.stringify(profile);status('Loaded the currently selected robot profile.');});
    if(b.hasAttribute('data-cap-prepare'))void attempt(prepare);
    if(b.hasAttribute('data-cap-export-profile'))void attempt(()=>download(readProfile(),'brainsnn-robot-profile.json'));
    if(b.hasAttribute('data-cap-arm-solve'))void attempt(solveArm);
    if(b.hasAttribute('data-cap-arm-example'))void attempt(loadArmExample);
    if(b.hasAttribute('data-cap-compare'))void attempt(compare);
    if(b.hasAttribute('data-cap-calibrate'))void attempt(()=>{parseTelemetry();comparison=null;clearComparison();const fit=calibrateWheelScale(telemetry,{wheelRadiusM:profile.drive.wheelRadiusM,referenceIndependent:$('[data-cap-independent]').checked});calibration={...fit,input:{sourceSha256:telemetryHash,sourceName:telemetryName,robotCapability:clone(profile),inputUnits:clone(telemetry.inputUnits),inputConvention:telemetry.inputConvention,frameId:telemetry.frameId,referenceIndependent:telemetry.referenceIndependent},createdAt:new Date().toISOString()};if(fit.status==='calibration-proposal'){calibrationSources.add(telemetry.sourceId);$('[data-cap-held-out]').checked=false;}$('[data-cap-calibration-status]').textContent=fit.status==='calibration-proposal'?`Proposed radius ${fmt(fit.proposedWheelRadiusM,5)} m (${fmt(fit.wheelRadiusScale,4)} × the input radius). Not applied. This source is now calibration data; validate on a different run.`:`No correction proposed: ${fit.status}. ${(fit.reasons||[]).join(' ')}`;});
    if(b.hasAttribute('data-cap-template'))download('t,x,y,z,qx,qy,qz,qw,leftEncoderRad,rightEncoderRad\n0,0,0,0,0,0,0,1,0,0\n0.1,0.01,0,0,0,0,0,1,0.12,0.12\n0.2,0.02,0,0,0,0,0,1,0.24,0.24\n','telemetry-format-example.csv','text/csv');
    if(b.hasAttribute('data-cap-report'))void attempt(()=>download(report(),'brainsnn-robot-evidence.json'));
    if(b.hasAttribute('data-cap-save'))void attempt(()=>{if(!episode&&!arm&&!comparison)throw Error('Run a route or arm check before saving a test summary.');if(!saveToProject)throw Error('Download the evidence bundle and add it in Saved projects.');saveToProject({name:'brainsnn-robot-test-summary.json',content_text:JSON.stringify(report({summary:true}))});});
  },{signal:abort.signal});
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-cap-import-profile]'))void attempt(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>65536)throw Error('Robot profiles are limited to 64 KiB.');const token=++profileLoad,value=normalizeRobotCapability(JSON.parse(await file.text()));if(disposed||token!==profileLoad)return;fillProfile(value);dirty=true;$('[data-cap-profile-status]').textContent='Imported profile ready. Apply it to use it in the map planner.';status('Profile imported locally. Review the settings, then apply it.');});
    if(event.target.matches('[data-cap-telemetry]'))void attempt(async()=>{const file=event.target.files[0];if(!file)return;if(file.size>8*1024*1024)throw Error('Use a telemetry excerpt up to 8 MiB.');const token=++telemetryLoad,source=await file.text(),hash=await sha(source);if(disposed||token!==telemetryLoad)return;loadTelemetryOptions(source,file.name);telemetryName=file.name;telemetryText=source;telemetryHash=hash;comparison=calibration=null;clearComparison();$('[data-cap-independent]').checked=false;$('[data-cap-calibration-status]').textContent='';parseTelemetry();$('[data-cap-registered]').checked=false;$('[data-cap-time-confirmed]').checked=false;$('[data-cap-held-out]').checked=false;$('[data-cap-telemetry-status]').textContent=`${file.name} · ${telemetry.samples.length} imported samples. Review frame and time alignment before comparison.`;});
    if(event.target.matches('[data-cap-convention],[data-cap-length],[data-cap-time],[data-cap-angle],[data-cap-frame],[data-cap-held-out],[data-cap-registered],[data-cap-time-confirmed]')){comparison=null;clearComparison();}
  },{signal:abort.signal});
  function loadArmExample(){
    arm=null;armInput=null;$('[data-cap-arm-metrics]').replaceChildren();$('[data-cap-arm-reasons]').replaceChildren();$('[data-cap-arm-step]').parentElement.hidden=true;
    const example=clone(GENERIC_ARM_PROFILE);example.basePose.frameId='base_link';$('[data-cap-arm-profile]').value=JSON.stringify(example,null,2);
    $('[data-cap-arm-start]').value=JSON.stringify(GENERIC_ARM_PROFILE.homeJoints??GENERIC_ARM_PROFILE.home??[0,0,0,0,0,0]);
    for(const [key,value] of Object.entries({targetX:.8,targetY:.2,targetZ:.38,roll:0,pitch:0,yaw:11}))$(`[data-cap-field="${key}"]`).value=value;
    drawArm(null,armTarget().position);$('[data-cap-arm-status]').textContent='Generic six-joint example loaded. Check the target and path to compute a result.';
  }
  function clear(){revision++;profileLoad++;telemetryLoad++;calibrationSources.clear();recorder?.dispose();recorder=null;episode=drive=arm=armInput=telemetry=comparison=calibration=trialSource=null;telemetryText=telemetryHash=null;telemetryName='';$('[data-cap-recorder]').replaceChildren();$('[data-cap-drive-result]').hidden=true;clearComparison();$('[data-cap-telemetry]').value='';$('[data-cap-telemetry-status]').textContent='No telemetry loaded.';$('[data-cap-encoder-svg]').setAttribute('hidden','');$('[data-cap-encoder-status]').textContent='No wheel measurements loaded.';$('[data-cap-calibration-status]').textContent='';$('[data-cap-arm-metrics]').replaceChildren();$('[data-cap-arm-reasons]').replaceChildren();loadArmExample();refresh();}
  fillProfile(getRobotProfile?.()??profile);lastExternal=JSON.stringify(profile);loadArmExample();refresh();
  return {open(){refresh();},refresh,suspend(){recorder?.pause();},clear,getReport:report,dispose(){disposed=true;revision++;recorder?.dispose();abort.abort();}};
}

function drawSeries(svg,points,label){
  if(points.length<2){svg.setAttribute('hidden','');return;}
  const t0=points[0][0],duration=Math.max(.001,points.at(-1)[0]-t0),max=Math.max(.001,...points.map(p=>p[1]));
  svg.innerHTML=`<text x="20" y="22" fill="#9cb4ca" font-size="13">${esc(label)} · peak ${fmt(max)} A</text><path d="M20 150H620" stroke="#425671"/><polyline points="${points.map(([t,y])=>`${20+600*(t-t0)/duration},${150-110*y/max}`).join(' ')}" fill="none" stroke="#6ae4eb" stroke-width="2"/><text x="20" y="172" fill="#9cb4ca" font-size="12">${fmt(t0,1)} s</text><text x="560" y="172" fill="#9cb4ca" font-size="12">${fmt(points.at(-1)[0],1)} s</text>`;svg.removeAttribute('hidden');
}
