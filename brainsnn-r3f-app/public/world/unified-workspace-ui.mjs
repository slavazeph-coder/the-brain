import {ICONS} from './playground-icons.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bytes = n => n >= 1048576 ? `${(n/1048576).toFixed(1)} MB` : `${Math.ceil(n/1024)} KB`;
const label = engine => ({'scene-usd':'Building model','colmap-sparse':'Room reconstruction','colmap-dense-cpu':'Detailed reconstruction','photo-metric':'Photo preview','observations':'Object observations','locate-photo':'Photo location','splat-repair':'Appearance repair','localization-map':'Measured robot map','motion-retarget':'G1 motion reference','biomechanics':'Movement analysis'}[engine] || engine || 'Processed result');

/** A single, stable front door to existing source, review, planning and export actions. */
export function mountUnifiedWorkspace({getSnapshot, actions}) {
  const host = document.getElementById('unified-workspace');
  if (!host) throw new Error('The shared workspace is unavailable.');
  let selectedJob = '', lastSourceId = null, lastSceneKey = null, lastLibrary = '', disposed = false;
  const abort = new AbortController();
  host.innerHTML = `<div class="unified-heading"><div><p class="eyebrow">ONE SPACE · EVERY STEP</p><h2 id="workspace-project-name"></h2><p id="workspace-project-summary"></p></div><span class="badge" id="workspace-project-basis"></span></div>
    <nav class="workspace-journey" aria-label="Build your world"><div id="workspace-tool-tabs"></div><button type="button" id="workspace-step-drawings" data-step="drawings"><span class="step-icon" aria-hidden="true">${ICONS.drawings}</span><strong>Make drawings</strong><small>Model and checks</small></button></nav>
    <div class="workspace-next"><p id="workspace-next-step" role="status"></p><button type="button" id="workspace-next-action" class="small" data-next></button><button type="button" id="workspace-project-review" class="small workspace-review-action" data-project-review>Review this project</button></div>
    
    <div class="workspace-view-switch" role="group" aria-label="Views of your space"><button id="workspace-source-view" data-space-view="source">Photo / video</button><button id="workspace-points-view" data-space-view="points">3D points</button><button id="workspace-model-view" data-space-view="model">Building model</button><button id="workspace-drawings-view" data-space-view="drawings">Drawings</button><button id="workspace-map-view" data-space-view="map">Robot map</button></div>
    <p id="workspace-view-message" class="workspace-view-message" role="status"></p>
    <details id="workspace-library" class="workspace-library"><summary id="workspace-library-title">Your files and results</summary><div class="workspace-source-controls"><label for="workspace-source-select">Your source<select id="workspace-source-select"></select></label><label for="workspace-job-select">Processed results<select id="workspace-job-select"></select></label></div><div id="workspace-library-content"></div><p class="micro">This tab keeps your latest 12 processing results. Save the files you want to keep after closing it; files on the processing service may expire.</p></details>`;
  const $ = id => document.getElementById(id);
  // One toolbar: keep the existing control IDs and handlers, and bring model review alongside them.
  const tabs = document.querySelector('.sandbox-tools');
  const labels = {capture:['1','Add your space','Photo or video','capture'],world:['2','Look around','Explore and change','explore'],test:['4','Try robots','Routes and changes','robots'],evidence:['5','Save your work','Files and results','save'],understand:['+','Check details','Notes and evidence','checks']};
  for (const button of tabs.querySelectorAll('[data-tab]')) {
    const [number,title,subtitle,alias] = labels[button.dataset.tab];
    // A picture and a word for each tool. The numbered path is the robot setup above; these are places to go, in any order.
    button.innerHTML = `<span class="step-icon" aria-hidden="true">${ICONS[alias] || number}</span><strong id="workspace-step-${alias}">${title}</strong><small>${subtitle}</small>`;
  }
  $('workspace-tool-tabs').append(tabs);
  const drawingButton = $('workspace-step-drawings');
  drawingButton.setAttribute('role','tab');
  drawingButton.setAttribute('aria-controls','scene-workspace-slot');
  drawingButton.setAttribute('aria-selected','false');
  drawingButton.tabIndex = -1;
  tabs.insertBefore(drawingButton, $('tab-test'));
  tabs.append($('tab-understand'));
  const message = text => { $('workspace-view-message').textContent = text; };
  function snapshot() { return getSnapshot(); }
  function chosenJob(s) { return s.jobs.find(j => j.key === selectedJob) || null; }
  function source(s) { return s.sources.find(v => v.id === s.activeSourceId) || null; }
  function options(select, rows, value) {
    const next = rows.map(row => `<option value="${esc(row.value)}">${esc(row.text)}</option>`).join('');
    if (select.dataset.options !== next) { select.innerHTML = next; select.dataset.options = next; }
    select.value = value || '';
  }
  function nextAction(s) {
    const active = source(s), job = chosenJob(s);
    if (s.processing.active) return ['Your files are being processed. You can keep exploring while you wait.', 'See progress', 'processing'];
    if (!s.sources.length) return ['Try the example now, or add your own photo or video to begin.', 'Add my space', 'capture'];
    if (!active?.hasVisual && !s.jobs.length) return ['Your source is ready. Create a 3D preview or rebuild the space from overlapping views.', 'Create 3D', 'processing'];
    if (job?.artifacts.some(a => a.name === 'scene.glb')) return ['Your model and its files are together below. Check them, then try a route on the reviewed map.', 'Open model', 'model'];
    if (active?.hasVisual) return ['Your 3D view is ready. Check its scale to prepare a model or a robot map.', 'Explore 3D', 'points'];
    return ['Choose a source or an earlier result to carry on from where you left off.', 'See results', 'save'];
  }
  function refresh() {
    if (disposed) return;
    const s = snapshot(), active = source(s);
    host.dataset.hasContent = String(!!(s.sources.length || s.jobs.length));
    const relatedJobs = active ? s.jobs.filter(j => j.key === active.jobKey || j.sourceIds.includes(active.id)) : s.jobs;
    if (lastSourceId !== s.activeSourceId) { if (!relatedJobs.some(j => j.key === selectedJob)) selectedJob = s.jobs.find(j => j.key === active?.jobKey)?.key || relatedJobs.at(-1)?.key || ''; lastSourceId = s.activeSourceId; }
    if (!s.jobs.some(j => j.key === selectedJob)) selectedJob = relatedJobs.at(-1)?.key || '';
    if (s.scene?.jobKey && s.scene.jobKey !== lastSceneKey) { selectedJob = s.scene.jobKey; lastSceneKey = s.scene.jobKey; }
    const job = chosenJob(s), model = job?.artifacts.some(a => /\.glb$/i.test(a.name));
    const modelOpen = document.getElementById('scene-dialog').open;
    const openJob = modelOpen && s.jobs.find(j => j.key === s.scene?.jobKey);
    const street = !modelOpen && s.workspace?.kind === 'street';
    const sourceNames = j => (j?.sourceNames || s.sources.filter(v => j?.sourceIds.includes(v.id)).map(v => v.name)).join(', ');
    $('workspace-project-name').textContent = openJob ? sourceNames(openJob) || label(openJob.engine) : street ? s.workspace.name : active?.name || s.world?.name || 'Your new space';
    $('workspace-project-summary').textContent = `${s.sources.length ? `${s.sources.length} source${s.sources.length===1?'':'s'}` : 'Example ready to explore'} · ${s.jobs.length} processing result${s.jobs.length===1?'':'s'}`;
    $('workspace-project-basis').textContent = openJob ? (s.scene?.ready?'MODEL RESULT':'LOADING RESULT') : street ? 'STREET WORLD' : active ? 'YOUR SOURCE' : s.world?.provenance === 'authored' ? 'PRACTICE EXAMPLE' : 'YOUR MAP';
    options($('workspace-source-select'), [{value:'',text:s.sources.length?'Choose a source':'Add a photo or video to begin'}, ...s.sources.map(v=>({value:v.id,text:v.name}))], s.activeSourceId);
    options($('workspace-job-select'), [{value:'',text:'No result selected'}, ...s.jobs.map((j,i)=>({value:j.key,text:`${i+1}. ${label(j.engine)}${sourceNames(j)?' · '+sourceNames(j):''}`}))], selectedJob);
    $('workspace-source-select').disabled = !s.sources.length;
    $('workspace-job-select').disabled = !s.jobs.length;
    const next = nextAction(s);
    $('workspace-next-step').textContent = next[0];
    $('workspace-next-action').textContent = next[1];
    $('workspace-next-action').dataset.next = next[2];
    for (const button of host.querySelectorAll('[data-space-view]')) {
      const view = button.dataset.spaceView;
      button.setAttribute('aria-pressed', String(view === 'model' ? modelOpen : !modelOpen && (view === s.view || view === 'points' && s.view === 'visual')));
      button.title = view==='source' && !active ? 'Add or select a photo or video first' : view==='points' && !active?.hasVisual ? 'Create or open a 3D result first' : ['model','drawings'].includes(view) && !model ? 'Create or select a building model first' : '';
    }
    for (const button of host.querySelectorAll('[data-step], [data-tab]')) {
      const buttonStep = button.dataset.step || ({capture:'capture',world:'explore',test:'robots',evidence:'save',understand:'checks'}[button.dataset.tab]);
      const visibleTab = street ? ({edit:'world',simulate:'test',evidence:'understand',export:'evidence'}[s.workspace.tool]||'world') : s.tab;
      const current = buttonStep === (modelOpen?'drawings':visibleTab==='capture'?'capture':visibleTab==='test'?'robots':visibleTab==='evidence'?'save':visibleTab==='understand'?'checks':'explore');
      if (current) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
      if (button.getAttribute('role')==='tab') { button.setAttribute('aria-selected',String(current)); button.tabIndex=current?0:-1; }
    }
    const html = `<div class="workspace-source-list">${s.sources.map(v=>`<button type="button" data-library-source="${esc(v.id)}"><strong>${esc(v.name)}</strong><small>${esc(v.kind)}${v.hasVisual?' · 3D view ready':''}</small></button>`).join('') || '<p>Add your own photo or video, or keep playing with the example.</p>'}</div>${s.jobs.map(j=>`<section class="workspace-result-group"><h4>${esc(label(j.engine))}</h4><p class="micro">${esc(sourceNames(j) || 'Original source')} · ${j.artifacts.length} files · result ${esc(j.id.slice(0,12))}</p><div>${j.artifacts.map(a=>`<div class="workspace-result-file"><span><strong>${esc(a.name)}</strong><small>${bytes(a.size || 0)}</small></span>${/\.(glb|ply|splat)$/i.test(a.name)||['observations.json','motion-preview.json','localization-map.json','repair-receipt.json','biomechanics-preview.json'].includes(a.name)?`<button type="button" data-result-open="${esc(j.key)}" data-index="${a.index}">Open</button>`:''}<button type="button" data-result-download="${esc(j.key)}" data-index="${a.index}" aria-label="Download ${esc(a.name)}">Save</button></div>`).join('')}</div></section>`).join('')}`;
    if (lastLibrary !== html) { $('workspace-library-content').innerHTML = html; lastLibrary = html; }
    $('workspace-library-title').textContent = `Your files and results (${s.sources.length + s.jobs.reduce((n,j)=>n+j.artifacts.length,0)})`;
  }
  function closeModel() { const dialog=$('scene-dialog'); if(dialog.open) dialog.close(); }
  async function view(name) {
    const s=snapshot(), job=chosenJob(s);
    const bound = job ? s.sources.filter(v => job.sourceIds.includes(v.id)) : [];
    const original = bound.find(v => ['video','image','capture'].includes(v.kind)) || bound.find(v => !v.jobKey);
    const points = job ? s.sources.find(v => v.jobKey === job.key && v.hasVisual) || bound.find(v => v.hasVisual) : source(s);
    const active = name === 'source' ? (job ? original : source(s)) : points;
    if (name==='source' || name==='points') {
      const pointArtifact = name==='points' && job?.artifacts.find(a=>/\.(ply|splat)$/i.test(a.name));
      if (pointArtifact) { closeModel(); await actions.openArtifact(job.key,pointArtifact.index); refresh(); message(''); return; }
      if (!active || name==='points' && !active.hasVisual) {
        const artifact = name==='points' && job?.artifacts.find(a=>/\.(ply|splat)$/i.test(a.name));
        if (artifact) { closeModel(); await actions.openArtifact(job.key,artifact.index); return; }
        message(name==='source'?(job?'The original photo or video for this result is not in this tab. Choose its source in Your files and results, or add it again.':'Add or select your photo or video first.'):'Create a 3D preview or choose a reconstruction result first.');
        return;
      }
      closeModel(); await actions.selectSource(active.id,name); message('');
    } else if (name==='model' || name==='drawings') {
      const artifact=job?.artifacts.find(a=>a.name==='scene.glb') || job?.artifacts.find(a=>/\.glb$/i.test(a.name));
      if (!artifact) { message('Drawings come from a building model. Open your 3D points, check a real distance, then build the model. Your existing sources and results stay here.'); return; }
      await actions.openArtifact(job.key,artifact.index);
      if (name==='drawings') {
        const drawings=$('scene-dialog').querySelector('.drawing-review, [data-drawing-review], #drawing-review');
        if (drawings) { if(drawings.tagName==='DETAILS') drawings.open=true; drawings.scrollIntoView({block:'start'}); }
        else $('scene-bim-files').scrollIntoView({block:'start'});
      }
      message('');
    } else if (name==='map') { closeModel(); await actions.showMap('world'); message(''); }
    refresh();
  }
  async function step(name) {
    if (name==='capture') { closeModel(); await actions.showTab('capture'); }
    else if (name==='processing') { closeModel(); await actions.showProcessing(); }
    else if (name==='explore') { const s=snapshot(); await view(source(s)?.hasVisual?'points':'map'); }
    else if (name==='model'||name==='points'||name==='drawings') await view(name);
    else if (name==='robots') { closeModel(); await actions.showMap('test'); }
    else if (name==='save') { closeModel(); await actions.showTab('evidence'); $('workspace-library').open=true; }
    refresh();
  }
  host.addEventListener('click', event => {
    const button=event.target.closest('button'); if(!button)return;
    const run=async()=>{
      if(button.dataset.tab) {
        const tool = button.dataset.tab;
        requestAnimationFrame(()=>{
          if (innerWidth > 600 || document.querySelector('dialog:modal') || document.getElementById('scene-dialog').open || snapshot().tab !== tool) return;
          const target = ['world','test'].includes(tool) ? $('viewport') : $('panel');
          target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
        });
      } else if(button.hasAttribute('data-project-review')) await actions.reviewProject?.(selectedJob);
      else if(button.dataset.step) await step(button.dataset.step);
      else if(button.hasAttribute('data-next')) await step(button.dataset.next);
      else if(button.dataset.spaceView) await view(button.dataset.spaceView);
      else if(button.dataset.librarySource) { closeModel(); await actions.selectSource(button.dataset.librarySource,'source'); message(''); }
      else if(button.dataset.resultOpen) { selectedJob=button.dataset.resultOpen; await actions.openArtifact(selectedJob,Number(button.dataset.index)); }
      else if(button.dataset.resultDownload) await actions.downloadArtifact(button.dataset.resultDownload,Number(button.dataset.index));
      refresh();
    };
    void run().catch(error=>message(error.message));
  }, {signal:abort.signal});
  $('workspace-source-select').addEventListener('change', event => {
    const sourceId = event.target.value; if(!sourceId)return;
    closeModel(); void Promise.resolve().then(()=>actions.selectSource(sourceId,'source')).then(()=>{const s=snapshot();selectedJob=source(s)?.jobKey||selectedJob;refresh();message('');}).catch(error=>message(error.message));
  }, {signal:abort.signal});
  $('workspace-job-select').addEventListener('change', event => { selectedJob=event.target.value; refresh(); message('Selected result kept with its original source. Choose a view or open its files below.'); }, {signal:abort.signal});
  $('scene-dialog').addEventListener('close', refresh, {signal:abort.signal});
  document.addEventListener('click', event => {
    const a=event.target.closest('a[data-workspace-goal]');
    if(!a || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    event.preventDefault(); closeModel(); void Promise.resolve().then(()=>actions.showTab('capture')).then(()=>{$('workspace').scrollIntoView({block:'start'});message(a.dataset.workspaceGoal==='play'?'Choose a photo to make a 3D preview.':'Choose a slow walkthrough video or overlapping photos to start.');}).catch(error=>message(error.message));
  }, {signal:abort.signal});
  refresh();
  return {refresh,dispose(){disposed=true;abort.abort();}};
}
