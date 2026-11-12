/** BrainSNN autonomy loop on a reviewed World v1 map: simulated range sensors -> live occupancy map -> A* -> MPPI,
 *  plus a trial harness that runs the same tasks clean and then broken on purpose, and counts what happened.
 *
 *  This is a deterministic kinematic software-in-the-loop simulation. Sensors are ray casts against the reviewed box
 *  geometry, configured from published sensor specifications. The robot is a planar unicycle. The robot's software
 *  never reads ground truth: it sees only what its simulated sensors return and what the reviewed map says. Ground
 *  truth is used only to move the robot and to score contacts. No physics engine, real sensor, learned policy or
 *  physical robot runs here, and nothing here certifies safety. */
import {normalizeWorld, planningGate, ROBOTS, clone} from './core.mjs';

export const TRIAL_SCHEMA = 'brainsnn.autonomy-trial.v1';
export const LOOP_VERSION = 'autonomy-loop-v1';
const DEG = Math.PI / 180, BIG = 1e20, TICK = 0.1;
/** Lidar returns farther than this are not written into the map, as navigation costmaps do: at range a small heading
 *  error moves a return a long way, and nearby obstacles are what the controller needs. */
export const OBSTACLE_RANGE = 8;
const clock = () => (globalThis.performance && typeof performance.now === 'function' ? performance.now() : Date.now());

/** Published figures the simulated sensors are configured from. The simulation does not reproduce the devices. */
export const SENSOR_SPECS = Object.freeze({
  lidar: Object.freeze({kind: 'lidar', label: '360° lidar', basis: 'Livox MID-360 published specifications', hFovDeg: 360, vMinDeg: -7, vMaxDeg: 52, minRange: 0.1, maxRange: 40, hz: 10, rangeSigma: 0.02,
    source: 'https://www.livoxtech.com/mid-360/specs'}),
  depth: Object.freeze({kind: 'depth', label: 'Depth camera', basis: 'Intel RealSense D435i published specifications', hFovDeg: 87, vFovDeg: 58, minRange: 0.28, maxRange: 3, hz: 10, relativeErrorAt2m: 0.02,
    source: 'https://realsenseai.com/products/depth-camera-d435i/'}),
});

/** Planar body envelopes. Widths, depths and speeds come from the World Builder robot list; heights and turn rates
 *  are illustrative assumptions for sensor mounting. Verify the deployed robot before reading anything into a result. */
export const PLATFORMS = Object.freeze({
  cleaner: Object.freeze({...ROBOTS.cleaner, height: 0.9, maxYawRate: 1.2}),
  vacuum: Object.freeze({...ROBOTS.vacuum, height: 0.1, maxYawRate: 2.0}),
  amr: Object.freeze({...ROBOTS.amr, height: 0.4, maxYawRate: 1.0}),
  humanoid: Object.freeze({...ROBOTS.humanoid, name: 'Humanoid envelope (planar; gait not simulated)', height: 1.3, maxYawRate: 1.0}),
  forklift: Object.freeze({...ROBOTS.forklift, height: 2.0, maxYawRate: 0.5}),
  quadruped: Object.freeze({name: 'Quadruped envelope (planar; gait not simulated)', width: 0.31, depth: 0.7, speed: 0.6, height: 0.4, maxYawRate: 1.5}),
});

const DENSITY = Object.freeze({
  demo: {azimuthDeg: 1.5, elevations: [-7, -5.5, -4, -2.5, -1, 1, 4, 9, 16, 26, 38, 52], cols: 32, rows: 20},
  trial: {azimuthDeg: 3, elevations: [-7, -5, -3, -1, 2, 8, 20, 52], cols: 20, rows: 12},
});

// ---------------------------------------------------------------------------------------------------------------
// Seeded randomness: every stochastic choice comes from a named stream, so a seed reproduces an episode exactly.
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9, spare = null;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = next(); while (u < 1e-12) u = next();
    const v = next(), m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v); return m * Math.cos(2 * Math.PI * v);
  };
  return next;
}
export function mix(...values) {
  let h = 2166136261 >>> 0;
  for (const v of values) { h ^= (v >>> 0); h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; }
  return (h ^ (h >>> 15)) >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Sensors: a mount on the body and a fan of unit rays in the body frame (forward f, up y, side s).
export function sensorRig(platformKey, enabled = {}, density = 'demo') {
  const p = PLATFORMS[platformKey] || PLATFORMS.cleaner, d = DENSITY[density] || DENSITY.demo;
  const on = {lidar: enabled.lidar !== false, front: enabled.front !== false, rear: enabled.rear !== false};
  const camY = Math.min(0.45, Math.max(0.08, p.height * 0.5)), rig = [];
  if (on.lidar) rig.push({id: 'lidar', spec: 'lidar', label: 'Roof lidar', forward: 0, y: p.height + 0.06, rays: lidarRays(d)});
  if (on.front) rig.push({id: 'depth-front', spec: 'depth', label: 'Front depth', forward: p.depth / 2, y: camY, yaw: 0, pitch: -30 * DEG, rays: depthRays(d, -30 * DEG, 0)});
  if (on.rear) rig.push({id: 'depth-rear', spec: 'depth', label: 'Rear depth', forward: -p.depth / 2, y: camY, yaw: Math.PI, pitch: -30 * DEG, rays: depthRays(d, -30 * DEG, Math.PI)});
  return rig;
}
function lidarRays(d) {
  const out = [];
  for (let az = 0; az < 360 - 1e-9; az += d.azimuthDeg) for (const el of d.elevations) {
    const a = az * DEG, e = el * DEG; out.push(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
  }
  return Float32Array.from(out);
}
function depthRays(d, pitch, yaw) {
  const s = SENSOR_SPECS.depth, out = [];
  for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
    const h = ((c + 0.5) / d.cols - 0.5) * s.hFovDeg * DEG, v = ((r + 0.5) / d.rows - 0.5) * s.vFovDeg * DEG;
    let f = 1, y = Math.tan(v), sd = Math.tan(h); const n = Math.hypot(f, y, sd); f /= n; y /= n; sd /= n;
    const f1 = f * Math.cos(pitch) - y * Math.sin(pitch), y1 = f * Math.sin(pitch) + y * Math.cos(pitch);
    out.push(f1 * Math.cos(yaw) - sd * Math.sin(yaw), y1, f1 * Math.sin(yaw) + sd * Math.cos(yaw));
  }
  return Float32Array.from(out);
}

// ---------------------------------------------------------------------------------------------------------------
// Ground truth: physical boxes (mapped objects, plus anything a trial adds on purpose), walls along the floor edge and
// keep-out regions. Areas the reviewed map marks unknown or no-go are keep-out rules, not simulated geometry: nobody
// observed what is inside an unknown area, so the simulation does not invent it.
export function buildTruth(world, extras = [], {wallHeight = 2.4, stepHeight = 0.05} = {}) {
  const boxes = [], keepOut = [];
  for (const o of world.objects) {
    const box = {id: o.id, name: o.name, x0: o.x, z0: o.z, x1: o.x + o.w, z1: o.z + o.d, h: o.h, kind: o.kind, mapped: true};
    if (o.kind === 'obstacle') { if (o.h >= stepHeight) boxes.push(box); } else keepOut.push(box);
  }
  for (const e of extras) boxes.push({...e, mapped: false});
  const floor = world.floor || [[0, 0], [world.width, 0], [world.width, world.depth], [0, world.depth]];
  const walls = floor.map((p, i) => { const q = floor[(i + 1) % floor.length]; return [p[0], p[1], q[0], q[1]]; });
  return {boxes, keepOut, walls, floor, wallHeight, stepHeight, width: world.width, depth: world.depth};
}

const HIT = {t: 0, kind: 0, index: -1};  // kind 0 none, 1 floor, 2 box, 3 wall
/** The range, kind and index of the most recent castRay return. */
export const lastHit = () => ({...HIT});
/** Nearest return along a unit ray, or none within tMax. Writes HIT and returns its kind. */
export function castRay(truth, ox, oy, oz, dx, dy, dz, tMax) {
  let best = tMax, kind = 0, index = -1;
  if (dy < -1e-9) { const t = -oy / dy; if (t > 0 && t < best) { best = t; kind = 1; } }
  const boxes = truth.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]; let lo = 0, hi = best;
    if (dx > -1e-12 && dx < 1e-12) { if (ox < b.x0 || ox > b.x1) continue; }
    else { let a = (b.x0 - ox) / dx, c = (b.x1 - ox) / dx; if (a > c) { const s = a; a = c; c = s; } if (a > lo) lo = a; if (c < hi) hi = c; if (lo > hi) continue; }
    if (dz > -1e-12 && dz < 1e-12) { if (oz < b.z0 || oz > b.z1) continue; }
    else { let a = (b.z0 - oz) / dz, c = (b.z1 - oz) / dz; if (a > c) { const s = a; a = c; c = s; } if (a > lo) lo = a; if (c < hi) hi = c; if (lo > hi) continue; }
    if (dy > -1e-12 && dy < 1e-12) { if (oy < 0 || oy > b.h) continue; }
    else { let a = -oy / dy, c = (b.h - oy) / dy; if (a > c) { const s = a; a = c; c = s; } if (a > lo) lo = a; if (c < hi) hi = c; if (lo > hi) continue; }
    if (lo < best) { best = lo; kind = 2; index = i; }
  }
  const walls = truth.walls, H = truth.wallHeight;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i], ex = w[2] - w[0], ez = w[3] - w[1], den = dx * ez - dz * ex;
    if (den > -1e-12 && den < 1e-12) continue;
    const ax = w[0] - ox, az = w[1] - oz, t = (ax * ez - az * ex) / den, u = (ax * dz - az * dx) / den;
    if (t <= 1e-9 || t >= best || u < 0 || u > 1) continue;
    const y = oy + dy * t; if (y < 0 || y > H) continue;
    best = t; kind = 3; index = i;
  }
  HIT.t = best; HIT.kind = kind; HIT.index = index; return kind;
}

