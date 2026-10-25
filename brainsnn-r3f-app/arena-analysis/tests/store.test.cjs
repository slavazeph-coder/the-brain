'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {createStore, RESULT_TTL} = require('../store.cjs');
const {quoteCost} = require('../pricing.cjs');
const inputDigest = 'a'.repeat(64);

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-wallet-'));
  let clock = Date.UTC(2026, 9, 17), sequence = 0;
  const config = {dbPath: path.join(dir, 'analysis.sqlite'), now: () => clock, failureReserveCents: 10000, ...options};
  let store = createStore(config);
  t.after(() => {store.close(); fs.rmSync(dir, {recursive: true, force: true});});
  const owner = store.createWorkspace();
  const pricing = overrides => ({version: 'rates-v1', now: clock, validUntil: clock + 86400000, fxValidUntil: clock + 86400000, usdToCad: 1.6, inputUsdPerMillion: 4, outputUsdPerMillion: 20, infraCents: 10, supportCents: 20, paymentFeeBps: 860, ...overrides});
  return {
    get store() {return store;}, owner, config,
    advance(ms) {clock += ms;},
    fund(workspaceId = owner.workspaceId, fields = {}) {sequence++; return store.creditFunding({eventId: `evt-${sequence}`, paymentId: `pi-${sequence}`, workspaceId, amountCents: 5000, currency: 'cad', ...fields});},
    quote(workspaceId = owner.workspaceId, overrides = {}) {return store.createQuote({workspaceId, inputDigest, ...quoteCost({inputTokenUpperBound: 32000}, pricing()), ...overrides});},
    restart() {store.close(); store = createStore(config);},
  };
}
const reserve = (f, quote = f.quote(), workspaceId = f.owner.workspaceId) => f.store.reserveJob({workspaceId, quoteId: quote.id, inputDigest});

test('workspace recovery rotates sessions; other tenant cannot inspect jobs or quotes', t => {
  const f = fixture(t);
  assert.equal(f.store.getSession(f.owner.sessionToken).workspaceId, f.owner.workspaceId);
  assert.equal(f.store.getSession('wrong'), null);
  assert.throws(() => f.store.recoverWorkspace('wrong'), {code: 'UNAUTHORIZED'});
  const recovered = f.store.recoverWorkspace(f.owner.recoveryCode);
  assert.equal(f.store.getSession(f.owner.sessionToken), null);
  assert.equal(recovered.workspaceId, f.owner.workspaceId);
  assert.notEqual(recovered.sessionToken, f.owner.sessionToken);
  f.fund();
  const q = f.quote(), {job} = reserve(f, q), other = f.store.createWorkspace();
  assert.throws(() => f.store.getJob(other.workspaceId, job.id), {code: 'NOT_FOUND'});
  assert.throws(() => f.store.getQuote(other.workspaceId, q.id), {code: 'NOT_FOUND'});
  f.store.logout(recovered.sessionToken);
  assert.equal(f.store.getSession(recovered.sessionToken), null);
});

test('checkout is bound once, and funding requires its separate verified payment call', t => {
  const f = fixture(t), args = {workspaceId: f.owner.workspaceId, requestId: 'request-1'};
  const checkout = f.store.beginCheckout(args);
  assert.equal(f.store.beginCheckout(args).id, checkout.id);
  assert.equal(f.store.getCheckoutById(checkout.id).workspaceId, f.owner.workspaceId);
  const bind = {checkoutId: checkout.id, sessionId: 'cs_1', url: 'https://checkout.stripe.com/test'};
  f.store.bindCheckout(bind);
  assert.equal(f.store.bindCheckout(bind).sessionId, 'cs_1');
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 0);
  assert.throws(() => f.store.bindCheckout({...bind, sessionId: 'cs_2'}), {code: 'IDEMPOTENCY_CONFLICT'});
});

