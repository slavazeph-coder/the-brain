import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDrive} from '../../brainsnn-r3f-app/public/world/robot-drive-analysis.mjs';
const close = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
function recording() { return {frames: Array.from({length: 21}, (_, i) => ({time: i / 2, wheelTorqueNm: [.8, .8], wheelVelocityRadS: [1, 1]})), provenance: {origin: 'authored-simulation'}}; }
function profile() { return {motor: {voltageV: 24, currentLimitA: 5, torqueConstantNmPerA: .1, resistanceOhm: 2, gearRatio: 10, efficiency: .8, backEmfVPerRadPerSecond: .1, noLoadCurrentA: 0,
  driverResistanceOhm: 0, thermalResistanceKPerW: 2, thermalCapacityJPerK: 1, ambientC: 20, temperatureLimitC: 80, auxiliaryPowerW: 0}}; }

test('provided constants produce dimensionally correct current, voltage, energy and RC heating', () => {
  const r = analyzeDrive(profile(), recording());
  assert.equal(r.status, 'modelled-within-limits'); assert.equal(r.physicalValidated, false);
  close(r.metrics.maximumMotorCurrentA, 1); close(r.metrics.maximumVoltageDemandV, 3);
  close(r.metrics.mechanicalEnergyWh, 1.6 * 10 / 3600); close(r.metrics.motorTerminalEnergyWh, 6 * 10 / 3600);
  close(r.metrics.maximumModelledTemperatureC, 20 + 4 * (1 - Math.exp(-5)));
  close(r.metrics.coverage, 1);
});

test('current, voltage and heat limits each report observed model violations', () => {
  const p = profile(); p.motor.currentLimitA = .5; p.motor.voltageV = 2; p.motor.temperatureLimitC = 21;
  const r = analyzeDrive(p, recording()); assert.equal(r.status, 'limits-exceeded');
  for (const kind of ['current-limit', 'voltage-limit', 'temperature-limit']) assert.ok(r.violations.some(v => v.kind === kind));
});

test('declared driver resistance contributes voltage drop and distinct MOSFET conduction loss', () => {
  const p = profile(); p.motor.driverResistanceOhm = 1;
  const r = analyzeDrive(p, recording()); close(r.metrics.maximumVoltageDemandV, 4);
  close(r.metrics.driverConductionLossWh, 2 * 10 / 3600);
  close(r.metrics.motorTerminalEnergyWh, 6 * 10 / 3600, 1e-10);
});

test('missing motor data and generic controller actions never become invented electrical measurements', () => {
  const partial = analyzeDrive({}, recording());
  assert.equal(partial.status, 'partial'); assert.equal(partial.metrics.maximumMotorCurrentA, null); assert.equal(partial.metrics.motorTerminalEnergyWh, null);
  assert.ok(partial.metrics.mechanicalEnergyWh > 0);
  const r = recording(); r.frames = r.frames.map(({time}) => ({time, action: [.8, .8], wheelVelocityRadS: [1, 1]}));
  const absent = analyzeDrive(profile(), r); assert.equal(absent.status, 'unavailable'); assert.equal(absent.series.length, 0);
  r.frames.forEach(f => { f.wheelTorqueNm = []; f.wheelVelocityRadS = []; });
  assert.equal(analyzeDrive(profile(), r).status, 'unavailable', 'holonomic slide actuators do not invent wheel electrical data');
});

test('malformed timestamps, nonphysical efficiencies and invalid samples are rejected', () => {
  const p = profile(); p.motor.efficiency = 1.1; assert.throws(() => analyzeDrive(p, recording()), /efficiency/);
  const r = recording(); r.frames[3].time = r.frames[2].time; assert.throws(() => analyzeDrive(profile(), r), /increasing/);
  const bad = recording(); bad.frames[1].wheelTorqueNm[0] = Infinity; assert.throws(() => analyzeDrive(profile(), bad), /finite/);
});

test('regeneration is not fabricated and data gaps are excluded from energy integration', () => {
  const r = recording(); r.frames.forEach(f => { f.wheelTorqueNm = [-.8, -.8]; });
  const out = analyzeDrive(profile(), r); close(out.metrics.mechanicalEnergyWh, 0); assert.ok(out.metrics.brakingEnergyWh > 0); assert.ok(out.metrics.motorTerminalEnergyWh >= 0);
  const gap = recording(); gap.frames.splice(4, 6); const result = analyzeDrive(profile(), gap); assert.ok(result.metrics.coverage < 1);
  assert.equal(result.status, 'partial'); assert.equal(result.metrics.maximumModelledTemperatureC, null);
  assert.equal(result.series.at(-1).temperatureC, null);
});
