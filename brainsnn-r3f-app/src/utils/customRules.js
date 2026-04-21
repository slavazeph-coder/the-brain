/**
 * Layer 55 — Custom Rules Editor
 *
 * User-defined regex rules that layer on top of (or replace) the
 * DEFAULT_RULES for the Cognitive Firewall. Stored in localStorage,
 * shareable as a compact JSON export.
 *
 * Each rule:
 *   { id, category: 'urgency'|'outrage'|'certainty'|'fear', pattern, flags?, label? }
 *
 * At scan time we promote the merged set (defaults ∪ custom) into
 * _activeRules via setActiveRules(). Invalid regex sources are silently
 * dropped — evolution and user input alike can produce broken patterns.
 */

import {
  DEFAULT_RULES,
  deserializeRules,
  serializeRules,
  setActiveRules,
  resetActiveRules,
} from './cognitiveFirewall';

const STORAGE_KEY = 'brainsnn_custom_rules_v1';

export const CATEGORIES = ['urgency', 'outrage', 'certainty', 'fear'];

function safeRegex(source, flags = 'gi') {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeStore(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

/**
 * Public API.
 */
export function getCustomRules() {
  return readStore();
}

export function addCustomRule({ category, pattern, flags = 'gi', label = '' }) {
  if (!CATEGORIES.includes(category)) throw new Error(`unknown category ${category}`);
  if (!safeRegex(pattern, flags)) throw new Error('invalid regex pattern');
  const entry = {
    id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    category,
    pattern,
    flags,
    label: label.slice(0, 48),
    ts: Date.now(),
  };
  const list = [...readStore(), entry].slice(-80);
  writeStore(list);
  applyMergedRules();
  return entry;
}

export function removeCustomRule(id) {
  const list = readStore().filter((r) => r.id !== id);
  writeStore(list);
  applyMergedRules();
  return list;
}

export function clearCustomRules() {
  writeStore([]);
  resetActiveRules();
}

/**
 * Build the merged ruleset (DEFAULT_RULES ∪ custom) and promote it
 * to _activeRules. Safe to call after every mutation.
 */
export function applyMergedRules() {
  const list = readStore();
  if (!list.length) {
    resetActiveRules();
    return;
  }
  const serialized = serializeRules(DEFAULT_RULES);
  for (const cat of CATEGORIES) if (!serialized[cat]) serialized[cat] = [];
  for (const r of list) {
    if (!CATEGORIES.includes(r.category)) continue;
    serialized[r.category].push({ source: r.pattern, flags: r.flags || 'gi' });
  }
  const merged = deserializeRules(serialized);
  setActiveRules(merged);
}

/**
 * Share / import format: a compact JSON object with just the user
 * rules (defaults never travel in the export).
 */
export function exportCustomRules() {
  return JSON.stringify({
    brainsnn: 'custom-rules-v1',
    rules: readStore().map((r) => ({
      category: r.category,
      pattern: r.pattern,
      flags: r.flags,
      label: r.label,
    })),
  }, null, 2);
}

export function importCustomRules(json) {
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('invalid JSON'); }
  if (data.brainsnn !== 'custom-rules-v1' || !Array.isArray(data.rules)) {
    throw new Error('not a BrainSNN custom-rules export');
  }
  const cleaned = [];
  for (const r of data.rules.slice(0, 80)) {
    if (!CATEGORIES.includes(r.category)) continue;
    if (!safeRegex(r.pattern, r.flags || 'gi')) continue;
    cleaned.push({
      id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      category: r.category,
      pattern: String(r.pattern).slice(0, 400),
      flags: String(r.flags || 'gi').slice(0, 6),
      label: String(r.label || '').slice(0, 48),
      ts: Date.now(),
    });
  }
  writeStore(cleaned);
  applyMergedRules();
  return cleaned;
}

// Auto-apply on module load so custom rules are active from page start.
try {
  if (typeof window !== 'undefined') applyMergedRules();
} catch { /* noop */ }
