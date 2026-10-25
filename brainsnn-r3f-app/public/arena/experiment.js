/* One selected robot + model workspace. Viewing a robot never starts inference. */
(() => {
  'use strict';
  const STORAGE_KEY = 'brainsnn.experiment.v1';
  const $ = id => document.getElementById(id);
  const models = () => window.BrainSNNModels || [];
  const robots = () => window.BrainSNNRobots || [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const findRobot = id => robots().find(r => r.id === id);
  const findModel = id => models().find(m => m.id === id);
  const pureWorld = m => Boolean(m && m.type === 'world' && !(m.robotIds || []).length);
  let state = { robotId: null, modelId: null, task: '', seed: '42', note: '', mode: 'robot-preview', view: 'arena' };
  let viewerTimer = null;
  let lastNamedState = null;
  let renderGeneration = 0;
  let siteRendererPromise = null;

  function loadSiteRenderer() {
    if (window.BrainSNNSiteRenderer) return Promise.resolve();
    if (siteRendererPromise) return siteRendererPromise;
    siteRendererPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'site-renderer.js';
      script.async = true;
      const timeout = setTimeout(() => { script.remove(); siteRendererPromise = null; reject(new Error('The 3D viewer timed out. Please retry.')); }, 25000);
      script.onload = () => { clearTimeout(timeout); if (window.BrainSNNSiteRenderer) resolve(); else { siteRendererPromise = null; reject(new Error('The 3D viewer could not initialize.')); } };
      script.onerror = () => { clearTimeout(timeout); script.remove(); siteRendererPromise = null; reject(new Error('The 3D viewer could not load. Check your connection and retry.')); };
      document.body.appendChild(script);
    });
    return siteRendererPromise;
  }

  function describe() {
    const robot = findRobot(state.robotId), model = findModel(state.modelId);
    const world = pureWorld(model);
    let error = '', pairStatus = 'Choose a robot and model';
    if (state.robotId && !robot) error = 'This robot is not in the current catalog. Choose a listed robot.';
    else if (state.modelId && !model) error = 'This model is not in the current catalog. Choose a listed model.';
    else if (world && robot) error = model.name + ' generates world video and has no robot-control pairing. Clear the robot to use its world setup.';
    else if (robot && model && !(model.robotIds || []).includes(robot.id)) error = model.name + ' has no listed integration route for ' + robot.name + '. Your selection is preserved. Choose another model or body.';
    else if (world) pairStatus = 'World generation setup';
    else if (robot && model) pairStatus = (model.documentedRobotIds || []).includes(robot.id) ? 'Documented upstream workflow' : 'Research integration candidate';
    else if (robot) pairStatus = 'Choose a model for ' + robot.name;
    else if (model) pairStatus = 'Choose a robot for ' + model.name;
    if (error) pairStatus = 'Pair needs attention';
    const matchingCheckpoint = error ? null : world ? model.checkpoint || null : model?.checkpointsByRobot?.[robot?.id] || null;
    const executionTrack = model?.executionTrack || (world ? 'world-generation' : model?.type === 'planner' ? 'skill-agent' : model?.type === 'world' ? 'matched-physics-video-action' : 'matched-physics');
    let viewerURL = robot && !world ? safeURL(robot.viewer) : '';
    if (viewerURL && robot.id === 'g1') viewerURL += '&keyframe=stand';
    return { robot, model, world, error: error || null, pairStatus, matchingCheckpoint, executionTrack, viewerURL };
  }

  function getState() {
    const d = describe();
    const arena = state.view === 'arena' && state.mode !== 'demo' ? window.BrainSNNArena?.getState?.() : null;
    return clone({ ...state, error: d.error, pairStatus: state.mode === 'demo' ? 'Scripted demo' : d.pairStatus,
      matchingCheckpoint: state.mode === 'demo' ? null : d.matchingCheckpoint,
      referenceCheckpoint: state.mode === 'demo' ? null : d.model?.checkpoint || null,
      executionTrack: state.mode === 'demo' ? 'scripted-kinematic-demo' : d.executionTrack,
      viewerUrl: state.mode === 'demo' ? null : d.viewerURL || null,
      runtimeConnected: Boolean(arena?.runtimeConnected), policyExecuted: Boolean(arena?.policyExecuted),
      siteTest: state.view === 'site' ? window.BrainSNNSiteWorkspace?.getState?.() || null : null });
  }

  function remember(writeURL = true) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Storage is optional. */ }
    if (!writeURL) return;
    const p = new URLSearchParams();
    if (state.mode === 'demo') { p.set('mode', 'demo'); p.set('challenge', state.challenge || 'starter'); }
    else {
      p.set('robot', state.robotId || '');
      if (state.modelId) p.set('model', state.modelId);
      if (state.task) p.set('task', state.task);
      p.set('seed', state.seed);
      if (state.note) p.set('note', state.note);
      if (state.view !== 'arena') p.set('view', state.view);
    }
    const hash = '#playground' + (p.toString() ? '?' + p : '');
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function options(items, id, empty, preferredIds = [], preferredLabel = '') {
    let html = '<option value="">' + esc(empty) + '</option>';
    if (id && !items.some(x => x.id === id)) html += '<option selected value="' + esc(id) + '">Unknown: ' + esc(id) + '</option>';
    const row = x => '<option value="' + esc(x.id) + '"' + (x.id === id ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    const preferred = [...new Set(preferredIds)].map(key => items.find(x => x.id === key)).filter(Boolean);
    if (!preferred.length) return html + items.map(row).join('');
    const other = items.filter(x => !preferredIds.includes(x.id));
    html += '<optgroup label="' + esc(preferredLabel) + '">' + preferred.map(row).join('') + '</optgroup>';
    if (other.length) html += '<optgroup label="Other ' + (items === robots() ? 'robots' : 'models') + '">' + other.map(row).join('') + '</optgroup>';
    return html;
  }

  function link(label, url, cls = '') {
    const safe = safeURL(url);
    return safe ? '<a class="experiment-link ' + cls + '" href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' <span aria-hidden="true">↗</span></a>' : '';
  }

  function setupHTML(d) {
    if (!d.model) return '<div class="experiment-empty"><span class="experiment-empty-symbol" aria-hidden="true">+</span><h3>Choose the brain.</h3><p>Pick a model above to see its requirements beside your selected robot.</p><button class="experiment-button" data-experiment-action="choose-model">Choose a model</button></div>';
    const m = d.model;
    let special = '';
    if (m.id === 'groot' && d.robot?.id === 'g1') special = '<div class="experiment-callout"><strong>G1 + GR00T needs SONIC.</strong><p>Use the documented G1 embodiment and SONIC whole-body controller with a task-trained policy. The general GR00T checkpoint does not drive the G1 viewer automatically.</p></div>';
    if (m.id === 'lingbotva') special = '<div class="experiment-callout"><strong>A video-action model, with a Panda workflow.</strong><p>Use the matched LIBERO-Long environment, two camera views and checkpoint processing. Keep predicted video separate from observed simulator frames.</p></div>';
    if (d.world) special = '<div class="experiment-callout"><strong>A world-generation workspace.</strong><p>This model generates video. It does not return robot actions or an executable physics world. Configure its separate generation worker before producing a clip.</p></div>';
    return '<div class="experiment-setup-copy"><div class="experiment-kicker">' + esc(m.org) + ' · ' + esc(m.variant || m.type) + '</div><h3>' + esc(m.name) + '</h3><p>' + esc(m.summary || m.route) + '</p>' + special +
      '<div class="experiment-setup-grid"><section><h4>What it needs</h4><ol>' + (m.readyConditions || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ol></section>' +
      '<section><h4>Input and action contract</h4><p>' + esc(m.contract) + '</p></section><section><h4>Compute</h4><p>' + esc(m.compute) + '</p></section>' +
      '<section><h4>Workflow evidence</h4><p>' + esc(m.workflowEvidenceNote || m.route) + '</p></section></div>' +
      '<div class="experiment-source-links">' + (m.sources || []).map(s => link(s[0], s[1])).join('') + '</div></div>';
  }

  function previewHTML(d) {
    if (d.world) return setupHTML(d);
    if (!d.robot) return '<div class="experiment-empty"><span class="experiment-empty-symbol" aria-hidden="true">◇</span><h3>Start with a robot.</h3><p>Choose a body above to open its real MuJoCo model here. Add a brain when you are ready to build its setup.</p><button class="experiment-button" data-experiment-action="choose-robot">Choose a robot</button></div>';
    const r = d.robot;
    if (!d.viewerURL) return '<div class="experiment-empty"><h3>Robot preview unavailable</h3><p>This catalog entry has no supported viewer URL.</p>' + link('Open robot source', r.source) + '</div>';
    return '<div class="experiment-viewer-shell"><div class="experiment-viewer-top"><div><strong>' + esc(r.name) + '</strong><span>Official MuJoCo model viewer</span></div><div>' + link('Open full viewer', d.viewerURL) + '<button class="experiment-text-button" data-experiment-action="reload-viewer">Reload</button></div></div>' +
      '<iframe id="experiment-viewer" src="' + esc(d.viewerURL) + '" title="' + esc(r.name) + ' in the official MuJoCo model viewer" loading="eager" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen" allowfullscreen></iframe>' +
      '<div class="experiment-viewer-bottom"><p id="experiment-viewer-status" role="status">Loading the external viewer. The robot model may take a moment to appear.</p><p>Explore the body with the viewer controls. The selected AI model is not connected to this preview.' + (r.id === 'g1' ? ' Without an active whole-body controller, G1 may settle or fall when physics runs; the selected policy remains inactive.' : '') + '</p></div></div>';
  }

  function readinessHTML(d) {
    const m = d.model, r = d.robot;
    const readyCheckpoint = d.matchingCheckpoint;
    const reason = d.error || (!m ? 'Choose a model, then configure its runtime.' : d.world ? 'A world-generation worker is not connected.' : !r ? 'Choose a body and configure its matching runtime.' : 'A matched model runtime and controller are not connected.');
    return '<aside class="experiment-readiness" id="experiment-readiness"><div class="experiment-kicker">YOUR SETUP</div><h3>' + (d.world ? 'World model' : 'Before the first model run') + '</h3>' +
      '<ul class="experiment-checklist"><li><span class="experiment-check ' + (r || d.world ? 'available' : '') + '">' + (r || d.world ? '✓' : '1') + '</span><div><strong>' + (d.world ? 'Robot not required' : r ? esc(r.name) + ' available to preview' : 'Choose a robot') + '</strong><small>' + (d.world ? 'Video generation track' : r ? 'Official asset, separate from policy control' : 'Use the robot selector above') + '</small></div></li>' +
      '<li><span class="experiment-check">2</span><div><strong>' + (m ? esc(m.name) + ' selected' : 'Choose a model') + '</strong><small>Runtime not connected</small></div></li>' +
      '<li><span class="experiment-check ' + (readyCheckpoint ? 'available' : '') + '">' + (readyCheckpoint ? '✓' : '3') + '</span><div><strong>' + (readyCheckpoint ? 'Checkpoint reference identified' : 'Matching checkpoint needs selection') + '</strong><small>' + esc(readyCheckpoint || (m ? 'A general model card is not a task-trained robot checkpoint.' : 'Select a model to see its requirements.')) + '</small></div></li></ul>' +
      '<div class="experiment-run-area"><button id="experiment-run" class="experiment-button primary"' + (d.world ? ' disabled' : ' data-experiment-view="arena"') + ' aria-describedby="experiment-run-reason">' + (d.world ? 'Generation worker required' : 'Open arena & connect') + '</button><p id="experiment-run-reason">' + esc(reason) + '</p></div>' +
      '<button id="experiment-export" class="experiment-button" data-experiment-action="export">Export setup JSON <span aria-hidden="true">↓</span></button>' +
      (m?.type === 'planner' ? '<div class="experiment-demo-option"><p>Try a generic skill endpoint with the separate demo arm. This does not control ' + esc(r?.name || 'the selected body') + '.</p><button class="experiment-text-button" data-experiment-action="connect-demo">Use the demo-arm connector →</button></div>' : '') +
      '<div class="experiment-source-links">' + (r ? link('Robot documentation', r.source) : '') + (m?.sources?.[0] ? link('Model documentation', m.sources[0][1]) : '') + '</div></aside>';
  }

  function render() {
    const generation = ++renderGeneration;
    clearTimeout(viewerTimer);
    window.BrainSNNArena?.suspend?.();
    window.BrainSNNSiteWorkspace?.suspend?.();
    const root = $('experiment-root');
    if (!root) return;
    const demo = state.mode === 'demo', d = describe();
    root.classList.toggle('experiment-playground', !demo && state.view === 'arena');
    if ($('demo-workspace')) $('demo-workspace').hidden = !demo;
    root.innerHTML = '<div class="experiment-heading"><div><div class="experiment-kicker">ROBOT ARCADE</div><h2 id="experiment-heading" tabindex="-1">' + (demo ? 'Scripted demo' : d.world ? 'Build a world-model experiment.' : 'Your robot. <span>Your rules.</span>') + '</h2><p>' + (demo ? 'A separate, generic arm sandbox. Your catalog robot and model are not running here.' : 'Choose a robot and a model. Try a challenge, change the world, and replay the result.') + '</p></div>' + (demo ? '<button class="experiment-text-button" data-experiment-action="leave-demo">Back to the arcade</button>' : '') + '</div>';
    if (demo) {
      root.innerHTML += '<div class="experiment-demo-banner" role="status"><strong>Generic demo arm · scripted controller</strong><span>' + esc(state.note || 'Run a challenge below, or connect a compatible skill-agent endpoint explicitly.') + '</span></div>';
      syncProgressiveControls();
      return;
    }
    root.innerHTML += '<div class="experiment-selection" aria-label="Experiment selection"><label class="experiment-robot-picker"><span>01 · Choose your robot</span><select id="experiment-robot">' + options(robots(), state.robotId, d.world ? 'No robot · world generation' : 'Choose a robot', [...(d.model?.documentedRobotIds || []), ...(d.model?.robotIds || [])], 'Bodies for ' + (d.model?.name || 'this model')) + '</select></label>' +
      '<label class="experiment-model-picker"><span>02 · Model / LLM</span><select id="experiment-model">' + options(models(), state.modelId, 'Choose a model', d.robot ? models().filter(m => (m.robotIds || []).includes(d.robot.id)).map(m => m.id) : [], 'Routes for ' + (d.robot?.name || 'this robot')) + '</select></label>' +
      '<label class="experiment-task-label"><span>03 · Give it a mission</span><input id="experiment-task" maxlength="300" value="' + esc(state.task) + '" placeholder="What should it do?"></label><label class="experiment-seed-label"><span>World seed</span><input id="experiment-seed" maxlength="64" value="' + esc(state.seed) + '" placeholder="42"></label></div>' +
      '<div class="experiment-selection-status"><span class="experiment-pair-status">' + esc(d.pairStatus) + '</span><span id="experiment-runtime-summary">Select a profile or try local practice</span></div>' +
      (d.error ? '<div class="experiment-error" id="experiment-error" role="alert">' + esc(d.error) + (d.world && state.robotId ? '<button class="experiment-text-button" data-experiment-action="clear-robot">Use world setup without a robot →</button>' : '') + '</div>' : '') +
      (state.note ? '<p class="experiment-selection-note">' + esc(state.note) + '</p>' : '') +
      '<div class="experiment-layout' + (['arena', 'site'].includes(state.view) ? ' experiment-arena-layout' : '') + '"><section class="experiment-main"><div class="experiment-tabs" role="group" aria-label="Experiment view"><button data-experiment-view="arena" class="' + (state.view === 'arena' ? 'active' : '') + '" aria-pressed="' + (state.view === 'arena') + '"' + (d.world ? ' disabled' : '') + '>Arcade</button><details class="experiment-more-tools"' + (state.view !== 'arena' ? ' open' : '') + '><summary>More tools</summary><div class="experiment-tool-options"><button data-experiment-view="robot" class="' + (state.view === 'robot' ? 'active' : '') + '" aria-pressed="' + (state.view === 'robot') + '"' + (d.world ? ' disabled' : '') + '>Robot asset</button><button data-experiment-view="setup" class="' + (state.view === 'setup' ? 'active' : '') + '" aria-pressed="' + (state.view === 'setup') + '">Model setup</button><button data-experiment-view="site" class="' + (state.view === 'site' ? 'active' : '') + '" aria-pressed="' + (state.view === 'site') + '">Test your space</button><button class="experiment-text-button" data-experiment-action="demo">Classic skill connector</button><p>Import a scan and explore robot routes in your space. The classic connector uses a separate demo arm.</p></div></details></div>' +
      (state.view === 'arena' ? '<div id="arena-workspace-root"></div>' : state.view === 'site' ? '<div id="site-workspace-root"><div class="experiment-empty" role="status">Preparing your space…</div></div>' : state.view === 'setup' ? setupHTML(d) : previewHTML(d)) + '</section>' + (['arena', 'site'].includes(state.view) ? '' : readinessHTML(d)) + '</div>';
    if (state.view === 'site') {
      loadSiteRenderer().then(() => {
        if (generation !== renderGeneration || state.view !== 'site') return;
        if (!window.BrainSNNSiteWorkspace?.mount) throw new Error('The site workspace could not load. Please reload.');
        window.BrainSNNSiteWorkspace.mount($('site-workspace-root'), { ...state, robot: d.robot, model: d.model });
      }).catch(error => {
        if (generation !== renderGeneration || state.view !== 'site') return;
        const host = $('site-workspace-root');
        if (host) host.innerHTML = '<div class="experiment-empty" role="alert"><h3>Your space could not open.</h3><p>' + esc(error.message) + '</p><button class="experiment-button" data-experiment-action="reload-viewer">Retry</button></div>';
      });
    }
    if (state.view === 'arena' && !d.world) {
      if (window.BrainSNNArena?.mount) window.BrainSNNArena.mount($('arena-workspace-root'), { ...state, error: d.error, matchingCheckpoint: d.matchingCheckpoint, robot: d.robot, model: d.model, viewerUrl: d.viewerURL });
      else $('arena-workspace-root').innerHTML = '<div class="experiment-empty"><h3>The arena could not load.</h3><p>Reload the page, or open the Robot asset tab to inspect your selected body.</p><button class="experiment-button" data-experiment-action="reload-viewer">Retry</button></div>';
    }
    syncProgressiveControls();
    const iframe = $('experiment-viewer');
    if (iframe) {
      iframe.addEventListener('load', () => { clearTimeout(viewerTimer); const status = $('experiment-viewer-status'); if (status) status.textContent = 'Viewer page loaded. Its own controls show model and simulation status. AI runtime remains disconnected.'; });
      iframe.addEventListener('error', () => { clearTimeout(viewerTimer); const status = $('experiment-viewer-status'); if (status) status.textContent = 'The external viewer could not load here. Use Open full viewer or Reload.'; });
      viewerTimer = setTimeout(() => { const status = $('experiment-viewer-status'); if (status) status.textContent = 'Still waiting for the external viewer. Use Open full viewer if it does not appear.'; }, 12000);
    }
  }

  function open(input = {}, options = {}) {
    const modelId = input.modelId == null || input.modelId === '' ? null : String(input.modelId);
    let robotId = input.robotId == null || input.robotId === '' ? null : String(input.robotId);
    const model = findModel(modelId);
    if (!Object.prototype.hasOwnProperty.call(input, 'robotId') && model && !pureWorld(model)) {
      robotId = [...(model.documentedRobotIds || []), ...(model.robotIds || [])].find(id => findRobot(id) && model.robotIds.includes(id)) || null;
    }
    const robot = findRobot(robotId), world = pureWorld(model);
    state = { robotId, modelId, task: String(input.task ?? robot?.tasks?.[0] ?? model?.tasks?.[0] ?? '').slice(0, 300),
      seed: String(input.seed ?? '42').slice(0, 64), note: String(input.note ?? '').slice(0, 1200),
      mode: world ? 'world-setup' : 'robot-preview', view: input.view === 'site' ? 'site' : world ? 'setup' : ['setup', 'robot'].includes(input.view) ? input.view : 'arena' };
    lastNamedState = clone(state);
    try { localStorage.setItem(STORAGE_KEY + '.named', JSON.stringify(lastNamedState)); } catch { /* Optional resume state. */ }
    window.BrainSNN3DClient?.pause?.();
    if (options.navigate !== false) window.BrainSNNWorkspace?.showPage?.('playground');
    render();
    remember(options.writeURL !== false);
    if (options.focus !== false) $('experiment-heading')?.focus({ preventScroll: true });
    return getState();
  }

  function showDemo({ challenge = 'starter', run = false, note = '' } = {}) {
    const chosen = ['starter', 'clutter', 'moving', 'night', 'surprise'].includes(challenge) ? challenge : 'starter';
    if (state.mode !== 'demo' && (state.robotId || state.modelId)) lastNamedState = clone(state);
    state = { robotId: null, modelId: null, task: 'Move blocks into the target bin.', seed: state.seed || '42',
      note: String(note).slice(0, 1200), mode: 'demo', view: 'robot', challenge: chosen };
    window.BrainSNN3DClient?.pause?.();
    window.BrainSNNWorkspace?.showPage?.('playground');
    if ($('seed')) { $('seed').value = /^\d+$/.test(state.seed) ? state.seed : '42'; state.seed = $('seed').value; }
    window.BrainSNN3DClient?.startDemo?.(chosen);
    render(); remember();
    window.dispatchEvent(new Event('resize'));
    $('experiment-heading')?.focus({ preventScroll: true });
    if (run) $('run-live')?.click();
    return getState();
  }

  function restoreFromURL() {
    const [page, query = ''] = location.hash.slice(1).split('?');
    if (page !== 'playground') return getState();
    const p = new URLSearchParams(query);
    if (p.get('mode') === 'demo') return showDemo({ challenge: p.get('challenge') || 'starter', run: false });
    if (p.has('robot') || p.has('model') || p.has('task') || p.has('seed') || p.has('view')) {
      const input = { modelId: p.get('model'), task: p.has('task') ? p.get('task') : undefined,
        seed: p.get('seed') || '42', note: p.get('note') || '', view: p.get('view') };
      // The explicit empty robot parameter is preserved for a deliberate unpaired selection.
      if (p.has('robot')) input.robotId = p.get('robot');
      return open(input, { focus: false });
    }
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        if (saved.mode === 'demo') return showDemo({ challenge: saved.challenge, run: false });
        return open(saved, { focus: false });
      }
    } catch { /* Missing or malformed storage keeps the empty workspace usable. */ }
    render(); return getState();
  }

  function exportConfig() {
    const selected = getState(), d = describe();
    const config = { schemaVersion: 'brainsnn.experiment.v1', ...selected,
      observationContract: d.model?.contract || d.robot?.contract || null,
      requirements: d.model?.readyConditions || [], sources: d.model?.sources || [],
      robotSource: d.robot?.source || null, viewerPurpose: state.view === 'arena' ? 'Arena session: named policy execution requires a validated external worker.' : 'External robot asset preview; no model-control bridge.',
      evaluationResults: null, exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'BrainSNN_experiment_' + (state.robotId || 'world') + '_' + (state.modelId || 'unselected') + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return config;
  }

  function syncProgressiveControls() {
    const reveal = Boolean(window.BrainSNNArena?.getState?.().completedRun);
    document.querySelectorAll('[data-arena-after-run]').forEach(el => { el.hidden = !reveal; });
    if (state.mode === 'demo' || state.view !== 'arena') {
      $('experiment-root')?.querySelectorAll('[data-arena-after-run]').forEach(el => { el.hidden = false; });
    }
  }

  function bind() {
    const root = $('experiment-root');
    if (!root) return;
    try {
      const savedNamed = JSON.parse(localStorage.getItem(STORAGE_KEY + '.named') || 'null');
      if (savedNamed && typeof savedNamed === 'object' && !Array.isArray(savedNamed) && savedNamed.mode !== 'demo') lastNamedState = savedNamed;
    } catch { /* A corrupt saved pair must not block the workspace. */ }
    function syncField(event) {
      const id = event.target.id;
      if (id !== 'experiment-task' && id !== 'experiment-seed') return;
      state[id === 'experiment-task' ? 'task' : 'seed'] = event.target.value.slice(0, id === 'experiment-task' ? 300 : 64);
      window.BrainSNNArena?.updateSelection?.({ ...state, error: describe().error });
      window.BrainSNNSiteWorkspace?.updateSelection?.({ ...state, robot: describe().robot, model: describe().model });
      remember();
    }
    root.addEventListener('input', syncField);
    root.addEventListener('change', event => {
      const id = event.target.id;
      if (id === 'experiment-robot') { open({ ...state, robotId: event.target.value }, { focus: false }); $(id)?.focus({ preventScroll: true }); }
      else if (id === 'experiment-model') { open({ ...state, modelId: event.target.value }, { focus: false }); $(id)?.focus({ preventScroll: true }); }
      else syncField(event);
    });
    root.addEventListener('click', event => {
      const view = event.target.closest('[data-experiment-view]');
      if (view && !view.disabled) { state.view = view.dataset.experimentView; render(); remember(); root.querySelector('[data-experiment-view="' + state.view + '"]')?.focus({ preventScroll: true }); return; }
      const target = event.target.closest('[data-experiment-action]');
      if (!target) return;
      const action = target.dataset.experimentAction;
      if (action === 'demo') showDemo();
      else if (action === 'leave-demo') open(lastNamedState || {});
      else if (action === 'choose-model') $('experiment-model')?.focus();
      else if (action === 'choose-robot') $('experiment-robot')?.focus();
      else if (action === 'clear-robot') open({ ...state, robotId: null });
      else if (action === 'export') exportConfig();
      else if (action === 'reload-viewer') render();
      else if (action === 'connect-demo') {
        const previous = describe();
        showDemo({ note: 'You switched from ' + (previous.robot?.name || 'the selected robot') + ' to the generic demo arm. The endpoint you connect controls only this bounded skill sandbox.' });
        window.BrainSNN3DClient?.showConnector?.();
      }
    });
    render();
    restoreFromURL();
  }

  function suspend() {
    renderGeneration++;
    clearTimeout(viewerTimer);
    viewerTimer = null;
    window.BrainSNNArena?.suspend?.();
    window.BrainSNNSiteWorkspace?.suspend?.();
    $('experiment-viewer')?.remove();
    return getState();
  }

  window.BrainSNNExperiment = Object.freeze({ open, showDemo, getState, restoreFromURL, suspend, syncRoute: () => { remember(); return getState(); } });
  window.addEventListener('brainsnn:arena-completed', syncProgressiveControls);
  window.addEventListener('hashchange', restoreFromURL);
  window.addEventListener('pagehide', suspend);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
