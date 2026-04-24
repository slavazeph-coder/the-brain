/**
 * Layer 97 — Panel Hotkeys
 *
 * Every panel that's worth jumping to gets a 2-character hotkey
 * (e.g. "fw" for Firewall, "au" for Autopsy). Press Shift+? to reveal
 * them as overlay hints on every panel; typing two keys in sequence
 * jumps to the matching panel (reuses the Command Palette flash
 * helper).
 */

import { LAYER_CATALOG } from './layerCatalog';

// Curated 2-char assignments for the highest-traffic layers. Unassigned
// layers remain reachable via the Command Palette.
const HOTKEYS = {
  fw: 4,    // Firewall
  he: 40,   // Heatmap
  au: 36,   // Autopsy
  dq: 38,   // Daily Challenge
  qz: 73,   // Text Adventure / quiz
  cd: 42,   // Counter-Draft
  cv: 47,   // Diff mode / compare
  tl: 43,   // Time-series
  ib: 44,   // Inbox
  im: 23,   // Immunity
  re: 46,   // Receipts
  bd: 56,   // Badges
  rp: 50,   // Recap
  rl: 83,   // Rule packs
  rx: 55,   // custom Rules
  sa: 84,   // Scan archive
  jo: 85,   // Journalism
  pv: 86,   // Privacy budget
  pe: 88,   // Personas
  cx: 89,   // Composer
  pd: 90,   // Personal dict
  ge: 87,   // Genre
  pw: 91,   // PWA install
  fb: 93,   // Feedback
  rt: 94,   // Role tour
  os: 71,   // Oscillations
  ex: 72,   // layer Explorer
  mc: 74,   // coMparator
  hy: 62,   // Hypothesis
  dg: 61,   // Diagnostic
  ma: 60,   // Macros
  ad: 59,   // Audio
  oc: 58,   // OCR
  de: 64,   // Debate
  cm: 63,   // Context memory
  ec: 53,   // Echo
  fp: 51,   // Fingerprint
  lb: 16,   // Live sync / leaderboard
  dm: 26,   // Dream mode
  rm: 77,   // Rooms
  mm: 29,   // afMective
  nc: 30,   // Neurochem
  be: 31,   // brain Evolve
  ae: 32,   // Attack evolve
  rt2: 25,  // red team (fallback via palette)
};

export function listHotkeys() {
  const rows = [];
  for (const [key, layerId] of Object.entries(HOTKEYS)) {
    const layer = LAYER_CATALOG.find((l) => l.id === layerId);
    if (!layer) continue;
    rows.push({ key, layer });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows;
}

export function layerForHotkey(chord) {
  const c = String(chord || '').toLowerCase();
  return HOTKEYS[c] || null;
}

export function flashLayerInDom(layerId) {
  try {
    const re = new RegExp(`\\blayer\\s*${layerId}\\b`, 'i');
    const labels = document.querySelectorAll('.eyebrow');
    for (const el of labels) {
      if (re.test(el.textContent || '')) {
        const panel = el.closest('.panel');
        if (!panel) continue;
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = panel.style.boxShadow;
        panel.style.transition = 'box-shadow 400ms ease';
        panel.style.boxShadow = '0 0 0 3px rgba(90,212,255,0.6)';
        setTimeout(() => { panel.style.boxShadow = prev; }, 1500);
        return true;
      }
    }
  } catch { /* noop */ }
  return false;
}
