// The developer platform's "drop a box" toy: the same planning rules as robotics/world_worker/world_update.py
// (footprint inflation, 8-connected A* without corner cutting, line-of-sight waypoints, outcome names), on a small grid
// in the browser. A toy for feeling how footprints change routes; the real loop runs on recorded walks.

export function grid(width, height) {
  const cells = new Uint8Array(width * height);
  for (let i = 0; i < width; i++) { cells[i] = 1; cells[(height - 1) * width + i] = 1; }
  for (let j = 0; j < height; j++) { cells[j * width] = 1; cells[j * width + width - 1] = 1; }
  return { width, height, cells };
}

export function setBox(g, x, y, w, h, value = 1) {
  for (let j = Math.max(0, y); j < Math.min(g.height, y + h); j++) {
    for (let i = Math.max(0, x); i < Math.min(g.width, x + w); i++) g.cells[j * g.width + i] = value;
  }
}

/** Occupied cells grown by a disc of `radius` cells. */
export function inflate(g, radius) {
  const out = new Uint8Array(g.cells.length), r = Math.ceil(radius), r2 = radius * radius;
  for (let j = 0; j < g.height; j++) for (let i = 0; i < g.width; i++) {
    if (!g.cells[j * g.width + i]) continue;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (di * di + dj * dj > r2) continue;
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < g.width && b < g.height) out[b * g.width + a] = 1;
    }
  }
  return { width: g.width, height: g.height, cells: out };
}

/** 8-connected A*, octile heuristic, no corner cutting. Returns [[x, y], ...] or null. */
export function astar(blocked, start, goal) {
  const { width, height, cells } = blocked;
  const index = ([x, y]) => y * width + x;
  if (cells[index(start)] || cells[index(goal)]) return null;
  const h = (x, y) => { const dx = Math.abs(x - goal[0]), dy = Math.abs(y - goal[1]); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
  const best = new Float64Array(cells.length).fill(Infinity), parent = new Int32Array(cells.length).fill(-1);
  const heap = [];
  const push = (f, g, i) => {
    heap.push([f, g, i]);
    for (let n = heap.length - 1; n > 0;) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let n = 0; ;) {
        const l = 2 * n + 1, r = l + 1; let m = n;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m;
      }
    }
    return top;
  };
  const s = index(start), t = index(goal);
  best[s] = 0; push(h(...start), 0, s);
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const [, cost, i] = pop();
    if (i === t) {
      const path = [];
      for (let n = i; n !== -1; n = parent[n]) path.push([n % width, Math.floor(n / width)]);
      return path.reverse();
    }
    if (cost > best[i]) continue;
    const x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of steps) {
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= width || b >= height || cells[b * width + a]) continue;
      if (dx && dy && (cells[y * width + a] || cells[b * width + x])) continue;
      const step = cost + (dx && dy ? Math.SQRT2 : 1), n = b * width + a;
      if (step < best[n]) { best[n] = step; parent[n] = i; push(step + h(a, b), step, n); }
    }
  }
  return null;
}

export function lineFree(blocked, a, b) {
  const steps = Math.ceil(4 * Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
  for (let k = 0; k <= steps; k++) {
    const x = Math.round(a[0] + (b[0] - a[0]) * k / steps), y = Math.round(a[1] + (b[1] - a[1]) * k / steps);
    if (blocked.cells[y * blocked.width + x]) return false;
  }
  return true;
}

export function simplify(path, blocked) {
  if (!path || path.length < 3) return path;
  const out = [path[0]];
  for (let i = 0; i < path.length - 1;) {
    let j = path.length - 1;
    while (j > i + 1 && !lineFree(blocked, path[i], path[j])) j--;
    out.push(path[j]); i = j;
  }
  return out;
}

export const length = path => (path || []).slice(1).reduce((sum, p, k) => sum + Math.hypot(p[0] - path[k][0], p[1] - path[k][1]), 0);

/** The world_update.py outcomes for one robot: unchanged, shortened, opened, rerouted, blocked, no-route-before. */
/** Whether a cell path is still drivable under astar's rules: every cell free and no diagonal step cutting a blocked corner. */
export function pathFree(blocked, path) {
  const at = (x, y) => blocked.cells[y * blocked.width + x];
  for (let k = 0; k < path.length; k++) {
    const [x, y] = path[k];
    if (at(x, y)) return false;
    if (k && path[k - 1][0] !== x && path[k - 1][1] !== y && (at(x, path[k - 1][1]) || at(path[k - 1][0], y))) return false;
  }
  return true;
}

export function plan(before, after, radius, start, goal) {
  const b = inflate(before, radius), a = inflate(after, radius);
  const was = astar(b, start, goal);
  if (!was) { const now = astar(a, start, goal); return { outcome: now ? 'opened' : 'no-route-before', before: null, after: simplify(now, a) }; }
  if (pathFree(a, was)) {
    const now = astar(a, start, goal);
    if (now && length(now) < length(was) - 1) return { outcome: 'shortened', before: simplify(was, b), after: simplify(now, a) };
    return { outcome: 'unchanged', before: simplify(was, b), after: simplify(was, b) };
  }
  const now = astar(a, start, goal);
  return { outcome: now ? 'rerouted' : 'blocked', before: simplify(was, b), after: simplify(now, a) };
}