// ---------------------------------------------------------------------------------------------------------------
// The robot's map: log-odds evidence per cell, the reviewed map as a prior, and a clearance field for planning.
const L_OCC = 0.4, L_FREE = -0.2, L_MIN = -2, L_MAX = 3.5, OCC_ON = 0.75, OCC_OFF = 0.2;
export function createMap(world, {resolution = 0.04, maxCells = 600000, prior = true, stepHeight = 0.05} = {}) {
  const res = Math.max(resolution, Math.ceil(Math.sqrt(world.width * world.depth / maxCells) * 1000) / 1000);
  const nx = Math.ceil(world.width / res - 1e-9), nz = Math.ceil(world.depth / res - 1e-9), n = nx * nz;
  const map = {res, nx, nz, n, width: world.width, depth: world.depth, usesPrior: prior !== false, stepHeight,
    logOdds: new Float32Array(n), seen: new Uint8Array(n), sensed: new Uint8Array(n), prior: new Uint8Array(n), nearPrior: new Uint8Array(n), lethal: new Uint8Array(n), dist: new Float32Array(n),
    dirty: true, sensedCells: 0, scratch: null};
  // The map edge is a wall whatever the prior says; the robot's centre never leaves the floor rectangle.
  for (let i = 0; i < nx; i++) { map.prior[i] = 1; map.prior[(nz - 1) * nx + i] = 1; }
  for (let k = 0; k < nz; k++) { map.prior[k * nx] = 1; map.prior[k * nx + nx - 1] = 1; }
  for (const o of world.objects) if (o.kind !== 'obstacle' || map.usesPrior) markBox(map, o.x, o.z, o.x + o.w, o.z + o.d);
  if (map.usesPrior && world.floor) {
    const poly = world.floor, edge = res * Math.SQRT1_2;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const p = [(i + 0.5) * res, (k + 0.5) * res];
      if (!inPolygon(p, poly) || poly.some((a, j) => pointSegment(p, a, poly[(j + 1) % poly.length]) < edge)) map.prior[k * nx + i] = 1;
    }
  }
  // A return within two cells of geometry the map already holds confirms it rather than moving it: noise and the
  // raster edge stay off the planner, and only genuinely new obstacles change the clearance field.
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (!map.prior[k * nx + i]) continue;
    for (let dk = -2; dk <= 2; dk++) for (let di = -2; di <= 2; di++) { const a = i + di, b = k + dk; if (a >= 0 && b >= 0 && a < nx && b < nz) map.nearPrior[b * nx + a] = 1; }
  }
  for (let i = 0; i < n; i++) map.lethal[i] = map.prior[i];
  updateClearance(map);
  return map;
}
function markBox(map, x0, z0, x1, z1) {
  const {res, nx, nz} = map;
  const i0 = Math.max(0, Math.floor(x0 / res)), i1 = Math.min(nx - 1, Math.ceil(x1 / res) - 1), k0 = Math.max(0, Math.floor(z0 / res)), k1 = Math.min(nz - 1, Math.ceil(z1 / res) - 1);
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) map.prior[k * nx + i] = 1;
}
export const cellOf = (map, x, z) => { const i = Math.floor(x / map.res), k = Math.floor(z / map.res); return i < 0 || k < 0 || i >= map.nx || k >= map.nz ? -1 : k * map.nx + i; };
/** Clearance in metres from a point to the nearest lethal cell (prior or sensed); 0 outside the map. */
export const clearanceAt = (map, x, z) => { const c = cellOf(map, x, z); return c < 0 ? 0 : map.dist[c]; };

function evidence(map, idx, delta) {
  let L = map.logOdds[idx] + delta; L = L < L_MIN ? L_MIN : L > L_MAX ? L_MAX : L; map.logOdds[idx] = L; map.seen[idx] = 1;
  if (!map.sensed[idx] && L >= OCC_ON) { map.sensed[idx] = 1; map.sensedCells++; if (!map.lethal[idx] && !map.nearPrior[idx]) { map.lethal[idx] = 1; map.dirty = true; } }
  else if (map.sensed[idx] && L <= OCC_OFF) { map.sensed[idx] = 0; map.sensedCells--; if (map.lethal[idx] && !map.prior[idx]) { map.lethal[idx] = 0; map.dirty = true; } }
}
/** Free evidence along the cells from a to b (Amanatides-Woo traversal), optionally including b's own cell. */
function carve(map, ax, az, bx, bz, includeLast) {
  const {res, nx, nz} = map; let i = Math.floor(ax / res), k = Math.floor(az / res);
  const ie = Math.floor(bx / res), ke = Math.floor(bz / res), dx = bx - ax, dz = bz - az;
  const si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sk = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const ti = si ? Math.abs(res / dx) : Infinity, tk = sk ? Math.abs(res / dz) : Infinity;
  let mi = si > 0 ? ((i + 1) * res - ax) / dx : si < 0 ? (i * res - ax) / dx : Infinity;
  let mk = sk > 0 ? ((k + 1) * res - az) / dz : sk < 0 ? (k * res - az) / dz : Infinity;
  for (let guard = Math.abs(ie - i) + Math.abs(ke - k) + 2; guard > 0; guard--) {
    const last = i === ie && k === ke;
    if (last && !includeLast) return;
    if (i >= 0 && k >= 0 && i < nx && k < nz) evidence(map, k * nx + i, L_FREE);
    if (last) return;
    if (mi < mk) { i += si; mi += ti; } else { k += sk; mk += tk; }
  }
}
/** One measured return, placed with the robot's own pose estimate. The robot classifies by measured height only:
 *  a return below the step height is floor, anything higher is an obstacle. It never reads what was hit. */
export function integrateReturn(map, sx, sy, sz, dx, dy, dz, range) {
  const step = map.stepHeight, ex = sx + dx * range, ez = sz + dz * range, ey = sy + dy * range;
  if (ey < step) {
    const t0 = dy < -1e-9 ? Math.max(0, (step - sy) / dy) : (sy <= step ? 0 : range);
    if (t0 < range) carve(map, sx + dx * t0, sz + dz * t0, ex, ez, true);
    return 'floor';
  }
  const c = cellOf(map, ex, ez); if (c >= 0) evidence(map, c, L_OCC);
  return 'obstacle';
}

// Felzenszwalb-Huttenlocher squared distance transform, row then column.
function edt1d(f, d, v, z, n) {
  let k = 0; v[0] = 0; z[0] = -BIG; z[1] = BIG;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = BIG;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = q - v[k]; d[q] = r * r + f[v[k]]; }
}
/** Recompute the clearance field when the lethal set changed. Returns milliseconds spent, or 0 when clean. */
export function updateClearance(map) {
  if (!map.dirty) return 0;
  const t0 = clock(), {nx, nz, n, res} = map, m = Math.max(nx, nz) + 1;
  const s = map.scratch || (map.scratch = {g: new Float64Array(n), f: new Float64Array(m), d: new Float64Array(m), v: new Int32Array(m), z: new Float64Array(m + 1)});
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) s.f[i] = map.lethal[k * nx + i] ? 0 : BIG;
    edt1d(s.f, s.d, s.v, s.z, nx);
    for (let i = 0; i < nx; i++) s.g[k * nx + i] = s.d[i];
  }
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) s.f[k] = s.g[k * nx + i];
    edt1d(s.f, s.d, s.v, s.z, nz);
    // Centre-to-centre distance less half a cell: a conservative distance to the lethal cell's near edge.
    for (let k = 0; k < nz; k++) map.dist[k * nx + i] = Math.max(0, Math.sqrt(s.d[k]) - 0.5) * res;
  }
  map.dirty = false; return clock() - t0;
}

