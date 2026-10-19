/** Deterministic, bounded geometry planning. This module never executes a learned policy. */
export const SCHEMA = 'brainsnn.world.v1';
export const LIMITS = Object.freeze({ file: 200 * 1024 ** 2, json: 2 * 1024 ** 2, objects: 128, cells: 6000, sources: 12 });
export const ROBOTS = Object.freeze({
  cleaner: { name: 'Cleaning robot', width: 0.58, depth: 0.68, speed: 0.3 },
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
    const w = numeric(o.w, 0.05, width, 'Object width'), d = numeric(o.d, 0.05, depth, 'Object depth');
    return { id, name: label(o.name, 'Obstacle'), x: numeric(o.x, 0, width - w + 1e-8, 'Object X'), z: numeric(o.z, 0, depth - d + 1e-8, 'Object Z'), w, d, h: numeric(o.h ?? 1, 0, 10, 'Object height'), kind: ['obstacle', 'unknown', 'no-go'].includes(o.kind) ? o.kind : 'obstacle', note: label(o.note) };
  });
  const provenance = ['authored', 'observed', 'generated'].includes(input.provenance) ? input.provenance : 'observed';
  return { schema: SCHEMA, name: label(input.name, 'Untitled world'), width, depth, objects, provenance,
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
export function planWorld(input, robotInput) {
  const world = normalizeWorld(input), error = planningGate(world);
  if (error) throw new Error(error);
  const robot = { width: numeric(robotInput.width, 0.1, 5, 'Robot width'), depth: numeric(robotInput.depth, 0.1, 5, 'Robot depth'), speed: numeric(robotInput.speed, 0.01, 3, 'Robot speed'), margin: numeric(robotInput.margin ?? 0.1, 0, 2, 'Clearance margin') };
  let cell = Math.max(0.25, Math.sqrt(world.width * world.depth / LIMITS.cells));
  while (Math.ceil(world.width / cell) * Math.ceil(world.depth / cell) > LIMITS.cells) cell *= 1.01;
  const nx = Math.ceil(world.width / cell), nz = Math.ceil(world.depth / cell), n = nx * nz;
  const radius = Math.hypot(robot.width, robot.depth) / 2 + robot.margin;
  // Inflate by half a cell diagonal so every adjacent route segment is conservative.
  const padding = radius + cell * Math.SQRT2 / 2;
  const blocked = (p, r) => p.x < r || p.z < r || p.x > world.width - r || p.z > world.depth - r || world.objects.some(o => p.x >= o.x - r && p.x <= o.x + o.w + r && p.z >= o.z - r && p.z <= o.z + o.d + r);
  const point = index => ({ x: (index % nx + 0.5) * cell, z: (Math.floor(index / nx) + 0.5) * cell });
  const free = new Uint8Array(n); let freeCount = 0;
  for (let i = 0; i < n; i++) if (!blocked(point(i), padding)) { free[i] = 1; freeCount++; }
  const sx = Math.floor(world.start.x / cell), sz = Math.floor(world.start.z / cell), start = sz * nx + sx;
  if (sx >= nx || sz >= nz || !free[start] || blocked(world.start, radius)) throw new Error('The start is blocked at this robot size and margin. Move the start or review the geometry.');
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
export function estimate(result, values) {
  const setupMinutes = numeric(values.setupMinutes ?? 0, 0, 240, 'Setup minutes'), turnSeconds = numeric(values.turnSeconds ?? 0, 0, 120, 'Seconds per turn'), assistanceMinutes = numeric(values.assistanceMinutes ?? 0, 0, 240, 'Assistance minutes');
  const minutes = result.travelSeconds / 60 + result.turns * turnSeconds / 60 + setupMinutes + assistanceMinutes;
  const rate = (v, key) => v === null || v === undefined || v === '' ? null : numeric(v, 0, 10000, key);
  const robotRate = rate(values.robotRate, 'Robot hourly cost'), labourRate = rate(values.labourRate, 'Labour hourly cost');
  return { minutes, assistanceMinutes, cost: robotRate === null || labourRate === null ? null : minutes / 60 * robotRate + (setupMinutes + assistanceMinutes) / 60 * labourRate, currency: 'CAD', assumptions: { setupMinutes, turnSeconds, assistanceMinutes, robotRate, labourRate }, measured: false };
}
export function classifyFile(file) {
  if (!file || !file.size || file.size > LIMITS.file) throw new Error('Choose a non-empty file up to 200 MiB.');
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'json') { if (file.size > LIMITS.json) throw new Error('Map JSON must be at most 2 MiB.'); return 'map'; }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video';
  if (['ply', 'splat', 'spz', 'ksplat', 'glb'].includes(ext)) return 'visual';
  throw new Error('Use JPG, PNG, WebP, MP4, MOV, WebM, GLB, PLY, SPLAT, SPZ or a World v1 map. Convert HEIC to JPEG first.');
}
export function workerURL(value) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('Use an HTTPS worker URL, or localhost for development.');
  return u.href.replace(/\/+$/, '');
}
export function arenaMap(input) {
  const w = normalizeWorld(input), gate = planningGate(w); if (gate) throw new Error(gate);
  return { schemaVersion: 'brainsnn.site.v1', name: w.name, width: w.width, depth: w.depth, units: 'm', scaleConfirmed: w.scaleReviewed && w.mapReviewed,
    floor: [[0, 0], [w.width, 0], [w.width, w.depth], [0, w.depth]], start: [w.start.x, w.start.z], goal: [w.start.x, w.start.z],
    obstacles: w.objects.map(o => ({ id: o.id, label: `${o.name} [${o.kind}]`, x: o.x + o.w / 2, z: o.z + o.d / 2, width: o.w, depth: o.d, height: Math.max(0.02, o.h) })),
    source: { kind: w.provenance === 'authored' ? 'sample' : 'manual', name: w.name, warnings: ['World Studio reviewed-map export. All unknown regions remain obstacles.', 'This export does not transfer learned policies or prove robot safety.'] } };
}
export function usdScene(input) {
  const w = normalizeWorld(input), gate = planningGate(w); if (gate) throw new Error(gate);
  const cube = (id, x, y, z, sx, sy, sz) => `    def Cube "${id}" (prepend apiSchemas = ["PhysicsCollisionAPI"]) {\n        double size = 1\n        double3 xformOp:translate = (${x}, ${y}, ${z})\n        double3 xformOp:scale = (${sx}, ${sy}, ${sz})\n        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]\n    }`;
  return `#usda 1.0\n(\n    defaultPrim = "World"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n# Reviewed static proxy geometry, not a qualified robotics simulation.\ndef Xform "World" {\n${cube('Floor', w.width / 2, -0.05, w.depth / 2, w.width, 0.1, w.depth)}\n${w.objects.map((o, i) => cube(`Obstacle_${i}`, o.x + o.w / 2, Math.max(.02, o.h) / 2, o.z + o.d / 2, o.w, Math.max(.02, o.h), o.d)).join('\n')}\n}\n`;
}
export async function proofPack(world, result, assumptions, sources = [], events = []) {
  const body = { schema: 'brainsnn.proof.v1', createdAt: new Date().toISOString(), world: world ? normalizeWorld(world) : null, result, estimate: result ? estimate(result, assumptions) : null, sources: sources.map(s => ({ name: label(s.name), size: s.size, kind: s.kind })), events: events.slice(-200), claim: 'Planning preview; no real robot or learned policy executed.', signature: null };
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  return { ...body, integrity: { algorithm: 'SHA-256', scope: 'JSON.stringify(body) before integrity property', value: Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join(''), authenticatesAuthor: false } };
}
