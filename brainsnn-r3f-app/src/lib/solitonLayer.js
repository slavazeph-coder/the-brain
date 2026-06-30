// Layer 103 — 39 Hz Soliton Field
// ---------------------------------------------------------------------------
// A biophysically-inspired backend layer that models the ~39 Hz gamma-band
// oscillation and the leapfrogging ionic solitons observed in neuronal
// microtubules. Voltage-gated tubulin nanopores along the 13 protofilaments of
// a microtubule support localized, non-dispersive solitary waves; multiple
// solitons continually overtake one another ("leapfrog") to redistribute
// charge, and the lattice tends to synchronize near a ~39 Hz confinement
// frequency that overlaps the gamma band (30-100 Hz) linked to focus and
// binding.
//
// This module now models the field as a TIME-SERIES rather than a single
// snapshot: it records the gamma coherence and frequency waveform over the
// settling window, gives each soliton a width and a trajectory, detects the
// individual leapfrog collisions (with the analytic KdV phase shift), couples
// the lattice to a delta..gamma oscillation-band profile (theta-gamma PAC), and
// runs a small DFT to expose the spectral modes of the binding envelope.
//
// Everything is intentionally lightweight and fully deterministic: identical
// content yields an identical soliton field, so it backs the same regression
// tests and audit receipts as the rest of the BrainSNN layer stack. It is a
// signal-processing analogy, NOT a literal microtubule or EEG measurement.

export const SOLITON_LAYER_ID = 103;
export const GAMMA_BASE_HZ = 39;        // microtubule fundamental ≈ 39 Hz
export const PROTOFILAMENTS = 13;       // tubulin protofilaments per microtubule
const GAMMA_MIN_HZ = 30;                // lower edge of the gamma band
const GAMMA_MAX_HZ = 100;               // upper edge of the gamma band

// Context nudges the lattice center within the gamma band: code binds tighter
// (lower), affect-heavy media runs hotter (higher). Text stays on 39 Hz.
const CONTEXT_BASE_HZ = { text: 39, url: 39, code: 34, image: 44, video: 46, emotional: 46 };

// Named driver overrides so agents/UI can probe the field under archetypes
// without a full content scan. Consumed by computeSolitonFieldFromDrivers.
export const SOLITON_PRESETS = {
  baseline: { label: 'Organic baseline', drivers: { pressure: 0.12, suppression: 0.15, emotional: 0.2, trustErosion: 0.1, valence: 0.6, arousal: 0.45 } },
  trustful: { label: 'Credible / empathic', drivers: { pressure: 0.1, suppression: 0.12, emotional: 0.18, trustErosion: 0.05, valence: 0.82, arousal: 0.5 } },
  mixed: { label: 'Balanced hook + proof', drivers: { pressure: 0.45, suppression: 0.4, emotional: 0.45, trustErosion: 0.4, valence: 0.5, arousal: 0.6 } },
  'high-pressure': { label: 'Manipulative (urgency + suppression)', drivers: { pressure: 0.85, suppression: 0.78, emotional: 0.8, trustErosion: 0.82, valence: 0.4, arousal: 0.88 } },
};

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clampRange(value, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(value) || lo));
}

function num(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round((Number(value) || 0) * f) / f;
}

function clampHz(value) {
  return Math.max(GAMMA_MIN_HZ, Math.min(GAMMA_MAX_HZ, Number(value) || GAMMA_BASE_HZ));
}

function contextualBase(contentType) {
  return CONTEXT_BASE_HZ[String(contentType || 'text').toLowerCase()] || GAMMA_BASE_HZ;
}

