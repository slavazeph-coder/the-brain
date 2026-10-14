/* "Beat the bot" checks: the pure race rules against the real deterministic
 * engine, and the real workspace + game UI in the DOM fixture, driven through
 * keyboard events and fake animation frames. Not browser or pixel tests. */
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const { makeEnv } = require('./brainsnn-selection-fixture.cjs');
const dist = path.resolve(__dirname, '../dist');
let failures = 0, count = 0;
function test(name, fn) { try { fn(); count++; console.log('PASS', name); } catch (e) { failures++; console.error('FAIL', name, e.stack); } }

function rules() {
  const ctx = { URLSearchParams }; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['arena-3d.js', 'arena-game.js']) vm.runInContext(fs.readFileSync(path.join(dist, f), 'utf8'), ctx, { filename: f });
  return { A: ctx.BrainArena3D, G: ctx.BrainSNNArenaGame };
}
const { A, G } = rules();
const SPEED_STEP = 0.065;
function target(g) {
  const w = g.world, p = w.robot.position;
  if (w.robot.carrying != null) return [w.goal.position[0], w.goal.position[1]];
  return w.objects.filter(o => !o.delivered).map(o => o.position)
    .sort((a, b) => Math.hypot(a[0] - p[0], a[1] - p[1]) - Math.hypot(b[0] - p[0], b[1] - p[1]))[0];
}
// Taps the target, waits to arrive, drops, waits for the claw to come back up.
function casual(g, react) {
  let wait = 0, stage = 'go';
  while (g.phase === 'play') {
    const p = g.world.robot.position, t = target(g), input = {};
    if (wait > 0) { wait--; G.tick(g, {}); continue; }
    if (g.claw !== 'hover') { G.tick(g, {}); if (g.claw === 'hover') { wait = react; stage = 'go'; } continue; }
    if (stage === 'go') { input.tap = t; stage = 'travel'; }
    else if (stage === 'travel' && !g.goal && Math.hypot(p[0] - t[0], p[1] - t[1]) >= 0.01) input.tap = t;
    else if (stage === 'travel' && Math.hypot(p[0] - t[0], p[1] - t[1]) < 0.01) { wait = react; stage = 'drop'; G.tick(g, {}); continue; }
    else if (stage === 'drop') { input.drop = true; stage = 'go'; }
    G.tick(g, input);
  }
  return G.result(g);
}
// Steers all the time and drops early enough to glide in on a diagonal.
function skilled(g, glide = 1) {
  while (g.phase === 'play') {
    const p = g.world.robot.position, t = target(g), floor = g.world.robot.carrying != null ? G.PLACE_Z : G.PICK_Z;
    const input = { tap: t };
    if ((g.claw === 'hover' || g.claw === 'rising') && Math.hypot(p[0] - t[0], p[1] - t[1]) <= (p[2] - floor) * glide + 0.004) input.drop = true;
    G.tick(g, input);
  }
  return G.result(g);
}
const fresh = (challenge, seed = '42') => G.start(G.create({ challenge, seed }));