// ---------------------------------------------------------------------------------------------------------------
// A*: 8-connected over the clearance field, no corner cutting, an inflation cost that keeps routes off walls, and a
// mild penalty for never-observed cells when no reviewed map is used. Octile heuristic; every step costs at least its
// length, so the heuristic is admissible.
function makePlanner(map) {
  return {map, g: new Float64Array(map.n), parent: new Int32Array(map.n), mark: new Uint32Array(map.n), done: new Uint32Array(map.n), gen: 0,
    hi: new Int32Array(4096), hf: new Float64Array(4096), size: 0};
}
function push(P, idx, f) {
  if (P.size >= P.hi.length) { const hi = new Int32Array(P.hi.length * 2), hf = new Float64Array(P.hf.length * 2); hi.set(P.hi); hf.set(P.hf); P.hi = hi; P.hf = hf; }
  let j = P.size++;
  while (j > 0) { const p = (j - 1) >> 1; if (P.hf[p] <= f) break; P.hi[j] = P.hi[p]; P.hf[j] = P.hf[p]; j = p; }
  P.hi[j] = idx; P.hf[j] = f;
}
function pop(P) {
  const top = P.hi[0], last = --P.size; if (last <= 0) return top;
  const li = P.hi[last], lf = P.hf[last]; let j = 0;
  for (;;) { let c = 2 * j + 1; if (c >= last) break; if (c + 1 < last && P.hf[c + 1] < P.hf[c]) c++; if (P.hf[c] >= lf) break; P.hi[j] = P.hi[c]; P.hf[j] = P.hf[c]; j = c; }
  P.hi[j] = li; P.hf[j] = lf; return top;
}
export function planPath(map, planner, from, goal, {radius, escape = 1.0, unknownCost = 0.6, inflation = 2.0, decay = 3.0} = {}) {
  const t0 = clock(), {nx, nz, res} = map, P = planner || makePlanner(map);
  const s = cellOf(map, from.x, from.z), g = cellOf(map, goal.x, goal.z);
  const fail = reason => ({ok: false, reason, ms: clock() - t0, expanded: 0});
  if (s < 0 || g < 0) return fail('outside-map');
  if (map.dist[g] < radius) return fail('goal-blocked');
  // An obstacle can appear right next to the robot. Near the start only, accept the clearance the robot already has.
  const startClear = map.dist[s], relaxed = Math.min(radius, startClear * 0.98), sx = s % nx, sz = (s / nx) | 0, escapeCells = escape / res;
  if (relaxed < radius * 0.5) return fail('start-blocked');
  const passable = i => { const d = map.dist[i]; if (d >= radius) return true; if (d < relaxed) return false; const dx = i % nx - sx, dz = ((i / nx) | 0) - sz; return dx * dx + dz * dz <= escapeCells * escapeCells; };
  const cost = i => 1 + inflation * Math.exp(-decay * Math.max(0, map.dist[i] - radius)) + (!map.usesPrior && !map.seen[i] ? unknownCost : 0);
  P.gen = (P.gen + 1) >>> 0 || 1; P.size = 0;
  const gx = g % nx, gz = (g / nx) | 0, h = i => { const dx = Math.abs(i % nx - gx), dz = Math.abs(((i / nx) | 0) - gz); return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)); };
  P.mark[s] = P.gen; P.g[s] = 0; P.parent[s] = s; push(P, s, h(s));
  let expanded = 0, found = false;
  while (P.size) {
    const cur = pop(P);
    if (P.done[cur] === P.gen) continue;
    P.done[cur] = P.gen; expanded++;
    if (cur === g) { found = true; break; }
    const ci = cur % nx, ck = (cur / nx) | 0, cc = cost(cur), gc = P.g[cur];
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      if (!di && !dk) continue;
      const ni = ci + di, nk = ck + dk; if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
      const nb = nk * nx + ni; if (P.done[nb] === P.gen || !passable(nb)) continue;
      if (di && dk && (!passable(ck * nx + ni) || !passable(nk * nx + ci))) continue;
      const step = (di && dk ? Math.SQRT2 : 1) * (cc + cost(nb)) / 2, ng = gc + step;
      if (P.mark[nb] !== P.gen || ng < P.g[nb]) { P.mark[nb] = P.gen; P.g[nb] = ng; P.parent[nb] = cur; push(P, nb, ng + h(nb)); }
    }
  }
  if (!found) return {ok: false, reason: 'no-route', ms: clock() - t0, expanded};
  const cells = [g]; while (cells[cells.length - 1] !== s) cells.push(P.parent[cells[cells.length - 1]]);
  cells.reverse();
  const raw = [{x: from.x, z: from.z}, ...cells.slice(1, -1).map(i => ({x: (i % nx + 0.5) * res, z: (((i / nx) | 0) + 0.5) * res})), {x: goal.x, z: goal.z}];
  const clearFor = (x, z) => { const c = cellOf(map, x, z); return c >= 0 && passable(c); };
  const path = resample(shortcut(raw, clearFor, res), 0.1);
  return {ok: true, ...path, expanded, ms: clock() - t0, cells: cells.length};
}
/** Drop corners the robot can cut without losing clearance (string pulling on the same passability test). */
function shortcut(points, clearFor, res) {
  if (points.length < 3) return points;
  const visible = (a, b) => { const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / (res * 0.5))); for (let j = 1; j < n; j++) { const t = j / n; if (!clearFor(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; } return true; };
  const out = [points[0]]; let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    while (j + 1 < points.length && j - i < 240 && visible(points[i], points[j + 1])) j++;
    out.push(points[j]); i = j;
  }
  return out;
}
function resample(points, spacing) {
  const xs = [points[0].x], zs = [points[0].z];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / spacing));
    for (let j = 1; j <= n; j++) { xs.push(a.x + (b.x - a.x) * j / n); zs.push(a.z + (b.z - a.z) * j / n); }
  }
  const s = new Float64Array(xs.length); for (let i = 1; i < xs.length; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  return {x: Float64Array.from(xs), z: Float64Array.from(zs), s, length: s[s.length - 1]};
}
export function pointAt(path, arc) {
  const s = path.s, n = s.length; if (arc <= 0) return {x: path.x[0], z: path.z[0], i: 0}; if (arc >= s[n - 1]) return {x: path.x[n - 1], z: path.z[n - 1], i: n - 1};
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= arc) lo = m; else hi = m; }
  const t = (arc - s[lo]) / (s[hi] - s[lo] || 1); return {x: path.x[lo] + (path.x[hi] - path.x[lo]) * t, z: path.z[lo] + (path.z[hi] - path.z[lo]) * t, i: lo};
}

// ---------------------------------------------------------------------------------------------------------------
// MPPI: sample perturbed control sequences, roll each out on the unicycle model against the robot's own map, weight
// by exp(-cost / lambda) and average. Collision is checked against the robot's map, never against ground truth.
/** Cover the footprint with equal circles strung along the heading, enough that each is at most 10% wider than half
 *  the robot. Sideways reach is what decides whether a robot fits a corridor, and one circumscribed circle overstates
 *  it badly for long robots. The cover still contains the whole rectangle. */
