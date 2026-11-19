import {jsonBytes} from './layer-preview.mjs';
import {validateBiomechanicsPreview,validateBiomechanicsReport,BIOMECHANICS_PREVIEW_LIMIT,createBiomechanicsViewer} from './biomechanics-preview.mjs';
import {cameraCalibrationPanel, mountCameraCalibrationTool} from './camera-calibration-tool.mjs';

export const biomechanicsPanel=`<section id="layer-panel-biomechanics" role="tabpanel" aria-labelledby="layer-tab-biomechanics" hidden>
  <p>See how a body model moves, where its centre of mass goes, and how its muscles change length. Start with our authored hinge and muscle example, or use your own OpenSim model and matching motion.</p>
  <button type="button" data-biomech-example>Try an example</button><p class="layer-note" data-biomech-input-info>No files selected. The example is an authored hinge and muscle, not a recorded person.</p>
  <div class="layer-input-row"><label>Body model · OpenSim .osim<input data-biomech-model type="file" accept=".osim"></label><label>Matching movement · .mot or .sto<input data-biomech-motion type="file" accept=".mot,.sto"></label></div>
  <p class="layer-note">Use a self-contained OpenSim 4 model in metres with Y up, and 2–1,800 motion frames over at most 60 seconds. Model and motion files can each be up to 8 MiB. The viewer shows body positions without external display meshes.</p>
  <details><summary>Analysis settings and forces</summary>
    <label>What to calculate<select data-biomech-analysis><option value="kinematics">Movement and muscle geometry</option><option value="inverse-dynamics">Advanced: net joint forces and moments</option></select></label>
    <label>Moment-arm coordinates · optional<input data-biomech-coordinates type="text" placeholder="Up to four names, separated by commas" maxlength="520"></label><p class="layer-note">Leave blank to use the model’s first four rotational coordinates. These are muscle geometry measurements, not muscle activation.</p>
    <div data-biomech-dynamics hidden><p class="layer-note">Inverse dynamics calculates net forces and moments from this model, the recorded coordinates, and your stated loads. It does not recover missing ground reaction forces or individual muscle forces.</p>
      <label>External loads<select data-biomech-load-mode><option value="supplied">I will provide recorded or authored loads</option><option value="none-declared">No contacts or applied forces except gravity</option></select></label>
      <label data-biomech-load-file-label>Loads · explicit ground-frame JSON<input data-biomech-loads type="file" accept=".json,application/json"></label>
      <div data-biomech-no-loads hidden><label>Why there are no external contacts or applied forces<textarea data-biomech-reason rows="3" maxlength="500" placeholder="Explain this model’s setup in at least 20 characters."></textarea></label><label class="layer-check"><input data-biomech-no-loads-confirm type="checkbox"><span>I checked this model and explicitly choose the no-contact assumption.</span></label></div>
    </div>
  </details>
  <label class="layer-check"><input data-biomech-consent type="checkbox"><span>I have permission to use these files, checked the model and assumptions, and agree to send them for analysis.</span></label>
  <button type="button" class="primary" data-biomech-run>Understand this movement</button>
  <details><summary>Open a previous movement analysis</summary><div class="layer-input-row"><label>Analysis preview · JSON<input data-biomech-preview type="file" accept=".json,application/json"></label><label>Or choose a workspace result<select data-layer-result="biomechanics"><option value="">Choose an analysis</option></select></label><button type="button" data-layer-use="biomechanics">Open selected analysis</button></div></details>
  <div class="biomech-results" hidden data-biomech-results>
    <p class="layer-note" data-biomech-provenance></p>
    <div class="layer-stage"><canvas data-biomech-canvas tabindex="0" aria-label="Model body positions and centre of mass. Drag or use left and right arrow keys to turn the view."></canvas></div>
    <p class="layer-note">Cyan: body origins and mass centres · violet: joints · gold: whole-model centre of mass. Lines link body mass centres to their model joints; they do not show bone or skin surfaces.</p>
    <div class="layer-toolbar"><button type="button" data-biomech-play>Play movement</button><button type="button" data-biomech-pause>Pause</button><label>Movement frame<input data-biomech-seek type="range" min="0" max="0" value="0"></label></div>
    <div class="layer-input-row"><label>Measurement<select data-biomech-metric></select></label><label>Channel<select data-biomech-channel></select></label></div>
    <div class="biomech-chart-stage"><canvas data-biomech-chart aria-label="Selected model measurement across the recorded time"></canvas></div>
    <p data-biomech-value class="biomech-value"></p>
  </div>
  <p data-biomech-info role="status">Choose the example or your own model and motion to begin.</p>
  <p class="layer-note">These are model-based calculations. They are not measured muscle activation, a clinical finding, or a validation of a real person or robot.</p>
  ${cameraCalibrationPanel}
</section>`;

