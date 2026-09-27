import { describe, expect, it } from '../../test/tinyVitest.js';
import { compareReproduceResultRuns, runReproduceResultMission } from './reproduceResultMission.js';

describe('reproduce result proof mission', () => {
  it('is deterministic for the same declared experiment', () => {
    const a = runReproduceResultMission({ seed: 260829, samples: 500, trimFraction: 0 });
    const b = runReproduceResultMission({ seed: 260829, samples: 500, trimFraction: 0 });
    expect(a.metrics).toEqual(b.metrics);
    expect(a.ledger).toEqual(b.ledger);
  });

  it('reproduces the declared reference result with the declared method', () => {
    const result = runReproduceResultMission();
    expect(result.status).toBe('MISSION SUCCESS');
    expect(result.metrics.accepted).toBe(true);
    expect(result.metrics.absoluteError).toBeLessThanOrEqual(0.01);
    expect(result.metrics.boundaryViolations).toBe(0);
  });

  it('fails the claim boundary when hidden trimming is introduced', () => {
    const result = runReproduceResultMission({ trimFraction: 0.25 });
    expect(result.status).toBe('BOUNDARY FAILURE');
    expect(result.metrics.excludedSamples).toBeGreaterThan(0);
  });

  it('records which samples changed inclusion under the fork', () => {
    const baseline = runReproduceResultMission({ trimFraction: 0 });
    const fork = runReproduceResultMission({ trimFraction: 0.25 });
    const comparison = compareReproduceResultRuns(baseline, fork);
    expect(comparison.changedInclusion).toBeGreaterThan(0);
    expect(comparison.newViolations).toBeGreaterThan(0);
  });
});
