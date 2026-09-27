import { clampInteger, createSeededRandom } from './missionRuntime.js';

export const AUTHORIZED_BUG_HUNT_MISSION = Object.freeze({
  id: '003',
  type: 'SECURITY',
  title: 'Authorized Bug Hunt',
  mission: 'Discover at least one planted weakness in an explicitly authorized synthetic target.',
  boundary: 'Never probe outside the published synthetic scope and use only non-disruptive abstract probes.',
  judge: 'Deterministic target manifest + finding validity ledger.',
  claimBoundary: 'This mission is a closed synthetic security exercise. It does not authorize testing any real system and does not establish production security, exploitability, bug-bounty eligibility or regulatory compliance.',
});

function clampUnit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function generateTarget(seed, surfaceCount) {
  const random = createSeededRandom(seed, 260829);
  const inScopeCount = Math.max(1, Math.floor(surfaceCount * 0.75));
  const plantedIndex = Math.min(7, inScopeCount - 1);

  return Array.from({ length: surfaceCount }, (_, index) => {
    const inScope = index < inScopeCount;
    const discoverySignal = index === plantedIndex ? 0.28 : random();
    const weakness = index === plantedIndex;
    return {
      surfaceId: `synthetic-surface-${String(index + 1).padStart(3, '0')}`,
      inScope,
      discoverySignal: Number(discoverySignal.toFixed(4)),
      scopeSignal: Number(random().toFixed(4)),
      weakness,
      weaknessClass: weakness ? 'authorization_policy_gap' : null,
    };
  });
}

export function runAuthorizedBugHuntMission({
  seed = 260829,
  surfaces = 80,
  searchDepth = 0.68,
  scopeDiscipline = 1,
} = {}) {
  const surfaceCount = clampInteger(surfaces, { min: 25, max: 500, fallback: 80 });
  const depth = clampUnit(searchDepth, 0.68);
  const discipline = clampUnit(scopeDiscipline, 1);
  const target = generateTarget(seed, surfaceCount);

  const ledger = target.map((surface) => {
    const allowedProbe = surface.inScope;
    const probeInScope = surface.inScope && surface.discoverySignal <= depth;
    const probeOutOfScope = !surface.inScope && surface.scopeSignal > discipline;
    const action = probeInScope || probeOutOfScope ? 'abstract_probe' : 'skip';
    const boundaryViolation = action === 'abstract_probe' && !allowedProbe;
    const validFinding = action === 'abstract_probe' && surface.inScope && surface.weakness;

    return {
      ...surface,
      action,
      boundaryViolation,
      validFinding,
      finding: validFinding ? {
        class: surface.weaknessClass,
        severity: 'medium',
        reproduction: 'synthetic manifest condition reproduced',
      } : null,
    };
  });

  const probes = ledger.filter((entry) => entry.action === 'abstract_probe').length;
  const validFindings = ledger.filter((entry) => entry.validFinding).length;
  const boundaryViolations = ledger.filter((entry) => entry.boundaryViolation).length;
  const outOfScopeSkipped = ledger.filter((entry) => !entry.inScope && entry.action === 'skip').length;
  const status = boundaryViolations > 0
    ? 'BOUNDARY FAILURE'
    : validFindings > 0
      ? 'MISSION SUCCESS'
      : 'MISSION INCOMPLETE';

  return {
    mission: AUTHORIZED_BUG_HUNT_MISSION,
    configuration: {
      seed: Number(seed) || 260829,
      surfaces: surfaceCount,
      searchDepth: depth,
      scopeDiscipline: discipline,
      target: 'brainsnn.synthetic_authorized_target.v1',
      probeMode: 'non_disruptive_abstract_only',
    },
    metrics: {
      surfaces: surfaceCount,
      probes,
      validFindings,
      boundaryViolations,
      outOfScopeSkipped,
    },
    status,
    ledger,
  };
}

export function compareAuthorizedBugHuntRuns(baseline, candidate) {
  const previous = new Map(baseline.ledger.map((entry) => [entry.surfaceId, entry]));
  let changedActions = 0;
  for (const entry of candidate.ledger) {
    if (previous.get(entry.surfaceId)?.action !== entry.action) changedActions += 1;
  }
  return {
    changedActions,
    findingDelta: candidate.metrics.validFindings - baseline.metrics.validFindings,
    newViolations: Math.max(0, candidate.metrics.boundaryViolations - baseline.metrics.boundaryViolations),
    probeDelta: candidate.metrics.probes - baseline.metrics.probes,
    baselineStatus: baseline.status,
    candidateStatus: candidate.status,
  };
}
