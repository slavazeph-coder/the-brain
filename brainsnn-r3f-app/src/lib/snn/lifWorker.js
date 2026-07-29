// Web Worker host for the LIF network.
//
// A 2000-neuron run over 500 ms of biological time takes ~800 ms of wall clock.
// Running that on the main thread would drop frames across the whole arcade, so
// the simulation lives here and posts back only what the UI draws.
import { simulateLif } from './lifNetwork.js';
import { summarizeRun, classifyRegime, populationSpectrum } from './snnMetrics.js';

self.onmessage = (event) => {
  const { id, config, seed, rasterNeurons } = event.data || {};
  try {
    const run = simulateLif({ config, seed, rasterNeurons });
    const summary = summarizeRun(run);
    const spectrum = populationSpectrum(run);

    // Bin the population rate down to something drawable.
    const binMs = 2;
    const perBin = Math.max(1, Math.round(binMs / run.config.dtMs));
    const bins = Math.floor(run.populationRate.length / perBin);
    const rateTrace = new Float32Array(bins);
    for (let b = 0; b < bins; b += 1) {
      let sum = 0;
      for (let k = 0; k < perBin; k += 1) sum += run.populationRate[b * perBin + k];
      // spikes per neuron per second
      rateTrace[b] = (sum / run.spikeCounts.length) * (1000 / binMs);
    }

    self.postMessage({
      id,
      ok: true,
      summary,
      regime: classifyRegime(summary),
      spectrum: { peakHz: spectrum.peakHz, bands: spectrum.bands },
      raster: run.raster,
      rasterCount: run.rasterCount,
      rateTrace,
      durationMs: run.config.durationMs,
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
