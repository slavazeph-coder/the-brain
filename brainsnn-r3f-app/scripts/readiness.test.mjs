import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReadiness } from '../src/server/readiness.js';
const now = 100000;
const keys = ['hardwareClearance', 'exclusiveOwnership', 'maintenanceClear', 'durableVolume', 'singleReplica', 'modelPinned', 'workflowPinned', 'backupRestoreVerified'];
const status = () => ({ configured: true, control: { paused: false, kill: false, hardwarePaused: false, gpuQuarantined: false, externalExecution: false }, workerContacts: [{ lastSeenAt: now }] });
const evidence = () => Object.fromEntries(keys.map(key => [key, { value: true, source: 'operator', observedAt: now - 1, expiresAt: now + 1000, reference: 'synthetic-reviewed-record' }]));
test('absent evidence stays unknown and assessment does not mutate inputs or echo evidence', () => {
  const s = status(), e = evidence(); e.hardwareClearance.reference = 'never echo this';
  const before = JSON.stringify([s,e]);
  assert.equal(assessReadiness(s, {}, now).ready, false);
  assert.equal(assessReadiness({}, {}, now).checks.every(c => c.state !== 'pass'), true);
  assert.equal(assessReadiness(s,e,now).ready, true);
  assert.equal(JSON.stringify([s,e]), before);
  assert.ok(!JSON.stringify(assessReadiness(s,e,now)).includes('never echo'));
});
test('every missing, stale, future, denied or malformed human assertion blocks', () => {
  for (const key of keys) for (const value of [undefined, {}, { ...evidence()[key], value: false }, { ...evidence()[key], value: 'true' }, { ...evidence()[key], expiresAt: now }, { ...evidence()[key], observedAt: now + 1 }, { ...evidence()[key], observedAt: now - 86400001 }, { ...evidence()[key], source: 'machine' }]) {
    const e = evidence(); e[key] = value;
    assert.equal(assessReadiness(status(), e, now).ready, false, key);
  }
});
test('healthy NVML and operator assertions cannot override scheduler or maintenance holds', () => {
  for (const key of ['paused','kill','hardwarePaused','gpuQuarantined']) {
    const s = status(); s.control[key] = true; s.nvml = { healthy: true, utilization: 0 };
    assert.equal(assessReadiness(s,evidence(),now).ready, false);
  }
  const e = evidence(); e.maintenanceClear.value = false;
  assert.equal(assessReadiness(status(),e,now).ready, false);
});
test('absent, stale, future and multiple fresh worker contacts block; contact is not GPU proof', () => {
  for (const contacts of [[], [{ lastSeenAt: now - 60001 }], [{ lastSeenAt: now + 1 }], [{ lastSeenAt: now }, { lastSeenAt: now }]]) {
    assert.equal(assessReadiness({ ...status(), workerContacts: contacts }, evidence(), now).ready, false);
  }
  assert.equal(assessReadiness(status(), {}, now).ready, false);
});
test('a supplied runtime maintenance lock conflicts with human clearance and blocks', () => {
  const s = { ...status(), maintenanceHold: true };
  assert.equal(assessReadiness(s, evidence(), now).ready, false);
});
