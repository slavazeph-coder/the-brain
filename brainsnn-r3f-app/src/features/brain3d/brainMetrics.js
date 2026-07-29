// Derived measurements over a brain trial.
//
// Every quantity here is a deterministic function of the trace produced by
// runBrainTrial, so the same content and seed always yield the same numbers.
//
// CLAIM BOUNDARY: these describe the dynamics of a 7-region model driven by
// lexical features of the input text. They are not measurements of any human
// brain, and carry no clinical or predictive meaning.
import { BRAIN_REGIONS, PATHWAYS } from './brainRegions.js';

// The one closed loop in the graph: attention -> meaning -> salience -> action
// gate -> (inhibits) attention. Its gain is the model's runaway-vs-controlled
// quantity, and the reason the game has a fail state.
export const CONTROL_LOOP = ['THL-CTX', 'CTX-AMY', 'AMY-BG', 'BG-THL'];

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

// Pearson correlation; returns 0 when either train is constant (undefined r).
function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const meanA = mean(a);
  const meanB = mean(b);
  let num = 0;
  let devA = 0;
  let devB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    devA += da * da;
    devB += db * db;
  }
  if (devA <= 0 || devB <= 0) return 0;
  return num / Math.sqrt(devA * devB);
}

function activitySeries(trace, code) {
  return trace.map((frame) => frame.activities[code] ?? 0);
}

function spikeSeries(trace, code) {
  return trace.map((frame) => (frame.spikes[code] ? 1 : 0));
}

export function computeBrainMetrics(trial) {
  const { trace = [], finalState, params, targets } = trial || {};
  if (!trace.length || !finalState) return null;

  const seconds = (trace.length * params.tickMs) / 1000;
  const codes = BRAIN_REGIONS.map((region) => region.code);

  const firingRateHz = {};
  const meanActivity = {};
  const eiBalance = {};
  for (const code of codes) {
    const spikes = spikeSeries(trace, code);
    firingRateHz[code] = round(spikes.reduce((sum, value) => sum + value, 0) / seconds, 3);
    meanActivity[code] = round(mean(activitySeries(trace, code)), 4);
    const excitatory = mean(trace.map((frame) => frame.drive[code]?.excitatory ?? 0));
    const inhibitory = mean(trace.map((frame) => frame.drive[code]?.inhibitory ?? 0));
    const total = excitatory + inhibitory;
    eiBalance[code] = round(total > 0 ? (excitatory - inhibitory) / total : 0, 4);
  }

  // Judgment vs threat: the model's core semantic contrast. Capped because a
  // silenced amygdala drives the denominator to ~0, and any ratio past 10 says
  // the same thing: threat is not competing.
  const CONTROL_RATIO_CAP = 10;
  const pfc = meanActivity.PFC;
  const amy = meanActivity.AMY;
  const controlRatio = round(
    amy > 0 ? Math.min(CONTROL_RATIO_CAP, pfc / amy) : pfc > 0 ? CONTROL_RATIO_CAP : 1,
    4,
  );

  // How far threat + action pressure ran ahead of reflective control, 0-100.
  const hijackRaw = mean(trace.map((frame) => (
    ((frame.activities.AMY ?? 0) + (frame.activities.BG ?? 0)) / 2 - (frame.activities.PFC ?? 0)
  )));
  const hijackIndex = Math.round(clamp01(hijackRaw + 0.5) * 100);

  const finalWeights = finalState.weights;
  const loopGain = round(CONTROL_LOOP.reduce((product, id) => product * (finalWeights[id] ?? 0), 1), 6);
  const gateIntegrity = round((finalWeights['BG-THL'] ?? 0) * meanActivity.BG, 4);

  // Mean pairwise correlation of the region spike trains.
  const trains = codes.map((code) => spikeSeries(trace, code));
  const pairs = [];
  for (let i = 0; i < trains.length; i += 1) {
    for (let j = i + 1; j < trains.length; j += 1) pairs.push(correlation(trains[i], trains[j]));
  }
  const synchronyIndex = round(mean(pairs), 4);

  // Time to reach the driven equilibrium, in ticks (null if it never settles).
  let settlingTicks = null;
  if (targets) {
    const tolerance = 0.08 * codes.length;
    let consecutive = 0;
    for (let index = 0; index < trace.length; index += 1) {
      const distance = codes.reduce((sum, code) => (
        targets[code] == null ? sum : sum + Math.abs((trace[index].activities[code] ?? 0) - targets[code])
      ), 0);
      consecutive = distance < tolerance ? consecutive + 1 : 0;
      if (consecutive >= 5) {
        settlingTicks = index - 4;
        break;
      }
    }
  }

  const weightDrift = round(PATHWAYS.reduce((sum, pathway) => (
    sum + Math.abs((finalWeights[pathway.id] ?? 0) - pathway.initialWeight)
  ), 0), 4);

  const stdpFlux = round(trace.reduce((sum, frame) => (
    sum + Object.values(frame.stdpDelta || {}).reduce((inner, value) => inner + value, 0)
  ), 0), 4);

  return {
    seconds: round(seconds, 3),
    ticks: trace.length,
    firingRateHz,
    meanActivity,
    eiBalance,
    controlRatio,
    hijackIndex,
    loopGain,
    gateIntegrity,
    synchronyIndex,
    settlingTicks,
    plasticity: round(finalState.plasticity, 4),
    weightDrift,
    stdpFlux,
    meanFiring: round(mean(trace.map((frame) => frame.meanFiring)), 4),
  };
}

// Presentation metadata: label, units and which direction is "healthy", so the
// UI never has to hardcode interpretation.
export const METRIC_DESCRIPTORS = Object.freeze([
  { id: 'controlRatio', label: 'Control ratio', unit: 'PFC ÷ AMY', direction: 'higher-good', explanation: 'Reflective control relative to threat response.' },
  { id: 'hijackIndex', label: 'Hijack index', unit: '0–100', direction: 'lower-good', explanation: 'How far threat and action pressure ran ahead of judgment.' },
  { id: 'loopGain', label: 'Loop gain', unit: 'product of 4 weights', direction: 'lower-good', explanation: 'Gain around the attention → salience → gate loop.' },
  { id: 'gateIntegrity', label: 'Gate integrity', unit: '0–1', direction: 'higher-good', explanation: 'Strength of the inhibitory brake on incoming attention.' },
  { id: 'synchronyIndex', label: 'Synchrony', unit: 'mean pairwise r', direction: 'contextual', explanation: 'Correlation between region spike trains.' },
  { id: 'plasticity', label: 'Plasticity', unit: 'mean weight', direction: 'contextual', explanation: 'Average synaptic strength after learning.' },
  { id: 'weightDrift', label: 'Weight drift', unit: 'Σ|Δw|', direction: 'contextual', explanation: 'Total learning away from the initial wiring.' },
  { id: 'stdpFlux', label: 'STDP flux', unit: 'Σ potentiation − depression', direction: 'contextual', explanation: 'Net direction of spike-timing learning.' },
]);

export const BRAIN_CLAIM_BOUNDARY = 'Simulated dynamics of a 7-region model driven by lexical features of the text. '
  + 'Not a measurement of any human brain, and not a clinical or predictive claim.';
