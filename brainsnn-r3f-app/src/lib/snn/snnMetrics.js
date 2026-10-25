// Standard measurements over a spiking simulation.
//
// These are the quantities computational neuroscience actually uses to
// characterise a network state, which is what lets us check the simulation
// against published regimes instead of asserting that it looks right.
export function meanFiringRateHz(run) {
  const { spikeCounts, config, steps } = run;
  const seconds = (steps * config.dtMs) / 1000;
  let total = 0;
  for (let i = 0; i < spikeCounts.length; i += 1) total += spikeCounts[i];
  return total / (spikeCounts.length * seconds);
}

/**
 * Mean coefficient of variation of inter-spike intervals. CV ~ 1 indicates
 * Poisson-like irregular firing; CV -> 0 indicates clock-like regularity.
 */
export function meanCvIsi(run, { minIntervals = 3 } = {}) {
  const { isiSum, isiSumSquares, isiCount } = run;
  let total = 0;
  let counted = 0;
  for (let i = 0; i < isiCount.length; i += 1) {
    const n = isiCount[i];
    if (n < minIntervals) continue;
    const mean = isiSum[i] / n;
    if (mean <= 0) continue;
    const variance = Math.max(0, isiSumSquares[i] / n - mean * mean);
    total += Math.sqrt(variance) / mean;
    counted += 1;
  }
  return counted ? total / counted : 0;
}

function binPopulation(run, binMs) {
  const { populationRate, config } = run;
  const perBin = Math.max(1, Math.round(binMs / config.dtMs));
  const bins = Math.floor(populationRate.length / perBin);
  const out = new Float64Array(bins);
  for (let b = 0; b < bins; b += 1) {
    let sum = 0;
    for (let k = 0; k < perBin; k += 1) sum += populationRate[b * perBin + k];
    out[b] = sum;
  }
  return out;
}

/**
 * Fano factor of the population spike count. Well above 1 means the population
 * is bursting together — the signature of a synchronous state.
 */
export function populationFano(run, { binMs = 5 } = {}) {
  const bins = binPopulation(run, binMs);
  if (bins.length < 2) return 0;
  let mean = 0;
  for (const value of bins) mean += value;
  mean /= bins.length;
  if (mean <= 0) return 0;
  let variance = 0;
  for (const value of bins) variance += (value - mean) ** 2;
  variance /= bins.length;
  return variance / mean;
}

/**
 * Synchrony as the normalised variance of the population rate. This is the
 * standard chi-squared-style measure and, unlike sampled pairwise correlation,
 * is stable at the network sizes we can afford in a browser.
 */
export function synchronyIndex(run, { binMs = 2 } = {}) {
  const bins = binPopulation(run, binMs);
  if (bins.length < 2) return 0;
  let mean = 0;
  for (const value of bins) mean += value;
  mean /= bins.length;
  if (mean <= 0) return 0;
  let variance = 0;
  for (const value of bins) variance += (value - mean) ** 2;
  variance /= bins.length;
  // Poisson reference: variance == mean. Normalise so ~0 is asynchronous.
  return Math.max(0, (variance - mean) / (mean * mean));
}

/**
 * Dominant oscillation of the population rate, found by direct DFT over the
 * band of interest. This is what lets a gamma-band claim be *measured* rather
 * than asserted by a closed-form formula.
 */
export function populationSpectrum(run, { binMs = 1, maxHz = 200 } = {}) {
  const bins = binPopulation(run, binMs);
  const n = bins.length;
  if (n < 8) return { peakHz: 0, peakPower: 0, bands: {} };
  let mean = 0;
  for (const value of bins) mean += value;
  mean /= n;
  const centred = Array.from(bins, (value) => value - mean);

  const sampleHz = 1000 / binMs;
  const maxBin = Math.min(Math.floor(n / 2), Math.floor((maxHz * n) / sampleHz));
  let peakHz = 0;
  let peakPower = 0;
  const bands = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };

  for (let k = 1; k <= maxBin; k += 1) {
    let re = 0;
    let im = 0;
    const factor = (-2 * Math.PI * k) / n;
    for (let t = 0; t < n; t += 1) {
      re += centred[t] * Math.cos(factor * t);
      im += centred[t] * Math.sin(factor * t);
    }
    const power = (re * re + im * im) / (n * n);
    const hz = (k * sampleHz) / n;
    if (power > peakPower) {
      peakPower = power;
      peakHz = hz;
    }
    if (hz < 4) bands.delta += power;
    else if (hz < 8) bands.theta += power;
    else if (hz < 13) bands.alpha += power;
    else if (hz < 30) bands.beta += power;
    else bands.gamma += power;
  }

  return { peakHz: Math.round(peakHz * 10) / 10, peakPower, bands };
}

export function summarizeRun(run) {
  const rateHz = meanFiringRateHz(run);
  const cvIsi = meanCvIsi(run);
  const fano = populationFano(run);
  const synchrony = synchronyIndex(run);
  const spectrum = populationSpectrum(run);
  return {
    rateHz: Math.round(rateHz * 100) / 100,
    cvIsi: Math.round(cvIsi * 1000) / 1000,
    fano: Math.round(fano * 1000) / 1000,
    synchrony: Math.round(synchrony * 100000) / 100000,
    peakHz: spectrum.peakHz,
    bands: spectrum.bands,
    neurons: run.spikeCounts.length,
    synapses: run.synapseCount,
    seconds: Math.round(((run.steps * run.config.dtMs) / 1000) * 1000) / 1000,
  };
}

/**
 * Coarse regime label following Brunel's classification. Irregularity is read
 * from CV of ISI, synchrony from the population-rate variance.
 */
export function classifyRegime(summary, { irregularCv = 0.5, synchronous = 0.02 } = {}) {
  if (summary.rateHz < 0.5) return 'silent';
  const irregular = summary.cvIsi >= irregularCv;
  const synced = summary.synchrony >= synchronous;
  if (irregular && !synced) return 'AI'; // asynchronous irregular — cortex-like
  if (irregular && synced) return 'SI'; // synchronous irregular
  if (!irregular && synced) return 'SR'; // synchronous regular
  return 'AR'; // asynchronous regular
}
