/**
 * Layer 30 — Neurochemistry Engine
 *
 * Converts NT levels (0..1 per NT) into region deltas and applies them
 * additively to brain state. Also derives an NT signature from a Layer 29
 * affect decode result so the sandbox can "match from last decode."
 */

import {
  NEUROTRANSMITTERS,
  NT_IDS,
  NT_BASELINE,
  AFFECT_NT_SIGNATURE,
  NT_PRESETS
} from '../data/neurotransmitters';
import { clamp } from './sim';

/**
 * Compute per-region delta from an NT-level map.
 * delta = Σ over NTs of (level - baseline) × regionWeight × gain
 *
 * Returns { regionId: delta } for all regions the NTs touch.
 */
export function computeRegionDeltas(levels, gain = 0.6) {
  const deltas = {};
  for (const nt of NT_IDS) {
    const level = levels[nt] ?? NT_BASELINE;
    const dev = level - NT_BASELINE; // -0.5..+0.5
    const weights = NEUROTRANSMITTERS[nt].regionWeights;
    for (const [region, w] of Object.entries(weights)) {
      deltas[region] = (deltas[region] ?? 0) + dev * w * gain;
    }
  }
  return deltas;
}

/**
 * Apply an NT bath onto brain state. Additive nudge, clamped to [0.04, 0.95]
 * to stay within the simulation's valid range (matches cognitiveFirewall.js
 * and affectiveDecoder.js patterns).
 */
export function applyNTBath(state, levels, { gain = 0.6, label = 'NT Bath' } = {}) {
  const deltas = computeRegionDeltas(levels, gain);
  const regions = { ...state.regions };
  for (const [region, delta] of Object.entries(deltas)) {
    if (regions[region] === undefined) continue;
    regions[region] = clamp(regions[region] + delta, 0.04, 0.95);
  }
  // Burst scales with the magnitude of sympathetic drive (NE + cortisol).
  const ne = (levels.norepinephrine ?? NT_BASELINE) - NT_BASELINE;
  const cort = (levels.cortisol ?? NT_BASELINE) - NT_BASELINE;
  const burst = clamp(Math.max(state.burst ?? 0, (ne + cort) * 0.8), 0, 1);
  return {
    ...state,
    regions,
    tick: (state.tick ?? 0) + 1,
    scenario: label,
    burst
  };
}

/**
 * Derive NT levels from a Layer 29 decoded-affects result.
 *
 * Each dominant affect contributes its AFFECT_NT_SIGNATURE nudges weighted
 * by the affect's score. Result is clamped to [0, 1] and centered on the
 * baseline so "no affect" → all NTs at 0.5.
 */
export function decodedToNTLevels(decoded) {
  const levels = {};
  for (const nt of NT_IDS) levels[nt] = NT_BASELINE;
  if (!decoded || decoded.empty || !decoded.dominant?.length) return levels;

  // Weighted sum of each affect's NT signature.
  for (const affect of decoded.dominant) {
    const sig = AFFECT_NT_SIGNATURE[affect.id];
    if (!sig) continue;
    for (const [nt, nudge] of Object.entries(sig)) {
      levels[nt] += nudge * affect.score;
    }
  }
  for (const nt of NT_IDS) levels[nt] = clamp(levels[nt], 0, 1);
  return levels;
}

export function getPreset(id) {
  return NT_PRESETS.find((p) => p.id === id) ?? NT_PRESETS[0];
}

/**
 * Expand a preset's (possibly partial) levels to a full map, filling in
 * baseline for any NT it doesn't specify.
 */
export function expandPresetLevels(preset) {
  const levels = {};
  for (const nt of NT_IDS) {
    levels[nt] = preset.levels?.[nt] ?? NT_BASELINE;
  }
  return levels;
}

/**
 * Given a levels map, return a small narrative describing the state.
 * Used for the status line in the panel.
 */
export function describeLevels(levels) {
  const deviations = NT_IDS
    .map((nt) => ({
      nt,
      label: NEUROTRANSMITTERS[nt].short,
      dev: (levels[nt] ?? NT_BASELINE) - NT_BASELINE
    }))
    .filter((d) => Math.abs(d.dev) >= 0.08)
    .sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));

  if (deviations.length === 0) return 'Baseline — physiological rest';
  return deviations
    .slice(0, 3)
    .map((d) => `${d.label} ${d.dev >= 0 ? '↑' : '↓'}${(Math.abs(d.dev) * 100).toFixed(0)}`)
    .join(' · ');
}