export function biomechanicsOptions({analysis='kinematics',coordinates='',loadMode='supplied',reason='',noLoadsConfirmed=false}={}) {
  const names=coordinates.split(',').map(s=>s.trim()).filter(Boolean);
  if(names.length>4||new Set(names).size!==names.length||names.some(n=>!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(n)||n.includes('..')))throw Error('Use up to four unique coordinate names from your model.');
  const value={schema:'brainsnn.biomechanics-options.v1',analysis,model_up_axis:'Y',length_units:'m',...(names.length?{moment_arm_coordinates:names}:{})};
  if(!['kinematics','inverse-dynamics'].includes(analysis))throw Error('Choose a supported analysis.');
  if(analysis==='inverse-dynamics'){
    if(!['supplied','none-declared'].includes(loadMode))throw Error('Declare the external loads.');
    value.external_loads=loadMode;
    if(loadMode==='none-declared'){
      if(!noLoadsConfirmed||reason.trim().length<20||reason.trim().length>500)throw Error('Explain and confirm why this model has no contacts or applied forces except gravity.');
      value.no_external_loads_reason=reason.trim();
    }
  }
  return value;
}

/** This panel shares the parent runner; it never creates a client or uploads on file selection. */
export function mountBiomechanicsTool({root,signal,run,status,intent,version,isCurrent,show,read}) {
  const $=s=>root.querySelector(s),on=(s,event,fn)=>$(s).addEventListener(event,fn,{signal});
  const cameraReview=mountCameraCalibrationTool({root,signal});
  let model=null,movement=null,viewer=null,displayed=null,disposed=false;
  const attempt=fn=>Promise.resolve().then(fn).catch(e=>{if(!disposed&&e.name!=='AbortError')status(e.message,true);});
  const valid=token=>!disposed&&isCurrent(token);
  function changed(){intent();$('[data-biomech-consent]').checked=false;displayed=null;viewer?.clear();$('[data-biomech-results]').hidden=true;$('[data-layer-downloads]').replaceChildren();$('[data-biomech-info]').textContent='Inputs changed. Review the model and assumptions before running again.';}
  function note(){ $('[data-biomech-input-info]').textContent=`Model: ${model?.name||'choose a file'} · Movement: ${movement?.name||'choose a file'}`; }
  function settings(){const dynamics=$('[data-biomech-analysis]').value==='inverse-dynamics',none=$('[data-biomech-load-mode]').value==='none-declared';$('[data-biomech-dynamics]').hidden=!dynamics;$('[data-biomech-no-loads]').hidden=!none;$('[data-biomech-load-file-label]').hidden=none;}
  function set(value,report=null){
    displayed=value;show();$('[data-biomech-results]').hidden=false;
    viewer??=createBiomechanicsViewer({canvas:$('[data-biomech-canvas]'),chart:$('[data-biomech-chart]'),metric:$('[data-biomech-metric]'),channel:$('[data-biomech-channel]'),value:$('[data-biomech-value]'),onFrame(i,t){$('[data-biomech-seek]').value=String(i);$('[data-biomech-info]').textContent=`Frame ${i+1} of ${displayed?.time_s.length||0} · ${t.toFixed(3)} seconds · model-based analysis`;}});
    viewer.set(value);$('[data-biomech-seek]').max=String(value.time_s.length-1);
    $('[data-biomech-provenance]').textContent=`${report?'Verified job files · OpenSim':'Imported preview · original source files not verified · reported OpenSim'} ${value.runtime.version} · ${value.mass_kg.toPrecision(4)} kg model mass · ${value.analysis==='kinematics'?'movement and muscle geometry':'net joint forces and moments'} · model ${value.bindings.model_sha256.slice(0,12)} · motion ${value.bindings.motion_sha256.slice(0,12)}. ${value.analysis==='inverse-dynamics'?(value.inverse_dynamics.external_loads_mode==='none-declared'?'No external contacts/applied forces except gravity were declared.':'Uses the supplied external loads.'):'No external forces were inferred.'}${report?.external_loads_reason?' Declaration: '+report.external_loads_reason:''}${value.inverse_dynamics?' Derivatives use cubic splines without filtering.':''}`;
  }
  async function example(){
    changed();const token=version();status('Opening the authored example locally…');
    const names=['authored-pendulum.osim','authored-motion.mot'];
    const files=await Promise.all(names.map(async name=>{const response=await fetch(new URL(`./examples/biomechanics/${name}`,import.meta.url),{signal,credentials:'same-origin',redirect:'error'});if(!response.ok)throw Error('The example is unavailable. Choose your own model and motion.');const bytes=await response.arrayBuffer();if(bytes.byteLength>8*1024*1024)throw Error('The example exceeds its file limit.');return new File([bytes],name);}));
    if(!valid(token))return;[model,movement]=files;$('[data-biomech-model]').value='';$('[data-biomech-motion]').value='';$('[data-biomech-analysis]').value='kinematics';$('[data-biomech-coordinates]').value='';settings();note();$('[data-biomech-info]').textContent='Authored hinge and muscle ready. Check permission and press Understand this movement to process it.';status('Example opened locally. Nothing has been uploaded.');
  }
  on('[data-biomech-example]','click',()=>void attempt(example));
  for(const [selector,assign] of [['[data-biomech-model]',file=>{model=file;}],['[data-biomech-motion]',file=>{movement=file;}]])on(selector,'change',e=>{assign(e.target.files[0]||null);changed();note();});
  for(const selector of ['[data-biomech-analysis]','[data-biomech-load-mode]','[data-biomech-coordinates]','[data-biomech-loads]','[data-biomech-reason]','[data-biomech-no-loads-confirm]'])on(selector,'change',()=>{changed();settings();});
  on('[data-biomech-run]','click',()=>void attempt(async()=>{
    if(!model||!movement)throw Error('Choose a model and its matching motion, or try the example.');
    if(!/\.osim$/i.test(model.name)||!/\.(mot|sto)$/i.test(movement.name)||[model,movement].some(f=>!f.size||f.size>8*1024*1024))throw Error('Choose an OpenSim .osim model and .mot/.sto motion, each up to 8 MiB.');
    const options=biomechanicsOptions({analysis:$('[data-biomech-analysis]').value,coordinates:$('[data-biomech-coordinates]').value,loadMode:$('[data-biomech-load-mode]').value,reason:$('[data-biomech-reason]').value,noLoadsConfirmed:$('[data-biomech-no-loads-confirm]').checked});
    if(!$('[data-biomech-consent]').checked)throw Error('Check the model and assumptions, then approve this upload first.');
    const inputs=[{file:model,kind:'biomech-model'},{file:movement,kind:'biomech-motion'},{file:new File([JSON.stringify(options)],'biomechanics-options.json',{type:'application/json'}),kind:'biomech-options'}];
    if(options.external_loads==='supplied'){const file=$('[data-biomech-loads]').files[0];if(!file||!file.size||file.size>8*1024*1024||!file.name.endsWith('.json'))throw Error('Supply the explicit loads JSON, up to 8 MiB.');inputs.push({file,kind:'biomech-loads'});}
    await run('biomechanics',inputs);
  }));
  on('[data-biomech-preview]','change',e=>void attempt(async()=>{const file=e.target.files[0];if(!file)return;intent();const token=version();if(file.size>BIOMECHANICS_PREVIEW_LIMIT)throw Error('Analysis previews are limited to 48 MiB.');const value=validateBiomechanicsPreview(jsonBytes(await file.arrayBuffer(),BIOMECHANICS_PREVIEW_LIMIT));if(!valid(token))return;set(value);status('Movement analysis opened locally. Source hashes are retained, but the original source files have not been verified for this local preview.');}));
  on('[data-biomech-play]','click',()=>viewer?.play());on('[data-biomech-pause]','click',()=>viewer?.pause());on('[data-biomech-seek]','input',e=>viewer?.seek(Number(e.target.value)));
  return {
    async openResult(context,token){const [raw,reportRaw]=await Promise.all([read(context,'biomechanics-preview.json'),read(context,'biomechanics-report.json')]);if(!valid(token))return;const value=validateBiomechanicsPreview(jsonBytes(raw,BIOMECHANICS_PREVIEW_LIMIT),context.job.artifacts),digest=context.job.artifacts.find(a=>a.name==='biomechanics-preview.json')?.sha256,report=validateBiomechanicsReport(jsonBytes(reportRaw,1024*1024),value,digest);if(!valid(token))return;set(value,report);status('Movement analysis ready. Explore the model and its model-derived channels.');},
    pause(){viewer?.pause();},clear(){cameraReview.clear();model=null;movement=null;displayed=null;viewer?.clear();$('[data-biomech-analysis]').value='kinematics';$('[data-biomech-load-mode]').value='supplied';$('[data-biomech-coordinates]').value='';$('[data-biomech-reason]').value='';$('[data-biomech-no-loads-confirm]').checked=false;settings();$('[data-biomech-results]').hidden=true;note();$('[data-biomech-info]').textContent='Choose the example or your own model and motion to begin.';},dispose(){disposed=true;viewer?.dispose();},
  };
}