export function footprintCircles(platform) {
  const W = platform.width, D = platform.depth, m = Math.min(5, Math.max(1, Math.ceil(D / (0.458 * W)))), r = Math.hypot(W / 2, D / (2 * m));
  return {r, f: Array.from({length: m}, (_, j) => -D / 2 + D / (2 * m) + j * D / m), s: Array(m).fill(0)};
}
function createController(platform, {samples = 128, horizon = 20, record = false} = {}) {
  const K = samples, H = horizon;
  return {K, H, vmax: platform.speed, wmax: platform.maxYawRate, accel: 1.0, alpha: 3.0, circles: footprintCircles(platform), U: new Float32Array(H * 2), du: new Float32Array(K * H * 2), cost: new Float64Array(K), order: new Int32Array(K),
    trajectories: record ? new Float32Array(K * (H + 1) * 2) : null, best: new Float32Array((H + 1) * 2), lastU: {v: 0, w: 0}};
}
function mppiControl(C, rand, pose, path, progress, map) {
  const {K, H, vmax, wmax} = C, cf = C.circles.f, cs = C.circles.s, cr = C.circles.r, nc = cf.length, dt = TICK, sv = 0.35 * vmax, sw = 0.6 * wmax, dvMax = C.accel * dt, dwMax = C.alpha * dt;
  const s0 = path.s[progress], look = Math.max(0.6, 0.8 * vmax * H * dt), carrot = pointAt(path, s0 + look);
  const wEnd = Math.min(path.s.length - 1, pointAt(path, s0 + look + 1.5).i + 1);
  for (let k = 0; k < K; k++) {
    let x = pose.x, z = pose.z, th = pose.th, pv = C.lastU.v, pw = C.lastU.w, c = 0, crashed = false;
    if (C.trajectories) { const o = k * (H + 1) * 2; C.trajectories[o] = x; C.trajectories[o + 1] = z; }
    let near = progress;
    for (let t = 0; t < H; t++) {
      const j = (k * H + t) * 2;
      let v = C.U[t * 2], w = C.U[t * 2 + 1];
      // Sample 0 is the nominal sequence, 1 stops, 2 and 3 turn in place, 4 and 5 follow the path by pure pursuit at
      // full and half speed: deterministic candidates for a cornered robot and for a narrow gap that random noise
      // rarely threads. The rest are noise around the nominal.
      if (k > 5) { v += sv * rand.normal(); w += sw * rand.normal(); }
      else if (k === 1) { v = 0; w = 0; }
      else if (k === 2 || k === 3) { v = 0; w = (k === 2 ? 0.8 : -0.8) * wmax; }
      else if (k === 4 || k === 5) {
        const L = Math.max(0.5, vmax * 1.2), aim = pointAt(path, path.s[near] + L), alpha = Math.atan2(Math.sin(Math.atan2(aim.z - z, aim.x - x) - th), Math.cos(Math.atan2(aim.z - z, aim.x - x) - th));
        v = (k === 4 ? 1 : 0.5) * vmax * Math.max(0.15, 1 - Math.abs(alpha) / 1.2); w = Math.abs(alpha) > 1.2 ? Math.sign(alpha) * 0.8 * wmax : 2 * v * Math.sin(alpha) / L;
      }
      v = Math.min(vmax, Math.max(-0.3 * vmax, Math.min(pv + dvMax, Math.max(pv - dvMax, v))));
      w = Math.min(wmax, Math.max(-wmax, Math.min(pw + dwMax, Math.max(pw - dwMax, w))));
      C.du[j] = v - C.U[t * 2]; C.du[j + 1] = w - C.U[t * 2 + 1];
      const mid = th + w * dt / 2; x += v * Math.cos(mid) * dt; z += v * Math.sin(mid) * dt; th += w * dt;
      if (C.trajectories) { const o = (k * (H + 1) + t + 1) * 2; C.trajectories[o] = x; C.trajectories[o + 1] = z; }
      if (!crashed) {
        let gap = Infinity; const ct = Math.cos(th), st = Math.sin(th);
        for (let q = 0; q < nc; q++) { const g = clearanceAt(map, x + ct * cf[q] - st * cs[q], z + st * cf[q] + ct * cs[q]) - cr; if (g < gap) gap = g; }
        if (gap < 0) { c += 1000 + 100 * (H - t); crashed = true; }
        else {
          if (gap < 0.35) { const q = (0.35 - gap) / 0.35; c += 6 * q * q * dt; }
          let best = Infinity; for (let i = progress; i <= wEnd; i++) { const ex = path.x[i] - x, ez = path.z[i] - z, e = ex * ex + ez * ez; if (e < best) { best = e; near = i; } }
          c += (2.5 * best + 0.6 * Math.hypot(carrot.x - x, carrot.z - z)) * dt + 0.15 * (v - pv) ** 2 + 0.04 * (w - pw) ** 2 + (v < 0 ? 0.3 * -v * dt : 0);
        }
      }
      pv = v; pw = w;
    }
    if (!crashed) {
      const cx = carrot.x - x, cz = carrot.z - z, far = Math.hypot(cx, cz);
      c += 3 * far + (far > 0.3 ? 0.6 * Math.abs(Math.atan2(Math.sin(Math.atan2(cz, cx) - th), Math.cos(Math.atan2(cz, cx) - th))) : 0);
    }
    C.cost[k] = c;
  }
  for (let k = 0; k < K; k++) C.order[k] = k;
  C.order.sort((a, b) => C.cost[a] - C.cost[b]);
  const min = C.cost[C.order[0]], median = C.cost[C.order[K >> 1]], lambda = Math.max(1e-3, (median - min) / 5);
  let wsum = 0; const nv = new Float64Array(H * 2);
  for (let k = 0; k < K; k++) { const wk = Math.exp(-(C.cost[k] - min) / lambda); wsum += wk; for (let t = 0; t < H * 2; t++) nv[t] += wk * C.du[k * H * 2 + t]; }
  for (let t = 0; t < H * 2; t++) C.U[t] += nv[t] / wsum;
  // The executed command is the updated first control, held to the same limits the rollouts used.
  const v = Math.min(vmax, Math.max(-0.3 * vmax, Math.min(C.lastU.v + dvMax, Math.max(C.lastU.v - dvMax, C.U[0]))));
  const w = Math.min(wmax, Math.max(-wmax, Math.min(C.lastU.w + dwMax, Math.max(C.lastU.w - dwMax, C.U[1]))));
  // The nominal rollout of the updated sequence, for display.
  let x = pose.x, z = pose.z, th = pose.th; C.best[0] = x; C.best[1] = z;
  for (let t = 0; t < H; t++) { const vv = C.U[t * 2], ww = C.U[t * 2 + 1], mid = th + ww * dt / 2; x += vv * Math.cos(mid) * dt; z += vv * Math.sin(mid) * dt; th += ww * dt; C.best[(t + 1) * 2] = x; C.best[(t + 1) * 2 + 1] = z; }
  for (let t = 0; t < H - 1; t++) { C.U[t * 2] = C.U[t * 2 + 2]; C.U[t * 2 + 1] = C.U[t * 2 + 3]; }
  C.lastU = {v, w}; return {v, w, lambda, minCost: min};
}

// ---------------------------------------------------------------------------------------------------------------
// Truth-side geometry for scoring: the oriented footprint against boxes, walls and keep-out areas.
function cross(ax, az, bx, bz, cx, cz) { return (bx - ax) * (cz - az) - (bz - az) * (cx - ax); }
function pointSegment(p, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); }
function segmentsCross(a, b, c, d) {
  const d1 = cross(a[0], a[1], b[0], b[1], c[0], c[1]), d2 = cross(a[0], a[1], b[0], b[1], d[0], d[1]), d3 = cross(c[0], c[1], d[0], d[1], a[0], a[1]), d4 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
function segmentDistance(a, b, c, d) { return segmentsCross(a, b, c, d) ? 0 : Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b)); }
function inPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; }
  return inside;
}
export function footprint(platform, pose) {
  const fx = Math.cos(pose.th), fz = Math.sin(pose.th), a = platform.depth / 2, b = platform.width / 2;
  return [[pose.x + fx * a - fz * b, pose.z + fz * a + fx * b], [pose.x + fx * a + fz * b, pose.z + fz * a - fx * b], [pose.x - fx * a + fz * b, pose.z - fz * a - fx * b], [pose.x - fx * a - fz * b, pose.z - fz * a + fx * b]];
}
function overlapsBox(rect, b) {
  const project = (ax, az) => { let lo = Infinity, hi = -Infinity; for (const p of rect) { const v = p[0] * ax + p[1] * az; if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };
  const boxProject = (ax, az) => { const vs = [b.x0 * ax + b.z0 * az, b.x1 * ax + b.z0 * az, b.x1 * ax + b.z1 * az, b.x0 * ax + b.z1 * az]; return [Math.min(...vs), Math.max(...vs)]; };
  const ex = rect[1][0] - rect[0][0], ez = rect[1][1] - rect[0][1], fx = rect[3][0] - rect[0][0], fz = rect[3][1] - rect[0][1];
  for (const [ax, az] of [[1, 0], [0, 1], [ez, -ex], [fz, -fx]]) { const r = project(ax, az), q = boxProject(ax, az); if (r[1] <= q[0] || q[1] <= r[0]) return false; }
  return true;
}
function rectDistanceToBox(rect, b) {
  if (overlapsBox(rect, b)) return 0;
  const box = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]; let best = Infinity;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) best = Math.min(best, segmentDistance(rect[i], rect[(i + 1) % 4], box[j], box[(j + 1) % 4]));
  return best;
}
/** Contact, keep-out intrusion and the true clearance of the footprint. The robot's software never sees this. */
export function scoreFootprint(truth, platform, pose) {
  const rect = footprint(platform, pose), reach = Math.hypot(platform.width, platform.depth) / 2 + 2;
  let clearance = Infinity, contact = null, keepOut = null;
  if (!inPolygon([pose.x, pose.z], truth.floor)) return {contact: {kind: 'wall', id: 'floor-edge'}, keepOut: null, clearance: 0};
  for (const b of truth.boxes) {
    if (pose.x < b.x0 - reach || pose.x > b.x1 + reach || pose.z < b.z0 - reach || pose.z > b.z1 + reach) continue;
    const d = rectDistanceToBox(rect, b); if (d < clearance) clearance = d;
    if (d <= 0 && !contact) contact = {kind: b.mapped ? 'mapped-object' : 'unmapped-object', id: b.id, name: b.name};
  }
  for (let i = 0; i < truth.walls.length; i++) {
    const w = truth.walls[i], a = [w[0], w[1]], c = [w[2], w[3]];
    let d = Infinity; for (let j = 0; j < 4; j++) d = Math.min(d, segmentDistance(rect[j], rect[(j + 1) % 4], a, c));
    if (d < clearance) clearance = d; if (d <= 0 && !contact) contact = {kind: 'wall', id: `wall-${i}`};
  }
  if (!contact) for (const p of rect) if (!inPolygon(p, truth.floor)) { contact = {kind: 'wall', id: 'floor-edge'}; clearance = 0; break; }
  for (const b of truth.keepOut) if (overlapsBox(rect, b)) { keepOut = {kind: b.kind, id: b.id, name: b.name}; break; }
  return {contact, keepOut, clearance};
}
function boxFree(truth, box, pad) {
  const b = {x0: box.x0 - pad, z0: box.z0 - pad, x1: box.x1 + pad, z1: box.z1 + pad};
  const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
  if (corners.some(p => !inPolygon(p, truth.floor))) return false;
  for (const w of truth.walls) for (let j = 0; j < 4; j++) if (segmentDistance(corners[j], corners[(j + 1) % 4], [w[0], w[1]], [w[2], w[3]]) <= 0) return false;
  const hit = o => !(b.x1 <= o.x0 || o.x1 <= b.x0 || b.z1 <= o.z0 || o.z1 <= b.z0);
  return !truth.boxes.some(hit) && !truth.keepOut.some(hit);
}

