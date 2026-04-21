/**
 * Layer 57 — Data Portability
 *
 * Export every BrainSNN-owned localStorage key into a single JSON
 * bundle the user can download, back up, or paste on another device.
 * Import validates the version tag and replays the keys.
 *
 * Every write stays user-intentional — import prompts before
 * overwriting existing keys.
 */

const BRAINSNN_PREFIX = 'brainsnn_';
const BUNDLE_VERSION = 'brainsnn-bundle-v1';

function listKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(BRAINSNN_PREFIX)) out.push(k);
    }
  } catch { /* storage unavailable */ }
  return out.sort();
}

export function exportBundle() {
  const keys = listKeys();
  const data = {};
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      // Keep each value as raw string — JSON.parse tolerates scalar
      // JSON-in-JSON when the caller re-parses.
      data[k] = raw;
    } catch { /* skip */ }
  }
  return JSON.stringify({
    brainsnn: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    keys: data,
  }, null, 2);
}

export function bundleStats(json) {
  try {
    const parsed = JSON.parse(json);
    if (parsed.brainsnn !== BUNDLE_VERSION) return null;
    const count = Object.keys(parsed.keys || {}).length;
    const bytes = json.length;
    return { count, bytes, exportedAt: parsed.exportedAt || '' };
  } catch { return null; }
}

/**
 * Replay keys into localStorage. Returns { replaced, added, skipped }.
 */
export function importBundle(json, { overwrite = false } = {}) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('invalid JSON'); }
  if (parsed.brainsnn !== BUNDLE_VERSION) {
    throw new Error(`unsupported bundle version: ${parsed.brainsnn}`);
  }
  if (!parsed.keys || typeof parsed.keys !== 'object') {
    throw new Error('bundle has no keys');
  }
  let replaced = 0, added = 0, skipped = 0;
  for (const [k, v] of Object.entries(parsed.keys)) {
    if (!k.startsWith(BRAINSNN_PREFIX)) { skipped++; continue; }
    try {
      const existing = localStorage.getItem(k);
      if (existing != null && !overwrite) { skipped++; continue; }
      localStorage.setItem(k, String(v));
      if (existing != null) replaced++;
      else added++;
    } catch {
      skipped++;
    }
  }
  return { replaced, added, skipped, total: replaced + added + skipped };
}

/**
 * Wipe every BrainSNN-owned key. Useful for clean-start demos or
 * privacy-minded users.
 */
export function wipeBundle() {
  const keys = listKeys();
  let removed = 0;
  for (const k of keys) {
    try { localStorage.removeItem(k); removed++; } catch { /* noop */ }
  }
  return removed;
}

export function countKeys() {
  return listKeys().length;
}

/**
 * Trigger a file download — convenience for the panel button.
 */
export function downloadBundle(filename = `brainsnn-bundle-${Date.now()}.json`) {
  const json = exportBundle();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return json;
}
