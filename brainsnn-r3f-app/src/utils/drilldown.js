/**
 * Layer 75 — Region Drill-Down
 *
 * Deep-focus mode for a single region: camera punches in closer than
 * the default FocusController target, BrainFragments temporarily
 * densifies and brightens that region, and a callout card displays
 * per-region stats.
 *
 * State lives in a tiny module-level store (not React context) so the
 * 3D scene components can read it synchronously each frame without
 * re-rendering the whole tree.
 */

const LISTENERS = new Set();
let _state = { active: false, region: null };

export function getDrillDown() {
  return _state;
}

export function setDrillDown(next) {
  _state = { ..._state, ...next };
  for (const cb of LISTENERS) {
    try { cb(_state); } catch { /* noop */ }
  }
}

export function subscribeDrillDown(cb) {
  LISTENERS.add(cb);
  return () => LISTENERS.delete(cb);
}

export function toggleRegion(region) {
  if (!region) { setDrillDown({ active: false, region: null }); return; }
  if (_state.active && _state.region === region) {
    setDrillDown({ active: false, region: null });
  } else {
    setDrillDown({ active: true, region });
  }
}

/**
 * Per-region metadata for the callout overlay.
 */
export const REGION_DETAILS = {
  CTX: {
    label: 'Cortex',
    role: 'Multisensory integration · distributed processing',
    oscillationBias: 'alpha (idle) · gamma (binding)',
    firewallTie: 'cognitive suppression — urgency & certainty theater dampen it',
  },
  HPC: {
    label: 'Hippocampus',
    role: 'Memory encoding · replay loop with cortex',
    oscillationBias: 'theta (encoding) · sharp-wave ripples (replay)',
    firewallTie: 'cortisol spikes suppress HPC → false memory risk rises',
  },
  THL: {
    label: 'Thalamus',
    role: 'Sensory relay · broadcast hub',
    oscillationBias: 'alpha (idle gate) · delta (deep sleep)',
    firewallTie: 'emotional activation routes through THL before cortex',
  },
  AMY: {
    label: 'Amygdala',
    role: 'Fast threat weighting · emotional salience',
    oscillationBias: 'gamma on high-valence inputs',
    firewallTie: 'fear + outrage language lights AMY immediately',
  },
  BG: {
    label: 'Basal Ganglia',
    role: 'Inhibitory gating · action selection',
    oscillationBias: 'beta during motor preparation',
    firewallTie: 'manipulation pressure raises BG gating — "act now" loops',
  },
  PFC: {
    label: 'Prefrontal Cortex',
    role: 'Executive control · top-down regulation',
    oscillationBias: 'beta (engaged) · theta (cognitive control)',
    firewallTie: 'cognitive suppression directly dampens PFC — harder to think',
  },
  CBL: {
    label: 'Cerebellum',
    role: 'Timing refinement · coordination',
    oscillationBias: 'beta (motor timing)',
    firewallTie: 'stable across manipulation events — a "quiet observer"',
  },
};