test('a webhook-first checkout binding permits its matching real URL later', t => {
  const f = fixture(t), checkout = f.store.beginCheckout({workspaceId: f.owner.workspaceId, requestId: 'webhook-first'});
  f.store.bindCheckout({checkoutId: checkout.id, sessionId: 'cs_race', url: 'https://checkout.stripe.com/'});
  f.store.bindCheckout({checkoutId: checkout.id, sessionId: 'cs_race', url: 'https://checkout.stripe.com/c/pay/race'});
  assert.equal(f.store.getCheckoutById(checkout.id).url, 'https://checkout.stripe.com/c/pay/race');
});

test('payment and event idempotency prevent duplicate funding across webhooks', t => {
  const f = fixture(t), funding = {eventId: 'evt-paid', paymentId: 'pi-paid', workspaceId: f.owner.workspaceId, amountCents: 5000, currency: 'cad', paymentFeeCents: 430};
  assert.equal(f.store.creditFunding(funding).credited, true);
  assert.equal(f.store.creditFunding(funding).credited, false);
  assert.equal(f.store.creditFunding({...funding, eventId: 'evt-paid-2'}).credited, false);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 5000);
  assert.throws(() => f.store.creditFunding({...funding, paymentId: 'pi-other'}), {code: 'IDEMPOTENCY_CONFLICT'});
  const other = f.store.createWorkspace();
  assert.throws(() => f.store.creditFunding({...funding, eventId: 'evt-other', workspaceId: other.workspaceId}), {code: 'IDEMPOTENCY_CONFLICT'});
  assert.throws(() => f.store.creditFunding({...funding, amountCents: 5001}), {code: 'INVALID_PAYMENT'});
  assert.throws(() => f.store.creditFunding({...funding, currency: 'usd'}), {code: 'INVALID_PAYMENT'});
});

test('out-of-order refunds and disputes cannot recreate spendable credit', t => {
  const f = fixture(t);
  const reversal = {eventId: 'evt-refund', paymentId: 'pi-reversed', reversedCents: 5000, disputed: true};
  f.store.reverseFunding(reversal);
  assert.equal(f.store.reverseFunding(reversal).changed, false);
  f.fund(undefined, {paymentId: 'pi-reversed'});
  const wallet = f.store.getWorkspace(f.owner.workspaceId).wallet;
  assert.equal(wallet.balanceCents, 0);
  assert.equal(wallet.availableCents, 0);
  assert.equal(wallet.frozen, true);
  f.store.reverseFunding({eventId: 'evt-older', paymentId: 'pi-reversed', reversedCents: 2500});
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 0);
  f.store.unfreezeWorkspace(f.owner.workspaceId);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.frozen, true, 'dispute cannot be cleared by manual workspace flag');
});

test('dispute fees are separately accounted once, including before funding', t => {
  const f = fixture(t);
  const reversal = {eventId: 'dispute-1', paymentId: 'pi-dispute', reversedCents: 5000, disputed: true, additionalFeeCents: 1500};
  f.store.reverseFunding(reversal);
  f.store.reverseFunding(reversal);
  f.store.reverseFunding({...reversal, eventId: 'dispute-update'});
  f.fund(undefined, {paymentId: 'pi-dispute'});
  assert.equal(f.store.getAccounting().additionalPaymentFeeCents, 1500);
  f.store.reverseFunding({...reversal, eventId: 'dispute-more', additionalFeeCents: 2000});
  assert.equal(f.store.getAccounting().additionalPaymentFeeCents, 2000);
});

test('unspent funding is a liability, never earned service revenue', t => {
  const f = fixture(t); f.fund();
  let a = f.store.getAccounting();
  assert.equal(a.fundedCents, 5000); assert.equal(a.unspentLiabilityCents, 5000); assert.equal(a.earnedRevenueCents, 0);
  const q = f.quote(), {job} = reserve(f, q);
  a = f.store.getAccounting();
  assert.equal(a.customerReservedCents, q.amountCents); assert.equal(a.earnedRevenueCents, 0);
  f.store.completeJob({jobId: job.id, result: {}, actualProviderCostCents: 7});
  a = f.store.getAccounting();
  assert.equal(a.unspentLiabilityCents, 5000 - q.amountCents); assert.equal(a.earnedRevenueCents, q.amountCents); assert.equal(a.providerExpenseCents, 7);
});

