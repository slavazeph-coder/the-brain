/* Inert, local inspection of integrity-checked Arena recording bundles.
 * This module has no worker client or control path. A caller may provide a
 * read-only loader; imported files never cause network requests. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const display = value => value == null ? 'unavailable' : typeof value === 'string' ? value : JSON.stringify(value);
  const pretty = value => JSON.stringify(value, null, 2);
  const maxFileBytes = 128 * 1024 * 1024, reviewsKey = 'brainsnn.arena.recording-reviews.v1';
  let dialog = null, trigger = null, load = null, generation = 0, candidate = null, baseline = null, selected = 0, comparison = null, busy = false, error = '', notice = '', urls = [];
  const api = () => window.BrainSNNArenaRecording;
  const $ = selector => dialog?.querySelector(selector);
  const eventMap = recording => new Map(recording.manifest.events.map(event => [event.id, event]));
  function ancestors(recording, event) {
    const map = eventMap(recording), found = [], pending = event ? [event.id] : [], seen = new Set();
    // Follow recorded relationships only. A nearby timestamp is not a link.
    while (pending.length && found.length < 512) {
      const id = pending.shift(); if (seen.has(id)) continue; seen.add(id);
      const item = map.get(id); if (!item) continue; found.push(item); pending.push(...item.refs);
    }
    return found;
  }
  function vector(event) {
    let value = event?.kind === 'dataset-action' ? event.data.action : event?.data.vector ?? event?.data.state;
    if (value?.skill === 'move_to') value = value.position;
    else if (event?.kind === 'state' && event.data.coverage === 'scripted snapshot') value = value?.robot?.position;
    return Array.isArray(value) && value.length <= 256 && value.every(finite) ? value : null;
  }
  function imageDimensions(raw, mediaType) {
    const be16 = i => raw[i] * 256 + raw[i + 1], le16 = i => raw[i] + raw[i + 1] * 256;
    const be32 = i => raw[i] * 16777216 + raw[i + 1] * 65536 + raw[i + 2] * 256 + raw[i + 3];
    const le24 = i => raw[i] + raw[i + 1] * 256 + raw[i + 2] * 65536;
    const tag = i => String.fromCharCode(...raw.slice(i, i + 4));
    if (mediaType === 'image/png' && raw.length >= 24 && raw[0] === 137 && tag(1) === 'PNG\r' && tag(12) === 'IHDR') return [be32(16), be32(20)];
    if (mediaType === 'image/jpeg' && raw.length >= 4 && raw[0] === 255 && raw[1] === 216) {
      let i = 2;
      while (i + 4 <= raw.length) {
        if (raw[i++] !== 255) return null;
        while (raw[i] === 255) i++;
        const marker = raw[i++]; if (marker === 217 || marker === 218) return null;
        if (marker >= 208 && marker <= 216) continue;
        const size = be16(i); if (size < 2 || i + size > raw.length) return null;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size >= 8) return [be16(i + 5), be16(i + 3)];
        i += size;
      }
    }
    if (mediaType === 'image/webp' && raw.length >= 30 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
      if (tag(12) === 'VP8X') return [le24(24) + 1, le24(27) + 1];
      if (tag(12) === 'VP8 ' && raw[23] === 157 && raw[24] === 1 && raw[25] === 42) return [le16(26) & 16383, le16(28) & 16383];
      if (tag(12) === 'VP8L' && raw[20] === 47) return [1 + raw[21] + ((raw[22] & 63) << 8), 1 + (raw[22] >> 6) + (raw[23] << 2) + ((raw[24] & 15) << 10)];
    }
    return null;
  }
  function findings(recording) {
    const result = [...recording.manifest.findings];
    for (const finding of api().deriveFindings(recording.manifest)) {
      if (!result.some(item => item.origin === finding.origin && item.summary === finding.summary && JSON.stringify(item.refs) === JSON.stringify(finding.refs))) result.push(finding);
    }
    return result;
  }
  function reference(id, recording = candidate, prefix = '') {
    if (recording.manifest.events.some(event => event.id === id)) return `<button type="button" class="ai-ref" data-${prefix}event="${esc(id)}">${esc(id)}</button>`;
    const artifact = recording.manifest.artifacts.find(item => item.id === id);
    if (artifact) return artifact.retention === 'included' ? `<button type="button" class="ai-ref" data-${prefix}artifact="${esc(id)}">${esc(id)} · original</button>` : `<code>${esc(id)} · original omitted</code>`;
    return `<code>${esc(id)}</code>`;
  }
  function revoke(scope) { urls = urls.filter(item => { if (!scope || item.scope === scope) { URL.revokeObjectURL(item.url); return false; } return true; }); }
  function fileURL(bytes, type, scope) { const url = URL.createObjectURL(new Blob([bytes], { type })); urls.push({ url, scope }); return url; }
  function download(bytes, name, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([bytes], { type })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function close() {
    generation++; revoke(); const restore = trigger;
    if (dialog) { dialog.close?.(); dialog.remove(); }
    dialog = null; candidate = baseline = comparison = null; load = null; trigger = null; busy = false;
    if (restore?.isConnected) restore.focus();
  }
  function shell() {
    dialog.innerHTML = `<div class="ai-shell"><header class="ai-header"><div><p class="ai-eyebrow">ARENA / INSPECTION</p><h1 id="ai-title">Inspect a recording</h1><p>Follow the inputs, actions and evidence behind one run.</p></div><button type="button" class="arena-button" data-action="close" aria-label="Close recording inspector">Close</button></header>
      <div class="ai-toolbar"><label class="arena-button ai-file">Open recording<input type="file" id="ai-file" accept=".json,application/json" aria-label="Open recording file"></label>
      <label class="arena-button ai-file">Import baseline<input type="file" id="ai-baseline" accept=".json,application/json" aria-label="Import baseline file"></label>${load ? '<button type="button" class="arena-button" data-action="reload">Reload run recording</button>' : ''}
      <span>Local inspection · no worker commands</span></div><p id="ai-status" role="status" aria-live="polite"></p><p id="ai-error" role="alert"></p><div id="ai-content"></div></div>`;
    dialog.addEventListener('click', handleClick); dialog.addEventListener('change', handleChange);
    dialog.addEventListener('input', event => { if (event.target.id === 'ai-position' && candidate) selectEvent(Number(event.target.value)); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('submit', event => { event.preventDefault(); if (event.target.id === 'ai-jump') jump($('#ai-event-id').value); if (event.target.id === 'ai-review-form') saveReview(); if (event.target.id === 'ai-compare-form') compare(); });
  }
  function status() {
    if (!dialog) return;
    $('#ai-status').textContent = busy ? 'Checking schema, manifest bytes and original artifact hashes…' : notice;
    $('#ai-error').textContent = error;
    dialog.querySelectorAll('input[type="file"], [data-action="reload"]').forEach(input => { input.disabled = busy; });
  }
  async function ingest(input, asBaseline = false, token = generation) {
    busy = true; error = ''; notice = ''; status();
    try {
      const validated = await api().importBundle(input, { allowLegacy: true });
      if (token !== generation || !dialog) return;
      if (asBaseline) baseline = validated;
      else { candidate = validated; selected = 0; }
      comparison = null; notice = (asBaseline ? 'Baseline' : 'Recording') + ' checked. Source identity remains declared.';
      render();
    } catch (failure) { if (token === generation) { error = `Could not open recording: ${failure.message || 'Invalid recording bundle.'}`; } }
    finally { if (token === generation) { busy = false; status(); } }
  }
  async function readFile(file, asBaseline) {
    if (!file) return;
    if (file.size > maxFileBytes) { error = 'This file exceeds the 128 MiB recording limit. Export a smaller recording or selected bundle.'; status(); return; }
    const token = generation; busy = true; error = ''; status();
    try { const input = await file.text(); if (token === generation) await ingest(input, asBaseline, token); }
    catch (failure) { if (token === generation) { busy = false; error = 'Could not read this file: ' + failure.message; status(); } }
  }
  async function reload() {
    if (!load || busy) return;
    const token = generation; busy = true; error = ''; notice = ''; status();
    try { const input = await load(); if (token === generation) await ingest(input, false, token); }
    catch (failure) { if (token === generation) { busy = false; error = 'Recording unavailable: ' + failure.message + ' Use Reload run recording if the worker is still finalizing.'; status(); } }
  }
  function open(options = {}) {
    close(); trigger = options.trigger || document.activeElement; load = typeof options.load === 'function' ? options.load : null; error = ''; notice = '';
    dialog = document.createElement('dialog'); dialog.className = 'arena-recording-inspector'; dialog.setAttribute('aria-labelledby', 'ai-title'); document.body.appendChild(dialog); shell(); render();
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    if (!api()) { error = 'The recording validator is unavailable. Reload the page.'; status(); return; }
    if (options.input != null) return ingest(options.input);
    if (load) return reload();
  }
  function summary(recording) {
    const m = recording.manifest, v = recording.verification, c = m.completion;
    return `<section class="ai-summary"><div><span class="ai-badge ${m.source.kind === 'scripted-practice' ? 'ai-warning' : ''}">${esc(m.source.kind)}</span><span class="ai-badge ${c.status !== 'complete' ? 'ai-warning' : ''}">${esc(c.status)} evidence</span><h2>${esc(m.context.taskLabel || m.context.taskId || 'Task not specified')}</h2><p>${esc(m.recordingId)}</p>${m.source.kind === 'scripted-practice' ? '<p class="ai-limit">Scripted local practice. No named model ran; this is not a model score.</p>' : ''}</div>
      <dl class="ai-facts"><div><dt>Integrity</dt><dd>Schema valid · hashes match</dd></div><div><dt>Originals</dt><dd>${v.sourcesPresent ? 'All declared artifacts included' : 'Some artifacts omitted'}</dd></div><div><dt>Producer identity</dt><dd>Declared, not authenticated</dd></div><div><dt>Task checker</dt><dd>${esc(m.outcome.status)} · producer report</dd></div><div><dt>Coverage</dt><dd>${m.events.length} events · ${c.gapCount} reported gaps${c.unknownTail ? ' · unknown tail' : ''}</dd></div><div><dt>Committed / observed sequence</dt><dd>${c.committedSequence} / ${c.lastObservedSequence}</dd></div></dl>
      <details class="ai-wide"><summary>Exact identity, context and clocks</summary><p>SHA256 <code class="ai-hash">${esc(recording.bundle.manifestSha256)}</code></p><pre>${esc(pretty({ source: m.source, context: m.context, clocks: m.clocks, completion: c }))}</pre></details></section>`;
  }
  function eventHeading(event) { return event ? `${event.kind} · ${event.id}${finite(event.simTime) ? ' · ' + event.simTime.toFixed(3) + ' s' : ' · time unavailable'}` : 'No retained event'; }
  function timeline() {
    const events = candidate.manifest.events, current = events[selected], start = Math.max(0, Math.min(selected - 20, events.length - 60));
    return `<section class="ai-section"><div class="ai-section-heading"><h2>Recorded timeline</h2><span>Ordered by event sequence; clocks are not silently synchronized.</span></div>
      <div class="ai-transport"><button type="button" class="arena-button" data-action="previous" ${selected === 0 ? 'disabled' : ''} aria-label="Previous recorded event">←</button><input id="ai-position" type="range" min="0" max="${Math.max(0, events.length - 1)}" value="${selected}" ${!events.length ? 'disabled' : ''} aria-label="Recorded event position"><button type="button" class="arena-button" data-action="next" ${selected >= events.length - 1 ? 'disabled' : ''} aria-label="Next recorded event">→</button></div>
      <p id="ai-selected-event" aria-live="polite">${esc(eventHeading(current))}</p><form id="ai-jump" class="ai-inline"><label>Jump to event ID <input id="ai-event-id" maxlength="160" placeholder="Exact recorded ID" autocomplete="off"></label><button class="arena-button" type="submit">Go to event</button></form>
      <div class="ai-event-strip" aria-label="Recorded events">${events.slice(start, start + 60).map(event => `<button type="button" data-event="${esc(event.id)}" class="ai-event ${event === current ? 'is-selected' : ''}" ${event === current ? 'aria-current="true"' : ''}><span>${esc(event.kind)}</span><code>${esc(event.id)}</code><small>#${event.seq}${finite(event.simTime) ? ' · ' + event.simTime.toFixed(3) + ' s' : ''}</small></button>`).join('')}</div>${events.length > 60 ? `<p class="ai-muted">Showing ${start + 1}–${Math.min(events.length, start + 60)} of ${events.length}. The slider and exact ID search reach every event.</p>` : ''}</section>`;
  }
  function recordedCameras(observation) {
    return Array.isArray(observation?.data.cameras) ? observation.data.cameras.filter(item => item && typeof item === 'object' && typeof item.id === 'string').slice(0, 16) : [];
  }
  function cameraPanels(recording, event, scope) {
    const linked = ancestors(recording, event), observations = linked.filter(item => item.kind === 'observation'), obs = observations[0];
    const cameras = recordedCameras(obs), isDataset = cameras.some(camera => camera.role === 'dataset-camera');
    const expected = isDataset ? cameras.map(camera => camera.id) : ['agentview', 'wrist', ...cameras.filter(camera => !['agentview', 'wrist'].includes(camera.id)).map(camera => camera.id)];
    return `<section class="ai-section"><h3>${scope === 'baseline' ? 'Baseline · ' : ''}${isDataset ? 'Dataset camera frames' : 'Recorded camera evidence'}</h3><p class="ai-muted">${obs ? `Linked observation ${esc(obs.id)}${observations.length > 1 ? ' · multiple linked observations; showing first reference' : ''}` : 'No observation linked by recorded event IDs. Camera timing is not guessed.'}${isDataset ? ' · Dataset pixels; policy consumption is unverified.' : ''}</p>
      <div class="ai-cameras">${expected.map((id, index) => {
        const camera = cameras.find(item => item.id === id), artifact = recording.manifest.artifacts.find(item => item.id === camera?.artifactId);
        return `<figure class="ai-camera"><figcaption>${esc(id)} <span>${camera?.role === 'spectator' ? 'spectator · not policy input' : isDataset ? 'dataset frame' : recording.manifest.source.kind === 'simulator-policy' ? 'declared policy input' : 'policy consumption unverified'}</span></figcaption><div class="ai-image" id="ai-image-${scope}-${index}" data-camera-scope="${scope}" data-camera-index="${index}">${artifact ? esc(artifact.retention === 'included' ? 'Decoding checked artifact…' : 'Original omitted · ' + (artifact.omissionReason || 'No pixels available')) : 'No recorded pixels available'}</div>${artifact ? `<p>${reference(artifact.id, recording, scope === 'baseline' ? 'baseline-' : '')} · ${esc(artifact.mediaType)}</p>` : ''}${camera ? `<details><summary>Frame provenance and clock</summary><pre>${esc(pretty(camera))}</pre></details>` : ''}</figure>`;
      }).join('')}</div>${recording.manifest.source.kind === 'scripted-practice' && event?.kind === 'state' && event.data.state && !Array.isArray(event.data.state) ? `<figure class="ai-camera ai-practice"><figcaption>Recorded scripted state <span>Re-rendered view · not a captured policy input</span></figcaption><canvas id="ai-practice-${scope}" width="720" height="400" aria-label="Re-rendered scripted practice state"></canvas></figure>` : ''}</section>`;
  }
  function details(recording, event, scope = 'candidate') {
    if (!event) return '<p>No events were retained.</p>';
    const linked = ancestors(recording, event), chunk = linked.find(item => ['inference-result', 'chunk'].includes(item.kind));
    const chosen = chunk ? recording.manifest.events.filter(item => ['controller-input', 'action'].includes(item.kind) && (item.data.chunkId === chunk.id || item.refs.includes(chunk.id))) : [];
    return `<section class="ai-section"><h3>${scope === 'baseline' ? 'Baseline event' : 'Selected event'} · ${esc(event.id)}</h3><p>${esc(event.kind)}${event.kind === 'controller-input' ? ' · chosen input to the controller, not measured motor output' : event.kind === 'dataset-action' ? ' · dataset label; execution unverified' : ''}</p>
      <p class="ai-links">Recorded references: ${event.refs.length ? event.refs.map(id => reference(id, recording, scope === 'baseline' ? 'baseline-' : '')).join(' ') : 'none'}</p>
      <p class="ai-links">Original artifacts: ${event.artifactIds.length ? event.artifactIds.map(id => reference(id, recording, scope === 'baseline' ? 'baseline-' : '')).join(' ') : 'none attached to this event'}</p>
      ${vector(event) ? `<p class="ai-vector"><strong>${event.kind === 'state' || event.kind === 'observation' ? 'State' : event.kind === 'dataset-action' ? 'Dataset action' : 'Controller input'}:</strong> ${esc(vector(event).map(n => Number(n.toPrecision(6))).join(', '))}</p>` : ''}
      ${chunk ? `<div class="ai-chunk"><h4>Predicted chunk · ${esc(chunk.id)}</h4><p>${Array.isArray(chunk.data.actions) ? chunk.data.actions.length : 'Unknown'} predicted vectors · ${esc(chunk.data.queuedCount ?? 'unknown')} queued · ${esc(chunk.data.unusedCount ?? 'unknown')} initially unused</p><p>Recorded chosen inputs: ${chosen.length ? chosen.slice(0, 100).map(item => reference(item.id, recording, scope === 'baseline' ? 'baseline-' : '')).join(' ') : 'none linked'}</p><p class="ai-muted">Predictions are not execution. Each chosen input retains its recorded chunk index.</p><details><summary>Predicted vectors and chunk metadata</summary><pre>${esc(pretty(chunk.data))}</pre></details></div>` : ''}
      <details open><summary>Recorded event data</summary><pre>${esc(pretty(event))}</pre></details></section>`;
  }
  function charts() {
    const scripted = candidate.manifest.source.kind === 'scripted-practice';
    const groups = [['controller-input', scripted ? 'Scripted move_to target position' : 'Chosen controller input'], ['state', scripted ? 'Scripted robot.position' : 'Recorded state'], ['dataset-action', 'Dataset action labels · execution unverified']];
    return `<section class="ai-section"><h2>Numeric evidence</h2><p class="ai-muted">Dots are retained values, not interpolation. Horizontal position is recorded event order. Units and semantics come from the context below.</p>${groups.map(([kind, title]) => {
      let samples = candidate.manifest.events.filter(event => event.kind === kind && vector(event));
      const total = samples.length; if (!total) return kind === 'dataset-action' ? '' : `<h3>${title}</h3><p>No numeric ${esc(kind)} vectors recorded.</p>`;
      const stride = Math.max(1, Math.ceil(total / 600)); samples = samples.filter((_, index) => index % stride === 0);
      const dimensions = Math.min(16, Math.max(...samples.map(event => vector(event).length)));
      return `<h3>${title}</h3>${stride > 1 ? `<p class="ai-muted">Plot samples every ${stride}th vector; all ${total} vectors remain in the event timeline.</p>` : ''}${Array.from({ length: dimensions }, (_, dimension) => {
        const values = samples.map(event => vector(event)[dimension]).filter(finite); if (!values.length) return '';
        const min = Math.min(...values), max = Math.max(...values), scale = Math.max(Math.abs(min), Math.abs(max), 1), scaledMin = min / scale, span = max / scale - scaledMin || 1;
        return `<div class="ai-chart"><span>[${dimension}]</span><svg viewBox="0 0 600 48" role="img" aria-label="${esc(title)} component ${dimension}, range ${min} to ${max}"><path d="M0 44H600" class="ai-axis"/>${samples.map((event, index) => { const value = vector(event)[dimension]; return finite(value) ? `<circle data-event="${esc(event.id)}" cx="${((index / Math.max(1, samples.length - 1)) * 592 + 4).toFixed(2)}" cy="${(40 - (value / scale - scaledMin) / span * 34).toFixed(2)}" r="${event.id === candidate.manifest.events[selected]?.id ? '4' : '2'}"><title>${esc(event.id)}: ${value}</title></circle>` : ''; }).join('')}</svg><small>${Number(min.toPrecision(4))}…${Number(max.toPrecision(4))}</small></div>`;
      }).join('')}`;
    }).join('')}<details><summary>Recorded vector semantics</summary><pre>${esc(pretty({ action: candidate.manifest.context.actionSemantics, state: candidate.manifest.context.stateSemantics, units: candidate.manifest.context.units }))}</pre></details></section>`;
  }
  function findingsPanel() {
    const items = findings(candidate), limits = [...candidate.verification.limitations, candidate.manifest.source.limitation, candidate.manifest.completion.reason].filter(Boolean);
    return `<section class="ai-section ai-findings"><h2>Findings and known limits</h2><p>Facts, rules, hypotheses and human judgments remain separately labelled. A link locates evidence; it does not establish a cause.</p><ul class="ai-limits">${limits.map(item => `<li>${esc(item)}</li>`).join('')}<li>Recorded controller inputs do not establish physical motor execution. Missing events and unsynchronized clocks cannot be reconstructed here.</li></ul>
      ${items.length ? items.map(item => `<article class="ai-finding"><span class="ai-badge">${esc(item.origin)}</span><h3>${esc(item.summary)}</h3><p class="ai-muted">${esc(item.producer || 'Producer not specified')} · ${esc(item.id)}</p><div class="ai-links">${item.refs.map(id => reference(id)).join(' ')}</div>${Array.isArray(item.limitations) && item.limitations.length ? `<ul>${item.limitations.map(limit => `<li>${esc(limit)}</li>`).join('')}</ul>` : ''}<button type="button" class="arena-button" data-review="${esc(item.id)}">Review this finding</button></article>`).join('') : '<p>No supported findings in this recording. Absence of a finding is not evidence that the run is correct.</p>'}</section>`;
  }
  function comparisonPanel() {
    if (!baseline) return '<section class="ai-section"><h2>Compare a baseline</h2><p>Import another recording, then declare an alignment. Compatibility is checked before a difference is reported.</p></section>';
    const compat = api().comparisonCompatibility(baseline, candidate), diff = comparison?.firstDivergence;
    return `<section class="ai-section ai-comparison"><h2>Compare with ${esc(baseline.manifest.recordingId)}</h2><p class="ai-badge ${compat.compatible ? '' : 'ai-warning'}">${compat.compatible ? 'Comparable context' : 'Comparison blocked · incompatible or unknown context'}</p>${compat.issues.length ? `<ul>${compat.issues.map(issue => `<li>${esc(issue.field)}: ${esc(issue.reason)}</li>`).join('')}</ul>` : ''}<details><summary>Context differences (${compat.differences.length})</summary><pre>${esc(pretty(compat.differences))}</pre></details>
      <form id="ai-compare-form"><fieldset><legend>Declare alignment</legend><label>Method <select id="ai-alignment"><option value="simTime">Simulation time with explicit offset</option><option value="event">Two recorded event IDs</option></select></label><label>Candidate time offset (seconds) <input id="ai-offset" type="number" value="0" step="any"></label><label>Baseline event ID <input id="ai-baseline-event" maxlength="160" placeholder="${esc(baseline.manifest.events[0]?.id || '')}"></label><label>Candidate event ID <input id="ai-candidate-event" maxlength="160" placeholder="${esc(candidate.manifest.events[0]?.id || '')}"></label><button type="submit" class="arena-button" ${compat.compatible ? '' : 'disabled'}>Compare aligned evidence</button></fieldset></form>
      <p class="ai-muted">Candidate time + offset = baseline time. This is your declared alignment, not a recovered clock mapping.</p>${comparison ? `<div role="status"><h3>${diff ? 'First supported difference' : 'No supported difference found'}</h3>${diff ? `<p>${esc(diff.reason)}</p><p>Baseline ${reference(diff.baselineEventId, baseline, 'baseline-')} · Candidate ${reference(diff.candidateEventId)}</p>` : ''}<ul>${comparison.limitations.map(limit => `<li>${esc(limit)}</li>`).join('')}</ul><pre>${esc(pretty(comparison.alignment))}</pre></div>` : ''}<div id="ai-baseline-detail"></div></section>`;
  }
  function storedReviews() { try { const value = JSON.parse(localStorage.getItem(reviewsKey) || '[]'); return Array.isArray(value) ? value.filter(item => item && typeof item.recordingId === 'string' && item.review?.schema === 'brainsnn.arena.review.v1').slice(-200) : []; } catch { return []; } }
  function reviewPanel() {
    const items = findings(candidate), reviews = storedReviews().filter(item => item.recordingId === candidate.manifest.recordingId).slice(-20);
    return `<section class="ai-section" id="ai-review-section"><h2>Local review</h2><p>A decision binds this exact manifest hash and finding. Reviewer identity is self-declared; changed evidence makes the review stale.</p><form id="ai-review-form"><fieldset><legend>Record your judgment</legend><label>Evidence <select id="ai-review-finding"><option value="">Whole recording</option>${items.map(item => `<option value="${esc(item.id)}">${esc(item.summary.slice(0, 100))}</option>`).join('')}</select></label><label>Decision <select id="ai-review-decision"><option value="needs-evidence">Needs evidence</option><option value="accept">Accept</option><option value="reject">Reject</option></select></label><label>Your label <input id="ai-reviewer" maxlength="160" placeholder="Local reviewer" autocomplete="off"></label><button class="arena-button" type="submit">Save local review</button></fieldset></form><div id="ai-reviews">${reviews.map(item => { const state = api().reviewStatus(item.review, candidate); return `<article class="ai-review"><span class="ai-badge ${state.current ? '' : 'ai-warning'}">${state.current ? 'Current' : 'Stale'}</span> ${esc(item.review.decision)} · ${esc(item.review.reviewer?.label)}<p>${esc(item.review.findingId || 'Whole recording')} · ${esc(item.review.createdAt)}</p><p>${esc(state.reason)}</p><code class="ai-hash">${esc(item.review.manifestSha256)}</code></article>`; }).join('') || '<p>No local review saved for this recording.</p>'}</div><button type="button" class="arena-button" data-action="export-reviews">Export review history</button></section>`;
  }
  function exportPanel() {
    return `<section class="ai-section"><h2>Portable evidence</h2><p>Original imports may contain source data or personal information. Export the checked originals, or create a selected export with explicit omissions and a new manifest identity. Existing reviews stay bound to the original.</p><div class="ai-inline"><button type="button" class="arena-button" data-action="export">Export original bundle</button><label><input type="checkbox" id="ai-omit-images"> Omit images and video</label><label><input type="checkbox" id="ai-omit-prompts"> Omit prompts</label><button type="button" class="arena-button" data-action="export-selected">Export selected bundle</button></div><details><summary>Original artifacts (${candidate.manifest.artifacts.length})</summary><ul class="ai-artifacts">${candidate.manifest.artifacts.map(item => `<li><code>${esc(item.id)}</code> · ${esc(item.mediaType)} · ${item.byteLength} bytes · ${esc(item.retention)} ${item.retention === 'included' ? `<button class="ai-ref" type="button" data-artifact="${esc(item.id)}">Download original</button>` : ''}<small class="ai-hash">${esc(item.sha256)}</small></li>`).join('')}</ul></details></section>`;
  }
  function render() {
    if (!dialog) return; revoke();
    $('#ai-content').innerHTML = candidate ? summary(candidate) + `<div id="ai-timeline">${timeline()}</div><div id="ai-selection"></div>` + charts() + findingsPanel() + comparisonPanel() + reviewPanel() + exportPanel() : '<section class="ai-empty"><h2>Open the evidence behind a run.</h2><p>Choose an Arena recording bundle or an older Arena evidence JSON file. Originals and event relationships are checked before display. Legacy exports retain their known gaps.</p><p>Maximum file size: 128 MiB. Imported content is data only; no worker is connected or controlled.</p></section>';
    if (candidate) renderSelection(); status();
  }
  function renderSelection() {
    const event = candidate.manifest.events[selected];
    $('#ai-selection').innerHTML = cameraPanels(candidate, event, 'candidate') + details(candidate, event);
    paintCameras(candidate, event, 'candidate');
  }
  function paintCameras(recording, event, scope) {
    revoke(scope);
    const obs = ancestors(recording, event).find(item => item.kind === 'observation'), cameras = recordedCameras(obs);
    const ids = cameras.some(camera => camera.role === 'dataset-camera') ? cameras.map(camera => camera.id) : ['agentview', 'wrist', ...cameras.filter(camera => !['agentview', 'wrist'].includes(camera.id)).map(camera => camera.id)];
    ids.forEach((id, index) => {
      const camera = cameras.find(item => item.id === id), artifact = recording.manifest.artifacts.find(item => item.id === camera?.artifactId), target = $('#ai-image-' + scope + '-' + index);
      if (!target || !artifact || artifact.retention !== 'included') return;
      const raw = recording.payloads[artifact.path]; if (!raw) return;
      if (['image/png', 'image/jpeg', 'image/webp'].includes(artifact.mediaType)) {
        const dimensions = imageDimensions(raw, artifact.mediaType), declared = artifact.shape;
        if (!dimensions || dimensions.some(n => !Number.isSafeInteger(n) || n < 1 || n > 8192) || dimensions[0] * dimensions[1] > 16777216 || (declared && (declared.length !== 3 || declared[0] !== dimensions[1] || declared[1] !== dimensions[0]))) {
          target.textContent = 'Image dimensions are missing, inconsistent, or exceed the display limit. Original bytes remain downloadable.'; return;
        }
        const img = document.createElement('img'); img.alt = `${id} recorded ${camera.role === 'dataset-camera' ? 'dataset frame' : 'camera pixels'}`; img.decoding = 'async'; img.src = fileURL(raw, artifact.mediaType, scope);
        img.onload = () => { if (img.naturalWidth > 8192 || img.naturalHeight > 8192 || img.naturalWidth * img.naturalHeight > 16777216) target.textContent = 'Image dimensions exceed the inspector display limit.'; };
        img.onerror = () => { target.textContent = 'Checked bytes could not be decoded as this image type.'; }; target.replaceChildren(img);
      } else if (artifact.dtype === 'uint8' && artifact.shape?.length === 3 && [3, 4].includes(artifact.shape[2])) {
        const [height, width, channels] = artifact.shape;
        if (width > 4096 || height > 4096 || width * height > 4194304 || raw.byteLength !== height * width * channels) { target.textContent = 'Raw camera dimensions are unsupported for display.'; return; }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.setAttribute('aria-label', id + ' lossless raw camera pixels');
        const context = canvas.getContext('2d'), pixels = context.createImageData(width, height);
        for (let i = 0, p = 0; i < raw.length; i += channels, p += 4) { pixels.data[p] = raw[i]; pixels.data[p + 1] = raw[i + 1]; pixels.data[p + 2] = raw[i + 2]; pixels.data[p + 3] = channels === 4 ? raw[i + 3] : 255; }
        context.putImageData(pixels, 0, 0); target.replaceChildren(canvas);
      } else target.textContent = 'Original retained; this media encoding has no inline viewer. Download it from Original artifacts.';
    });
    const practiceCanvas = $('#ai-practice-' + scope);
    if (practiceCanvas && window.BrainArena3D) { try { window.BrainArena3D.render(practiceCanvas, event.data.state, { yaw: -0.95, pitch: 0.62, distance: 5.1 }); } catch { practiceCanvas.replaceWith(document.createTextNode('This scripted state could not be re-rendered. Its original data remains below.')); } }
  }
  function selectEvent(index) {
    if (!candidate) return; selected = Math.max(0, Math.min(candidate.manifest.events.length - 1, index));
    // Keep focus on the range during keyboard and pointer scrubbing.
    const focused = document.activeElement?.id, selectionStart = $('#ai-event-id')?.value;
    $('#ai-timeline').innerHTML = timeline(); renderSelection();
    dialog.querySelectorAll('.ai-chart circle[data-event]').forEach(point => point.setAttribute('r', point.dataset.event === candidate.manifest.events[selected]?.id ? '4' : '2'));
    if (focused === 'ai-position') $('#ai-position')?.focus(); if (selectionStart) $('#ai-event-id').value = selectionStart; status();
  }
  function jump(id) { const index = candidate?.manifest.events.findIndex(event => event.id === id.trim()) ?? -1; if (index < 0) { error = 'No retained event has that exact ID.'; status(); return; } error = ''; selectEvent(index); }
  function showBaseline(id) {
    const event = baseline?.manifest.events.find(item => item.id === id); if (!event) return;
    $('#ai-baseline-detail').innerHTML = cameraPanels(baseline, event, 'baseline') + details(baseline, event, 'baseline'); paintCameras(baseline, event, 'baseline');
    $('#ai-baseline-detail').scrollIntoView({ block: 'nearest' });
  }
  function compare() {
    if (!candidate || !baseline) return;
    const kind = $('#ai-alignment').value;
    const alignment = kind === 'event' ? { kind, baselineEventId: $('#ai-baseline-event').value.trim(), candidateEventId: $('#ai-candidate-event').value.trim() } : { kind, candidateOffset: Number($('#ai-offset').value) };
    if (kind === 'simTime' && (!$('#ai-offset').value.trim() || !finite(alignment.candidateOffset))) { error = 'Declare a finite time offset.'; status(); return; }
    if (kind === 'event' && (!baseline.manifest.events.some(event => event.id === alignment.baselineEventId && finite(event.simTime)) || !candidate.manifest.events.some(event => event.id === alignment.candidateEventId && finite(event.simTime)))) { error = 'Choose two exact recorded event IDs with simulation times.'; status(); return; }
    comparison = api().compareRecordings(baseline, candidate, { alignment }); error = '';
    if (comparison.firstDivergence) selected = candidate.manifest.events.findIndex(event => event.id === comparison.firstDivergence.candidateEventId);
    render();
    $('#ai-alignment').value = kind; $('#ai-offset').value = String(comparison.alignment?.candidateOffset ?? 0);
    if (kind === 'event') { $('#ai-baseline-event').value = alignment.baselineEventId; $('#ai-candidate-event').value = alignment.candidateEventId; }
    if (comparison.firstDivergence) showBaseline(comparison.firstDivergence.baselineEventId);
  }
  function saveReview() {
    if (!candidate) return;
    try {
      const review = api().createReview(candidate, { findingId: $('#ai-review-finding').value || null, decision: $('#ai-review-decision').value, reviewerLabel: $('#ai-reviewer').value });
      const reviews = [...storedReviews(), { recordingId: candidate.manifest.recordingId, review }].slice(-200), serialized = JSON.stringify(reviews);
      if (serialized.length > 1000000) throw new Error('Local review storage is full. Export the review history first.');
      localStorage.setItem(reviewsKey, serialized); notice = 'Review saved locally against the exact manifest hash.'; error = ''; render(); $('#ai-review-section').scrollIntoView({ block: 'nearest' });
    } catch (failure) { error = 'Review could not be saved: ' + failure.message; status(); }
  }
  async function exportSelected() {
    if (!candidate || busy) return;
    const source = candidate, token = generation, omitImages = $('#ai-omit-images').checked, omitPrompts = $('#ai-omit-prompts').checked;
    busy = true; error = ''; status();
    try { const bundle = await api().redactBundle(source, { omitImages, omitPrompts }); if (token !== generation) return;
      download(api().exportBundle(bundle), 'brainsnn-recording-selected.json'); notice = 'Selected export created with explicit omissions. New SHA256: ' + bundle.manifestSha256;
    } catch (failure) { if (token === generation) error = 'Export failed: ' + failure.message; }
    finally { if (token === generation) { busy = false; status(); } }
  }
  function handleChange(event) { if (event.target.id === 'ai-file') readFile(event.target.files?.[0], false); if (event.target.id === 'ai-baseline') readFile(event.target.files?.[0], true); }
  function handleClick(event) {
    const target = event.target.closest('[data-action],[data-event],[data-baseline-event],[data-artifact],[data-baseline-artifact],[data-review]'); if (!target) return;
    if (target.dataset.event) return jump(target.dataset.event);
    if (target.dataset.baselineEvent) return showBaseline(target.dataset.baselineEvent);
    if (target.dataset.review) { $('#ai-review-finding').value = target.dataset.review; $('#ai-review-section').scrollIntoView({ block: 'nearest' }); $('#ai-review-decision').focus(); return; }
    if (target.dataset.artifact || target.dataset.baselineArtifact) { const recording = target.dataset.baselineArtifact ? baseline : candidate, id = target.dataset.baselineArtifact || target.dataset.artifact; const artifact = recording?.manifest.artifacts.find(item => item.id === id); if (artifact?.retention === 'included') download(recording.payloads[artifact.path], artifact.id + '.bin', 'application/octet-stream'); return; }
    switch (target.dataset.action) {
      case 'close': return close(); case 'reload': return reload(); case 'previous': return selectEvent(selected - 1); case 'next': return selectEvent(selected + 1);
      case 'export': if (candidate) download(api().exportBundle(candidate), 'brainsnn-recording.json'); break;
      case 'export-selected': return exportSelected();
      case 'export-reviews': if (candidate) download(pretty({ schema: 'brainsnn.arena.review-history.v1', reviews: storedReviews().filter(item => item.recordingId === candidate.manifest.recordingId) }), 'brainsnn-review-history.json'); break;
    }
  }
  window.BrainSNNArenaInspector = Object.freeze({ open, close });
})();
