/**
 * Layer 86 — Privacy Budget
 *
 * Surface every BrainSNN-owned localStorage key, its byte size, and
 * which layer wrote it. Gives the user a single glance at "what does
 * BrainSNN know about me?" + per-key wipe controls.
 */

const KEY_LABELS = {
  'brainsnn_handle_v1':          { label: 'Handle',               layer: 'identity' },
  'brainsnn_immunity_v1':        { label: 'Immunity score + events', layer: 23 },
  'brainsnn_snapshots_v1':       { label: 'Brain snapshots',      layer: 6 },
  'brainsnn_onboarded':          { label: 'Onboarding flag',      layer: 12 },
  'brainsnn_custom_rules_v1':    { label: 'Custom firewall rules', layer: 55 },
  'brainsnn_installed_packs_v1': { label: 'Installed rule packs', layer: 83 },
  'brainsnn_osc_v1':             { label: 'Oscillation settings', layer: 71 },
  'brainsnn_context_v1':         { label: 'Context memory (per-entity log)', layer: 63 },
  'brainsnn_receipts_v1':        { label: 'Receipt log',          layer: 46 },
  'brainsnn_archive_v1':         { label: 'Starred scan archive', layer: 84 },
  'brainsnn_daily_streak_v1':    { label: 'Daily challenge streak', layer: 38 },
  'brainsnn_replay_recording_v1':{ label: 'Replay recording',     layer: 65 },
  'brainsnn_macros_v1':          { label: 'Firewall macros',      layer: 60 },
  'brainsnn_last_room_v1':       { label: 'Last session room',    layer: 77 },
  'brainsnn_bypass_submitted_v1':{ label: 'Bypass-submit badge flag', layer: 56 },
  'brainsnn_polyglot_seen_v1':   { label: 'Polyglot badge flag',  layer: 56 },
};

const DYNAMIC_PREFIXES = [
  { prefix: 'brainsnn_daily_done_', label: 'Daily-challenge completions', layer: 38 },
];

function bytesOf(str) {
  if (typeof str !== 'string') return 0;
  try { return new TextEncoder().encode(str).length; } catch { return str.length; }
}

function describeKey(key) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  for (const { prefix, label, layer } of DYNAMIC_PREFIXES) {
    if (key.startsWith(prefix)) return { label: `${label} (${key.slice(prefix.length)})`, layer };
  }
  return { label: key, layer: '?' };
}

export function snapshotBudget() {
  const entries = [];
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('brainsnn_')) continue;
      const value = localStorage.getItem(key) || '';
      const bytes = bytesOf(value);
      totalBytes += bytes;
      const meta = describeKey(key);
      entries.push({
        key,
        label: meta.label,
        layer: meta.layer,
        bytes,
        preview: value.slice(0, 80),
      });
    }
  } catch { /* storage unavailable */ }
  entries.sort((a, b) => b.bytes - a.bytes);
  return {
    entries,
    totalBytes,
    keyCount: entries.length,
    readableTotal: humanBytes(totalBytes),
  };
}

export function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function removeKey(key) {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

export function approximateQuota() {
  // localStorage is typically 5-10MB per origin. We report what we're
  // using as a fraction of 5MB — conservative lower bound.
  return 5 * 1024 * 1024;
}