test('reservation is atomic, quote-bound and idempotent; success charges exactly once', t => {
  const f = fixture(t); f.fund();
  const q = f.quote(), first = reserve(f, q);
  assert.equal(first.created, true);
  assert.equal(reserve(f, q).created, false);
  assert.throws(() => f.store.reserveJob({workspaceId: f.owner.workspaceId, quoteId: q.id, inputDigest: 'b'.repeat(64)}), {code: 'EVIDENCE_CHANGED'});
  const held = f.store.getWorkspace(f.owner.workspaceId).wallet;
  assert.equal(held.balanceCents, 5000);
  assert.equal(held.reservedCents, q.amountCents);
  assert.equal(held.availableCents, 5000 - q.amountCents);
  assert.throws(() => reserve(f), {code: 'BUSY'});
  const completion = {jobId: first.job.id, result: {hypotheses: []}, actualProviderCostCents: 3};
  f.store.completeJob(completion); f.store.completeJob(completion);
  const done = f.store.getWorkspace(f.owner.workspaceId);
  assert.equal(done.wallet.balanceCents, 5000 - q.amountCents);
  assert.equal(done.wallet.reservedCents, 0);
  assert.equal(done.history.filter(row => row.kind === 'charge').length, 1);
  assert.equal(f.store.getBudget().outstandingCostCents, 0);
  assert.equal(f.store.getBudget().failureSpentCents, 0);
  f.advance(11 * 60000);
  assert.equal(reserve(f, q).job.status, 'succeeded', 'replay of consumed quote does not rerun after expiry');
});

test('two independent database connections cannot reserve simultaneous work', async t => {
  const f = fixture(t); f.fund();
  const quotes = [f.quote(), f.quote()];
  const workerSource = `const {parentPort,workerData}=require('node:worker_threads');const {createStore}=require(workerData.module);const store=createStore({...workerData.config,now:()=>workerData.clock,recoverOnOpen:false});parentPort.postMessage('ready');parentPort.once('message',()=>{try{parentPort.postMessage({ok:true,value:store.reserveJob(workerData.args)})}catch(error){parentPort.postMessage({ok:false,code:error.code})}finally{store.close()}});`;
  const workers = quotes.map(q => new Worker(workerSource, {eval: true, workerData: {module: require.resolve('../store.cjs'), config: {...f.config, now: undefined}, clock: Date.UTC(2026, 9, 17), args: {workspaceId: f.owner.workspaceId, quoteId: q.id, inputDigest}}}));
  t.after(() => Promise.all(workers.map(worker => worker.terminate())));
  await Promise.all(workers.map(worker => new Promise((resolve, reject) => {worker.once('message', resolve); worker.once('error', reject);})));
  const responses = workers.map(worker => new Promise((resolve, reject) => {worker.once('message', resolve); worker.once('error', reject);}));
  workers.forEach(worker => worker.postMessage('start'));
  const results = await Promise.all(responses);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, 'BUSY');
});

test('failed results release customer holds and consume only internal failure reserve', t => {
  const f = fixture(t, {failureReserveCents: 250}); f.fund();
  const {job} = reserve(f);
  const failure = {jobId: job.id, actualProviderCostCents: 10, error: 'Invalid model evidence. No charge.'};
  f.store.failJob(failure); f.store.failJob(failure);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 5000);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.reservedCents, 0);
  assert.equal(f.store.getBudget().failureSpentCents, 72);
  assert.equal(f.store.getBudget().failureReserveRemainingCents, 178);
  assert.throws(() => reserve(f), {code: 'COST_RESERVE_EXHAUSTED'});
});

