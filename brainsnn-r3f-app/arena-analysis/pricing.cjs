'use strict';

const MAX_INPUT_TOKENS = 32000;
const MAX_OUTPUT_TOKENS = 32768;
const QUOTE_TTL_MS = 10 * 60 * 1000;
const EXECUTION_TTL_MS = 10 * 60 * 1000;
const PRICE_COVERAGE_MS = QUOTE_TTL_MS + EXECUTION_TTL_MS;
// This release serves only gemini-4-argon and reserves against its published
// post-introductory rates. A future model/rate change needs a reviewed release.
const INPUT_RATE_FLOOR = 4;
const OUTPUT_RATE_FLOOR = 20;

function invalid(message) {
  const error = new Error(message);
  error.code = 'PRICING_UNAVAILABLE';
  error.status = 503;
  throw error;
}

function integer(value, name, maximum = 100000000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) invalid(`Invalid ${name}`);
  return value;
}

function timestamp(value, name) {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) invalid(`Invalid ${name}`);
  return parsed;
}

// Decimal rates are rounded upward to millionths, then all financial arithmetic
// uses integer rationals. A float rounding down must never erode the margin.
function millionths(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100000) invalid(`Invalid ${name}`);
  return BigInt(Math.ceil(value * 1000000));
}

function ceilRatio(numerator, denominator) {
  if (denominator <= 0n) invalid('Non-positive margin denominator');
  const answer = (numerator + denominator - 1n) / denominator;
  if (answer > BigInt(Number.MAX_SAFE_INTEGER)) invalid('Price exceeds safe integer range');
  return Number(answer);
}

function quoteCost(stats, pricing) {
  if (!pricing || !stats) invalid('Pricing and evidence bounds are required');
  const now = timestamp(pricing.now ?? Date.now(), 'clock');
  const validUntil = timestamp(pricing.validUntil, 'price expiry');
  const fxValidUntil = timestamp(pricing.fxValidUntil, 'exchange rate expiry');
  // A customer can accept just before quote expiry and then use the full
  // provider timeout. Cover both windows rather than only quote validity.
  if (validUntil < now + PRICE_COVERAGE_MS || fxValidUntil < now + PRICE_COVERAGE_MS) invalid('Pricing or exchange-rate bound is stale');
  if (typeof pricing.version !== 'string' || !pricing.version.trim() || pricing.version.length > 160) invalid('Pricing version is required');
  const inputTokens = integer(stats.inputTokenUpperBound, 'input token bound', MAX_INPUT_TOKENS);
  if (!inputTokens) invalid('Positive input token bound is required');
  const outputTokens = integer(pricing.outputTokenLimit ?? MAX_OUTPUT_TOKENS, 'output token limit', MAX_OUTPUT_TOKENS);
  if (outputTokens !== MAX_OUTPUT_TOKENS) invalid('Quote output bound must match the provider token cap');
  if (pricing.inputUsdPerMillion < INPUT_RATE_FLOOR || pricing.outputUsdPerMillion < OUTPUT_RATE_FLOOR) invalid('Introductory rates cannot fund accepted quotes');
  const inputRate = millionths(pricing.inputUsdPerMillion, 'input USD rate');
  const outputRate = millionths(pricing.outputUsdPerMillion, 'output USD rate');
  const fx = millionths(pricing.usdToCad, 'USD/CAD bound');
  const providerCostCeilingCents = ceilRatio(
    (BigInt(inputTokens) * inputRate + BigInt(outputTokens) * outputRate) * fx * 100n,
    1000000n * 1000000n * 1000000n,
  );
  const infraCents = integer(pricing.infraCents, 'infrastructure allocation');
  const supportCents = integer(pricing.supportCents, 'support allocation');
  const paymentFeeBps = integer(pricing.paymentFeeBps, 'payment fee rate', 10000);
  const marginBps = integer(pricing.marginBps ?? 5000, 'margin floor', 9999);
  const contingencyBps = integer(pricing.contingencyBps ?? 2000, 'cost contingency', 100000);
  if (marginBps < 5000 || contingencyBps < 2000) invalid('Margin and contingency floors cannot be weakened');
  const denominator = 10000 - marginBps - paymentFeeBps;
  if (denominator <= 0) invalid('Payment fees leave no contribution margin');
  const maxCostCents = ceilRatio(BigInt(providerCostCeilingCents + infraCents + supportCents) * BigInt(10000 + contingencyBps), 10000n);
  const amountCents = Math.max(200, ceilRatio(BigInt(maxCostCents) * 10000n, BigInt(denominator)));
  // Payment-fee allocation rounds upward per job, too; cover that last cent.
  let roundedAmount = amountCents;
  while (maxCostCents + Math.ceil(roundedAmount * paymentFeeBps / 10000) > Math.floor(roundedAmount * (10000 - marginBps) / 10000)) roundedAmount += 1;
  return {
    amountCents: roundedAmount,
    currency: 'cad',
    maxCostCents,
    providerCostCeilingCents,
    fixedCostCents: maxCostCents - providerCostCeilingCents,
    paymentFeeBps,
    pricingVersion: pricing.version,
    expiresAt: now + QUOTE_TTL_MS,
    breakdown: {inputTokens, outputTokens, providerCostCeilingCents, infraCents, supportCents, contingencyBps, marginBps, paymentFeeBps, usdToCad: pricing.usdToCad},
  };
}

// Usage must include all billable generated tokens, including thinking. If the
// provider cannot establish that total, callers must retain the worst-case hold.
function actualProviderCost({inputTokens, generatedTokens}, pricing) {
  integer(inputTokens, 'actual input tokens');
  integer(generatedTokens, 'actual generated tokens');
  return ceilRatio(
    (BigInt(inputTokens) * millionths(pricing.inputUsdPerMillion, 'input USD rate') + BigInt(generatedTokens) * millionths(pricing.outputUsdPerMillion, 'output USD rate')) * millionths(pricing.usdToCad, 'USD/CAD bound') * 100n,
    1000000n * 1000000n * 1000000n,
  );
}

module.exports = {quoteCost, actualProviderCost, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, QUOTE_TTL_MS, EXECUTION_TTL_MS, PRICE_COVERAGE_MS};