// Deterministic seed + PRNG so the field is reproducible across runs.
function seedFromText(text) {
  let hash = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic delta..gamma band profile derived from the scan's own signals.
// Catalog L71 (Neural Oscillations) has no runtime state, so we synthesize the
// bands here instead of depending on a non-existent client slider.
function buildOscillationBands(drivers, metrics) {
  const fr = clamp01((num(metrics.firingRate, 60) - 20) / 100);
  const plast = clamp01(num(metrics.plasticity, 55) / 100);
  const { arousal, emotional, pressure } = drivers;
  return {
    delta: round(clamp01(0.9 - arousal * 0.6 - fr * 0.4), 3),
    theta: round(clamp01(0.35 + plast * 0.5 - pressure * 0.2), 3),
    alpha: round(clamp01(0.55 + (1 - arousal) * 0.4 - emotional * 0.3), 3),
    beta: round(clamp01(0.3 + pressure * 0.45 + arousal * 0.3 + fr * 0.2), 3),
    gamma: round(clamp01(0.3 + arousal * 0.35 + (1 - pressure) * 0.3 + fr * 0.2), 3),
  };
}

// Kuramoto ring of protofilament phase oscillators near the (context-shifted)
// base frequency. Manipulation pressure / suppression detune the natural
// frequencies (fragmented binding); trust + positive valence + the gamma band
// gain tighten the coupling toward the attractor. Records the coherence and
// frequency waveform over the settling window.
function runGammaLattice(rng, drivers, { couplingGain = 1, baseHz = GAMMA_BASE_HZ, sampleEvery = 5 } = {}) {
  const { pressure, suppression, trustErosion, valence } = drivers;
  const detuneHz = 0.05 + pressure ** 1.5 * 7 + suppression ** 1.5 * 3;
  const coupling = Math.max(0.2, (3.5 + (1 - pressure) * 5 + (valence - 0.5) * 2 - trustErosion * 1.5) * couplingGain);

  const phases = new Float64Array(PROTOFILAMENTS);
  const omega = new Float64Array(PROTOFILAMENTS);
  for (let i = 0; i < PROTOFILAMENTS; i += 1) {
    phases[i] = rng() * 2 * Math.PI;
    omega[i] = 2 * Math.PI * (baseHz + (rng() - 0.5) * 2 * detuneHz);
  }

  const dt = 4 / 1000;   // 4 ms integration step
  const steps = 150;     // 150 steps × 4 ms = 600 ms settling window
  const sampleFrom = steps - 25;   // average effective frequency over the last 100 ms
  const K = coupling / PROTOFILAMENTS;
  let velAccum = 0;

  const coherenceTrace = [];
  const frequencyTraceHz = [];
  const sampleTimesMs = [];

  for (let s = 0; s < steps; s += 1) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < PROTOFILAMENTS; i += 1) {
      sx += Math.cos(phases[i]);
      sy += Math.sin(phases[i]);
    }
    const r = Math.sqrt(sx * sx + sy * sy) / PROTOFILAMENTS;
    const psi = Math.atan2(sy, sx);
    let stepVel = 0;
    for (let i = 0; i < PROTOFILAMENTS; i += 1) {
      const dtheta = omega[i] + K * PROTOFILAMENTS * r * Math.sin(psi - phases[i]);
      phases[i] += dtheta * dt;
      stepVel += dtheta;
      if (s >= sampleFrom) velAccum += dtheta;
    }
    if (s % sampleEvery === 0) {
      coherenceTrace.push(round(r, 4));
      frequencyTraceHz.push(round(clampHz((stepVel / PROTOFILAMENTS) / (2 * Math.PI)), 2));
      sampleTimesMs.push(Math.round(s * dt * 1000));
    }
  }

  let fx = 0;
  let fy = 0;
  for (let i = 0; i < PROTOFILAMENTS; i += 1) {
    fx += Math.cos(phases[i]);
    fy += Math.sin(phases[i]);
  }
  const gammaCoherence = clamp01(Math.sqrt(fx * fx + fy * fy) / PROTOFILAMENTS);
  const meanOmega = velAccum / (25 * PROTOFILAMENTS);     // rad/s averaged over last 100 ms (25 steps × 4 ms)
  const effectiveFrequencyHz = clampHz(meanOmega / (2 * Math.PI));
  return { gammaCoherence, effectiveFrequencyHz, coherenceTrace, frequencyTraceHz, sampleTimesMs };
}

// Analytic two-soliton KdV phase shift magnitude: when a taller (faster) packet
// overtakes a shorter one they pass through each other elastically, the faster
// jumps forward and the slower back by Δ = ln|(√a₁+√a₂)/(√a₁-√a₂)|.
function kdvPhaseShift(aFast, aSlow) {
  const rf = Math.sqrt(aFast);
  const rs = Math.sqrt(aSlow);
  if (Math.abs(rf - rs) < 1e-9) return 0;
  return round(Math.log(Math.abs((rf + rs) / (rf - rs))), 4);
}