// ---------------------------------------------------------------------------------------------------------------
// Episodes.
const PERTURBATION_DEFAULTS = Object.freeze({crate: false, crateAt: null, mapError: false, blackout: false, drift: false});
const CRATE = {size: 0.5, h: 0.45}, PALLET = {w: 0.9, d: 0.7, h: 0.9};
export function prepareWorld(worldInput) {
  const world = normalizeWorld(worldInput), gate = planningGate(world);
  if (gate) throw new Error(gate);
  return world;
}
/** Place a truth-only object on a reference route: the map does not know it exists. */
export function placeOnRoute(truth, path, fromArc, toArc, size, rand, avoid = []) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const p = pointAt(path, fromArc + rand() * Math.max(0, toArc - fromArc));
    const box = {x0: p.x - size.w / 2, z0: p.z - size.d / 2, x1: p.x + size.w / 2, z1: p.z + size.d / 2, h: size.h};
    if (!boxFree(truth, box, 0.02)) continue;
    if (avoid.some(a => Math.hypot(a.x - p.x, a.z - p.z) < a.r + Math.hypot(size.w, size.d) / 2)) continue;
    return {...box, x: p.x, z: p.z};
  }
  return null;
}

export function createEpisode(worldInput, options = {}) {
  const world = options.preparedWorld || prepareWorld(worldInput);
  const robotKey = PLATFORMS[options.robot] ? options.robot : 'cleaner', platform = PLATFORMS[robotKey];
  const margin = options.margin ?? 0.1, rc = Math.hypot(platform.width, platform.depth) / 2, radius = rc + margin;
  const seed = (options.seed >>> 0) || 1, perturb = {...PERTURBATION_DEFAULTS, ...(options.perturbations || {})};
  const streams = {sensor: rng(mix(seed, 1)), control: rng(mix(seed, 2)), perturb: rng(mix(seed, 3, perturb.crate ? 1 : 0, perturb.mapError ? 1 : 0, perturb.blackout ? 1 : 0)), drift: rng(mix(seed, 4))};
  const stepHeight = 0.05, extras = (options.extraObstacles || []).map(e => ({...e}));
  // A live demo keeps what the robot has already seen when it gets a new goal: pass the previous episode's map.
  const reuse = options.map && options.map.usesPrior === (options.prior !== false) && options.map.width === world.width && options.map.depth === world.depth;
  const map = reuse ? options.map : createMap(world, {resolution: options.resolution ?? 0.04, prior: options.prior !== false, stepHeight});
  const reference = options.referenceMap || createMap(world, {resolution: map.res, prior: true, stepHeight});
  const start = {x: options.start?.x ?? world.start.x, z: options.start?.z ?? world.start.z};
  const goal = options.goal ? {x: options.goal.x, z: options.goal.z} : null;
  if (!goal) throw new Error('Choose a goal on open floor.');
  const refPath = planPath(reference, null, start, goal, {radius});
  if (!refPath.ok) throw new Error(refPath.reason === 'goal-blocked' ? 'That goal is too close to an obstacle, a wall or unknown space for this robot. Choose open floor.' : refPath.reason === 'start-blocked' ? 'The start is blocked for this robot. Choose a smaller robot or another start.' : 'No route reaches that goal on the reviewed map.');
  const events = [], ep = {world, platform, robotKey, radius, rc, margin, seed, perturb, streams, map, reference, planner: reuse && options.planner ? options.planner : makePlanner(map), goal, start, events,
    sensors: sensorRig(robotKey, options.sensors, options.density || 'demo'), density: options.density || 'demo', record: !!options.record,
    controller: createController(platform, {samples: options.samples ?? (options.density === 'trial' ? 96 : 128), horizon: 20, record: !!options.record}),
    referenceDistance: refPath.length, ticks: 0, t: 0, outcome: null, path: null, progress: 0, lastPlan: -Infinity, noRouteSince: null, distance: 0, minClearance: Infinity,
    replans: [], extras, truth: null, crate: null, mapError: null, blackout: null, scan: null, lastCheck: {t: 0, x: start.x, z: start.z}, watch: {t: 0, x: start.x, z: start.z}, recovery: null, recoveries: 0, lastRecovery: -Infinity};
  if (perturb.mapError) {
    const placed = placeOnRoute(buildTruth(world, extras), refPath, refPath.length * 0.35, refPath.length * 0.65, PALLET, streams.perturb, [{...start, r: radius + 0.6}, {...goal, r: radius + 0.6}]);
    if (placed) { extras.push({id: 'unmapped-pallet', name: 'Pallet stack missing from the map', kind: 'obstacle', x0: placed.x0, z0: placed.z0, x1: placed.x1, z1: placed.z1, h: PALLET.h}); ep.mapError = {placed: true, x: placed.x, z: placed.z, detectedAt: null}; }
    else ep.mapError = {placed: false, reason: 'No clear spot on the route for the unmapped object.'};
  }
  if (perturb.crate) ep.crate = newCrate(perturb.crateAt ?? round(2 + streams.perturb() * 3, 1));
  if (perturb.blackout) {
    const at = ep.crate ? Math.max(0.1, round(ep.crate.dropAt - 0.5, 1)) : round(2 + streams.perturb() * 4, 1);
    ep.blackout = {sensor: 'depth-front', from: at, to: round(at + 3.5, 1), started: false, ended: false};
  }
  if (perturb.drift) ep.drift = {position: 0.02, heading: 0.004};  // per square-root metre travelled; illustrative
  ep.truth = buildTruth(world, extras, {stepHeight});
  const h0 = pointAt(refPath, Math.min(0.6, refPath.length));
  const th = Number.isFinite(options.heading) ? options.heading : Math.atan2(h0.z - start.z, h0.x - start.x) || 0;
  ep.truePose = {x: start.x, z: start.z, th}; ep.bias = {x: 0, z: 0, th: 0}; ep.estPose = {...ep.truePose};
  ep.maxSeconds = options.maxSeconds ?? Math.ceil(refPath.length / platform.speed * 3 + 25);
  events.push({t: 0, type: 'start', start, goal, referenceDistance: round(refPath.length, 2)});
  sense(ep); updateClearance(map); replan(ep, 'start');
  return ep;
}
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const newCrate = dropAt => ({dropAt, dropped: false, skipped: null, box: null, droppedAt: null, aheadMetres: null, firstReturnAt: null, sensor: null, inMapAt: null, replannedAt: null, replanMs: null, pathAffected: false});
/** Drop a crate on the route ahead at the next tick: the live demo's button. Earlier crates stay where they fell. */
export function requestCrate(ep) {
  if (ep.outcome) return false;
  ep.crate = newCrate(round(ep.t + TICK, 1)); return true;
}