test('the opponent is the unmodified scripted baseline on the identical seeded world', () => {
  for (const challenge of ['starter', 'surprise']) {
    const w = A.create(42, { challenge }); while (!w.done) A.step(w, A.demoAction(w));
    const g = G.create({ challenge, seed: '42' });
    assert.equal(g.bot.time, w.time); assert.equal(g.bot.success, true); assert.equal(g.bot.deliveries.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(g.world.objects)), JSON.parse(JSON.stringify(A.create(42, { challenge }).objects)));
    assert.equal(g.bot.frames.length, w.steps + 1);
  }
});
test('the player gets no speed advantage: every step respects the engine speed limit', () => {
  const h = fresh('clutter'); let prev = h.world.robot.position.slice(), max = 0;
  while (h.phase === 'play') {
    const p = h.world.robot.position, t = target(h), floor = h.world.robot.carrying != null ? G.PLACE_Z : G.PICK_Z;
    const input = { tap: t }; if ((h.claw === 'hover' || h.claw === 'rising') && Math.hypot(p[0] - t[0], p[1] - t[1]) <= p[2] - floor + 0.004) input.drop = true;
    G.tick(h, input); const q = h.world.robot.position;
    max = Math.max(max, Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])); prev = q.slice();
  }
  assert(max <= SPEED_STEP + 1e-9, 'moved ' + max + ' in one step'); assert(max > SPEED_STEP * 0.99);
});
test('difficulty curve: slow casual play loses, glide-cutting play wins, on every level', () => {
  for (const level of G.LEVELS) {
    const slow = casual(fresh(level.id), 4), fast = skilled(fresh(level.id), 0.55);
    assert.equal(slow.finished, true, level.id + ' casual should finish'); assert.equal(slow.beatBot, false, level.id + ' casual should lose');
    assert.equal(fast.finished, true, level.id); assert.equal(fast.beatBot, true, level.id + ' skilled should win: ' + JSON.stringify(fast));
    assert(fast.delta <= -3, level.id + ' margin ' + fast.delta);
  }
});
test('corner cutting near crates is risky: reckless glides bonk, and a bonk never grinds', () => {
  let bonks = 0;
  for (const level of ['clutter', 'moving', 'surprise']) {
    const r = skilled(fresh(level), 2.2); bonks += r.contacts;
    assert.equal(r.finished, true, level); assert(r.contacts < 12, level + ' contacts ' + r.contacts);
  }
  assert(bonks > 0, 'expected at least one bonk across cluttered levels');
});
test('a bonk stuns, then backs straight up before steering again', () => {
  const g = fresh('starter');
  g.world.obstacles.push({ id: 'wall', position: [0.3, 0, 0.5], size: [0.2, 1.6, 1.2], dynamic: false });
  let r = null;
  for (let i = 0; i < 80 && !g.contacts; i++) G.tick(g, { dir: [1, 0] });
  assert.equal(g.contacts, 1); assert.equal(g.claw, 'recovering');
  const at = g.world.robot.position.slice();
  for (let i = 0; i < 5; i++) G.tick(g, { dir: [1, 0] });
  assert.deepEqual(g.world.robot.position, at, 'stunned claw must not move');
  G.tick(g, { dir: [1, 0] });
  const after = g.world.robot.position;
  assert.equal(after[0], at[0]); assert.equal(after[1], at[1]);
  assert.equal(g.contacts, 1, 'a held key must not rack up repeated contacts');
  r = G.result(g); assert.equal(r.contacts, 1);
});
test('an empty grab is a miss and the claw rises empty', () => {
  const g = fresh('starter');
  for (let i = 0; i < 20; i++) G.tick(g, { dir: [1, 0] });
  G.tick(g, { drop: true });
  for (let i = 0; i < 40 && g.claw !== 'hover'; i++) G.tick(g, {});
  assert.equal(g.misses, 1); assert.equal(g.world.robot.carrying, null); assert(g.feed.some(x => x.kind === 'miss'));
  assert(Math.abs(g.world.robot.position[2] - G.CARRY_Z) < 0.01);
});
test('releasing outside the tray drops the block on the table where it can be grabbed again', () => {
  const g = fresh('starter'), o = g.world.objects[0];
  for (let i = 0; i < 200 && g.world.robot.carrying == null; i++) {
    const p = g.world.robot.position, near = Math.hypot(p[0] - o.position[0], p[1] - o.position[1]) < 0.005;
    G.tick(g, { tap: [o.position[0], o.position[1]], drop: near && g.claw === 'hover' });
  }
  assert.equal(g.world.robot.carrying, 0);
  for (let i = 0; i < 30; i++) G.tick(g, { dir: [0, 1] });
  G.tick(g, { drop: true }); for (let i = 0; i < 40 && g.claw !== 'hover'; i++) G.tick(g, {});
  assert.equal(g.drops, 1); assert.equal(g.world.robot.carrying, null); assert.equal(g.world.delivered, 0);
  assert(Math.abs(o.position[2] - 0.08) < 1e-9, 'block rests on the table');
});
test('stars: finish, beat the bot, beat it by 4 s with no bonks; tap-and-wait play cannot reach three', () => {
  const lose = casual(fresh('starter'), 4); assert.equal(lose.stars, 1);
  for (const level of G.LEVELS) assert(casual(fresh(level.id), 0).stars <= 2, level.id + ': instant tap-and-wait must not earn three stars');
  const win = skilled(fresh('starter')); assert.equal(win.stars, 3); assert.equal(win.contacts, 0);
  const g = fresh('starter'); g.world.time = G.TIME_LIMIT - 0.05; G.tick(g, {});
  const timeout = G.result(g); assert.equal(g.phase, 'timeout'); assert.equal(timeout.finished, false); assert.equal(timeout.stars, 0); assert.equal(timeout.delta, null);
});
test('the ghost replay interpolates the bot and reports its deliveries on the shared clock', () => {
  const g = G.create({ challenge: 'starter', seed: '42' }), b = g.bot;
  const a = G.botAt(g, 1.0), m = G.botAt(g, 1.05), c = G.botAt(g, 1.1);
  for (let i = 0; i < 3; i++) assert(Math.abs(m.position[i] - (a.position[i] + c.position[i]) / 2) < 1e-9);
  assert.equal(G.botAt(g, b.deliveries[0] - 0.05).delivered, 0); assert.equal(G.botAt(g, b.deliveries[0]).delivered, 1);
  assert.equal(G.botAt(g, b.time).finished, true); assert.equal(G.botAt(g, 999).delivered, 3);
});
test('share links round-trip and treat the time as an unverified friend claim', () => {
  const url = G.shareURL('https://www.brainsnn.com/', 'surprise', '7', 19.46);
  assert.equal(url, 'https://www.brainsnn.com/arena/?play=surprise&seed=7&t=19.5#playground');
  assert.deepEqual(JSON.parse(JSON.stringify(G.parseLink(new URL(url).search))), { level: 'surprise', seed: '7', friend: 19.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(G.parseLink('?play=nope&seed=&t=-3'))), { level: 'starter', seed: '42', friend: null });
  assert.equal(G.parseLink('?t=10'), null); assert.equal(G.parseLink('?play=night&t=9999').friend, null);
  assert(!G.shareURL('https://x.test', 'night', '1', null).includes('&t='));
  assert.match(G.shareText({ challenge: 'night', finished: true, beatBot: true, delta: -3.24, time: 22.7 }), /beat the BrainSNN bot by 3\.2 s on Night shift/);
});
test('tap picking inverts the spectator projection on the table plane', () => {
  const view = { yaw: -0.95, pitch: 0.62, distance: 5.1 }, W = 960, H = 540, cam = A.spectatorCamera(view, W / H);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const back = norm(sub(cam.eye, cam.target)), right = norm(cross([0, 0, 1], back)), up = cross(back, right), f = Math.tan(cam.fovY / 2);
  for (const p of [[0, 0, 0.1], [-0.95, -0.48, 0.1], [0.99, 0.45, 0.1], [1.2, -0.7, 0.1]]) {
    const d = sub(p, cam.eye), z = -dot(d, back);
    const sx = (dot(d, right) / z / (f * W / H) + 1) / 2 * W, sy = (1 - dot(d, up) / z / f) / 2 * H;
    const hit = A.pickPlane(view, W, H, sx, sy, 0.1);
    assert(Math.hypot(hit[0] - p[0], hit[1] - p[1]) < 1e-6, JSON.stringify([p, hit]));
  }
  assert.equal(A.pickPlane(view, W, H, W / 2, -5000, 0.1), null, 'a ray above the horizon misses');
});

