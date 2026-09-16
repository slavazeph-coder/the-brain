/**
 * Delivery attestation tests.
 *
 * Recording a payment proves the money moved. It proves nothing about the thing
 * that was sold, and an operator watching payment volume can take 18 of them,
 * publish nothing, and not notice for days. These tests pin the properties that
 * make the gap visible and honest:
 *
 *   1. EVERY payment opens a tracked promise, in the same transaction.
 *   2. NO DELIVERY WITHOUT EVIDENCE — an unverifiable claim is not attestation.
 *   3. THE GAP IS COUNTABLE — paid minus delivered, with overdue made explicit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestration } from '../src/server/orchestration.js';

const OWNER = 'o'.repeat(40), WORKER = 'w'.repeat(40);
const DAY = 24 * 60 * 60 * 1000;

function fixture(t, start = 1_000_000) {
  const dir = mkdtempSync(join(tmpdir(), 'brainsnn-delivery-'));
  const clock = { t: start };
  const o = createOrchestration({
    ORCHESTRATION_ENABLED: '1', ORCHESTRATION_SINGLE_REPLICA: '1',
    ORCHESTRATION_DB_PATH: join(dir, 'queue.db'),
    ORCHESTRATION_OWNER_KEY: OWNER, ORCHESTRATION_WORKER_KEY: WORKER,
  }, { now: () => clock.t });
  t.after(() => { o.close(); rmSync(dir, { recursive: true, force: true }); });
  return { o, clock };
}

const paid = (eventId, sessionId, meta = {}) => ({
  id: eventId, type: 'checkout.session.completed',
  data: { object: {
    id: sessionId, mode: 'payment', amount_total: 18500, currency: 'usd',
    customer: 'cus_1', customer_details: { email: 'buyer@example.com' },
    metadata: meta,
  } },
});

const OP = 'session:cs_live_a';

test('a payment opens a tracked promise, not just a record of money', (t) => {
  const { o } = fixture(t);
  const result = o.recordBillingEvent(paid('evt_1', 'cs_live_a', { kind: 'video-order' }));

  assert.equal(result.recorded, true);
  assert.ok(result.delivery, 'paying must open a delivery receipt');
  assert.equal(result.delivery.operationId, OP);
  assert.equal(result.delivery.state, 'awaiting_assets');
  assert.equal(result.delivery.evidenceLocator, null);
  assert.equal(result.delivery.deliveredAt, null);
  assert.ok(result.delivery.deadlineAt > 1_000_000, 'must carry a real deadline');
  assert.match(result.delivery.promisedArtifact, /b-roll/i);
});

test('a redelivered event does not open a second promise', (t) => {
  const { o } = fixture(t);
  o.recordBillingEvent(paid('evt_1', 'cs_live_a'));
  const again = o.recordBillingEvent(paid('evt_1', 'cs_live_a'));
  assert.equal(again.duplicate, true);
  assert.equal(o.deliveryLedger().states.awaiting_assets, 1);
});

test('delivery is REFUSED without evidence', (t) => {
  const { o } = fixture(t);
  o.recordBillingEvent(paid('evt_1', 'cs_live_a'));

  for (const value of [{}, { evidenceLocator: '' }, { evidenceLocator: '   ' },
                       { evidenceLocator: null }]) {
    const r = o.claimDelivery(OP, value);
    assert.equal(r.claimed, false, `must refuse: ${JSON.stringify(value)}`);
    assert.equal(r.reason, 'evidence_required');
  }
  assert.equal(o.deliveryLedger().delivered, 0, 'a refused claim must not deliver');
});

test('an unknown operation cannot be delivered', (t) => {
  const { o } = fixture(t);
  const r = o.claimDelivery('session:never_existed', { evidenceLocator: 'https://x/y.mp4' });
  assert.equal(r.claimed, false);
  assert.equal(r.reason, 'unknown_operation');
});

test('an invented evidence string cannot discharge a promise', (t) => {
  // The hole independent review found: claimDelivery(op, {evidenceLocator:'x'})
  // used to clear the gap with no job, no artifact and no approval attached --
  // the original failure wearing a receipt.
  const { o } = fixture(t);
  o.recordBillingEvent(paid('evt_1', 'cs_live_a', { kind: 'video-order' }));

  const r = o.claimDelivery(OP, {
    evidenceLocator: 'https://www.brainsnn.com/deliveries/abc.mp4', sha256: 'a'.repeat(64) });
  assert.equal(r.claimed, false);
  assert.equal(r.reason, 'no_linked_job',
    'work not linked to a render cannot be attested as delivered');
  assert.equal(o.claimDelivery(OP, { evidenceLocator: 'x', sha256: 'a'.repeat(64) }).reason,
    'invalid_locator', 'a placeholder does not locate anything');
  assert.equal(o.deliveryLedger().delivered, 0, 'the gap must stay open');
  assert.equal(o.deliveryLedger().undelivered, 1);
});

test('a malformed digest is rejected rather than stored', (t) => {
  const { o } = fixture(t);
  o.recordBillingEvent(paid('evt_1', 'cs_live_a'));
  const r = o.claimDelivery(OP, { evidenceLocator: 'https://x/y.mp4', sha256: 'nothex' });
  assert.equal(r.claimed, false);
  assert.equal(r.reason, 'invalid_digest');
});

test('discharging a promise is refused at every step that lacks proof', (t) => {
  const { o } = fixture(t);
  o.recordBillingEvent(paid('evt_1', 'cs_live_a', { kind: 'video-order' }));
  const sha = 'a'.repeat(64);
  assert.equal(o.claimDelivery(OP, { evidenceLocator: 'https://x/1.mp4', sha256: sha }).reason,
    'no_linked_job');
  assert.equal(o.claimDelivery(OP, { evidenceLocator: 'https://x/1.mp4' }).reason,
    'invalid_digest');
  assert.equal(o.claimDelivery(OP, { sha256: sha }).reason, 'evidence_required');
  assert.equal(o.deliveryLedger().delivered, 0, 'none of those may count as delivered');
});

test('past its deadline, an undelivered order becomes OVERDUE', (t) => {
  const { o, clock } = fixture(t);
  o.recordBillingEvent(paid('evt_1', 'cs_live_a'));
  assert.equal(o.deliveryLedger().overdue, 0, 'not overdue on day zero');

  clock.t += 8 * DAY;
  const ledger = o.deliveryLedger();
  assert.equal(ledger.overdue, 1, 'silence past the deadline must become a countable fact');
  assert.equal(ledger.gap[0].state, 'overdue');
});

test('THE ACTUAL FAILURE: many paid, none delivered, is visible as a gap', (t) => {
  const { o, clock } = fixture(t);
  for (let i = 0; i < 18; i += 1) {
    o.recordBillingEvent(paid(`evt_${i}`, `cs_live_${i}`, { kind: 'video-order' }));
  }
  clock.t += 8 * DAY;

  const ledger = o.deliveryLedger();
  assert.equal(ledger.paid, 18);
  assert.equal(ledger.delivered, 0);
  assert.equal(ledger.undelivered, 18, 'payment volume with zero deliveries must be legible');
  assert.equal(ledger.overdue, 18);
  assert.equal(ledger.gap.length, 18);
  assert.ok(ledger.gap.every(r => r.promisedArtifact && r.deadlineAt),
    'each gap entry names what was promised and by when');
});

test('the gap count and the gap list agree', (t) => {
  // `paid - delivered` used to be the count while `gap` came from receipts. Two
  // different populations, so the ledger could report a gap of zero while
  // unreceipted orders rotted. They must come from one source.
  const { o, clock } = fixture(t);
  o.recordBillingEvent(paid('evt_1', 'cs_live_a', { kind: 'video-order' }));
  o.recordBillingEvent(paid('evt_2', 'cs_live_b', { kind: 'video-order' }));
  clock.t += 8 * DAY;

  const ledger = o.deliveryLedger();
  assert.equal(ledger.paid, 2);
  assert.equal(ledger.delivered, 0);
  assert.equal(ledger.undelivered, 2);
  assert.equal(ledger.gap.length, ledger.undelivered, 'count and list must agree');
  assert.equal(ledger.unreceipted, 0, 'both orders have promises');
  assert.equal(ledger.gap[0].state, 'overdue');
});

test('the owner snapshot carries the gap, not just the money', (t) => {
  const { o } = fixture(t);
  o.recordBillingEvent(paid('evt_1', 'cs_live_a'));
  const snap = o.snapshot();
  assert.ok(snap.deliveries, 'ops status must expose delivery state');
  assert.equal(snap.deliveries.paid, 1);
  assert.equal(snap.deliveries.delivered, 0);
  assert.equal(snap.deliveries.undelivered, 1);
});
