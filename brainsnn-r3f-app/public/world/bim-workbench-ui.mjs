import {BIM_REVIEW_CHECKS, createBimWorkbench, prepareBimSource, bimProjectSummary} from './bim-workbench.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const stateLabel = {ready: 'Ready to send', uploading: 'Uploading scan', creating: 'Preparing job', prepared: 'Prepared on worker',
  queued: 'Queued on worker', running: 'Compiling on worker', complete: 'Output ready', failed: 'Failed', cancelled: 'Cancelled',
  interrupted: 'Resume needed', attention: 'Check submission', cancelling: 'Confirming cancellation'};
const bytes = n => n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${Math.ceil(n / 1024)} KiB`;
const reviewLabels = {scale: 'Compared scale and dimensions with independent measurements', coverage: 'Checked scan coverage, walls and openings',
  classification: 'Checked object types and missing or uncertain geometry', exports: 'Opened and inspected the required export files'};

export function bimWorkbenchMarkup() {
  return `<div class="bim-workbench" data-bim-workbench>
    <header class="bim-workbench-heading"><div><p class="bim-eyebrow">Scan to building model</p><h3>Projects, processing and review</h3><p>Keep several registered scans moving through one traceable queue. Review each model before handing it over.</p></div><button type="button" data-bim-connect>Connect processing</button></header>
    <div class="bim-metrics" data-bim-metrics aria-label="Project queue summary"></div>
    <div class="bim-intake"><div><label>Project<select data-bim-project><option value="">Create a project</option></select></label><form data-bim-project-form class="bim-new-project"><label>New project name<input data-bim-project-name maxlength="120" placeholder="North building · level 1" required></label><button type="submit">Create project</button></form></div>
      <div><label>Registered scan files<input data-bim-files type="file" accept=".ply,.json,application/json" multiple></label><div class="bim-input-grid"><label>PLY up direction<select data-bim-axis><option value="z">Z is up · scanner coordinates</option><option value="y">Y is up</option></select></label><label>PLY coordinate units<select data-bim-units><option value="1">Metres</option><option value="0.01">Centimetres</option><option value="0.001">Millimetres</option><option value="0.3048">Feet</option></select></label></div>
      <label class="bim-check"><input data-bim-registered type="checkbox"><span>Each file is already registered, and I checked its coordinate units. Separate scans will remain separate jobs.</span></label><button type="button" data-bim-add>Add scans to project</button></div></div>
    <p class="bim-note">PLY: up to 64 MiB (ASCII up to 16 MiB). Prepared survey <code>arena-cloud.json</code>: up to 16 MiB and 50,000 points, with units already recorded. Larger PLY, LAS, LAZ and E57 can be prepared with the supplied <code>survey_cloud.py</code> tool. Browser preparation samples points and aligns the floor; it does not register scans.</p>
    <div class="bim-queue-controls"><label class="bim-check"><input data-bim-consent type="checkbox"><span>I agree to send these registered scan clouds to the connected processing worker.</span></label><div class="bim-toolbar"><label>Concurrent jobs<select data-bim-concurrency><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label><button type="button" class="primary" data-bim-start>Start / resume queue</button><button type="button" data-bim-pause>Pause new jobs</button><button type="button" data-bim-manifest>Save project manifest</button><button type="button" data-bim-save-project hidden>Add project summary to Saved projects</button></div><p class="bim-note" data-bim-capacity>Connect processing, then start the queue. The worker’s advertised capacity controls the actual number of concurrent jobs.</p></div>
    <p class="bim-local-status" data-bim-status role="status" aria-live="polite">Projects and source files are kept locally in this browser. Reconnect and resume after reloading.</p>
    <div class="bim-board"><section aria-label="Scan job queue"><div class="bim-section-title"><h4>Project queue</h4><label>Show<select data-bim-filter><option value="all">All projects</option><option value="project">Selected project</option></select></label></div><div data-bim-jobs></div></section><section class="bim-review-panel" aria-label="Selected scan and review" data-bim-detail></section></div>
    <p class="bim-note bim-boundary">The compiler produces an automatic model that needs review. IFC can be opened or linked in Revit; native RVT creation is not part of this queue. Download buttons appear only for files actually returned by the worker. Worker storage can expire; save required outputs.</p>
  </div>`;
}

export function mountBimWorkbench({root, host, getConnection, getResults, getResult, rememberResult = () => {},
  connect = () => {}, status = () => {}, onOpenResult, saveToProject, store} = {}) {
  root ||= host; if (!root) throw Error('The scan project panel needs a host.');
  if (!root.querySelector('[data-bim-workbench]')) root.innerHTML = bimWorkbenchMarkup();
  const $ = selector => root.querySelector(selector), abort = new AbortController(), signal = abort.signal, urls = new Set();
  let disposed = false, projectId = '', selectedId = '', detailSignature = '', renderSignature = '', adding = false, model;
  const say = (message, error = false) => {if (disposed) return; $('[data-bim-status]').textContent = message;
    $('[data-bim-status]').classList.toggle('error', error); status(message, error);};
  const attempt = fn => Promise.resolve().then(fn).catch(error => {if (!disposed) say(error.message, true);});
  const on = (selector, event, fn) => $(selector).addEventListener(event, fn, {signal});
  $('[data-bim-save-project]').hidden = typeof saveToProject !== 'function';
  function downloadJSON(value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'})); urls.add(url);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'brainsnn-bim-project-manifest.json'; anchor.click();
    setTimeout(() => {URL.revokeObjectURL(url); urls.delete(url);}, 30000);
  }
  function render(report) {
    if (disposed) return;
    const signatureNow = JSON.stringify([report.projects, report.jobs.map(j => [j.id, j.status, j.progress, j.error, j.remoteId, j.artifacts, j.review, j.attempt]),
      report.paused, report.capacity, report.activeCount, report.persistenceError, projectId, selectedId, adding, $('[data-bim-filter]').value]);
    if (signatureNow === renderSignature) return; renderSignature = signatureNow;
    const jobs = report.jobs, complete = jobs.filter(j => j.status === 'complete').length,
      reviewed = jobs.filter(j => j.status === 'complete' && j.review?.status === 'reviewed').length;
    $('[data-bim-metrics]').innerHTML = [[report.projects.length, 'Projects'], [jobs.length, 'Scan jobs'], [complete, 'Outputs ready'], [reviewed, 'Human reviews saved']]
      .map(([n, label]) => `<div><strong>${n}</strong><span>${label}</span></div>`).join('');
    if (!report.projects.some(p => p.id === projectId)) projectId = report.projects[0]?.id || '';
    const project = $('[data-bim-project]'), signature = JSON.stringify(report.projects.map(p => [p.id, p.name]));
    if (project.dataset.signature !== signature) {project.dataset.signature = signature;
      project.innerHTML = report.projects.length ? report.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') : '<option value="">Create a project</option>';}
    project.value = projectId;
    $('[data-bim-add]').disabled = adding || !projectId;
    $('[data-bim-start]').disabled = !jobs.some(j => ['ready', 'interrupted'].includes(j.status));
    $('[data-bim-pause]').disabled = report.paused;
    $('[data-bim-manifest]').disabled = !jobs.length;
    $('[data-bim-save-project]').disabled = !jobs.some(j => j.projectId === projectId);
    $('[data-bim-capacity]').textContent = `${report.paused ? 'Queue paused' : 'Queue active'} · ${report.activeCount} observed / ${report.capacity} allowed concurrently. ${report.paused ? 'Pause leaves already submitted jobs running; cancel a job to stop it.' : 'The worker and account limits may reduce the requested concurrency.'}`;
    if (report.persistenceError) say(`Project saving failed: ${report.persistenceError}. New jobs are paused.`, true);
    const visible = jobs.filter(j => $('[data-bim-filter]').value !== 'project' || j.projectId === projectId);
    if (!visible.some(j => j.id === selectedId)) selectedId = visible[0]?.id || '';
    const focused = document.activeElement?.closest?.('[data-bim-job]')?.dataset.bimJob;
    $('[data-bim-jobs]').innerHTML = visible.length ? visible.map(job => {
      const name = report.projects.find(p => p.id === job.projectId)?.name || 'Project';
      return `<button type="button" class="bim-job ${job.id === selectedId ? 'is-selected' : ''}" data-bim-job="${esc(job.id)}" aria-pressed="${job.id === selectedId}"><span class="bim-job-top"><strong>${esc(job.name)}</strong><span class="bim-state bim-state-${esc(job.status)}">${esc(stateLabel[job.status])}</span></span><span class="bim-job-project">${esc(name)} · ${bytes(job.source.bytes)} · ${Number(job.source.preparation.pointCount).toLocaleString()} prepared points</span><span class="bim-job-bottom"><span>${job.remoteId ? `Job ${esc(job.remoteId.slice(0, 8))}` : 'Source saved locally'} · attempt ${job.attempt}</span><span>${job.status === 'complete' ? `${job.artifacts.length} files · ${job.review?.status === 'reviewed' ? 'review saved' : 'review pending'}` : job.status === 'uploading' ? `${Math.round(job.progress * 100)}% uploaded` : ''}</span></span>${job.error ? `<span class="bim-job-error">${esc(job.error)}</span>` : ''}</button>`;
    }).join('') : '<div class="bim-empty"><strong>Add your first registered scan</strong><p>Create a project, choose its files and confirm their units. Start processing when the queue is ready.</p></div>';
    if (focused && root.contains(document.activeElement) === false) $(`[data-bim-job="${focused}"]`)?.focus({preventScroll: true});
    const selected = jobs.find(j => j.id === selectedId);
    const nextSignature = JSON.stringify(selected && [selected.id, selected.status, selected.artifacts, selected.review, selected.remoteId, selected.error]);
    if (nextSignature !== detailSignature) {detailSignature = nextSignature; renderDetail(selected, report);}
  }
  function renderDetail(job, report) {
    const target = $('[data-bim-detail]');
    if (!job) {target.innerHTML = '<div class="bim-empty"><strong>Trace the source to the handoff</strong><p>Select a scan to see its source hashes, real processing state, available files and review record.</p></div>'; return;}
    const done = job.status === 'complete', canCheck = !!(job.remoteId || job.creationPending), inProgress = ['uploading', 'creating', 'queued', 'running', 'prepared', 'cancelling'].includes(job.status),
      p = report.projects.find(p => p.id === job.projectId), review = job.review;
    target.innerHTML = `<p class="bim-eyebrow">${esc(p?.name)}</p><h4>${esc(job.name)}</h4><dl class="bim-facts"><dt>Processing</dt><dd>${esc(stateLabel[job.status])}</dd><dt>Source</dt><dd>${bytes(job.source.bytes)} · ${esc(job.source.preparation.method)}</dd><dt>Units</dt><dd>Scan-file declaration · not independently verified</dd><dt>Original SHA-256</dt><dd><code>${esc(job.source.sha256)}</code></dd><dt>Prepared SHA-256</dt><dd><code>${esc(job.source.cloudSha256)}</code></dd>${job.remoteId ? `<dt>Worker job</dt><dd><code>${esc(job.remoteId)}</code></dd>` : ''}<dt>Updated</dt><dd>${esc(new Date(job.updatedAt).toLocaleString())}</dd></dl>
      <div class="bim-toolbar"><button type="button" data-bim-check ${!canCheck || inProgress ? 'disabled' : ''}>Reconnect / check status</button><button type="button" data-bim-cancel ${['complete', 'failed', 'cancelled'].includes(job.status) ? 'disabled' : ''}>Cancel job</button><button type="button" data-bim-retry ${!['failed', 'cancelled'].includes(job.status) ? 'disabled' : ''}>Retry job</button>${onOpenResult ? `<button type="button" data-bim-open ${done ? '' : 'disabled'}>Open model for review</button>` : ''}</div>
      ${job.error ? `<p class="bim-job-error">${esc(job.error)}</p>` : ''}<h4>Actual worker outputs</h4><div class="bim-artifacts">${done && job.artifacts.length ? job.artifacts.map((a, i) => `<button type="button" data-bim-download="${i}" title="SHA-256 ${esc(a.sha256)}"><strong>${esc(a.name)}</strong><span>${bytes(a.size)} · save file</span></button>`).join('') : `<p class="bim-note">${done ? 'The worker returned no export files for this job.' : 'Export files appear when this worker job completes.'}</p>`}</div>
      <form data-bim-review-form><h4>Human review <span class="bim-review-state">${review.status === 'reviewed' ? 'Recorded' : 'Pending'}</span></h4><fieldset ${done ? '' : 'disabled'}><legend>Record the checks you performed on this result</legend>${BIM_REVIEW_CHECKS.map(key => `<label class="bim-check"><input type="checkbox" data-bim-review="${key}" ${review.checks[key] ? 'checked' : ''}><span>${reviewLabels[key]}</span></label>`).join('')}<label>Reviewer name<input data-bim-reviewer maxlength="80" value="${esc(review.reviewer)}" placeholder="Person who checked the result"></label><label>Review notes<textarea data-bim-notes maxlength="2000" rows="3" placeholder="Missing coverage, dimension checks, unresolved geometry…">${esc(review.notes)}</textarea></label><button type="submit">Save review record</button></fieldset></form><p class="bim-note">This record is bound to the original scan, prepared cloud and returned file hashes. It records your checks and does not certify model accuracy.</p>`;
  }
  model = createBimWorkbench({getConnection, ...(store ? {store} : {}), onChange: render, onComplete: rememberResult});
  void model.ready.catch(error => say(error.message, true));
  on('[data-bim-project-form]', 'submit', event => {event.preventDefault(); void attempt(async () => {
    const p = await model.addProject($('[data-bim-project-name]').value); projectId = p.id; $('[data-bim-project-name]').value = ''; render(model.report()); say(`Created ${p.name}. Add its registered scans.`);
  });});
  on('[data-bim-project]', 'change', event => {projectId = event.target.value; render(model.report());});
  on('[data-bim-filter]', 'change', () => render(model.report()));
  on('[data-bim-add]', 'click', () => void attempt(async () => {
    const files = [...$('[data-bim-files]').files]; if (!files.length) throw Error('Choose one or more registered PLY or prepared survey JSON files.');
    if (!$('[data-bim-registered]').checked) throw Error('Confirm registration and coordinate units before adding these scans.');
    if (files.length + model.report().jobs.length > 48) throw Error('This board holds up to 48 scans. Choose fewer files.');
    const options = {upAxis: $('[data-bim-axis]').value, metresPerUnit: Number($('[data-bim-units]').value), registrationConfirmed: true}, targetProject = projectId;
    adding = true; render(model.report()); let added = 0; const errors = [];
    try {for (const file of files) {if (disposed) return; say(`Preparing ${file.name} locally…`);
      try {const source = await prepareBimSource(file, options); if (disposed) return; const job = await model.addSource(targetProject, source); selectedId = job.id; added++;}
      catch (error) {errors.push(`${file.name}: ${error.message}`);}
    }} finally {adding = false; $('[data-bim-files]').value = ''; render(model.report());}
    say(`${added} scan${added === 1 ? '' : 's'} saved locally.${errors.length ? ` ${errors.join(' ')}` : ' Connect processing and start the queue when ready.'}`, !!errors.length);
  }));
  on('[data-bim-connect]', 'click', () => void attempt(async () => {await connect(); say('Use the processing connection panel, then start or resume this queue.');}));
  on('[data-bim-start]', 'click', () => void attempt(async () => {
    await model.resume({consent: $('[data-bim-consent]').checked, concurrency: Number($('[data-bim-concurrency]').value)});
    say('Queue started. Status and outputs will come from the connected worker.');
  }));
  on('[data-bim-pause]', 'click', () => {model.pause(); say('New submissions paused. Jobs already sent remain on the worker; use Cancel job to stop one.');});
  on('[data-bim-manifest]', 'click', () => void attempt(async () => {downloadJSON(await model.manifest()); say('Project manifest saved with source hashes, job states and review records.');}));
  on('[data-bim-save-project]', 'click', () => void attempt(async () => {
    if (typeof saveToProject !== 'function') throw Error('Saved projects is unavailable in this workspace.');
    const summary = bimProjectSummary(model.report(), projectId); await saveToProject(summary);
    say('Project summary is ready in Saved projects. Choose where to keep it with your robot trials.');
  }));
  root.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || !root.contains(button)) return;
    if (button.dataset.bimJob) {selectedId = button.dataset.bimJob; render(model.report()); return;}
    if (button.hasAttribute('data-bim-check')) void attempt(async () => {await model.check(selectedId); say('Worker state checked. Resume to observe any outstanding work.');});
    if (button.hasAttribute('data-bim-cancel')) void attempt(async () => {await model.cancel(selectedId); say('Cancellation request handled. The displayed state reflects the worker response.');});
    if (button.hasAttribute('data-bim-retry')) void attempt(async () => {await model.retry(selectedId); say('A new attempt is ready. Start the queue if it is paused.');});
    if (button.hasAttribute('data-bim-open')) void attempt(async () => {const value = await model.result(selectedId);
      await onOpenResult(value.context || {job: value.job, sourceClient: value.client, sourceNames: [model.report().jobs.find(j => j.id === selectedId).name]});});
    if (button.hasAttribute('data-bim-download')) void attempt(async () => {const url = await model.download(selectedId, Number(button.dataset.bimDownload));
      if (disposed) return; const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; a.click();});
  }, {signal});
  root.addEventListener('submit', event => {
    if (!event.target.matches('[data-bim-review-form]')) return; event.preventDefault();
    void attempt(async () => {const result = await model.review(selectedId, {reviewer: $('[data-bim-reviewer]').value, notes: $('[data-bim-notes]').value,
      checks: Object.fromEntries(BIM_REVIEW_CHECKS.map(key => [key, $(`[data-bim-review="${key}"]`).checked]))});
      say(result.status === 'reviewed' ? 'Review recorded and bound to this source and output set.' : 'Partial review saved. Complete all checks and record a reviewer to mark it reviewed.');});
  }, {signal});
  return {open: () => model.ready.then(() => render(model.report())), refresh: () => {if (model) render(model.report());},
    suspend: () => {}, async clear() {await model.clear(); projectId = selectedId = detailSignature = renderSignature = ''; render(model.report());},
    getReport: () => model.report(), getState: () => model.report(), isActive: () => model.report().activeCount > 0,
    async dispose() {disposed = true; abort.abort(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); await model.dispose();}};
}
