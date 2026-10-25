'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {quoteCost, actualProviderCost, QUOTE_TTL_MS, PRICE_COVERAGE_MS} = require('../pricing.cjs');
const now = Date.UTC(2026, 9, 17);
const config = overrides => ({version: 'prices-2026-12-01-fx1.6', now, validUntil: now + 86400000, fxValidUntil: now + 86400000, usdToCad: 1.6, inputUsdPerMillion: 4, outputUsdPerMillion: 20, infraCents: 10, supportCents: 20, paymentFeeBps: 860, ...overrides});

test('quote bounds all input, output/thinking, FX, allocations and 20% contingency', () => {
  const q = quoteCost({inputTokenUpperBound: 32000}, config());
  assert.equal(q.providerCostCeilingCents, 126);
  assert.equal(q.maxCostCents, 188);
  assert.equal(q.fixedCostCents, 62);
  assert.equal(q.currency, 'cad');
  assert.equal(q.expiresAt, now + QUOTE_TTL_MS);
  assert.ok(q.amountCents >= 200);
  assert.ok(q.maxCostCents + Math.ceil(q.amountCents * 860 / 10000) <= Math.floor(q.amountCents / 2));
});

test('margin invariant survives different fees, token counts, overhead and exchange rates', () => {
  for (const paymentFeeBps of [0, 29, 860, 1399, 3000, 4999]) {
    for (const usdToCad of [1.000001, 1.35, 1.6, 2.5]) {
      for (const inputTokenUpperBound of [1, 19, 1000, 32000]) {
        const q = quoteCost({inputTokenUpperBound}, config({paymentFeeBps, usdToCad, infraCents: inputTokenUpperBound % 7, supportCents: 1}));
        assert.ok(q.maxCostCents + Math.ceil(q.amountCents * paymentFeeBps / 10000) <= Math.floor(q.amountCents / 2), JSON.stringify(q));
      }
    }
  }
});

test('unconfigured, stale or soon-to-expire pricing fails closed', () => {
  for (const overrides of [{validUntil: now - 1}, {fxValidUntil: now - 1}, {validUntil: now + QUOTE_TTL_MS - 1}, {fxValidUntil: undefined}, {usdToCad: undefined}, {inputUsdPerMillion: 0}, {inputUsdPerMillion: 3}, {outputUsdPerMillion: 19}, {outputUsdPerMillion: NaN}, {version: ''}, {infraCents: undefined}, {supportCents: -1}, {paymentFeeBps: 5000}, {marginBps: 4999}, {contingencyBps: 1999}, {outputTokenLimit: 1}, {outputTokenLimit: 32769}]) {
    assert.throws(() => quoteCost({inputTokenUpperBound: 100}, config(overrides)), {code: 'PRICING_UNAVAILABLE'});
  }
  for (const bound of [0, -1, NaN, 32001, 1.1, '100']) assert.throws(() => quoteCost({inputTokenUpperBound: bound}, config()), {code: 'PRICING_UNAVAILABLE'});
});

test('price and FX increases raise quotes; no introductory rate is assumed', () => {
  const baseline = quoteCost({inputTokenUpperBound: 32000}, config());
  assert.ok(quoteCost({inputTokenUpperBound: 32000}, config({outputUsdPerMillion: 40})).amountCents > baseline.amountCents);
  assert.ok(quoteCost({inputTokenUpperBound: 32000}, config({usdToCad: 2})).amountCents > baseline.amountCents);
  assert.equal(actualProviderCost({inputTokens: 32000, generatedTokens: 32768}, config()), baseline.providerCostCeilingCents);
  assert.throws(() => actualProviderCost({inputTokens: 100}, config()), {code: 'PRICING_UNAVAILABLE'});
});

test('both price and FX bounds cover late acceptance plus the full provider execution window', () => {
  for (const key of ['validUntil', 'fxValidUntil']) {
    assert.throws(() => quoteCost({inputTokenUpperBound: 100}, config({[key]: now + PRICE_COVERAGE_MS - 1})), {code: 'PRICING_UNAVAILABLE'});
    const q = quoteCost({inputTokenUpperBound: 100}, config({[key]: now + PRICE_COVERAGE_MS}));
    assert.equal(q.expiresAt, now + QUOTE_TTL_MS);
  }
});
