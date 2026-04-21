/**
 * Layer 71 — Neural Oscillations
 *
 * Five classical EEG bands (delta / theta / alpha / beta / gamma) with
 * their canonical frequency ranges and region-affinity weights. The
 * 3D scene modulates each region's activity with a sine wave at its
 * dominant band's frequency + amplitude × a user gain knob.
 *
 * Bands can be toggled on/off individually; with all off the modulator
 * is inert (baseline behavior). Persisted to localStorage.
 */

export const BANDS = [
  {
    id: 'delta',
    label: 'Delta',
    hzMin: 0.5, hzMax: 4,
    color: '#5591c7',
    desc: 'Deep sleep, slow-wave restoration.',
    regions: { THL: 0.4, HPC: 0.3, CTX: 0.2 },
  },
  {
    id: 'theta',
    label: 'Theta',
    hzMin: 4, hzMax: 8,
    color: '#a86fdf',
    desc: 'Memory replay, drowsy focus, hippocampal phase coding.',
    regions: { HPC: 0.6, PFC: 0.3, CTX: 0.2 },
  },
  {
    id: 'alpha',
    label: 'Alpha',
    hzMin: 8, hzMax: 13,
    color: '#fdab43',
    desc: 'Quiet wakefulness, attention gating, posterior cortex.',
    regions: { CTX: 0.5, THL: 0.3, PFC: 0.2 },
  },
  {
    id: 'beta',
    label: 'Beta',
    hzMin: 13, hzMax: 30,
    color: '#5fb7c1',
    desc: 'Active engagement, motor preparation, task binding.',
    regions: { PFC: 0.5, BG: 0.4, CBL: 0.3, CTX: 0.2 },
  },
  {
    id: 'gamma',
    label: 'Gamma',
    hzMin: 30, hzMax: 80,
    color: '#dd6974',
    desc: 'Feature binding, cross-region synchronization.',
    regions: { CTX: 0.5, AMY: 0.3, HPC: 0.3, PFC: 0.4 },
  },
];

const STORAGE_KEY = 'brainsnn_osc_v1';

function read() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { return null; }
}
function write(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* noop */ }
}

export function defaultState() {
  return {
    active: { delta: false, theta: false, alpha: true, beta: false, gamma: false },
    gain: 0.15,
  };
}

export function getOscillationState() {
  const stored = read();
  if (!stored) return defaultState();
  return { ...defaultState(), ...stored };
}

export function setOscillationState(next) {
  write(next);
}

/**
 * Sample the modulation at time t (seconds). Returns a per-region
 * additive offset that BrainScene / BrainFragments can mix in.
 */
export function sampleModulation(state, t) {
  const offsets = { CTX: 0, HPC: 0, THL: 0, AMY: 0, BG: 0, PFC: 0, CBL: 0 };
  for (const band of BANDS) {
    if (!state.active[band.id]) continue;
    const hz = (band.hzMin + band.hzMax) / 2;
    const wave = Math.sin(t * hz * 2 * Math.PI);
    for (const [region, w] of Object.entries(band.regions)) {
      offsets[region] = (offsets[region] || 0) + wave * w * state.gain;
    }
  }
  return offsets;
}
