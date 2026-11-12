import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleWorld, normalizeWorld} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {castRay, lastHit, buildTruth, createMap, integrateReturn, updateClearance, clearanceAt, cellOf, planPath, footprintCircles, footprint, PLATFORMS, SENSOR_SPECS, sensorRig,
  createEpisode, stepEpisode, runEpisode, episodeResult, requestCrate, runTrial, verifyTrialReport, sampleTasks, wilson, rng, TRIAL_SCHEMA, OBSTACLE_RANGE} from '../../brainsnn-r3f-app/public/world/autonomy.mjs';

const hall = (extra = {}) => normalizeWorld({schema: 'brainsnn.world.v1', name: 'Test hall', width: 30, depth: 6, provenance: 'observed', scaleReviewed: true, mapReviewed: true, start: {x: 2, z: 3}, objects: [], ...extra});

test('ray casting returns the nearest of floor, box and wall, and passes over boxes lower than the ray', () => {
  const w = hall({objects: [{id: 'box', name: 'Box', x: 5, z: 2, w: 1, d: 2, h: 1}, {id: 'low', name: 'Low', x: 9, z: 2, w: 1, d: 2, h: 0.3}]}), truth = buildTruth(w);
  assert.equal(castRay(truth, 2, 0.5, 3, 1, 0, 0, 40), 2); assert.ok(Math.abs(lastHit().t - 3) < 1e-9);  // box face at x = 5
  const d = Math.SQRT1_2; assert.equal(castRay(truth, 2, 1, 3, d, -d, 0, 40), 1); assert.ok(Math.abs(lastHit().t - Math.SQRT2) < 1e-9);  // floor, 1 m ahead
  assert.equal(castRay(truth, 7, 0.5, 3, 1, 0, 0, 40), 3); assert.ok(Math.abs(lastHit().t - 23) < 1e-9);  // over the 0.3 m box to the far wall
  assert.equal(castRay(truth, 7, 0.5, 3, 1, 0, 0, 5), 0);   // nothing within range
});

test('keep-out zones are rules, not geometry: rays pass through unknown and no-go areas', () => {
  const w = hall({objects: [{id: 'nogo', name: 'Keep out', x: 5, z: 1, w: 2, d: 4, h: 1, kind: 'no-go'}, {id: 'unk', name: 'Unseen', x: 10, z: 1, w: 2, d: 4, h: 1, kind: 'unknown'}]}), truth = buildTruth(w);
  assert.equal(truth.boxes.length, 0); assert.equal(truth.keepOut.length, 2);
  assert.equal(castRay(truth, 2, 0.5, 3, 1, 0, 0, 40), 3);
  // ...but the planner never routes through them, with or without the reviewed map as a prior.
  for (const prior of [true, false]) { const map = createMap(w, {prior}); assert.equal(map.lethal[cellOf(map, 6, 3)], 1); assert.equal(map.lethal[cellOf(map, 11, 3)], 1); }
});

test('the map learns only from returns: floor returns carve free space, high returns become obstacles after repeated evidence', () => {
  const w = hall(), map = createMap(w, {prior: true});
  const c = cellOf(map, 6, 3); assert.equal(map.lethal[c], 0); assert.ok(clearanceAt(map, 6, 3) > 2);
  // A horizontal return at 0.4 m height, 4 m ahead: an obstacle.
  assert.equal(integrateReturn(map, 2, 0.4, 3, 1, 0, 0, 4.02), 'obstacle'); assert.equal(map.lethal[c], 0, 'one return is not enough');
  integrateReturn(map, 2, 0.4, 3, 1, 0, 0, 4.02); assert.equal(map.lethal[c], 1);
  updateClearance(map); assert.ok(clearanceAt(map, 6.02, 3) < 0.05 && clearanceAt(map, 5, 3) > 0.9 && clearanceAt(map, 5, 3) < 1.05);
  // A downward return that lands on the floor is free evidence along its last stretch below the step height.
  const k = cellOf(map, 3.4, 3); assert.equal(integrateReturn(map, 2, 0.3, 3, Math.cos(-0.2), Math.sin(-0.2), 0, 0.3 / Math.sin(0.2)), 'floor');
  assert.ok(map.logOdds[k] < 0 && map.seen[k] === 1);
});

test('A* routes around obstacles with the planning clearance, and refuses gaps the robot does not fit', () => {
  const wall = gap => hall({objects: [{id: 'a', name: 'Wall A', x: 10, z: 0, w: 0.4, d: 3 - gap / 2, h: 2}, {id: 'b', name: 'Wall B', x: 10, z: 3 + gap / 2, w: 0.4, d: 3 - gap / 2, h: 2}]});
  const robot = PLATFORMS.cleaner, radius = Math.hypot(robot.width, robot.depth) / 2 + 0.1;
  const open = createMap(wall(2), {prior: true}), r = planPath(open, null, {x: 2, z: 1}, {x: 20, z: 5}, {radius});
  assert.equal(r.ok, true); assert.ok(r.length >= Math.hypot(18, 4) - 1e-6);
  for (let i = 0; i < r.x.length; i++) assert.ok(clearanceAt(open, r.x[i], r.z[i]) >= radius - 1e-6, `path point ${i} keeps the planning clearance`);
  const narrow = createMap(wall(0.8), {prior: true});
  assert.equal(planPath(narrow, null, {x: 2, z: 1}, {x: 20, z: 5}, {radius}).reason, 'no-route');
  assert.equal(planPath(open, null, {x: 2, z: 1}, {x: 10.2, z: 1}, {radius}).reason, 'goal-blocked');
});

