/**
 * Layer 31 — Brain Evolve : Persistence
 *
 * Stores + retrieves evolved pools in localStorage so the user can pause,
 * close the tab, and resume. We snapshot the whole pool (nodes are JSON-safe
 * by construction — `ruleSet` is serialized regex, `results` is plain JSON).
 *
 * Keys:
 *   brainsnn_evolve_v1      — { pool: Node[], samplerKey, timestamp, best }
 */

const KEY = 'brainsnn_evolve_v1';

export function saveEvolvePool({ pool, samplerKey, best }) {
  if (typeof localStorage === 'undefined') return false;
  try {
    const snapshot = {
      pool,
      samplerKey,
      bestId: best?.id,
      timestamp: Date.now()
    };
    localStorage.setItem(KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function loadEvolvePool() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.pool?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearEvolvePool() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
