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
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function experimentScore(experiment) {
  return finiteOrNull(experiment?.metrics?.meanPearson ?? experiment?.benchmark?.meanPearson);
}

export function normalizeExperiment(experiment = {}) {
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
      trained: Boolean(experiment?.model?.trained),
    },
    dataset: {
      id: String(experiment?.dataset?.id || 'unconfigured'),
      split: String(experiment?.dataset?.split || 'validation'),
      license: String(experiment?.dataset?.license || 'unknown'),
    },
    config: { ...(experiment.config || {}) },
    metrics: {
      meanPearson: finiteOrNull(experiment?.metrics?.meanPearson),
      medianPearson: finiteOrNull(experiment?.metrics?.medianPearson),
      positiveParcelFraction: finiteOrNull(experiment?.metrics?.positiveParcelFraction),
      latencyMs: finiteOrNull(experiment?.metrics?.latencyMs),
      modelBytes: finiteOrNull(experiment?.metrics?.modelBytes),
    },
    benchmarkValid: Boolean(experiment.benchmarkValid),
    dataLeakageDetected: Boolean(experiment.dataLeakageDetected),
    failureReason: experiment.failureReason ? String(experiment.failureReason).slice(0, 1000) : null,
    createdAt: experiment.createdAt || null,
  };
}

export function selectChampion(experiments = []) {
  const eligible = experiments
    .map(normalizeExperiment)
    .filter((item) => item.benchmarkValid && !item.dataLeakageDetected && experimentScore(item) != null)
    .sort((a, b) => experimentScore(b) - experimentScore(a));
  return eligible[0] || null;
}

export function evaluatePromotion({ candidate, champion = null, minDelta = 0.002, maxLatencyIncreaseFraction = 0.25 } = {}) {
  const next = normalizeExperiment(candidate || {});
  const current = champion ? normalizeExperiment(champion) : null;
  const candidateScore = experimentScore(next);
  const championScore = experimentScore(current);

  if (!next.benchmarkValid) return { promote: false, reason: 'candidate benchmark is not valid' };
  if (next.dataLeakageDetected) return { promote: false, reason: 'data leakage was detected' };
  if (candidateScore == null) return { promote: false, reason: 'candidate has no measured mean Pearson benchmark' };
  if (!next.model.trained) return { promote: false, reason: 'candidate is not a trained model' };
  if (!current || championScore == null) return { promote: true, reason: 'first valid trained benchmarked candidate' };

  const delta = candidateScore - championScore;
  if (delta < minDelta) return { promote: false, reason: `mean Pearson delta ${delta.toFixed(4)} is below ${minDelta.toFixed(4)}`, delta };

  const candidateLatency = next.metrics.latencyMs;
  const championLatency = current.metrics.latencyMs;
  if (candidateLatency != null && championLatency != null && championLatency > 0) {
    const latencyIncrease = (candidateLatency - championLatency) / championLatency;
    if (latencyIncrease > maxLatencyIncreaseFraction) {
      return { promote: false, reason: `latency increased ${(latencyIncrease * 100).toFixed(1)}%`, delta, latencyIncrease };
    }
  }

  return { promote: true, reason: `mean Pearson improved by ${delta.toFixed(4)} within resource limits`, delta };
}

function nextAlpha(history = []) {
  const tried = new Set(history.map((item) => Number(item?.config?.alpha)).filter(Number.isFinite));
  for (const alpha of [1, 10, 0.1, 100, 0.01]) if (!tried.has(alpha)) return alpha;
  return 1;
}

function nextLagTr(history = []) {
  const tried = new Set(history.map((item) => Number(item?.config?.lagTr)).filter(Number.isFinite));
  for (const lagTr of [3, 2, 4, 1, 0]) if (!tried.has(lagTr)) return lagTr;
  return 3;
}

/**
 * A bounded deterministic research planner. It proposes experiments; it does
 * not declare scientific success. Promotion is decided only by measured held-
 * out benchmark metrics through evaluatePromotion().
 */
export function proposeNextExperiment({ experiments = [], datasetId = 'algonauts-2025', budget = {} } = {}) {
  const normalized = experiments.map(normalizeExperiment);
  const champion = selectChampion(normalized);
  const successful = normalized.filter((item) => item.benchmarkValid && experimentScore(item) != null);
  const failures = normalized.filter((item) => item.status === 'FAILED' || item.failureReason);

  let hypothesis;
  let config;
  if (!successful.length) {
    hypothesis = 'Establish the first reproducible multimodal ridge encoding baseline against held-out recorded neural targets.';
    config = { family: 'ridge', alpha: 1, lagTr: 3, featureSet: 'precomputed-multimodal-v0', seed: 7 };
  } else if (successful.length < 5) {
    const alpha = nextAlpha(normalized);
    const lagTr = nextLagTr(normalized);
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
      dataset: { id: datasetId, split: 'held-out-validation', license: 'verify-from-manifest' },
      config,
    },
    budget: {
      maxTrainingMinutes: finiteOrNull(budget.maxTrainingMinutes),
      maxGpuHours: finiteOrNull(budget.maxGpuHours),
      maxCostUsd: finiteOrNull(budget.maxCostUsd),
    },
    recentFailureCount: failures.slice(-10).length,
    requiresApproval: true,
    decisionAuthority: 'objective benchmark, not the planner',
  };
}
