import { MAX_POINTS, STRIDE } from './visual-geometry.mjs';

const NEIGHBOUR_COUNT = 12;
const MAX_REGION_SAMPLES = 12_000;
const MAX_NEIGHBOUR_CHECKS = 800_000;
const MAX_COLOUR_DISTANCE_SQUARED = .34 ** 2;
const MIN_OPACITY = .04;

/** Suggest nearby, visually similar source samples connected to one picked centre. */
export function suggestObjectRegion(points, seed, { minY = -Infinity, maxY = Infinity, excluded = new Set() } = {}) {
  if (!(points instanceof Float32Array) || points.length % STRIDE || points.length / STRIDE > MAX_POINTS) {
    throw Error('Use a bounded buffer of retained appearance samples.');
  }
  const count = points.length / STRIDE;
  if (!Number.isInteger(seed) || seed < 0 || seed >= count) throw Error('Pick a retained sample in the view.');
  if (!(Number.isFinite(minY) || minY === -Infinity) || !(Number.isFinite(maxY) || maxY === Infinity) || minY > maxY) {
    throw Error('Use an ordered vertical selection range.');
  }
  const at = seed * STRIDE;
  const seedX = points[at], seedY = points[at + 1], seedZ = points[at + 2];
  const seedR = points[at + 6], seedG = points[at + 7], seedB = points[at + 8];
  if (excluded.has(seed) || seedY < minY || seedY > maxY || points[at + 9] < MIN_OPACITY) {
    return { indices: [], limited: false };
  }

  const closest = [], candidates = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const p = i * STRIDE;
    const x = points[p], y = points[p + 1], z = points[p + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw Error('Retained sample positions must be finite.');
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
    if (i === seed || y < minY || y > maxY || points[p + 9] < MIN_OPACITY || excluded.has(i)) continue;
    const colourDistance = (points[p + 6] - seedR) ** 2 + (points[p + 7] - seedG) ** 2 + (points[p + 8] - seedB) ** 2;
    if (!(colourDistance <= MAX_COLOUR_DISTANCE_SQUARED)) continue;
    const d2 = (x - seedX) ** 2 + (y - seedY) ** 2 + (z - seedZ) ** 2;
    candidates.push(i);
    if (d2 && (closest.length < NEIGHBOUR_COUNT || d2 < closest.at(-1).distanceSquared) &&
        !closest.some(record => record.x === x && record.y === y && record.z === z)) {
      closest.push({ distanceSquared: d2, x, y, z });
      closest.sort((a, b) => a.distanceSquared - b.distanceSquared);
      if (closest.length > NEIGHBOUR_COUNT) closest.pop();
    }
  }

  if (!closest.length) return { indices: [seed], limited: false };
  const span = Math.max(...max.map((value, axis) => value - min[axis]));
  const spacing = Math.sqrt(closest[Math.floor((closest.length - 1) * .67)].distanceSquared);
  const link = Math.min(2.3 * spacing, .18 * span);
  const reach = Math.min(24 * spacing, .38 * span);
  const linkSquared = link * link, reachSquared = reach * reach;
  const cellKey = (i, j, k) => `${i},${j},${k}`;
  const grid = new Map();
  for (const i of candidates) {
    const p = i * STRIDE;
    const x = points[p] - seedX, y = points[p + 1] - seedY, z = points[p + 2] - seedZ;
    if (x * x + y * y + z * z > reachSquared) continue;
    const key = cellKey(Math.floor(x / link), Math.floor(y / link), Math.floor(z / link));
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const indices = [seed];
  let checks = 0, limited = false;
  // Once a sample joins the queue it is removed from its bucket. Sparse regions
  // remain local, and very dense or ambiguous regions have a fixed work limit.
  search: for (let head = 0; head < indices.length; head++) {
    const p = indices[head] * STRIDE;
    const x = points[p], y = points[p + 1], z = points[p + 2];
    const i = Math.floor((x - seedX) / link), j = Math.floor((y - seedY) / link), k = Math.floor((z - seedZ) / link);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      const key = cellKey(i + di, j + dj, k + dk);
      const bucket = grid.get(key);
      if (!bucket) continue;
      let index = 0;
      while (index < bucket.length) {
        if (++checks > MAX_NEIGHBOUR_CHECKS || indices.length >= MAX_REGION_SAMPLES) {
          limited = true;
          break search;
        }
        const candidate = bucket[index], b = candidate * STRIDE;
        const dx = x - points[b], dy = y - points[b + 1], dz = z - points[b + 2];
        if (dx * dx + dy * dy + dz * dz > linkSquared) {
          index++;
          continue;
        }
        indices.push(candidate);
        bucket[index] = bucket.at(-1);
        bucket.pop();
      }
      if (!bucket.length) grid.delete(key);
    }
  }
  indices.sort((a, b) => a - b);
  return { indices, limited };
}
