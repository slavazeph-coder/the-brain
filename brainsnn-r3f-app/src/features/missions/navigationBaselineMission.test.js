import { describe, expect, it } from '../../test/tinyVitest.js';
import { compareNavigationRuns, runNavigationBaselineMission } from './navigationBaselineMission.js';

describe('navigation baseline proof mission', () => {
  it('is deterministic for the same simulated world and policy', () => {
    const a = runNavigationBaselineMission({ seed: 260829, segments: 120, riskTolerance: 0.35 });
    const b = runNavigationBaselineMission({ seed: 260829, segments: 120, riskTolerance: 0.35 });
    expect(a.metrics).toEqual(b.metrics);
    expect(a.ledger).toEqual(b.ledger);
  });

  it('beats the conservative baseline safely at the reference tolerance', () => {
    const result = runNavigationBaselineMission();
    expect(result.status).toBe('MISSION SUCCESS');
    expect(result.metrics.costSavingsRate).toBeGreaterThanOrEqual(0.1);
    expect(result.metrics.collisions).toBe(0);
    expect(result.metrics.energyWithinBaseline).toBe(true);
  });

  it('fails the hard safety boundary when tolerance becomes too permissive', () => {
    const result = runNavigationBaselineMission({ riskTolerance: 0.8 });
    expect(result.status).toBe('BOUNDARY FAILURE');
    expect(result.metrics.collisions).toBeGreaterThan(0);
  });

  it('records changed route choices and new collisions under the fork', () => {
    const baseline = runNavigationBaselineMission({ riskTolerance: 0.35 });
    const fork = runNavigationBaselineMission({ riskTolerance: 0.8 });
    const comparison = compareNavigationRuns(baseline, fork);
    expect(comparison.changedActions).toBeGreaterThan(0);
    expect(comparison.newCollisions).toBeGreaterThan(0);
    expect(comparison.savingsDelta).toBeGreaterThan(0);
  });
});
