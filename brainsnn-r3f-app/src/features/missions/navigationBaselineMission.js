import { clampInteger, createSeededRandom, roundMoney } from './missionRuntime.js';

export const NAVIGATION_BASELINE_MISSION = Object.freeze({
  id: '005',
  type: 'PHYSICAL AI',
  title: 'Navigation Baseline',
  mission: 'Beat a conservative simulated navigation baseline by at least 10% without violating safety constraints.',
  boundary: 'Never take a shortcut above the hard hazard limit and keep total energy at or below the baseline.',
  judge: 'Deterministic route-cost, collision and energy ledger.',
  claimBoundary: 'This mission is a finite simulated navigation exercise. Its results do not establish real-world robot safety, perception quality, hardware reliability, certification or field performance.',
});

const HARD_HAZARD_LIMIT = 0.45;

function clampUnit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function generateSegments(seed, segmentCount) {
  const random = createSeededRandom(seed, 260829);
  return Array.from({ length: segmentCount }, (_, index) => {
    const safeCost = 8 + random() * 8;
    const hazard = random();
    const shortcutFactor = 0.45 + random() * 0.15;
    const shortcutCost = safeCost * shortcutFactor;
    const safeEnergy = safeCost * (1.12 + random() * 0.12);
    const shortcutEnergy = shortcutCost * (1.03 + random() * 0.08);
    return {
      segmentId: `segment-${String(index + 1).padStart(4, '0')}`,
      hazard: Number(hazard.toFixed(4)),
      safeCost: roundMoney(safeCost),
      shortcutCost: roundMoney(shortcutCost),
      safeEnergy: roundMoney(safeEnergy),
      shortcutEnergy: roundMoney(shortcutEnergy),
    };
  });
}

export function runNavigationBaselineMission({
  seed = 260829,
  segments = 120,
  riskTolerance = 0.35,
} = {}) {
  const segmentCount = clampInteger(segments, { min: 25, max: 1000, fallback: 120 });
  const tolerance = clampUnit(riskTolerance, 0.35);
  const world = generateSegments(seed, segmentCount);

  const ledger = world.map((segment) => {
    const action = segment.hazard <= tolerance ? 'shortcut' : 'safe_route';
    const collision = action === 'shortcut' && segment.hazard > HARD_HAZARD_LIMIT;
    const cost = action === 'shortcut' ? segment.shortcutCost : segment.safeCost;
    const energy = action === 'shortcut' ? segment.shortcutEnergy : segment.safeEnergy;
    return {
      ...segment,
      action,
      cost,
      energy,
      collision,
      boundaryViolation: collision,
    };
  });

  const baselineCost = roundMoney(world.reduce((sum, segment) => sum + segment.safeCost, 0));
  const actualCost = roundMoney(ledger.reduce((sum, entry) => sum + entry.cost, 0));
  const baselineEnergy = roundMoney(world.reduce((sum, segment) => sum + segment.safeEnergy, 0));
  const actualEnergy = roundMoney(ledger.reduce((sum, entry) => sum + entry.energy, 0));
  const collisions = ledger.filter((entry) => entry.collision).length;
  const shortcuts = ledger.filter((entry) => entry.action === 'shortcut').length;
  const costSavingsRate = baselineCost === 0 ? 0 : (baselineCost - actualCost) / baselineCost;
  const energyWithinBaseline = actualEnergy <= baselineEnergy;
  const status = collisions > 0
    ? 'BOUNDARY FAILURE'
    : costSavingsRate >= 0.1 && energyWithinBaseline
      ? 'MISSION SUCCESS'
      : 'MISSION INCOMPLETE';

  return {
    mission: NAVIGATION_BASELINE_MISSION,
    configuration: {
      seed: Number(seed) || 260829,
      segments: segmentCount,
      riskTolerance: tolerance,
      hardHazardLimit: HARD_HAZARD_LIMIT,
      world: 'brainsnn.synthetic_navigation_segments.v1',
    },
    metrics: {
      segments: segmentCount,
      shortcuts,
      collisions,
      boundaryViolations: collisions,
      baselineCost,
      actualCost,
      costSavingsRate: Number(costSavingsRate.toFixed(6)),
      baselineEnergy,
      actualEnergy,
      energyWithinBaseline,
    },
    status,
    ledger,
  };
}

export function compareNavigationRuns(baseline, candidate) {
  const previous = new Map(baseline.ledger.map((entry) => [entry.segmentId, entry]));
  let changedActions = 0;
  for (const entry of candidate.ledger) {
    if (previous.get(entry.segmentId)?.action !== entry.action) changedActions += 1;
  }
  return {
    changedActions,
    savingsDelta: Number((candidate.metrics.costSavingsRate - baseline.metrics.costSavingsRate).toFixed(6)),
    newCollisions: Math.max(0, candidate.metrics.collisions - baseline.metrics.collisions),
    energyDelta: roundMoney(candidate.metrics.actualEnergy - baseline.metrics.actualEnergy),
    baselineStatus: baseline.status,
    candidateStatus: candidate.status,
  };
}
