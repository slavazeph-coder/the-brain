import { clampInteger, createSeededRandom, roundMoney } from './missionRuntime.js';

const DEFAULT_SEED = 260829;
const DEFAULT_CASES = 500;
const DEFAULT_REVIEW_THRESHOLD = 0.62;
const FAST_PATH_COST = 0.75;
const FULL_REVIEW_COST = 4;
const QUALITY_FLOOR = 0.95;
const REQUIRED_REVIEW_THRESHOLD = 0.65;
const CRITICAL_THRESHOLD = 0.9;

function roundRate(value) {
  return Math.round(value * 10000) / 10000;
}

function boundedThreshold(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REVIEW_THRESHOLD;
  return Math.min(0.98, Math.max(0.2, parsed));
}

export const WORKFLOW_EFFICIENCY_MISSION = Object.freeze({
  id: 'brainsnn.proof_mission.workflow_efficiency.v1',
  title: 'Workflow Efficiency',
  mission: 'Reduce processing cost against a deterministic full-review baseline.',
  boundary: 'Maintain at least 95% quality conformance and never fast-path a critical case.',
  judge: 'A deterministic ledger scores workflow cost, quality conformance and hard-boundary violations.',
  claimBoundary: 'This finite synthetic mission measures only the declared reference mind, generated cases, cost model, rules and seed. It does not establish real-world savings, universal model quality, production reliability or regulatory compliance.',
});

export function runWorkflowEfficiencyMission({
  seed = DEFAULT_SEED,
  cases = DEFAULT_CASES,
  reviewThreshold = DEFAULT_REVIEW_THRESHOLD,
} = {}) {
  const boundedCases = clampInteger(cases, { min: 25, max: 2000, fallback: DEFAULT_CASES });
  const threshold = boundedThreshold(reviewThreshold);
  const resolvedSeed = Number(seed) || DEFAULT_SEED;
  const random = createSeededRandom(resolvedSeed, DEFAULT_SEED);
  const ledger = [];

  for (let i = 0; i < boundedCases; i += 1) {
    const complexity = roundRate(random());
    const ambiguity = roundRate(random());
    const urgency = roundRate(random());
    const missingData = random() < 0.14;
    const risk = roundRate(
      0.45 * complexity
      + 0.30 * ambiguity
      + 0.15 * urgency
      + 0.10 * (missingData ? 1 : 0),
    );
    const requiresReview = risk >= REQUIRED_REVIEW_THRESHOLD;
    const critical = risk >= CRITICAL_THRESHOLD;
    const action = risk >= threshold ? 'full-review' : 'fast-path';
    const expected = requiresReview ? 'full-review' : 'fast-path';
    const qualityPass = action === 'full-review' || !requiresReview;
    const boundaryViolation = critical && action !== 'full-review';
    const cost = action === 'full-review' ? FULL_REVIEW_COST : FAST_PATH_COST;

    ledger.push({
      caseId: `W-${String(i + 1).padStart(4, '0')}`,
      complexity,
      ambiguity,
      urgency,
      missingData,
      risk,
      requiresReview,
      critical,
      action,
      expected,
      correct: action === expected,
      qualityPass,
      boundaryViolation,
      cost,
      avoidableReview: action === 'full-review' && !requiresReview,
      missedReview: action === 'fast-path' && requiresReview,
    });
  }

  const baselineCost = roundMoney(boundedCases * FULL_REVIEW_COST);
  const actualCost = roundMoney(ledger.reduce((sum, entry) => sum + entry.cost, 0));
  const savingsRate = roundRate((baselineCost - actualCost) / baselineCost);
  const qualityPasses = ledger.filter((entry) => entry.qualityPass).length;
  const qualityConformance = roundRate(qualityPasses / boundedCases);
  const boundaryViolations = ledger.filter((entry) => entry.boundaryViolation).length;
  const fullReviews = ledger.filter((entry) => entry.action === 'full-review').length;
  const fastPaths = boundedCases - fullReviews;
  const avoidableReviews = ledger.filter((entry) => entry.avoidableReview).length;
  const missedReviews = ledger.filter((entry) => entry.missedReview).length;

  const status = boundaryViolations > 0
    ? 'BOUNDARY FAILURE'
    : qualityConformance < QUALITY_FLOOR
      ? 'QUALITY FAILURE'
      : savingsRate < 0.2
        ? 'MISSION FAILURE'
        : 'MISSION SUCCESS';

  return {
    schema: 'brainsnn.proof_mission_result.v1',
    mission: WORKFLOW_EFFICIENCY_MISSION,
    configuration: {
      seed: resolvedSeed,
      cases: boundedCases,
      reviewThreshold: threshold,
      qualityFloor: QUALITY_FLOOR,
      requiredReviewThreshold: REQUIRED_REVIEW_THRESHOLD,
      criticalThreshold: CRITICAL_THRESHOLD,
      fastPathCost: FAST_PATH_COST,
      fullReviewCost: FULL_REVIEW_COST,
    },
    metrics: {
      decisions: boundedCases,
      baselineCost,
      actualCost,
      savingsRate,
      qualityPasses,
      qualityConformance,
      fullReviews,
      fastPaths,
      avoidableReviews,
      missedReviews,
      boundaryViolations,
    },
    status,
    ledger,
  };
}

export function compareWorkflowRuns(baseline, fork) {
  const count = Math.min(baseline.ledger.length, fork.ledger.length);
  let changedActions = 0;
  let newViolations = 0;
  const divergences = [];

  for (let i = 0; i < count; i += 1) {
    const a = baseline.ledger[i];
    const b = fork.ledger[i];
    if (a.action !== b.action) {
      changedActions += 1;
      if (divergences.length < 20) {
        divergences.push({
          caseId: a.caseId,
          risk: a.risk,
          baseline: a.action,
          fork: b.action,
          requiresReview: a.requiresReview,
          critical: a.critical,
        });
      }
    }
    if (!a.boundaryViolation && b.boundaryViolation) newViolations += 1;
  }

  return {
    changedActions,
    newViolations,
    costDelta: roundMoney(fork.metrics.actualCost - baseline.metrics.actualCost),
    savingsRateDelta: roundRate(fork.metrics.savingsRate - baseline.metrics.savingsRate),
    qualityDelta: roundRate(fork.metrics.qualityConformance - baseline.metrics.qualityConformance),
    divergences,
  };
}
