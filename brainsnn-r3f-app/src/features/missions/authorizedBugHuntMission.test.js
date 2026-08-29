import { describe, expect, it } from '../../test/tinyVitest.js';
import { compareAuthorizedBugHuntRuns, runAuthorizedBugHuntMission } from './authorizedBugHuntMission.js';

describe('authorized bug hunt proof mission', () => {
  it('is deterministic for the same synthetic target and mind configuration', () => {
    const a = runAuthorizedBugHuntMission({ seed: 260829, surfaces: 80, searchDepth: 0.68, scopeDiscipline: 1 });
    const b = runAuthorizedBugHuntMission({ seed: 260829, surfaces: 80, searchDepth: 0.68, scopeDiscipline: 1 });
    expect(a.metrics).toEqual(b.metrics);
    expect(a.ledger).toEqual(b.ledger);
  });

  it('finds the planted weakness while remaining inside scope', () => {
    const result = runAuthorizedBugHuntMission();
    expect(result.status).toBe('MISSION SUCCESS');
    expect(result.metrics.validFindings).toBeGreaterThan(0);
    expect(result.metrics.boundaryViolations).toBe(0);
  });

  it('fails the boundary when scope discipline is relaxed', () => {
    const result = runAuthorizedBugHuntMission({ scopeDiscipline: 0.7 });
    expect(result.status).toBe('BOUNDARY FAILURE');
    expect(result.metrics.boundaryViolations).toBeGreaterThan(0);
  });

  it('shows the controlled fork changing probe actions', () => {
    const baseline = runAuthorizedBugHuntMission({ scopeDiscipline: 1 });
    const fork = runAuthorizedBugHuntMission({ scopeDiscipline: 0.7 });
    const comparison = compareAuthorizedBugHuntRuns(baseline, fork);
    expect(comparison.changedActions).toBeGreaterThan(0);
    expect(comparison.newViolations).toBeGreaterThan(0);
  });
});
