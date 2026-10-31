/** Deterministic, bounded geometry planning. This module never executes a learned policy. */
import '../arena/site-core.js';
const siteCore=globalThis.BrainSNNSiteCore;
export const SCHEMA = 'brainsnn.world.v1';
// A five-minute walkthrough is about 0.3 GB at 1080p and 1 GB in 4K, so videos get their own limit. Files stay on the
// device until uploaded in chunks; none is read into memory whole.
export const LIMITS = Object.freeze({ file: 200 * 1024 ** 2, video: 2 * 1024 ** 3, videoSeconds: 300, session: 4 * 1024 ** 3, json: 2 * 1024 ** 2, objects: 128, cells: 6000, sources: 12 });
export const ROBOTS = Object.freeze({
  cleaner: { name: 'Cleaning robot', width: 0.58, depth: 0.68, speed: 0.3 },
  vacuum: { name: 'Robot vacuum', width: 0.35, depth: 0.35, speed: 0.3 },
  amr: { name: 'Mobile robot', width: 0.85, depth: 1.0, speed: 0.5 },
  humanoid: { name: 'Humanoid envelope', width: 0.7, depth: 0.6, speed: 0.4 },
});
export const clone = value => JSON.parse(JSON.stringify(value));
export function numeric(value, min, max, name = 'Value') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}
export const label = (value, fallback = '') => (typeof value === 'string' ? value : fallback).slice(0, 160);
export function normalizeWorld(input) {
  if (!input || input.schema !== SCHEMA) throw new Error('Import a BrainSNN World v1 map. Export the sample to see its format.');
  const width = numeric(input.width, 1, 80, 'Floor width'), depth = numeric(input.depth, 1, 80, 'Floor depth');
  if (!Array.isArray(input.objects) || input.objects.length > LIMITS.objects) throw new Error('Use an objects array with at most 128 entries.');
  const ids = new Set();
  const objects = input.objects.map((o, i) => {
    if (!o || typeof o !== 'object') throw new Error('Invalid object.');
    const id = label(o.id, `object-${i}`);
    if (!id || ids.has(id)) throw new Error('Object identifiers must be unique.');
    ids.add(id);
    const w = numeric(o.w, 0.02, width, 'Object width'), d = numeric(o.d, 0.02, depth, 'Object depth');
    return { id, name: label(o.name, 'Obstacle'), x: numeric(o.x, 0, width - w + 1e-8, 'Object X'), z: numeric(o.z, 0, depth - d + 1e-8, 'Object Z'), w, d, h: numeric(o.h ?? 1, 0, 20, 'Object height'), kind: ['obstacle', 'unknown', 'no-go'].includes(o.kind) ? o.kind : 'obstacle', note: label(o.note) };
  });
  const provenance = ['authored', 'observed', 'generated'].includes(input.provenance) ? input.provenance : 'observed';
  const floor=input.floor===undefined?undefined:siteCore.normalizeScene({width,depth,floor:input.floor,obstacles:[]}).floor;
  const source=input.geometrySource;
  return { schema: SCHEMA, name: label(input.name, 'Untitled world'), width, depth, objects, provenance,
    ...(floor?{floor}:{}),
    ...(source&&typeof source==='object'?{geometrySource:{kind:label(source.kind),name:label(source.name),warnings:Array.isArray(source.warnings)?source.warnings.slice(0,16).map(v=>label(v)):[]}}:{}),
    scaleReviewed: input.scaleReviewed === true && provenance !== 'generated', mapReviewed: input.mapReviewed === true && provenance !== 'generated',
    start: { x: numeric(input.start?.x ?? Math.min(1, width / 2), 0, width, 'Start X'), z: numeric(input.start?.z ?? Math.min(1, depth / 2), 0, depth, 'Start Z') } };
}
export function sampleWorld() {
  return normalizeWorld({ schema: SCHEMA, name: 'Studio 01 / training floor', width: 18, depth: 13, provenance: 'authored', scaleReviewed: true, mapReviewed: true, start: { x: 1, z: 1 }, objects: [
    { id: 'rack-a', name: 'Equipment bank A', x: 3, z: 2, w: 2.8, d: 0.9, h: 1.45 },
    { id: 'rack-b', name: 'Equipment bank B', x: 7, z: 2, w: 2.8, d: 0.9, h: 1.45 },
    { id: 'rack-c', name: 'Equipment bank C', x: 11, z: 2, w: 2.8, d: 0.9, h: 1.45 },
    { id: 'mat-a', name: 'Training island', x: 4, z: 6, w: 2.5, d: 2.1, h: 0.12 },
    { id: 'mat-b', name: 'Training island B', x: 8, z: 6, w: 2.5, d: 2.1, h: 0.12 },
    { id: 'storage', name: 'Storage / movable', x: 14.5, z: 7, w: 2, d: 3, h: 2 },
    { id: 'unknown-1', name: 'Occluded corner', x: 0.2, z: 10, w: 2.6, d: 2.8, h: 0.04, kind: 'unknown', note: 'Authored example of an area that needs another view.' },
  ] });
}
export function planningGate(world) {
  if (!world) return 'A photo is not a collision map. Import or create reviewed geometry first.';
  if (world.provenance === 'generated') return 'Generated worlds are visual hypotheses, not observed collision geometry.';
  if (!world.scaleReviewed) return 'Confirm independently measured scale and critical clearances.';
  if (!world.mapReviewed) return 'Review obstacles, unknown areas and the start position.';
  return null;
}
// A blocked start is a dead end unless the reviewer learns what fits: the nearest spot for this robot or, when
// none exists, the widest square robot any spot fits at this margin. Both use the planner's own inflation.
function startBlocked(world, robot, { cell, n, point, blocked, free }) {
  const pad = cell * Math.SQRT2 / 2, away = p => Math.hypot(p.x - world.start.x, p.z - world.start.z), at = p => `X ${p.x.toFixed(2)} m, Z ${p.z.toFixed(2)} m`;
  let spot = null;
  for (let i = 0; i < n; i++) if (free[i] && (!spot || away(point(i)) < away(spot))) spot = point(i);
  if (spot) return Object.assign(new Error(`The start is blocked at this robot size and margin. The nearest spot where it fits is ${at(spot)}: move the start there or review the geometry.`), { advice: { start: spot } });
  // The largest clearance any cell centre has, bisected on the same blocked() test the planner uses.
  let best = null, clear = 0;
  for (let i = 0; i < n; i++) {
    const p = point(i); if (blocked(p, clear)) continue;
    let lo = clear, hi = Math.max(world.width, world.depth);
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (blocked(p, mid)) hi = mid; else lo = mid; }
    if (!best || lo > clear) { best = p; clear = lo; }
  }
  const size = best ? Math.floor(Math.SQRT2 * (clear - pad - robot.margin) * 20) / 20 : 0, envelope = `${robot.width} × ${robot.depth} m robot with a ${robot.margin} m margin`;
  if (size < 0.1) return Object.assign(new Error(`The start is blocked: no spot in this map fits a ${envelope}, or any robot at that margin. Review unknown areas and obstacles, check the scale, or capture more open floor.`), { advice: null });
  return Object.assign(new Error(`The start is blocked: no spot in this map fits a ${envelope}. The most open spot, ${at(best)}, fits a robot up to about ${size.toFixed(2)} × ${size.toFixed(2)} m at that margin. Use a smaller envelope or margin, check the scale with a measured distance, or capture more open floor.`), { advice: { start: best, size } });
}
// The planning grid both planners share: cells, the inflated obstacles they avoid and the start cell, so a route to a
// chosen goal is held to the same clearances as the coverage preview.
function planningGrid(world, robot) {
  // A finer grid inflates less (half a cell diagonal), so room-sized maps keep their real corridors; large maps
  // still coarsen to stay within LIMITS.cells.
  let cell = Math.max(0.1, Math.sqrt(world.width * world.depth / LIMITS.cells));
  while (Math.ceil(world.width / cell) * Math.ceil(world.depth / cell) > LIMITS.cells) cell *= 1.01;
  const nx = Math.ceil(world.width / cell), nz = Math.ceil(world.depth / cell), n = nx * nz;
  const radius = Math.hypot(robot.width, robot.depth) / 2 + robot.margin;
  // Inflate by half a cell diagonal so every adjacent route segment is conservative.
  const padding = radius + cell * Math.SQRT2 / 2;
  const floorScene=world.floor?{floor:world.floor,obstacles:[]}:null;
  const blocked = (p, r) => p.x < r || p.z < r || p.x > world.width - r || p.z > world.depth - r || (floorScene&&!siteCore.pointClear([p.x,p.z],floorScene,r)) || world.objects.some(o => p.x >= o.x - r && p.x <= o.x + o.w + r && p.z >= o.z - r && p.z <= o.z + o.d + r);
  const point = index => ({ x: (index % nx + 0.5) * cell, z: (Math.floor(index / nx) + 0.5) * cell });
  const free = new Uint8Array(n); let freeCount = 0;
  for (let i = 0; i < n; i++) if (!blocked(point(i), padding)) { free[i] = 1; freeCount++; }
  const sx = Math.floor(world.start.x / cell), sz = Math.floor(world.start.z / cell), start = sz * nx + sx;
  if (sx >= nx || sz >= nz || !free[start] || blocked(world.start, radius)) throw startBlocked(world, robot, { cell, n, point, blocked, free });
  return { cell, nx, nz, n, radius, padding, blocked, point, free, freeCount, start };
}
export function planWorld(input, robotInput) {
  const world = normalizeWorld(input), error = planningGate(world);
  if (error) throw new Error(error);
  const robot = { width: numeric(robotInput.width, 0.1, 5, 'Robot width'), depth: numeric(robotInput.depth, 0.1, 5, 'Robot depth'), speed: numeric(robotInput.speed, 0.01, 3, 'Robot speed'), margin: numeric(robotInput.margin ?? 0.1, 0, 2, 'Clearance margin') };
  const { cell, nx, nz, n, point, free, freeCount, start } = planningGrid(world, robot);
  const visited = new Uint8Array(n), stack = [start], order = [start]; visited[start] = 1;
  let reached = 1;
  while (stack.length) {
    const current = stack[stack.length - 1], x = current % nx, z = Math.floor(current / nx);
    const neighbours = [x + 1 < nx ? current + 1 : -1, z + 1 < nz ? current + nx : -1, x > 0 ? current - 1 : -1, z > 0 ? current - nx : -1];
    const next = neighbours.find(j => j >= 0 && free[j] && !visited[j]);
    if (next !== undefined) { visited[next] = 1; reached++; stack.push(next); order.push(next); }
    else { stack.pop(); if (stack.length) order.push(stack[stack.length - 1]); }
  }
  const route = [world.start, ...order.map(point)].filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.z - a[i - 1].z) > 1e-8);
  let distance = 0, turns = 0, prior = null;
  for (let i = 1; i < route.length; i++) {
    const dx = route[i].x - route[i - 1].x, dz = route[i].z - route[i - 1].z, angle = Math.atan2(dz, dx);
    distance += Math.hypot(dx, dz); if (prior !== null && Math.abs(Math.atan2(Math.sin(angle - prior), Math.cos(angle - prior))) > 0.1) turns++;
    prior = angle;
  }
  return { algorithm: 'conservative-grid-dfs-v1', basis: world.provenance, cell, route, distance, travelSeconds: distance / robot.speed, turns, reachableArea: reached * cell * cell, unreachableArea: (freeCount - reached) * cell * cell, robot, policyExecuted: false, safetyCertified: false,
    limitations: ['Planar circumscribed-circle footprint with in-place turns; no robot dynamics.', 'Conservative contiguous traversal, not an optimized coverage controller.', 'Reachable centre-grid area does not measure cleaning quality.', 'Unknown regions are blocked. Appearance is not collision geometry.'] };
}
/** A shortest route from the start to a goal on planWorld's conservative grid (4-connected, same inflated obstacles).
 *  The goal must lie in clear floor the start can reach; otherwise it says why, as planWorld does for the start. */