function sense(ep) {
  const {truth, map, sensors, truePose: tp, estPose: es} = ep, rand = ep.streams.sensor, hits = ep.record ? [] : null;
  const ct = Math.cos(tp.th), st = Math.sin(tp.th), ce = Math.cos(es.th), se = Math.sin(es.th);
  for (const s of sensors) {
    if (ep.blackout && s.id === ep.blackout.sensor && ep.t >= ep.blackout.from && ep.t < ep.blackout.to) continue;
    const spec = SENSOR_SPECS[s.spec], rays = s.rays, n = rays.length / 3;
    const ox = tp.x + ct * s.forward, oz = tp.z + st * s.forward, ex = es.x + ce * s.forward, ez = es.z + se * s.forward;
    for (let r = 0; r < n; r++) {
      const f = rays[r * 3], y = rays[r * 3 + 1], sd = rays[r * 3 + 2];
      const dx = f * ct - sd * st, dz = f * st + sd * ct;
      if (!castRay(truth, ox, s.y, oz, dx, y, dz, spec.maxRange)) continue;
      const t = HIT.t; if (t < spec.minRange) continue;
      const sigma = spec.kind === 'depth' ? spec.relativeErrorAt2m * 2 * (t / 2) ** 2 : spec.rangeSigma, measured = Math.max(spec.minRange, t + sigma * rand.normal());
      if (measured > (spec.kind === 'lidar' ? OBSTACLE_RANGE : spec.maxRange)) continue;
      if (HIT.kind === 2) {
        const box = truth.boxes[HIT.index];
        if (ep.crate && ep.crate.box && box.id === ep.crate.box.id && ep.crate.firstReturnAt === null) { ep.crate.firstReturnAt = round(ep.t, 1); ep.crate.sensor = s.id; ep.events.push({t: round(ep.t, 1), type: 'crate-first-return', sensor: s.id}); }
      }
      const edx = f * ce - sd * se, edz = f * se + sd * ce, kind = integrateReturn(map, ex, s.y, ez, edx, y, edz, measured);
      if (hits && (r % (spec.kind === 'lidar' ? 2 : 1) === 0)) hits.push(ex + edx * measured, ez + edz * measured, kind === 'floor' ? 0 : 1, spec.kind === 'lidar' ? 0 : 1);
    }
  }
  if (hits) ep.scan = Float32Array.from(hits);
}
function inMapCount(map, box) {
  let n = 0; const {res, nx, nz} = map;
  for (let k = Math.max(0, Math.floor(box.z0 / res)); k <= Math.min(nz - 1, Math.ceil(box.z1 / res) - 1); k++) for (let i = Math.max(0, Math.floor(box.x0 / res)); i <= Math.min(nx - 1, Math.ceil(box.x1 / res) - 1); i++) n += map.sensed[k * nx + i];
  return n;
}
function replan(ep, reason, mapMs = 0) {
  const r = planPath(ep.map, ep.planner, ep.estPose, ep.goal, {radius: ep.radius});
  ep.lastPlan = ep.t;
  const rec = {t: round(ep.t, 1), reason, ok: r.ok, ms: round(r.ms, 2), mapMs: round(mapMs, 2), expanded: r.expanded, ...(r.ok ? {length: round(r.length, 2)} : {failure: r.reason})};
  ep.replans.push(rec);
  if (r.ok) { ep.path = r; ep.progress = 0; ep.noRouteSince = null; }
  else { ep.path = null; if (ep.noRouteSince === null) ep.noRouteSince = ep.t; }
  return rec;
}
function pathBlocked(ep) {
  const {path, map} = ep; if (!path) return true;
  const end = pointAt(path, path.s[ep.progress] + 6).i + 1;
  for (let i = ep.progress + 1; i <= Math.min(end, path.s.length - 1); i++) if (clearanceAt(map, path.x[i], path.z[i]) < ep.radius * 0.98) {
    // Points the planner accepted under the start-escape rule stay valid while the robot is still near them.
    if (Math.hypot(path.x[i] - ep.estPose.x, path.z[i] - ep.estPose.z) < 1.0 && clearanceAt(map, path.x[i], path.z[i]) >= ep.rc) continue;
    return true;
  }
  return false;
}
function updateProgress(ep) {
  const {path} = ep; let best = Infinity, at = ep.progress;
  const end = pointAt(path, path.s[ep.progress] + 3).i + 1;
  for (let i = ep.progress; i <= Math.min(end, path.s.length - 1); i++) { const d = Math.hypot(path.x[i] - ep.estPose.x, path.z[i] - ep.estPose.z); if (d < best) { best = d; at = i; } }
  ep.progress = at; return best;
}

