/* Optional, explicit paid analysis of locally verified selected evidence.
 * No request runs on mount. Recovery/CSRF credentials live in memory only. */
(() => {
  'use strict';
  const PREFIX = '/api/arena/analysis';
  const INPUT = 'brainsnn.arena.analysis-input.v1', OUTPUT = 'brainsnn.arena.analysis.v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = cents => new Intl.NumberFormat('en-CA', {style:'currency',currency:'CAD'}).format(Number(cents || 0) / 100).replace(/^\$/, 'C$');
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
  const bytes = value => new TextEncoder().encode(value);
  const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), n => n.toString(16).padStart(2,'0')).join('');
  const digest = evidence => sha(bytes(canonical({...evidence, images:evidence.images.map(({dataBase64, ...image}) => image)})));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const terminal = status => ['succeeded','failed','uncertain','expired'].includes(status);
  let current = null, workspace = null, lastResult = null, accountVersion = 0;
  const strings = value => Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === 'string' && item.length <= 8000);
  function telemetry(data = {}) {
    const out = {}, vector = value => Array.isArray(value) && value.length <= 64 && value.every(n => finite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER);
    for (const key of ['state','vector','action']) if (vector(data[key])) out[key] = data[key].slice();
    if (Array.isArray(data.actions) && data.actions.length <= 50 && data.actions.every(vector)) out.actions = data.actions.map(value => value.slice());
    for (const key of ['reward','queuedCount','unusedCount','chunkIndex','step','inferenceCount']) if (finite(data[key]) && Math.abs(data[key]) <= Number.MAX_SAFE_INTEGER) out[key] = data[key];
    for (const key of ['success','done','initialOnly','stale','missing']) if (typeof data[key] === 'boolean') out[key] = data[key];
    for (const key of ['observationId','chunkId','controllerInputId','status','phase']) if (typeof data[key] === 'string' && data[key].length <= 180) out[key] = data[key];
    if (Array.isArray(data.cameras)) out.cameras = data.cameras.slice(0,2).filter(camera => camera && typeof camera.id === 'string').map(camera => {
      const item = {}; for (const key of ['id','artifactId','role']) if (typeof camera[key] === 'string' && camera[key].length <= (key === 'role' ? 64 : 180)) item[key] = camera[key];
      if (typeof camera.consumedByPolicy === 'boolean') item.consumedByPolicy = camera.consumedByPolicy; return item;
    });
    return out;
  }
  function relatedEvents(recording, ids) {
    const events = recording.manifest.events, map = new Map(events.map(event => [event.id,event])), related = new Map(), children = new Map();
    for (const event of events) for (const ref of event.refs || []) { if (!children.has(ref)) children.set(ref,[]); children.get(ref).push(event); }
    for (const id of ids) { const event = map.get(id); if (!event || event.kind !== 'observation') throw new Error('Choose exact recorded observation IDs.'); related.set(id,event); }
    const pending = [...related.values()];
    while (pending.length && related.size < 100) for (const event of children.get(pending.shift().id) || []) {
      if (event.kind === 'observation' || related.has(event.id)) continue;
      if (!['inference-start','inference-result','chunk','controller-input','action','dataset-action','state','outcome','gap'].includes(event.kind)) continue;
      related.set(event.id,event); pending.push(event); if (related.size === 100) break;
    }
    return [...related.values()].sort((a,b) => a.seq-b.seq).map(event => ({id:event.id,kind:event.kind,seq:event.seq,...(finite(event.simTime) ? {simTime:event.simTime} : {}), refs:(event.refs || []).filter(id => related.has(id)),data:telemetry(event.data)}));
  }
  async function derivative(recording, observation, camera, decodeArtifact, index) {
    const artifact = recording.manifest.artifacts.find(item => item.id === camera.artifactId);
    if (!artifact || artifact.retention !== 'included') throw new Error('Original pixels omitted');
    const original = await decodeArtifact(artifact), scale = Math.min(1,512 / Math.max(original.width,original.height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(original.width * scale)); canvas.height = Math.max(1,Math.round(original.height * scale));
    canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);
    const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode camera image.')), 'image/png'));
    const raw = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let offset = 0; offset < raw.length; offset += 8192) binary += String.fromCharCode(...raw.subarray(offset,offset + 8192));
    let imageId='analysis-image-' + index; while(recording.manifest.events.some(event=>event.id===imageId))imageId+='-image';
    return {id:imageId,eventId:observation.id,artifactId:artifact.id,originalSha256:artifact.sha256,sha256:await sha(raw),mimeType:'image/png',width:canvas.width,height:canvas.height,dataBase64:btoa(binary)};
  }
  async function buildEvidence(recording, ids, decodeArtifact) {
    if (!ids.length || ids.length > 6) throw new Error('Select one to six observation events.');
    const limitations = ['Selected evidence only; omitted fields, unselected observations and prompt contents are not sent.','Clock metadata is omitted; simulation times are declared source values, not synchronized wall time.','Images are PNG analysis derivatives, resized only when larger than 512 pixels. Producer identity and policy execution remain declared.'];
    if (recording.manifest.completion.status !== 'complete' || recording.manifest.completion.unknownTail) limitations.push('The original recording has partial evidence or an unknown tail.');
    if (recording.manifest.source.kind === 'scripted-practice') limitations.push('Scripted practice; no named policy execution is established.');
    const images = [];
    for (const id of ids) {
      const observation = recording.manifest.events.find(event => event.id === id && event.kind === 'observation'); if (!observation) throw new Error('Selected observation no longer exists.');
      const cameras = (observation.data.cameras || []).slice(0,2);
      if (!cameras.length) limitations.push(id + ': no camera artifacts recorded.');
      if ((observation.data.cameras || []).length > 2) limitations.push(id + ': only the first two recorded cameras are included.');
      for (const camera of cameras) {
        try { images.push(await derivative(recording,observation,camera,decodeArtifact,images.length + 1)); }
        catch (failure) { limitations.push(id + ' / ' + camera.id + ': camera omitted (' + failure.message + ').'); }
      }
    }
    if (!images.length) throw new Error('No selected camera pixels can be sent. Open a recording containing original image artifacts.');
    const context = {limitations}, source = recording.manifest;
    if (typeof source.context.taskId === 'string') context.task = source.context.taskId.slice(0,180);
    if (typeof source.context.modelId === 'string') context.model = source.context.modelId.slice(0,180);
    const events = relatedEvents(recording,ids); if (events.length === 100) limitations.push('At most 100 linked events are included; additional telemetry may be omitted.');
    for (let i=0;i<limitations.length;i++) limitations[i]=limitations[i].slice(0,400);
    if (limitations.length>20) limitations.splice(19,limitations.length-19,'Further missing camera details are omitted from this bounded summary.');
    const evidence = {schema:INPUT,manifestSha256:recording.bundle.manifestSha256,recordingId:source.recordingId,sourceKind:source.source.kind,context,selectedEventIds:ids.slice(),events,images,includePrompts:false};
    if (bytes(JSON.stringify({evidence})).length > 8388544) throw new Error('Selected evidence exceeds 8 MiB. Select fewer observations.');
    return evidence;
  }
  function download(value,name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)], {type:'application/json'})), link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  async function request(path, body) {
    const response = await fetch(PREFIX + path, {method:body === undefined ? 'GET' : 'POST',credentials:'same-origin',cache:'no-store',headers:body === undefined ? {} : {'Content-Type':'application/json',...(workspace?.csrfToken ? {'X-Analysis-CSRF':workspace.csrfToken} : {})},...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'Analysis service is unavailable.'); error.status = response.status; throw error; } return data;
  }
  function mount(element, options) {
    const {recording,decodeArtifact,navigate} = options, hash = recording.bundle.manifestSha256;
    if (!current || current.hash !== hash) current = {hash,opened:false,selected:[],preview:null,quote:null,job:null,result:lastResult,error:'',notice:'',recovery:null,capabilities:null};
    const state = current; let stopped = false, timer = null, work = false, selectedEventId = options.selectedEventId;
    const $ = selector => element.querySelector(selector);
    const active = () => !stopped && element.isConnected;
    async function act(fn) {
      if (work) return; const focused=document.activeElement, focusId=focused?.id, focusAction=focused?.dataset?.aa;
      work=true;state.error='';paint();
      try { await fn(); } catch (error) { if(active())state.error=error.message; }
      finally { work=false;if(active()){paint();if(document.activeElement===document.body||element.contains(document.activeElement)){const target=focusId?element.querySelector('#'+CSS.escape(focusId)):focusAction?element.querySelector('[data-aa="'+CSS.escape(focusAction)+'"]'):null;if(target&&!target.disabled)target.focus();}} }
    }
    async function refreshWallet() { const version=accountVersion;try { const data=await request('/workspace');if(version===accountVersion)workspace=data; } catch (error) { if(version!==accountVersion)return;if(error.status===401)workspace=null;else throw error; } }
    function clearAccountState(){clearTimeout(timer);state.job=null;state.jobEvidence=null;state.quote=null;state.result=null;state.recovery=null;lastResult=null;}
    function invalidate() { state.preview=null; state.quote=null; state.notice='Selection changed. Preview again for a new quote.'; }
    function add(id) { if (!recording.manifest.events.some(event => event.id === id && event.kind === 'observation')) throw new Error('Choose an exact observation event ID.'); if (state.selected.includes(id)) return; if (state.selected.length === 6) throw new Error('The limit is six observations. Remove one before adding another.'); state.selected.push(id); invalidate(); }
    function currentObservation() {
      const map = new Map(recording.manifest.events.map(event=>[event.id,event])), pending=[selectedEventId], seen=new Set();
      while (pending.length && seen.size < 512) { const id=pending.shift(); if(seen.has(id))continue;seen.add(id);const event=map.get(id);if(!event)continue;if(event.kind==='observation')return event.id;pending.push(...event.refs); } return '';
    }
    function reference(id) {
      const evidence = state.result?.evidence, eventId = evidence?.images.find(image => image.id === id)?.eventId || id;
      const event = recording.manifest.events.find(event => event.id === eventId);
      return `<button type="button" class="ai-ref" data-aa-ref="${esc(eventId)}" ${!event || state.result?.analysis.manifestSha256 !== hash ? 'disabled' : ''}>${esc(id)}${event && finite(event.simTime) ? ' · ' + event.simTime.toFixed(3) + ' s' : ''}</button>`;
    }
    function resultPanel() {
      const result = state.result; if (!result) return ''; const a = result.analysis, stale = a.manifestSha256 !== hash || a.recordingId !== recording.manifest.recordingId;
      return `<section class="aa-result"><span class="ai-badge ${stale ? 'ai-warning' : ''}">${stale ? 'Stale · different recording' : 'Bound to this recording'}</span><h3>Model hypotheses</h3><p>${esc(a.modelVersion || a.model)} · ${esc(a.createdAt)} · ${result.imported ? 'Imported result; provider identity is unverified.' : 'Generated from selected evidence.'}</p>${result.evidence.images.some(image=>!image.dataBase64) ? '<p class="ai-limit">Analysis image bytes were not retained by the service. Input digest and original source references are checked; derivative pixel bytes cannot be reverified in this export.</p>' : ''}<p class="ai-limit">These are hypotheses, not diagnoses or task outcomes. Check the linked evidence and known omissions.</p>${stale ? '<p role="status">The recording identity changed. This result is retained for reference; its links and claims do not apply to the current recording.</p>' : ''}${a.hypotheses.map(item => `<article class="ai-finding"><h4>${esc(item.summary)}</h4><p>${item.refs.map(reference).join(' ')}</p><p><strong>Counterevidence:</strong> ${esc(item.counterevidence.join(' · ') || 'None supplied; this does not confirm the hypothesis.')}</p><p><strong>Limitations:</strong> ${esc(item.limitations.join(' · ') || 'See recording coverage.')}</p></article>`).join('') || '<p>No supported hypothesis was returned from the selected evidence.</p>'}<h4>Suggested experiments</h4>${a.suggestedExperiments.map(item => `<article class="ai-finding"><p>${esc(item.summary)}</p><p>${item.refs.map(reference).join(' ')}</p><p>Expected observation: ${esc(item.expectedObservation)}</p></article>`).join('') || '<p>No experiment suggested.</p>'}<p><strong>Missing information:</strong> ${esc(a.missingInformation.join(' · ') || 'None specified by the model.')}</p><details><summary>Coverage and analysis provenance</summary><pre>${esc(JSON.stringify({manifestSha256:a.manifestSha256,inputDigest:a.inputDigest,model:a.model,modelVersion:a.modelVersion,promptVersion:a.promptVersion,coverage:a.coverage,usage:a.usage},null,2))}</pre></details><button type="button" class="arena-button" data-aa="export">Download analysis and selected evidence</button></section>`;
    }
    function paint() {
      if (!active()) return;
      const cap = state.capabilities, wallet = workspace?.wallet, quote = state.quote, quoteValid = quote && new Date(quote.expiresAt).getTime() > Date.now();
      const running = state.job && !terminal(state.job.status), disabled = work || running;
      element.innerHTML = `<section class="ai-section aa-panel"><div class="ai-section-heading"><h2>Analyze selected evidence</h2><span>Optional · prepaid analysis</span></div><p>Ask Gemini for evidence-linked hypotheses and experiments. Preview the selected images and telemetry before sending them to Google. Local inspection stays free.</p><p class="aa-status" role="status" aria-live="polite">${esc(work ? 'Working…' : state.notice)}</p><p class="aa-error" role="alert">${esc(state.error)}</p>${!state.opened ? '<button type="button" class="arena-button" data-aa="open">Open paid analysis</button>' : `
        ${cap ? `<p>${cap.analysisEnabled ? 'Analysis available' : 'Analysis currently unavailable'} · ${cap.purchaseEnabled ? 'Top-ups available' : 'Purchases paused'}</p>${!cap.analysisEnabled ? '<p class="ai-limit">Paid analysis is currently unavailable. Local inspection and saved analyses remain available.</p><button type="button" class="arena-button" data-aa="refresh">Check availability</button>' : !cap.purchaseEnabled ? '<p class="ai-limit">New purchases are paused. Your existing balance is preserved.</p>' : ''}` : '<p>Check service availability to continue.</p><button type="button" class="arena-button" data-aa="refresh">Check availability</button>'}
        <div class="aa-wallet">${workspace ? `<p>Available <strong>${money(wallet?.availableCents)}</strong> · reserved ${money(wallet?.reservedCents)} · balance ${money(wallet?.balanceCents)}${wallet?.frozen ? ' · account frozen' : ''}</p><div class="ai-inline"><button class="arena-button" type="button" data-aa="topup" ${disabled || !cap?.purchaseEnabled || wallet?.frozen || state.recovery ? 'disabled' : ''}>Add C$50</button><button class="arena-button" type="button" data-aa="refresh" ${work ? 'disabled' : ''}>Refresh balance</button><button class="arena-button" type="button" data-aa="logout" ${work ? 'disabled' : ''}>Sign out</button></div><p class="ai-muted">One prepaid top-up. Taxes, if applicable, appear at checkout. No automatic recharge or guaranteed analysis count. Checkout alone does not confirm payment.</p><p><a href="mailto:hello@brainsnn.com?subject=${encodeURIComponent('BrainSNN analysis support: ' + workspace.workspaceId)}">Support or unused-credit refund</a> · Workspace <code>${esc(workspace.workspaceId)}</code></p><details><summary>Balance history</summary>${workspace.history?.length ? '<ul>' + workspace.history.slice(0,50).map(item=>`<li>${esc(item.kind)} · ${money(item.amountCents)} · ${esc(new Date(item.createdAt).toLocaleString())}${item.jobId ? ' <button type="button" class="ai-ref" data-aa-job="'+esc(item.jobId)+'">View analysis</button>' : ''}</li>`).join('') + '</ul>' : '<p>No payments or charges yet.</p>'}</details>` : `<div class="ai-inline"><button class="arena-button" type="button" data-aa="create" ${work || !cap?.analysisEnabled ? 'disabled' : ''}>Create private workspace</button><label>Recovery credential <input type="password" id="aa-recovery" autocomplete="off" maxlength="256"></label><button class="arena-button" type="button" data-aa="recover" ${work ? 'disabled' : ''}>Recover workspace</button></div><p class="ai-muted">Your browser session identifies your workspace. Save its recovery credential to restore access on another browser.</p>`}
        ${state.recovery ? `<div class="aa-recovery"><strong>Save your recovery credential now.</strong><p>This is shown only in this session. Anyone with it can access the workspace and spend its balance.</p><code>${esc(state.recovery)}</code><button type="button" class="arena-button" data-aa="saved">I saved the credential</button></div>` : ''}</div>
        <div class="aa-selection"><h3>Choose up to six observations</h3><div class="ai-inline"><button class="arena-button" type="button" data-aa="add-current" ${disabled ? 'disabled' : ''}>Add current linked observation</button><label>Observation ID <input id="aa-observation" list="aa-observations" ${disabled ? 'disabled' : ''} maxlength="180" placeholder="Exact event ID"></label><datalist id="aa-observations">${recording.manifest.events.filter(event=>event.kind==='observation').slice(0,300).map(event=>`<option value="${esc(event.id)}"></option>`).join('')}</datalist><button class="arena-button" type="button" data-aa="add" ${disabled ? 'disabled' : ''}>Add observation</button></div><ul>${state.selected.map(id=>`<li><code>${esc(id)}</code> <button class="ai-ref" type="button" data-aa-remove="${esc(id)}" ${disabled ? 'disabled' : ''}>Remove</button></li>`).join('') || '<li>No observations selected.</li>'}</ul><p class="ai-muted">Both recorded cameras are included when available, up to twelve images. Prompt contents are excluded. Missing cameras remain disclosed.</p><button type="button" class="arena-button" data-aa="preview" ${disabled || !state.selected.length ? 'disabled' : ''}>Preview upload locally</button></div>
        ${state.preview ? `<div class="aa-preview"><h3>Exactly what will be sent</h3><p>${state.preview.images.length} images · ${state.preview.events.length} linked events · ${Math.ceil(bytes(JSON.stringify(state.preview)).length / 1024)} KiB. Prompt contents excluded.</p><div class="aa-images">${state.preview.images.map(image=>`<figure><img src="data:image/png;base64,${image.dataBase64}" alt="${esc(image.eventId + ' / ' + image.artifactId)}"><figcaption>${esc(image.eventId)} / ${esc(image.artifactId)} · ${image.width}×${image.height}</figcaption></figure>`).join('')}</div><ul class="ai-limits">${state.preview.context.limitations.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><details><summary>Exact context, telemetry and image digests</summary><pre>${esc(JSON.stringify({...state.preview,images:state.preview.images.map(({dataBase64,...image})=>image)},null,2))}</pre></details><p>Getting a quote uploads this selected evidence to BrainSNN. Only confirming analysis sends it to Google. Google documents 55-day abuse-monitoring retention; disabling conversation storage does not remove that retention. <a href="https://ai.google.dev/gemini-api/docs/usage-policies" target="_blank" rel="noopener noreferrer">Google data-use policy</a>. Results are available from this service for seven days; download a copy.</p><button class="arena-button" type="button" data-aa="quote" ${disabled || !workspace || !cap?.analysisEnabled || wallet?.frozen ? 'disabled' : ''}>Get fixed quote</button></div>` : ''}
        ${quote ? `<div class="aa-quote"><h3>${money(quote.amountCents)} fixed analysis quote</h3><p>${quoteValid ? 'Expires ' + esc(new Date(quote.expiresAt).toLocaleTimeString()) : 'Quote expired. Get a new quote.'} · No automatic retries or extra charges.</p><p>A usable result settles this price. Technical failures do not charge your balance. An uncertain attempt may still require service reconciliation.</p><button type="button" class="arena-button" data-aa="analyze" ${disabled || !quoteValid || (wallet?.availableCents || 0) < quote.amountCents || wallet?.frozen ? 'disabled' : ''}>Analyze for ${money(quote.amountCents)}</button>${(wallet?.availableCents || 0) < quote.amountCents ? '<p>Add credit before confirming this quote.</p>' : ''}</div>` : ''}
        ${state.job ? `<p class="aa-job" role="status">Analysis ${esc(state.job.id)}: ${esc(state.job.status)}${state.job.status === 'running' ? '. You can close this panel; the server job continues.' : ''}${state.job.status === 'uncertain' ? '. No customer charge; service reconciliation is pending. This request will not retry automatically.' : ''}${state.job.error ? ' · ' + esc(state.job.error) : ''}</p>` : ''}
      `}<div class="aa-sidecar"><label class="arena-button ai-file">Import saved analysis<input type="file" id="aa-import" accept=".json,application/json" aria-label="Import saved analysis"></label><p class="ai-muted">Import and export stay local. Saved analyses never modify the original recording.</p></div>${resultPanel()}</section>`;
    }
    async function poll() {
      if (!active() || !state.job || (terminal(state.job.status) && state.job.status !== 'succeeded')) return;
      try {
        const jobId=state.job.id,version=accountVersion;
        const response = await request('/jobs/' + encodeURIComponent(jobId)); if (!active()||state.job?.id!==jobId||version!==accountVersion) return;
        state.job = response.job;
        if (state.job.status === 'succeeded' && state.job.result) {
          const retainedEvidence=state.jobEvidence && await digest(state.jobEvidence) === state.job.result.inputDigest ? state.jobEvidence : state.job.evidenceSummary;
          if(!retainedEvidence)throw new Error('This saved result has no retained evidence summary. Reopen it with its original selected-evidence export.');
          const exported = {schema:'brainsnn.arena.analysis-export.v1',analysis:state.job.result,evidence:retainedEvidence};
          await validateExport(exported,recording,false,decodeArtifact); state.result = {...exported,imported:false}; lastResult=state.result; state.notice='Analysis saved separately. Download it before its seven-day service retention ends.';
        }
        if (terminal(state.job.status)) await refreshWallet();
      } catch (error) { if (active()) { state.error=error.message; state.notice='Status could not be refreshed. Refresh balance to resume polling; this does not resubmit the job.'; paint(); } return; }
      if (!active()) return; paint(); if (!terminal(state.job.status)) timer=setTimeout(poll,2500);
    }
    async function handle(event) {
      const savedJob=event.target.closest('[data-aa-job]');if(savedJob){await act(async()=>{clearTimeout(timer);state.job={id:savedJob.dataset.aaJob,status:'running'};state.jobEvidence=null;await poll();});return;}
      const ref = event.target.closest('[data-aa-ref]'); if(ref){navigate(ref.dataset.aaRef);return;}
      const remove = event.target.closest('[data-aa-remove]'); if(remove){if(work || state.job && !terminal(state.job.status))return;state.selected=state.selected.filter(id=>id!==remove.dataset.aaRemove);invalidate();paint();return;}
      const button=event.target.closest('[data-aa]'); if(!button || button.disabled)return; const action=button.dataset.aa;
      if(action==='saved'){state.recovery=null;paint();return;}
      if(action==='export'){download({schema:'brainsnn.arena.analysis-export.v1',analysis:state.result.analysis,evidence:state.result.evidence},'brainsnn-analysis.json');return;}
      const recovery=$('#aa-recovery')?.value, observation=$('#aa-observation')?.value.trim();
      await act(async()=>{
        if(action==='open'){state.opened=true;state.capabilities=await request('/capabilities');await refreshWallet();if(state.job&&!terminal(state.job.status))poll();}
        if(action==='refresh'){state.capabilities=await request('/capabilities');await refreshWallet();if(state.job&&!terminal(state.job.status)){clearTimeout(timer);poll();}}
        if(action==='create'){accountVersion++;const response=await request('/workspaces',{});clearAccountState();workspace=response;state.recovery=response.recoveryCode;await refreshWallet();}
        if(action==='recover'){if(!recovery)throw new Error('Enter your recovery credential.');accountVersion++;const response=await request('/recover',{recoveryCode:recovery});clearAccountState();workspace=response;await refreshWallet();}
        if(action==='logout'){accountVersion++;await request('/logout',{});workspace=null;clearAccountState();state.notice='Signed out. Any accepted server job continues; recover this workspace to retrieve its result.';}
        if(action==='topup'){const response=await request('/checkout',{requestId:crypto.randomUUID()});const url=new URL(response.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Checkout returned an unsupported destination.');window.location.assign(url.href);}
        if(action==='add-current')add(currentObservation()); if(action==='add')add(observation);
        if(action==='preview'){state.preview=await buildEvidence(recording,state.selected,decodeArtifact);state.quote=null;state.notice='Preview prepared locally. Nothing has been uploaded.';}
        if(action==='quote'){const response=await request('/quotes',{evidence:state.preview});if(response.quote.inputDigest!==await digest(state.preview))throw new Error('Quote does not match the selected evidence.');state.quote=response.quote;}
        if(action==='analyze'){if(!state.quote||new Date(state.quote.expiresAt).getTime()<=Date.now())throw new Error('Quote expired. Get a new quote.');if(await digest(state.preview)!==state.quote.inputDigest)throw new Error('Evidence changed. Get a new quote.');const response=await request('/jobs',{quoteId:state.quote.id,evidence:state.preview});state.job=response.job;state.jobEvidence=state.preview;state.quote=null;await refreshWallet();poll();}
      });
    }
    async function change(event) {
      if(event.target.id!=='aa-import')return;const file=event.target.files?.[0];if(!file)return;
      await act(async()=>{if(file.size>10*1024*1024)throw new Error('Analysis file exceeds 10 MiB.');const exported=JSON.parse(await file.text());await validateExport(exported,recording,true,decodeArtifact);state.result={...exported,imported:true};lastResult=state.result;state.opened=true;state.notice='Saved analysis checked locally. Provider identity remains unverified.';});
    }
    element.addEventListener('click',handle);element.addEventListener('change',change);paint();
    if(state.opened && state.job && !terminal(state.job.status))timer=setTimeout(poll,1000);
    return {destroy(){stopped=true;clearTimeout(timer);element.removeEventListener('click',handle);element.removeEventListener('change',change);},setSelectedEvent(id){selectedEventId=id;}};
  }
  async function validateExport(value,recording,allowStale,decodeArtifact) {
    const a=value?.analysis,e=value?.evidence;
    if(value?.schema!=='brainsnn.arena.analysis-export.v1'||a?.schema!==OUTPUT||e?.schema!==INPUT||!hex(a.manifestSha256)||!hex(a.inputDigest)||a.manifestSha256!==e.manifestSha256||a.recordingId!==e.recordingId||e.includePrompts!==false||!Array.isArray(e.images)||!e.images.length||e.images.length>12||!Array.isArray(e.events)||e.events.length>100||!Array.isArray(e.selectedEventIds)||!e.selectedEventIds.length||e.selectedEventIds.length>6)throw new Error('Invalid analysis export.');
    for(const image of e.images){
      if(image.mimeType!=='image/png'||!hex(image.sha256)||!hex(image.originalSha256)||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>512||image.height>512)throw new Error('Invalid analysis image.');
      // Completed server jobs retain only this metadata. Full local exports may
      // also retain pixels, in which case those bytes must be checked.
      if(image.dataBase64===undefined)continue;
      if(typeof image.dataBase64!=='string'||image.dataBase64.length>2097152||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64))throw new Error('Invalid analysis image bytes.');
      const raw=Uint8Array.from(atob(image.dataBase64),c=>c.charCodeAt(0));
      if(await sha(raw)!==image.sha256)throw new Error('Analysis image hash mismatch.');
      const view=new DataView(raw.buffer);
      if(raw.length<33||raw[0]!==137||String.fromCharCode(...raw.slice(1,8))!=='PNG\r\n\u001a\n'||String.fromCharCode(...raw.slice(12,16))!=='IHDR'||view.getUint32(16)!==image.width||view.getUint32(20)!==image.height)throw new Error('Analysis image dimensions or encoding are invalid.');
    }
    if(await digest(e)!==a.inputDigest)throw new Error('Analysis input digest mismatch.');
    if(typeof a.model!=='string'||typeof a.promptVersion!=='string'||!Array.isArray(a.hypotheses)||a.hypotheses.length>32||!Array.isArray(a.suggestedExperiments)||a.suggestedExperiments.length>32||!strings(a.missingInformation)||!Array.isArray(a.coverage?.selectedEventIds)||!Array.isArray(a.coverage?.imageIds)||!strings(a.coverage?.limitations))throw new Error('Invalid analysis result structure.');
    const refs=new Set([...e.events.map(event=>event.id),...e.images.map(image=>image.id)]);
    if(refs.size!==e.events.length+e.images.length)throw new Error('Analysis has duplicate evidence identifiers.');
    for(const item of [...a.hypotheses,...a.suggestedExperiments])if(typeof item.summary!=='string'||item.summary.length>8000||!strings(item.refs)||item.refs.some(id=>!refs.has(id)))throw new Error('Analysis contains an unknown evidence reference.');
    for(const item of a.hypotheses)if(!strings(item.counterevidence)||!strings(item.limitations))throw new Error('Invalid hypothesis details.');
    for(const item of a.suggestedExperiments)if(typeof item.expectedObservation!=='string'||item.expectedObservation.length>8000)throw new Error('Invalid experiment details.');
    if(canonical(a.coverage.selectedEventIds)!==canonical(e.selectedEventIds)||canonical(a.coverage.imageIds)!==canonical(e.images.map(image=>image.id)))throw new Error('Analysis coverage differs from submitted evidence.');
    const stale=a.manifestSha256!==recording.bundle.manifestSha256||a.recordingId!==recording.manifest.recordingId;
    if(stale){if(!allowStale)throw new Error('Analysis belongs to a different recording. Open that original recording to review this result.');return;}
    if(e.sourceKind!==recording.manifest.source.kind||e.context?.task!==(typeof recording.manifest.context.taskId==='string'?recording.manifest.context.taskId.slice(0,180):undefined)||e.context?.model!==(typeof recording.manifest.context.modelId==='string'?recording.manifest.context.modelId.slice(0,180):undefined))throw new Error('Analysis source context differs from this recording.');
    const expected=relatedEvents(recording,e.selectedEventIds);
    if(canonical(expected)!==canonical(e.events))throw new Error('Analysis telemetry does not match this recording.');
    for(const image of e.images){
      const artifact=recording.manifest.artifacts.find(item=>item.id===image.artifactId),event=recording.manifest.events.find(item=>item.id===image.eventId);
      if(!artifact||artifact.sha256!==image.originalSha256||!e.selectedEventIds.includes(image.eventId)||!event?.data.cameras?.some(camera=>camera.artifactId===artifact.id))throw new Error('Analysis image does not bind to this recording.');
      if(image.dataBase64!==undefined){
        const regenerated=await derivative(recording,event,event.data.cameras.find(camera=>camera.artifactId===artifact.id),decodeArtifact,1);
        if(regenerated.sha256!==image.sha256){
          // PNG compression varies by browser. Compare decoded pixels before
          // declaring different evidence; never accept only a claimed source hash.
          const pixelBytes=async encoded=>{
            const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([raw],{type:'image/png'}));
            try{if(bitmap.width!==image.width||bitmap.height!==image.height)throw new Error('Analysis derivative dimensions differ.');const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);return context.getImageData(0,0,canvas.width,canvas.height).data;}finally{bitmap.close();}
          };
          const [actual,expectedPixels]=await Promise.all([pixelBytes(image.dataBase64),pixelBytes(regenerated.dataBase64)]);
          if(actual.length!==expectedPixels.length||actual.some((value,index)=>value!==expectedPixels[index]))throw new Error('Analysis derivative pixels differ from this recording.');
        }
      }
    }
  }
  window.BrainSNNPaidAnalysis=Object.freeze({mount,build:'paid-analysis-2026-10-17-v1'});
})();
