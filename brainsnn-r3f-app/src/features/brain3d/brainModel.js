// Pure, seeded, parameterized brain model.
//
// The dynamics are the ones the 3D brain has always run — a 7-region leaky rate
// network with STDP — lifted out of the React hook so they can be:
//   * seeded (same content -> same run, which the old Math.random() prevented),
//   * parameterized (every constant was a hardcoded literal),
//   * intervened on (lesion a region, cut a pathway, inject current),
//   * run headless for scoring, verification and tests.
//
// Nothing here touches React, the DOM or three.js. DEFAULT_PARAMS reproduces
// the original behaviour exactly, so the live visual is unchanged.
import { BRAIN_REGIONS, PATHWAYS, REGION_MAP } from './brainRegions.js';
import { createRng } from '../../lib/rng.js';

export const DEFAULT_PARAMS = Object.freeze({
  // Membrane / rate dynamics
  leak: 0.78,
  synapticGain: 0.18,
  homeostasisRate: 0.12,
  targetBlend: 0.7,
  baseBlend: 0.3,
  replayRate: 0.022,
  noiseAmplitude: 0.018,
  activityFloor: 0.03,
  activityCeiling: 1,
  // Stimulus
  burstGain: 0.018,
  burstTicks: 18,
  // Spiking
  spikeThreshold: 0.24,
  spikeSlope: 1.1,
  spikeMax: 0.85,
  // STDP
  stdpPotentiation: 0.014,
  stdpDepression: 0.013,
  stdpTau: 3.2,
  stdpWindow: 5,
  burstPotentiation: 0.0035,
  // Weight regulation
  weightSetPoint: 0.44,
  weightHomeostasisRate: 0.015,
  hebbianRate: 0.0065,
  inhibitionDrag: 0.001,
  weightFloor: 0.08,
  weightCeiling: 0.95,
  // Timing
  tickMs: 120,
  historyLength: 48,
});

export const EMPTY_INTERVENTIONS = Object.freeze({ lesions: [], cuts: [], stimuli: {} });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function createBrainParams(overrides = {}) {
  return { ...DEFAULT_PARAMS, ...(overrides || {}) };
}

function normalizeInterventions(interventions) {
  const source = interventions || EMPTY_INTERVENTIONS;
  return {
    lesions: new Set(source.lesions || []),
    cuts: new Set(source.cuts || []),
    stimuli: source.stimuli || {},
  };
}

export function createBrainState(params = DEFAULT_PARAMS) {
  const activities = Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, region.baseActivity]));
  const weights = Object.fromEntries(PATHWAYS.map((pathway) => [pathway.id, pathway.initialWeight]));
  return {
    tick: 0,
    burstFrames: 0,
    selectedRegion: null,
    activities,
    weights,
    lastSpike: Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, -999])),
    spikes: Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, false])),
    meanFiring: mean(Object.values(activities)),
    plasticity: mean(Object.values(weights)),
    // Per-tick diagnostics that the original loop computed and discarded.
    drive: Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, { excitatory: 0, inhibitory: 0 }])),
    stdpDelta: Object.fromEntries(PATHWAYS.map((pathway) => [pathway.id, 0])),
    history: Array.from({ length: 32 }, () => mean(Object.values(activities))),
  };
}

// Splits incoming drive into its excitatory and inhibitory parts instead of
// collapsing them, so excitation/inhibition balance becomes measurable.
function computeDrive(regionCode, activities, weights, lesions, cuts) {
  let excitatory = 0;
  let inhibitory = 0;
  for (const pathway of PATHWAYS) {
    if (pathway.to !== regionCode) continue;
    if (cuts.has(pathway.id) || lesions.has(pathway.from)) continue;
    const contribution = activities[pathway.from] * weights[pathway.id];
    if (pathway.inhibitory) inhibitory += contribution;
    else excitatory += contribution;
  }
  return { excitatory, inhibitory };
}

export function spikeProbability(activity, params = DEFAULT_PARAMS) {
  return clamp((activity - params.spikeThreshold) * params.spikeSlope, 0, params.spikeMax);
}

