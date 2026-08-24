import { describe, expect, it } from '../test/tinyVitest.js';
import {
  brandBrainMaturity,
  metricUtility,
  normalizeOutcomePayload,
} from './brandBrainContract.js';

describe('Brand Brain server contract', () => {
  it('preserves the collection, directional, and comparative maturity gates', () => {
    expect(brandBrainMaturity(0).id).toBe('collecting');
    expect(brandBrainMaturity(2).id).toBe('collecting');
    expect(brandBrainMaturity(3).id).toBe('directional');
    expect(brandBrainMaturity(7).id).toBe('directional');
    expect(brandBrainMaturity(8).id).toBe('comparative');
  });

  it('treats CPA and CPC as lower-is-better without changing the saved actual value', () => {
    expect(metricUtility('roas', 3)).toBe(3);
    expect(metricUtility('cpa', 25)).toBe(-25);
    expect(metricUtility('cpc', 1.5)).toBe(-1.5);
  });

  it('normalizes a valid outcome and bounds untrusted metadata', () => {
    const record = normalizeOutcomePayload({
      id: 'legacy-1',
      brandName: '  Acme   Corp ',
      creativeLabel: ' Variant   B ',
      metricId: 'roas',
      actualValue: 2.4,
      savedAt: '2026-08-24T12:00:00.000Z',
      sourceResultId: 'scan-123',
      modelVersion: 'mirror-v0.3',
      signature: { score: 0.8, nested: { trust: 0.7 }, ignoredArray: [1, 2, 3] },
      provenance: { source: 'customer-entered outcome', verified: false },
    });
    expect(record.brandName).toBe('Acme Corp');
    expect(record.creativeLabel).toBe('Variant B');
    expect(record.actualValue).toBe(2.4);
    expect(record.legacyId).toBe('legacy-1');
    expect(record.signature.score).toBe(0.8);
    expect(record.signature.nested.trust).toBe(0.7);
    expect(Object.prototype.hasOwnProperty.call(record.signature, 'ignoredArray')).toBe(false);
  });

  it('rejects fabricated or malformed outcome values instead of coercing them into history', () => {
    let invalidMetric = '';
    let invalidValue = '';
    try {
      normalizeOutcomePayload({ brandName: 'Acme', creativeLabel: 'A', metricId: 'fake-win-rate', actualValue: 10 });
    } catch (error) {
      invalidMetric = error.message;
    }
    try {
      normalizeOutcomePayload({ brandName: 'Acme', creativeLabel: 'A', metricId: 'roas', actualValue: -1 });
    } catch (error) {
      invalidValue = error.message;
    }
    expect(invalidMetric.includes('Unsupported')).toBe(true);
    expect(invalidValue.includes('non-negative')).toBe(true);
  });
});
