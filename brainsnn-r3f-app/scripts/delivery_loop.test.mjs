/**
 * Closed-loop delivery: pay -> link -> render -> approve -> ATTESTED.
 *
 * Pins that an approved render actually discharges the promise a payment made,
 * and that a rejection or an unlinked job attests NOTHING.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createOrchestration } from '../src/server/orchestration.js';

const OWNER = 'o'.repeat(40), WORKER = 'w'.repeat(40), SHA = 'a'.repeat(64);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'brainsnn-dloop-'));
  let now = 100000;
  const env = { ORCHESTRATION_ENABLED: '1', ORCHESTRATION_SINGLE_REPLICA: '1',
    ORCHESTRATION_DB_PATH: join(dir, 'queue.db'),
    ORCHESTRATION_OWNER_KEY: OWNER, ORCHESTRATION_WORKER_KEY: WORKER };
  const o = createOrchestration(env, { now: () => now, leaseMs: 1000 });
  t.after(() => { o.close(); rmSync(dir, { recursive: true, force: true }); });
  const dispatch = (req, res) => {
    const owner = req.url.startsWith('/owner/');
    req.url = req.url.replace(/^\/(owner|worker)/, '');
    return (owner ? o.handleOwner : o.handleWorker)(req, res);
  };
  const call = async (surface, path, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.headers = { authorization: `Bearer ${surface === 'owner' ? OWNER : WORKER}`,
      'x-brainsnn-worker': 'worker_1234', 'content-type': 'application/json' };
    req.method = body === undefined ? 'GET' : 'POST';
    req.url = `/${surface}${path}`;
    const chunks = []; let status = 200;
    const res = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
    res.setHeader = () => {}; res.writeHead = code => { status = code; };
    const finished = new Promise(r => res.once('finish', r));
    await dispatch(req, res); await finished;
    return { status, body: JSON.parse(Buffer.concat(chunks).toString()) };
  };
  return { o, call };
}

const checkout = id => ({ id, type: 'checkout.session.completed', data: { object: {
  id: 'cs_' + id, mode: 'payment', amount_total: 6500, currency: 'usd',
  customer: 'cus_1', customer_details: { email: 'buyer@example.com' },
  metadata: { kind: 'video-order' } } } });

const ARTIFACT = { sha256: SHA, uri: `sha256:${SHA}`, bytes: 4, mediaType: 'video/mp4' };

/** Pay, submit a render, link them, and produce a finished artifact. */
async function render(f) {
  const paid = f.o.recordBillingEvent(checkout('evt_1'));
  const op = paid.delivery.operationId;
  const job = (await f.call('owner', '/jobs', { idempotencyKey: 'order-1', kind: 'video',
    payload: { workflowId: 'approved-local' } })).body.job;
  assert.equal((await f.call('owner', '/deliveries/link', { operationId: op, jobId: job.id })).status, 200);
  const lease = (await f.call('worker', '/next')).body.job;
  assert.equal(lease.id, job.id, 'the linked render is what the worker picks up');
  assert.equal((await f.call('worker', `/jobs/${job.id}/complete`,
    { quiescent: true, token: lease.lease.token, result: { rendered: true }, artifacts: [ARTIFACT] })).status, 200);
  return { op, job };
}

test('pay -> link -> render -> approve discharges the promise with real evidence', async t => {
  const f = fixture(t);
  const { op, job } = await render(f);
  let ledger = f.o.deliveryLedger();
  assert.equal(ledger.paid, 1); assert.equal(ledger.delivered, 0, 'not delivered before approval');
  assert.equal(ledger.undelivered, 1);

  const r = await f.call('owner', `/jobs/${job.id}/approvals`,
    { category: 'visual', decision: 'approved', artifactSha256: SHA, note: 'reviewed bytes' });
  assert.equal(r.status, 201);
  assert.equal(r.body.approval.delivery.claimed, true, 'approval must discharge the promise');

  const receipt = f.o.deliveryLedger();
  assert.equal(receipt.delivered, 1); assert.equal(receipt.undelivered, 0);
  assert.equal(receipt.gap.length, 0, 'the gap closes');
  const row = f.o.snapshot().deliveries.states.delivered;
  assert.equal(row, 1);
  const stored = f.o.linkDeliveryJob(op, job.id).receipt;
  assert.equal(stored.state, 'delivered');
  assert.equal(stored.artifactSha256, SHA, 'evidence is the approved artifact digest');
  assert.equal(stored.evidenceLocator, `sha256:${SHA}`);
});

test('a REJECTED artifact attests nothing - the order stays in the gap', async t => {
  const f = fixture(t);
  const { job } = await render(f);
  const r = await f.call('owner', `/jobs/${job.id}/approvals`,
    { category: 'visual', decision: 'rejected', artifactSha256: SHA, note: 'not acceptable' });
  assert.equal(r.status, 201);
  assert.equal(r.body.approval.delivery, undefined, 'no delivery may be claimed on rejection');
  const ledger = f.o.deliveryLedger();
  assert.equal(ledger.delivered, 0);
  assert.equal(ledger.undelivered, 1, 'unacceptable work must NOT close the gap');
});

test('approving an UNLINKED job attests nothing', async t => {
  const f = fixture(t);
  f.o.recordBillingEvent(checkout('evt_9'));
  const job = (await f.call('owner', '/jobs', { idempotencyKey: 'internal-1', kind: 'video',
    payload: { workflowId: 'approved-local' } })).body.job;
  const lease = (await f.call('worker', '/next')).body.job;
  await f.call('worker', `/jobs/${job.id}/complete`,
    { quiescent: true, token: lease.lease.token, result: {}, artifacts: [ARTIFACT] });
  const r = await f.call('owner', `/jobs/${job.id}/approvals`,
    { category: 'visual', decision: 'approved', artifactSha256: SHA });
  assert.equal(r.status, 201);
  assert.equal(r.body.approval.delivery, undefined, 'internal renders have no promise to discharge');
  assert.equal(f.o.deliveryLedger().undelivered, 1);
});

test('linking refuses unknown targets and cannot be repointed', async t => {
  const f = fixture(t);
  const paid = f.o.recordBillingEvent(checkout('evt_2'));
  const op = paid.delivery.operationId;
  assert.equal(f.o.linkDeliveryJob('session:nope', 'nope').reason, 'unknown_operation');
  assert.equal(f.o.linkDeliveryJob(op, 'nope').reason, 'unknown_job');
  const a = (await f.call('owner', '/jobs', { idempotencyKey: 'j-a', kind: 'video', payload: { workflowId: 'approved-local' } })).body.job;
  const b = (await f.call('owner', '/jobs', { idempotencyKey: 'j-b', kind: 'video', payload: { workflowId: 'approved-local' } })).body.job;
  assert.equal(f.o.linkDeliveryJob(op, a.id).linked, true);
  assert.equal(f.o.linkDeliveryJob(op, b.id).reason, 'already_linked');
  assert.equal(f.o.linkDeliveryJob(op, a.id).receipt.jobId, a.id, 'the original link stands');
});
