'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createStore} = require('../store.cjs');
const {quoteCost} = require('../pricing.cjs');
const {runAdmin} = require('../admin.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-admin-'));
  const dbPath = path.join(directory, 'billing.sqlite');
  const now = () => Date.UTC(2026, 9, 17);
  const store = createStore({dbPath, now, failureReserveCents: 10000, paymentMode: 'test'});
  const owner = store.createWorkspace();
  store.creditFunding({eventId: 'evt_1', paymentId: 'pi_1', workspaceId: owner.workspaceId, amountCents: 5000, currency: 'cad'});
  const inputDigest = 'a'.repeat(64);
  const quote = store.createQuote({workspaceId: owner.workspaceId, inputDigest, ...quoteCost({inputTokenUpperBound: 1000}, {version: 'test-v1', now: now(), validUntil: now() + 86400000, fxValidUntil: now() + 86400000, inputUsdPerMillion: 4, outputUsdPerMillion: 20, usdToCad: 1.6, paymentFeeBps: 860, infraCents: 10, supportCents: 20})});
  t.after(() => {store.close(); fs.rmSync(directory, {recursive: true, force: true});});
  const command = (action, ...args) => runAdmin([action, '--db', dbPath, ...args], {env: {ARENA_ANALYSIS_FAILURE_RESERVE_CENTS: '10000'}, now});
  const start = () => store.reserveJob({workspaceId: owner.workspaceId, quoteId: quote.id, inputDigest}).job;
  return {store, owner, dbPath, directory, now, command, start};
}

test('local status reports accounting, never secrets, and never recovers active jobs', t => {
  const f = fixture(t), job = f.start();
  const status = f.command('status');
  assert.equal(status.paymentMode, 'test');
  assert.equal(status.accounting.unspentLiabilityCents, 5000);
  assert.equal(status.accounting.earnedRevenueCents, 0);
  assert.deepEqual(status.uncertainJobs, []);
  assert.equal(f.store.getJob(f.owner.workspaceId, job.id).status, 'running');
  const output = JSON.stringify(status);
  for (const value of [f.owner.recoveryCode, f.owner.sessionToken, f.owner.csrfToken]) assert.ok(!output.includes(value));
});

test('reconciliation requires explicit review, known cost and no delivered result confirmation', t => {
  const f = fixture(t), job = f.start();
  f.store.failJob({jobId: job.id});
  const args = ['--job', job.id, '--actual-provider-cost-cents', '15', '--reason', 'Provider billing verified; no result reached the customer'];
  assert.throws(() => f.command('reconcile', ...args), {code: 'ADMIN_INPUT'});
  assert.equal(f.store.getJob(f.owner.workspaceId, job.id).status, 'uncertain');
  const answer = f.command('reconcile', ...args, '--confirm-no-result-no-charge');
  assert.equal(answer.status, 'failed'); assert.equal(answer.customerChargeCents, 0);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 5000);
  assert.equal(f.store.getBudget().outstandingCostCents, 0);
  assert.equal(f.store.getAdminAudit()[0].action, 'reconcile_no_result');
  const spent = f.store.getBudget().failureSpentCents;
  f.command('reconcile', ...args, '--confirm-no-result-no-charge');
  assert.equal(f.store.getBudget().failureSpentCents, spent);
  assert.equal(f.store.getAdminAudit().length, 1);
  assert.throws(() => f.command('reconcile', '--job', job.id, '--actual-provider-cost-cents', '16', '--reason', 'A different amount must not silently overwrite accounting', '--confirm-no-result-no-charge'), {code: 'IDEMPOTENCY_CONFLICT'});
});

test('running jobs and delivered results cannot be reconciled as no-result failures', t => {
  const f = fixture(t), job = f.start();
  const args = ['--job', job.id, '--actual-provider-cost-cents', '0', '--reason', 'Owner review cannot change a delivered result into a failure', '--confirm-no-result-no-charge'];
  assert.throws(() => f.command('reconcile', ...args), {code: 'JOB_NOT_UNCERTAIN'});
  f.store.completeJob({jobId: job.id, result: {privateText: 'must not be printed'}, actualProviderCostCents: 1});
  assert.throws(() => f.command('reconcile', ...args), {code: 'JOB_NOT_UNCERTAIN'});
  assert.ok(!JSON.stringify(f.command('status')).includes('must not be printed'));
});

test('reviewed owner freezes are audited and can be cleared without financial mutation', t => {
  const f = fixture(t), reason = 'Owner verified payment ledger and reviewed the workspace';
  const before = f.store.getAccounting();
  assert.throws(() => f.command('freeze', '--workspace', f.owner.workspaceId), {code: 'ADMIN_INPUT'});
  assert.equal(f.command('freeze', '--workspace', f.owner.workspaceId, '--reason', reason).wallet.frozen, true);
  assert.equal(f.command('unfreeze', '--workspace', f.owner.workspaceId, '--reason', reason).wallet.frozen, false);
  assert.deepEqual(f.store.getAccounting(), before);
  assert.deepEqual(f.store.getAdminAudit().map(row => row.action), ['unfreeze', 'freeze']);
});

test('owner unfreeze cannot override unresolved expense or disputed funding', t => {
  const f = fixture(t), job = f.start(), reason = 'Reviewed owner action cannot bypass unresolved accounting';
  f.store.failJob({jobId: job.id});
  f.command('freeze', '--workspace', f.owner.workspaceId, '--reason', reason);
  assert.throws(() => f.command('unfreeze', '--workspace', f.owner.workspaceId, '--reason', reason), {code: 'WORKSPACE_STILL_BLOCKED'});
  assert.equal(f.store.getAdminAudit().length, 1);
  f.store.reconcileJob({jobId: job.id, actualProviderCostCents: 0});
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.frozen, true, 'failed unfreeze rolled back owner flag');
  f.store.reverseFunding({eventId: 'dispute', paymentId: 'pi_1', reversedCents: 5000, disputed: true});
  assert.throws(() => f.command('unfreeze', '--workspace', f.owner.workspaceId, '--reason', reason), {code: 'WORKSPACE_STILL_BLOCKED'});
});

test('CLI refuses nonexistent ledgers, symlinks, unsupported actions and ambiguous cost input', t => {
  const f = fixture(t);
  assert.throws(() => runAdmin(['status', '--db', path.join(f.directory, 'new.sqlite')], {env: {}}), {code: 'ADMIN_INPUT'});
  assert.equal(fs.existsSync(path.join(f.directory, 'new.sqlite')), false);
  const linked = path.join(f.directory, 'link.sqlite'); fs.symlinkSync(f.dbPath, linked);
  assert.throws(() => runAdmin(['status', '--db', linked], {env: {}}), {code: 'ADMIN_INPUT'});
  assert.throws(() => f.command('credit'), {code: 'ADMIN_INPUT'});
  assert.throws(() => f.command('status', '--job', 'job_test'), {code: 'ADMIN_INPUT'});
  for (const amount of ['-1', '1.5', '1e3', '', 'NaN']) assert.throws(() => f.command('status', '--failure-reserve-cents', amount), {code: 'ADMIN_INPUT'});
  const result = spawnSync(process.execPath, [require.resolve('../admin.cjs'), 'status', '--db', path.join(f.directory, 'missing.sqlite')], {encoding: 'utf8'});
  assert.equal(result.status, 1); assert.match(result.stderr, /ADMIN_INPUT/); assert.equal(result.stdout, '');
});
