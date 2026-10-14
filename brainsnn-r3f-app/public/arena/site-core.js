/* BrainSNN site planner. Coordinates are metres, x/z from the floor bounding-box origin.
 * A bounded geometric planning approximation, never a robot dynamics or policy simulator. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BrainSNNSiteCore = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var SCHEMA = 'brainsnn.site.v1', EPS = 1e-8, MAX_CELLS = 4096;
  function fail(message) { throw new Error(message); }
  function finite(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(name + ' must be a number from ' + min + ' to ' + max + '.');
    return value;
  }
  function text(value, fallback, length) { return typeof value === 'string' ? value.slice(0, length || 120) : fallback; }
  function point(value, name) {
    if (!Array.isArray(value) && value && typeof value === 'object') value = [value.x, value.z];
    if (!Array.isArray(value) || value.length !== 2) fail(name + ' must contain [x, z] in metres.');
    return [finite(value[0], name + ' x', -10000, 10000), finite(value[1], name + ' z', -10000, 10000)];
  }
  function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  function pointSegmentDistance(p, a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1], length = dx * dx + dz * dz;
    var t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  }
  function intersects(a, b, c, d) {
    var abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) && ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS))) return true;
    return (Math.abs(abC) <= EPS && pointSegmentDistance(c, a, b) <= EPS) || (Math.abs(abD) <= EPS && pointSegmentDistance(d, a, b) <= EPS) || (Math.abs(cdA) <= EPS && pointSegmentDistance(a, c, d) <= EPS) || (Math.abs(cdB) <= EPS && pointSegmentDistance(b, c, d) <= EPS);
  }
  function segmentDistance(a, b, c, d) {
    return intersects(a, b, c, d) ? 0 : Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
  }
  function boxesNear(a, b, c, d, radius) {
    return Math.max(a[0], b[0]) + radius >= Math.min(c[0], d[0]) && Math.min(a[0], b[0]) - radius <= Math.max(c[0], d[0]) && Math.max(a[1], b[1]) + radius >= Math.min(c[1], d[1]) && Math.min(a[1], b[1]) - radius <= Math.max(c[1], d[1]);
  }
  function area(poly) { var sum = 0; for (var i = 0; i < poly.length; i++) { var b = poly[(i + 1) % poly.length]; sum += poly[i][0] * b[1] - b[0] * poly[i][1]; } return Math.abs(sum) / 2; }
  function inPolygon(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if (boxesNear(p, p, a, b, EPS) && pointSegmentDistance(p, a, b) <= EPS) return true;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function normalizeScene(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Choose a BrainSNN scene JSON object.');
    if (input.schemaVersion && input.schemaVersion !== SCHEMA) fail('This scene schema version is not supported.');
    if (input.units && input.units !== 'm') fail('Scene units must be metres (m).');
    var width = finite(input.width, 'Floor width', 1, 100), depth = finite(input.depth, 'Floor depth', 1, 100);
    var floor = input.floor || [[0, 0], [width, 0], [width, depth], [0, depth]];
    if (!Array.isArray(floor) || floor.length < 3 || floor.length > 128) fail('A floor needs 3 to 128 polygon corners.');
    floor = floor.map(function (p) { return point(p, 'Floor corner'); });
    if (distance(floor[0], floor[floor.length - 1]) < EPS) floor.pop();
    if (floor.length < 3) fail('A floor needs at least three distinct corners.');
    floor.forEach(function (p, i) {
      if (p[0] < -EPS || p[1] < -EPS || p[0] > width + EPS || p[1] > depth + EPS) fail('Floor corners must lie within the floor width and depth.');
      if (distance(p, floor[(i + 1) % floor.length]) < EPS) fail('Remove duplicate floor corners.');
      for (var j = i + 1; j < floor.length; j++) {
        if (j === i + 1 || (i === 0 && j === floor.length - 1)) continue;
        if (intersects(p, floor[(i + 1) % floor.length], floor[j], floor[(j + 1) % floor.length])) fail('Floor edges must not cross or touch one another.');
      }
    });
    if (area(floor) < 0.25) fail('The floor polygon is too small.');
    var obstacles = input.obstacles || [];
    if (!Array.isArray(obstacles) || obstacles.length > 128) fail('Use at most 128 obstacles.');
    var ids = new Set();
    obstacles = obstacles.map(function (o, i) {
      if (!o || typeof o !== 'object') fail('Obstacle ' + (i + 1) + ' is invalid.');
      var id = text(o.id, 'obstacle-' + (i + 1), 80);
      if (ids.has(id)) fail('Obstacle identifiers must be unique.');
      ids.add(id);
      return { id: id, label: text(o.label, 'Obstacle ' + (i + 1), 80), x: finite(o.x, 'Obstacle x', 0, width), z: finite(o.z, 'Obstacle z', 0, depth), width: finite(o.width, 'Obstacle width', 0.02, 100), depth: finite(o.depth, 'Obstacle depth', 0.02, 100), height: finite(o.height === undefined ? 1 : o.height, 'Obstacle height', 0.02, 20) };
    });
    var start = point(input.start || [Math.min(1, width / 2), Math.min(1, depth / 2)], 'Start');
    var goal = point(input.goal || [Math.max(width - 1, width / 2), Math.max(depth - 1, depth / 2)], 'Goal');
    [start, goal].forEach(function (p) { if (p[0] < 0 || p[1] < 0 || p[0] > width || p[1] > depth) fail('Start and goal must lie within the floor width and depth.'); });
    var source = input.source && typeof input.source === 'object' ? input.source : {};
    return { schemaVersion: SCHEMA, name: text(input.name, 'My space', 100), width: width, depth: depth, floor: floor, obstacles: obstacles, start: start, goal: goal, units: 'm', scaleConfirmed: input.scaleConfirmed === true, revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0, source: { kind: text(source.kind, 'manual', 40), name: text(source.name, '', 120), warnings: Array.isArray(source.warnings) ? source.warnings.slice(0, 16).map(function (w) { return text(w, '', 240); }).filter(Boolean) : [] } };
  }
  function sampleScene() {
    return normalizeScene({ name: 'Showroom test floor', width: 12, depth: 9, start: [1.3, 1.3], goal: [10.5, 7.4], scaleConfirmed: true, source: { kind: 'sample', name: 'Illustrative showroom, not a captured customer site' }, obstacles: [
      { id: 'reception', label: 'Reception', x: 3.3, z: 3.5, width: 2.2, depth: 1.2, height: 1.1 },
      { id: 'display', label: 'Display', x: 8, z: 3.7, width: 1.8, depth: 2.6, height: 1.3 },
      { id: 'seating', label: 'Seating', x: 3.5, z: 7, width: 2.6, depth: 1.2, height: 0.8 }
    ] });
  }
  function resizeScene(input, width, depth) {
    var scene = normalizeScene(input), sx = finite(width, 'Floor width', 1, 100) / scene.width, sz = finite(depth, 'Floor depth', 1, 100) / scene.depth;
    function p(v) { return [v[0] * sx, v[1] * sz]; }
    return normalizeScene(Object.assign({}, scene, { width: width, depth: depth, floor: scene.floor.map(p), start: p(scene.start), goal: p(scene.goal), obstacles: scene.obstacles.map(function (o) { return Object.assign({}, o, { x: o.x * sx, z: o.z * sz, width: o.width * sx, depth: o.depth * sz }); }), scaleConfirmed: false, revision: scene.revision + 1 }));
  }
  function scaleScene(input, factor) { var scene = normalizeScene(input); finite(factor, 'Scale factor', 0.01, 100); var out = resizeScene(scene, scene.width * factor, scene.depth * factor); out.obstacles.forEach(function (o) { o.height *= factor; }); return normalizeScene(out); }
  function robotPreset(id) {
    var row = {
      g1: ['Humanoid planning envelope', 0.6, 0.5, 1.35, 0.45, 0.6, 'humanoid'],
      go2: ['Quadruped planning envelope', 0.5, 0.8, 0.7, 0.5, 0.5, 'quadruped'],
      stretch3: ['Mobile manipulator envelope', 0.6, 0.65, 1.4, 0.3, 0.6, 'mobile'],
      tiago: ['Mobile manipulator envelope', 0.6, 0.65, 1.4, 0.3, 0.6, 'mobile'],
      cleaner: ['Example floor cleaner', 0.6, 0.75, 0.9, 0.4, 0.55, 'cleaner']
    }[id];
    if (!row) row = ['Stationary robot envelope', 0.8, 0.8, 1.3, 0.25, 0.6, 'stationary'];
    return { id: text(id, 'unknown', 60), label: row[0], width: row[1], depth: row[2], height: row[3], speed: row[4], operationWidth: row[5], kind: row[6], provenance: 'Illustrative planning assumptions. Verify the deployed robot configuration.' };
  }
  function normalizeRobot(robot) {
    if (typeof robot === 'string' || !robot) return robotPreset(robot || 'g1');
    return { id: text(robot.id, 'custom', 60), label: text(robot.label, 'Custom planning envelope', 100), width: finite(robot.width, 'Robot width', 0.1, 5), depth: finite(robot.depth, 'Robot depth', 0.1, 5), height: finite(robot.height === undefined ? 1 : robot.height, 'Robot height', 0.1, 5), speed: finite(robot.speed, 'Planning speed', 0.05, 3), operationWidth: finite(robot.operationWidth === undefined ? robot.width : robot.operationWidth, 'Operation width', 0.05, 5), kind: text(robot.kind, 'mobile', 40), provenance: text(robot.provenance, 'User supplied planning assumptions.', 200) };
  }
  function corners(o) { return [[o.x - o.width / 2, o.z - o.depth / 2], [o.x + o.width / 2, o.z - o.depth / 2], [o.x + o.width / 2, o.z + o.depth / 2], [o.x - o.width / 2, o.z + o.depth / 2]]; }
  function pointClear(p, scene, radius) {
    if (!inPolygon(p, scene.floor)) return false;
    for (var i = 0; i < scene.floor.length; i++) if (boxesNear(p, p, scene.floor[i], scene.floor[(i + 1) % scene.floor.length], radius) && pointSegmentDistance(p, scene.floor[i], scene.floor[(i + 1) % scene.floor.length]) + EPS < radius) return false;
    return !scene.obstacles.some(function (o) { var dx = Math.max(Math.abs(p[0] - o.x) - o.width / 2, 0), dz = Math.max(Math.abs(p[1] - o.z) - o.depth / 2, 0); if (dx > radius + EPS || dz > radius + EPS) return false; return dx * dx + dz * dz < (radius + EPS) * (radius + EPS); });
  }
  function segmentClear(a, b, scene, radius) {
    if (!pointClear(a, scene, radius) || !pointClear(b, scene, radius)) return false;
    for (var i = 0; i < scene.floor.length; i++) if (boxesNear(a, b, scene.floor[i], scene.floor[(i + 1) % scene.floor.length], radius) && segmentDistance(a, b, scene.floor[i], scene.floor[(i + 1) % scene.floor.length]) + EPS < radius) return false;
    for (var j = 0; j < scene.obstacles.length; j++) {
      var o = scene.obstacles[j];
      if (!boxesNear(a, b, [o.x - o.width / 2, o.z - o.depth / 2], [o.x + o.width / 2, o.z + o.depth / 2], radius + EPS)) continue;
      var poly = corners(o);
      for (var k = 0; k < 4; k++) if (segmentDistance(a, b, poly[k], poly[(k + 1) % 4]) < radius + EPS) return false;
    }
    return true;
  }
  function plan(input, robotInput, options) {
    var scene = normalizeScene(input), robot = normalizeRobot(robotInput), opt = options || {};
    var mode = opt.mode === 'coverage' ? 'coverage' : 'navigation', radius = Math.hypot(robot.width, robot.depth) / 2 + 0.05;
    var requested = opt.resolution === undefined ? 0.25 : finite(opt.resolution, 'Grid resolution', 0.1, 2);
    var step = Math.max(requested, scene.width / 64, scene.depth / 64), cols = Math.ceil(scene.width / step), rows = Math.ceil(scene.depth / step);
    var dx = scene.width / cols, dz = scene.depth / rows, count = cols * rows;
    if (count > MAX_CELLS) fail('The planning grid is too large.');
    var out = { schemaVersion: 'brainsnn.site-plan.v1', status: 'blocked', reason: '', mode: mode, sceneDigest: digest(scene), robot: robot, trace: [], path: [], metrics: { totalArea: area(scene.floor), freeArea: 0, reachableArea: 0, coveredArea: 0, coveragePercent: 0, distance: 0, durationSeconds: 0 }, grid: { resolution: Math.max(dx, dz), cols: cols, rows: rows, cellWidth: dx, cellDepth: dz, reachable: [], covered: [] }, assumptions: [
      'Geometric planning approximation; no physics, sensors, learned policy or real robot was executed.',
      'A circular envelope enclosing the robot plus 5 cm clearance is used. Robot dimensions and speed are editable assumptions.',
      'All obstacle projections block the floor footprint; overhangs, stairs and stepping over objects are not modelled.',
      'Travel time assumes constant speed; turns, acceleration, battery and cleaning quality are not modelled.',
      'Areas are grid estimates. Narrow routes may be rejected by the conservative footprint or grid resolution.'
    ] };
    if (!scene.scaleConfirmed) { out.status = 'needs-scale'; out.reason = 'Confirm a measured distance and review the floor geometry before running a test.'; return out; }
    if (robot.kind === 'stationary') { out.reason = 'This robot has a stationary base. Choose a mobile planning envelope to test a floor route.'; return out; }
    if (!pointClear(scene.start, scene, radius)) { out.reason = 'The start is outside the floor or too close to an obstacle. Move the start or check the robot size.'; return out; }
    if (mode === 'navigation' && !pointClear(scene.goal, scene, radius)) { out.reason = 'The goal is outside the floor or too close to an obstacle. Move the goal or check the robot size.'; return out; }
    var free = new Uint8Array(count), walkable = new Uint8Array(count), reachable = new Uint8Array(count), points = new Array(count);
    for (var n = 0; n < count; n++) { points[n] = [(n % cols + 0.5) * dx, (Math.floor(n / cols) + 0.5) * dz]; free[n] = pointClear(points[n], scene, 0) ? 1 : 0; walkable[n] = free[n] && pointClear(points[n], scene, radius) ? 1 : 0; if (free[n]) out.metrics.freeArea += dx * dz; }
    out.metrics.freeArea = Math.min(out.metrics.totalArea, out.metrics.freeArea);
    // Cache validated cardinal edges. Point clearance alone cannot prove that a thin wall is not crossed.
    var edges = new Array(count);
    function neighbors(id) {
      if (edges[id]) return edges[id];
      var x = id % cols, z = Math.floor(id / cols), list = [];
      var candidates = [(z % 2 === 0 ? x < cols - 1 : x > 0) ? id + (z % 2 === 0 ? 1 : -1) : -1, z < rows - 1 ? id + cols : -1, (z % 2 === 0 ? x > 0 : x < cols - 1) ? id + (z % 2 === 0 ? -1 : 1) : -1, z > 0 ? id - cols : -1];
      candidates.forEach(function (next) { if (next >= 0 && walkable[next] && segmentClear(points[id], points[next], scene, radius)) list.push(next); });
      return (edges[id] = list);
    }
    function attach(p) {
      var order = [];
      for (var i = 0; i < count; i++) if (walkable[i]) order.push(i);
      order.sort(function (a, b) { return distance(points[a], p) - distance(points[b], p) || a - b; });
      // Only attach to a nearby visible cell, never jump over disconnected areas.
      for (var j = 0; j < order.length && distance(points[order[j]], p) <= step * 2 + EPS; j++) if (segmentClear(p, points[order[j]], scene, radius)) return order[j];
      return -1;
    }
    var start = attach(scene.start), goal = mode === 'navigation' ? attach(scene.goal) : -1;
    if (start < 0) { out.reason = 'No planning cell connects to the start. Move it into clear floor space or use a smaller robot envelope.'; return out; }
    var queue = [start], qi = 0; reachable[start] = 1;
    while (qi < queue.length) neighbors(queue[qi++]).forEach(function (next) { if (!reachable[next]) { reachable[next] = 1; queue.push(next); } });
    out.grid.reachable = queue.map(function (i) { return points[i].slice(); });
    out.metrics.reachableArea = Math.min(out.metrics.freeArea, queue.length * dx * dz);
    if (mode === 'navigation' && (goal < 0 || !reachable[goal])) { out.reason = 'No route reaches the goal with this robot envelope and clearance. Check blocked passages or move the goal.'; return out; }
    var budget = 240000;
    function astar(from, to) {
      if (from === to) return [from];
      var costs = new Float64Array(count), prev = new Int32Array(count), closed = new Uint8Array(count), heap = [];
      costs.fill(Infinity); prev.fill(-1); costs[from] = 0;
      function push(id, score) { var at = heap.length; heap.push({ id: id, score: score }); while (at > 0) { var parent = (at - 1) >> 1; if (heap[parent].score <= score) break; var t = heap[at]; heap[at] = heap[parent]; heap[parent] = t; at = parent; } }
      function pop() { var first = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var at = 0; while (true) { var left = 2 * at + 1, right = left + 1, best = at; if (left < heap.length && heap[left].score < heap[best].score) best = left; if (right < heap.length && heap[right].score < heap[best].score) best = right; if (best === at) break; var t = heap[at]; heap[at] = heap[best]; heap[best] = t; at = best; } } return first.id; }
      push(from, distance(points[from], points[to]));
      while (heap.length) {
        if (--budget < 0) return null;
        var at = pop(); if (closed[at]) continue; closed[at] = 1;
        if (at === to) { var route = [to]; while (route[route.length - 1] !== from) route.push(prev[route[route.length - 1]]); return route.reverse(); }
        neighbors(at).forEach(function (next) { var value = costs[at] + distance(points[at], points[next]); if (!closed[next] && value < costs[next]) { costs[next] = value; prev[next] = at; push(next, value + distance(points[next], points[to])); } });
      }
      return null;
    }
    var route = [start];
    if (mode === 'navigation') route = astar(start, goal);
    else {
      var visited = new Uint8Array(count); visited[start] = 1;
      var targets = queue.slice().sort(function (a, b) { var ar = Math.floor(a / cols), br = Math.floor(b / cols); return ar - br || (ar % 2 ? b - a : a - b); });
      for (var ti = 0; ti < targets.length; ti++) {
        if (visited[targets[ti]]) continue;
        var connection = astar(route[route.length - 1], targets[ti]);
        if (!connection || route.length + connection.length > 10000) {
          // Guaranteed bounded fallback: a connected-component DFS walk never crosses an unverified edge.
          var seen = new Uint8Array(count), stack = [route[route.length - 1]]; seen[stack[0]] = 1;
          while (stack.length) { var top = stack[stack.length - 1], next = neighbors(top).find(function (id) { return !seen[id]; }); if (next !== undefined) { seen[next] = 1; stack.push(next); route.push(next); } else { stack.pop(); if (stack.length) route.push(stack[stack.length - 1]); } }
          out.assumptions.push('Coverage used a bounded connected-floor traversal where row-to-row route searches reached their budget.');
          break;
        }
        for (var ci = 1; ci < connection.length; ci++) { route.push(connection[ci]); visited[connection[ci]] = 1; }
      }
    }
    if (!route) { out.reason = 'The bounded route search did not find a path. Simplify the scene and try again.'; return out; }
    out.path = [scene.start.slice()].concat(route.map(function (i) { return points[i].slice(); }));
    if (mode === 'navigation') out.path.push(scene.goal.slice());
    out.path = out.path.filter(function (p, i, all) { return i === 0 || distance(p, all[i - 1]) > EPS; });
    var travelled = 0, covered = new Uint8Array(count), brushRadius = robot.operationWidth / 2;
    out.path.forEach(function (p, i) {
      var before = i ? out.path[i - 1] : p; travelled += distance(before, p);
      out.trace.push({ x: p[0], z: p[1], t: travelled / robot.speed });
      var minCol = Math.max(0, Math.floor((Math.min(p[0], before[0]) - brushRadius) / dx)), maxCol = Math.min(cols - 1, Math.floor((Math.max(p[0], before[0]) + brushRadius) / dx));
      var minRow = Math.max(0, Math.floor((Math.min(p[1], before[1]) - brushRadius) / dz)), maxRow = Math.min(rows - 1, Math.floor((Math.max(p[1], before[1]) + brushRadius) / dz));
      for (var z = minRow; z <= maxRow; z++) for (var x = minCol; x <= maxCol; x++) {
        var id = z * cols + x;
        if (free[id] && !covered[id] && pointSegmentDistance(points[id], before, p) <= brushRadius) {
          var vx = p[0] - before[0], vz = p[1] - before[1], length2 = vx * vx + vz * vz;
          var along = length2 ? Math.max(0, Math.min(1, ((points[id][0] - before[0]) * vx + (points[id][1] - before[1]) * vz) / length2)) : 0;
          var nearest = [before[0] + along * vx, before[1] + along * vz];
          // A brush may reach outside centre-space, but never through a wall or outside the floor.
          if (segmentClear(nearest, points[id], scene, 1e-6)) covered[id] = 1;
        }
      }
    });
    for (var pi = 0; pi < count; pi++) if (covered[pi]) out.grid.covered.push(points[pi].slice());
    out.metrics.coveredArea = Math.min(out.metrics.freeArea, out.grid.covered.length * dx * dz);
    out.metrics.coveragePercent = out.metrics.freeArea > 0 ? 100 * out.metrics.coveredArea / out.metrics.freeArea : 0;
    out.metrics.distance = travelled; out.metrics.durationSeconds = travelled / robot.speed;
    out.status = 'complete'; out.reason = mode === 'coverage' ? 'A geometric route covers the reachable planning cells. Review unvisited areas and test on the real robot.' : 'A collision-clear geometric route was found for the assumed footprint.';
    return out;
  }
  function vector3(value, name) {
    if (!Array.isArray(value) && value && typeof value === 'object') value = [value.x, value.y, value.z];
    if (!Array.isArray(value) || value.length !== 3) fail(name + ' must be a three-number vector.');
    return value.map(function (v) { return finite(v, name, -10000, 10000); });
  }
  function matrix(value) {
    if (value && !Array.isArray(value) && value.columns) value = value.columns;
    if (Array.isArray(value) && value.length === 4 && value.every(function (v) { return Array.isArray(v) && v.length === 4; })) value = [].concat.apply([], value);
    if (!Array.isArray(value) || value.length !== 16) fail('RoomPlan transform must contain 16 column-major numbers.');
    value = value.map(function (n) { return finite(n, 'RoomPlan transform', -10000, 10000); });
    if (Math.abs(value[3]) > 1e-5 || Math.abs(value[7]) > 1e-5 || Math.abs(value[11]) > 1e-5 || Math.abs(value[15] - 1) > 1e-5) fail('RoomPlan requires an affine column-major transform.');
    for (var c = 0; c < 3; c++) if (Math.abs(Math.hypot(value[c * 4], value[c * 4 + 1], value[c * 4 + 2]) - 1) > 0.02) fail('RoomPlan transform axes must have unit scale.');
    for (var a = 0; a < 3; a++) for (var b = a + 1; b < 3; b++) if (Math.abs(value[a * 4] * value[b * 4] + value[a * 4 + 1] * value[b * 4 + 1] + value[a * 4 + 2] * value[b * 4 + 2]) > 0.02) fail('RoomPlan transform axes must be orthogonal.');
    return value;
  }
  function transform(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }
  function importRoomPlan(input) {
    var room = input && (input.capturedRoom || input.room || input);
    if (!room || typeof room !== 'object') fail('Choose a RoomPlan CapturedRoom JSON export.');
    if (room.rooms) { if (!Array.isArray(room.rooms) || room.rooms.length !== 1) fail('Import one RoomPlan room at a time. Multi-room floor unions require review.'); room = room.rooms[0]; }
    if (!Array.isArray(room.floors) || room.floors.length !== 1) fail('This importer needs one RoomPlan floor with polygonCorners. Export CapturedRoom JSON from a floor-capable RoomPlan app, or draw a measured floor.');
    var surface = room.floors[0];
    if (!surface || typeof surface !== 'object') fail('The RoomPlan floor entry is invalid.');
    if (surface.curve) fail('Curved floor geometry needs manual review before import.');
    var m = matrix(surface.transform);
    if (!Array.isArray(surface.polygonCorners) || surface.polygonCorners.length < 3 || surface.polygonCorners.length > 128) fail('The RoomPlan floor needs 3 to 128 local polygonCorners.');
    var world = surface.polygonCorners.map(function (p) { return transform(m, vector3(p, 'Floor corner')); });
    var ys = world.map(function (p) { return p[1]; });
    if (Math.max.apply(null, ys) - Math.min.apply(null, ys) > 0.05) fail('Only level floors are supported. Review slopes and stairs separately.');
    var minX = Math.min.apply(null, world.map(function (p) { return p[0]; })), minZ = Math.min.apply(null, world.map(function (p) { return p[2]; }));
    var width = Math.max.apply(null, world.map(function (p) { return p[0]; })) - minX, depth = Math.max.apply(null, world.map(function (p) { return p[2]; })) - minZ;
    var obstacles = [], skipped = 0, warnings = ['Confirm a measured distance, start and goal. Capture dimensions have not been independently verified.', 'Objects and walls use conservative axis-aligned bounding boxes; wall thickness is assumed at 10 cm.', 'Door and opening cut-outs are not inferred. Review and edit blocked passages before testing.'];
    ['walls', 'objects'].forEach(function (kind) {
      var items = room[kind] || []; if (!Array.isArray(items) || items.length > 128) fail('RoomPlan ' + kind + ' must contain at most 128 items.');
      items.forEach(function (item, i) {
        if (!item || typeof item !== 'object') fail('RoomPlan ' + kind + ' entry is invalid.');
        if (item.curve) fail('Curved RoomPlan surfaces need manual review; this importer accepts planar walls and box objects.');
        var dims = vector3(item.dimensions, 'RoomPlan dimensions'), tm = matrix(item.transform);
        if (dims.some(function (d) { return d < 0 || d > 100; })) fail('RoomPlan dimensions must be positive bounded lengths in metres.');
        var sx = dims[0] / 2, sy = dims[1] / 2, sz = (kind === 'walls' ? Math.max(dims[2], 0.1) : Math.max(dims[2], 0.02)) / 2, box = [];
        [-1, 1].forEach(function (x) { [-1, 1].forEach(function (y) { [-1, 1].forEach(function (z) { box.push(transform(tm, [x * sx, y * sy, z * sz])); }); }); });
        var bx = Math.min.apply(null, box.map(function (p) { return p[0]; })) - minX, bz = Math.min.apply(null, box.map(function (p) { return p[2]; })) - minZ;
        var ex = Math.max.apply(null, box.map(function (p) { return p[0]; })) - minX, ez = Math.max.apply(null, box.map(function (p) { return p[2]; })) - minZ;
        // Clip external extents to the imported floor bounding box; floor polygon still controls occupancy.
        bx = Math.max(0, bx); bz = Math.max(0, bz); ex = Math.min(width, ex); ez = Math.min(depth, ez);
        if (ex - bx < 0.02 || ez - bz < 0.02) { skipped++; return; }
        var category = item.category && typeof item.category === 'object' ? Object.keys(item.category)[0] : item.category;
        obstacles.push({ id: kind + '-' + i, label: text(category, kind === 'walls' ? 'Wall' : 'Captured object', 80), x: (bx + ex) / 2, z: (bz + ez) / 2, width: ex - bx, depth: ez - bz, height: Math.max(0.02, Math.max.apply(null, box.map(function (p) { return p[1]; })) - Math.min.apply(null, box.map(function (p) { return p[1]; }))) });
      });
    });
    if (skipped) warnings.push(skipped + ' surfaces outside the floor or too thin for this importer were omitted; review the scene.');
    var scene = normalizeScene({ name: text(room.name, 'Imported RoomPlan space', 100), width: width, depth: depth, floor: world.map(function (p) { return [p[0] - minX, p[2] - minZ]; }), obstacles: obstacles, start: [Math.min(1, width / 2), Math.min(1, depth / 2)], goal: [Math.max(width - 1, width / 2), Math.max(depth - 1, depth / 2)], scaleConfirmed: false, source: { kind: 'roomplan', name: text(room.identifier, 'CapturedRoom JSON', 120), warnings: warnings } });
    return scene;
  }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + stable(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function digest(value) { var source = stable(value), hash = 2166136261; for (var i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); } return 'fnv1a32-' + (hash >>> 0).toString(16).padStart(8, '0'); }
  function exportReport(input, result, selection) {
    var scene = normalizeScene(input);
    if (!result || result.sceneDigest !== digest(scene)) fail('Run the current scene again before exporting its report.');
    return JSON.parse(JSON.stringify({ schemaVersion: 'brainsnn.site-report.v1', evidenceType: 'geometric-planning-estimate', policyExecuted: false, physicsExecuted: false, sceneDigest: digest(scene), digestPurpose: 'Deterministic change identifier, not cryptographic attestation.', scene: scene, selectedRobot: text(selection && selection.robot, result.robot.id, 60), selectedModel: text(selection && selection.model, '', 80), result: result }));
  }
  return { SCHEMA: SCHEMA, sampleScene: sampleScene, normalizeScene: normalizeScene, resizeScene: resizeScene, scaleScene: scaleScene, importRoomPlan: importRoomPlan, robotPreset: robotPreset, plan: plan, digest: digest, exportReport: exportReport, pointClear: pointClear, segmentClear: segmentClear, polygonArea: area };
}));
