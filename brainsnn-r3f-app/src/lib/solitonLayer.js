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
// The model is intentionally lightweight and fully deterministic: identical
// content yields an identical soliton field, so it backs the same regression
// tests and audit receipts as the rest of the BrainSNN layer stack. It is a
// signal-processing analogy, NOT a literal microtubule or EEG measurement.

export const SOLITON_LAYER_ID = 103;
export const GAMMA_BASE_HZ = 39;        // microtubule fundamental ≈ 39 Hz
export const PROTOFILAMENTS = 13;       // tubulin protofilaments per microtubule
const GAMMA_MIN_HZ = 30;                // lower edge of the gamma band
const GAMMA_MAX_HZ = 100;               // upper edge of the gamma band

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
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

// Kuramoto ring of protofilament phase oscillators near 39 Hz. Manipulation
// pressure and cognitive suppression detune the natural frequencies (fragmented
// binding); trust and positive valence tighten the coupling toward the 39 Hz
// attractor. Returns { gammaCoherence, effectiveFrequencyHz }.
function runGammaLattice(rng, drivers) {
  const { pressure, suppression, trustErosion, valence } = drivers;
  // Natural-frequency spread is in Hz; ×2π makes it a large rad/s detuning, so a
  // coherent (low-pressure) lattice keeps a tight spread while pressure and
  // suppression pull the protofilaments apart. Coupling has to clear that spread
  // to phase-lock toward the 39 Hz attractor.
  // Detuning is super-linear: light pressure barely perturbs the lattice, but
  // strong pressure / suppression fragments it well past the locking threshold.
  const detuneHz = 0.05 + pressure ** 1.5 * 7 + suppression ** 1.5 * 3;
  const coupling = Math.max(0.2, 3.5 + (1 - pressure) * 5 + (valence - 0.5) * 2 - trustErosion * 1.5);

  const phases = new Float64Array(PROTOFILAMENTS);
  const omega = new Float64Array(PROTOFILAMENTS);
  for (let i = 0; i < PROTOFILAMENTS; i += 1) {
    phases[i] = rng() * 2 * Math.PI;
    omega[i] = 2 * Math.PI * (GAMMA_BASE_HZ + (rng() - 0.5) * 2 * detuneHz);
  }

  const dt = 1 / 1000;   // 1 ms integration step
  const steps = 600;     // 600 ms settling window
  const sampleFrom = steps - 100;
  const K = coupling / PROTOFILAMENTS;
  let velAccum = 0;

  for (let s = 0; s < steps; s += 1) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < PROTOFILAMENTS; i += 1) {
      sx += Math.cos(phases[i]);
      sy += Math.sin(phases[i]);
    }
    const r = Math.sqrt(sx * sx + sy * sy) / PROTOFILAMENTS;
    const psi = Math.atan2(sy, sx);
    for (let i = 0; i < PROTOFILAMENTS; i += 1) {
      const dtheta = omega[i] + K * PROTOFILAMENTS * r * Math.sin(psi - phases[i]);
      phases[i] += dtheta * dt;
      if (s >= sampleFrom) velAccum += dtheta;
    }
  }

  let fx = 0;
  let fy = 0;
  for (let i = 0; i < PROTOFILAMENTS; i += 1) {
    fx += Math.cos(phases[i]);
    fy += Math.sin(phases[i]);
  }
  const gammaCoherence = clamp01(Math.sqrt(fx * fx + fy * fy) / PROTOFILAMENTS);
  const meanOmega = velAccum / (100 * PROTOFILAMENTS);     // rad/s averaged over last 100 ms
  const effectiveFrequencyHz = clampHz(meanOmega / (2 * Math.PI));
  return { gammaCoherence, effectiveFrequencyHz };
}