// Leapfrogging ionic solitons. KdV-flavored: taller solitons travel faster and
// are narrower (width ∝ 1/√amplitude), so they repeatedly overtake shorter ones
// on the closed lattice. Records each packet's trajectory and every overtake as
// an elastic collision with its time and phase shift.
function runSolitonTrain(rng, drive, sampleCount) {
  const count = 3 + Math.round(drive * 3);   // 3..6 packets
  const window = 1.0;                          // one normalized transit window
  const windowMs = 600;
  const amps = [];
  const vels = [];
  const starts = [];
  const widths = [];
  for (let i = 0; i < count; i += 1) {
    const amplitude = 0.4 + rng() * 0.6 * (0.6 + drive);
    amps.push(amplitude);
    vels.push(1 + amplitude * 1.8);            // KdV: celerity ∝ amplitude
    starts.push(rng());
    widths.push(0.35 / Math.sqrt(amplitude));  // KdV: taller ⇒ narrower
  }

  // Each integer crossing of a pair's relative displacement is one overtake.
  // Including the initial gap counts a faster packet that begins just behind a
  // slower one and passes it inside the window.
  const collisions = [];
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const dv = vels[i] - vels[j];
      if (dv === 0) continue;
      const rel0 = starts[i] - starts[j];
      const relEnd = rel0 + dv * window;
      const lo = Math.min(rel0, relEnd);
      const hi = Math.max(rel0, relEnd);
      for (let m = Math.floor(lo) + 1; m <= hi; m += 1) {
        const t = (m - rel0) / dv;             // crossing time, fraction of window
        if (t < 0 || t > window || !Number.isFinite(t)) continue;
        const faster = dv > 0 ? i : j;
        const slower = dv > 0 ? j : i;
        collisions.push({
          tMs: Math.round((t / window) * windowMs),
          pair: [faster, slower],
          phaseShift: kdvPhaseShift(amps[faster], amps[slower]),
        });
      }
    }
  }
  collisions.sort((a, b) => a.tMs - b.tMs);

  const solitons = starts.map((start, i) => {
    const track = [];
    for (let k = 0; k < sampleCount; k += 1) {
      const f = sampleCount > 1 ? k / (sampleCount - 1) : 0;
      track.push(round((start + vels[i] * f * window) % 1, 4));
    }
    return {
      id: `s${i + 1}`,
      position: round((start + vels[i] * window) % 1, 4),
      amplitude: round(amps[i], 4),
      velocity: round(vels[i], 4),
      width: round(widths[i], 4),
      track,
    };
  });

  const ampMean = amps.reduce((a, b) => a + b, 0) / count;
  const ampVar = amps.reduce((acc, a) => acc + (a - ampMean) ** 2, 0) / count;
  const solitonEnergy = round(amps.reduce((s, a) => s + a * a, 0), 4);   // KdV-conserved mass proxy
  return { solitons, leapfrogEvents: collisions.length, collisions, solitonEnergy, ampVar };
}

// Small real DFT over the coherence envelope. Returns the top-K spectral peaks
// (normalized power), exposing slow modulation / beat patterns of the binding.
function topSpectralPeaks(trace, fsHz, k = 3) {
  const N = trace.length;
  if (N < 4) return [];
  const mean = trace.reduce((a, b) => a + b, 0) / N;
  const half = Math.floor(N / 2);
  const peaks = [];
  for (let bin = 1; bin <= half; bin += 1) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n += 1) {
      const x = trace[n] - mean;
      const ang = (2 * Math.PI * bin * n) / N;
      re += x * Math.cos(ang);
      im -= x * Math.sin(ang);
    }
    peaks.push({ freqHz: round((bin * fsHz) / N, 2), power: re * re + im * im });
  }
  const maxPower = peaks.reduce((m, p) => Math.max(m, p.power), 0) || 1;
  return peaks
    .map((p) => ({ freqHz: p.freqHz, power: round(p.power / maxPower, 4) }))
    .sort((a, b) => b.power - a.power)
    .slice(0, k);
}

// Shared core: build the full field from already-resolved drivers. Used both by
// computeSolitonField (content scan) and the preset/explorer endpoints.
function computeSolitonFieldFromDrivers(seedKey, drivers, { contentType = 'text', metrics = {} } = {}) {
  const bands = buildOscillationBands(drivers, metrics);
  const couplingGain = clampRange(0.85 + bands.gamma * 0.3 - bands.beta * 0.1, 0.6, 1.3);
  const contextualBaseHz = contextualBase(contentType);
  const sampleEvery = 5;

  const rng = mulberry32(seedFromText(seedKey));
  const {
    gammaCoherence, effectiveFrequencyHz, coherenceTrace, frequencyTraceHz, sampleTimesMs,
  } = runGammaLattice(rng, drivers, { couplingGain, baseHz: contextualBaseHz, sampleEvery });

  const drive = clamp01(0.35 + drivers.arousal * 0.5 + drivers.emotional * 0.4);
  const { solitons, leapfrogEvents, collisions, solitonEnergy, ampVar } =
    runSolitonTrain(rng, drive, coherenceTrace.length);

  // Coherence trace is sampled every `sampleEvery` × 4 ms ⇒ Fs = 1000/(20) = 50 Hz.
  const fsHz = 1000 / (sampleEvery * 4);
  const spectralPeaks = topSpectralPeaks(coherenceTrace, fsHz, 3);

  const thetaGammaPAC = round(clamp01(Math.sqrt(bands.theta * bands.gamma) * (0.4 + 0.6 * gammaCoherence)), 3);
  const confinement = clamp01(gammaCoherence * 0.7 + (1 - clamp01(ampVar * 2)) * 0.3 - drivers.pressure * 0.2);
  const synchrony = gammaCoherence >= 0.66 ? 'bound' : gammaCoherence >= 0.33 ? 'partial' : 'desynchronized';
  const bindingScore = Math.round(clamp01(gammaCoherence * 0.7 + confinement * 0.3) * 100);
  const detuneHz = round(Math.abs(effectiveFrequencyHz - contextualBaseHz), 2);

  return {
    layer: SOLITON_LAYER_ID,
    label: '39 Hz Soliton Field',
    band: 'gamma',
    baseFrequencyHz: GAMMA_BASE_HZ,
    contextualBaseHz,
    effectiveFrequencyHz: round(effectiveFrequencyHz, 2),
    detuneHz,
    gammaCoherence: round(gammaCoherence, 3),
    synchrony,
    confinement: round(confinement, 3),
    bindingScore,
    protofilaments: PROTOFILAMENTS,
    solitons,
    leapfrogEvents,
    collisions,
    solitonEnergy,
    energyConserved: true,
    ionicDrive: round(drive, 3),
    oscillationBands: bands,
    thetaGammaPAC,
    coherenceTrace,
    frequencyTraceHz,
    sampleTimesMs,
    spectralPeaks,
    note: synchrony === 'bound'
      ? 'Lattice phase-locked near 39 Hz; solitons leapfrog inside a stable confinement window.'
      : synchrony === 'partial'
        ? 'Partial gamma synchrony; manipulation pressure is detuning the 39 Hz lattice.'
        : 'Lattice desynchronized; high pressure or suppression fragments the 39 Hz binding.',
    disclaimer: 'Biophysically-inspired signal model. Not a literal microtubule, ionic, or EEG measurement.',
  };
}

