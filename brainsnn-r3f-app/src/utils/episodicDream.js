/**
 * Layer 101 — Dream-Mode coupling
 *
 * While Dream Mode (Layer 26) is replaying snapshots and STDP-blending
 * region weights, this module quietly runs a consolidation pass over
 * the Episodic Cortex (Layer 101) every few cycles and reinforces
 * connection weights between the regions whose captures co-cluster.
 *
 * Result: the brain "rehearses" its episodic vault while idle —
 * connections the synthesis engine surfaces become stronger STDP
 * edges automatically, without the user clicking anything.
 *
 * This is the structural difference from a vanilla Obsidian vault:
 * the connection graph is not just searchable — it is the physics
 * of the cortex itself. Strong cross-cluster captures = strong
 * inter-region weights = brighter pulses through the connectome.
 */

import { subscribeDream } from './dreamMode';
import { getCaptures, markConsolidated } from './episodicMemory';
import { consolidationPass } from './episodicSynthesis';
import { LINKS } from '../data/network';

const REGION_KEYS = ['CTX', 'HPC', 'THL', 'AMY', 'BG', 'PFC', 'CBL'];
const STDP_NUDGE = 0.045;       // weight bump per consolidation pair
const CYCLE_INTERVAL = 4;       // run pass every N replay cycles
const MAX_PAIRS_PER_PASS = 3;

let lastCycleSeen = -1;
let unsubscribe = null;

/**
 * Mount the dream-coupling subscriber. Call once at app startup.
 *
 * setState: same updater the React tree uses to mutate brain state.
 *
 * Returns an unsubscribe handle.
 */
export function mountEpisodicDream(setState) {
  if (unsubscribe) return unsubscribe;

  unsubscribe = subscribeDream((dreamSnap) => {
    try {
      if (!dreamSnap || dreamSnap.phase !== 'dreaming') return;
      if (dreamSnap.cycleCount === lastCycleSeen) return;
      lastCycleSeen = dreamSnap.cycleCount;

      if (dreamSnap.cycleCount === 0 || dreamSnap.cycleCount % CYCLE_INTERVAL !== 0) return;

      const recent = getCaptures({ since: Date.now() - 30 * 24 * 60 * 60 * 1000 });
      if (recent.length < 2) return;

      const pairs = consolidationPass(recent, { topK: MAX_PAIRS_PER_PASS, threshold: 0.45 });
      if (!pairs.length) return;

      if (typeof setState === 'function') {
        setState((prev) => {
          try { return applyEpisodicSTDP(prev, pairs); }
          catch { return prev; }
        });
      }

      for (const p of pairs) {
        for (const id of (p.memberIds || [])) {
          try { markConsolidated(id); } catch { /* ignore */ }
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[episodicDream] consolidation cycle failed:', err?.message || err);
    }
  });

  return unsubscribe;
}

export function unmountEpisodicDream() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  lastCycleSeen = -1;
}

// ---------- pure helpers ----------

/**
 * Reinforce STDP weights between regions implied by the supplied
 * episodic-consolidation pairs.
 *
 * For each pair we pick the dominant region the cluster activates
 * (consolidationPass already exposes regionKey) and nudge every
 * connectome edge that touches it upward by STDP_NUDGE × clusterSize.
 *
 * Pure function — returns a new state object.
 */
export function applyEpisodicSTDP(state, pairs) {
  if (!state?.weights || !pairs?.length) return state;
  const weights = { ...state.weights };
  const regions = { ...state.regions };

  for (const pair of pairs) {
    const r = pair.regionKey;
    if (!REGION_KEYS.includes(r)) continue;
    const sz = (pair.memberIds || []).length || 2;
    const nudge = STDP_NUDGE * Math.log2(1 + sz);

    for (const [a, b] of LINKS) {
      if (a !== r && b !== r) continue;
      const k = `${a}→${b}`;
      if (weights[k] != null) {
        weights[k] = clamp(weights[k] + nudge, 0.08, 0.95);
      }
    }
    // Episodic rehearsal also brightens the dominant region a touch.
    if (regions[r] != null) regions[r] = clamp(regions[r] + nudge * 0.5, 0.02, 0.95);
  }

  return {
    ...state,
    weights,
    regions,
    scenario: state.scenario?.startsWith('Dream ·') ? state.scenario : `${state.scenario || 'Dream'} · episodic rehearsal`
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