test('unknown outcomes survive restart, freeze the customer and retain worst-case expense holds', t => {
  const f = fixture(t); f.fund();
  const q = f.quote(), {job} = reserve(f, q), maxCost = f.store.getQuote(f.owner.workspaceId, q.id).maxCostCents;
  f.restart();
  assert.equal(f.store.getJob(f.owner.workspaceId, job.id).status, 'uncertain');
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.reservedCents, 0);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 5000);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.frozen, true);
  assert.equal(f.store.getBudget().outstandingCostCents, maxCost);
  assert.throws(() => f.quote(), {code: 'WORKSPACE_FROZEN'});
  assert.throws(() => f.store.completeJob({jobId: job.id, result: {}, actualProviderCostCents: 0}), {code: 'JOB_NOT_RUNNING'});
  f.store.reconcileJob({jobId: job.id, actualProviderCostCents: 4});
  f.store.reconcileJob({jobId: job.id, actualProviderCostCents: 4});
  assert.equal(f.store.getJob(f.owner.workspaceId, job.id).status, 'failed');
  assert.equal(f.store.getBudget().outstandingCostCents, 0);
  assert.equal(f.store.getBudget().failureSpentCents, 66);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.frozen, false);
});

test('timeout remains internally reserved and creates no customer debit', t => {
  const f = fixture(t); f.fund(); const {job} = reserve(f);
  f.store.failJob({jobId: job.id, error: 'Provider timeout; no charge.'});
  assert.equal(f.store.getJob(f.owner.workspaceId, job.id).status, 'uncertain');
  assert.equal(f.store.getBudget().outstandingCostCents, 188);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 5000);
});

test('result expires after seven days without refunding earned revenue or deleting financial history', t => {
  const f = fixture(t); f.fund(); const q = f.quote(), {job} = reserve(f, q);
  f.store.completeJob({jobId: job.id, result: {hypotheses: ['bounded test']}, actualProviderCostCents: 0});
  f.advance(RESULT_TTL - 1);
  assert.ok(f.store.getJob(f.owner.workspaceId, job.id).result);
  f.advance(1);
  const expired = f.store.getJob(f.owner.workspaceId, job.id);
  assert.equal(expired.status, 'expired'); assert.equal(expired.result, undefined);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 5000 - q.amountCents);
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).history.filter(row => row.kind === 'charge').length, 1);
});

test('refund after spending cannot create credit; dispute freezes remaining balance', t => {
  const f = fixture(t); f.fund(undefined, {paymentId: 'pi-refund'});
  const q = f.quote(), {job} = reserve(f, q);
  f.store.completeJob({jobId: job.id, result: {}, actualProviderCostCents: 0});
  f.store.reverseFunding({eventId: 'evt-refunded', paymentId: 'pi-refund', reversedCents: 5000});
  const w = f.store.getWorkspace(f.owner.workspaceId).wallet;
  assert.equal(w.balanceCents, -q.amountCents); assert.equal(w.availableCents, 0); assert.equal(w.frozen, true);
  f.fund(undefined, {paymentId: 'pi-dispute'});
  f.store.reverseFunding({eventId: 'evt-disputed', paymentId: 'pi-dispute', reversedCents: 0, disputed: true});
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.frozen, true);
});

test('late payment fee corrections invalidate unpaid quotes and pause underpriced accepted work', t => {
  const f = fixture(t); f.fund(undefined, {paymentId: 'pi-fee'});
  const q = f.quote();
  f.store.updateFundingFee({eventId: 'fee-1', paymentId: 'pi-fee', paymentFeeCents: 500});
  assert.throws(() => reserve(f, q), {code: 'FEE_CHANGED'});
  const expensive = f.quote(undefined, {amountCents: 600, paymentFeeBps: 1000});
  reserve(f, expensive);
  f.store.updateFundingFee({eventId: 'fee-2', paymentId: 'pi-fee', paymentFeeCents: 600});
  assert.match(f.store.getBudget().paused, /Payment fees/);
});

