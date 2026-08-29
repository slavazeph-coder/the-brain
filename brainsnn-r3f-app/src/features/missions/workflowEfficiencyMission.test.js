import { describe, expect, it } from '../../test/tinyVitest.js';
import { compareWorkflowRuns, runWorkflowEfficiencyMission } from './workflowEfficiencyMission.js';

describe('workflow efficiency proof mission', () => {
  it('is deterministic for the same world and mind configuration', () => {
    const a = runWorkflowEfficiencyMission({ seed: 260829, cases: 250, reviewThreshold: 0.62 });
    const b = runWorkflowEfficiencyMission({ seed: 260829, cases: 250, reviewThreshold: 0.62 });
    expect(a.metrics).toEqual(b.metrics);
    expect(a.ledger).toEqual(b.ledger);
  });

  it('succeeds with the reference threshold', () => {
    const result = runWorkflowEfficiencyMission();
    expect(result.status).toBe('MISSION SUCCESS');
    expect(result.metrics.savingsRate).toBeGreaterThanOrEqual(0.2);
    expect(result.metrics.qualityConformance).toBeGreaterThanOrEqual(0.95);
    expect(result.metrics.boundaryViolations).toBe(0);
  });

  it('exposes hard-boundary failure when the threshold becomes too permissive', () => {
    const result = runWorkflowEfficiencyMission({ reviewThreshold: 0.95 });
    expect(result.status).toBe('BOUNDARY FAILURE');
    expect(result.metrics.boundaryViolations).toBeGreaterThan(0);
  });

  it('changes actions when the same world is forked with a new threshold', () => {
    const baseline = runWorkflowEfficiencyMission({ reviewThreshold: 0.62 });
    const fork = runWorkflowEfficiencyMission({ reviewThreshold: 0.84 });
    const comparison = compareWorkflowRuns(baseline, fork);
    expect(comparison.changedActions).toBeGreaterThan(0);
    expect(comparison.qualityDelta).toBeLessThan(0);
    expect(comparison.savingsRateDelta).toBeGreaterThan(0);
  });

  it('bounds mission size', () => {
    expect(runWorkflowEfficiencyMission({ cases: 1 }).metrics.decisions).toBe(25);
    expect(runWorkflowEfficiencyMission({ cases: 9000 }).metrics.decisions).toBe(2000);
  });
});
