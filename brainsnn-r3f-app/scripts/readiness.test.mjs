import test from 'node:test';
import assert from 'node:assert/strict';
import { assessReadiness } from '../src/server/readiness.js';
const now = 100000;
const keys = ['hardwareClearance', 'exclusiveOwnership', 'maintenanceClear', 'durableVolume', 'singleReplica', 'modelPinned', 'workflowPinned', 'backupRestoreVerified'];
const status = () => ({ configured: true, control: { paused: false, kill: false, hardwarePaused: false, gpuQuarantined: false, externalExecution: false }, workerContacts: [{ lastSeenAt: now, kinds: ['video'] }], gpu: { reachable: true, healthy: true }, jobs: [{ status: 'ready-for-review' }], deliveries: [{ id: 'd1' }] });
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
test('a fresh heartbeat that declares no kind cannot certify the machine', () => {
  const bare = { ...status(), workerContacts: [{ lastSeenAt: now }] };
  const r = assessReadiness(bare, evidence(), now);
  assert.equal(r.ready, false);
  assert.deepEqual(r.servableKinds, []);
  assert.ok(r.reasons.includes('workerContact:worker_declares_no_servable_kinds'));
});
test('a research-only worker certifies nothing about video', () => {
  const s = { ...status(), workerContacts: [{ lastSeenAt: now, kinds: ['research'] }] };
  const r = assessReadiness(s, evidence(), now);
  assert.equal(r.ready, true);
  assert.deepEqual(r.servableKinds, ['research']);
  assert.ok(!r.servableKinds.includes('video'));
});
test('a stale worker contributes no servable kinds', () => {
  const s = { ...status(), workerContacts: [{ lastSeenAt: now - 60001, kinds: ['video'] }] };
  const r = assessReadiness(s, evidence(), now);
  assert.deepEqual(r.servableKinds, []);
  assert.equal(r.ready, false);
});
test('a reachable host with an uninitialised GPU is blocked, not passed', () => {
  const s = { ...status(), gpu: { reachable: true, healthy: false } };
  const r = assessReadiness(s, evidence(), now);
  const check = r.checks.find(c => c.id === 'gpuHealth');
  assert.equal(check.state, 'blocked');
  assert.equal(check.reason, 'host_reachable_gpu_uninitialised');
  assert.equal(r.ready, false);
});
test('an unreported GPU is unknown, never a pass', () => {
  const s = { ...status() };
  delete s.gpu;
  const r = assessReadiness(s, evidence(), now);
  assert.equal(r.checks.find(c => c.id === 'gpuHealth').state, 'unknown');
  assert.equal(r.ready, false);
});
test('only an initialised driver passes gpuHealth', () => {
  const s = { ...status(), gpu: { reachable: true, healthy: true } };
  const r = assessReadiness(s, evidence(), now);
  assert.equal(r.checks.find(c => c.id === 'gpuHealth').state, 'pass');
  assert.equal(r.ready, true);
});
test('an unconsumed backlog with no deliveries blocks', () => {
  const s = { ...status(), deliveries: [], jobs: Array.from({ length: 117 }, () => ({ status: 'ready-for-review' })) };
  const r = assessReadiness(s, evidence(), now);
  const c = r.checks.find(x => x.id === 'workload');
  assert.equal(c.state, 'blocked');
  assert.ok(c.reason.startsWith('backlog_unconsumed:117_'), c.reason);
  assert.equal(r.ready, false);
});
test('a never-supplied assertion is labelled never supplied, not stale', () => {
  const r = assessReadiness(status(), {}, now);
  assert.equal(r.checks.find(x => x.id === 'hardwareClearance').reason, 'assertion_never_supplied');
});