test('partial refunds reallocate retained fees over net funding and identify the sunk fee subset', t => {
  const f = fixture(t); f.fund(undefined, {paymentId:'pi-partial',paymentFeeCents:430});
  const q = f.quote();
  f.store.reverseFunding({eventId:'refund-4000',paymentId:'pi-partial',reversedCents:4000});
  const w = f.store.getWorkspace(f.owner.workspaceId).wallet;
  assert.equal(w.balanceCents, 1000); assert.equal(w.maxPaymentFeeBps, 4300);
  assert.throws(() => reserve(f,q), {code:'FEE_CHANGED'});
  assert.equal(f.store.getAccounting().paymentFeeBoundCents, 430);
  assert.equal(f.store.getAccounting().refundedPaymentFeeBoundCents, 344);
});

test('provider overrun is recorded, never passed to customer, and pauses new work', t => {
  const f = fixture(t); f.fund(); const q = f.quote(), {job} = reserve(f, q);
  f.store.completeJob({jobId: job.id, result: {}, actualProviderCostCents: 1000});
  assert.equal(f.store.getWorkspace(f.owner.workspaceId).wallet.balanceCents, 5000 - q.amountCents);
  assert.match(f.store.getBudget().paused, /Provider cost/);
  assert.throws(() => reserve(f), {code: 'EXECUTION_PAUSED'});
});

test('quote validity, margin floor and empty balances fail before any reservation', t => {
  const f = fixture(t);
  assert.throws(() => reserve(f), {code: 'INSUFFICIENT_BALANCE'});
  assert.throws(() => f.quote(undefined, {amountCents: 200}), {code: 'INVALID_QUOTE'});
  f.fund(); const q = f.quote(); f.advance(10 * 60000);
  assert.throws(() => reserve(f, q), {code: 'QUOTE_EXPIRED'});
  assert.equal(f.store.getBudget().outstandingCostCents, 0);
});

test('all failed attempts count toward hourly and daily limits', t => {
  const f = fixture(t); f.fund();
  for (let i = 0; i < 6; i++) {const {job} = reserve(f); f.store.failJob({jobId: job.id, actualProviderCostCents: 0});}
  assert.throws(() => reserve(f), {code: 'RATE_LIMITED'});
  for (let batch = 0; batch < 3; batch++) {
    f.advance(3600001);
    const count = batch === 2 ? 2 : 6;
    for (let i = 0; i < count; i++) {const {job} = reserve(f); f.store.failJob({jobId: job.id, actualProviderCostCents: 0});}
  }
  assert.throws(() => reserve(f), {code: 'RATE_LIMITED'});
  f.advance(86400001);
  assert.equal(reserve(f).created, true);
});

test('ledger payment mode is permanently pinned; mismatched openings do not recover running jobs', t => {
  const f = fixture(t, {paymentMode: 'test'}); f.fund(); const {job} = reserve(f);
  assert.equal(f.store.getPaymentMode(), 'test');
  assert.equal(f.store.assertPaymentMode('test'), 'test');
  assert.throws(() => f.store.assertPaymentMode('live'), {code: 'PAYMENT_MODE_MISMATCH'});
  assert.throws(() => createStore({...f.config, paymentMode: 'live'}), {code: 'PAYMENT_MODE_MISMATCH'});
  assert.equal(f.store.getJob(f.owner.workspaceId, job.id).status, 'running');
  f.restart();
  assert.equal(f.store.getPaymentMode(), 'test');
});

test('unlabeled historical money cannot be relabeled live, but an empty ledger can be pinned', t => {
  const f = fixture(t); f.fund();
  assert.equal(f.store.getPaymentMode(), null);
  assert.throws(() => f.store.assertPaymentMode('live'), {code: 'PAYMENT_MODE_UNPINNED'});
  assert.throws(() => f.store.assertPaymentMode('test'), {code: 'PAYMENT_MODE_UNPINNED'});
  const empty = createStore({dbPath: ':memory:'});
  try {
    empty.createWorkspace();
    assert.equal(empty.assertPaymentMode('live'), 'live');
    assert.throws(() => empty.assertPaymentMode('unknown'), {code: 'PAYMENT_MODE_INVALID'});
  } finally {empty.close();}
});
