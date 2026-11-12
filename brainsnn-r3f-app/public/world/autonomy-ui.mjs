// Autonomy trial page: a live top-down view of the sense -> map -> plan -> act loop on a reviewed World map, and a
// paired trial that runs the same tasks clean and broken on purpose. Everything runs in this browser; nothing uploads.
import {sampleWorld, normalizeWorld, planningGate} from './core.mjs';
import {PLATFORMS, SENSOR_SPECS, OBSTACLE_RANGE, createEpisode, stepEpisode, requestCrate, sampleTasks, runTrial, verifyTrialReport, footprint, createMap, planPath} from './autonomy.mjs';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ROBOT_ORDER = ['amr', 'cleaner', 'vacuum', 'humanoid', 'quadruped', 'forklift'];
const C = {bg: '#070f1d', floor: '#0e1b2d', edge: '#3a5876', cyan: '#5ad8e8', violet: '#ac8bf4', amber: '#e5b07b', red: '#f38a8a', text: '#d9ebfb', muted: '#8fa9c2'};
const SENSOR_NAMES = {lidar: 'Roof lidar', 'depth-front': 'Front depth camera', 'depth-rear': 'Rear depth camera'};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {world: sampleWorld(), source: 'sample', ep: null, running: false, speed: 1, seed: 1, view: {w: 0, h: 0, s: 1, ox: 0, oz: 0, dpr: 1}, mapPainted: -1, logged: {events: 0}, trial: null, report: null,
  lastPath: null, ghost: null, pulses: [], flash: null};
const canvas = $('view'), ctx = canvas.getContext('2d');
const off = document.createElement('canvas'), offCtx = off.getContext('2d');
let image = null, pixels = null;

// ---------------------------------------------------------------------------------------------------------------
// Setup.
function robot() { return PLATFORMS[$('robot').value] ? $('robot').value : 'amr'; }
function sensors() { return {lidar: $('s-lidar').checked, front: $('s-front').checked, rear: $('s-rear').checked}; }
function status(text, bad = false) { $('status').textContent = text; $('status').classList.toggle('bad', bad); }
function savedWorld() { try { const raw = localStorage.getItem('brainsnn.world.v1'); return raw ? JSON.parse(raw) : null; } catch { return null; } }

function setWorld(input, source) {
  const world = normalizeWorld(input);
  // A file or a saved map is reviewed by the person here, never by the file: World Builder's rule.
  if (source !== 'sample') { world.scaleReviewed = false; world.mapReviewed = false; }
  state.world = world; state.source = source;
  $('scale-ok').checked = false; $('map-ok').checked = false;
  $('review').hidden = source === 'sample';
  $('world-name').textContent = world.name;
  $('world-badge').textContent = source === 'sample' ? 'AUTHORED SAMPLE · REVIEWED' : 'NEEDS YOUR REVIEW';
  return world;
}
function gate() {
  if (state.source !== 'sample') { state.world.scaleReviewed = $('scale-ok').checked; state.world.mapReviewed = $('map-ok').checked; }
  const g = planningGate(state.world);
  $('world-badge').textContent = g ? 'NEEDS YOUR REVIEW' : state.source === 'sample' ? 'AUTHORED SAMPLE · REVIEWED' : 'REVIEWED BY YOU';
  return g;
}

function defaultTask(world, key, seed) {
  if (state.source === 'sample') {
    // The long diagonal across the sample floor when this robot fits it, so a first visit sees the whole loop.
    const p = PLATFORMS[key], radius = Math.hypot(p.width, p.depth) / 2 + 0.1, map = createMap(world, {prior: true});
    for (const goal of [{x: 16.5, z: 11.5}, {x: 16.6, z: 5.2}, {x: 9.5, z: 11}]) if (planPath(map, null, world.start, goal, {radius}).ok) return {start: world.start, goal};
  }
  const t = sampleTasks(world, key, 1, seed)[0];
  return t ? {start: t.start, goal: t.goal} : null;
}

