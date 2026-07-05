// Pure mapping layer: scan results / soliton presets -> animation parameters.
// Three-free and DOM-free so it runs in bare-Node unit tests.
import { BRAIN_REGIONS } from './brainRegions.js';

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function fromScore(value, fallback = 0.4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp01(number / 100);
}

// tribeProjection.regions {CTX,HPC,THL,AMY,BG,PFC,CBL} 0-100 -> activities 0-1.
// Falls back to a metrics-derived estimate when the projection is missing.
export function mapResultToActivities(result = {}) {
  // Explicit null bypasses the default parameter.
  const safeResult = result || {};
  const regions = safeResult.tribeProjection?.regions;
  if (regions && typeof regions === 'object') {
    const activities = {};
    for (const region of BRAIN_REGIONS) {
      activities[region.code] = fromScore(regions[region.code], region.baseActivity);
    }
    return activities;
  }
  const metrics = safeResult.metrics || {};
  const urgency = fromScore(metrics.urgency);
  const fear = fromScore(metrics.fear);
  const trust = fromScore(metrics.trust);
  const excitement = fromScore(metrics.excitement);
  const empathy = fromScore(metrics.empathy);
  return {
    THL: clamp01(0.3 + excitement * 0.5),
    CTX: clamp01(0.25 + trust * 0.45),
    HPC: clamp01(0.2 + empathy * 0.4),
    PFC: clamp01(0.65 - urgency * 0.4 - fear * 0.2),
    AMY: clamp01(0.1 + fear * 0.5 + urgency * 0.35),
    BG: clamp01(0.15 + urgency * 0.55),
    CBL: clamp01(0.2 + excitement * 0.25),
  };
}

// SOLITON_PRESETS drivers {pressure,suppression,emotional,trustErosion,valence,arousal}
// (all 0-1) -> region activities for the landing demo.
export function mapPresetToActivities(drivers = {}) {
  const pressure = clamp01(drivers.pressure);
  const suppression = clamp01(drivers.suppression);
  const emotional = clamp01(drivers.emotional);
  const trustErosion = clamp01(drivers.trustErosion);
  const valence = clamp01(drivers.valence ?? 0.5);
  const arousal = clamp01(drivers.arousal ?? 0.5);
  return {
    THL: clamp01(0.3 + arousal * 0.55),
    CTX: clamp01(0.25 + valence * 0.45),
    HPC: clamp01(0.2 + emotional * 0.35),
    PFC: clamp01(0.7 - suppression * 0.5 - pressure * 0.2),
    AMY: clamp01(0.1 + pressure * 0.55 + emotional * 0.25),
    BG: clamp01(0.12 + pressure * 0.5 + trustErosion * 0.25),
    CBL: clamp01(0.18 + arousal * 0.3),
  };
}

// Synchrony state -> scene palette. Bound = healthy cyan/green, desynchronized
// = alarm red/purple, partial/unknown = neutral house colors.
export function synchronyPalette(synchrony) {
  if (synchrony === 'bound') {
    return { edge: '#00f5ff', particle: '#5eead4', glow: '#22c55e', label: 'bound' };
  }
  if (synchrony === 'desynchronized') {
    return { edge: '#fb7185', particle: '#f97316', glow: '#a855f7', label: 'desynchronized' };
  }
  return { edge: '#38bdf8', particle: '#f8fafc', glow: '#6366f1', label: synchrony === 'partial' ? 'partial' : 'neutral' };
}

// Soliton field + metrics -> particle motion parameters.
export function particleParams(solitonField = {}, metrics = {}) {
  const frequencies = Array.isArray(solitonField.frequencyTraceHz) ? solitonField.frequencyTraceHz : [];
  const meanHz = frequencies.length
    ? frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length
    : Number(solitonField.effectiveFrequencyHz) || 39;
  const coherence = clamp01(solitonField.gammaCoherence ?? 0.6);
  const firing = fromScore(metrics.firingRate, 0.6);
  return {
    // 39 Hz maps to ~1x speed; clamped so extreme content stays watchable.
    speed: Math.max(0.4, Math.min(2.2, (meanHz / 39) * (0.7 + firing * 0.6))),
    // Low coherence scatters more, dimmer particles; high coherence tightens.
    count: coherence >= 0.75 ? 2 : 3,
    opacity: 0.5 + coherence * 0.4,
    pulseRate: 0.6 + firing * 1.2,
  };
}

// Collision events -> normalized, sorted loop schedule for the spark effect.
export function collisionSchedule(solitonField = {}) {
  const collisions = Array.isArray(solitonField.collisions) ? solitonField.collisions : [];
  const times = Array.isArray(solitonField.sampleTimesMs) ? solitonField.sampleTimesMs : [];
  const loopMs = times.length ? times[times.length - 1] : 600;
  return collisions
    .map((collision) => ({
      atMs: Math.max(0, Math.min(loopMs, Number(collision.tMs) || 0)),
      intensity: clamp01(Math.abs(Number(collision.phaseShift) || 0.4)),
    }))
    .sort((a, b) => a.atMs - b.atMs)
    .map((entry) => ({ ...entry, loopMs }));
}
