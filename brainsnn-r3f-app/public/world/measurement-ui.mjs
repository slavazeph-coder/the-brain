import {EVIDENCE_LIMITS,createGeometryEvidence,evidenceBinding,addMeasurement,reviewGeometry,measurementComparison,
  invalidateGeometryEvidence,importGeometryEvidence,exportGeometryEvidence} from './measurement-evidence.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emptyDraft=()=>({label:'',fromX:'',fromZ:'',toX:'',toZ:'',distance:'',uncertainty:'',method:'tape',instrument:'',measuredOn:'',note:'',target:'floor',decision:'checked',reviewNote:''});
const field=(draft,key,title,type='text',extra='')=>`<label>${title}<input id="measure-${key}" data-measure-field="${key}" type="${type}" value="${esc(draft[key])}" ${extra}></label>`;

/** Session-only worksheet; independent of media/model observations and planning review flags. */
export function createMeasurementReview({getWorld,status,event,download}){
  let session=null,draft=emptyDraft(),open=false,generation=0,busy=false,host=null;
  function refresh(){if(host?.isConnected)render(host);}
  function clear(){generation++;session=null;draft=emptyDraft();busy=false;open=false;}
  function mapChanged(next,{replaced=false}={}){
    generation++;busy=false;
    if(session&&(replaced||evidenceBinding(session,next)!=='current'))session=invalidateGeometryEvidence(session,replaced?'map-replaced':'geometry-edited');
  }
  async function guarded(work){
    if(busy)return;busy=true;const revision=generation;refresh();
    try{const next=await work(()=>revision===generation);if(revision!==generation)return;if(next)session=next;}
    catch(error){if(revision===generation)status(error.message,true);}
    finally{if(revision===generation){busy=false;refresh();}}
  }
  function numeric(key){if(draft[key].trim()==='')throw new Error('Enter both map endpoints, the independent distance and its uncertainty.');return Number(draft[key]);}
  async function action(name){
    if(name==='start'){
      if(session&&!confirm('Replace this worksheet? Export its evidence first if you want to keep the current records.'))return;
      const world=getWorld();if(!world)return;
      await guarded(async current=>{const next=await createGeometryEvidence(world);if(!current())return;draft=emptyDraft();event('geometry_worksheet_started',{geometrySHA256:next.geometry.sha256});status('Worksheet started. Enter independent readings; the map and planning checkboxes are unchanged.');return next;});
    }else if(name==='measurement'){
      await guarded(()=>{const next=addMeasurement(session,{id:'m-'+crypto.randomUUID(),label:draft.label,from:[numeric('fromX'),numeric('fromZ')],to:[numeric('toX'),numeric('toZ')],distanceMeters:numeric('distance'),uncertaintyMeters:numeric('uncertainty'),method:draft.method,instrument:draft.instrument,measuredOn:draft.measuredOn,note:draft.note},getWorld());
        const {target,decision,reviewNote}=draft;draft={...emptyDraft(),target,decision,reviewNote};event('human_measurement_recorded',{geometrySHA256:next.geometry.sha256,id:next.measurements.at(-1).id});status('Self-reported measurement saved. This does not verify metric geometry.');return next;});
    }else if(name==='review'){
      await guarded(()=>{const next=reviewGeometry(session,{target:draft.target,decision:draft.decision,note:draft.reviewNote,reviewedAt:new Date().toISOString()},getWorld());draft.reviewNote='';event('geometry_decision_recorded',{geometrySHA256:next.geometry.sha256,target:draft.target,decision:draft.decision});status('Human decision saved. Planning checkboxes are unchanged.');return next;});
    }else if(name==='export'){
      await guarded(async current=>{const value=await exportGeometryEvidence(session,getWorld());if(current())download('brainsnn-geometry-evidence.json',value);});
    }
  }
  function render(container){
    host=container;const world=getWorld();container.replaceChildren();if(!world)return;
    const state=session?evidenceBinding(session,world):'empty',editable=state==='current'&&!busy;
    const details=document.createElement('details');details.id='measurement-worksheet';details.className='processing-options';details.style.overflowWrap='anywhere';details.open=open;
    details.innerHTML=`<summary>Measurements and geometry review evidence</summary><p>Kept in this tab; export to save. Record independent readings and decisions for this map. Self-reported evidence is not certification and never verifies a reconstruction or changes planning approval.</p>
      <p id="measurement-state" role="status">${state==='empty'?'No worksheet yet.':state==='current'?'Current map · self-reported, unverified evidence':state==='imported'?'Imported reference only · review authority reset':'Stale worksheet · map changed; prior decisions no longer apply'}</p>
      <button type="button" id="measurement-start" ${busy?'disabled':''}>${session?'Start replacement worksheet':'Start worksheet for this map'}</button>
      <label>Import worksheet as a reference<input id="measurement-import" type="file" accept=".json,application/json" ${busy?'disabled':''}></label>
      ${session?`<p class="micro">${session.measurements.length}/64 measurements · ${session.reviews.length} recorded decisions. Bound map SHA-256: <code style="overflow-wrap:anywhere">${session.geometry.sha256}</code></p><button type="button" id="measurement-export" ${busy?'disabled':''}>Export worksheet JSON ↗</button>
      <fieldset ${editable?'':'disabled'} style="border:0;padding:0;min-width:0"><legend>Independent distance</legend>
      ${field(draft,'label','What did you measure?','text','maxlength="120"')}
      <p class="micro">Use map X/Z coordinates in metres. Endpoints identify your measurement; they do not locate or scale a point cloud.</p>
      <div class="field-row">${field(draft,'fromX','From X · m','number','step="any" min="0"')}${field(draft,'fromZ','From Z · m','number','step="any" min="0"')}${field(draft,'toX','To X · m','number','step="any" min="0"')}${field(draft,'toZ','To Z · m','number','step="any" min="0"')}${field(draft,'distance','Independent reading · m','number','step="any" min="0.001" max="200"')}${field(draft,'uncertainty','Reading uncertainty ± m','number','step="any" min="0" max="10"')}</div>
      <label>Method<select id="measure-method" data-measure-field="method">${[['tape','Tape measure'],['laser','Laser distance meter'],['manual-reference','Documented manual reference']].map(([value,label])=>`<option value="${value}" ${draft.method===value?'selected':''}>${label}</option>`).join('')}</select></label>
      ${field(draft,'instrument','Instrument or dimensioned reference','text','maxlength="120"')}${field(draft,'measuredOn','Date measured','date')}
      <label>Measurement notes<textarea id="measure-note" data-measure-field="note" maxlength="600">${esc(draft.note)}</textarea></label><button type="button" id="measurement-save">Save measurement</button>
      <hr><h4>Human geometry decision</h4><label>Map feature<select id="measure-target" data-measure-field="target">${[['floor','Floor boundary'],['start','Start position'],...session.geometry.snapshot.objects.map(o=>['object:'+o.id,`${o.id} · ${o.kind}`])].map(([value,label])=>`<option value="${esc(value)}" ${draft.target===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label>
      <label>Decision<select id="measure-decision" data-measure-field="decision"><option value="checked" ${draft.decision==='checked'?'selected':''}>Checked by me</option><option value="needs-work" ${draft.decision==='needs-work'?'selected':''}>Needs further work</option></select></label><label>Review notes<textarea id="measure-reviewNote" data-measure-field="reviewNote" maxlength="600">${esc(draft.reviewNote)}</textarea></label><button type="button" id="measurement-review">Record decision</button></fieldset>
      <div id="measurement-records">${session.measurements.map(m=>{const c=measurementComparison(m);return `<p><b>${esc(m.label)}</b><br>${m.distanceMeters} ± ${m.uncertaintyMeters} m · map span ${c.mapDistanceMeters.toFixed(3)} m · difference ${c.discrepancyMeters.toFixed(3)} m<br><span class="micro">${esc(m.method)} · ${esc(m.instrument)} · ${esc(m.measuredOn)} · ${esc(m.note)}</span></p>`;}).join('')}${session.reviews.map(r=>`<p>${esc(r.target)} · ${esc(r.decision)}<br><span class="micro">${esc(r.note)}</span></p>`).join('')}</div>`:''}`;
    details.addEventListener('toggle',()=>{open=details.open;});
    for(const element of details.querySelectorAll('[data-measure-field]')){
      const save=()=>{draft[element.dataset.measureField]=element.value;};element.addEventListener('input',save);element.addEventListener('change',save);
    }
    for(const name of ['start','export','save','review'])details.querySelector('#measurement-'+name)?.addEventListener('click',()=>void action(name==='save'?'measurement':name));
    details.querySelector('#measurement-import').addEventListener('change',e=>{
      const file=e.target.files?.[0];if(!file)return;
      if(session&&!confirm('Replace this worksheet with an imported reference? Export current records first to keep them.'))return;
      void guarded(async current=>{if(file.size>EVIDENCE_LIMITS.bytes)throw new Error('Import geometry evidence JSON up to 256 KiB.');const next=await importGeometryEvidence(await file.text());if(!current())return;draft=emptyDraft();event('geometry_evidence_imported',{geometrySHA256:next.geometry.sha256});status('Imported as reference only. Start a new worksheet to record fresh review.');return next;});
    });
    container.append(details);
  }
  return {render,mapChanged,clear,session:()=>session};
}