/* Real workspace + UI in the DOM fixture. */
function uiEnv({ search = '', selection = { seed: '42' } } = {}) {
  const e = makeEnv();
  let now = 1000, rafs = [], timers = [];
  e.ctx.location.search = search; e.ctx.location.pathname = '/arena/';
  const replace = e.ctx.history.replaceState;
  e.ctx.history.replaceState = (a, b, url) => { replace(a, b, url); if (!String(url).includes('?play=')) e.ctx.location.search = ''; };
  e.ctx.performance = { now: () => now };
  e.ctx.requestAnimationFrame = fn => { rafs.push(fn); return rafs.length; };
  e.ctx.cancelAnimationFrame = () => { rafs = []; };
  e.ctx.setTimeout = fn => { timers.push(fn); return timers.length; };
  e.ctx.clearTimeout = () => {};
  e.ctx.matchMedia = () => ({ matches: false });
  e.ctx.setInterval = () => 1; e.ctx.clearInterval = () => {};
  const root = e.document.createElement('div'); root.setAttribute('id', 'arena-test-root'); e.document.body.appendChild(root);
  for (const f of ['arena-3d.js', 'arena-game.js', 'arena-game-ui.js', 'arena-profiles.js', 'arena-workspace.js']) vm.runInContext(fs.readFileSync(path.join(dist, f), 'utf8'), e.ctx, { filename: f });
  e.ctx.BrainSNNArena.mount(root, selection);
  const key = (type, code) => { for (const f of [...(e.ctx.handlers[type] || [])]) f({ type, code, key: code === 'Space' ? ' ' : code, target: e.document.body, preventDefault() {}, repeat: false }); };
  return { ...e, root, key,
    state: () => e.ctx.BrainSNNArena.getState(),
    flushTimers() { const t = timers.splice(0); t.forEach(fn => fn()); },
    frame(ms = 50) { now += ms; const f = rafs.splice(0); f.forEach(fn => fn(now)); },
    click(sel) { const b = root.querySelector(sel); assert(b, 'missing ' + sel); b.click(); return b; } };
}

