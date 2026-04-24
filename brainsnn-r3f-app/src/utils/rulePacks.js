/**
 * Layer 83 — Rule Pack Library
 *
 * Curated named regex bundles you can install or uninstall as whole
 * sets. Each pack is a list of {category, pattern, flags, label}
 * entries matching the Layer 55 custom-rule shape — so installing a
 * pack is just a mass import into brainsnn_custom_rules_v1.
 *
 * Packs are stored in their own localStorage key so we know which ones
 * are active (for UI + uninstall).
 */

import { CATEGORIES, getCustomRules, applyMergedRules } from './customRules';

const STORAGE_KEY = 'brainsnn_installed_packs_v1';
const CUSTOM_RULES_KEY = 'brainsnn_custom_rules_v1';

export const RULE_PACKS = [
  {
    id: 'workplace-gaslighting',
    label: 'Workplace gaslighting',
    desc: 'Manager / peer phrases that deny reality or rewrite recent events.',
    rules: [
      { category: 'outrage', pattern: "that's not what I said|never said anything like that", label: 'denial framing' },
      { category: 'outrage', pattern: "you're being (?:too )?(?:sensitive|dramatic|emotional)", label: 'sensitivity dismissal' },
      { category: 'certainty', pattern: 'that\'s just how (?:the )?business works', label: 'business-realism shield' },
      { category: 'urgency', pattern: 'the team is counting on you', label: 'collective-guilt urgency' },
    ],
  },
  {
    id: 'dating-scams',
    label: 'Dating app scams',
    desc: 'Classic love-bomb + pivot patterns from romance-scam corpora.',
    rules: [
      { category: 'outrage', pattern: "I've never felt (?:like )?this before|you are my everything", label: 'early-stage love-bomb' },
      { category: 'urgency', pattern: "deploy(?:ed|ment)|offshore|oil rig|crypto wallet|emergency funds", label: 'classic scam pretexts' },
      { category: 'fear', pattern: "hospital bill|customs fee|stuck (?:at|in)", label: 'cash-ask pretext' },
    ],
  },
  {
    id: 'crypto-rug',
    label: 'Crypto rug-pull / pump',
    desc: 'Token-hype vocabulary + scarcity + unverifiable proof.',
    rules: [
      { category: 'urgency', pattern: "buy (?:before|now)|don\'?t fade|mcap explode|presale closing", label: 'pump urgency' },
      { category: 'certainty', pattern: "100x (?:confirmed|guaranteed)|audited by|revoked ownership", label: 'fake certainty' },
      { category: 'outrage', pattern: "paper hands|ngmi|have fun staying poor", label: 'tribal dismissal' },
    ],
  },
  {
    id: 'news-bias',
    label: 'News media bias',
    desc: 'Editorial framing words that sneak into headlines.',
    rules: [
      { category: 'certainty', pattern: "reportedly|sources say|widely believed|experts warn", label: 'vague sourcing' },
      { category: 'outrage', pattern: "slammed|ripped|blasted|destroyed", label: 'conflict verbs' },
      { category: 'urgency', pattern: "bombshell|explosive|jaw-dropping|must-see", label: 'headline-stacker' },
    ],
  },
  {
    id: 'political-persuasion',
    label: 'Political persuasion drift',
    desc: 'Purity tests, we-vs-them framing, moral outrage bait.',
    rules: [
      { category: 'outrage', pattern: "real (?:patriots|leftists|conservatives|Americans)", label: 'purity frame' },
      { category: 'certainty', pattern: "wake up|they don\'?t want you to|hidden truth", label: 'hidden-truth framing' },
      { category: 'fear', pattern: "existential threat|last chance|end of (?:the )?(?:country|democracy)", label: 'existential stakes' },
    ],
  },
  {
    id: 'hustle-culture',
    label: 'Hustle / guru culture',
    desc: 'Alpha/beta, grindset, "everyone else is losing" tropes.',
    rules: [
      { category: 'certainty', pattern: "9-5 is (?:a )?scam|sheep|NPC|cope", label: 'tribal certainty' },
      { category: 'urgency', pattern: "sleep when you\'?re dead|wake up at 4am|no days off", label: 'grindset urgency' },
      { category: 'fear', pattern: "being (?:left|falling) behind|everyone else is", label: 'fomo framing' },
    ],
  },
  {
    id: 'recruitment',
    label: 'High-control recruiting',
    desc: 'Love-bomb → separation → purity. Cult / MLM patterns.',
    rules: [
      { category: 'outrage', pattern: "(?:real|true) family|chosen ones|inner circle", label: 'insider language' },
      { category: 'certainty', pattern: "(?:the|our) way is the only way|trust the process", label: 'sole-path framing' },
      { category: 'fear', pattern: "they (?:will )?pull you back|outside world|dark place", label: 'separation framing' },
    ],
  },
];

function readInstalled() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function writeInstalled(ids) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* quota */ }
}

export function listInstalledPacks() { return readInstalled(); }

export function getPack(id) { return RULE_PACKS.find((p) => p.id === id) || null; }

export function isInstalled(id) { return readInstalled().includes(id); }

function readCustomRules() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_RULES_KEY) || '[]'); } catch { return []; }
}
function writeCustomRules(list) {
  try { localStorage.setItem(CUSTOM_RULES_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

function tagFor(packId) { return `pack:${packId}`; }

export function installPack(id) {
  const pack = getPack(id);
  if (!pack) throw new Error(`unknown pack: ${id}`);
  const existing = readCustomRules();
  // If already installed, no-op
  if (existing.some((r) => r.tag === tagFor(id))) return { installed: 0 };

  const added = [];
  for (const r of pack.rules) {
    if (!CATEGORIES.includes(r.category)) continue;
    added.push({
      id: `pack_${id}_${added.length}_${Date.now()}`,
      category: r.category,
      pattern: r.pattern,
      flags: r.flags || 'gi',
      label: r.label || pack.label,
      tag: tagFor(id),
      ts: Date.now(),
    });
  }
  writeCustomRules([...existing, ...added]);
  const installed = readInstalled();
  if (!installed.includes(id)) writeInstalled([...installed, id]);
  applyMergedRules();
  return { installed: added.length };
}

export function uninstallPack(id) {
  const existing = readCustomRules();
  const remaining = existing.filter((r) => r.tag !== tagFor(id));
  writeCustomRules(remaining);
  const installed = readInstalled().filter((x) => x !== id);
  writeInstalled(installed);
  applyMergedRules();
  return { removed: existing.length - remaining.length };
}

export function ruleCountForPack(id) {
  const pack = getPack(id);
  return pack ? pack.rules.length : 0;
}
