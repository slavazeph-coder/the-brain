(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('world');
  // Policy observations are rendered separately from the user's orbit camera.
  const sensorCanvas = document.createElement('canvas');
  const challenges = {
    starter: { title: 'First moves', objective: 'Move all three blocks into the tray. Find your rhythm.', mission: 'table', clutter: false, movingObstacle: false },
    clutter: { title: 'Clutter course', objective: 'Deliver every block while keeping clear of the obstacles.', mission: 'hotel', clutter: true, movingObstacle: false },
    moving: { title: 'Moving world', objective: 'Watch the moving obstacle and deliver all three blocks.', mission: 'restock', clutter: true, movingObstacle: true },
    night: { title: 'Night shift', objective: 'Lower the lights. Compare how your agent responds.', mission: 'hotel', clutter: true, movingObstacle: false },
    surprise: { title: 'Plot twist', objective: 'The tray moves after 6 simulated seconds. Follow its new position.', mission: 'restock', clutter: true, movingObstacle: true }
  };
  const challengeOrder = Object.keys(challenges);
  const defaultView = { yaw: -.95, pitch: .62, distance: 5.1 };
  const view = { ...defaultView, showTrail: true };
  const clone = value => JSON.parse(JSON.stringify(value));
  const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
  const setText = (id, text) => { const el = $(id); if (el && el.textContent !== String(text)) el.textContent = text; };
  const bind = (id, action) => { const el = $(id); if (el) el.onclick = action; };
  let scene, clock = null, endpoint = '', maxCalls = 30, calls = 0, latency = 0;
  let pending = false, generation = 0, abort = null, replay = -1, frames = [], actions = [];
  let mission = 'table', challenge = 'starter', endpointError = '', endpointResponded = false, started = false, runCount = 0;
  let localBest = null, resultRecorded = false;
  const options = () => ({ mission, challenge, clutter: Number($('clutter').value) > 0, movingObstacle: Number($('slip').value) > 0 });
  function bestKey() {
    const config = options();
    return ['brainsnn-demo-best-v1', challenge, scene.seed, endpoint ? 'unverified-endpoint' : 'scripted-demo', Number(config.clutter), Number(config.movingObstacle)].join(':');
  }
  function readBest() {
    localBest = null;
    if (endpoint) return;
    try {
      const saved = Number(window.localStorage.getItem(bestKey()));
      if (Number.isFinite(saved) && saved > 0) localBest = saved;
    } catch (_) { /* The demo also works when local storage is unavailable. */ }
  }
  function recordBest() {
    if (resultRecorded || !scene.done) return;
    resultRecorded = true;
    if (endpoint || !scene.success) return;
    if (localBest === null || scene.time < localBest) {
      localBest = scene.time;
      try { window.localStorage.setItem(bestKey(), String(localBest)); } catch (_) { /* Optional on-device history. */ }
    }
  }
  function badges(state) {
    if (!state.success) return [];
    return ['Completed', ...(state.collisions === 0 ? ['No contacts'] : []), ...(state.interventions === 0 ? ['No help'] : [])];
  }
  function firstProblemIndex() {
    return frames.findIndex(frame => String(frame.event).startsWith('collision:') || ['pick-empty', 'request-help', 'place-empty'].includes(frame.event));
  }
  function updateProgress(state) {
    const steps = ['reach', 'grasp', 'lift', 'place'];
    const held = state.robot.carrying != null;
    const remaining = state.objects.filter(item => !item.delivered);
    let stage = 0;
    if (held) stage = state.robot.position[2] < .35 ? 2 : 3;
    else if (remaining.some(item => distance(item.position, state.robot.position) < .135)) stage = 1;
    if (state.success) stage = steps.length;
    const block = Math.min(state.objects.length, state.delivered + 1);
    setText('task-progress', state.success ? 'All three blocks delivered' : `Block ${block} of ${state.objects.length} · ${steps[stage][0].toUpperCase() + steps[stage].slice(1)}`);
    steps.forEach((name, index) => {
      const item = $('progress-' + name);
      if (!item) return;
      const status = index < stage ? 'complete' : index === stage ? 'current' : 'upcoming';
      item.dataset.state = status;
      item.classList.toggle('complete', status === 'complete');
      item.classList.toggle('current', status === 'current');
      if (status === 'current') item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    const first = firstProblemIndex(), replayButton = $('first-problem');
    if (replayButton) {
      replayButton.disabled = first < 0;
      replayButton.title = first < 0 ? 'Available after a contact, empty pick or help request.' : 'Replay the first recorded issue.';
      replayButton.setAttribute('aria-label', first < 0 ? 'Replay first issue, no issue recorded' : `Replay first issue at ${frames[first].time.toFixed(1)} seconds`);
    }
  }
  function selectChallenge(id) {
    if (!challenges[id]) return false;
    challenge = id;
    const selected = challenges[id];
    mission = selected.mission;
    $('clutter').value = selected.clutter ? 1 : 0;
    $('slip').value = selected.movingObstacle ? 1 : 0;
    document.querySelectorAll('[data-challenge]').forEach(button => {
      const active = button.dataset.challenge === challenge;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-mission]').forEach(button => {
      const active = button.dataset.mission === mission;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    reset();
    if (typeof window.CustomEvent === 'function') window.dispatchEvent(new CustomEvent('brainsnn:challenge', { detail: { id, title: selected.title } }));
    return true;
  }

  function pause(refresh = true) {
    if (clock) clearInterval(clock);
    clock = null;
    if (abort) abort.abort();
    abort = null; pending = false; generation++;
    $('run-live').textContent = 'Run mission';
    $('run-live').setAttribute('aria-label', 'Run mission (Space)');
    if (refresh) update();
  }
  function beginEpisode() { if (!started) { started = true; runCount++; } }
  function reset() {
    pause(false);
    const seed = Math.max(1, Math.min(2147483646, Math.floor(Number($('seed').value) || 42)));
    $('seed').value = seed;
    scene = BrainArena3D.create(seed, options());
    calls = 0; latency = 0; endpointError = ''; started = false;
    frames = [clone(scene)]; actions = []; replay = -1; resultRecorded = false; readBest();
    $('completion').hidden = true; $('timeline').max = 0; $('timeline').value = 0;
    setText('clutter-value', Number($('clutter').value) > 0 ? 'On' : 'Off');
    setText('slip-value', Number($('slip').value) > 0 ? 'On' : 'Off');
    update(); paint();
  }
  function paint() {
    const state = replay >= 0 ? frames[replay] : scene;
    if (!state) return;
    const rendered = BrainArena3D.render(canvas, state, view);
    if (!rendered.ok) {
      setText('run-status', 'This browser needs WebGL to show the 3D scene.');
      setText('scene-evidence', 'WebGL is unavailable. Try a browser with hardware acceleration enabled.');
    }
  }
  function observation() {
    paint();
    const sensor = BrainArena3D.renderSensor(sensorCanvas, scene, { width: 256, height: 256 });
    if (!sensor.ok) throw new Error('The fixed policy camera is unavailable. Enable WebGL before connecting a skill agent.');
    return {
      task: 'Move all three colored blocks into the target bin. Avoid obstacles. Request help when necessary.',
      track: 'high-level-skill-agent', sceneVersion: 'brainsnn-kinematic-tabletop-v1',
      seed: scene.seed, elapsedSeconds: scene.time, frame: scene.steps,
      challenge: { id: challenge, title: challenges[challenge].title, objective: challenges[challenge].objective, conditions: clone(scene.opts), events: clone(scene.challengeEvents || []) },
      observation: {
        robot: { position: scene.robot.position.slice(), target: scene.robot.target.slice(), carrying: scene.robot.carrying },
        objects: clone(scene.objects), obstacles: clone(scene.obstacles), targetBin: clone(scene.goal),
        camera: { ...sensor.camera, image: sensorCanvas.toDataURL('image/jpeg', .7) }, recentEvents: scene.trace.slice(-8)
      },
      allowedSkills: ['move_to', 'pick', 'place', 'wait', 'request_help'], workspaceBounds: clone(scene.bounds)
    };
  }
  function validate(action) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Return an action object using the skill-agent contract.');
    if (!['move_to', 'pick', 'place', 'wait', 'request_help'].includes(action.skill)) throw new Error('This connector accepts high-level skills. Joint-action policies need a matched physics adapter.');
    if (action.skill === 'move_to') {
      if (!Array.isArray(action.position) || action.position.length !== 3 || !action.position.every(Number.isFinite)) throw new Error('move_to needs three finite XYZ coordinates.');
      if (!action.position.every((value, i) => value >= scene.bounds[i][0] && value <= scene.bounds[i][1])) throw new Error('The model returned a position outside the workspace.');
    }
    return action;
  }
  function record() {
    frames.push(clone({ ...scene, trace: scene.trace.slice(-90) }));
    if (frames.length > 1601) frames.shift();
    $('timeline').max = frames.length - 1;
    if (replay < 0) $('timeline').value = frames.length - 1;
  }
  function apply(action, source) {
    validate(action); BrainArena3D.step(scene, action);
    actions.push({ time: scene.time, frame: scene.steps, source, action: clone(action), latencyMs: source === 'endpoint' ? latency : null });
    record(); update();
  }
  async function askModel() {
    if (pending || !endpoint || scene.done) return;
    if (calls >= maxCalls) { pause(); scene.event = 'model-call-budget'; update(); return; }
    beginEpisode(); endpointError = ''; pending = true;
    const ticket = generation, start = performance.now(), controller = new AbortController();
    abort = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    update();
    try {
      const payload = observation();
      calls++;
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        signal: controller.signal, body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('The endpoint returned HTTP ' + response.status + '.');
      const body = await response.json();
      if (ticket !== generation) return;
      latency = Math.round(performance.now() - start);
      const action = validate(body.action || body);
      endpointResponded = true; apply(action, 'endpoint'); paint();
    } catch (error) {
      if (ticket !== generation) return;
      pause(); scene.event = 'endpoint-error';
      endpointError = error.name === 'AbortError' ? 'The endpoint took longer than 15 seconds. Check it and try again.' : String(error.message || error).slice(0, 160);
    } finally {
      clearTimeout(timeout);
      if (ticket === generation) { pending = false; abort = null; }
      update();
    }
  }
  function tick() {
    if (scene.done) { pause(); finish(); return; }
    beginEpisode(); replay = -1;
    if (endpoint) {
      // The scene keeps moving while inference runs; each response is bounded and validated.
      BrainArena3D.step(scene); record();
      if (distance(scene.robot.position, scene.robot.target) < .02 && !pending) askModel();
    } else apply(BrainArena3D.demoAction(scene), 'scripted-demo');
    update(); paint();
  }
  function finish() {
    recordBest();
    const earned = badges(scene);
    $('completion-title').textContent = scene.success ? endpoint ? 'Challenge complete.' : 'Demo challenge complete.' : 'A useful first try.';
    $('completion-copy').textContent = `${endpoint ? 'Your endpoint' : 'Scripted demo'} · ${scene.delivered} of 3 delivered · ${scene.time.toFixed(1)} simulated seconds${earned.length > 1 ? ' · ' + earned.slice(1).join(' · ') : ''}`;
    const completion = $('completion');
    completion.classList.toggle('mission-result', true);
    completion.classList.toggle('success', scene.success);
    completion.classList.toggle('needs-review', !scene.success);
    completion.hidden = false;
    const next = $('next-challenge');
    if (next) {
      next.hidden = !scene.success;
      next.textContent = 'Next: ' + challenges[challengeOrder[(challengeOrder.indexOf(challenge) + 1) % challengeOrder.length]].title;
    }
  }
  function friendlyEvent(event) {
    const events = {
      ready: 'Ready when you are', wait: 'Waiting', 'move-command': 'Moving into position',
      move: 'Moving into position', arrive: 'Position reached', pick: 'Block picked up',
      deliver: 'Block delivered', complete: 'All three blocks delivered', 'request-help': 'Help requested',
      'already-carrying': 'Already holding a block', 'pick-empty': 'No block within reach',
      'place-empty': 'No block to place', 'place-on-table': 'Block placed on the table',
      timeout: 'Episode time limit reached', 'model-call-budget': 'Request limit reached. Start a new episode to continue.',
      'endpoint-error': 'Check your endpoint and try again', 'target-moved': 'The target tray moved', 'invalid-action': 'Action could not be read',
      'invalid-position': 'Invalid position', 'outside-workspace': 'Position outside the workspace', 'invalid-skill': 'Unsupported action'
    };
    return String(event || '').startsWith('collision:') ? 'Obstacle contact detected' : (events[event] || 'Scene updated');
  }
  function update() {
    if (!scene) return;
    setText('run-header', clock ? 'Pause' : 'Run mission');
    const state = replay >= 0 ? frames[replay] : scene;
    const challengeCopy = challenges[challenge];
    setText('world-name', challengeCopy.title); setText('mission-title', challengeCopy.title); setText('mission-description', challengeCopy.objective);
    setText('challenge-name', challengeCopy.title); setText('challenge-objective', challengeCopy.objective);
    setText('challenge-badge', (state.success ? (endpoint ? '' : 'Demo · ') + badges(state).join(' · ') : '') || (replay >= 0 ? 'Episode replay' : state.done ? 'Episode finished' : clock ? 'Challenge in progress' : state.steps ? 'Challenge paused' : 'Ready to explore'));
    setText('mission-best', endpoint ? 'Endpoint model identity is unverified' : localBest === null ? 'Local demo best · Complete a run to set it' : `Local demo best · ${localBest.toFixed(1)} s`);
    updateProgress(state);
    setText('live-delivered', state.delivered + ' / 3'); setText('live-steps', endpoint ? calls : state.steps);
    setText('live-collisions', state.collisions); setText('live-retries', state.interventions);
    setText('timeline-label', state.time.toFixed(1) + ' s'); setText('elapsed-time', state.time.toFixed(1) + ' s');
    setText('seed-caption', 'World ' + state.seed); setText('run-count', runCount);
    setText('scene-mode', replay >= 0 ? 'Replay' : clock ? 'Running' : state.done ? 'Complete' : state.steps ? 'Paused' : 'Ready');
    setText('scene-progress', state.delivered + ' of 3 delivered');
    let status = friendlyEvent(state.event);
    if (replay >= 0) status = 'Replaying ' + state.time.toFixed(1) + ' seconds';
    else if (endpointError) status = endpointError;
    else if (pending) status = 'Your model is deciding…';
    else if (!clock && !state.done && state.steps > 0 && state.event !== 'model-call-budget') status = 'Paused. Pick up where you left off.';
    setText('run-status', status);
    setText('model-name', endpoint ? new URL(endpoint).hostname : 'Demo controller');
    setText('model-subtitle', endpoint ? 'Your skill-agent endpoint' : 'Built-in scripted policy');
    setText('connection-state', endpoint ? endpointError ? 'Check endpoint' : pending ? 'Responding' : endpointResponded ? 'Connected' : 'Ready to connect' : 'Demo');
    setText('model-status', endpointError ? endpointError : endpoint ? `${calls} / ${maxCalls} requests${endpointResponded ? ' · ' + latency + ' ms last response' : ''}` : 'Try the demo, then connect your model.');
    $('connect-real').textContent = endpoint ? 'Manage connection' : 'Connect your model';
    const stats = document.querySelectorAll('.live-stats div');
    if (stats[1]) stats[1].querySelector('span').textContent = endpoint ? 'Model requests' : 'Steps';
    if (stats[2]) stats[2].querySelector('span').textContent = 'Contacts';
    if (stats[3]) stats[3].querySelector('span').textContent = 'Help requests';
    $('trail').replaceChildren();
    // Collapse repeated movement events so the activity feed stays readable.
    const recent = [];
    state.trace.forEach(item => { const label = friendlyEvent(item.event); if (!recent.length || recent[recent.length - 1].label !== label) recent.push({ ...item, label }); });
    recent.slice(-5).forEach(item => { const line = document.createElement('p'); line.textContent = item.time.toFixed(1) + ' s  ' + item.label; $('trail').appendChild(line); });
    $('trail').scrollTop = $('trail').scrollHeight;
    if (state.done && replay < 0 && $('completion').hidden) { finish(); pause(); }
  }

  $('run-live').onclick = () => {
    if (clock) { pause(); return; }
    if (scene.done || scene.event === 'model-call-budget') reset();
    endpointError = ''; $('completion').hidden = true; replay = -1; beginEpisode();
    $('run-live').textContent = 'Pause'; $('run-live').setAttribute('aria-label', 'Pause mission (Space)');
    clock = setInterval(tick, Math.max(16, Number($('speed').value) || 50));
    if (endpoint) askModel();
    update(); paint();
  };
  bind('run-header', () => $('run-live').click());
  $('step-live').onclick = () => { pause(); replay = -1; if (scene.done) reset(); if (endpoint) askModel(); else tick(); };
  $('reset-live').onclick = reset;
  $('again').onclick = () => { reset(); $('run-live').click(); };
  $('speed').onchange = () => { if (clock) { pause(); $('run-live').click(); } };
  $('shuffle').onclick = () => { $('seed').value = 1 + Math.floor(Math.random() * 2147483645); reset(); };
  $('seed').onchange = reset;
  ['clutter', 'slip'].forEach(id => { $(id).oninput = reset; });
  document.querySelectorAll('[data-mission]').forEach(button => {
    button.onclick = () => selectChallenge({ table: 'starter', hotel: 'clutter', restock: 'moving' }[button.dataset.mission] || 'starter');
  });
  document.querySelectorAll('[data-challenge]').forEach(button => { button.onclick = () => selectChallenge(button.dataset.challenge); });
  bind('next-challenge', () => {
    selectChallenge(challengeOrder[(challengeOrder.indexOf(challenge) + 1) % challengeOrder.length]);
    const nextControl = $('run-header') && window.innerWidth > 760 ? $('run-header') : $('run-live'); nextControl.focus();
  });
  bind('first-problem', () => {
    const first = firstProblemIndex();
    if (first < 0) return;
    pause(); replay = first; $('timeline').value = first; $('completion').hidden = true; update(); paint();
  });
  $('timeline').oninput = () => { pause(); replay = Math.max(0, Math.min(frames.length - 1, Number($('timeline').value))); $('completion').hidden = true; update(); paint(); };
  $('live-time').onclick = () => { replay = -1; update(); paint(); };
  let drag = null;
  function cameraChanged() { const button = $('camera-top'); if (button) button.setAttribute('aria-pressed', String(view.pitch > 1.3)); paint(); }
  canvas.addEventListener('pointerdown', event => { drag = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    view.yaw += (event.clientX - drag[0]) * .009;
    view.pitch = Math.max(.2, Math.min(1.48, view.pitch + (event.clientY - drag[1]) * .007));
    drag = [event.clientX, event.clientY]; cameraChanged();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', event => { event.preventDefault(); view.distance = Math.max(2.7, Math.min(8, view.distance + event.deltaY * .006)); paint(); }, { passive: false });
  bind('camera-reset', () => { Object.assign(view, defaultView); cameraChanged(); });
  bind('camera-top', () => { if (view.pitch > 1.3) Object.assign(view, defaultView); else { view.pitch = 1.48; view.yaw = -.95; view.distance = 5.1; } cameraChanged(); });
  function toggleTrail() { view.showTrail = !view.showTrail; const button = $('toggle-trail'); if (button) { button.setAttribute('aria-pressed', String(view.showTrail)); button.classList.toggle('active', view.showTrail); } paint(); }
  bind('toggle-trail', toggleTrail);

  function showConnector() {
    pause();
    $('modal-content').innerHTML = `<div class="modal-label">YOUR MODEL. THIS WORLD.</div><h2>Connect your model</h2><p>Let a compatible skill-agent endpoint choose the robot’s next move.</p><div class="model-fields"><label class="field-label" for="policy-url">Endpoint URL</label><input id="policy-url" type="url" placeholder="https://your-server.example/act" autocomplete="off" spellcheck="false"><label class="field-label" for="policy-call-limit">Request limit per episode</label><input id="policy-call-limit" type="number" min="1" max="100" value="30"></div><p class="tiny">The connection runs in your browser. Your endpoint must allow this site through CORS. Inference charges, if any, come from your provider.</p><details class="connector-disclosure"><summary>Compatibility &amp; response format</summary><p>Each request contains a camera image, scene state, allowed skills and workspace bounds. Return one bounded skill action:</p><pre>{ "action": {\n  "skill": "move_to",\n  "position": [0.4, 0.2, 0.7]\n}}</pre><p class="tiny">Other skills: pick, place, wait, request_help. X/Y are the tabletop; Z is height. Keep credentials on your server. URLs containing credentials, query strings or fragments are rejected.</p><p class="tiny">This is a kinematic skill-agent sandbox. A VLA that returns joint actions needs a matching physics worker and checkpoint adapter.</p></details><div class="hero-actions"><button id="save-policy" class="button ink">Connect endpoint</button><button id="disconnect-policy" class="button ghost">Use demo</button></div><p id="connector-message" class="model-message" role="status" aria-live="polite"></p>`;
    $('policy-url').value = endpoint; $('policy-call-limit').value = maxCalls;
    $('save-policy').onclick = () => {
      try {
        const url = new URL($('policy-url').value.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Enter an HTTPS endpoint without credentials, a query string or a fragment.');
        endpoint = url.href; endpointResponded = false;
        maxCalls = Math.max(1, Math.min(100, Math.floor(Number($('policy-call-limit').value) || 30)));
        $('modal').close(); reset();
      } catch (error) { $('connector-message').textContent = error.message === 'Invalid URL' ? 'Enter a full HTTPS endpoint URL.' : error.message; }
    };
    $('disconnect-policy').onclick = () => { endpoint = ''; endpointResponded = false; $('modal').close(); reset(); };
    $('modal').showModal(); if ($('policy-url').focus) $('policy-url').focus();
  }
  function exportScene() {
    const report = {
      version: 'brainsnn-kinematic-tabletop-v1', evidenceType: endpoint ? 'connected-endpoint-skill-agent' : 'scripted-3d-kinematics',
      modelEndpointHost: endpoint ? new URL(endpoint).hostname : null, modelIdentityVerified: false,
      physicsEngine: 'bounded-kinematics', physicalRobot: false, seed: scene.seed, options: scene.opts,
      challenge: { id: challenge, title: challenges[challenge].title, objective: challenges[challenge].objective, events: clone(scene.challengeEvents || []) },
      earnedBadges: badges(scene), controllerKind: endpoint ? 'unverified-endpoint' : 'scripted-demo',
      personalBest: endpoint ? null : { simulatedSeconds: localBest, scope: 'This browser; matching challenge, seed, scene controls and scripted controller only.' },
      metrics: { delivered: scene.delivered, success: scene.success, contactEvents: scene.collisions, helpRequests: scene.interventions, simulatedSeconds: scene.time, modelCalls: calls },
      actions, trace: scene.trace,
      limitations: ['Not a full dynamics or joint-action VLA evaluation.', 'Endpoint transport does not verify the identity of the hosted model.', 'Contact checks cover gripper/carried object, not the complete robot body.']
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'BrainSNN_3D_episode_evidence.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('connect-real').onclick = showConnector;
  bind('export-episode', exportScene);
  document.querySelectorAll('[data-modal=connect]').forEach(button => { button.onclick = showConnector; });
  document.querySelectorAll('[data-modal=meaning]').forEach(button => {
    button.onclick = () => {
      pause();
      $('modal-content').innerHTML = '<div class="modal-label">ABOUT THIS PLAYGROUND</div><h2>A small world. A useful first test.</h2><p>Move through a 3D tabletop, then scrub time to see how each action unfolded. Change the world and compare the results.</p><p>The demo uses a built-in scripted controller. Connect a compatible HTTPS skill-agent endpoint to supply real model actions. No real model is connected by default.</p><p>This scene uses bounded kinematics and checks contact at the gripper and carried block. Full dynamics, whole-arm collisions and joint-action VLA evaluation need a matched physics backend.</p><p>Exported episodes include the seed, actions, metrics and these limitations.</p>';
      $('modal').showModal();
    };
  });
  bind('close-modal', () => $('modal').close());
  document.querySelectorAll('[data-close-modal]').forEach(button => { button.onclick = () => $('modal').close(); });
  $('modal').addEventListener('click', event => {
    if (event.target !== $('modal')) return;
    const box = $('modal').getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('modal').close();
  });
  document.addEventListener('keydown', event => {
    if ($('playground')?.hidden || $('demo-workspace')?.hidden || $('modal').open || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(target.tagName))) return;
    if (event.code === 'Space') { event.preventDefault(); $('run-live').click(); }
    else if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); }
    else if (event.key.toLowerCase() === 't') { event.preventDefault(); toggleTrail(); }
  });
  function startDemo(id = 'starter') { endpoint = ''; endpointResponded = false; selectChallenge(id); }
  window.BrainSNN3DClient = Object.freeze({ startDemo, pause, showConnector, selectChallenge, observation, validateAction: validate, exportEvidence: exportScene, getState: () => clone(scene) });
  window.addEventListener('pagehide', pause); window.addEventListener('resize', paint);
  selectChallenge('starter');
})();