/** Advance one 0.1 s tick: perturb, sense, map, replan if needed, control, move, score. */
export function stepEpisode(ep) {
  if (ep.outcome) return ep;
  ep.ticks++; ep.t = round(ep.ticks * TICK, 1);
  const {events} = ep;
  if (ep.crate && !ep.crate.dropped && !ep.crate.skipped && ep.t >= ep.crate.dropAt) dropCrate(ep);
  if (ep.blackout && !ep.blackout.started && ep.t >= ep.blackout.from) { ep.blackout.started = true; events.push({t: ep.t, type: 'blackout-start', sensor: ep.blackout.sensor}); }
  if (ep.blackout && !ep.blackout.ended && ep.t >= ep.blackout.to) { ep.blackout.ended = true; events.push({t: ep.t, type: 'blackout-end', sensor: ep.blackout.sensor}); }
  sense(ep);
  const mapMs = updateClearance(ep.map);
  if (ep.crate && ep.crate.dropped && ep.crate.inMapAt === null && inMapCount(ep.map, ep.crate.box) > 0) { ep.crate.inMapAt = ep.t; events.push({t: ep.t, type: 'crate-in-map'}); }
  if (ep.mapError?.placed && ep.mapError.detectedAt === null) { const b = ep.extras.find(e => e.id === 'unmapped-pallet'); if (b && inMapCount(ep.map, b) > 0) { ep.mapError.detectedAt = ep.t; events.push({t: ep.t, type: 'unmapped-object-in-map'}); } }
  // Replan when the route is gone, blocked, left behind, or due a refresh; a failed plan retries every half second.
  let reason = null;
  if (!ep.path) { if (ep.t - ep.lastPlan >= 0.5 - 1e-9) reason = 'retry'; }
  else if (pathBlocked(ep)) reason = 'path-blocked';
  else if (updateProgress(ep) > 0.75) reason = 'off-path';
  else if (ep.t - ep.lastPlan >= (ep.map.usesPrior ? 5 : 2.5) - 1e-9) reason = 'refresh';
  if (reason) {
    const rec = replan(ep, reason, mapMs);
    // The replan the crate caused: the first time its cells block the route after it entered the map.
    if (reason === 'path-blocked' && ep.crate && ep.crate.inMapAt !== null && ep.crate.replannedAt === null) {
      ep.crate.pathAffected = true; ep.crate.replannedAt = ep.t; ep.crate.replanMs = round(rec.ms + rec.mapMs, 2);
      events.push({t: ep.t, type: rec.ok ? 'crate-replan' : 'crate-replan-failed', ms: ep.crate.replanMs, secondsAfterInMap: round(ep.t - ep.crate.inMapAt, 1)});
    }
    if (ep.path) updateProgress(ep);
  }
  let v = 0, w = 0;
  if (ep.recovery) ({v, w} = recover(ep));
  else if (ep.path) ({v, w} = mppiControl(ep.controller, ep.streams.control, ep.estPose, ep.path, ep.progress, ep.map));
  else { ep.controller.lastU = {v: 0, w: 0}; ep.controller.U.fill(0); }
  // Move the true robot; the pose estimate follows with drift when the trial adds it.
  const tp = ep.truePose, mid = tp.th + w * TICK / 2, ds = Math.abs(v) * TICK;
  tp.x += v * Math.cos(mid) * TICK; tp.z += v * Math.sin(mid) * TICK; tp.th += w * TICK; ep.distance += ds;
  if (ep.drift && ds > 0) { const r = ep.streams.drift, q = Math.sqrt(ds); ep.bias.x += ep.drift.position * q * r.normal(); ep.bias.z += ep.drift.position * q * r.normal(); ep.bias.th += ep.drift.heading * q * r.normal(); }
  ep.estPose = {x: tp.x + ep.bias.x, z: tp.z + ep.bias.z, th: tp.th + ep.bias.th};
  const score = scoreFootprint(ep.truth, ep.platform, tp);
  if (score.clearance < ep.minClearance) ep.minClearance = score.clearance;
  if (score.contact) return finish(ep, 'contact', {with: score.contact});
  if (score.keepOut) return finish(ep, 'keep-out', {zone: score.keepOut});
  if (Math.hypot(tp.x - ep.goal.x, tp.z - ep.goal.z) <= 0.3) return finish(ep, 'reached');
  if (ep.noRouteSince !== null && ep.t - ep.noRouteSince >= 4 - 1e-9) return finish(ep, 'no-route', {lastFailure: ep.replans[ep.replans.length - 1]?.failure});
  // A controller that stops making progress gets one recovery (back away, or turn when the rear is closed), as
  // navigation stacks do; a robot that still has not moved after a long window is stuck.
  if (ep.t - ep.watch.t >= 3 - 1e-9) {
    const moved = Math.hypot(tp.x - ep.watch.x, tp.z - ep.watch.z);
    if (moved < 0.1 && ep.path && !ep.recovery && ep.t - ep.lastRecovery >= 6 - 1e-9) startRecovery(ep);
    ep.watch = {t: ep.t, x: tp.x, z: tp.z};
  }
  if (ep.t - ep.lastCheck.t >= 12 - 1e-9) { const moved = Math.hypot(tp.x - ep.lastCheck.x, tp.z - ep.lastCheck.z); if (moved < 0.15 && ep.path) return finish(ep, 'stuck'); ep.lastCheck = {t: ep.t, x: tp.x, z: tp.z}; }
  if (ep.t >= ep.maxSeconds) return finish(ep, 'timeout');
  return ep;
}
function circlesClear(ep, pose, slack = 0) {
  const {f, s, r} = ep.controller.circles, ct = Math.cos(pose.th), st = Math.sin(pose.th);
  for (let q = 0; q < f.length; q++) if (clearanceAt(ep.map, pose.x + ct * f[q] - st * s[q], pose.z + st * f[q] + ct * s[q]) < r + slack) return false;
  return true;
}
function startRecovery(ep) {
  const back = {...ep.estPose, x: ep.estPose.x - Math.cos(ep.estPose.th) * 0.25, z: ep.estPose.z - Math.sin(ep.estPose.th) * 0.25};
  let mode = 'wait', turn = 0;
  if (circlesClear(ep, back)) mode = 'back-up';
  else {
    const target = ep.path ? pointAt(ep.path, ep.path.s[ep.progress] + 1) : ep.goal, want = Math.atan2(target.z - ep.estPose.z, target.x - ep.estPose.x);
    turn = Math.sign(Math.atan2(Math.sin(want - ep.estPose.th), Math.cos(want - ep.estPose.th))) || 1;
    if (circlesClear(ep, {...ep.estPose, th: ep.estPose.th + turn * 0.3})) mode = 'turn';
  }
  ep.recovery = {mode, turn, until: round(ep.t + 1.5, 1)}; ep.recoveries++; ep.lastRecovery = ep.t;
  ep.events.push({t: ep.t, type: 'recovery', mode});
}
function recover(ep) {
  const R = ep.recovery, C = ep.controller; let v = 0, w = 0;
  if (R.mode === 'back-up') { const back = {...ep.estPose, x: ep.estPose.x - Math.cos(ep.estPose.th) * 0.1, z: ep.estPose.z - Math.sin(ep.estPose.th) * 0.1}; v = circlesClear(ep, back) ? -0.35 * C.vmax : 0; }
  else if (R.mode === 'turn') w = circlesClear(ep, {...ep.estPose, th: ep.estPose.th + R.turn * 0.1}) ? R.turn * 0.6 * C.wmax : 0;
  // Respect the same acceleration limits as the controller.
  v = Math.min(C.lastU.v + C.accel * TICK, Math.max(C.lastU.v - C.accel * TICK, v)); w = Math.min(C.lastU.w + C.alpha * TICK, Math.max(C.lastU.w - C.alpha * TICK, w));
  C.lastU = {v, w}; C.U.fill(0);
  if (ep.t >= R.until) { ep.recovery = null; replan(ep, 'recovery'); if (ep.path) updateProgress(ep); }
  return {v, w};
}
function dropCrate(ep) {
  const c = ep.crate;
  if (!ep.path) { c.skipped = 'No active route when the crate was due.'; ep.events.push({t: ep.t, type: 'crate-skipped', why: c.skipped}); return; }
  // Fair to fast and long robots: measured from the front bumper, at least 1.5 m and twice the stopping distance.
  const s0 = ep.path.s[ep.progress], remaining = ep.path.length - s0, stop = ep.platform.speed ** 2 / (2 * ep.controller.accel);
  const near = ep.platform.depth / 2 + CRATE.size / 2 + Math.max(1.5, 2 * stop), far = near + 1.4;
  if (remaining < near + 0.8) { c.skipped = 'The robot was too close to the goal when the crate was due.'; ep.events.push({t: ep.t, type: 'crate-skipped', why: c.skipped}); return; }
  const placed = placeOnRoute(ep.truth, ep.path, s0 + near, s0 + Math.min(far, remaining - 0.8), {w: CRATE.size, d: CRATE.size, h: CRATE.h}, ep.streams.perturb,
    [{...ep.truePose, r: ep.rc + 0.4}, {...ep.goal, r: ep.radius + 0.3}]);
  if (!placed) { c.skipped = 'No clear spot on the route ahead.'; ep.events.push({t: ep.t, type: 'crate-skipped', why: c.skipped}); return; }
  const n = ep.extras.filter(e => String(e.id).startsWith('crate')).length + 1;
  const box = {id: n === 1 ? 'crate' : `crate-${n}`, name: n === 1 ? 'Dropped crate' : `Dropped crate ${n}`, kind: 'obstacle', x0: placed.x0, z0: placed.z0, x1: placed.x1, z1: placed.z1, h: CRATE.h};
  ep.extras.push(box); ep.truth.boxes.push({...box, mapped: false});
  c.dropped = true; c.box = box; c.droppedAt = ep.t; c.aheadMetres = round(Math.hypot(placed.x - ep.truePose.x, placed.z - ep.truePose.z), 2);
  ep.events.push({t: ep.t, type: 'crate-drop', x: round(placed.x, 2), z: round(placed.z, 2), aheadMetres: c.aheadMetres});
}
function finish(ep, outcome, detail = {}) {
  ep.outcome = outcome; ep.events.push({t: ep.t, type: outcome, ...detail});
  return ep;
}
export function runEpisode(worldInput, options = {}) {
  const ep = createEpisode(worldInput, options);
  while (!ep.outcome) stepEpisode(ep);
  return episodeResult(ep);
}
export function episodeResult(ep) {
  const ms = ep.replans.map(r => r.ms + r.mapMs);
  return {outcome: ep.outcome, seconds: ep.t, distance: round(ep.distance, 2), referenceDistance: round(ep.referenceDistance, 2), start: {x: round(ep.start.x, 2), z: round(ep.start.z, 2)}, goal: {x: round(ep.goal.x, 2), z: round(ep.goal.z, 2)},
    minClearance: Number.isFinite(ep.minClearance) ? round(Math.max(0, ep.minClearance), 3) : null, replans: ep.replans.length, recoveries: ep.recoveries, replanMs: {max: ms.length ? round(Math.max(...ms), 2) : 0},
    crate: ep.crate ? (({box, ...c}) => c)(ep.crate) : null,
    mapError: ep.mapError ? {...ep.mapError} : null, blackout: ep.blackout ? {sensor: ep.blackout.sensor, from: ep.blackout.from, to: ep.blackout.to} : null, drift: ep.drift ? {finalErrorMetres: round(Math.hypot(ep.bias.x, ep.bias.z), 3)} : null,
    events: ep.events.slice(0, 80), replanLog: ep.replans.slice(0, 60)};
}

