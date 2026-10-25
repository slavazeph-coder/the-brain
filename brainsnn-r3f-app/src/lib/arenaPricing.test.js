import { describe, expect, it } from '../test/tinyVitest.js';
import {
  DEFAULT_RUNTIME_ESTIMATE,
  PRICING_DEFAULTS,
  estimateRuntimePrice,
  formatUSD,
} from './arenaPricing.js';

describe('illustrative Arena runtime pricing', () => {
  it('derives the default US$171.43 customer price from runtime and gross margin', () => {
    const estimate = estimateRuntimePrice(PRICING_DEFAULTS);
    expect(estimate.workerHours).toBe(200);
    expect(estimate.runtimeCostUSD).toBe(120);
    expect(estimate.runtimePriceUSD).toBeCloseTo(120 / 0.7, 10);
    expect(estimate.serviceMarginAllowanceUSD).toBeCloseTo(51.42857142857144, 10);
    expect(estimate.pricePerEpisodeUSD).toBeCloseTo(0.0017142857142857144, 12);
    expect(formatUSD(estimate.runtimePriceUSD)).toBe('US$171.43');
  });

  it('keeps the defaults and published default estimate immutable', () => {
    expect(Object.isFrozen(PRICING_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RUNTIME_ESTIMATE)).toBe(true);
    expect(DEFAULT_RUNTIME_ESTIMATE).toEqual(estimateRuntimePrice(PRICING_DEFAULTS));
  });

  it('returns all four assumptions with the derived breakdown without mutating input', () => {
    const input = Object.freeze({ episodes: 10, episodesPerWorkerHour: 2.5, hourlyRateUSD: 1.5, grossMarginPercent: 25 });
    expect(estimateRuntimePrice(input)).toEqual({
      ...input,
      workerHours: 4,
      runtimeCostUSD: 6,
      serviceMarginAllowanceUSD: 2,
      runtimePriceUSD: 8,
      pricePerEpisodeUSD: 0.8,
    });
  });

  it('allows zero gross margin and charges exactly runtime cost', () => {
    const estimate = estimateRuntimePrice({ ...PRICING_DEFAULTS, grossMarginPercent: 0 });
    expect(estimate.runtimePriceUSD).toBe(estimate.runtimeCostUSD);
    expect(estimate.serviceMarginAllowanceUSD).toBe(0);
  });

  it('uses gross margin on customer price rather than a markup on runtime cost', () => {
    const estimate = estimateRuntimePrice({ ...PRICING_DEFAULTS, grossMarginPercent: 75 });
    expect(estimate.runtimePriceUSD).toBe(480);
    expect(estimate.serviceMarginAllowanceUSD / estimate.runtimePriceUSD).toBe(0.75);
  });

  it('scales runtime and price with episode count and throughput', () => {
    const halfEpisodes = estimateRuntimePrice({ ...PRICING_DEFAULTS, episodes: 50000 });
    const doubleThroughput = estimateRuntimePrice({ ...PRICING_DEFAULTS, episodesPerWorkerHour: 1000 });
    expect(halfEpisodes.runtimePriceUSD).toBe(DEFAULT_RUNTIME_ESTIMATE.runtimePriceUSD / 2);
    expect(doubleThroughput.runtimePriceUSD).toBe(halfEpisodes.runtimePriceUSD);
    expect(halfEpisodes.pricePerEpisodeUSD).toBe(DEFAULT_RUNTIME_ESTIMATE.pricePerEpisodeUSD);
  });

  it('accepts inclusive numeric bounds and keeps all derived values finite', () => {
    for (const input of [
      { episodes: 1, episodesPerWorkerHour: 10000000, hourlyRateUSD: 0.000001, grossMarginPercent: 0 },
      { episodes: 100000, episodesPerWorkerHour: 0.001, hourlyRateUSD: 10000, grossMarginPercent: 75 },
    ]) {
      const estimate = estimateRuntimePrice(input);
      expect(estimate === null).toBe(false);
      expect(Object.values(estimate).every(Number.isFinite)).toBe(true);
    }
  });

  it('rejects absent, incomplete, and non-object inputs', () => {
    for (const input of [undefined, null, '', '100000', 100000, false, [], {}]) {
      expect(estimateRuntimePrice(input)).toBe(null);
    }
    for (const key of Object.keys(PRICING_DEFAULTS)) {
      const input = { ...PRICING_DEFAULTS };
      delete input[key];
      expect(estimateRuntimePrice(input)).toBe(null);
    }
  });

  it('rejects coercible strings, nulls, non-finite values and other non-numbers in every field', () => {
    const invalidValues = [null, undefined, '', ' ', '500', NaN, Infinity, -Infinity, true, false, [], {}, new Number(1)];
    for (const key of Object.keys(PRICING_DEFAULTS)) {
      for (const value of invalidValues) {
        expect(estimateRuntimePrice({ ...PRICING_DEFAULTS, [key]: value })).toBe(null);
      }
    }
  });

  it('rejects fractional, unsafe, zero, negative and over-limit episode counts', () => {
    for (const episodes of [-1, -0, 0, 1.5, 100001, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
      expect(estimateRuntimePrice({ ...PRICING_DEFAULTS, episodes })).toBe(null);
    }
  });

  it('rejects throughput, rate and margin values outside their bounds without clamping', () => {
    const invalidFields = {
      episodesPerWorkerHour: [-1, 0, 0.000999, 10000001],
      hourlyRateUSD: [-1, 0, 0.0000009, 10000.01],
      grossMarginPercent: [-1, 75.01, 100],
    };
    for (const [key, values] of Object.entries(invalidFields)) {
      for (const value of values) {
        expect(estimateRuntimePrice({ ...PRICING_DEFAULTS, [key]: value })).toBe(null);
      }
    }
  });
});

describe('USD display', () => {
  it('uses an explicit US$ prefix, thousands separators and two decimal places', () => {
    expect(formatUSD(0)).toBe('US$0.00');
    expect(formatUSD(-0)).toBe('US$0.00');
    expect(formatUSD(1234.5)).toBe('US$1,234.50');
  });

  it('supports more decimals for per-episode prices', () => {
    expect(formatUSD(DEFAULT_RUNTIME_ESTIMATE.pricePerEpisodeUSD, {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    })).toBe('US$0.001714');
  });

  it('does not display invalid values as a price', () => {
    for (const value of [undefined, null, '', '1', NaN, Infinity, -Infinity]) {
      expect(formatUSD(value)).toBe('—');
    }
  });
});
