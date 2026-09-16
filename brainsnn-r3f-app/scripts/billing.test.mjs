/**
 * Billing recording tests.
 *
 * The webhook used to verify its signature and then only console.log the event,
 * so a paid order left no trace. These tests pin the two properties that make
 * recording money safe:
 *
 *   1. IDEMPOTENT — Stripe redelivers. A repeated event must not double-record.
 *   2. NO DOUBLE FULFILMENT — a paid video order creates exactly one job, and a
 *      redelivery cannot queue a second render.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestration } from '../src/server/orchestration.js';
import { DatabaseSync } from 'node:sqlite';

const OWNER = 'o'.repeat(40), WORKER = 'w'.repeat(40);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'brainsnn-billing-'));
  const path = join(dir, 'queue.db');
  const env = {
    ORCHESTRATION_ENABLED: '1', ORCHESTRATION_SINGLE_REPLICA: '1',
    ORCHESTRATION_DB_PATH: path,
    ORCHESTRATION_OWNER_KEY: OWNER, ORCHESTRATION_WORKER_KEY: WORKER,
  };
  const o = createOrchestration(env, { now: () => 5000 });
  t.after(() => { o.close(); rmSync(dir, { recursive: true, force: true }); });
  // Exposed so tests can assert what is PERSISTED. Asserting the value returned
  // by the same call that wrote it proves nothing: delete the write and the
  // echo still matches.
  return { o, db: () => new DatabaseSync(path) };
}

const sessionCompleted = (id, meta = {}, extra = {}) => ({
  id, type: 'checkout.session.completed',
  data: { object: {
    id: 'cs_test_1', mode: 'payment', amount_total: 6500, currency: 'usd',
    customer: 'cus_1', customer_details: { email: 'buyer@example.com' },
    metadata: meta, ...extra,
  } },
});

test('records a completed checkout exactly once', (t) => {
  const { o } = fixture(t);
  const first = o.recordBillingEvent(sessionCompleted('evt_1'));
  assert.equal(first.recorded, true);
  assert.equal(first.order.sessionId, 'cs_test_1');
  assert.equal(first.order.amount, 6500);
  assert.equal(first.order.currency, 'usd');
  assert.equal(first.order.email, 'buyer@example.com');

  // Stripe redelivers the same event id: must not double-record.
  const second = o.recordBillingEvent(sessionCompleted('evt_1'));
  assert.equal(second.recorded, false);
  assert.equal(second.duplicate, true);

  const summary = o.billingSummary();
  assert.equal(summary.orders, 1, 'a redelivered event must not create a second order');
});

test('a paid video order is recorded once and awaits assets, not a phantom job', (t) => {
  const { o, db } = fixture(t);
  const event = sessionCompleted('evt_job', { kind: 'video-order', move: 'turntable' });
  const first = o.recordBillingEvent(event);
  assert.equal(first.recorded, true);
  assert.equal(first.order.kind, 'video-order');

  o.recordBillingEvent(event); // same event id
  o.recordBillingEvent({ ...event, id: 'evt_job_2' }); // NEW event id, same session

  const summary = o.billingSummary();
  assert.equal(summary.orders, 1, 'one session must be one order');
  const order = db().prepare('SELECT status, job_id FROM billing_orders WHERE session_id=?').get('cs_test_1');
  assert.equal(order.status, 'paid_awaiting_assets', 'the status must be PERSISTED, not just echoed');
  assert.equal(order.job_id, null, 'no render is queued before the asset exists');
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM delivery_receipts').get().n, 1,
    'the payment must have opened exactly one promise, redelivery included');
  // A render genuinely cannot be queued yet: submit() requires payload.workflowId,
  // which intake can only build from the photo the buyer has not sent. Queuing one
  // at payment time threw, and the rollback took the payment record with it.
  assert.equal(o.snapshot().jobs.filter((j) => j.kind === 'video').length, 0);
});

test('subscription lifecycle upserts one row and tracks status', (t) => {
  const { o, db } = fixture(t);
  o.recordBillingEvent({
    id: 'evt_sub_1', type: 'customer.subscription.created',
    data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', customer_email: 's@example.com', metadata: { plan: 'pro' } } },
  });
  const created = db().prepare('SELECT status, plan FROM billing_subscriptions WHERE subscription_id=?').get('sub_1');
  assert.equal(created?.status, 'active', 'the created status must be PERSISTED, not merely echoed');
  assert.equal(created?.plan, 'pro');

  o.recordBillingEvent({
    id: 'evt_sub_2', type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', metadata: { plan: 'pro' } } },
  });
  const updated = db().prepare('SELECT status FROM billing_subscriptions WHERE subscription_id=?').get('sub_1');
  assert.equal(updated?.status, 'past_due', 'the update must change the STORED row');
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM billing_subscriptions').get().n, 1,
    'an upsert must not create a second row');

  const summary = o.billingSummary();
  assert.equal(summary.activeSubscriptions, 0, 'past_due is not active');
  assert.equal(o.snapshot().billing.orders, 0);
});

test('cancellation is recorded rather than ignored', (t) => {
  const { o, db } = fixture(t);
  o.recordBillingEvent({
    id: 'evt_c1', type: 'customer.subscription.created',
    data: { object: { id: 'sub_9', status: 'active', customer: 'cus_9' } },
  });
  assert.equal(o.billingSummary().activeSubscriptions, 1);
  o.recordBillingEvent({
    id: 'evt_c2', type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_9', status: 'canceled', customer: 'cus_9' } },
  });
  // The stored row, not the summary alone: a dropped cancellation would also
  // read as zero active subscriptions, so the count cannot distinguish them.
  const row = db().prepare('SELECT status FROM billing_subscriptions WHERE subscription_id=?').get('sub_9');
  assert.equal(row?.status, 'canceled', 'the cancellation must be PERSISTED, not deleted');
  assert.equal(o.billingSummary().activeSubscriptions, 0, 'a cancellation must not be dropped');
});

test('malformed and unknown events are refused without throwing', (t) => {
  const { o } = fixture(t);
  assert.equal(o.recordBillingEvent({}).recorded, false);
  assert.equal(o.recordBillingEvent(null).reason, 'malformed_event');
  assert.equal(o.recordBillingEvent({ id: 'evt_x' }).reason, 'malformed_event');
  // An untracked type is still acknowledged (audit trail), with no side effect.
  const other = o.recordBillingEvent({ id: 'evt_y', type: 'invoice.paid', data: { object: {} } });
  assert.equal(other.recorded, true);
  assert.equal(other.order, null);
  assert.equal(o.billingSummary().orders, 0);
});

test('unconfigured orchestration refuses instead of pretending to record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brainsnn-unconf-'));
  const o = createOrchestration({ ORCHESTRATION_DB_PATH: join(dir, 'x.db') }, { now: () => 1 });
  try {
    const result = o.recordBillingEvent(sessionCompleted('evt_u'));
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'unconfigured');
  } finally {
    o.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