// ---------------------------------------------------------------------------------------------------------------
// Trials: the same tasks and seeds run twice, as a control and broken on purpose, so differences come from the
// perturbations rather than from easier or harder tasks.
export const DEFAULT_TRIAL = Object.freeze({episodes: 10, seed: 1, robot: 'cleaner', prior: true, sensors: {lidar: true, front: true, rear: true}, perturbations: {crate: true, mapError: true, blackout: false, drift: false}});
export function sampleTasks(world, robotKey, count, seed, {margin = 0.1, resolution = 0.04, referenceMap = null} = {}) {
  const platform = PLATFORMS[robotKey] || PLATFORMS.cleaner, radius = Math.hypot(platform.width, platform.depth) / 2 + margin;
  const map = referenceMap || createMap(world, {resolution, prior: true}), planner = makePlanner(map), tasks = [];
  const diag = Math.hypot(world.width, world.depth), minLeg = Math.min(5, 0.35 * diag);
  const free = (p) => clearanceAt(map, p.x, p.z) >= radius + 0.05;
  for (let i = 0; tasks.length < count && i < count * 40; i++) {
    const r = rng(mix(seed, 7, i));
    const start = i === 0 && free(world.start) ? {x: world.start.x, z: world.start.z} : {x: r() * world.width, z: r() * world.depth};
    if (!free(start)) continue;
    let made = null;
    for (let a = 0; a < 60 && !made; a++) {
      const goal = {x: r() * world.width, z: r() * world.depth};
      if (!free(goal) || Math.hypot(goal.x - start.x, goal.z - start.z) < minLeg) continue;
      const p = planPath(map, planner, start, goal, {radius});
      if (p.ok) made = {start: {x: round(start.x, 3), z: round(start.z, 3)}, goal: {x: round(goal.x, 3), z: round(goal.z, 3)}, referenceDistance: round(p.length, 2)};
    }
    if (made) tasks.push({index: tasks.length, seed: mix(seed, 11, tasks.length), ...made});
  }
  return tasks;
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [round(Math.max(0, c - h), 3), round(Math.min(1, c + h), 3)];
}
export function summarize(episodes) {
  const n = episodes.length, count = o => episodes.filter(e => e.outcome === o).length, reached = episodes.filter(e => e.outcome === 'reached');
  const allMs = episodes.flatMap(e => (e.replanLog || []).map(r => r.ms + r.mapMs));
  const crates = episodes.filter(e => e.crate?.dropped), gap = (a, b) => crates.filter(e => e.crate[a] !== null && e.crate[b] !== null).map(e => e.crate[b] - e.crate[a]);
  return {episodes: n, reached: reached.length, contacts: count('contact'), keepOut: count('keep-out'), noRoute: count('no-route'), stuck: count('stuck'), timeouts: count('timeout'),
    completion: {rate: n ? round(reached.length / n, 3) : 0, wilson95: wilson(reached.length, n)},
    medianSeconds: reached.length ? round(median(reached.map(e => e.seconds)), 1) : null,
    medianEfficiency: reached.length ? round(median(reached.map(e => e.referenceDistance / Math.max(e.distance, 1e-6))), 3) : null,
    replans: episodes.reduce((a, e) => a + e.replans, 0), recoveries: episodes.reduce((a, e) => a + (e.recoveries || 0), 0), replanMs: {p50: allMs.length ? round(quantile(allMs, 0.5), 2) : null, p95: allMs.length ? round(quantile(allMs, 0.95), 2) : null, max: allMs.length ? round(Math.max(...allMs), 2) : null},
    crates: {dropped: crates.length, skipped: episodes.filter(e => e.crate?.skipped).length, inMap: crates.filter(e => e.crate.inMapAt !== null).length,
      pathAffected: crates.filter(e => e.crate.pathAffected).length,
      medianSecondsDropToMap: gap('droppedAt', 'inMapAt').length ? round(median(gap('droppedAt', 'inMapAt')), 1) : null,
      medianSecondsMapToReplan: gap('inMapAt', 'replannedAt').length ? round(median(gap('inMapAt', 'replannedAt')), 1) : null,
      medianCrateReplanMs: crates.some(e => e.crate.replanMs !== null) ? round(median(crates.filter(e => e.crate.replanMs !== null).map(e => e.crate.replanMs)), 2) : null,
      contactsAfterDrop: crates.filter(e => e.outcome === 'contact').length},
    unmappedObjects: {placed: episodes.filter(e => e.mapError?.placed).length, detected: episodes.filter(e => e.mapError?.detectedAt !== null && e.mapError?.detectedAt !== undefined).length},
    minClearance: episodes.some(e => e.minClearance !== null) ? round(Math.min(...episodes.filter(e => e.minClearance !== null).map(e => e.minClearance)), 3) : null};
}
export async function sha256(text) {
  const bytes = new TextEncoder().encode(text), hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('');
}
const LIMITATIONS = [
  'Kinematic unicycle on a planar map at 10 Hz: no physics engine, wheel slip, legged gait, suspension or contact dynamics.',
  'Sensors are ray casts against the reviewed box geometry, configured from published field of view, range and noise figures. Reflectivity, multipath, motion blur, rolling shutter and the lidar\'s non-repetitive scan pattern are not modelled.',
  'Ground truth is the reviewed World v1 map plus the objects this trial added on purpose. Anything the reviewed map got wrong is wrong here too.',
  'Unknown and no-go areas are keep-out rules. Their contents were never observed, so they are not simulated as geometry.',
  'Replan milliseconds are wall-clock times on the device that ran the trial; other devices will differ.',
  'No real robot, learned policy or safety certification. A simulated pass is a reason to run a physical trial, not a substitute for one.',
];
/** Run the trial. `hooks.progress(done, total)` reports progress; `hooks.yield()` lets a page breathe between episodes. */
export async function runTrial(worldInput, options = {}, hooks = {}) {
  const world = prepareWorld(worldInput), o = {...DEFAULT_TRIAL, ...options, perturbations: options.perturbations ? {crate: false, mapError: false, blackout: false, drift: false, ...options.perturbations} : {...DEFAULT_TRIAL.perturbations}, sensors: {...DEFAULT_TRIAL.sensors, ...(options.sensors || {})}};
  const episodes = Math.max(1, Math.min(50, Math.floor(o.episodes))), seed = (o.seed >>> 0) || 1, robot = PLATFORMS[o.robot] ? o.robot : 'cleaner';
  const reference = createMap(world, {resolution: 0.04, prior: true});
  const tasks = sampleTasks(world, robot, episodes, seed, {referenceMap: reference});
  if (!tasks.length) throw new Error('No start and goal pair on this map fits this robot. Try a smaller robot or review the map.');
  const broken = Object.fromEntries(Object.entries(o.perturbations).filter(([k, v]) => ['crate', 'mapError', 'blackout', 'drift'].includes(k) && v === true));
  const conditions = [{id: 'control', label: 'Control', perturbations: {}}, {id: 'broken', label: 'Broken on purpose', perturbations: broken}];
  const results = [], total = tasks.length * conditions.length; let done = 0;
  for (const condition of conditions) for (const task of tasks) {
    const r = runEpisode(world, {preparedWorld: world, referenceMap: reference, robot, seed: task.seed, start: task.start, goal: task.goal, prior: o.prior !== false, sensors: o.sensors, density: 'trial', perturbations: condition.perturbations});
    results.push({condition: condition.id, task: task.index, seed: task.seed, ...r});
    done++; hooks.progress?.(done, total, results[results.length - 1]);
    if (hooks.yield) await hooks.yield();
  }
  const summary = Object.fromEntries(conditions.map(c => [c.id, summarize(results.filter(r => r.condition === c.id))]));
  const body = {schema: TRIAL_SCHEMA, loop: LOOP_VERSION, createdAt: new Date().toISOString(),
    world: {name: world.name, provenance: world.provenance, width: world.width, depth: world.depth, objects: world.objects.length, sha256: await sha256(JSON.stringify(world))}, worldSnapshot: clone(world),
    config: {robot, platform: {...PLATFORMS[robot]}, margin: 0.1, prior: o.prior !== false ? 'reviewed-map' : 'none', seed, episodes: tasks.length,
      sensors: sensorRig(robot, o.sensors, 'trial').map(s => ({id: s.id, label: s.label, spec: SENSOR_SPECS[s.spec].basis, rays: s.rays.length / 3, mountHeight: round(s.y, 2), ...(s.pitch ? {pitchDeg: round(s.pitch / DEG, 1)} : {})})),
      map: {resolution: reference.res, stepHeight: 0.05, logOdds: {hit: L_OCC, miss: L_FREE, occupied: OCC_ON}}, planner: 'A* 8-connected, octile heuristic, inflation cost, string-pulled', controller: 'MPPI, 96 samples, 2 s horizon, unicycle',
      perturbations: conditions[1].perturbations},
    conditions, tasks, episodes: results, summary,
    interpretation: interpret(summary, conditions[1].perturbations),
    claims: {physicsEngine: false, physicalRobotExecuted: false, learnedPolicyExecuted: false, safetyCertified: false, sensorModel: 'parameterized ray casting against reviewed geometry'},
    limitations: [...LIMITATIONS, ...(broken.drift ? ['Odometry drift is a random-walk pose error with no localization correction.'] : [])]};
  return {...body, integrity: {algorithm: 'SHA-256', scope: 'JSON.stringify(report without integrity)', value: await sha256(JSON.stringify(body)), authenticatesAuthor: false}};
}
function interpret(summary, perturbations) {
  const c = summary.control, b = summary.broken, names = {crate: 'a dropped crate', mapError: 'an object missing from the map', blackout: 'a front-camera blackout', drift: 'odometry drift'};
  const what = Object.keys(perturbations).map(k => names[k]).filter(Boolean);
  const failures = [b.contacts && `${b.contacts} contact${b.contacts === 1 ? '' : 's'}`, b.noRoute && `${b.noRoute} safe stop${b.noRoute === 1 ? '' : 's'} with no route`, b.keepOut && `${b.keepOut} keep-out intrusion${b.keepOut === 1 ? '' : 's'}`, b.stuck && `${b.stuck} stuck`, b.timeouts && `${b.timeouts} timeout${b.timeouts === 1 ? '' : 's'}`].filter(Boolean);
  return `${c.reached}/${c.episodes} runs reached the goal in control and ${b.reached}/${b.episodes} when broken on purpose${what.length ? ` with ${what.join(', ')}` : ''}.` + (failures.length ? ` Failures when broken: ${failures.join(', ')}.` : ' No failures when broken.') + ' Simulation on the reviewed map; no robot moved.';
}
export async function verifyTrialReport(report) {
  if (!report || report.schema !== TRIAL_SCHEMA || !report.integrity?.value) return {ok: false, reason: 'Not a BrainSNN autonomy trial report.'};
  const {integrity, ...body} = report, value = await sha256(JSON.stringify(body));
  return value === integrity.value ? {ok: true, value} : {ok: false, reason: 'The report changed after it was sealed: its SHA-256 no longer matches.', value};
}