/** Start a live episode. `keep` continues from where the robot stands with what it has already mapped. */
function startEpisode({goal = null, keep = false, demoCrate = false} = {}) {
  const g = gate();
  if (g) { pause(); state.ep = null; draw(); status(g, true); return false; }
  const key = robot(), prev = keep && state.ep && state.ep.robotKey === key ? state.ep : null;
  const task = goal ? {start: prev ? prev.truePose : state.world.start, goal} : defaultTask(state.world, key, state.seed);
  if (!task) { status('No start and goal on this map fits this robot. Choose a smaller robot or review the map.', true); state.ep = null; draw(); return false; }
  try {
    state.ep = createEpisode(state.world, {robot: key, start: task.start, goal: task.goal, seed: state.seed, sensors: sensors(), prior: $('prior').checked, density: 'demo', record: true,
      ...(prev ? {heading: prev.truePose.th, map: prev.map, planner: prev.planner, extraObstacles: prev.extras} : {}),
      perturbations: demoCrate ? {crate: true, crateAt: 4} : {}});
  } catch (error) { status(error.message, true); return false; }
  state.logged = {events: 0}; state.mapPainted = -1; state.lastPath = state.ep.path; state.ghost = null; state.pulses = []; state.flash = null; if (!prev) $('log').replaceChildren();
  logEvents(); status(`${PLATFORMS[key].name}: tap the floor to send it somewhere else, or drop a crate in its way.`);
  syncButtons(); draw(); return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The live loop: 10 Hz simulation, drawn every animation frame.
let last = 0, debt = 0, frame = 0;
function play() { if (!state.ep) return; if (state.ep.outcome) { state.seed++; if (!startEpisode({demoCrate: true})) return; } state.running = true; last = performance.now(); debt = 0; cancelAnimationFrame(frame); frame = requestAnimationFrame(loop); syncButtons(); }
function pause() { state.running = false; cancelAnimationFrame(frame); syncButtons(); }
function loop(now) {
  if (!state.running || !state.ep) return;
  debt += Math.min(250, now - last) * state.speed; last = now;
  const started = performance.now();
  while (debt >= 100 && !state.ep.outcome) { stepEpisode(state.ep); debt -= 100; trackPath(now); if (performance.now() - started > 30) { debt = 0; break; } }
  logEvents(now); draw(now);
  if (state.ep.outcome) { state.running = false; syncButtons(); return; }
  frame = requestAnimationFrame(loop);
}
// Keep the route a blocked replan replaced, briefly, so the change is visible: the moment the clip is about.
function trackPath(now) {
  const ep = state.ep;
  if (ep.path === state.lastPath) return;
  const why = ep.replans[ep.replans.length - 1]?.reason;
  if (state.lastPath && ep.path && (why === 'path-blocked' || why === 'recovery')) state.ghost = {path: state.lastPath, until: now + 2600};
  state.lastPath = ep.path;
}
function syncButtons() {
  const ep = state.ep;
  $('play').textContent = state.running ? 'Pause' : ep?.outcome ? 'Run again' : ep && ep.t > 0 ? 'Resume' : 'Run';
  $('play').disabled = !ep && !!gate();
  $('crate').disabled = !ep || !!ep.outcome;
  $('speed').textContent = `Speed ${state.speed}×`;
}

// ---------------------------------------------------------------------------------------------------------------
// Narration: the episode's own events, in plain words, with the device's real replan times.
function eventLine(e) {
  switch (e.type) {
    case 'start': return [`Route planned on the robot's map: ${e.referenceDistance} m on the reviewed map.`, ''];
    case 'crate-drop': return [`Crate dropped ${e.aheadMetres} m ahead. The robot's map does not have it.`, 'warn'];
    case 'crate-first-return': return [`${SENSOR_NAMES[e.sensor] || e.sensor}: first return off the crate.`, ''];
    case 'crate-in-map': return ['Crate entered the robot\'s map.', ''];
    case 'crate-replan': return [`Crate blocked the route. Replanned in ${e.ms} ms on this device.`, 'good'];
    case 'crate-replan-failed': return ['Crate blocked the route and no way around it fits.', 'warn'];
    case 'crate-skipped': return [`No crate: ${e.why}`, ''];
    case 'unmapped-object-in-map': return ['Found an object the reviewed map does not have.', 'warn'];
    case 'blackout-start': return [`${SENSOR_NAMES[e.sensor]} went dark.`, 'warn'];
    case 'blackout-end': return [`${SENSOR_NAMES[e.sensor]} is back.`, ''];
    case 'recovery': return [`No progress: recovery (${e.mode.replace('-', ' ')}).`, 'warn'];
    case 'reached': return ['Reached the goal.', 'good'];
    case 'contact': return [`Contact with ${e.with.name || e.with.kind}, scored against ground truth.`, 'bad'];
    case 'keep-out': return [`Entered a keep-out area: ${e.zone.name}.`, 'bad'];
    case 'no-route': return ['Safe stop: no route fits.', 'warn'];
    case 'stuck': return ['Stuck: no progress for 12 s.', 'bad'];
    case 'timeout': return ['Timed out.', 'bad'];
    default: return null;
  }
}
function logEvents(now = performance.now()) {
  const ep = state.ep; if (!ep) return;
  const list = $('log');
  for (; state.logged.events < ep.events.length; state.logged.events++) {
    const e = ep.events[state.logged.events], line = eventLine(e); if (!line) continue;
    if (e.type === 'crate-drop' && !reduceMotion) state.pulses.push({x: e.x, z: e.z, start: now});
    if (e.type === 'crate-replan') state.flash = {text: `replanned · ${e.ms} ms`, until: now + 2600};
    if (e.type === 'contact') state.flash = {text: 'contact', until: now + 4000, bad: true};
    const li = document.createElement('li'); li.className = line[1];
    li.innerHTML = `<time>${e.t.toFixed(1)} s</time> ${esc(line[0])}`; list.append(li);
    while (list.children.length > 40) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  }
  const lastPlan = ep.replans[ep.replans.length - 1], v = ep.controller.lastU.v;
  $('hud').textContent = `${ep.t.toFixed(1)} s · ${Math.abs(v).toFixed(2)} m/s · ${ep.replans.length} plans · last ${lastPlan ? (lastPlan.ms + lastPlan.mapMs).toFixed(1) : '–'} ms · map ${Math.round(ep.map.res * 1000) / 10} cm`;
}

// ---------------------------------------------------------------------------------------------------------------
// Drawing.
function resize() {
  const wrap = canvas.parentElement, w = wrap.clientWidth, W = state.world.width, D = state.world.depth;
  // A transient zero-width layout (a hidden tab, a screenshot resize) must not produce a negative scale.
  if (w < 60) return;
  const h = Math.max(220, Math.min(innerHeight * 0.66, (w - 20) * D / W + 20)), dpr = Math.min(2, devicePixelRatio || 1);
  canvas.style.height = `${h}px`; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const s = Math.min((w - 20) / W, (h - 20) / D);
  state.view = {w, h, s, ox: (w - W * s) / 2, oz: (h - D * s) / 2, dpr};
  draw();
}
const rgba = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const PAINT = {prior: rgba(38, 60, 88, 255), confirm: rgba(63, 143, 163, 255), sensed: rgba(90, 216, 232, 255), band: rgba(90, 216, 232, 22), free: rgba(130, 190, 240, 26), none: 0};
function paintMap(ep) {
  const m = ep.map;
  if (!image || off.width !== m.nx || off.height !== m.nz) { off.width = m.nx; off.height = m.nz; image = offCtx.createImageData(m.nx, m.nz); pixels = new Uint32Array(image.data.buffer); }
  if (state.mapPainted === ep.ticks) return;
  const r = ep.radius;
  for (let i = 0; i < m.n; i++) {
    pixels[i] = m.prior[i] ? PAINT.prior : m.sensed[i] ? (m.lethal[i] ? PAINT.sensed : PAINT.confirm) : m.dist[i] < r ? PAINT.band : m.seen[i] && m.logOdds[i] < 0 ? PAINT.free : PAINT.none;
  }
  offCtx.putImageData(image, 0, 0); state.mapPainted = ep.ticks;
}
function draw(now = performance.now()) {
  const {w, h, s, ox, oz, dpr} = state.view, ep = state.ep, world = state.world;
  if (!(s > 0)) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
  const X = x => ox + x * s, Z = z => oz + z * s;
  const shape = pts => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Z(p[1])) : ctx.moveTo(X(p[0]), Z(p[1]))); ctx.closePath(); };
  shape(world.floor || [[0, 0], [world.width, 0], [world.width, world.depth], [0, world.depth]]); ctx.fillStyle = C.floor; ctx.fill();
  if (!ep) { ctx.strokeStyle = C.edge; ctx.stroke(); return; }
  paintMap(ep); ctx.imageSmoothingEnabled = false; ctx.drawImage(off, X(0), Z(0), ep.map.nx * ep.map.res * s, ep.map.nz * ep.map.res * s);
  shape(world.floor || [[0, 0], [world.width, 0], [world.width, world.depth], [0, world.depth]]); ctx.strokeStyle = C.edge; ctx.lineWidth = 1; ctx.stroke();
  // Reviewed geometry and keep-out rules.
  ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textBaseline = 'top';
  for (const o of world.objects) {
    if (o.kind === 'obstacle') { ctx.strokeStyle = 'rgba(160,190,220,.35)'; ctx.setLineDash([]); }
    else { ctx.strokeStyle = C.amber; ctx.setLineDash([4, 3]); }
    ctx.strokeRect(X(o.x), Z(o.z), o.w * s, o.d * s);
  }
  ctx.setLineDash([]);
  // Ground truth the robot was not given: what a trial added on purpose.
  if ($('truth').checked) for (const b of ep.truth.boxes) if (!b.mapped) {
    ctx.strokeStyle = C.violet; ctx.setLineDash([5, 3]); ctx.lineWidth = 1.5; ctx.strokeRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s); ctx.setLineDash([]);
    ctx.fillStyle = C.violet; ctx.fillText('not in map', X(b.x0), Z(b.z1) + 2);
  }
  const tp = ep.truePose, ct = Math.cos(tp.th), st = Math.sin(tp.th);
  // Sensor coverage: the lidar's mapping range and each depth camera's horizontal field of view.
  ctx.strokeStyle = 'rgba(90,216,232,.12)'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(X(tp.x), Z(tp.z), OBSTACLE_RANGE * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  for (const sn of ep.sensors) {
    if (sn.spec !== 'depth') continue;
    const dark = ep.blackout && sn.id === ep.blackout.sensor && ep.t >= ep.blackout.from && ep.t < ep.blackout.to;
    const cx = X(tp.x + ct * sn.forward), cz = Z(tp.z + st * sn.forward), yaw = tp.th + (sn.yaw || 0), half = SENSOR_SPECS.depth.hFovDeg / 2 * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx, cz); ctx.arc(cx, cz, SENSOR_SPECS.depth.maxRange * s, yaw - half, yaw + half); ctx.closePath();
    ctx.fillStyle = dark ? 'rgba(243,138,138,.06)' : 'rgba(172,139,244,.10)'; ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(243,138,138,.7)' : 'rgba(172,139,244,.35)'; if (dark) ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    if (dark) { ctx.fillStyle = C.red; ctx.fillText('CAMERA OFF', cx + Math.cos(yaw) * 18, cz + Math.sin(yaw) * 18); }
  }
  // This tick's returns: obstacle hits bright, floor hits faint.
  if (ep.scan) for (let i = 0; i < ep.scan.length; i += 4) {
    const floorHit = ep.scan[i + 2] === 0, lidar = ep.scan[i + 3] === 0;
    if (floorHit && lidar) continue;
    ctx.fillStyle = floorHit ? 'rgba(172,139,244,.25)' : lidar ? 'rgba(90,216,232,.9)' : 'rgba(196,170,255,.95)';
    const r = floorHit ? 1 : 1.6; ctx.fillRect(X(ep.scan[i]) - r / 2, Z(ep.scan[i + 1]) - r / 2, r, r);
  }
  // The route a blocked replan replaced, then the A* route, then the controller's samples and its chosen rollout.
  if (state.ghost && state.ghost.until > now) {
    const g = state.ghost.path; ctx.strokeStyle = `rgba(243,138,138,${0.75 * (state.ghost.until - now) / 2600})`; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath();
    for (let i = 0; i < g.x.length; i++) i ? ctx.lineTo(X(g.x[i]), Z(g.z[i])) : ctx.moveTo(X(g.x[i]), Z(g.z[i]));
    ctx.stroke(); ctx.setLineDash([]);
  }
  state.pulses = state.pulses.filter(p => now - p.start < 1400);
  for (const p of state.pulses) { const k = Math.max(0, (now - p.start) / 1400); ctx.strokeStyle = `rgba(172,139,244,${0.9 * (1 - k)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), (0.3 + 1.6 * k) * s, 0, Math.PI * 2); ctx.stroke(); }
  if (ep.path) {
    ctx.strokeStyle = 'rgba(233,246,255,.85)'; ctx.lineWidth = 2.2; ctx.beginPath();
    for (let i = ep.progress; i < ep.path.x.length; i++) i === ep.progress ? ctx.moveTo(X(ep.path.x[i]), Z(ep.path.z[i])) : ctx.lineTo(X(ep.path.x[i]), Z(ep.path.z[i]));
    ctx.stroke();
  }
  // Goal, then the robot: true footprint, and the robot's own estimate when it drifts.
  ctx.strokeStyle = C.amber; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(ep.goal.x), Z(ep.goal.z), Math.max(6, 0.3 * s), 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X(ep.goal.x) - 4, Z(ep.goal.z)); ctx.lineTo(X(ep.goal.x) + 4, Z(ep.goal.z)); ctx.moveTo(X(ep.goal.x), Z(ep.goal.z) - 4); ctx.lineTo(X(ep.goal.x), Z(ep.goal.z) + 4); ctx.stroke();
  if (ep.drift) { shape(footprint(ep.platform, ep.estPose)); ctx.strokeStyle = C.amber; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); }
  shape(footprint(ep.platform, tp));
  ctx.fillStyle = ep.outcome === 'contact' || ep.outcome === 'keep-out' ? C.red : C.cyan; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = '#e9f6ff'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = C.bg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(tp.x), Z(tp.z)); ctx.lineTo(X(tp.x + ct * ep.platform.depth / 2), Z(tp.z + st * ep.platform.depth / 2)); ctx.stroke();
  // Controller samples over the robot, as robotics viewers draw them: most of a 2 s horizon sits under the body.
  const K = ep.controller, H = K.H;
  if ($('rollouts').checked && K.trajectories && ep.path && !ep.outcome) {
    ctx.lineWidth = 1;
    for (let j = Math.min(K.K, 28) - 1; j >= 0; j--) {
      const k = K.order[j], o = k * (H + 1) * 2; ctx.strokeStyle = `rgba(236,246,255,${0.12 + 0.38 * (1 - j / 28)})`; ctx.beginPath();
      for (let t = 0; t <= H; t++) t ? ctx.lineTo(X(K.trajectories[o + t * 2]), Z(K.trajectories[o + t * 2 + 1])) : ctx.moveTo(X(K.trajectories[o]), Z(K.trajectories[o + 1]));
      ctx.stroke();
    }
    ctx.strokeStyle = C.violet; ctx.lineWidth = 3; ctx.beginPath();
    for (let t = 0; t <= H; t++) t ? ctx.lineTo(X(K.best[t * 2]), Z(K.best[t * 2 + 1])) : ctx.moveTo(X(K.best[0]), Z(K.best[1]));
    ctx.stroke(); ctx.fillStyle = C.violet; ctx.beginPath(); ctx.arc(X(K.best[H * 2]), Z(K.best[H * 2 + 1]), 3, 0, Math.PI * 2); ctx.fill();
  }
  if (state.flash && state.flash.until > now) {
    ctx.font = '700 12px Inter, system-ui, sans-serif'; const text = state.flash.text, tw = ctx.measureText(text).width + 14;
    const lx = Math.max(6, Math.min(w - tw - 6, X(tp.x) + 16)), above = Z(tp.z) - 34, lz = above < 44 ? Math.min(h - 26, Z(tp.z) + 18) : above;  // clear of the HUD
    ctx.globalAlpha = Math.min(1, (state.flash.until - now) / 600); ctx.fillStyle = state.flash.bad ? C.red : C.cyan; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, lz, tw, 20, 10) : ctx.rect(lx, lz, tw, 20); ctx.fill();
    ctx.fillStyle = '#081725'; ctx.textBaseline = 'middle'; ctx.fillText(text, lx + 7, lz + 10); ctx.globalAlpha = 1; ctx.textBaseline = 'top';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Trials run in a worker so the page stays responsive; the inline path is the same code with pauses between runs.
function trialOptions() {
  return {robot: robot(), episodes: Number($('t-episodes').value), seed: Math.max(1, Math.floor(Number($('t-seed').value) || 1)), prior: $('prior').checked, sensors: sensors(),
    perturbations: {crate: $('p-crate').checked, mapError: $('p-map').checked, blackout: $('p-blackout').checked, drift: $('p-drift').checked}};
}
function startTrial() {
  const g = gate(); if (g) { status(g, true); return; }
  const options = trialOptions();
  if (!Object.values(options.perturbations).some(Boolean)) { $('t-status').textContent = 'Choose at least one thing to break.'; return; }
  pause(); $('t-run').disabled = true; $('trial-results').hidden = true; $('t-progress').hidden = false; $('t-progress').value = 0;
  $('t-status').textContent = `Planning ${options.episodes} tasks for ${PLATFORMS[options.robot].name}…`;
  const progress = (done, total, condition, outcome) => { $('t-progress').max = total; $('t-progress').value = done; $('t-status').textContent = `Run ${done} of ${total} · ${condition === 'control' ? 'control' : 'broken on purpose'} · ${outcome}`; };
  const finish = report => { $('t-run').disabled = false; $('t-progress').hidden = true; state.report = report; renderTrial(report); };
  const failed = message => { $('t-run').disabled = false; $('t-progress').hidden = true; $('t-status').textContent = message; };
  let worker = null;
  try { worker = new Worker(new URL('./autonomy-worker.mjs', import.meta.url), {type: 'module'}); } catch { worker = null; }
  if (worker) {
    worker.onmessage = ({data}) => {
      if (data.type === 'progress') progress(data.done, data.total, data.condition, data.outcome);
      else { worker.terminate(); if (data.type === 'done') finish(data.report); else failed(data.message); }
    };
    worker.onerror = () => { worker.terminate(); inline(); };
    worker.postMessage({world: state.world, options});
  } else inline();
  function inline() {
    runTrial(state.world, options, {progress: (d, t, last) => progress(d, t, last.condition, last.outcome), yield: () => new Promise(r => setTimeout(r, 0))}).then(finish, e => failed(e.message));
  }
}
const OUTCOME = {reached: ['reached', 'ok'], contact: ['contact', 'bad'], 'keep-out': ['keep-out', 'bad'], 'no-route': ['safe stop', 'warn'], stuck: ['stuck', 'bad'], timeout: ['timeout', 'bad']};
function cell(e) { const [label, cls] = OUTCOME[e.outcome] || [e.outcome, '']; return `<td class="${cls}">${label}${e.outcome === 'reached' ? ` · ${e.seconds.toFixed(0)} s` : ''}</td>`; }
function renderTrial(r) {
  const c = r.summary.control, b = r.summary.broken, pct = v => `${Math.round(v * 100)}%`;
  const card = (label, value, note, cls = '') => `<div class="metric ${cls}"><small>${esc(label)}</small><strong>${value}</strong><span>${note}</span></div>`;
  const crate = b.crates.dropped ? `${b.crates.medianCrateReplanMs ?? '–'} ms` : '–';
  $('t-metrics').innerHTML = card('Control', `${c.reached}/${c.episodes}`, `reached · 95% CI ${pct(c.completion.wilson95[0])}–${pct(c.completion.wilson95[1])}`) +
    card('Broken on purpose', `${b.reached}/${b.episodes}`, `reached · 95% CI ${pct(b.completion.wilson95[0])}–${pct(b.completion.wilson95[1])}`, b.reached < c.reached ? 'warn' : '') +
    card('Contacts', String(b.contacts + c.contacts), `${b.contacts} broken · ${c.contacts} control`, b.contacts + c.contacts ? 'bad' : '') +
    card('Safe stops', String(b.noRoute + c.noRoute), 'no route fit, robot stopped') +
    card('Crate → new route', crate, b.crates.dropped ? `median compute on this device · ${b.crates.inMap}/${b.crates.dropped} crates mapped` : 'no crates dropped') +
    card('Closest approach', b.minClearance === null ? '–' : `${b.minClearance.toFixed(2)} m`, 'true footprint to anything, broken runs');
  $('t-interpretation').textContent = r.interpretation;
  const rows = r.tasks.map(t => {
    const ctl = r.episodes.find(e => e.task === t.index && e.condition === 'control'), brk = r.episodes.find(e => e.task === t.index && e.condition === 'broken');
    const what = [brk.crate?.dropped ? `crate ${brk.crate.aheadMetres} m ahead` : brk.crate?.skipped ? 'crate skipped' : '', brk.mapError?.placed ? `unmapped object${brk.mapError.detectedAt !== null ? ' found' : ' missed'}` : '', brk.blackout ? 'camera off 3.5 s' : '', brk.drift ? `drift ${brk.drift.finalErrorMetres} m` : ''].filter(Boolean).join(' · ');
    const seen = brk.crate?.dropped ? (brk.crate.inMapAt === null ? 'never seen' : `${(brk.crate.inMapAt - brk.crate.droppedAt).toFixed(1)} s${brk.crate.replanMs !== null ? ` · ${brk.crate.replanMs} ms` : ''}`) : '–';
    return `<tr><td>${t.index + 1}</td><td>${t.referenceDistance.toFixed(1)} m</td>${cell(ctl)}${cell(brk)}<td>${esc(what || '–')}</td><td>${esc(seen)}</td><td>${brk.minClearance === null ? '–' : brk.minClearance.toFixed(2)}</td></tr>`;
  }).join('');
  $('t-rows').innerHTML = rows;
  $('t-seal').textContent = `SHA-256 ${r.integrity.value.slice(0, 16)}… · ${r.config.episodes} tasks · seed ${r.config.seed} · ${PLATFORMS[r.config.robot].name}`;
  $('t-status').textContent = 'Trial complete. The report is sealed with a SHA-256 of its contents; it records the map, settings, every run and its limits.';
  $('trial-results').hidden = false;
}
function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: name}); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------------------------------------------
// Wiring.
function init() {
  $('robot').innerHTML = ROBOT_ORDER.map(k => `<option value="${k}">${esc(PLATFORMS[k].name)} · ${PLATFORMS[k].width}×${PLATFORMS[k].depth} m · ${PLATFORMS[k].speed} m/s</option>`).join('');
  $('spec-lidar').textContent = `${SENSOR_SPECS.lidar.basis}: ${SENSOR_SPECS.lidar.hFovDeg}° × ${SENSOR_SPECS.lidar.vMinDeg}°…${SENSOR_SPECS.lidar.vMaxDeg}°, ${SENSOR_SPECS.lidar.minRange}–${SENSOR_SPECS.lidar.maxRange} m, ≤${SENSOR_SPECS.lidar.rangeSigma * 100} cm range noise; returns beyond ${OBSTACLE_RANGE} m are not mapped.`;
  $('spec-depth').textContent = `${SENSOR_SPECS.depth.basis}: ${SENSOR_SPECS.depth.hFovDeg}° × ${SENSOR_SPECS.depth.vFovDeg}°, ${SENSOR_SPECS.depth.minRange}–${SENSOR_SPECS.depth.maxRange} m, ${SENSOR_SPECS.depth.relativeErrorAt2m * 100}% error at 2 m growing with distance squared; front and rear, pitched 30° down.`;
  const saved = savedWorld(); $('world-source').querySelector('[value=saved]').disabled = !saved;
  if (!saved) $('world-source').querySelector('[value=saved]').textContent = 'My World Builder map (none saved in this browser)';
  $('world-source').addEventListener('change', e => {
    const v = e.target.value;
    if (v === 'file') { e.target.value = state.source; $('world-file').click(); return; }
    try { setWorld(v === 'saved' ? savedWorld() : sampleWorld(), v); } catch (error) { status(error.message, true); return; }
    resize(); if (v === 'sample') startEpisode({demoCrate: true}); else { pause(); state.ep = null; draw(); status(gate(), true); syncButtons(); }
  });
  $('world-file').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try { if (file.size > 2 * 1024 ** 2) throw new Error('Map JSON must be at most 2 MiB.'); setWorld(JSON.parse(await file.text()), 'file'); }
    catch (error) { status(`That file is not a BrainSNN World v1 map: ${error.message}`, true); $('world-source').value = state.source; return; }
    $('world-source').value = 'file'; resize(); pause(); state.ep = null; draw(); status(gate(), true); syncButtons();
  });
  for (const id of ['scale-ok', 'map-ok']) $(id).addEventListener('change', () => { if (!gate()) { startEpisode(); } else { pause(); state.ep = null; draw(); status(gate(), true); } syncButtons(); });
  for (const id of ['robot', 's-lidar', 's-front', 's-rear', 'prior']) $(id).addEventListener('change', () => { const was = state.running; pause(); if (startEpisode()) { if (was) play(); } });
  for (const id of ['truth', 'rollouts']) $(id).addEventListener('change', draw);
  $('play').addEventListener('click', () => state.running ? pause() : play());
  $('reset').addEventListener('click', () => { pause(); startEpisode(); });
  $('crate').addEventListener('click', () => { if (state.ep && requestCrate(state.ep)) { if (!state.running) play(); } });
  $('speed').addEventListener('click', () => { state.speed = state.speed === 1 ? 3 : 1; syncButtons(); });
  $('new-goal').addEventListener('click', () => {
    const ep = state.ep; if (!ep) return;
    const t = sampleTasks(state.world, robot(), 1, state.seed++ * 7919)[0]; if (!t) return;
    if (startEpisode({goal: t.goal, keep: !ep.outcome})) play();
  });
  canvas.addEventListener('pointerdown', e => {
    if (!state.ep) return;
    const rect = canvas.getBoundingClientRect(), {s, ox, oz} = state.view, x = (e.clientX - rect.left - ox) / s, z = (e.clientY - rect.top - oz) / s;
    if (x < 0 || z < 0 || x > state.world.width || z > state.world.depth) return;
    const was = state.running; pause();
    if (startEpisode({goal: {x, z}, keep: !state.ep.outcome}) || was) play();
  });
  $('t-run').addEventListener('click', startTrial);
  $('t-download').addEventListener('click', () => state.report && download(`brainsnn-autonomy-trial-seed${state.report.config.seed}.json`, state.report));
  $('t-verify').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try { const v = await verifyTrialReport(JSON.parse(await file.text())); $('t-status').textContent = v.ok ? `Verified: the report's SHA-256 matches its contents (${v.value.slice(0, 16)}…). The seal shows it was not edited; it does not identify who ran it.` : v.reason; }
    catch (error) { $('t-status').textContent = `Could not read that report: ${error.message}`; }
  });
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.running) pause(); });
  setWorld(sampleWorld(), 'sample'); resize(); startEpisode({demoCrate: true});
  if (!reduceMotion) play(); else status('Press Run to start. A crate drops in the robot\'s way 4 s in.');
}
init();
