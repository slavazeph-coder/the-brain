/**
 * Hardening tests for defects found by independent adversarial review
 * (Claude + Codex/astra-6). Each one failed before its fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createOrchestration } from '../src/server/orchestration.js';

const OWNER = 'o'.repeat(40), WORKER = 'w'.repeat(40);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'brainsnn-hardening-'));
  const env = { ORCHESTRATION_ENABLED: '1', ORCHESTRATION_SINGLE_REPLICA: '1',
    ORCHESTRATION_DB_PATH: join(dir, 'queue.db'), ORCHESTRATION_OWNER_KEY: OWNER, ORCHESTRATION_WORKER_KEY: WORKER };
  const o = createOrchestration(env, { now: () => 5000, leaseMs: 1000 });
  const dispatch = (req, res) => {
    const owner = req.url.startsWith('/owner/');
    req.url = req.url.replace(/^\/(owner|worker)/, '');
    return (owner ? o.handleOwner : o.handleWorker)(req, res);
  };
  const call = async (surface, path, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.headers = { authorization: `Bearer ${surface === 'owner' ? OWNER : WORKER}`, 'x-brainsnn-worker': 'worker_1', 'content-type': 'application/json' };
    req.method = body === undefined ? 'GET' : 'POST'; req.url = `/${surface}${path}`;
    const chunks = []; let status = 200;
    const res = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
    res.setHeader = () => {}; res.writeHead = code => { status = code; };
    const finished = new Promise(r => res.once('finish', r));
    await dispatch(req, res); await finished;
    return { status, body: JSON.parse(Buffer.concat(chunks).toString()) };
  };
  t.after(() => { o.close(); rmSync(dir, { recursive: true, force: true }); });
  return { o, call, db: () => new DatabaseSync(join(dir, 'queue.db')) };
}

const checkout = (id, obj = {}) => ({ id, type: 'checkout.session.completed', data: { object: {
  id: 'cs_' + id, mode: 'payment', amount_total: 6500, currency: 'usd',
  customer: 'cus_1', customer_details: { email: 'b@e.com' }, ...obj } } });

test('an UNPAID checkout is not a sale and opens no promise', (t) => {
  const { o } = fixture(t);
  const r = o.recordBillingEvent(checkout('evt_unpaid', { payment_status: 'unpaid' }));
  assert.equal(r.recorded, true);
  assert.equal(r.order.settled, false, 'unsettled must be reported as such');
  assert.equal(r.delivery, null, 'no promise for money that has not arrived');
  const l = o.deliveryLedger();
  assert.equal(l.paid, 1);
  assert.equal(l.undelivered, 0, 'an unpaid order must not appear as undelivered work');
  assert.equal(l.unreceipted, 1, 'and it must still be visible as unreceipted');
});

test('the delayed async success settles it and opens the promise', (t) => {
  const { o } = fixture(t);
  o.recordBillingEvent(checkout('evt_unpaid', { payment_status: 'unpaid' }));
  const s = o.recordBillingEvent({ id: 'evt_async', type: 'checkout.session.async_payment_succeeded',
    data: { object: { id: 'cs_evt_unpaid', mode: 'payment', amount_total: 6500, currency: 'usd',
      customer: 'cus_1', metadata: {} } } });
  assert.equal(s.order.settled, true);
  assert.ok(s.delivery, 'settlement is when the promise appears');
  assert.equal(o.deliveryLedger().undelivered, 1);
});

test('a non-numeric amount is refused rather than filed as $0', (t) => {
  const { o } = fixture(t);
  const r = o.recordBillingEvent(checkout('evt_bad', { amount_total: 'six thousand' }));
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'invalid_amount');
  assert.equal(o.deliveryLedger().paid, 0, 'nothing may be recorded');
});

test('a redelivered event cannot rewind a status intake already advanced', (t) => {
  const { o, db } = fixture(t);
  o.recordBillingEvent(checkout('evt_1', { metadata: { kind: 'video-order' } }));
  const conn = db();
  conn.exec("UPDATE billing_orders SET status='fulfilled' WHERE session_id='cs_evt_1'");
  conn.close();
  o.recordBillingEvent(checkout('evt_2', { metadata: { kind: 'video-order' } }));
  const after = db().prepare('SELECT status FROM billing_orders WHERE session_id=?').get('cs_evt_1');
  assert.equal(after.status, 'fulfilled', 'a late event must not undo progress');
});

test('a delayed active event does not resurrect a canceled subscription', (t) => {
  const { o } = fixture(t);
  const sub = (id, status) => ({ id, type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status, customer: 'cus_1' } } });
  o.recordBillingEvent(sub('evt_cancel', 'canceled'));
  o.recordBillingEvent(sub('evt_late_active', 'active'));
  assert.equal(o.billingSummary().activeSubscriptions, 0, 'cancellation is terminal');
});

test('a delayed checkout does not revive a canceled subscription', (t) => {
  const { o } = fixture(t);
  o.recordBillingEvent({ id: 'evt_c', type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_9', status: 'canceled', customer: 'cus_1' } } });
  o.recordBillingEvent(checkout('evt_late', { subscription: 'sub_9', mode: 'subscription' }));
  assert.equal(o.billingSummary().activeSubscriptions, 0);
});

test('subscriptions do not open per-subscriber delivery promises', (t) => {
  const { o } = fixture(t);
  const r = o.recordBillingEvent(checkout('evt_sub', { subscription: 'sub_5', mode: 'subscription' }));
  assert.equal(r.delivery, null, 'recurring access is not a one-shot deliverable');
  assert.equal(o.deliveryLedger().undelivered, 0);
});

test('two promises cannot share one job', async (t) => {
  const { o, call } = fixture(t);
  o.recordBillingEvent(checkout('evt_a'));
  o.recordBillingEvent(checkout('evt_b'));
  const job = (await call('owner', '/jobs', { idempotencyKey: 'k1', kind: 'video', payload: { workflowId: 'wf' } })).body.job;
  const first = await call('owner', '/deliveries/link', { operationId: 'session:cs_evt_a', jobId: job.id });
  assert.equal(first.status, 200);
  const second = await call('owner', '/deliveries/link', { operationId: 'session:cs_evt_b', jobId: job.id });
  assert.equal(second.status, 400, 'the second promise must be refused, not stranded');
  assert.equal(second.body.reason, 'job_already_linked');
});
