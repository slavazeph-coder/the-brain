/**
 * Layer 60 — Firewall Macros
 *
 * Named preset scans. A macro is a list of sample texts plus an
 * optional expected-pressure tier. Running a macro scores every
 * sample in batch with the current active ruleset and reports the
 * aggregate + per-sample drift against expectations.
 *
 * Useful for rule-dev workflows: define "my phishing suite", tweak
 * the Firewall, re-run the macro, see whether the tweak helped or
 * regressed.
 */

import { scoreContent } from './cognitiveFirewall';

const STORAGE_KEY = 'brainsnn_macros_v1';
const MAX_MACROS = 40;
const MAX_SAMPLES = 20;

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function writeStore(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_MACROS))); } catch { /* quota */ }
}

export function listMacros() { return readStore(); }

export function saveMacro({ name, samples, expected = 'auto', notes = '' }) {
  const cleaned = {
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(name || 'Untitled macro').slice(0, 60),
    samples: (samples || []).slice(0, MAX_SAMPLES).map((s) => String(s || '').slice(0, 2000)).filter(Boolean),
    expected,
    notes: String(notes || '').slice(0, 200),
    createdAt: Date.now(),
  };
  if (cleaned.samples.length === 0) throw new Error('macro needs at least one sample');
  const list = readStore().filter((m) => m.id !== cleaned.id);
  list.push(cleaned);
  writeStore(list);
  return cleaned;
}

export function removeMacro(id) {
  const list = readStore().filter((m) => m.id !== id);
  writeStore(list);
  return list;
}

export function runMacro(macro) {
  if (!macro || !macro.samples) return null;
  const results = macro.samples.map((text, i) => {
    const s = scoreContent(text);
    const pressure =
      (s.emotionalActivation + s.cognitiveSuppression + s.manipulationPressure) / 3;
    return {
      idx: i,
      text,
      pressure,
      templates: s.templates || [],
      evidence: s.evidence || [],
    };
  });
  const mean = results.reduce((a, r) => a + r.pressure, 0) / Math.max(1, results.length);
  const peak = results.reduce((best, r) => (r.pressure > best.pressure ? r : best), results[0]);
  const expectedOk = (() => {
    if (macro.expected === 'auto') return null;
    if (macro.expected === 'high') return mean >= 0.55;
    if (macro.expected === 'low') return mean <= 0.25;
    if (macro.expected === 'mid') return mean > 0.25 && mean < 0.55;
    return null;
  })();
  return {
    id: macro.id,
    name: macro.name,
    expected: macro.expected,
    results,
    meanPressure: mean,
    peak,
    expectedOk,
  };
}

export const MACRO_SEEDS = [
  {
    name: 'Phishing suite',
    expected: 'high',
    samples: [
      'URGENT: your account has been flagged. Click now to verify or it will be disabled in one hour.',
      'WARNING — unauthorized login detected. Confirm your identity immediately to avoid permanent loss of access.',
      'Action required: your payment failed. Update your card within 24 hours or your subscription will be terminated.',
    ],
  },
  {
    name: 'Wellness benign',
    expected: 'low',
    samples: [
      'Take a slow breath. Notice the weight of your body. There is nothing you need to do this second.',
      'Consider a short walk before the next meeting — even ten minutes outside tends to reset focus.',
      'Hydration is usually the cheapest intervention. Keep water within reach while you work.',
    ],
  },
  {
    name: 'Political attack',
    expected: 'high',
    samples: [
      'They betrayed us. Shocking. Disgusting. If you\'re not furious, you\'re not paying attention.',
      'Either you\'re with us, or you\'re against us. Real patriots don\'t question the leadership.',
      'They don\'t want you to know the truth. Wake up before they silence the rest of us too.',
    ],
  },
];

export function seedDefaultMacros() {
  const existing = readStore();
  if (existing.length > 0) return existing;
  const seeded = MACRO_SEEDS.map((m) => ({
    id: `seed_${m.name.toLowerCase().replace(/\s+/g, '_')}`,
    ...m,
    notes: 'Seed preset',
    createdAt: Date.now(),
  }));
  writeStore(seeded);
  return seeded;
}