test('footprint circles cover the whole rectangle and sit along the heading', () => {
  for (const [key, p] of Object.entries(PLATFORMS)) {
    const c = footprintCircles(p), rect = footprint(p, {x: 0, z: 0, th: 0});
    assert.ok(c.r <= Math.hypot(p.width, p.depth) / 2 + 1e-9, `${key}: no worse than one circumscribed circle`);
    for (let i = 0; i < 4; i++) for (let t = 0; t <= 1; t += 0.05) {
      const a = rect[i], b = rect[(i + 1) % 4], x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      assert.ok(c.f.some((f, j) => Math.hypot(x - f, z - c.s[j]) <= c.r + 1e-9), `${key}: boundary point covered`);
    }
  }
});

test('sensor rig follows the published figures it claims and mounts the lidar on top', () => {
  assert.deepEqual([SENSOR_SPECS.lidar.vMinDeg, SENSOR_SPECS.lidar.vMaxDeg, SENSOR_SPECS.lidar.maxRange, SENSOR_SPECS.lidar.minRange], [-7, 52, 40, 0.1]);
  assert.deepEqual([SENSOR_SPECS.depth.hFovDeg, SENSOR_SPECS.depth.vFovDeg, SENSOR_SPECS.depth.maxRange], [87, 58, 3]);
  assert.ok(OBSTACLE_RANGE < SENSOR_SPECS.lidar.maxRange);
  const rig = sensorRig('cleaner'); assert.deepEqual(rig.map(s => s.id), ['lidar', 'depth-front', 'depth-rear']);
  assert.ok(rig[0].y > PLATFORMS.cleaner.height); for (const s of rig) assert.ok(s.rays.length > 0 && s.rays.length % 3 === 0);
  // Every lidar ray stays inside the published vertical field of view.
  const lidar = rig[0].rays; for (let i = 1; i < lidar.length; i += 3) { const e = Math.asin(lidar[i]) * 180 / Math.PI; assert.ok(e >= -7 - 1e-3 && e <= 52 + 1e-3); }
  assert.deepEqual(sensorRig('cleaner', {rear: false}).map(s => s.id), ['lidar', 'depth-front']);
});

test('an episode on the reviewed sample reaches its goal, and the same seed reproduces it exactly', () => {
  const w = sampleWorld(), opts = {robot: 'amr', goal: {x: 12.5, z: 4.5}, seed: 4, density: 'trial'};
  const a = runEpisode(w, opts), b = runEpisode(w, opts);
  assert.equal(a.outcome, 'reached'); assert.ok(a.minClearance > 0);
  assert.deepEqual({...a, replanLog: a.replanLog.map(r => ({...r, ms: 0, mapMs: 0})), replanMs: null}, {...b, replanLog: b.replanLog.map(r => ({...r, ms: 0, mapMs: 0})), replanMs: null});
});

test('a crate dropped on the route reaches the map only through the sensors, the route replans around it, and nothing touches it', () => {
  const ep = createEpisode(sampleWorld(), {robot: 'cleaner', goal: {x: 16.5, z: 11.5}, seed: 2, density: 'trial', perturbations: {crate: true, crateAt: 3}});
  while (!ep.outcome) stepEpisode(ep);
  const r = episodeResult(ep), types = r.events.map(e => e.type);
  assert.equal(r.outcome, 'reached');
  for (const t of ['crate-drop', 'crate-first-return', 'crate-in-map', 'crate-replan']) assert.ok(types.includes(t), t);
  assert.ok(types.indexOf('crate-drop') < types.indexOf('crate-in-map') && types.indexOf('crate-in-map') <= types.indexOf('crate-replan'));
  assert.equal(r.crate.dropAt, 3); assert.ok(r.crate.replanMs >= 0); assert.ok(r.crate.aheadMetres >= PLATFORMS.cleaner.depth / 2 + 1.5);
  // Sensors see the crate's faces, so the evidence sits on its boundary cells; none of its cells came from the prior.
  const box = ep.crate.box, cells = [];
  for (let z = box.z0 + 0.02; z < box.z1; z += 0.04) for (let x = box.x0 + 0.02; x < box.x1; x += 0.04) cells.push(cellOf(ep.map, x, z));
  assert.ok(cells.every(c => ep.map.prior[c] === 0), 'the crate was never in the reviewed map');
  assert.ok(cells.some(c => ep.map.sensed[c] === 1), 'the sensors put it there');
});