// Leapfrogging ionic solitons. KdV-flavored: taller solitons travel faster, so
// they repeatedly overtake shorter ones on the closed lattice. Amplitudes scale
// with the ionic drive (arousal + emotional charge). Overtakes on a ring of
// unit circumference equal the integer part of the relative displacement, so
// the count is closed-form and deterministic.
function runSolitonTrain(rng, drive) {
  const count = 3 + Math.round(drive * 3);   // 3..6 packets
  const window = 1.0;                          // one normalized transit window
  const amps = [];
  const vels = [];
  const starts = [];
  for (let i = 0; i < count; i += 1) {
    const amplitude = 0.4 + rng() * 0.6 * (0.6 + drive);
    amps.push(amplitude);
    vels.push(1 + amplitude * 1.8);            // KdV: celerity ∝ amplitude
    starts.push(rng());
  }

  let leapfrogEvents = 0;
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      leapfrogEvents += Math.floor(Math.abs(vels[i] - vels[j]) * window);
    }
  }

  const solitons = starts.map((start, i) => ({
    id: `s${i + 1}`,
    position: round((start + vels[i] * window) % 1, 4),
    amplitude: round(amps[i], 4),
    velocity: round(vels[i], 4),
  }));

  const ampMean = amps.reduce((a, b) => a + b, 0) / count;
  const ampVar = amps.reduce((acc, a) => acc + (a - ampMean) ** 2, 0) / count;
  return { solitons, leapfrogEvents, ampVar };
}

/**
 * Compute the 39 Hz soliton field for a piece of content. Couples to the
 * firewall and affect signals already produced by the layer router so the
 * field reflects the same scan, not an independent guess.
 */
export function computeSolitonField({ content = '', firewallSignals = {}, affectProfile = {} } = {}) {
  const drivers = {
    pressure: clamp01(firewallSignals.manipulationPressure),
    suppression: clamp01(firewallSignals.cognitiveSuppression),
    emotional: clamp01(firewallSignals.emotionalActivation),
    trustErosion: clamp01(firewallSignals.trustErosion),
    valence: num(affectProfile.valence, 50) / 100,
    arousal: num(affectProfile.arousal, 45) / 100,
  };

  const rng = mulberry32(seedFromText(content));
  const { gammaCoherence, effectiveFrequencyHz } = runGammaLattice(rng, drivers);

  const drive = clamp01(0.35 + drivers.arousal * 0.5 + drivers.emotional * 0.4);
  const { solitons, leapfrogEvents, ampVar } = runSolitonTrain(rng, drive);

  const confinement = clamp01(gammaCoherence * 0.7 + (1 - clamp01(ampVar * 2)) * 0.3 - drivers.pressure * 0.2);
  const synchrony = gammaCoherence >= 0.66 ? 'bound' : gammaCoherence >= 0.33 ? 'partial' : 'desynchronized';
  const bindingScore = Math.round(clamp01(gammaCoherence * 0.7 + confinement * 0.3) * 100);
  const detuneHz = round(Math.abs(effectiveFrequencyHz - GAMMA_BASE_HZ), 2);

  return {
    layer: SOLITON_LAYER_ID,
    label: '39 Hz Soliton Field',
    band: 'gamma',
    baseFrequencyHz: GAMMA_BASE_HZ,
    effectiveFrequencyHz: round(effectiveFrequencyHz, 2),
    detuneHz,
    gammaCoherence: round(gammaCoherence, 3),
    synchrony,
    confinement: round(confinement, 3),
    bindingScore,
    protofilaments: PROTOFILAMENTS,
    solitons,
    leapfrogEvents,
    ionicDrive: round(drive, 3),
    note: synchrony === 'bound'
      ? 'Lattice phase-locked near 39 Hz; solitons leapfrog inside a stable confinement window.'
      : synchrony === 'partial'
        ? 'Partial gamma synchrony; manipulation pressure is detuning the 39 Hz lattice.'
        : 'Lattice desynchronized; high pressure or suppression fragments the 39 Hz binding.',
    disclaimer: 'Biophysically-inspired signal model. Not a literal microtubule, ionic, or EEG measurement.',
  };
}