test('the game bar offers five levels and a Play button above local practice', () => {
  const e = uiEnv();
  assert.equal(e.state().mode, 'practice');
  assert.equal(e.root.querySelectorAll('[data-game-level]').length, 5);
  assert(e.$('arena-game-bar').textContent.includes('You be the brain.'));
  e.click('[data-game-level="night"]');
  assert.equal(e.root.querySelector('[data-game-level="night"]').getAttribute('aria-pressed'), 'true');
  assert.equal(e.state().game.level, 'night');
});
test('a race borrows the canvas without touching the practice timeline, and Escape hands it back', () => {
  const e = uiEnv(); const before = e.state().snapshotCount;
  e.click('[data-game="play"]');
  assert.equal(e.state().game.phase, 'ready'); e.flushTimers(); assert.equal(e.state().game.phase, 'play');
  for (const id of ['arena-run', 'arena-step', 'arena-reset', 'arena-branch', 'arena-add-obstacle', 'arena-scrubber']) assert(e.$(id).disabled, id + ' must be disabled during a race');
  assert(e.$('arena-integrity').textContent.includes('not a benchmark'));
  assert(e.$('arena-viewport').className.includes('is-game'));
  const start = e.state().game.robot.slice();
  e.key('keydown', 'ArrowRight'); for (let i = 0; i < 6; i++) e.frame(); e.key('keyup', 'ArrowRight');
  const moved = e.state().game.robot; assert(Math.hypot(moved[0] - start[0], moved[1] - start[1]) > 0.2, 'arrow key moves the claw');
  assert(Math.abs(moved[2] - start[2]) < 1e-9, 'hovering claw holds its height');
  e.key('keydown', 'Space'); e.frame(); assert.equal(e.state().game.claw, 'dropping');
  assert.equal(e.state().snapshotCount, before, 'practice timeline untouched');
  e.key('keydown', 'Escape');
  assert.equal(e.state().game.active, false); assert(!e.$('arena-run').disabled); assert(!e.$('arena-viewport').className.includes('is-game'));
  const listeners = (e.ctx.handlers.keydown || []).length; assert.equal(listeners, 0, 'race key handlers are removed after quitting');
});
test('keyboard-only race to the finish: result card, stars, saved best and share link', () => {
  const e = uiEnv();
  e.click('[data-game="play"]'); e.flushTimers();
  // Hold the arrow combination that best points at the target, like a person would.
  const yaw = -0.95, f = [-Math.cos(yaw), -Math.sin(yaw)], r = [-Math.sin(yaw), Math.cos(yaw)];
  const combos = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) if (x || y) { const d = [r[0] * x + f[0] * y, r[1] * x + f[1] * y], m = Math.hypot(...d); combos.push({ x, y, d: [d[0] / m, d[1] / m] }); }
  const world = A.create(42, { challenge: 'starter' });
  let held = [], frames = 0;
  const hold = keys => { for (const k of held) if (!keys.includes(k)) e.key('keyup', k); for (const k of keys) if (!held.includes(k)) e.key('keydown', k); held = keys; };
  while (!e.state().game.ended && frames++ < 3000) {
    const s = e.state().game, p = s.robot;
    const goal = s.carrying ? world.goal.position : world.objects.find((o, i) => i >= s.delivered).position;
    const d = [goal[0] - p[0], goal[1] - p[1]], dist = Math.hypot(...d);
    if (s.claw === 'hover' && dist < 0.05) { hold([]); e.key('keydown', 'Space'); }
    else if (s.claw === 'hover' && dist >= 0.05) {
      const best = combos.reduce((a, c) => (c.d[0] * d[0] + c.d[1] * d[1]) > (a.d[0] * d[0] + a.d[1] * d[1]) ? c : a);
      hold([...(best.x > 0 ? ['ArrowRight'] : best.x < 0 ? ['ArrowLeft'] : []), ...(best.y > 0 ? ['ArrowUp'] : best.y < 0 ? ['ArrowDown'] : [])]);
    } else hold([]);
    e.frame();
  }
  const s = e.state().game;
  assert.equal(s.ended, true); assert.equal(s.result.finished, true); assert.equal(s.result.delivered, 3);
  assert(s.result.stars >= 1); assert.equal(typeof s.result.delta, 'number');
  const card = e.root.querySelector('.game-result'); assert(card && !card.hidden); assert(card.textContent.includes('Bot ' + s.result.botTime.toFixed(1) + ' s'));
  const best = JSON.parse(e.storageRecords.get('brainsnn.arena.game.v1')).best['starter:42']; assert.equal(best, s.result.time);
  // share() reaches the clipboard synchronously when the Web Share API is absent.
  e.ctx.navigator.share = undefined; e.click('[data-game="share"]');
  assert(e.copied.at(-1).includes('/arena/?play=starter&seed=42&t=' + s.result.time.toFixed(1)));
});
test('a shared link opens practice on its level with the friend time, keeping a saved robot pair', () => {
  const e = uiEnv({ search: '?play=surprise&seed=7&t=19.5', selection: { robotId: 'g1', modelId: 'sonic', seed: '42' } });
  assert.equal(e.state().mode, 'practice'); assert.equal(e.state().selection.robotId, 'g1');
  assert.equal(e.state().game.level, 'surprise'); assert.equal(e.state().game.seed, '7');
  assert(e.$('arena-game-bar').textContent.includes('A friend finished Plot twist in 19.5 s'));
  e.click('[data-game="play"]'); e.flushTimers();
  assert.equal(e.state().game.seed, '7'); assert.equal(e.ctx.location.search, '', 'the link is consumed once a race starts');
});
test('suspending the arena mid-race tears the game down', () => {
  const e = uiEnv(); e.click('[data-game="play"]'); e.flushTimers();
  assert((e.ctx.handlers.keydown || []).length > 0);
  e.ctx.BrainSNNArena.suspend();
  assert.equal((e.ctx.handlers.keydown || []).length, 0); assert.equal((e.ctx.handlers.keyup || []).length, 0);
});

setTimeout(() => {
  console.log(count + ' beat-the-bot checks passed' + (failures ? ', ' + failures + ' FAILED' : '') + '.');
  if (failures) process.exitCode = 1;
}, 20);