test('a live crate request drops another crate ahead and keeps the earlier ones', () => {
  const ep = createEpisode(sampleWorld(), {robot: 'amr', goal: {x: 16.5, z: 11.5}, seed: 9, density: 'trial'});
  for (let i = 0; i < 15; i++) stepEpisode(ep);
  assert.equal(requestCrate(ep), true); stepEpisode(ep);
  for (let i = 0; i < 40 && !ep.outcome; i++) stepEpisode(ep);
  if (!ep.outcome) { requestCrate(ep); stepEpisode(ep); }
  const crates = ep.extras.filter(e => String(e.id).startsWith('crate'));
  assert.ok(crates.length >= 1 && new Set(crates.map(c => c.id)).size === crates.length);
});

test('an object missing from the reviewed map is found by the sensors before the robot reaches it', () => {
  const r = runEpisode(sampleWorld(), {robot: 'vacuum', goal: {x: 16.5, z: 11.5}, seed: 1, density: 'trial', perturbations: {mapError: true}});
  assert.equal(r.mapError.placed, true); assert.notEqual(r.mapError.detectedAt, null); assert.equal(r.outcome, 'reached');
});

test('failures are scored against ground truth: a forklift whose roof lidar cannot see a crate drives into it when the front camera is out', () => {
  const opts = {robot: 'forklift', start: {x: 2, z: 3}, goal: {x: 27, z: 3}, seed: 3, density: 'trial'};
  const broken = runEpisode(hall(), {...opts, perturbations: {crate: true, crateAt: 2, blackout: true}});
  assert.equal(broken.outcome, 'contact');
  assert.deepEqual(broken.events.find(e => e.type === 'contact').with.kind, 'unmapped-object');
  assert.equal(broken.crate.inMapAt, null, 'the robot never saw it');
  const seen = runEpisode(hall(), {...opts, perturbations: {crate: true, crateAt: 2}});
  assert.notEqual(seen.outcome, 'contact'); assert.notEqual(seen.crate.inMapAt, null);
});

test('a paired trial runs the same tasks clean and broken, summarises honestly and seals the report', async () => {
  const report = await runTrial(sampleWorld(), {robot: 'quadruped', episodes: 3, seed: 5, perturbations: {crate: true}});
  assert.equal(report.schema, TRIAL_SCHEMA); assert.deepEqual(report.conditions.map(c => c.id), ['control', 'broken']);
  assert.deepEqual(report.conditions[1].perturbations, {crate: true});
  for (const t of report.tasks) {
    const pair = report.episodes.filter(e => e.task === t.index); assert.equal(pair.length, 2);
    assert.deepEqual(pair[0].goal, pair[1].goal); assert.deepEqual(pair[0].start, pair[1].start);
  }
  for (const id of ['control', 'broken']) {
    const s = report.summary[id]; assert.equal(s.episodes, report.tasks.length);
    assert.equal(s.reached + s.contacts + s.keepOut + s.noRoute + s.stuck + s.timeouts, s.episodes);
    assert.ok(s.completion.wilson95[0] <= s.completion.rate && s.completion.rate <= s.completion.wilson95[1]);
  }
  assert.deepEqual(report.claims, {physicsEngine: false, physicalRobotExecuted: false, learnedPolicyExecuted: false, safetyCertified: false, sensorModel: 'parameterized ray casting against reviewed geometry'});
  assert.ok(report.limitations.some(l => /No real robot/.test(l)) && /no robot moved/.test(report.interpretation));
  assert.equal((await verifyTrialReport(report)).ok, true);
  const tampered = structuredClone(report); tampered.summary.broken.reached = tampered.summary.broken.episodes;
  if (tampered.summary.broken.reached === report.summary.broken.reached) tampered.summary.control.contacts += 1;
  assert.equal((await verifyTrialReport(tampered)).ok, false);
});

test('tasks are reachable on the reviewed map and reproducible from the seed', () => {
  const w = sampleWorld(), a = sampleTasks(w, 'cleaner', 4, 11), b = sampleTasks(w, 'cleaner', 4, 11);
  assert.equal(a.length, 4); assert.deepEqual(a, b);
  for (const t of a) assert.ok(t.referenceDistance >= Math.hypot(t.goal.x - t.start.x, t.goal.z - t.start.z) - 1e-6);
});

test('the trial refuses an unreviewed map, as the planner does', async () => {
  const w = sampleWorld(); w.mapReviewed = false;
  await assert.rejects(runTrial(w, {episodes: 1}), /Review obstacles/);
  assert.throws(() => createEpisode(w, {goal: {x: 16.5, z: 11.5}}), /Review obstacles/);
});

test('Wilson intervals and the seeded generator behave', () => {
  assert.deepEqual(wilson(10, 10), [0.722, 1]); assert.deepEqual(wilson(0, 10), [0, 0.278]);
  const a = rng(42), b = rng(42); for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const n = rng(7); let sum = 0, sq = 0; for (let i = 0; i < 4000; i++) { const v = n.normal(); sum += v; sq += v * v; }
  assert.ok(Math.abs(sum / 4000) < 0.06 && Math.abs(sq / 4000 - 1) < 0.08);
});
