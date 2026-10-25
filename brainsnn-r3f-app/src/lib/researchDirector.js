export const EXPERIMENT_SCHEMA_VERSION = 'brainsnn.experiment.v0.1';
export const RESEARCH_PROPOSAL_SCHEMA_VERSION = 'brainsnn.research-proposal.v0.1';

export const EXPERIMENT_STATES = Object.freeze([
  'PROPOSED',
  'APPROVED',
  'QUEUED',
  'RUNNING',
  'EVALUATED',
  'PROMOTED',
  'REJECTED',
  'FAILED',
]);

function finiteOrNull(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function measuredInRange(value, min, max = Infinity) {
  const numeric = finiteOrNull(value);
  return numeric != null && numeric >= min && numeric <= max ? numeric : null;
}

function identityOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function experimentScore(experiment) {
  return experiment?.metrics?.meanPearson ?? null;
}

export function normalizeExperiment(experiment = {}) {
  if (!experiment || typeof experiment !== 'object' || Array.isArray(experiment)) experiment = {};
  const status = EXPERIMENT_STATES.includes(experiment.status) ? experiment.status : 'PROPOSED';
  return {
    schemaVersion: EXPERIMENT_SCHEMA_VERSION,
    id: String(experiment.id || `experiment-${Date.now()}`),
    parentId: experiment.parentId ? String(experiment.parentId) : null,
    hypothesis: String(experiment.hypothesis || '').slice(0, 1000),
    status,
    model: {
      family: String(experiment?.model?.family || 'ridge'),
      version: String(experiment?.model?.version || '0.1.0'),
      trained: experiment?.model?.trained === true,
    },
    dataset: {
      id: identityOrNull(experiment?.dataset?.id),
      split: identityOrNull(experiment?.dataset?.split),
      license: String(experiment?.dataset?.license || 'unknown'),
    },
    config: { ...(experiment.config || {}) },
    metrics: {
      meanPearson: measuredInRange(experiment?.metrics?.meanPearson, -1, 1),
      medianPearson: measuredInRange(experiment?.metrics?.medianPearson, -1, 1),
      positiveParcelFraction: measuredInRange(experiment?.metrics?.positiveParcelFraction, 0, 1),
      latencyMs: measuredInRange(experiment?.metrics?.latencyMs, 0),
      modelBytes: measuredInRange(experiment?.metrics?.modelBytes, 0),
    },
    benchmarkValid: experiment.benchmarkValid === true,
    dataLeakageDetected: typeof experiment.dataLeakageDetected === 'boolean' ? experiment.dataLeakageDetected : null,
    failureReason: experiment.failureReason ? String(experiment.failureReason).slice(0, 1000) : null,
    createdAt: experiment.createdAt || null,
  };
}

function ineligibilityReason(item) {
  if (!['EVALUATED', 'PROMOTED'].includes(item.status)) return 'experiment is not completed and evaluated';
  if (item.failureReason) return 'experiment has a recorded failure';
  if (!item.benchmarkValid) return 'benchmark is not valid';
  if (item.dataLeakageDetected === true) return 'data leakage was detected';
  if (item.dataLeakageDetected !== false) return 'data leakage check is not recorded';
  if (experimentScore(item) == null) return 'no measured mean Pearson benchmark within [-1, 1]';
  if (!item.model.trained) return 'not a trained model';
  if (!item.dataset.id || item.dataset.id === 'unconfigured' || !item.dataset.split) return 'benchmark dataset and split must be identified';
  if (item.metrics.latencyMs == null) return 'no measured nonnegative latency';
  return null;
}

function sameBenchmark(a, b) {
  return a.dataset.id === b.dataset.id && a.dataset.split === b.dataset.split;
}

/** Dataset/split labels are caller declarations, not verified benchmark provenance. */
export function selectChampion(experiments = [], { datasetId, datasetSplit } = {}) {
  const scopedId = datasetId === undefined ? undefined : identityOrNull(datasetId);
  const scopedSplit = datasetSplit === undefined ? undefined : identityOrNull(datasetSplit);
  const eligible = experiments
    .map(normalizeExperiment)
    .filter((item) => !ineligibilityReason(item))
    .filter((item) => (scopedId === undefined || item.dataset.id === scopedId)
      && (scopedSplit === undefined || item.dataset.split === scopedSplit))
    .sort((a, b) => experimentScore(b) - experimentScore(a));
  // A cross-dataset leaderboard cannot establish a comparable champion.
  if (eligible.some((item) => !sameBenchmark(item, eligible[0]))) return null;
  return eligible[0] || null;
}

export function evaluatePromotion({ candidate, champion = null, minDelta = 0.002, maxLatencyIncreaseFraction = 0.25 } = {}) {
  const next = normalizeExperiment(candidate || {});
  const current = champion == null ? null : normalizeExperiment(champion);
  const candidateScore = experimentScore(next);
  const championScore = experimentScore(current);

  const requiredDelta = measuredInRange(minDelta, 0);
  const latencyLimit = measuredInRange(maxLatencyIncreaseFraction, 0);
  if (requiredDelta == null || latencyLimit == null) return { promote: false, reason: 'promotion limits must be finite nonnegative numbers' };
  const candidateFailure = ineligibilityReason(next);
  if (candidateFailure) return { promote: false, reason: `candidate ${candidateFailure}` };
  if (!current) return { promote: true, reason: 'first valid trained benchmarked candidate' };
  const championFailure = ineligibilityReason(current);
  if (championFailure) return { promote: false, reason: `current champion ${championFailure}` };
  if (!sameBenchmark(next, current)) return { promote: false, reason: 'candidate and champion benchmark dataset/split differ' };

  const delta = candidateScore - championScore;
  if (delta < requiredDelta) return { promote: false, reason: `mean Pearson delta ${delta.toFixed(4)} is below ${requiredDelta.toFixed(4)}`, delta };

  const candidateLatency = next.metrics.latencyMs;
  const championLatency = current.metrics.latencyMs;
  if (championLatency === 0 && candidateLatency > 0) {
    return { promote: false, reason: 'latency increased from a measured zero baseline beyond the relative limit', delta };
  }
  if (championLatency > 0) {
    const latencyIncrease = (candidateLatency - championLatency) / championLatency;
    if (latencyIncrease > latencyLimit) {
      return { promote: false, reason: `latency increased ${(latencyIncrease * 100).toFixed(1)}%`, delta, latencyIncrease };
    }
  }

  return { promote: true, reason: `mean Pearson improved by ${delta.toFixed(4)} within resource limits`, delta };
}

function nextAlpha(history = []) {
  const tried = new Set(history.map((item) => finiteOrNull(item?.config?.alpha)).filter((value) => value != null));
  for (const alpha of [1, 10, 0.1, 100, 0.01]) if (!tried.has(alpha)) return alpha;
  return 1;
}

function nextLagTr(history = []) {
  const tried = new Set(history.map((item) => finiteOrNull(item?.config?.lagTr)).filter((value) => value != null));
  for (const lagTr of [3, 2, 4, 1, 0]) if (!tried.has(lagTr)) return lagTr;
  return 3;
}

/**
 * A bounded deterministic research planner. It proposes experiments; it does
 * not declare scientific success. Promotion is decided only by measured held-
 * out benchmark metrics through evaluatePromotion().
 */
export function proposeNextExperiment({ experiments = [], datasetId = 'algonauts-2025', datasetSplit = 'held-out-validation', budget = {} } = {}) {
  datasetId = identityOrNull(datasetId);
  datasetSplit = identityOrNull(datasetSplit);
  const normalized = experiments.map(normalizeExperiment);
  const comparable = normalized.filter((item) => item.dataset.id === datasetId && item.dataset.split === datasetSplit);
  const champion = selectChampion(comparable);
  const successful = comparable.filter((item) => !ineligibilityReason(item));
  const failures = normalized.filter((item) => item.status === 'FAILED' || item.failureReason);

  let hypothesis;
  let config;
  if (!successful.length) {
    hypothesis = 'Establish the first reproducible multimodal ridge encoding baseline against held-out recorded neural targets.';
    config = { family: 'ridge', alpha: 1, lagTr: 3, featureSet: 'precomputed-multimodal-v0', seed: 7 };
  } else if (successful.length < 5) {
    const alpha = nextAlpha(comparable);
    const lagTr = nextLagTr(comparable);
    hypothesis = `Test whether ridge regularization alpha=${alpha} and temporal lag=${lagTr} TR improve held-out parcel predictivity without changing the feature set.`;
    config = { family: 'ridge', alpha, lagTr, featureSet: 'precomputed-multimodal-v0', seed: 7 };
  } else {
    hypothesis = 'Test a small fusion MLP against the established ridge champion while holding dataset split and feature extraction fixed.';
    config = { family: 'tiny-fusion-mlp', hiddenSize: 128, epochs: 30, lagTr: 3, featureSet: 'precomputed-multimodal-v0', seed: 7 };
  }

  const proposalId = `proposal-${String(normalized.length + 1).padStart(4, '0')}`;
  return {
    schemaVersion: RESEARCH_PROPOSAL_SCHEMA_VERSION,
    id: proposalId,
    objective: 'Improve held-out recorded-neural-response predictivity while preserving reproducibility, license eligibility, and compute limits.',
    currentChampionId: champion?.id || null,
    hypothesis,
    proposedExperiment: {
      schemaVersion: EXPERIMENT_SCHEMA_VERSION,
      id: `mirror-${String(normalized.length + 1).padStart(4, '0')}`,
      parentId: champion?.id || null,
      status: 'PROPOSED',
      hypothesis,
      model: { family: config.family, version: '0.1.0', trained: false },
      dataset: { id: datasetId, split: datasetSplit, license: 'verify-from-manifest' },
      config,
    },
    budget: {
      maxTrainingMinutes: measuredInRange(budget.maxTrainingMinutes, 0),
      maxGpuHours: measuredInRange(budget.maxGpuHours, 0),
      maxCostUsd: measuredInRange(budget.maxCostUsd, 0),
    },
    recentFailureCount: failures.slice(-10).length,
    requiresApproval: true,
    decisionAuthority: 'objective benchmark, not the planner',
  };
}
