'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../dist/site-core.js'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(source, context, { filename: 'site-core.js' });
const api = context.module.exports;
const copy = value => JSON.parse(JSON.stringify(value));
const small = { id: 'test', width: 0.2, depth: 0.2, height: 0.5, speed: 0.5, operationWidth: 0.3, kind: 'mobile' };
function scene(extra = {}) { return api.normalizeScene({ width: 8, depth: 6, start: [1, 1], goal: [7, 5], scaleConfirmed: true, ...extra }); }
function safeTrace(s, robot, result) {
  const radius = Math.hypot(robot.width, robot.depth) / 2 + 0.05;
  assert(result.trace.length > 0);
  for (let i = 0; i < result.path.length; i++) {
    assert(api.pointClear(result.path[i], s, radius), `point ${i} is not clear`);
    if (i) {
      assert(api.segmentClear(result.path[i - 1], result.path[i], s, radius), `edge ${i} crosses geometry`);
      assert(result.trace[i].t > result.trace[i - 1].t);
    }
  }
}
test('UMD exposes the browser API without a module system', () => {
  const browser = { window: {} }; vm.runInNewContext(source, browser);
  assert.equal(typeof browser.window.BrainSNNSiteCore.plan, 'function');
});
test('normalization rejects invalid numbers, self-crossing floors, units and oversized input', () => {
  for (const width of [NaN, Infinity, '8', 0.9, 101]) assert.throws(() => scene({ width }));
  assert.throws(() => scene({ units: 'ft' }), /metres/);
  assert.throws(() => scene({ schemaVersion: 'future' }), /version/);
  assert.throws(() => scene({ floor: [[0, 0], [8, 6], [8, 0], [0, 6]] }), /cross|touch/);
  assert.throws(() => scene({ floor: [[0, 0], [0, 0], [8, 6]] }), /duplicate/);
  assert.throws(() => scene({ obstacles: Array.from({ length: 129 }, () => ({})) }), /128/);
  assert.throws(() => scene({ obstacles: [{ id: 'a', x: 2, z: 2, width: 1, depth: -2 }] }));
});
test('normalization clones coordinates and strips unknown executable metadata', () => {
  const raw = { width: 8, depth: 6, floor: [[0, 0], [8, 0], [8, 6], [0, 6]], start: [1, 1], arbitrary: { script: true } };
  const clean = api.normalizeScene(raw); raw.floor[0][0] = 7; raw.start[0] = 7;
  assert.equal(clean.floor[0][0], 0); assert.equal(clean.start[0], 1); assert.equal(clean.arbitrary, undefined);
});
test('unconfirmed scan cannot execute a route', () => {
  const result = api.plan(scene({ scaleConfirmed: false }), small);
  assert.equal(result.status, 'needs-scale'); assert.equal(result.trace.length, 0); assert.equal(result.metrics.distance, 0);
});
test('invalid start and goal are blocked with no teleport or false success', () => {
  const wall = { id: 'a', x: 1, z: 1, width: 0.5, depth: 0.5, height: 1 };
  const start = api.plan(scene({ obstacles: [wall] }), small);
  assert.equal(start.status, 'blocked'); assert.match(start.reason, /start/); assert.equal(start.path.length, 0);
  const goal = api.plan(scene({ goal: [0.05, 4] }), small);
  assert.equal(goal.status, 'blocked'); assert.match(goal.reason, /goal/); assert.equal(goal.path.length, 0);
});
test('a full divider blocks navigation while preserving reachability estimates', () => {
  const s = scene({ obstacles: [{ id: 'divider', x: 4, z: 3, width: 0.03, depth: 6, height: 2 }] });
  const result = api.plan(s, small);
  assert.equal(result.status, 'blocked'); assert.equal(result.path.length, 0);
  assert(result.grid.reachable.length > 0); assert(result.grid.reachable.every(p => p[0] < 4));
});
test('thin walls between grid centers cannot be jumped over', () => {
  const s = scene({ width: 4, depth: 4, start: [0.6, 1], goal: [3.4, 1], obstacles: [{ id: 'thin', x: 2, z: 2, width: 0.02, depth: 4, height: 1 }] });
  const result = api.plan(s, small, { resolution: 1 });
  assert.equal(result.status, 'blocked');
});
test('navigation routes around obstacles and preserves exact endpoints', () => {
  const s = scene({ obstacles: [{ id: 'table', x: 4, z: 3, width: 2, depth: 2, height: 1 }] });
  const before = JSON.stringify(s); const result = api.plan(s, small);
  assert.equal(result.status, 'complete'); safeTrace(s, small, result);
  assert.deepEqual(copy(result.path[0]), [1, 1]); assert.deepEqual(copy(result.path.at(-1)), [7, 5]);
  assert.equal(JSON.stringify(s), before); assert.equal(result.metrics.durationSeconds, result.metrics.distance / small.speed);
});
test('nonrectangular floor never fills a missing concave corner', () => {
  const s = scene({ width: 6, depth: 6, floor: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]], start: [5, 1], goal: [1, 5] });
  const result = api.plan(s, small);
  assert.equal(result.status, 'complete'); safeTrace(s, small, result);
  assert.equal(result.metrics.totalArea, 20);
  assert(result.path.every(([x, z]) => x <= 2 || z <= 2));
  const outside = api.plan({ ...s, goal: [5, 5] }, small); assert.equal(outside.status, 'blocked');
});
test('larger robot cannot pass a doorway available to a smaller footprint', () => {
  const s = scene({ obstacles: [
    { id: 'upper', x: 4, z: 1.3, width: 0.2, depth: 2.6, height: 2 },
    { id: 'lower', x: 4, z: 4.7, width: 0.2, depth: 2.6, height: 2 }
  ] });
  assert.equal(api.plan(s, small, { resolution: 0.1 }).status, 'complete');
  assert.equal(api.plan(s, { ...small, width: 0.9, depth: 0.9 }, { resolution: 0.1 }).status, 'blocked');
});
test('coverage stays inside its connected room and every route segment is collision clear', () => {
  const s = scene({ obstacles: [{ id: 'divider', x: 4, z: 3, width: 0.1, depth: 6, height: 2 }] });
  const result = api.plan(s, small, { mode: 'coverage' });
  assert.equal(result.status, 'complete'); safeTrace(s, small, result);
  assert(result.path.every(p => p[0] < 4)); assert(result.metrics.coveragePercent < 55);
  assert(result.metrics.coveredArea <= result.metrics.freeArea); assert(result.metrics.coveragePercent <= 100);
  const visited = new Set(result.path.map(p => p.join(',')));
  assert(result.grid.reachable.every(p => visited.has(p.join(','))));
});
test('sample coverage and navigation are deterministic and bounded', () => {
  const s = api.sampleScene(); const r1 = api.plan(s, 'g1'); const r2 = api.plan(s, 'g1');
  assert.equal(api.digest(r1), api.digest(r2)); assert.equal(r1.status, 'complete');
  const large = api.plan(scene({ width: 100, depth: 100, start: [2, 2], goal: [98, 98] }), small, { mode: 'coverage', resolution: 0.1 });
  assert(large.grid.cols * large.grid.rows <= 4096); assert(large.path.length < 20000);
  assert.equal(large.status, 'complete'); assert(large.trace.every(p => Number.isFinite(p.t)));
});
test('an oversized coverage brush never paints through a solid divider', () => {
  const s = scene({ width: 6, depth: 6, goal: [5, 5], obstacles: [{ id: 'wall', x: 3, z: 3, width: 0.1, depth: 6, height: 2 }] });
  const robot = { ...small, width: 0.3, depth: 0.3, operationWidth: 5, kind: 'cleaner' };
  const result = api.plan(s, robot, { mode: 'coverage' });
  assert.equal(result.status, 'complete');
  assert(result.grid.covered.every(([x]) => x < 3));
  assert(result.metrics.coveredArea <= 18);
});
test('stationary robots cannot be silently treated as walking models', () => {
  const result = api.plan(api.sampleScene(), 'panda'); assert.equal(result.status, 'blocked'); assert.match(result.reason, /stationary/);
});
test('resizing scales floor, obstacles, endpoints and invalidates confirmation', () => {
  const original = api.sampleScene(); const next = api.resizeScene(original, 24, 18);
  assert.equal(next.width, 24); assert.equal(next.depth, 18); assert.equal(next.scaleConfirmed, false);
  assert.equal(next.start[0], original.start[0] * 2); assert.equal(next.obstacles[0].width, original.obstacles[0].width * 2);
  assert.equal(next.floor[2][1], original.floor[2][1] * 2); assert.equal(next.revision, original.revision + 1);
  const scaled = api.scaleScene(original, 1.5); assert.equal(scaled.obstacles[0].height, original.obstacles[0].height * 1.5);
});
function roomPlan() {
  return { identifier: 'private-room-1', floors: [{
    // Local floor plane XY is rotated to world XZ and translated by [10, 2, 20].
    transform: [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [10, 2, 20, 1]],
    polygonCorners: [[-3, -2, 0], [3, -2, 0], [3, 2, 0], [-3, 2, 0]]
  }], objects: [{ category: { storage: {} }, dimensions: [2, 1, 1], transform: [[0, 0, -1, 0], [0, 1, 0, 0], [1, 0, 0, 0], [10, 2.5, 20, 1]] }], walls: [] };
}
test('RoomPlan applies column-major local-to-world transforms and rotated object dimensions', () => {
  const result = api.importRoomPlan(roomPlan());
  assert.equal(result.width, 6); assert.equal(result.depth, 4); assert.equal(result.scaleConfirmed, false);
  assert.deepEqual(copy(result.floor), [[0, 0], [6, 0], [6, 4], [0, 4]]);
  assert.equal(result.obstacles[0].x, 3); assert.equal(result.obstacles[0].z, 2);
  assert.equal(result.obstacles[0].width, 1); assert.equal(result.obstacles[0].depth, 2);
  assert.equal(result.source.kind, 'roomplan'); assert(result.source.warnings.some(w => w.includes('cut-outs')));
});
test('RoomPlan accepts flattened simd matrices and vector dictionaries', () => {
  const r = roomPlan(); r.floors[0].transform = r.floors[0].transform.flat(); r.floors[0].polygonCorners = r.floors[0].polygonCorners.map(([x, y, z]) => ({ x, y, z }));
  assert.equal(api.importRoomPlan({ capturedRoom: r }).width, 6);
});
test('RoomPlan rejects unsupported geometry rather than inventing floor extents', () => {
  assert.throws(() => api.importRoomPlan({ walls: [] }), /one RoomPlan floor/);
  const multiple = roomPlan(); multiple.floors.push(copy(multiple.floors[0])); assert.throws(() => api.importRoomPlan(multiple), /one RoomPlan floor/);
  const slope = roomPlan(); slope.floors[0].polygonCorners[0][2] = 1; assert.throws(() => api.importRoomPlan(slope), /level floors/);
  const rowMajor = roomPlan(); rowMajor.floors[0].transform = [[1, 0, 0, 10], [0, 0, -1, 2], [0, 1, 0, 20], [0, 0, 0, 1]]; assert.throws(() => api.importRoomPlan(rowMajor), /affine/);
  const scaled = roomPlan(); scaled.floors[0].transform[0][0] = 2; assert.throws(() => api.importRoomPlan(scaled), /unit scale/);
  const curved = roomPlan(); curved.objects[0].curve = { radius: 1 }; assert.throws(() => api.importRoomPlan(curved), /Curved/);
  assert.throws(() => api.importRoomPlan({ floors: [null] }), /floor entry/);
  assert.throws(() => api.importRoomPlan({ rooms: [roomPlan(), roomPlan()] }), /one RoomPlan room/);
});
test('RoomPlan retains wall barriers and marks assumed thickness explicitly', () => {
  const r = roomPlan(); r.walls.push({ dimensions: [6, 2.5, 0], transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [10, 3.25, 20, 1]] });
  const imported = api.importRoomPlan(r); imported.start = [1, 1]; imported.goal = [5, 3]; imported.scaleConfirmed = true;
  assert.equal(imported.obstacles.length, 2); assert(imported.source.warnings.some(w => w.includes('10 cm')));
  assert.equal(api.plan(imported, small).status, 'blocked');
});
test('report binds immutable exact scene and states no physics or policy executed', () => {
  const s = api.sampleScene(); const result = api.plan(s, 'g1'); const report = api.exportReport(s, result, { robot: 'g1', model: 'groot' });
  assert.equal(report.policyExecuted, false); assert.equal(report.physicsExecuted, false); assert.equal(report.selectedModel, 'groot');
  assert.equal(report.sceneDigest, api.digest(s)); assert.match(report.digestPurpose, /not cryptographic/);
  s.goal[0] = 6; assert.throws(() => api.exportReport(s, result), /Run the current scene/);
  assert.notEqual(report.scene.goal[0], 6); result.metrics.distance = 0; assert(report.result.metrics.distance > 0);
});
