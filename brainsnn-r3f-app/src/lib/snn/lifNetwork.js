// Leaky integrate-and-fire network in the Brunel (2000) formulation.
//
// The 7-region model in features/brain3d is a *rate* model: one scalar per
// region, no membrane potential, no threshold, no refractory period. This is
// the real thing — a sparse random network of LIF neurons with fixed-amplitude
// delta synapses, transmission delays, Dale's law, and Poisson external drive.
//
// Reference: N. Brunel, "Dynamics of sparsely connected networks of excitatory
// and inhibitory spiking neurons", J. Comput. Neurosci. 8, 183-208 (2000).
//
// Everything is seeded, so a network and its spike train are reproducible.
// Implementation uses typed arrays and CSR adjacency so ~1000 neurons over
// 1 s of biological time stays well inside a browser frame budget.
import { createRng } from '../rng.js';

export const BRUNEL_DEFAULTS = Object.freeze({
  N: 1000, // total neurons
  excitatoryFraction: 0.8, // Dale's law: 80% excitatory, 20% inhibitory
  epsilon: 0.1, // connection probability
  g: 5, // relative strength of inhibition (g > 4 is inhibition-dominated)
  eta: 2, // external drive as a multiple of the threshold rate
  J: 0.1, // excitatory PSP amplitude, mV
  delayMs: 1.5, // axonal transmission delay
  tauMs: 20, // membrane time constant
  vThreshold: 20, // mV above rest
  vReset: 10, // mV
  refractoryMs: 2,
  dtMs: 0.1,
  durationMs: 1000,
});

export function createNetworkConfig(overrides = {}) {
  const params = { ...BRUNEL_DEFAULTS, ...(overrides || {}) };
  const nExcitatory = Math.max(1, Math.round(params.N * params.excitatoryFraction));
  const nInhibitory = Math.max(1, params.N - nExcitatory);
  const cExcitatory = Math.max(1, Math.round(params.epsilon * nExcitatory));
  const cInhibitory = Math.max(1, Math.round(params.epsilon * nInhibitory));
  // Rate of external drive at which a neuron reaches threshold on excitation
  // alone: nu_thr = theta / (J * C_E * tau).   [Brunel 2000, eq. 6]
  const tauSeconds = params.tauMs / 1000;
  const nuThresholdHz = params.vThreshold / (params.J * cExcitatory * tauSeconds);
  return {
    ...params,
    nExcitatory,
    nInhibitory,
    cExcitatory,
    cInhibitory,
    cExternal: cExcitatory,
    nuThresholdHz,
    nuExternalHz: params.eta * nuThresholdHz,
  };
}

// Knuth's algorithm; external drive per step has a small mean (~2), so the
// direct method is both exact and fast enough here.
function poisson(rng, lambda) {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let product = rng();
  while (product > limit) {
    k += 1;
    product *= rng();
    if (k > 1000) break;
  }
  return k;
}

/**
 * Sparse random connectivity with fixed in-degree, stored as CSR by
 * presynaptic neuron so spike delivery is a contiguous walk.
 */
export function buildConnectivity(config, rng) {
  const { N, nExcitatory, cExcitatory, cInhibitory } = config;
  const targetsPerSource = new Array(N);
  for (let i = 0; i < N; i += 1) targetsPerSource[i] = [];

  for (let post = 0; post < N; post += 1) {
    for (let k = 0; k < cExcitatory; k += 1) {
      const pre = Math.floor(rng() * nExcitatory);
      targetsPerSource[pre].push(post);
    }
    for (let k = 0; k < cInhibitory; k += 1) {
      const pre = nExcitatory + Math.floor(rng() * (N - nExcitatory));
      targetsPerSource[pre].push(post);
    }
  }

  const offsets = new Int32Array(N + 1);
  let total = 0;
  for (let i = 0; i < N; i += 1) {
    offsets[i] = total;
    total += targetsPerSource[i].length;
  }
  offsets[N] = total;

  const targets = new Int32Array(total);
  let cursor = 0;
  for (let i = 0; i < N; i += 1) {
    for (const post of targetsPerSource[i]) {
      targets[cursor] = post;
      cursor += 1;
    }
  }
  return { offsets, targets, synapseCount: total };
}

