import { describe, expect, it } from '../../test/tinyVitest.js';
import { DEFAULT_MISSION_DRAFT, runBuiltMission } from './missionBuilder.js';
import { buildSubmissionConfiguration, normalizeSubmissionPolicy, rankMissionSubmissions } from './missionMarketplace.js';

describe('mission marketplace', () => {
  it('lets a submission change only the participant policy fields', () => {
    const published = { ...DEFAULT_MISSION_DRAFT, seed: 12345, cases: 240, maxRisk: 0.22, minimumImprovement: 0.4 };
    const next = buildSubmissionConfiguration(published, {
      mind: 'Contestant policy',
      aggressiveness: 0.92,
      boundaryDiscipline: 0.77,
      seed: 999,
      cases: 25,
      maxRisk: 0.9,
      minimumImprovement: 0,
    });
    expect(next.mind).toBe('Contestant policy');
    expect(next.aggressiveness).toBe(0.92);
    expect(next.boundaryDiscipline).toBe(0.77);
    expect(next.seed).toBe(12345);
    expect(next.cases).toBe(240);
    expect(next.maxRisk).toBe(0.22);
    expect(next.minimumImprovement).toBe(0.4);
  });

  it('clamps participant policy inputs to the declared bounds', () => {
    const policy = normalizeSubmissionPolicy({ mind: '  Test   mind  ', aggressiveness: 9, boundaryDiscipline: -2 }, DEFAULT_MISSION_DRAFT);
    expect(policy.mind).toBe('Test mind');
    expect(policy.aggressiveness).toBe(1);
    expect(policy.boundaryDiscipline).toBe(0);
  });

  it('replays the same submission configuration deterministically', () => {
    const config = buildSubmissionConfiguration(DEFAULT_MISSION_DRAFT, { mind: 'A', aggressiveness: 0.61, boundaryDiscipline: 1 });
    const a = runBuiltMission(config);
    const b = runBuiltMission(config);
    expect(a.status).toBe(b.status);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.ledger).toEqual(b.ledger);
  });

  it('ranks success ahead of objective miss and boundary failure', () => {
    const ranked = rankMissionSubmissions([
      { id: 'failure', status: 'BOUNDARY FAILURE', metrics: { boundaryViolations: 1, improvementRate: 4, qualityRate: 1 }, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'miss', status: 'OBJECTIVE MISS', metrics: { boundaryViolations: 0, improvementRate: 0.1, qualityRate: 1 }, createdAt: '2026-01-01T00:00:01Z' },
      { id: 'success-low', status: 'MISSION SUCCESS', metrics: { boundaryViolations: 0, improvementRate: 0.3, qualityRate: 0.96 }, createdAt: '2026-01-01T00:00:02Z' },
      { id: 'success-high', status: 'MISSION SUCCESS', metrics: { boundaryViolations: 0, improvementRate: 0.5, qualityRate: 0.92 }, createdAt: '2026-01-01T00:00:03Z' },
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(['success-high', 'success-low', 'miss', 'failure']);
    expect(ranked[0].rank).toBe(1);
  });
});
