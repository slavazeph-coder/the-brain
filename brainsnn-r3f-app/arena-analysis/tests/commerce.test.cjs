'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { createStore } = require('../store.cjs');
const { createCommerce } = require('../commerce.cjs');
const { settings, readiness } = require('../config.cjs');
const { quoteCost } = require('../pricing.cjs');

function fixture(t, overrides = {}) {
  const store = createStore({ dbPath: ':memory:', failureReserveCents: 10000 });
  t.after(() => store.close());
  const owner = store.createWorkspace();
  const config = { stripeKey: 'sk_test_offline_only', webhookSecret: 'whsec_offline_only', origin: 'https://www.brainsnn.com', taxMode: 'registered', taxCode: 'txcd_10103000', ...overrides };
  const state = { session: null, intent: null, charge: null, dispute: null, createCalls: 0, registrations: [{ id: 'tax-registration' }], params: null };
  const stripe = {
    tax: { registrations: { list: async () => ({ data: state.registrations }) } },
    checkout: { sessions: {
      create: async (params, options) => {
        state.createCalls++; state.params = params; state.options = options;
        state.session = { id: 'cs_test_1', livemode: false, status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_test_1', metadata: params.metadata, client_reference_id: params.client_reference_id };
        return state.session;
      },
      retrieve: async () => state.session,
    } },
    charges: { retrieve: async () => state.charge },
    paymentIntents: { retrieve: async () => state.intent },
    disputes: { retrieve: async () => state.dispute },
    webhooks: new Stripe('sk_test_offline_only').webhooks,
  };
  const commerce = createCommerce({ store, stripe, config });
  async function checkout() { return commerce.checkout(owner.workspaceId, 'checkout_request_123456'); }
  async function paid({ fee = 210, tax = 650 } = {}) {
    if (!state.session) await checkout();
    state.charge = { id: 'ch_1', livemode: false, payment_intent: 'pi_1', amount: 5000 + tax, amount_captured: 5000 + tax, amount_refunded: 0, currency: 'cad', captured: true, paid: true,
      balance_transaction: { id: 'txn_1', currency: 'cad', source: 'ch_1', fee } };
    state.intent = { id: 'pi_1', livemode: false, latest_charge: state.charge, metadata: { ...state.session.metadata }, status: 'succeeded', currency: 'cad', amount: 5000 + tax, amount_received: 5000 + tax };
    Object.assign(state.session, { status: 'complete', mode: 'payment', payment_status: 'paid', currency: 'cad', amount_subtotal: 5000, amount_total: 5000 + tax,
      total_details: { amount_tax: tax, amount_shipping: 0, amount_discount: 0 }, automatic_tax: { status: 'complete' }, payment_intent: state.intent,
      line_items: { has_more: false, data: [{ quantity: 1, price: { unit_amount: 5000, currency: 'cad', tax_behavior: 'exclusive' } }] } });
  }
  const event = (type = 'checkout.session.completed', eventId = 'evt_paid') => ({ id: eventId, livemode: false, type, data: { object: type.startsWith('checkout.') ? { id: state.session.id, metadata: state.session.metadata } : type.startsWith('charge.dispute') ? state.dispute : state.charge } });
  return { store, owner, state, stripe, config, commerce, checkout, paid, event, wallet: () => store.getWorkspace(owner.workspaceId).wallet };
}

test('checkout is C$50 plus configured tax, idempotent, and never grants credit from redirect', async t => {
  const f = fixture(t); await f.checkout(); await f.checkout();
  assert.equal(f.state.createCalls, 1); assert.equal(f.wallet().balanceCents, 0);
  assert.equal(f.state.params.line_items[0].price_data.unit_amount, 5000);
  assert.equal(f.state.params.line_items[0].price_data.tax_behavior, 'exclusive');
  assert.equal(f.state.params.automatic_tax.enabled, true);
  assert.ok(f.state.options.idempotencyKey.startsWith('analysis-checkout-'));
  assert.equal(f.state.params.payment_intent_data.metadata.workspaceId, f.owner.workspaceId);
  f.state.session.url = 'https://checkout.stripe.com.evil.example/';
  await assert.rejects(f.checkout(), { code: 'checkout_url' });
});

test('a lost Stripe create response retries identical parameters and preserves one checkout session', async t => {
  const f = fixture(t); let clock = Date.now(), attempts = 0, originalParameters, originalKey;
  const create = f.stripe.checkout.sessions.create;
  f.stripe.checkout.sessions.create = async (parameters, options) => {
    attempts++;
    if(attempts===1) {
      originalParameters=structuredClone(parameters); originalKey=options.idempotencyKey;
      await create(parameters,options);
      throw new Error('Simulated lost HTTP response after Stripe created the session');
    }
    assert.deepEqual(parameters,originalParameters,'Stripe retry parameters must not change with wall time');
    assert.equal(options.idempotencyKey,originalKey);
    return f.state.session;
  };
  const commerce=createCommerce({store:f.store,stripe:f.stripe,config:f.config,now:()=>clock});
  const checkout=()=>commerce.checkout(f.owner.workspaceId,'stable_retry_request_123456');
  await assert.rejects(checkout(),/lost HTTP response/);
  const pending=f.store.getCheckout(f.owner.workspaceId,'stable_retry_request_123456');
  assert.equal(pending.sessionId,null); assert.equal(originalParameters.expires_at,Math.floor(pending.createdAt/1000)+3600);
  clock=pending.createdAt+10000;
  await checkout(); assert.equal(attempts,2); assert.equal(f.state.createCalls,1);
  assert.equal(f.store.getCheckout(f.owner.workspaceId,'stable_retry_request_123456').sessionId,'cs_test_1');
  clock=pending.createdAt+31*60*1000;
  await checkout(); assert.equal(attempts,2,'an already-bound open checkout is retrieved, never recreated');
  assert.equal(f.wallet().balanceCents,0);
});

test('an old unbound checkout is refused before another Stripe create attempt', async t => {
  const f=fixture(t), pending=f.store.beginCheckout({workspaceId:f.owner.workspaceId,requestId:'expired_attempt_123456'});
  const commerce=createCommerce({store:f.store,stripe:f.stripe,config:f.config,now:()=>pending.createdAt+30*60*1000});
  await assert.rejects(commerce.checkout(f.owner.workspaceId,'expired_attempt_123456'),{code:'checkout_expired'});
  assert.equal(f.state.createCalls,0); assert.equal(f.wallet().balanceCents,0);
});

test('only paid completed sessions grant one net-service balance; duplicates and async replay do not double-credit', async t => {
  const f = fixture(t); await f.paid(); f.state.session.payment_status = 'unpaid';
  await f.commerce.payment(f.event()); assert.equal(f.wallet().balanceCents, 0);
  f.state.session.payment_status = 'paid';
  await f.commerce.payment(f.event()); await f.commerce.payment(f.event());
  await f.commerce.payment(f.event('checkout.session.async_payment_succeeded', 'evt_async'));
  assert.equal(f.wallet().balanceCents, 5000); assert.equal(f.wallet().maxPaymentFeeBps, 420);
  assert.equal(f.store.getAccounting().fundedCents, 5000);
  assert.equal(f.store.getAccounting().earnedRevenueCents, 0);
});

test('missing or foreign-settlement fee cannot fund paid provider execution', async t => {
  const f = fixture(t); await f.paid();
  for (const balance of [null, 'txn_not_expanded', { currency: 'usd', fee: 210, source: 'ch_1' }, { currency: 'cad', fee: -1, source: 'ch_1' }, { currency: 'cad', fee: 210, source: 'other-charge' }]) {
    f.state.charge.balance_transaction = balance;
    await assert.rejects(f.commerce.payment(f.event()), { code: 'payment_fee_pending', status: 503 });
    assert.equal(f.wallet().balanceCents, 0);
  }
  f.state.charge.balance_transaction = { currency: 'cad', fee: 500, source: 'ch_1' };
  await f.commerce.payment(f.event()); assert.equal(f.wallet().maxPaymentFeeBps, 1000);
});

test('session, intent, charge and tax bindings must agree with the stored workspace', async t => {
  const f = fixture(t);
  const mutations = [
    () => f.state.session.metadata.workspaceId = 'different-workspace',
    () => f.state.session.client_reference_id = 'different-checkout',
    () => f.state.intent.metadata.workspaceId = 'different-workspace',
    () => f.state.intent.metadata.checkoutId = 'different-checkout',
    () => f.state.intent.amount_received = 4999,
    () => f.state.intent.status = 'processing',
    () => f.state.charge.payment_intent = 'pi_other',
    () => f.state.charge.captured = false,
    () => f.state.charge.amount_captured = 4999,
    () => f.state.session.total_details.amount_discount = 1,
    () => f.state.session.automatic_tax.status = 'requires_location_inputs',
    () => f.state.session.line_items.has_more = true,
    () => f.state.session.amount_total = 5000,
    () => f.state.session.line_items.data[0].price.tax_behavior = 'inclusive',
  ];
  await f.paid(); const original = structuredClone(f.state.session);
  for (const mutation of mutations) {
    f.state.session = structuredClone(original); f.state.intent = f.state.session.payment_intent; f.state.charge = f.state.intent.latest_charge;
    mutation(); await assert.rejects(f.commerce.payment(f.event())); assert.equal(f.wallet().balanceCents, 0);
  }
});

test('funding cannot be reused across workspaces even with a second matching checkout', async t => {
  const f = fixture(t); await f.paid(); await f.commerce.payment(f.event());
  const second = f.store.createWorkspace(), row = f.store.beginCheckout({ workspaceId: second.workspaceId, requestId: 'another_checkout_123456' });
  f.state.session.id = 'cs_test_2'; f.state.session.client_reference_id = row.id;
  f.state.session.metadata = { product: 'brainsnn_analysis_v1', checkoutId: row.id, workspaceId: second.workspaceId };
  f.state.intent.metadata = { ...f.state.session.metadata };
  await assert.rejects(f.commerce.payment(f.event('checkout.session.completed', 'evt_other_workspace')), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(f.store.getWorkspace(second.workspaceId).wallet.balanceCents, 0); assert.equal(f.wallet().balanceCents, 5000);
});

test('refund before fulfillment and old/duplicate events cannot restore returned principal', async t => {
  const f = fixture(t); await f.paid(); f.state.charge.amount_refunded = 5000;
  await f.commerce.payment(f.event('charge.refunded', 'evt_refund'));
  await f.commerce.payment(f.event()); assert.equal(f.wallet().availableCents, 0);
  await f.commerce.payment(f.event('charge.refunded', 'evt_refund')); assert.equal(f.wallet().balanceCents, 0);
  f.state.charge.amount_refunded = 1000;
  await f.commerce.payment(f.event('charge.refunded', 'evt_older_refund')); assert.equal(f.wallet().balanceCents, 0);
  assert.equal(f.store.getAccounting().reversedCents, 5000, 'refund must not assume proportional tax and leave 575 cents');
});

test('same delivered event with a later retrieved fee updates the bound without a duplicate grant', async t => {
  const f = fixture(t); await f.paid(); await f.commerce.payment(f.event());
  f.state.charge.balance_transaction.fee = 600;
  await f.commerce.payment(f.event());
  assert.equal(f.wallet().balanceCents, 5000); assert.equal(f.wallet().maxPaymentFeeBps, 1200);
  f.state.charge.balance_transaction.fee = 100;
  await f.commerce.payment(f.event('charge.updated', 'evt_older_fee'));
  assert.equal(f.wallet().maxPaymentFeeBps, 1200);
});

test('dispute before payment freezes funding and missing fees cannot leave it spendable', async t => {
  const f = fixture(t); await f.paid();
  f.state.dispute = { id: 'dp_1', livemode: false, charge: 'ch_1', balance_transactions: ['unexpanded'] };
  await assert.rejects(f.commerce.payment(f.event('charge.dispute.created', 'evt_dispute')), { code: 'dispute_fee_pending' });
  await f.commerce.payment(f.event()); assert.equal(f.wallet().availableCents, 0); assert.equal(f.wallet().frozen, true);
  f.state.dispute.balance_transactions = [{ currency: 'cad', fee: 1500 }];
  await f.commerce.payment(f.event('charge.dispute.created', 'evt_dispute'));
  await f.commerce.payment(f.event('charge.dispute.closed', 'evt_dispute_closed'));
  assert.equal(f.store.getAccounting().additionalPaymentFeeCents, 1500); assert.equal(f.wallet().frozen, true);
});

test('test/live mode mismatch is rejected for funding, fees, refunds and disputes', async t => {
  const f = fixture(t); await f.paid();
  for (const type of ['checkout.session.completed', 'charge.updated', 'charge.refunded', 'charge.dispute.created']) {
    const event = { ...f.event(type), livemode: true }; await assert.rejects(f.commerce.payment(event), { code: 'payment_mode' });
  }
  f.state.session.livemode = true;
  await assert.rejects(f.commerce.payment(f.event()), { code: 'payment_mode' }); assert.equal(f.wallet().balanceCents, 0);
});

test('actual Stripe signature verification rejects forged, stale and modified payloads', async t => {
  const f = fixture(t); await f.paid();
  const payload = JSON.stringify(f.event());
  const signature = f.stripe.webhooks.generateTestHeaderString({ payload, secret: f.config.webhookSecret });
  assert.equal(f.commerce.verify(Buffer.from(payload), signature).id, 'evt_paid');
  assert.throws(() => f.commerce.verify(Buffer.from(payload + ' '), signature), { code: 'webhook_signature' });
  assert.throws(() => f.commerce.verify(Buffer.from(payload), 'forged'), { code: 'webhook_signature' });
  const stale = f.stripe.webhooks.generateTestHeaderString({ payload, secret: f.config.webhookSecret, timestamp: Math.floor(Date.now() / 1000) - 301 });
  assert.throws(() => f.commerce.verify(Buffer.from(payload), stale), { code: 'webhook_signature' });
});

test('tax registration is checked before starting registered-tax checkout', async t => {
  const f = fixture(t); f.state.registrations = [];
  await assert.rejects(f.checkout(), { code: 'tax_registration' }); assert.equal(f.state.createCalls, 0);
});

test('readiness prevents test funding in production, insecure origins, unmounted DB and shared free-route provider keys', () => {
  const now = Date.now();
  const env = { NODE_ENV: 'production', APP_URL: 'https://www.brainsnn.com', ARENA_ANALYSIS_ENABLED: 'true', ARENA_ANALYSIS_PAYMENTS_ENABLED: 'true',
    ARENA_ANALYSIS_GEMINI_API_KEY: 'dedicated-provider', ARENA_ANALYSIS_STRIPE_KEY: 'sk_live_offline_only', ARENA_ANALYSIS_STRIPE_WEBHOOK_SECRET: 'whsec_offline_only',
    ARENA_ANALYSIS_PROVIDER_VERIFIED: 'true', ARENA_ANALYSIS_PAYMENT_VERIFIED: 'true', ARENA_ANALYSIS_SINGLE_REPLICA: 'true',
    RAILWAY_VOLUME_MOUNT_PATH: '/data', ARENA_ANALYSIS_FAILURE_RESERVE_CENTS: '10000', ARENA_ANALYSIS_TAX_MODE: 'registered', ARENA_ANALYSIS_TAX_CODE: 'test-code',
    ARENA_ANALYSIS_PRICING_JSON: JSON.stringify({ version: 'test', validUntil: now + 3600000, fxValidUntil: now + 3600000, usdToCad: 1.6, inputUsdPerMillion: 4, outputUsdPerMillion: 20, infraCents: 10, supportCents: 20, paymentFeeBps: 860 }) };
  assert.equal(readiness(settings(env), quoteCost, now).purchaseEnabled, true);
  for (const patch of [{ ARENA_ANALYSIS_STRIPE_KEY: 'sk_test_offline_only' }, { APP_URL: 'http://www.brainsnn.com' }, { APP_URL: 'invalid' },
    { APP_URL: 'https://user:password@www.brainsnn.com' }, { ARENA_ANALYSIS_DB_PATH: '/tmp/ledger.sqlite' }, { ARENA_ANALYSIS_GEMINI_API_KEY: '', GEMINI_API_KEY: 'free-route-key' }, { ARENA_ANALYSIS_MAX_OUTSTANDING_COST_CENTS: 'NaN' }]) {
    assert.equal(readiness(settings({ ...env, ...patch }), quoteCost, now).analysisEnabled, false);
  }
});