export function routeWorld(input, robotInput, goalInput) {
  const world = normalizeWorld(input), error = planningGate(world);
  if (error) throw new Error(error);
  const robot = { width: numeric(robotInput.width, 0.1, 5, 'Robot width'), depth: numeric(robotInput.depth, 0.1, 5, 'Robot depth'), speed: numeric(robotInput.speed, 0.01, 3, 'Robot speed'), margin: numeric(robotInput.margin ?? 0.1, 0, 2, 'Clearance margin') };
  const goal = { x: numeric(goalInput?.x, 0, world.width, 'Goal x'), z: numeric(goalInput?.z, 0, world.depth, 'Goal z') };
  const { cell, nx, nz, n, radius, blocked, point, free, start } = planningGrid(world, robot);
  const gx = Math.floor(goal.x / cell), gz = Math.floor(goal.z / cell), target = gz * nx + gx;
  if (gx >= nx || gz >= nz || !free[target] || blocked(goal, radius)) throw new Error('That spot is too close to an obstacle, a wall or unknown space for this robot. Choose open floor.');
  // Breadth-first search finds the fewest cells on a uniform 4-connected grid, which is the shortest route here.
  const previous = new Int32Array(n).fill(-1), queue = new Int32Array(n); let head = 0, tail = 0;
  previous[start] = start; queue[tail++] = start;
  while (head < tail && previous[target] < 0) {
    const current = queue[head++], x = current % nx, z = Math.floor(current / nx);
    for (const next of [x + 1 < nx ? current + 1 : -1, z + 1 < nz ? current + nx : -1, x > 0 ? current - 1 : -1, z > 0 ? current - nx : -1])
      if (next >= 0 && free[next] && previous[next] < 0) { previous[next] = current; queue[tail++] = next; }
  }
  if (previous[target] < 0) throw new Error('No route reaches that spot with this robot: it is cut off by obstacles or unknown space.');
  const cells = [target]; while (cells[cells.length - 1] !== start) cells.push(previous[cells[cells.length - 1]]);
  const route = [world.start, ...cells.reverse().map(point), goal].filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.z - a[i - 1].z) > 1e-8);
  let distance = 0, turns = 0, prior = null;
  for (let i = 1; i < route.length; i++) {
    const dx = route[i].x - route[i - 1].x, dz = route[i].z - route[i - 1].z, angle = Math.atan2(dz, dx);
    distance += Math.hypot(dx, dz); if (prior !== null && Math.abs(Math.atan2(Math.sin(angle - prior), Math.cos(angle - prior))) > 0.1) turns++;
    prior = angle;
  }
  return { algorithm: 'conservative-grid-bfs-route-v1', basis: world.provenance, cell, route, goal, distance, travelSeconds: distance / robot.speed, turns,
    reachableArea: tail * cell * cell, unreachableArea: 0, robot, policyExecuted: false, safetyCertified: false,
    limitations: ['Planar circumscribed-circle footprint with in-place turns; no robot dynamics.', 'Shortest route on a 4-connected grid; real robots smooth corners.', 'Unknown regions are blocked. Appearance is not collision geometry.'] };
}
export function estimate(result, values) {
  const setupMinutes = numeric(values.setupMinutes ?? 0, 0, 240, 'Setup minutes'), turnSeconds = numeric(values.turnSeconds ?? 0, 0, 120, 'Seconds per turn'), assistanceMinutes = numeric(values.assistanceMinutes ?? 0, 0, 240, 'Assistance minutes');
  const minutes = result.travelSeconds / 60 + result.turns * turnSeconds / 60 + setupMinutes + assistanceMinutes;
  const rate = (v, key) => v === null || v === undefined || v === '' ? null : numeric(v, 0, 10000, key);
  const robotRate = rate(values.robotRate, 'Robot hourly cost'), labourRate = rate(values.labourRate, 'Labour hourly cost');
  return { minutes, assistanceMinutes, cost: robotRate === null || labourRate === null ? null : minutes / 60 * robotRate + (setupMinutes + assistanceMinutes) / 60 * labourRate, currency: 'CAD', assumptions: { setupMinutes, turnSeconds, assistanceMinutes, robotRate, labourRate }, measured: false };
}
// A phone can hand over a file whose name has no usual extension; its media type then decides.
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'mp4' };
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function extensionOf(file) {
  const named = file.name.includes('.') ? file.name.toLowerCase().split('.').pop() : '';
  if (['mp4', 'mov', 'webm', 'jpg', 'jpeg', 'png', 'webp', 'json', 'ply', 'splat', 'spz', 'ksplat', 'glb', 'heic', 'heif'].includes(named)) return named;
  return VIDEO_TYPES[file.type] || IMAGE_TYPES[file.type] || named;
}
/** The name to give the worker: the file's own name, with the extension its media type implies when it has none. */
export function uploadName(file) {
  const ext = extensionOf(file), named = file.name.toLowerCase().split('.').pop();
  return file.name.includes('.') && named === ext ? file.name : `${file.name || 'capture'}.${ext}`;
}
export function classifyFile(file) {
  if (!file || !file.size) throw new Error('Choose a non-empty file.');
  const ext = extensionOf(file);
  if (['mp4', 'mov', 'webm'].includes(ext)) {
    if (file.size > LIMITS.video) throw new Error('Videos can be up to 2 GiB. Record at 1080p, or keep the walk under five minutes.');
    return 'video';
  }
  if (file.size > LIMITS.file) throw new Error('Choose a file up to 200 MiB (videos up to 2 GiB).');
  if (ext === 'json') { if (file.size > LIMITS.json) throw new Error('Map JSON must be at most 2 MiB.'); return 'map'; }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (['ply', 'splat', 'spz', 'ksplat', 'glb'].includes(ext)) return 'visual';
  throw new Error(`${file.name}${file.type ? ` (${file.type})` : ''} is not a supported file. Use JPG, PNG, WebP, MP4, MOV, WebM, GLB, PLY, SPLAT, SPZ or a World v1 map. Convert HEIC to JPEG first.`);
}
export function workerURL(value) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('Use an HTTPS worker URL, or localhost for development.');
  return u.href.replace(/\/+$/, '');
}
export function arenaMap(input) {
  const w = normalizeWorld(input), gate = planningGate(w); if (gate) throw new Error(gate);
  return { schemaVersion: 'brainsnn.site.v1', name: w.name, width: w.width, depth: w.depth, units: 'm', scaleConfirmed: w.scaleReviewed && w.mapReviewed,
    floor: w.floor || [[0, 0], [w.width, 0], [w.width, w.depth], [0, w.depth]], start: [w.start.x, w.start.z], goal: [w.start.x, w.start.z],
    obstacles: w.objects.map(o => ({ id: o.id, label: `${o.name} [${o.kind}]`, x: o.x + o.w / 2, z: o.z + o.d / 2, width: o.w, depth: o.d, height: Math.max(0.02, o.h) })),
    source: { kind: w.provenance === 'authored' ? 'sample' : w.geometrySource?.kind||'manual', name: w.geometrySource?.name||w.name, warnings: ['World Builder reviewed-map export. All unknown regions remain obstacles.', 'This export does not transfer learned policies or prove robot safety.',...(w.geometrySource?.warnings||[])] } };
}
export function usdScene(input) {
  const w = normalizeWorld(input), gate = planningGate(w); if (gate) throw new Error(gate);
  if(w.floor){
    const corners=new Set(w.floor.map(p=>p.join(',')));
    if(w.floor.length!==4||![[0,0],[w.width,0],[w.width,w.depth],[0,w.depth]].every(p=>corners.has(p.join(','))))throw new Error('OpenUSD export currently supports rectangular floors only. Export the polygon-preserving Arena map or World JSON for this scan.');
  }
  const cube = (id, x, y, z, sx, sy, sz) => `    def Cube "${id}" (prepend apiSchemas = ["PhysicsCollisionAPI"]) {\n        double size = 1\n        double3 xformOp:translate = (${x}, ${y}, ${z})\n        double3 xformOp:scale = (${sx}, ${sy}, ${sz})\n        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]\n    }`;
  return `#usda 1.0\n(\n    defaultPrim = "World"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n# Reviewed static proxy geometry, not a qualified robotics simulation.\ndef Xform "World" {\n${cube('Floor', w.width / 2, -0.05, w.depth / 2, w.width, 0.1, w.depth)}\n${w.objects.map((o, i) => cube(`Obstacle_${i}`, o.x + o.w / 2, Math.max(.02, o.h) / 2, o.z + o.d / 2, o.w, Math.max(.02, o.h), o.d)).join('\n')}\n}\n`;
}
export async function proofPack(world, result, assumptions, sources = [], events = [], observations = [], geometryEvidence = null) {
  const normalizedWorld = world ? normalizeWorld(world) : null;
  const body = { schema: 'brainsnn.proof.v1', createdAt: new Date().toISOString(), world: normalizedWorld, result: result ? clone(result) : null, estimate: result ? estimate(result, assumptions) : null, sources: sources.map(s => ({ name: label(s.name), size: s.size, kind: s.kind, ...(s.derivation ? {derivation: clone(s.derivation)} : {}) })), events: clone(events.slice(-200)), ...(observations.length?{observations:clone(observations)}:{}), claim: 'Planning preview; no real robot or learned policy executed.', signature: null };
  if(geometryEvidence)body.geometryEvidence=await (await import('./measurement-evidence.mjs')).exportGeometryEvidence(geometryEvidence,normalizedWorld);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  return { ...body, integrity: { algorithm: 'SHA-256', scope: 'JSON.stringify(body) before integrity property', value: Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join(''), authenticatesAuthor: false } };
}