/**
 * Simulate the network. Returns spike times per neuron (subsampled for the
 * raster), the binned population rate, and the raw counts needed for metrics.
 */
export function simulateLif({ config: overrides = {}, seed = 'brunel', rasterNeurons = 60 } = {}) {
  const config = createNetworkConfig(overrides);
  const rng = createRng(seed);
  const { N, nExcitatory, J, g, dtMs, durationMs, tauMs, vThreshold, vReset } = config;

  const connectivity = buildConnectivity(config, rng);
  const steps = Math.max(1, Math.round(durationMs / dtMs));
  const delaySteps = Math.max(1, Math.round(config.delayMs / dtMs));
  const refractorySteps = Math.max(0, Math.round(config.refractoryMs / dtMs));
  const decay = Math.exp(-dtMs / tauMs);
  const inhibitoryAmplitude = -g * J;
  const externalLambda = (config.cExternal * config.nuExternalHz * dtMs) / 1000;

  const voltage = new Float32Array(N);
  const refractory = new Int32Array(N);
  // Ring buffer of delayed synaptic input. One slot MORE than the delay, so
  // the slot written this step is never the slot being read this step —
  // otherwise a spike would reach later-indexed neurons instantaneously.
  const ringSlots = delaySteps + 1;
  const ring = new Float32Array(ringSlots * N);
  const spikeCounts = new Int32Array(N);
  const populationRate = new Float32Array(steps);
  const lastSpikeStep = new Int32Array(N).fill(-1);
  // Running ISI statistics per neuron, so no per-spike arrays are retained.
  const isiSum = new Float64Array(N);
  const isiSumSquares = new Float64Array(N);
  const isiCount = new Int32Array(N);

  const rasterCount = Math.min(rasterNeurons, N);
  const raster = [];

  for (let step = 0; step < steps; step += 1) {
    const slot = (step % ringSlots) * N;
    let spikesThisStep = 0;

    for (let i = 0; i < N; i += 1) {
      const arriving = ring[slot + i];
      ring[slot + i] = 0;

      if (refractory[i] > 0) {
        refractory[i] -= 1;
        voltage[i] = vReset;
        continue;
      }

      const external = poisson(rng, externalLambda) * J;
      const next = voltage[i] * decay + arriving + external;

      if (next >= vThreshold) {
        voltage[i] = vReset;
        refractory[i] = refractorySteps;
        spikeCounts[i] += 1;
        spikesThisStep += 1;

        if (lastSpikeStep[i] >= 0) {
          const isi = (step - lastSpikeStep[i]) * dtMs;
          isiSum[i] += isi;
          isiSumSquares[i] += isi * isi;
          isiCount[i] += 1;
        }
        lastSpikeStep[i] = step;
        if (i < rasterCount) raster.push([i, step * dtMs]);

        // Deliver this spike to every postsynaptic target, one delay later.
        const amplitude = i < nExcitatory ? J : inhibitoryAmplitude;
        const arrivalSlot = ((step + delaySteps) % ringSlots) * N;
        const start = connectivity.offsets[i];
        const end = connectivity.offsets[i + 1];
        for (let edge = start; edge < end; edge += 1) {
          ring[arrivalSlot + connectivity.targets[edge]] += amplitude;
        }
      } else {
        voltage[i] = next;
      }
    }

    populationRate[step] = spikesThisStep;
  }

  return {
    config,
    seed,
    steps,
    synapseCount: connectivity.synapseCount,
    spikeCounts,
    populationRate,
    isiSum,
    isiSumSquares,
    isiCount,
    raster,
    rasterCount,
  };
}
