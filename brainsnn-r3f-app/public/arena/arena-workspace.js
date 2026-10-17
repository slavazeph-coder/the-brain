/* BrainSNN arena shell. A named policy only runs through a validated worker.
 * The opt-in local rehearsal is the existing scripted, kinematic demo. */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const stamp = () => new Date().toISOString();
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const practiceMissions = [
    ['starter','First moves','◇','Three blocks. One destination.'],
    ['clutter','Clutter course','▧','Find room to move.'],
    ['moving','Moving world','↔','Dodge a moving obstacle.'],
    ['night','Night shift','◐','Turn down the lights.'],
    ['surprise','Plot twist','⌖','The destination moves at 6 s.']
  ];
  let completedRun = false;
  let inspectedLegacy = null;
  let host = null, selection = {}, mode = 'named', protocol = 'practice', client = null;
  let connection = { status: 'disconnected', profile: null }, liveFrame = null, running = false;
  let remoteFrames = [], remoteCursor = -1, droppedFrames = 0, remoteBytes = 0;
  let world = null, snapshots = [], events = [], branches = [], cursor = 0, branchId = 'main', counter = 0;
  let timer = null, cleanup = [], camera = { yaw: -0.95, pitch: 0.62, distance: 5.1 }, drag = null;
  let challenge = 'starter', message = '', renderFailure = false, mountedAt = null, generation = 0, workerTask = '', sensorCamera = null, sessionDraft = null;
  // "Beat the bot" controller (arena-game-ui.js). It borrows the practice canvas
  // and camera while a race runs; the scripted practice timeline is untouched.
  let game = null;
  const playing = () => mode === 'practice' && Boolean(game?.active());
  const $ = id => host?.querySelector('#' + id);
  const robot = () => (window.BrainSNNRobots || []).find(x => x.id === selection.robotId);
  const model = () => (window.BrainSNNModels || []).find(x => x.id === selection.modelId);
  const profile = () => window.BrainSNNArenaProfiles?.findForSelection?.(selection) || null;
  const connected = () => ['ready', 'running', 'paused', 'succeeded', 'failed', 'error'].includes(connection.status) && Boolean(connection.sessionId);
  const commands = () => connection.profile?.commands || [];
  const supports = name => connected() && commands().includes(name);
  const canIntervene = kind => protocol === 'practice' && supports('intervene') && (connection.profile?.interventions || []).some(x => (typeof x === 'string' ? x : x.kind) === kind);
  const active = () => mode === 'practice' ? snapshots[cursor]?.state || world : liveFrame;
  const viewedFrame = () => remoteCursor >= 0 ? remoteFrames[remoteCursor] || liveFrame : liveFrame;
  function clearRemoteHistory() { liveFrame = null; remoteFrames = []; remoteCursor = -1; droppedFrames = 0; remoteBytes = 0; sessionDraft = null; }
  const draftChanged = () => sessionDraft && ['task', 'seed'].some(key => String(selection[key] ?? '') !== sessionDraft[key]);
  function recordFrame(frame) {
    liveFrame = frame;
    const recorded = freeze(clone(frame)); remoteFrames.push(recorded);
    remoteBytes += (recorded.cameras || []).reduce((n, c) => n + (c.url?.length || 0), 0);
    while (remoteFrames.length > 180 || (remoteBytes > 24000000 && remoteFrames.length > 1)) {
      const removed = remoteFrames.shift(); remoteBytes -= (removed.cameras || []).reduce((n, c) => n + (c.url?.length || 0), 0);
      droppedFrames++; if (remoteCursor >= 0) remoteCursor = Math.max(0, remoteCursor - 1);
    }
  }
  const frameMetadata = frame => ({ seq: frame.seq, simTime: frame.simTime, wallTime: frame.wallTime ?? frame.metrics?.wallTime ?? null,
    policyExecuted: frame.policyExecuted, status: frame.status, metrics: frame.metrics || {}, events: frame.events || [],
    cameraIds: (frame.cameras || []).map(x => ({ id: x.id, role: x.role, capturedStep: x.capturedStep ?? null, consumedByPolicy: x.consumedByPolicy ?? null })) });
  const on = (element, type, fn, options) => { if (!element) return; element.addEventListener(type, fn, options); cleanup.push(() => element.removeEventListener?.(type, fn, options)); };
  const text = (id, value) => { if ($(id)) $(id).textContent = value; };
  const attr = (id, key, value) => { const el = $(id); if (!el) return; value ? el.setAttribute(key, '') : el.removeAttribute(key); };
  const event = (kind, data = {}) => events.push(freeze({ id: ++counter, at: stamp(), branch: branchId, simTime: world?.time ?? liveFrame?.simTime ?? null, kind, ...clone(data) }));
  function snapshot(kind, controllerInput = null) {
    const state = clone(world);
    // Only the last 90 positions are used by the renderer. The independent
    // immutable timeline retains every state, avoiding a quadratic trace.
    state.trace = state.trace.slice(-90);
    snapshots.push(freeze({ id: ++counter, branch: branchId, kind, state, ...(controllerInput ? { controllerInput: clone(controllerInput) } : {}) }));
    cursor = snapshots.length - 1;
  }
  function makeWorld(seed = selection.seed ?? '42') {
    if (!window.BrainArena3D) { message = 'Local practice renderer is unavailable. Reload the page.'; return; }
    running = false; clearInterval(timer); timer = null;
    const numericSeed = /^\d+$/.test(String(seed)) && Number.isSafeInteger(Number(seed)) ? Number(seed) : seed;
    world = window.BrainArena3D.create(numericSeed, { challenge });
    snapshots = []; events = []; branches = []; cursor = 0; counter = 0; branchId = 'main';
    event('practice-created', { seed: world.seed, challenge, controller: 'scripted-kinematic-demo' });
    snapshot('initial'); renderFailure = false;
  }
  function evidence() {
    return clone({ schema: 'brainsnn.arena.evidence.v1', createdAt: stamp(), mountedAt,
      selected: { robotId: selection.robotId || null, modelId: selection.modelId || null, task: selection.task || '', seed: selection.seed ?? '42', matchingCheckpoint: selection.matchingCheckpoint || null },
      execution: mode === 'practice' ? { kind: 'scripted-kinematic-demo', robot: 'generic-demo-arm', policyExecuted: false, protocol: 'practice', benchmarkResult: null } : {
        kind: 'worker', connected: connected(), status: connection.status, sessionId: connection.sessionId || null,
        profileId: connection.profile?.id || liveFrame?.profileId || null, policyExecuted: liveFrame?.policyExecuted === true, protocol,
        benchmarkResult: protocol === 'benchmark' && liveFrame?.policyExecuted === true ? liveFrame.metrics || null : null,
        checkpoint: connection.profile?.checkpoint || null, task: connection.selection?.task || workerTask || null,
        seed: connection.sessionId ? connection.selection?.seed ?? null : null
      },
      local: mode === 'practice' ? { branchId, cursor, branches, events, snapshots, sensorCamera,
        recordingContext: { taskId: 'scripted-sort:' + (world?.opts?.challenge || challenge), taskRevision: 'scripted-sort.v1', judgeRevision: 'scripted-delivery-or-step-limit.v1',
          environment: { name: 'BrainArena3D', version: 'scripted-kinematic.v1', dynamics: false },
          actionSemantics: { version: 'scripted-skills.v1', skills: ['move_to', 'pick', 'place', 'wait'], position: 'Cartesian target in local workspace; no measured motor output' },
          stateSemantics: { version: 'scripted-world.v1', position: 'Kinematic Cartesian workspace state', trace: 'Last 90 renderer positions; independent snapshots retained' },
          units: { position: 'local workspace units', simTime: 'seconds', stepDuration: 0.1 }, preprocessingRevision: 'native-scripted-state.v1',
          initialState: snapshots[0]?.state || null },
        limitation: 'Kinematic scripted demonstration. These are demo outcomes, not named robot/model, dynamics or model scores.' } : null,
      worker: mode === 'named' && liveFrame ? { ...frameMetadata(liveFrame), frames: remoteFrames.map(frameMetadata), droppedFrames,
        retention: 'Latest 180 observed frames, bounded to 24 MB of image URLs in browser memory. Export includes frame metadata, not image URLs or physics state.',
        profile: connection.profile ? { id: connection.profile.id, robotId: connection.profile.robotId, modelId: connection.profile.modelId,
          checkpoint: connection.profile.checkpoint, checkpointRevision: connection.profile.checkpointRevision,
          adapter: connection.profile.adapter, adapterVersion: connection.profile.adapterVersion, policyCodeRevision: connection.profile.policyCodeRevision,
          simulator: connection.profile.simulator, timing: connection.profile.timing, action: connection.profile.action, state: connection.profile.state,
          cameras: connection.profile.cameras, task: connection.selection?.task || workerTask } : null } : null
    });
  }
  function getState() {
    return clone({ selection, mode, protocol, running, completedRun, runtimeConnected: mode === 'named' && connected(), connection: { status: connection.status, sessionId: connection.sessionId || null,
      profileId: connection.profile?.id || null }, policyExecuted: mode === 'named' && liveFrame?.policyExecuted === true,
      cursor, snapshotCount: snapshots.length, branchId, branches, message, remoteFrameCount: remoteFrames.length, remoteCursor, droppedFrames,
      currentSnapshot: mode === 'practice' ? snapshots[cursor] || null : null,
      events: mode === 'practice' ? events : liveFrame?.events || [], game: game?.state?.() || null });
  }
  function namedViewer() {
    const r = robot(); let url = safeURL(r?.viewer);
    if (url && r.id === 'g1') url += '&keyframe=stand';
    return url ? '<iframe id="arena-body-viewer" src="' + esc(url) + '" title="' + esc(r.name) + ' body preview. Selected policy is not running." allow="fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>' :
      '<div class="arena-empty"><div class="arena-orbit-mark" aria-hidden="true">B</div><h3>Give your brain a body.</h3><p>Choose a robot and a model above, or start with a profile below.</p></div>';
  }
  function render() {
    if (!host) return;
    cleanup.forEach(fn => fn()); cleanup = [];
    const r = robot(), m = model(), p = profile();
    // Setup and play controls are available before the first run. A named
    // selection still requires its exact worker profile; no demo fallback.
    host.classList.add('arena-workspace');
    host.innerHTML = '<div class="arena-profile-bar" aria-label="Starter profiles"><span>Quick picks <small>worker required</small></span><button data-arena-profile="panda:pi05">Panda <b>π₀.₅</b></button><button data-arena-profile="panda:molmo">Panda <b>MolmoAct2</b></button><button data-arena-profile="g1:sonic">G1 <b>SONIC</b></button><button data-arena-profile="so101:act">SO-101 <b>ACT</b></button></div>' +
      '<div class="arena-shell"><div class="arena-session-bar"><div class="arena-pair"><span class="arena-status-dot" id="arena-dot"></span><strong id="arena-pair-title">' + esc(mode === 'practice' ? 'Generic demo arm · scripted practice' : (r?.name || 'Choose robot') + ' + ' + (m?.name || 'Choose brain')) + '</strong><span id="arena-runtime-badge" class="arena-badge"></span></div>' +
      '<div class="arena-mode-switch" aria-label="Execution mode"><button data-arena-action="named" aria-pressed="' + (mode === 'named') + '">Selected robot</button><button data-arena-action="practice" aria-label="Try local practice: scripted, not a model score" aria-pressed="' + (mode === 'practice') + '">Try local practice</button></div></div>' +
      (mode === 'practice' ? '<div class="arena-mission-ribbon"><div class="arena-mission-label"><strong>Pick your challenge</strong><span>Local practice · press Run to begin</span></div><div class="arena-mission-picks" role="group" aria-label="Practice missions">' + practiceMissions.map(([id,label,icon,hint]) => '<button type="button" data-arena-challenge="' + id + '" aria-pressed="' + (challenge === id) + '" title="' + hint + '"><span aria-hidden="true">' + icon + '</span><strong>' + label + '</strong><small>' + hint + '</small></button>').join('') + '</div></div><section class="arena-game-bar" id="arena-game-bar" aria-label="Beat the bot"></section>' : '') +
      '<div class="arena-main"><section class="arena-stage" aria-label="Interactive arena"><div class="arena-stage-top"><div><span class="arena-micro" id="arena-camera-title">' + (mode === 'practice' ? 'SPECTATOR CAMERA' : 'ROBOT BODY PREVIEW') + '</span><strong id="arena-mission">' + esc(mode === 'practice' ? 'Sort three blocks into the tray' : selection.task || 'Choose a mission, connect a worker') + '</strong></div><div class="arena-stage-actions"><span class="arena-live-pill" id="arena-live-pill">SETUP</span><button type="button" class="arena-button arena-primary" id="arena-run-top" data-arena-action="run">Run</button></div></div>' +
      '<div class="arena-viewport" id="arena-viewport">' + (mode === 'practice' ? '<canvas id="arena-canvas" tabindex="0" aria-label="Generic demo arm practice arena. Drag to orbit, scroll to zoom. Use arrow keys to orbit, plus and minus to zoom."></canvas><div class="arena-canvas-hint">Drag to orbit <span>·</span> Scroll to zoom</div>' : namedViewer()) +
      '<img id="arena-worker-image" class="arena-worker-image" hidden alt="Authoritative simulator spectator camera"><div id="arena-frame-placeholder" class="arena-frame-placeholder" hidden>Waiting for a spectator frame from the worker.</div>' +
      '<aside class="arena-policy-eye" id="arena-policy-eye" hidden><span>POLICY CAMERA <b id="arena-policy-id"></b></span><img id="arena-policy-image" alt="Actual observation supplied by the worker to its policy"></aside>' + (mode === 'practice' ? '<aside class="arena-policy-eye arena-local-sensor" id="arena-local-sensor"><span>FIXED DEMO CAMERA · NO AI</span><canvas id="arena-sensor-canvas" width="256" height="256" aria-label="Fixed camera view of the generic scripted demo, independent of your spectator camera"></canvas></aside>' : '') + '</div>' +
      '<div class="arena-camera-controls"><div><button data-arena-action="orbit" title="Orbit the spectator camera">Orbit</button><button data-arena-action="top" title="View arena from above">Top view</button><button data-arena-action="camera-reset">Reset view</button></div><span id="arena-camera-note">' + (mode === 'practice' ? 'Fixed demo camera stays independent of your view' : 'Explore with the body viewer controls') + '</span></div>' +
      '<div class="arena-transport"><button class="arena-button arena-primary" id="arena-run" data-arena-action="run">Connect worker</button><button class="arena-button" id="arena-step" data-arena-action="step">Step</button><button class="arena-icon-button" id="arena-reset" data-arena-action="reset" title="Reset this run" aria-label="Reset this run">↺</button><div class="arena-clock"><strong id="arena-time">0.0<span>s</span></strong><small>simulation time</small></div><span class="arena-transport-note" id="arena-transport-note"></span></div></section>' +
      '<aside class="arena-inspector"><div class="arena-panel-section"><div class="arena-panel-label"><h3>Mission control</h3><span class="arena-badge">01</span></div><div class="arena-protocol"><button data-arena-protocol="practice" aria-pressed="' + (protocol === 'practice') + '">Practice</button><button data-arena-protocol="benchmark" aria-pressed="' + (protocol === 'benchmark') + '">Locked run</button></div><p id="arena-protocol-note" class="arena-muted"></p>' +
      '<div id="arena-local-options"' + (mode === 'practice' ? '' : ' hidden') + '><label class="arena-field">World<select id="arena-world"><option value="starter">Open tabletop</option><option value="clutter">Cluttered workspace</option><option value="moving">Moving obstacle</option><option value="night">Low light</option><option value="surprise">Moving destination</option></select></label><label class="arena-field">World seed<input id="arena-seed" type="text" maxlength="64" value="' + esc(selection.seed ?? '42') + '"></label><button class="arena-text-button" data-arena-action="new-world">Create this world ↗</button></div>' +
      '<div id="arena-profile-summary"' + (mode === 'practice' ? ' hidden' : '') + '><span class="arena-micro">EXECUTION PROFILE</span><strong id="arena-profile-name">' + esc(p?.name || p?.title || (p ? p.id : 'Custom robot + model')) + '</strong><p class="arena-muted">' + esc(selection.error || (p ? 'Connect a worker advertising this exact body, checkpoint and controller contract.' : 'This pair needs a matching execution profile. Your robot and model selection stays intact.')) + '</p><button class="arena-text-button" data-arena-action="connect">Connect your worker ↗</button></div></div>' +
      '<div class="arena-panel-section"><div class="arena-panel-label"><h3>Change the world</h3><span class="arena-small-glyph" aria-hidden="true">✧</span></div><p id="arena-disturbance-note" class="arena-muted"></p><div class="arena-disturbances"><button id="arena-add-obstacle" data-arena-action="add-obstacle"><span aria-hidden="true">▧</span>Add obstacle</button><button id="arena-move-obstacle" data-arena-action="move-obstacle"><span aria-hidden="true">↔</span>Move obstacle</button><button id="arena-lighting" data-arena-action="lighting"><span aria-hidden="true">◐</span>Change light</button><button id="arena-target" data-arena-action="target"><span aria-hidden="true">⌖</span>Move target</button><button id="arena-occlusion" data-arena-action="camera-occlusion"><span aria-hidden="true">◒</span>Obscure camera</button><button id="arena-clear-camera" data-arena-action="clear-camera"><span aria-hidden="true">◉</span>Clear camera</button></div></div>' +
      '<div class="arena-panel-section arena-evidence-panel"><div class="arena-panel-label"><h3>Run evidence</h3><span class="arena-badge" id="arena-evidence-badge">NO RUN</span></div><dl class="arena-metrics"><div><dt id="arena-outcome-label">Outcome</dt><dd id="arena-outcome">—</dd></div><div><dt>Steps</dt><dd id="arena-steps">—</dd></div><div><dt>Contacts</dt><dd id="arena-contacts">—</dd></div><div><dt>Interventions</dt><dd id="arena-interventions">—</dd></div><div><dt>Policy latency</dt><dd id="arena-latency">—</dd></div></dl><button class="arena-button arena-export" data-arena-action="export">Export evidence <span aria-hidden="true">↓</span></button></div></aside></div>' +
      '<section class="arena-timeline" data-arena-after-run hidden><div class="arena-timeline-title"><div><span class="arena-micro">TIME MACHINE</span><strong id="arena-timeline-label">Make a run. Keep the evidence.</strong></div><div class="arena-timeline-actions"><button class="arena-button arena-primary" id="arena-inspect" data-arena-action="inspect">Inspect run</button><button class="arena-button" id="arena-return-live" data-arena-action="return-live" hidden>Return to live</button><button class="arena-button" id="arena-branch" data-arena-action="branch">Branch here ↗</button></div></div><input id="arena-scrubber" type="range" min="0" max="0" value="0" aria-label="Replay recorded arena state"><div class="arena-timeline-footer"><span id="arena-timeline-start">00:00</span><span id="arena-branch-note">Replay and branch are available in local practice or a capable worker.</span><span id="arena-timeline-end">00:00</span></div><div id="arena-events" class="arena-event-list" aria-label="Run events"></div></section>' +
      '<div class="arena-status-message" id="arena-status-message" role="status" aria-live="polite"></div></div>' +
      '<p class="arena-integrity" id="arena-integrity"></p><details class="arena-recording-tools"><summary>Recording tools</summary><a href="#inspect" data-arena-action="open-recording">Open a recording</a><p>Inspect a local file without connecting to a worker.</p></details>' +
      '<section id="arena-connect-panel" class="arena-connect-panel" hidden aria-labelledby="arena-connect-title"><div class="arena-connect-header"><div><span class="arena-eyebrow">BRING YOUR COMPUTE</span><h3 id="arena-connect-title">Connect a simulation worker.</h3></div><button class="arena-icon-button" data-arena-action="close-connect" aria-label="Close worker connection panel">×</button></div><p>Use an already running worker with a matching physics and policy profile. The worker must accept this site’s origin. Connecting does not rent a GPU.</p><form id="arena-connect-form"><label class="arena-field">Worker URL<input id="arena-worker-url" type="url" placeholder="https://your-worker.example" required autocomplete="off" spellcheck="false"></label><label class="arena-field">Session token<input id="arena-worker-token" type="password" placeholder="Optional worker token" autocomplete="off"></label><div class="arena-connect-actions"><button class="arena-button arena-primary" type="submit" id="arena-connect-submit">Connect & check profile</button><button class="arena-button" type="button" data-arena-action="disconnect">Disconnect</button></div></form><div id="arena-worker-task-panel" hidden><label class="arena-field">Available worker mission<select id="arena-worker-task"></select></label><button class="arena-button arena-primary" data-arena-action="create-session" id="arena-create-session">Create session</button></div><p class="arena-worker-links"><a href="worker-setup.html" target="_blank" rel="noopener noreferrer">Set up a physics worker ↗</a><a href="downloads/brainsnn-arena-worker.zip" download>Download worker kit ↓</a></p><p class="arena-muted">Credentials stay in memory and are excluded from exports. A successful connection checks the exact robot, checkpoint and control contract.</p><p id="arena-connect-message" role="status"></p><button class="arena-text-button" data-arena-action="practice">Switch to local practice · not a model score</button></section>';
    if ($('arena-world')) $('arena-world').value = challenge;
    if (mode === 'practice' && world && $('arena-seed')) $('arena-seed').value = String(world.seed);
    wire(); mountGame(); refresh(); draw();
  }
  function mountGame() {
    if (!window.BrainSNNArenaGameUI || !window.BrainSNNArenaGame || !$('arena-game-bar')) return;
    game = window.BrainSNNArenaGameUI.create({
      bar: $('arena-game-bar'), viewport: () => $('arena-viewport'), canvas: () => $('arena-canvas'), camera: () => camera,
      // The race uses whatever challenge and seed the practice world has now.
      level: () => challenge, seed: () => String(world?.seed ?? selection.seed ?? '42'),
      // "Next level" picks the next challenge exactly as its ribbon chip does.
      selectLevel: id => {
        if (!practiceMissions.some(item => item[0] === id)) return;
        challenge = id; makeWorld($('arena-seed')?.value || selection.seed || '42');
        if ($('arena-world')) $('arena-world').value = challenge;
      },
      onStart: () => { pause(); message = ''; refresh(); },
      onStop: () => { message = ''; refresh(); draw(); },
      watchBot: (level, seed) => {
        // Same replacement as picking a challenge: the practice timeline restarts.
        const replaced = snapshots.length > 1;
        challenge = level; makeWorld(seed);
        if ($('arena-world')) $('arena-world').value = challenge;
        if ($('arena-seed') && world) $('arena-seed').value = String(world.seed);
        run(); message = 'Watching the scripted arm on the world you just raced. It always climbs before it crosses.' + (replaced ? ' Your previous practice run was replaced.' : ''); refresh();
      },
      tryModel: () => {
        window.BrainSNNExperiment?.showDemo?.({ challenge, note: 'Connect a compatible skill-agent endpoint. It drives this generic demo arm through the same move, pick and place commands you just used.' });
        window.BrainSNN3DClient?.showConnector?.();
      }
    });
    cleanup.push(() => { game?.destroy(); game = null; });
  }
  function refresh() {
    if (!host) return;
    const local = mode === 'practice', s = local ? active() : null, f = local ? null : viewedFrame(), racing = playing();
    if (!completedRun && (local ? world?.done : liveFrame?.policyExecuted === true && ['succeeded', 'failed'].includes(liveFrame.status))) {
      completedRun = true;
      window.dispatchEvent(new Event('brainsnn:arena-completed'));
    }
    host.classList.toggle('arena-first-run', !completedRun);
    document.querySelectorAll('[data-arena-after-run]').forEach(el => { el.hidden = !completedRun; });
    host.querySelectorAll('[data-arena-challenge]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.arenaChallenge === challenge)); el.disabled = racing; });
    game?.sync?.();
    if (local) text('arena-mission', (practiceMissions.find(item => item[0] === challenge)?.[1] || 'Local practice') + (racing ? ' · Beat the bot: three blocks before the violet ghost' : ' · Sort three blocks into the tray'));
    const live = local ? running : connection.status === 'running';
    const terminal = !local && ['succeeded', 'failed', 'error'].includes(connection.status);
    text('arena-runtime-badge', local ? 'LOCAL PRACTICE · NOT A MODEL SCORE' : connected() ? 'WORKER CONNECTED' : 'POLICY DISCONNECTED');
    $('arena-dot')?.classList.toggle('is-ready', local || connected());
    text('arena-live-pill', racing ? 'BEAT THE BOT' : !local && remoteCursor >= 0 ? 'RECORDED FRAME' : live ? 'RUNNING' : local ? (s?.done ? 'COMPLETE' : cursor < snapshots.length - 1 ? 'REPLAY' : 'PAUSED') : connected() ? connection.status.toUpperCase() : 'BODY PREVIEW');
    text('arena-run', racing ? 'Racing…' : local ? (running ? 'Ⅱ Pause' : cursor < snapshots.length - 1 ? 'Branch & run' : s?.done ? '↺ Run again' : 'Run') : connected() ? (terminal ? '↺ Reset mission' : live ? 'Ⅱ Pause' : 'Run') : connection.status === 'connected' ? 'Choose worker mission' : 'Connect worker');
    text('arena-run-top', $('arena-run')?.textContent || 'Run');
    attr('arena-run-top', 'disabled', racing || (!local && connected() && !supports(terminal ? 'reset' : live ? 'pause' : 'run')));
    attr('arena-run', 'disabled', racing || (!local && connected() && !supports(terminal ? 'reset' : live ? 'pause' : 'run')));
    attr('arena-step', 'disabled', racing || (local ? running || Boolean(s?.done) : !supports('step') || live || terminal));
    attr('arena-reset', 'disabled', racing || (!local && !supports('reset')));
    text('arena-time', (number(local ? s?.time : f?.simTime) ?? 0).toFixed(1) + ' s');
    text('arena-transport-note', local ? 'Local · no GPU usage' : f?.policyExecuted ? 'Policy execution reported by worker' : 'No policy execution recorded');
    text('arena-protocol-note', local ? 'Explore freely. Every change is recorded in your practice timeline.' : protocol === 'benchmark' ? 'Versions, seed and conditions lock at session creation. Manual disturbances are disabled.' : 'Test recovery with recorded interventions supported by your worker.');
    text('arena-disturbance-note', local ? 'Introduce a surprise. Then replay the response.' : protocol === 'benchmark' ? 'Conditions are locked for this session.' : supports('intervene') ? 'Changes are sent to the worker and recorded by its simulation.' : 'Connect an intervention-capable worker to change this world.');
    ['add-obstacle', 'move-obstacle', 'lighting', 'target'].forEach(id => { attr('arena-' + id, 'disabled', racing || (!local && !canIntervene(id))); if ($('arena-' + id)) $('arena-' + id).hidden = !local && !canIntervene(id); });
    ['arena-occlusion', 'arena-clear-camera'].forEach(id => { if ($(id)) $(id).hidden = local || !canIntervene('camera-occlusion'); attr(id, 'disabled', !canIntervene('camera-occlusion')); });
    host.querySelectorAll('[data-arena-protocol]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.arenaProtocol === protocol)); el.disabled = (local && el.dataset.arenaProtocol === 'benchmark') || Boolean(!local && profile()?.protocols && !profile().protocols.includes(el.dataset.arenaProtocol)); });
    host.querySelectorAll('[data-arena-action]').forEach(el => { if (['orbit', 'top', 'camera-reset'].includes(el.dataset.arenaAction)) el.disabled = !local; });
    text('arena-evidence-badge', local ? 'NOT A MODEL SCORE' : f ? 'WORKER DATA' : 'NO RUN');
    text('arena-outcome-label', local ? 'Demo blocks' : 'Outcome');
    text('arena-outcome', local ? (s?.delivered ?? 0) + ' / 3' : !f ? '—' : f.status === 'error' ? 'Worker error' : f.metrics?.success === true ? 'Success' : ['succeeded', 'failed'].includes(f.status) ? 'Not successful' : (f.metrics?.steps ?? 0) > 0 ? 'In progress' : 'Not run');
    text('arena-steps', local ? s?.steps ?? 0 : number(f?.metrics?.steps) ?? '—');
    text('arena-contacts', local ? s?.collisions ?? 0 : number(f?.metrics?.contacts) ?? '—');
    text('arena-interventions', local ? s?.interventions ?? 0 : number(f?.metrics?.interventions) ?? '—');
    text('arena-latency', !local && number(f?.metrics?.latencyMs) !== null ? f.metrics.latencyMs.toFixed(1) + ' ms' : '—');
    const scrub = $('arena-scrubber');
    if (scrub) { scrub.max = String(Math.max(0, (local ? snapshots.length : remoteFrames.length) - 1)); scrub.value = String(local ? cursor : remoteCursor >= 0 ? remoteCursor : Math.max(0, remoteFrames.length - 1)); scrub.disabled = racing || (local ? snapshots.length < 2 : remoteFrames.length < 2 || live); }
    text('arena-timeline-label', local ? (cursor < snapshots.length - 1 ? 'Replaying' : 'Recording') + ' · ' + (cursor + 1) + ' / ' + snapshots.length + ' states · ' + branchId : f ? 'Recorded frames · ' + remoteFrames.length + ' retained' + (droppedFrames ? ' · ' + droppedFrames + ' expired' : '') + ' · frame ' + f.seq : 'Make a run. Keep the evidence.');
    if ($('arena-return-live')) $('arena-return-live').hidden = local || remoteCursor < 0;
    text('arena-timeline-end', (local ? world?.time ?? 0 : f?.simTime ?? 0).toFixed(1) + ' s');
    text('arena-timeline-start', !local && remoteFrames.length ? remoteFrames[0].simTime.toFixed(1) + ' s' : '0.0 s');
    text('arena-branch-note', local ? 'Scrub to any state. Branch keeps the original run as evidence.' : live ? 'Pause to inspect recorded frames. Frames do not restore physics state.' : supports('branch') ? 'Recorded frames. This worker also supports branching from a recorded sequence.' : 'Recorded frames only, not state restoration. Branch needs worker support.');
    attr('arena-branch', 'disabled', racing || (local ? !snapshots.length : !supports('branch') || !f || protocol === 'benchmark'));
    const items = local ? events.filter(x => x.branch === branchId).slice(-5) : (f?.events || []).slice(-5);
    if ($('arena-events')) $('arena-events').innerHTML = items.map(x => '<span><b>' + esc(number(x.simTime) !== null ? x.simTime.toFixed(1) + 's' : '•') + '</b> ' + esc(x.kind || x.type || x.event || 'Worker event') + '</span>').join('');
    const draftNotice = !local && draftChanged() && (connection.sessionId || connection.status === 'creating') ? ' Task and seed edits apply to the next session. This session keeps its original settings.' : '';
    text('arena-status-message', racing ? 'Beat the bot is running on its own copy of this world. Quit the race to return to scripted practice and its timeline.' : (message || (local ? running ? 'Local practice running. The scripted arm is not executing an AI model.' : s?.done ? 'Run complete. Inspect the timeline or change a condition.' : 'Mission paused. Run the scripted arm, then inspect what happened.' : selection.error || (connected() ? connection.message || 'Worker ready.' : 'Your selected robot is shown as a body preview. Connect a matching worker to test its policy.'))) + draftNotice);
    text('arena-integrity', racing ? 'BEAT THE BOT · NOT A MODEL SCORE. You and the scripted arm drive the same generic demo arm through the same move, pick and place commands on the same seeded world. Times are simulation seconds, played at 2× speed.' : local ? 'LOCAL PRACTICE · NOT A MODEL SCORE. This generic arm follows a script. It does not run ' + (model()?.name || 'an AI model') + ' or simulate rigid-body dynamics.' : 'REAL ROBOT + SOFTWARE TESTING · Policy execution, sensor images and results appear only after a matching worker reports them. Body preview physics does not run the selected AI model.');
    if (mode === 'named') showFrame();
  }
  function showFrame() {
    const image = $('arena-worker-image'), holder = $('arena-frame-placeholder'), eye = $('arena-policy-eye');
    if (!image) return;
    const currentFrame = viewedFrame(), hasFrame = Boolean(currentFrame), cams = currentFrame?.cameras || [];
    const spectator = cams.find(x => x.role === 'spectator' || x.id === 'spectator');
    const policyCamera = cams.find(x => x.role === 'policy');
    const viewer = $('arena-body-viewer');
    if (hasFrame && viewer) viewer.remove();
    if (holder) holder.hidden = !hasFrame || Boolean(spectator);
    image.hidden = !spectator;
    if (spectator && image.getAttribute('src') !== spectator.url) image.setAttribute('src', spectator.url);
    if (eye) eye.hidden = !policyCamera;
    if (policyCamera) { $('arena-policy-image')?.setAttribute('src', policyCamera.url); text('arena-policy-id', policyCamera.id + (Number.isInteger(policyCamera.capturedStep) ? ' · step ' + policyCamera.capturedStep : '') + (policyCamera.consumedByPolicy === false ? ' · not consumed' : '')); }
    if (hasFrame) { text('arena-camera-title', (remoteCursor >= 0 ? 'RECORDED FRAME' : 'WORKER') + ' · SPECTATOR CAMERA'); text('arena-camera-note', policyCamera ? 'Policy camera is independent of the spectator view' : 'Worker has not supplied a policy camera'); }
  }
  function draw() {
    if (playing()) return game.draw();
    if (mode !== 'practice' || !world || !$('arena-canvas')) return;
    const result = window.BrainArena3D.render($('arena-canvas'), active(), camera);
    if ($('arena-sensor-canvas') && window.BrainArena3D.renderSensor) {
      const sensor = window.BrainArena3D.renderSensor($('arena-sensor-canvas'), active(), { width: 256, height: 256 });
      if ($('arena-local-sensor')) $('arena-local-sensor').hidden = !sensor.ok;
      sensorCamera = sensor.ok ? sensor.camera : null;
    }
    if (!result?.ok && !renderFailure) { renderFailure = true; message = '3D rendering is unavailable in this browser. Your state and evidence controls remain available; try a WebGL-enabled browser.'; refresh(); }
  }
  function pause(reason) {
    running = false; clearInterval(timer); timer = null;
    if (reason && mode === 'practice' && world) event('paused', { reason });
    refresh();
  }
  function branch() {
    if (mode !== 'practice') { if (protocol !== 'practice') return; return remote('branch', { seq: viewedFrame()?.seq }); }
    if (!snapshots[cursor]) return;
    pause();
    const source = snapshots[cursor], original = { id: branchId, snapshots: snapshots.slice(), events: events.filter(x => x.branch === branchId) };
    branches.push(freeze(original));
    branchId = 'branch-' + branches.length;
    world = clone(source.state);
    snapshots = snapshots.slice(0, cursor + 1);
    event('branch-created', { parentBranch: source.branch, parentSnapshotId: source.id, parentStep: source.state.steps });
    snapshot('branch'); message = 'Branched from ' + world.time.toFixed(1) + 's. The original timeline is retained in your export.';
    refresh(); draw();
  }
  function step() {
    if (mode !== 'practice') return remote('step');
    if (!world) return;
    if (cursor < snapshots.length - 1) branch();
    if (world.done) return;
    const before = world.event;
    const controllerInput = window.BrainArena3D.demoAction(world);
    window.BrainArena3D.step(world, controllerInput);
    if (world.event !== before && !['move', 'wait', 'arrive', 'move-command'].includes(world.event)) event(world.event);
    snapshot('step', controllerInput);
    if (world.done) { pause(); message = world.success ? 'Scripted demo complete. Rewind and change a condition to explore another path.' : 'The demo reached its step limit. Rewind to inspect what happened.'; }
    refresh(); draw();
  }
  function run() {
    if (mode !== 'practice') { if (!connected()) return openConnect(); return remote(['succeeded', 'failed', 'error'].includes(connection.status) ? 'reset' : connection.status === 'running' ? 'pause' : 'run'); }
    if (running) return pause('user');
    if (!world) makeWorld();
    if (!world) return refresh();
    if (cursor < snapshots.length - 1) branch();
    if (world.done) makeWorld(world.seed);
    message = ''; running = true; event('run-started');
    timer = setInterval(step, 100); refresh();
  }
  function disturb(kind) {
    if (mode !== 'practice') { if (protocol === 'benchmark') return; return remote('intervene', { kind }); }
    if (!world) return;
    if (cursor < snapshots.length - 1) branch();
    const before = clone({ obstacles: world.obstacles, goal: world.goal, challenge: world.opts.challenge });
    if (kind === 'add-obstacle') {
      const n = world.obstacles.length;
      world.obstacles.push({ id: 'user-obstacle-' + counter, position: [0.08 + (n % 3) * 0.23, -0.35 + (n % 2) * 0.48, 0.26], size: [0.22, 0.2, 0.52], dynamic: false });
    } else if (kind === 'move-obstacle') {
      if (!world.obstacles.length) world.obstacles.push({ id: 'user-obstacle-' + counter, position: [0.16, 0.2, 0.26], size: [0.22, 0.2, 0.52], dynamic: false });
      const o = world.obstacles[world.obstacles.length - 1]; o.dynamic = false; o.position[0] = o.position[0] > 0 ? -0.3 : 0.32; o.position[1] = o.position[1] > 0 ? -0.28 : 0.28;
    } else if (kind === 'lighting') {
      world.opts.challenge = world.opts.challenge === 'night' ? (challenge === 'night' ? 'starter' : challenge) : 'night'; world.opts.lighting = world.opts.challenge === 'night' ? 'night' : 'studio';
    } else if (kind === 'target') {
      world.goal.position[1] = world.goal.position[1] > 0 ? -0.48 : 0.45;
      world.objects.filter(x => x.delivered).forEach((x, i) => { x.position = [world.goal.position[0] - 0.13 + i * 0.13, world.goal.position[1], 0.08]; });
    }
    world.interventions++; world.event = kind;
    event(kind, { before, after: { obstacles: world.obstacles, goal: world.goal, challenge: world.opts.challenge } });
    snapshot('intervention'); message = 'Changed ' + kind.replace(/-/g, ' ') + '. This intervention is recorded in practice evidence.';
    refresh(); draw();
  }
  function openConnect() {
    const panel = $('arena-connect-panel'); if (!panel) return;
    panel.hidden = false; panel.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); $('arena-worker-url')?.focus();
  }
  async function connectWorker(ev) {
    ev?.preventDefault();
    if (!window.BrainSNNRuntime) { message = 'The runtime connector did not load. Reload this page.'; return refresh(); }
    if (selection.error || !selection.robotId || !selection.modelId) { text('arena-connect-message', selection.error || 'Choose a robot and a model before connecting.'); return; }
    const url = $('arena-worker-url')?.value.trim(), token = $('arena-worker-token')?.value || '';
    if (!url) { $('arena-worker-url')?.focus(); return; }
    const localGeneration = ++generation;
    client?.disconnect(); clearRemoteHistory();
    const activeClient = window.BrainSNNRuntime.createClient({
      onState: value => { if (localGeneration !== generation) return; connection = value; message = value.message || ''; text('arena-connect-message', value.message || value.status); refresh(); },
      onFrame: value => { if (localGeneration !== generation) return; recordFrame(value); refresh(); },
      onError: error => { if (localGeneration !== generation) return; message = error.message || String(error); text('arena-connect-message', message); refresh(); }
    });
    client = activeClient;
    attr('arena-connect-submit', 'disabled', true);
    try {
      await activeClient.connect({ url, token, selection: { ...selection, task: '', protocol } });
      if (localGeneration !== generation || client !== activeClient || connection.status !== 'connected') return;
      const tasks = connection.profile?.tasks || [];
      if ($('arena-worker-task')) $('arena-worker-task').innerHTML = tasks.map(t => '<option value="' + esc(t.id) + '">' + esc(t.label || t.id) + '</option>').join('');
      const previous = tasks.find(t => t.id === selection.task || t.label === selection.task);
      workerTask = previous?.id || tasks[0]?.id || '';
      if ($('arena-worker-task')) $('arena-worker-task').value = workerTask;
      if ($('arena-worker-task-panel')) $('arena-worker-task-panel').hidden = false;
      attr('arena-create-session', 'disabled', !tasks.length || !connection.profile?.ready);
      text('arena-connect-message', !connection.profile?.ready ? connection.profile?.reason || 'Configure the worker policy before creating a session.' : tasks.length ? 'Profile verified. Choose an available worker mission, then create the session.' : 'Profile verified, but this worker has no available missions. Configure a task on the worker.');
    } catch (err) { if (localGeneration === generation) { message = err.message || String(err); text('arena-connect-message', message); refresh(); } }
    finally { if (localGeneration === generation) { attr('arena-connect-submit', 'disabled', false); if ($('arena-worker-token')) $('arena-worker-token').value = ''; } }
  }
  async function createSession() {
    if (!client || connection.status !== 'connected') return;
    const localGeneration = generation, activeClient = client;
    workerTask = $('arena-worker-task')?.value || workerTask;
    sessionDraft = { task: String(selection.task ?? ''), seed: String(selection.seed ?? '') };
    attr('arena-create-session', 'disabled', true);
    try {
      await activeClient.start({ ...selection, task: workerTask, protocol });
      if (localGeneration !== generation || client !== activeClient || !connected()) return;
      text('arena-mission', connection.selection?.task || workerTask);
      text('arena-connect-message', 'Matching session created. Use Run mission to start.');
      if ($('arena-connect-panel')) $('arena-connect-panel').hidden = true;
      message = 'Worker session ready. Start the mission when you are ready.'; refresh();
    } catch (err) { if (localGeneration === generation) { message = err.message || String(err); text('arena-connect-message', message); refresh(); } }
    finally { if (localGeneration === generation) attr('arena-create-session', 'disabled', connection.status !== 'connected' || !connection.profile?.ready); }
  }
  async function remote(type, payload = {}) {
    if (!supports(type)) { message = 'This worker does not offer ' + type + ' for the selected profile.'; return refresh(); }
    if (type === 'intervene' && protocol === 'benchmark') return;
    if (['run', 'step', 'reset', 'branch', 'intervene'].includes(type)) remoteCursor = -1;
    try { await client.command(type, payload); } catch (err) { message = err.message || String(err); refresh(); }
  }
  function download() {
    const blob = new Blob([JSON.stringify(evidence(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url;
    a.download = 'brainsnn-' + (mode === 'practice' ? 'practice' : 'worker') + '-evidence.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message = 'Evidence exported. ' + (mode === 'practice' ? 'The file marks every outcome as a scripted demo.' : 'Credentials and camera URLs are excluded.'); refresh();
  }
  function inspectRun() {
    if (!window.BrainSNNArenaInspector) { message = 'The recording inspector did not load. Reload this page.'; return refresh(); }
    const savedEvidence = evidence(), activeClient = client, recordingId = liveFrame?.recording?.recordingId;
    const durable = mode === 'named' && connection.capabilities?.recordings && activeClient;
    // Export time and the replay cursor do not change the underlying run.
    // Reuse the first checked adaptation until recorded evidence changes, so a
    // local review survives closing and reopening an unchanged practice run.
    const identity = clone(savedEvidence); delete identity.createdAt;
    if (identity.local) delete identity.local.cursor;
    const legacyKey = durable ? null : JSON.stringify(identity);
    return window.BrainSNNArenaInspector.open({ trigger: $('arena-inspect'), load: async () => {
      if (durable) {
        return activeClient.getRecording(recordingId);
      }
      // Old exports are incomplete by construction. The adapter keeps that gap
      // visible and never substitutes a selected model for execution evidence.
      if (inspectedLegacy?.key === legacyKey) return inspectedLegacy.bundle;
      const bundle = await window.BrainSNNArenaRecording.adaptLegacy(savedEvidence);
      inspectedLegacy = { key: legacyKey, bundle }; return bundle;
    } });
  }
  function switchMode(next) {
    if (mode === next) return;
    pause(); generation++; client?.disconnect(); client = null; connection = { status: 'disconnected' }; clearRemoteHistory();
    mode = next; message = '';
    if (next === 'practice') { protocol = 'practice'; if (!world) makeWorld(); }
    render();
  }
  function handleAction(action) {
    if (action === 'run') return run();
    if (action === 'step') return step();
    if (action === 'reset') { if (mode === 'practice') { makeWorld(world?.seed); message = 'Practice reset to its seeded starting state.'; refresh(); draw(); } else remote('reset'); return; }
    if (action === 'branch') return branch();
    if (action === 'return-live') { remoteCursor = -1; message = 'Showing the latest worker frame.'; refresh(); return; }
    if (['add-obstacle', 'move-obstacle', 'lighting', 'target'].includes(action)) return disturb(action);
    if (action === 'camera-occlusion' || action === 'clear-camera') return remote('intervene', { kind: 'camera-occlusion', enabled: action === 'camera-occlusion', fraction: 0.35 });
    if (action === 'practice' || action === 'named') return switchMode(action);
    if (action === 'connect') return openConnect();
    if (action === 'create-session') return createSession();
    if (action === 'close-connect') { $('arena-connect-panel').hidden = true; return; }
    if (action === 'disconnect') { generation++; client?.disconnect(); client = null; connection = { status: 'disconnected' }; clearRemoteHistory(); message = 'Worker disconnected. No model is running in this page.'; render(); return; }
    if (action === 'export') return download();
    if (action === 'inspect') return inspectRun();
    if (action === 'open-recording') return window.BrainSNNArenaInspector?.open({ trigger: host?.querySelector('[data-arena-action="open-recording"]') });
    if (action === 'new-world') { const seed = $('arena-seed')?.value || '42'; challenge = $('arena-world')?.value || 'starter'; makeWorld(seed); message = 'Seeded practice world ready.'; refresh(); draw(); return; }
    if (mode !== 'practice') return;
    if (action === 'orbit') camera.yaw += Math.PI / 4;
    if (action === 'top') { camera.pitch = 1.39; camera.distance = 4.8; }
    if (action === 'camera-reset') camera = { yaw: -0.95, pitch: 0.62, distance: 5.1 };
    draw();
  }
  function wire() {
    on(host, 'click', ev => {
      const action = ev.target.closest?.('[data-arena-action]');
      if (action && !action.disabled && !action.hasAttribute('disabled')) { if (action.tagName === 'A') ev.preventDefault(); return handleAction(action.dataset.arenaAction); }
      const mission = ev.target.closest?.('[data-arena-challenge]');
      if (mission && mode === 'practice' && practiceMissions.some(item => item[0] === mission.dataset.arenaChallenge)) {
        challenge = mission.dataset.arenaChallenge; makeWorld($('arena-seed')?.value || selection.seed || '42');
        if ($('arena-world')) $('arena-world').value = challenge;
        message = 'New practice mission ready. Press Run when you are ready.'; refresh(); draw(); return;
      }
      const quick = ev.target.closest?.('[data-arena-profile]');
      if (quick) { const [robotId, modelId] = quick.dataset.arenaProfile.split(':'); window.BrainSNNExperiment?.open?.({ robotId, modelId, seed: selection.seed ?? 42 }); return; }
      const toggle = ev.target.closest?.('[data-arena-protocol]');
      if (toggle && !toggle.disabled && toggle.dataset.arenaProtocol !== protocol) {
        generation++; client?.disconnect(); client = null; connection = { status: 'disconnected' }; clearRemoteHistory();
        protocol = toggle.dataset.arenaProtocol; message = 'Protocol changed. Connect a new worker session with these locked conditions.'; render();
      }
    });
    on($('arena-connect-form'), 'submit', connectWorker);
    on($('arena-scrubber'), 'input', ev => {
      if (playing()) return;
      const requested = Number(ev.target.value) || 0;
      if (mode !== 'practice') {
        if (connection.status === 'running' || !remoteFrames.length) return;
        remoteCursor = clamp(requested, 0, remoteFrames.length - 1); message = 'Inspecting recorded worker images and metrics. The physics state has not been restored.'; refresh(); return;
      }
      pause(); cursor = clamp(requested, 0, snapshots.length - 1); message = 'Replay: viewing an immutable recorded state. Branch to change its future.'; refresh(); draw();
    });
    const canvas = $('arena-canvas');
    on(canvas, 'pointerdown', ev => { drag = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture?.(ev.pointerId); });
    on(canvas, 'pointermove', ev => { if (!drag) return; camera.yaw -= (ev.clientX - drag.x) * 0.008; camera.pitch = clamp(camera.pitch + (ev.clientY - drag.y) * 0.006, 0.15, 1.4); drag = { x: ev.clientX, y: ev.clientY }; draw(); });
    on(canvas, 'pointerup', () => { drag = null; }); on(canvas, 'pointercancel', () => { drag = null; });
    on(canvas, 'wheel', ev => { ev.preventDefault(); camera.distance = clamp(camera.distance + ev.deltaY * 0.005, 2.1, 9); draw(); }, { passive: false });
    on(canvas, 'keydown', ev => { if (playing() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(ev.key)) return; ev.preventDefault(); if (ev.key === 'ArrowLeft') camera.yaw -= 0.12; if (ev.key === 'ArrowRight') camera.yaw += 0.12; if (ev.key === 'ArrowUp') camera.pitch = clamp(camera.pitch + 0.1, 0.15, 1.4); if (ev.key === 'ArrowDown') camera.pitch = clamp(camera.pitch - 0.1, 0.15, 1.4); if (ev.key === '+' || ev.key === '=') camera.distance = clamp(camera.distance - 0.2, 2.1, 9); if (ev.key === '-') camera.distance = clamp(camera.distance + 0.2, 2.1, 9); draw(); });
    on(window, 'resize', draw);
    on(document, 'visibilitychange', () => { if (!document.hidden) return; if (mode === 'practice') pause('page-hidden'); else if (connection.status === 'running' && supports('pause')) remote('pause'); });
  }
  function suspend() {
    window.BrainSNNArenaInspector?.close();
    inspectedLegacy = null;
    running = false; clearInterval(timer); timer = null; generation++;
    cleanup.forEach(fn => fn()); cleanup = [];
    client?.disconnect(); client = null; connection = { status: 'disconnected' }; clearRemoteHistory();
    $('arena-body-viewer')?.remove(); if ($('arena-worker-token')) $('arena-worker-token').value = '';
    host = null; drag = null;
  }
  function mount(element, nextSelection = {}) {
    // A shared "Beat the bot" link opens local practice on its level, keeping
    // any saved robot + model selection for later.
    const link = window.BrainSNNArenaGameUI?.pendingLink?.();
    suspend(); host = element; selection = clone(nextSelection); mode = link || !(selection.robotId || selection.modelId) ? 'practice' : 'named'; protocol = 'practice';
    if (link) challenge = link.level;
    world = null; snapshots = []; events = []; branches = []; cursor = 0; branchId = 'main'; counter = 0;
    message = ''; workerTask = ''; mountedAt = stamp(); if (mode === 'practice') makeWorld(link ? link.seed : undefined); render(); return getState();
  }
  function updateSelection(nextSelection) {
    const next = { ...selection, ...clone(nextSelection) };
    const identityChanged = ['robotId', 'modelId', 'profileId'].some(key => (next[key] || null) !== (selection[key] || null));
    const seedChanged = String(next.seed ?? '') !== String(selection.seed ?? '');
    const taskChanged = String(next.task ?? '') !== String(selection.task ?? '');
    if (identityChanged && host) return mount(host, next);
    selection = next;
    if (!host) return getState();
    // Header input events update the next-session draft. They must not destroy
    // a paid worker session, replay evidence, or the current local practice run.
    if (mode === 'practice') {
      if (seedChanged && $('arena-seed')) $('arena-seed').value = String(selection.seed ?? '42');
      if (seedChanged) message = 'Draft seed updated. Create this world to use it; the current practice run is preserved.';
    } else if (!connection.sessionId && connection.status !== 'creating') {
      if (taskChanged) text('arena-mission', selection.task || 'Choose a mission, connect a worker');
      if (taskChanged && connection.status === 'connected') {
        const task = connection.profile?.tasks?.find(item => item.id === selection.task || item.label === selection.task);
        if (task) { workerTask = task.id; if ($('arena-worker-task')) $('arena-worker-task').value = workerTask; }
      }
    }
    refresh(); return getState();
  }
  window.BrainSNNArena = Object.freeze({ mount, suspend, getState, updateSelection, exportEvidence: evidence });
})();
