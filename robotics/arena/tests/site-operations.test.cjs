'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(__dirname, '../dist');
const copy = value => JSON.parse(JSON.stringify(value));
const coreContext = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(base, 'site-core.js'), 'utf8'), coreContext);
const core = coreContext.module.exports;
const source = fs.readFileSync(path.join(base, 'site-operations.js'), 'utf8');
const context = { module: { exports: {} }, BrainSNNSiteCore: core };
vm.runInNewContext(source, context, { filename: 'site-operations.js' });
const operations = context.module.exports;
const rates = { laborHourlyRate: 30, robotHourlyCost: 5, consumablesPerM2: 0.01 };
function gym(extra = {}) {
  // A synthetic regression fixture, never evidence of a real customer floor.
  return core.normalizeScene({ name: 'Synthetic measured-scale gym fixture', width: 20, depth: 30, start: [1.2, 1.2], goal: [18, 28], scaleConfirmed: true, source: { kind: 'test-fixture', name: 'Synthetic gym test, not a customer capture' }, obstacles: [{ id: 'machines', x: 10, z: 15, width: 5, depth: 6, height: 1.5 }], ...extra });
}
function coverage(scene) { return core.plan(scene, 'cleaner', { mode: 'coverage' }); }
function close(a, b) { assert(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`); }

test('browser and CommonJS APIs preserve missing rates and validate typed operational assumptions', () => {
  const browser = { window: { BrainSNNSiteCore: core } }; vm.runInNewContext(source, browser);
  assert.equal(typeof browser.window.BrainSNNSiteOperations.estimate, 'function');
  const defaults = operations.defaults(); defaults.setupMinutes = 99;
  assert.equal(operations.defaults().setupMinutes, 5);
  assert.equal(operations.defaults().laborHourlyRate, null);
  assert.equal(operations.defaults().robotHourlyCost, null);
  assert.equal(operations.defaults().consumablesPerM2, null);
  assert.equal(operations.normalizeAssumptions({ script: 'discard', passes: 2 }).script, undefined);
  for (const value of [{ passes: 1.5 }, { passes: 0 }, { expectedInterventions: -1 }, { expectedInterventions: 1.5 }, { turnSeconds: NaN }, { setupMinutes: Infinity }, { manualM2PerHour: 0 }, { serviceAreaM2: -1 }, { serviceAreaM2: Number.MIN_VALUE }, { laborHourlyRate: '' }, { laborHourlyRate: '30' }, { robotHourlyCost: -1 }, { consumablesPerM2: 1e7 }, { includeUncovered: 'true' }, { currency: 'cad' }, { currency: 'CAD<script>' }]) assert.throws(() => operations.normalizeAssumptions(value));
  assert.throws(() => operations.normalizeAssumptions(null));
});

test('a real core-planned gym fixture produces finite exact time and cost components without mutating evidence', () => {
  const scene = gym(), plan = coverage(scene), beforeScene = JSON.stringify(scene), beforePlan = JSON.stringify(plan);
  const estimate = operations.estimate(scene, plan, { ...rates, expectedInterventions: 2, minutesPerIntervention: 3, serviceAreaM2: 200, serviceMinutes: 4 });
  assert.equal(estimate.schemaVersion, 'brainsnn.site-operations.v1');
  close(estimate.timing.travelMinutes, plan.metrics.distance / plan.robot.speed / 60);
  close(estimate.timing.humanHelpMinutes, 5 + 3 + estimate.timing.serviceMinutes + 6 + estimate.timing.manualFollowupMinutes);
  close(estimate.timing.sequentialElapsedMinutes, estimate.timing.robotRunMinutes + 5 + 3 + 6 + estimate.timing.manualFollowupMinutes);
  close(estimate.costs.labor, estimate.timing.humanHelpMinutes / 60 * 30);
  close(estimate.costs.robot, estimate.timing.robotRunMinutes / 60 * 5);
  close(estimate.costs.consumables, estimate.coverage.workedAreaM2 * 0.01);
  close(estimate.costs.total, estimate.costs.labor + estimate.costs.robot + estimate.costs.consumables);
  assert(Number.isFinite(estimate.timing.sequentialElapsedMinutes));
  assert.equal(estimate.policyExecuted, false); assert.equal(estimate.physicsExecuted, false); assert.equal(estimate.cleaningQualityValidated, false);
  assert.equal(estimate.provenance.sceneSource.kind, 'test-fixture');
  assert(estimate.warnings.some(w => /not proof/.test(w)));
  assert(estimate.warnings.some(w => /does not optimize lane spacing/.test(w)));
  assert.equal(JSON.stringify(scene), beforeScene); assert.equal(JSON.stringify(plan), beforePlan);
  const repeated = operations.estimate(scene, plan, estimate.assumptions);
  assert.equal(estimate.estimateDigest, repeated.estimateDigest);
});

test('partial prices never become a total and explicit zero rates are valid', () => {
  const scene = gym(), plan = coverage(scene);
  const empty = operations.estimate(scene, plan);
  assert.equal(empty.costs.total, null); assert.equal(empty.costs.labor, null);
  assert.deepEqual(copy(empty.costs.missingRates), ['laborHourlyRate', 'robotHourlyCost', 'consumablesPerM2']);
  const partial = operations.estimate(scene, plan, { laborHourlyRate: 0 });
  assert.equal(partial.costs.labor, 0); assert.equal(partial.costs.total, null);
  assert.deepEqual(copy(partial.costs.missingRates), ['robotHourlyCost', 'consumablesPerM2']);
  const zero = operations.estimate(scene, plan, { laborHourlyRate: 0, robotHourlyCost: 0, consumablesPerM2: 0 });
  assert.equal(zero.costs.total, 0); assert.deepEqual(copy(zero.costs.missingRates), []);
  const priced = operations.estimate(scene, plan, rates);
  assert.equal(zero.planDigest, priced.planDigest); assert.deepEqual(copy(zero.timing), copy(priced.timing));
  assert.notEqual(zero.assumptionsDigest, priced.assumptionsDigest);
});

test('unscaled, stale, blocked, navigation and noncleaning routes cannot produce a cleaning estimate', () => {
  const scene = gym(), plan = coverage(scene);
  assert.throws(() => operations.estimate({ ...scene, scaleConfirmed: false }, plan), /measured floor/);
  assert.throws(() => operations.estimate({ ...scene, goal: [17, 28] }, plan), /changed/);
  assert.throws(() => operations.estimate(scene, { ...plan, status: 'blocked' }), /complete route/);
  assert.throws(() => operations.estimate(scene, core.plan(scene, 'cleaner', { mode: 'navigation' })), /floor coverage/);
  assert.throws(() => operations.estimate(scene, core.plan(scene, 'g1', { mode: 'coverage' })), /cleaning robot/);
  assert.throws(() => operations.estimate(scene, { ...plan, metrics: { ...plan.metrics, distance: plan.metrics.distance + 3 } }), /distance has changed/);
  assert.throws(() => operations.estimate(scene, { ...plan, metrics: { ...plan.metrics, coveredArea: plan.metrics.freeArea + 1 } }), /floor estimate/);
});

test('a divided floor preserves uncovered manual work and excluding it removes only follow-up time', () => {
  const scene = gym({ obstacles: [{ id: 'divider', x: 10, z: 15, width: 0.1, depth: 30, height: 2 }] }), plan = coverage(scene);
  const withManual = operations.estimate(scene, plan, { ...rates, manualM2PerHour: 100 });
  assert(withManual.coverage.uncoveredAreaM2 > plan.metrics.freeArea * 0.45);
  close(withManual.coverage.uncoveredAreaM2, plan.metrics.freeArea - plan.metrics.coveredArea);
  close(withManual.timing.manualFollowupMinutes, withManual.coverage.uncoveredAreaM2 / 100 * 60);
  const excluded = operations.estimate(scene, plan, { ...rates, manualM2PerHour: 100, includeUncovered: false });
  assert.equal(excluded.coverage.uncoveredAreaM2, withManual.coverage.uncoveredAreaM2);
  assert.equal(excluded.coverage.manualFollowupAreaM2, 0); assert.equal(excluded.timing.manualFollowupMinutes, 0);
  assert.equal(excluded.timing.robotRunMinutes, withManual.timing.robotRunMinutes);
  close(withManual.costs.labor - excluded.costs.labor, withManual.timing.manualFollowupMinutes / 60 * rates.laborHourlyRate);
});

test('multiple passes multiply route work and consumables but preserve unique area and one setup', () => {
  const scene = gym(), plan = coverage(scene);
  const once = operations.estimate(scene, plan, rates), twice = operations.estimate(scene, plan, { ...rates, passes: 2 });
  assert.equal(twice.timing.travelMinutes, once.timing.travelMinutes * 2);
  assert.equal(twice.timing.turnMinutes, once.timing.turnMinutes * 2);
  assert.equal(twice.coverage.coveredAreaM2, once.coverage.coveredAreaM2);
  assert.equal(twice.coverage.workedAreaM2, once.coverage.workedAreaM2 * 2);
  assert.equal(twice.costs.consumables, once.costs.consumables * 2);
  assert.equal(twice.timing.setupMinutes, once.timing.setupMinutes);
  assert.equal(twice.timing.finishMinutes, once.timing.finishMinutes);
  assert.equal(twice.timing.manualFollowupMinutes, once.timing.manualFollowupMinutes);
  assert(twice.warnings.some(w => /next pass start/.test(w)));
});

test('service capacity does not add an end stop or double-count shared servicing in elapsed time', () => {
  const scene = gym(), plan = coverage(scene), area = plan.metrics.coveredArea;
  const exact = operations.estimate(scene, plan, { serviceAreaM2: area, serviceMinutes: 7 });
  assert.equal(exact.route.serviceStops, 0); assert.equal(exact.timing.serviceMinutes, 0);
  const over = operations.estimate(scene, plan, { serviceAreaM2: area - 0.0001, serviceMinutes: 7 });
  assert.equal(over.route.serviceStops, 1); assert.equal(over.timing.serviceMinutes, 7);
  close(over.timing.robotRunMinutes - exact.timing.robotRunMinutes, 7);
  close(over.timing.humanHelpMinutes - exact.timing.humanHelpMinutes, 7);
  close(over.timing.sequentialElapsedMinutes - exact.timing.sequentialElapsedMinutes, 7);
  const twoLoads = operations.estimate(scene, plan, { serviceAreaM2: area / 2, serviceMinutes: 7 });
  assert.equal(twoLoads.route.serviceStops, 1);
});

test('turn estimates ignore duplicate positions and minor bends while retaining real heading changes', () => {
  const scene = gym(), plan = coverage(scene), radians = degrees => degrees * Math.PI / 180;
  const p0 = copy(scene.start), p1 = [p0[0] + 1, p0[1]], p2 = [p1[0] + Math.cos(radians(10)), p1[1] + Math.sin(radians(10))], p3 = [p2[0] + Math.cos(radians(26)), p2[1] + Math.sin(radians(26))];
  const pathPoints = [p0, copy(p0), p1, p2, p3, copy(p2)];
  let distance = 0; for (let i = 1; i < pathPoints.length; i++) distance += Math.hypot(pathPoints[i][0] - pathPoints[i - 1][0], pathPoints[i][1] - pathPoints[i - 1][1]);
  const controlled = { ...plan, path: pathPoints, metrics: { ...plan.metrics, distance } };
  const estimate = operations.estimate(scene, controlled, { turnSeconds: 12, passes: 2 });
  assert.equal(estimate.route.headingChanges, 2); assert.equal(estimate.route.turnsAllPasses, 4);
  assert.equal(estimate.timing.turnMinutes, 48 / 60);
  close(estimate.timing.travelMinutes, distance / plan.robot.speed * 2 / 60);
});