/**
 * Compute the 39 Hz soliton field for a piece of content. Couples to the
 * firewall and affect signals already produced by the layer router so the
 * field reflects the same scan, not an independent guess.
 */
export function computeSolitonField({ content = '', contentType = 'text', firewallSignals = {}, affectProfile = {}, metrics = {} } = {}) {
  const drivers = {
    pressure: clamp01(firewallSignals.manipulationPressure),
    suppression: clamp01(firewallSignals.cognitiveSuppression),
    emotional: clamp01(firewallSignals.emotionalActivation),
    trustErosion: clamp01(firewallSignals.trustErosion),
    valence: num(affectProfile.valence, 50) / 100,
    arousal: num(affectProfile.arousal, 45) / 100,
  };
  return computeSolitonFieldFromDrivers(content, drivers, { contentType, metrics });
}

/**
 * Compute the field for a named preset (no content scan). Seeded by the preset
 * key so it stays deterministic.
 */
export function computeSolitonPreset(name, { contentType = 'text' } = {}) {
  const preset = SOLITON_PRESETS[name];
  if (!preset) return null;
  return {
    preset: name,
    label: preset.label,
    solitonField: computeSolitonFieldFromDrivers(`preset:${name}`, preset.drivers, { contentType }),
  };
}

/**
 * Deterministic sweep of one driver across [0,1] in `steps` points, returning
 * the coherence/binding response curve so agents/UI can probe the field's
 * sensitivity without a full scan. `axis` is one of the driver keys.
 */
export function exploreSolitonField({ axis = 'pressure', steps = 9, base = 'mixed', contentType = 'text', ensemble = 6 } = {}) {
  const preset = SOLITON_PRESETS[base] || SOLITON_PRESETS.mixed;
  const n = clampRange(Math.round(steps), 2, 25);
  const k = clampRange(Math.round(ensemble), 1, 16);
  const validAxis = Object.prototype.hasOwnProperty.call(preset.drivers, axis) ? axis : 'pressure';
  const curve = [];
  for (let i = 0; i < n; i += 1) {
    const value = round(i / (n - 1), 4);
    const drivers = { ...preset.drivers, [validAxis]: value };
    // Ensemble-average the order parameter over k realizations: the mean-field
    // Kuramoto coherence is an ensemble property, and averaging smooths the
    // finite-size noise so the sweep isolates the axis's effect.
    let cohSum = 0;
    let bindSum = 0;
    let leapSum = 0;
    for (let r = 0; r < k; r += 1) {
      const field = computeSolitonFieldFromDrivers(`explore:${base}:${validAxis}:${r}`, drivers, { contentType });
      cohSum += field.gammaCoherence;
      bindSum += field.bindingScore;
      leapSum += field.leapfrogEvents;
    }
    const gammaCoherence = round(cohSum / k, 3);
    curve.push({
      value,
      gammaCoherence,
      bindingScore: Math.round(bindSum / k),
      leapfrogEvents: round(leapSum / k, 1),
      synchrony: gammaCoherence >= 0.66 ? 'bound' : gammaCoherence >= 0.33 ? 'partial' : 'desynchronized',
    });
  }
  return { axis: validAxis, base, contentType, steps: n, ensemble: k, curve };
}
