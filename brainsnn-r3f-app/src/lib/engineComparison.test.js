import { describe, expect, it } from '../test/tinyVitest.js';
import { compareEngineInputs, ENGINE_COMPARE_MAX_CHARS } from './engineComparison.js';

const original = 'Guaranteed results! Act now before this hidden threat destroys your business.';
const candidate = 'Test the workflow with your team. Review the source and measured limitations before deciding.';
function rejects(input) {
  try { compareEngineInputs(input); return false; } catch (error) { return error instanceof TypeError; }
}

describe('Engine comparison', () => {
  it('runs the same local scorer on both inputs and detects a signal regression in reverse', () => {
    const forward = compareEngineInputs({ original, candidate });
    const reverse = compareEngineInputs({ original: candidate, candidate: original });
    expect(forward.delta.trust).toBeGreaterThan(0);
    expect(forward.delta.manipulationPressure).toBeLessThan(0);
    expect(forward.signalsWithinLimits).toBe(true);
    expect(reverse.signalsWithinLimits).toBe(false);
    expect(reverse.delta.trust).toBe(-forward.delta.trust);
  });

  it('keeps exact source text and checkable quotation offsets', () => {
    const text = '  Review this source.\n\nWe have measured 42.5% on example.com.  ';
    const result = compareEngineInputs({ original: text, candidate: text });
    expect(result.original.content).toBe(text);
    expect(result.original.findings.length).toBeGreaterThan(0);
    for (const item of result.original.findings) expect(text.slice(item.start, item.end)).toBe(item.quotation);
    expect(result.inputChanged).toBe(false);
    expect(result.delta.trust).toBe(0);
    expect(result.delta.manipulationPressure).toBe(0);
  });

  it('produces stable content and comparison identities independently of clocks', () => {
    const left = compareEngineInputs({ original, candidate }, { now: () => new Date('2026-09-08T00:00:00Z') });
    const right = compareEngineInputs({ original, candidate }, { now: () => new Date('2026-09-09T00:00:00Z') });
    expect(left.id).toBe(right.id);
    expect(left.original.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(left.generatedAt === right.generatedAt).toBe(false);
    expect(compareEngineInputs({ original, candidate, limits: { maxTrustDrop: 1 } }).id === left.id).toBe(false);
    expect(compareEngineInputs({ original, candidate }, { revision: 'abcdef123' }).id === left.id).toBe(false);
  });

  it('maps collapsed whitespace back to the original quotation and marks the analyzer preview cap', () => {
    const text = '  We have\nmeasured  the source.\tReview it. ';
    const inspected = compareEngineInputs({ original: text, candidate: text }).original;
    expect(inspected.findings).toHaveLength(2);
    expect(inspected.findings[0].quotation).toBe('We have\nmeasured  the source.');
    expect(inspected.findingsTruncated).toBe(false);
    for (const item of inspected.findings) expect(text.slice(item.start, item.end)).toBe(item.quotation);
    const long = Array.from({ length: 20 }, (_, i) => `Review source ${i}.`).join(' ');
    const capped = compareEngineInputs({ original: long, candidate: long }).original;
    expect(capped.findings).toHaveLength(18);
    expect(capped.findingsTruncated).toBe(true);
  });

  it('never converts favorable model signals or supplied earnings into accepted outcomes', () => {
    const result = compareEngineInputs({ original, candidate, revenue: 1500, accepted: true });
    expect(result.decision).toBe('REVIEW_REQUIRED');
    expect(result.evidence).toEqual({ factsVerified: false, marketOutcomeMeasured: false, workAccepted: false, contextPromoted: false });
    expect(result.execution.providerCalls).toBe(0);
    expect(result.execution.persisted).toBe(false);
  });

  it('rejects absent, coerced, blank and oversized texts without truncating them', () => {
    for (const value of [undefined, null, true, 12, {}, [], ' ', 'x'.repeat(ENGINE_COMPARE_MAX_CHARS + 1)]) {
      expect(rejects({ original: value, candidate })).toBe(true);
      expect(rejects({ original, candidate: value })).toBe(true);
    }
  });

  it('rejects limits that could silently disable a check', () => {
    for (const value of [null, '', '0', false, NaN, Infinity, -1, {}, []]) {
      expect(rejects({ original, candidate, limits: { maxTrustDrop: value } })).toBe(true);
      expect(rejects({ original, candidate, limits: { maxPressureIncrease: value } })).toBe(true);
    }
    expect(rejects({ original, candidate, limits: { maxTrustDrop: 101 } })).toBe(true);
    expect(rejects({ original, candidate, limits: { maxPressureIncrease: 1.1 } })).toBe(true);
    for (const limits of [null, [], 'loose']) expect(rejects({ original, candidate, limits })).toBe(true);
  });

  it('rejects lone surrogates before UTF-8 replacement can hide an input change', () => {
    for (const invalid of ['Review source \ud800.', 'Review source \ud801.', 'Review source \udc00.', 'Review source \udfff.', '\ud800\ud800', '\udc00\ud800']) {
      expect(rejects({ original: invalid, candidate })).toBe(true);
      expect(rejects({ original, candidate: invalid })).toBe(true);
    }
    const result = compareEngineInputs({ original: 'Review source \ufffd.', candidate: 'Review source 😀.' });
    expect(result.original.content).toBe('Review source \ufffd.');
    expect(result.candidate.content).toBe('Review source 😀.');
    expect(result.original.sha256 === result.candidate.sha256).toBe(false);
    expect(result.inputChanged).toBe(true);
    for (const item of result.candidate.findings) expect(result.candidate.content.slice(item.start, item.end)).toBe(item.quotation);
  });

  it('records measured execution duration and explicit caller limits', () => {
    const times = [5, 12];
    const result = compareEngineInputs({ original: candidate, candidate: original, limits: { maxTrustDrop: 100, maxPressureIncrease: 1 } }, { monotonic: () => times.shift() });
    expect(result.execution.durationMs).toBe(7);
    expect(result.signalsWithinLimits).toBe(true);
    expect(result.decision).toBe('REVIEW_REQUIRED');
  });
});