export function stepBrain(previous, { targets = null, params = DEFAULT_PARAMS, interventions = EMPTY_INTERVENTIONS, rng = Math.random } = {}) {
  const { lesions, cuts, stimuli } = normalizeInterventions(interventions);
  const nextTick = previous.tick + 1;
  const burstFrames = Math.max(0, previous.burstFrames - 1);

  const nextActivities = {};
  const nextDrive = {};
  const nextLastSpike = { ...previous.lastSpike };
  const spiked = {};

  for (const region of BRAIN_REGIONS) {
    const code = region.code;
    const drive = computeDrive(code, previous.activities, previous.weights, lesions, cuts);
    nextDrive[code] = drive;

    if (lesions.has(code)) {
      // A lesioned region is silent and cannot spike; it still occupies the
      // graph so downstream regions lose their input rather than rewiring.
      nextActivities[code] = 0;
      spiked[code] = false;
      continue;
    }

    const incoming = drive.excitatory - drive.inhibitory;
    const thalamicBurst = code === 'THL' ? burstFrames * params.burstGain : 0;
    const injected = Number(stimuli[code]) || 0;
    // Blend the anatomical base with the externally-driven target so scan data
    // steers the equilibrium without freezing the dynamics.
    const target = targets?.[code] != null
      ? region.baseActivity * params.baseBlend + targets[code] * params.targetBlend
      : region.baseActivity;
    const homeostasis = (target - previous.activities[code]) * params.homeostasisRate;
    const replayBoost = code === 'HPC' || code === 'CTX'
      ? (previous.activities.HPC + previous.activities.CTX) * params.replayRate
      : 0;
    const noise = (rng() * 2 - 1) * params.noiseAmplitude;

    const nextActivity = clamp(
      previous.activities[code] * params.leak
        + incoming * params.synapticGain
        + homeostasis
        + replayBoost
        + thalamicBurst
        + injected
        + noise,
      params.activityFloor,
      params.activityCeiling,
    );

    nextActivities[code] = nextActivity;

    if (rng() < spikeProbability(nextActivity, params)) {
      nextLastSpike[code] = nextTick;
      spiked[code] = true;
    } else {
      spiked[code] = false;
    }
  }

  const nextWeights = {};
  const nextStdpDelta = {};
  for (const pathway of PATHWAYS) {
    if (cuts.has(pathway.id)) {
      // A cut pathway is frozen, not deleted: reconnecting restores its weight.
      nextWeights[pathway.id] = previous.weights[pathway.id];
      nextStdpDelta[pathway.id] = 0;
      continue;
    }

    const dt = nextLastSpike[pathway.to] - nextLastSpike[pathway.from];
    let delta = 0;

    if (Math.abs(dt) <= params.stdpWindow) {
      if (dt > 0) delta += Math.exp(-Math.abs(dt) / params.stdpTau) * params.stdpPotentiation;
      else if (dt < 0) delta -= Math.exp(-Math.abs(dt) / params.stdpTau) * params.stdpDepression;
    }

    if (burstFrames > 0 && pathway.from === 'THL') delta += params.burstPotentiation;

    const homeostaticPull = (params.weightSetPoint - previous.weights[pathway.id]) * params.weightHomeostasisRate;
    const activityCoupling = nextActivities[pathway.from] * nextActivities[pathway.to] * params.hebbianRate;
    const drag = pathway.inhibitory ? -params.inhibitionDrag : 0;

    nextStdpDelta[pathway.id] = delta;
    nextWeights[pathway.id] = clamp(
      previous.weights[pathway.id] + delta + homeostaticPull + activityCoupling + drag,
      params.weightFloor,
      params.weightCeiling,
    );
  }

  const meanFiring = mean(Object.values(nextActivities));

  return {
    ...previous,
    tick: nextTick,
    burstFrames,
    activities: nextActivities,
    weights: nextWeights,
    lastSpike: nextLastSpike,
    spikes: spiked,
    drive: nextDrive,
    stdpDelta: nextStdpDelta,
    meanFiring,
    plasticity: mean(Object.values(nextWeights)),
    history: [...previous.history, meanFiring].slice(-params.historyLength),
  };
}

/**
 * Headless deterministic run. Same seed + inputs always produce the same trace,
 * which is what makes brain readouts scoreable, shareable and verifiable.
 */
export function runBrainTrial({
  targets = null,
  params: paramOverrides = null,
  interventions = EMPTY_INTERVENTIONS,
  seed = 'brainsnn',
  ticks = 240,
  settleTicks = 0,
} = {}) {
  const params = createBrainParams(paramOverrides);
  const rng = createRng(seed);
  let state = createBrainState(params);
  if (targets) state = { ...state, burstFrames: params.burstTicks };

  const trace = [];
  const totalTicks = Math.max(1, Math.floor(ticks) + Math.floor(settleTicks));
  for (let index = 0; index < totalTicks; index += 1) {
    state = stepBrain(state, { targets, params, interventions, rng });
    if (index >= settleTicks) {
      trace.push({
        tick: state.tick,
        activities: state.activities,
        spikes: state.spikes,
        weights: state.weights,
        drive: state.drive,
        stdpDelta: state.stdpDelta,
        meanFiring: state.meanFiring,
      });
    }
  }

  return { trace, finalState: state, params, targets, interventions, seed, ticks: totalTicks };
}

export { BRAIN_REGIONS, PATHWAYS, REGION_MAP };
