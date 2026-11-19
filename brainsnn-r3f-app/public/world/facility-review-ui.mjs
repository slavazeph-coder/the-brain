import {createFacilityReview,presentation,makeReceipt} from './facility-review.mjs';
import {createSoftwareTwinView} from './operational-twin-view.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
const button=(action,label,extra='')=>`<button type="button" data-facility-action="${action}" ${extra}>${label}</button>`;
let rendererModule;
async function gpu(){
  if(!window.BrainSNNTwinRenderer){rendererModule||=import('./twin-renderer.js').catch(error=>{rendererModule=null;throw error;});await rendererModule;}
  return window.BrainSNNTwinRenderer;
}

/** Source-bound inspection of existing compiler outputs. No inference or geometry editing. */
export function mountFacilityReview({host,context,sceneSha,isCurrent=()=>true,status=()=>{},download,open=false}){
  if(!context.scene?.componentGraph||!sceneSha)return ()=>{};
  const root=el('details');root.id='scene-facility-review';root.className='facility-review';root.dataset.state='binding';
  root.innerHTML=`<summary><span>SPACE WORKBENCH</span> Scan to model, in one view <b>↗</b></summary><div class="facility-body"><div class="facility-heading"><div><p class="facility-eyebrow">ONE CAPTURE · LINKED COMPONENTS</p><h3>See the whole space.<br>Inspect one thing.</h3><p>Compare the retained source points with the building model. Focus a component, open a section, or replay how the completed model fits together.</p></div><span class="facility-badge">SOURCE CHECK PENDING</span></div><p class="facility-message" role="status" aria-live="polite">Checking this model against its original point cloud…</p><div class="facility-content" hidden></div></div>`;
  host.prepend(root);root.open=open;
  let disposed=false,review=null,state=null,renderer=null,rendererKind=null,starting=false,epoch=0,timer=null,currentView=null;
  const q=selector=>root.querySelector(selector),valid=()=>!disposed&&isCurrent();
  const ready=()=>{if(!valid())throw Error('The source scene changed. Open the matching model again.');if(context.dirty)throw Error('Compile pending BIM edits and reopen the new model before using this review.');if(!review)throw Error('Source binding has not completed.');};
  function message(text,error=false){if(!valid())return;q('.facility-message').textContent=text;q('.facility-message').classList.toggle('error',error);status(text,error);}
  function stop(){if(timer!==null)clearInterval(timer);timer=null;if(q('[data-facility-action="play"]'))q('[data-facility-action="play"]').textContent='Play assembly';}
  function selectedPart(){return review.parts.find(part=>part.componentId===state.selectedId);}
  function captureView(){if(renderer)currentView=renderer.getView();return currentView;}
  function drawList(){
    const args=presentation(review,{...state,isolate:false,section:{...state.section,enabled:false},replayCount:review.parts.length}),ids=new Set(args.visibleIds??review.parts.map(p=>p.componentId));
    const parts=review.parts.filter(part=>ids.has(part.componentId));
    q('.facility-count').textContent=`${parts.length} of ${review.parts.length} components`;
    q('.facility-parts').innerHTML=parts.map(part=>`<button type="button" data-facility-component="${esc(part.componentId)}" aria-pressed="${part.componentId===state.selectedId}"><span>${esc(part.label)}</span><small>${esc(part.kind)} · ${esc(part.sourceName)}</small></button>`).join('')||'<p class="facility-empty">No matching components. Clear the search or choose another type.</p>';
  }
  function drawSelected(){
    const part=selectedPart(),box=q('.facility-selected');
    box.innerHTML=part?`<div><span class="facility-eyebrow">${esc(part.kind.toUpperCase())}</span><h4>${esc(part.label)}</h4><small>${esc(part.sourceName)}</small></div><div class="facility-selection-actions">${button('focus','Focus component',part.centre?'':'disabled')}<label><input class="facility-isolate" type="checkbox" ${state.isolate?'checked':''}> Isolate envelopes</label></div><dl><dt>Compiled envelope</dt><dd>${part.size?part.size.map(n=>n.toFixed(3)).join(' × ')+' m':'No independent preview shape'}</dd><dt>Stable component</dt><dd>${esc(part.componentId)}</dd></dl><p>Envelope dimensions come from the compiled geometry. Source points remain context, not a segmented object. Labels are suggestions unless separately reviewed. Hidden surfaces and detailed connections remain unproven.</p>`:'<p>Select a component in the model or list. The original component ID stays linked to the IFC and Rhino handoff.</p>';
  }
  function drawBookmarks(){
    q('.facility-bookmark-list').innerHTML=state.bookmarks.length?state.bookmarks.map((bookmark,index)=>`<div>${button(`bookmark-${index}`,esc(bookmark.name))}${button(`remove-bookmark-${index}`,'×',`aria-label="Remove ${esc(bookmark.name)}"`)}</div>`).join(''):'<p>No saved views. Frame a useful area, name it and save.</p>';
    q('[data-facility-action="save-bookmark"]').disabled=state.bookmarks.length>=12||!renderer;
  }
  function controls(){
    root.querySelectorAll('[data-facility-mode]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.facilityMode===state.mode)));
    q('.facility-opacity').disabled=state.mode!=='overlay'||rendererKind==='software';
    q('.facility-opacity-value').textContent=Math.round(state.opacity*100)+'%';
    q('.facility-section-range').hidden=!state.section.enabled;
    q('.facility-section-lower').textContent=state.section.min.toFixed(2)+' m';q('.facility-section-upper').textContent=state.section.max.toFixed(2)+' m';
    q('.facility-assembly').value=state.replayCount;
    q('.facility-assembly-count').textContent=`${state.replayCount} / ${review.parts.length} completed components`;
    q('.facility-mode-caption').textContent=state.mode==='scan'?'Retained source points':state.mode==='model'?'Compiled component envelopes':rendererKind==='software'?'Source points + solid proxy model':'Source points + translucent model';
    q('.facility-replay-label').hidden=state.replayCount===review.parts.length;
    root.dataset.mode=state.mode;root.dataset.replayCount=String(state.replayCount);
  }
  function softwarePresentation(args){
    const view=captureView(),ids=new Set(args.visibleIds??review.parts.map(p=>p.componentId));renderer?.dispose();
    const points=state.mode==='model'?[]:review.cloudPoints,parts=state.mode==='scan'?[]:review.parts.filter(p=>ids.has(p.componentId));
    renderer=createSoftwareTwinView(q('.facility-stage'),{parts,pointCloud:points,frame:review.frame,onSelect:select,onView:view=>{currentView=view;}});
    if(view)renderer.setView(view);renderer.select(state.selectedId);drawBookmarks();
  }
  function apply(){
    ready();const args=presentation(review,state);controls();
    if(rendererKind==='gpu'){renderer.setPresentation(args);renderer.select(state.selectedId);}
    else if(rendererKind==='software')softwarePresentation(args);
  }
  function select(id){
    if(!valid()||!review||context.dirty)return;if(!review.parts.some(p=>p.componentId===id))return;
    state.selectedId=id;drawList();drawSelected();apply();
  }
  function focus(){
    const part=selectedPart();if(!part?.centre)return;
    if(rendererKind==='gpu'){if(!renderer.focus(part.componentId))message('This component is outside the current section. Expand or turn off the section first.');}
    else if(renderer){const previous=renderer.getView(),size=Math.max(...part.size,.25);renderer.setView({...previous,target:[...part.centre],zoom:Math.min(100,review.frame.span/size)});currentView=renderer.getView();}
    q('.facility-stage').scrollIntoView({block:'center',behavior:'smooth'});
  }
  async function start(){
    if(starting||renderer||!review||!root.open||!valid())return;starting=true;const generation=++epoch;
    try{
      let module;try{module=await gpu();}catch{/* The bounded software view remains available. */}
      if(generation!==epoch||!valid()||!root.open)return;
      q('.facility-stage').replaceChildren();
      try{
        if(!module)throw Error('GPU renderer unavailable.');
        renderer=module.create(q('.facility-stage'),{parts:review.parts,pointCloud:review.cloudPoints,frame:review.frame,onSelect:select,onView:view=>{currentView=view;}});
        if(typeof renderer.setPresentation!=='function'||typeof renderer.focus!=='function')throw Error('The renderer needs the facility review update.');
        rendererKind='gpu';
      }catch{
        renderer?.dispose();renderer=null;rendererKind='software';state.section.enabled=false;
        q('.facility-section-enabled').checked=false;q('.facility-section-enabled').disabled=true;
      }
      root.dataset.renderer=rendererKind;
      q('.facility-renderer-note').textContent=rendererKind==='gpu'?'Drag to orbit · scroll to zoom · arrow keys to rotate · 0 resets':'Software fallback · at most 5,000 source points · section clipping unavailable · model transparency unavailable';
      apply();drawBookmarks();
      message(rendererKind==='gpu'?'Source-bound review ready. Choose Scan, Model or Overlay to inspect the same space.':'Source-bound review ready in the bounded software fallback. Section clipping is disabled.');
    }catch(error){if(valid())message('View unavailable: '+error.message,true);}
    finally{starting=false;}
  }
  function build(){
    const kinds=[...new Set(review.parts.map(part=>part.kind))];
    q('.facility-badge').textContent=String(context.scene.source).startsWith('Authored')?'AUTHORED FIXTURE':'SOURCE-BOUND REVIEW';
    q('.facility-content').innerHTML=`<div class="facility-source-stats"><span><b>${review.pointCount.toLocaleString()}</b> retained points</span><span><b>${review.parts.length}</b> compiled components</span><span>Metres · Y up</span></div><div class="facility-toolbar"><div class="facility-modes" role="group" aria-label="Scene representation">${['scan','model','overlay'].map(mode=>`<button type="button" data-facility-mode="${mode}" aria-pressed="${mode===state.mode}">${mode[0].toUpperCase()+mode.slice(1)}</button>`).join('')}</div><label class="facility-opacity-label">Model opacity <input class="facility-opacity" type="range" min="0.05" max="1" step=".05" value="${state.opacity}" aria-label="Model overlay opacity"><output class="facility-opacity-value"></output></label>${button('reset','Whole space')}</div><div class="facility-layout"><aside class="facility-sidebar"><label>Find a component<input class="facility-search" type="search" maxlength="160" placeholder="Name or original ID"></label><label>Component type<select class="facility-kind"><option value="all">All types</option>${kinds.map(kind=>`<option value="${esc(kind)}">${esc(kind)}</option>`).join('')}</select></label><p class="facility-count"></p><div class="facility-parts" role="group" aria-label="Compiled scene components"></div></aside><div class="facility-visual"><div class="facility-stage" aria-label="Source and compiled geometry viewer"><p>Open this workbench to load the view.</p></div><div class="facility-stage-caption"><span class="facility-mode-caption"></span><span class="facility-replay-label" hidden>MODEL ASSEMBLY PLAYBACK</span></div><p class="facility-renderer-note">Viewer loads when this workbench opens.</p></div></div><div class="facility-tools"><section class="facility-section"><h4>Look inside</h4><label class="facility-inline-check"><input class="facility-section-enabled" type="checkbox"> Vertical section</label><p>Clip source points and model to the same height range. Heights use the source Y coordinate.</p><div class="facility-section-range" hidden><label>Lower height <output class="facility-section-lower"></output><input class="facility-section-min" type="range" min="${review.frame.min[1]}" max="${review.frame.max[1]}" step="any" value="${state.section.min}"></label><label>Upper height <output class="facility-section-upper"></output><input class="facility-section-max" type="range" min="${review.frame.min[1]}" max="${review.frame.max[1]}" step="any" value="${state.section.max}"></label></div></section><section class="facility-replay"><h4>Model assembly playback</h4><p>Reveal the existing compiler components in stored order. This is a replay of the completed model, not AI execution or processing time.</p><div class="facility-replay-controls">${button('play','Play assembly')}${button('show-all','Show all')}<output class="facility-assembly-count"></output></div><input class="facility-assembly" aria-label="Completed model components revealed" type="range" min="0" max="${review.parts.length}" step="1" value="${review.parts.length}"></section></div><section class="facility-selected" aria-label="Selected component"></section><details class="facility-bookmarks"><summary>Save useful views <span>SESSION ONLY</span></summary><div class="facility-bookmark-form"><label>View name<input class="facility-bookmark-name" maxlength="80" placeholder="North wall or equipment aisle"></label>${button('save-bookmark','Save current view')}</div><div class="facility-bookmark-list"></div></details><div class="facility-export">${button('export','Export review & saved views')}<p>Exports a source-bound JSON review. IFC, Rhino, source geometry and robot-route files keep their original content.</p></div><p class="facility-boundary">Camera geometry and internal model fit do not establish survey accuracy. User-entered scale remains user entered. A registered scan retains its declared units and registration assumptions. Simulation routes do not validate a physical robot. Detailed structural or MEP reconstruction is not demonstrated by these envelopes.</p><p class="facility-binding"></p>`;
    q('.facility-binding').textContent=`Source points SHA-256 ${review.binding.sourceSha256} · scene SHA-256 ${review.binding.sceneSha256} · component revision ${review.binding.revision}`;
    q('.facility-content').hidden=false;drawList();drawSelected();drawBookmarks();controls();
  }
  function action(action){
    ready();
    if(action==='focus'){focus();return;}
    if(action==='reset'){stop();state.query='';state.kind='all';state.isolate=false;state.selectedId=null;state.section.enabled=false;state.replayCount=review.parts.length;q('.facility-search').value='';q('.facility-kind').value='all';q('.facility-section-enabled').checked=false;renderer?.reset();drawList();drawSelected();apply();return;}
    if(action==='play'){
      if(timer!==null){stop();return;}
      if(!renderer)throw Error('Open the workbench view before starting playback.');
      if(state.mode==='scan')state.mode='overlay';state.replayCount=0;apply();q('[data-facility-action="play"]').textContent='Pause assembly';
      timer=setInterval(()=>{try{if(!valid()||!root.open||context.dirty){stop();return;}state.replayCount=Math.min(review.parts.length,state.replayCount+1);apply();if(state.replayCount===review.parts.length)stop();}catch(error){stop();message(error.message,true);}},600);return;
    }
    if(action==='show-all'){stop();state.replayCount=review.parts.length;apply();return;}
    if(action==='save-bookmark'){
      if(!renderer)throw Error('Open the view before saving a camera.');const name=q('.facility-bookmark-name').value.trim();
      if(!name)throw Error('Name this view before saving it.');if(state.bookmarks.length>=12)throw Error('Use at most 12 saved views.');
      state.bookmarks.push({name,view:structuredClone(captureView())});q('.facility-bookmark-name').value='';drawBookmarks();message('View saved in this session. Export the review to keep it.');return;
    }
    if(action.startsWith('remove-bookmark-')){state.bookmarks.splice(Number(action.slice('remove-bookmark-'.length)),1);drawBookmarks();return;}
    if(action.startsWith('bookmark-')){const bookmark=state.bookmarks[Number(action.slice('bookmark-'.length))];if(bookmark&&renderer){renderer.setView(bookmark.view);captureView();}return;}
    if(action==='export'){
      if(typeof download!=='function')throw Error('Review download is unavailable in this host.');
      const receipt=makeReceipt(review,{...state,view:captureView()});
      return Promise.resolve(download('facility-review.json',JSON.stringify(receipt),'application/json')).then(()=>message('Review and saved views exported with their exact source binding. No model geometry was changed.'));
    }
  }
  function click(event){
    const target=event.target.closest('button');if(!target||!root.contains(target))return;
    try{
      if(target.dataset.facilityComponent){ready();select(target.dataset.facilityComponent);return;}
      if(target.dataset.facilityMode){ready();state.mode=target.dataset.facilityMode;apply();return;}
      if(target.dataset.facilityAction)Promise.resolve(action(target.dataset.facilityAction)).catch(error=>message(error.message,true));
    }catch(error){stop();message(error.message,true);}
  }
  function input(event){
    try{
      if(!review)return;ready();const target=event.target;
      if(target.matches('.facility-search')){state.query=target.value;drawList();apply();}
      if(target.matches('.facility-kind')){state.kind=target.value;drawList();apply();}
      if(target.matches('.facility-opacity')){state.opacity=Number(target.value);apply();}
      if(target.matches('.facility-isolate')){state.isolate=target.checked;apply();}
      if(target.matches('.facility-section-enabled')){state.section.enabled=target.checked&&rendererKind!=='software';apply();}
      if(target.matches('.facility-section-min')){state.section.min=Math.min(Number(target.value),state.section.max);target.value=state.section.min;apply();}
      if(target.matches('.facility-section-max')){state.section.max=Math.max(Number(target.value),state.section.min);target.value=state.section.max;apply();}
      if(target.matches('.facility-assembly')){stop();state.replayCount=Number(target.value);apply();}
    }catch(error){stop();message(error.message,true);}
  }
  function toggle(){if(root.open)void start();else stop();}
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('toggle',toggle);
  void (async()=>{
    try{
      const result=await createFacilityReview(context.scene,context.cloud,sceneSha);if(!valid())return;
      review=result;state={mode:'overlay',opacity:.35,query:'',kind:'all',selectedId:null,isolate:false,section:{enabled:false,min:review.frame.min[1],max:review.frame.max[1]},replayCount:review.parts.length,bookmarks:[]};
      root.dataset.state='ready';build();message('Source point digest and stable component binding verified. Open the workbench to inspect this model.');await start();
    }catch(error){if(valid()){root.dataset.state='refused';q('.facility-badge').textContent='SOURCE MISMATCH';message('Workbench unavailable: '+error.message,true);}}
  })();
  return ()=>{disposed=true;epoch++;stop();renderer?.dispose();root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('toggle',toggle);root.remove();};
}
