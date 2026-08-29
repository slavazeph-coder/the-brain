import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  DEFAULT_MISSION_DRAFT,
  buildMissionContract,
  compareBuiltMissionRuns,
  forkMissionDraft,
  normalizeMissionDraft,
  runBuiltMission,
} from './missionBuilder.js';

describe('proof mission builder', () => {
  it('normalizes user input into bounded structured controls', () => {
    const draft = normalizeMissionDraft({
      worldTemplate: 'unknown',
      cases: 9999,
      maxRisk: -10,
      minimumQuality: 9,
      aggressiveness: 4,
      boundaryDiscipline: -1,
    });
    expect(draft.worldTemplate).toBe('decision-queue');
    expect(draft.cases).toBe(500);
    expect(draft.maxRisk).toBe(0.05);
    expect(draft.minimumQuality).toBe(1);
    expect(draft.aggressiveness).toBe(1);
    expect(draft.boundaryDiscipline).toBe(0);
  });

  it('is deterministic for the same contract and seed', () => {
    const a = runBuiltMission(DEFAULT_MISSION_DRAFT);
    const b = runBuiltMission(DEFAULT_MISSION_DRAFT);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.ledger).toEqual(b.ledger);
  });

  it('ships with a useful reference contract that succeeds safely', () => {
    const result = runBuiltMission(DEFAULT_MISSION_DRAFT);
    expect(result.status).toBe('MISSION SUCCESS');
    expect(result.metrics.improvementRate).toBeGreaterThanOrEqual(DEFAULT_MISSION_DRAFT.minimumImprovement);
    expect(result.metrics.qualityRate).toBeGreaterThanOrEqual(DEFAULT_MISSION_DRAFT.minimumQuality);
    expect(result.metrics.boundaryViolations).toBe(0);
  });

  it('can expose a hard boundary failure without changing the world seed', () => {
    const result = runBuiltMission({
      ...DEFAULT_MISSION_DRAFT,
      maxRisk: 0.2,
      aggressiveness: 0.9,
      boundaryDiscipline: 0,
    });
    expect(result.status).toBe('BOUNDARY FAILURE');
    expect(result.metrics.boundaryViolations).toBeGreaterThan(0);
  });

  it('forks one declared policy parameter and reports the changed decisions', () => {
    const baselineDraft = { ...DEFAULT_MISSION_DRAFT, aggressiveness: 0.45 };
    const forkDraft = forkMissionDraft(baselineDraft);
    const baseline = runBuiltMission(baselineDraft);
    const fork = runBuiltMission(forkDraft);
    const comparison = compareBuiltMissionRuns(baseline, fork);
    expect(forkDraft.seed).toBe(baselineDraft.seed);
    expect(forkDraft.aggressiveness).not.toBe(baselineDraft.aggressiveness);
    expect(comparison.changedActions).toBeGreaterThan(0);
  });

  it('keeps authored language in the contract while stating the finite claim boundary', () => {
    const contract = buildMissionContract({
      ...DEFAULT_MISSION_DRAFT,
      title: 'My bounded test',
      objective: 'Increase useful value.',
      boundary: 'Never cross the hard limit.',
      judge: 'Use the deterministic ledger.',
    });
    expect(contract.title).toBe('My bounded test');
    expect(contract.mission).toBe('Increase useful value.');
    expect(contract.boundary).toBe('Never cross the hard limit.');
    expect(contract.judge).toBe('Use the deterministic ledger.');
    expect(contract.claimBoundary.includes('finite simulation evidence')).toBe(true);
  });
});
