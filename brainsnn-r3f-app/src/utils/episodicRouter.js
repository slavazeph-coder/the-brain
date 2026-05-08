/**
 * Layer 101 — Episodic Router
 *
 * Single entry point that turns raw text into a structured episodic
 * capture. Orchestrates:
 *
 *   classifyEpisodic(text)  → category scores + dominant id  (regex)
 *   routeCapture(text)      → full capture object: classification,
 *                             firewall, affects, genre, regions,
 *                             urls, tags, mentions, title.
 *
 * The output is intentionally pre-computed so the synthesis engine
 * (Layer 101 brief / weekly synthesis) can operate over a flat array
 * of capture objects without re-running classifiers per query.
 *
 * Region contributions are merged so dropping a paragraph into the
 * Episodic Cortex panel actually drives the 3D brain — the same way
 * Layer 4 / Layer 29 do — instead of just filing into a folder.
 */

import {
  EPISODIC_CATEGORIES,
  EPISODIC_IDS,
  DEFAULT_REGIONS
} from '../data/episodicTaxonomy';
import { scoreContent } from './cognitiveFirewall';
import { decodeAffects } from './affectiveDecoder';
import { classifyGenre } from './genreClassifier';
import { detectPII } from './episodicPII';

const URL_RE = /\bhttps?:\/\/[^\s)<>\]]+/gi;
const HASHTAG_RE = /(?:^|\s)#([A-Za-z][\w-]{1,32})\b/g;
const MENTION_RE = /(?:^|\s)@([A-Za-z][\w-]{1,32})\b/g;

const REGION_KEYS = ['CTX', 'HPC', 'THL', 'AMY', 'BG', 'PFC', 'CBL'];

// ---------- low-level helpers ----------

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function fnvHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function countMatches(text, patterns) {
  let count = 0;
  for (const rx of patterns) {
    const m = text.match(new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g'));
    if (m) count += m.length;
  }
  return count;
}

function inferTitle(text) {
  const firstLine = (text.split(/\n/)[0] || '').trim();
  if (firstLine.length > 0 && firstLine.length <= 100) return firstLine;
  const firstSentence = (text.match(/[^.!?\n]{8,140}[.!?]/) || [''])[0].trim();
  return firstSentence || firstLine.slice(0, 80) || 'Untitled capture';
}

function extractAll(re, text, group = 0) {
  const out = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  let safety = 0;
  while ((m = rx.exec(text)) !== null) {
    out.push(m[group]);
    if (out.length > 30) break; // sanity
    // Guard against zero-width matches that would never advance.
    if (m.index === rx.lastIndex) rx.lastIndex++;
    if (++safety > 1000) break;
  }
  return out;
}

function normalizeRegions(regionsObj) {
  const out = {};
  for (const k of REGION_KEYS) out[k] = 0;
  for (const [k, v] of Object.entries(regionsObj || {})) {
    if (REGION_KEYS.includes(k)) out[k] = clamp(v, 0, 1);
  }
  return out;
}

// ---------- core classifier ----------

/**
 * Classify text into the 8 episodic categories.
 * Returns:
 *   {
 *     scores: { [categoryId]: { score, hits, evidence } },
 *     dominant: [{ id, label, score, color, regions }],   // up to 2
 *     primary: <categoryId>,
 *     secondary: <categoryId|null>
 *   }
 */
export function classifyEpisodic(text = '') {
  const normalized = (text || '').trim();
  if (normalized.length < 3) {
    return emptyClassification();
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1;
  // baseline scales softly with length so a 200-word post needs a few
  // more hits to claim a category than a one-line note.
  const baseline = Math.max(2, 1.5 + Math.log10(Math.max(wordCount, 8)));

  const scores = {};
  for (const id of EPISODIC_IDS) {
    const cat = EPISODIC_CATEGORIES[id];
    const hits = countMatches(normalized, cat.triggers);
    const score = clamp(hits / baseline, 0, 1);
    // sample up to 2 short evidence snippets for the UI
    const evidence = collectEvidence(normalized, cat.triggers);
    scores[id] = { score, hits, evidence };
  }

  const ranked = EPISODIC_IDS
    .map((id) => ({
      id,
      label: EPISODIC_CATEGORIES[id].label,
      color: EPISODIC_CATEGORIES[id].color,
      icon: EPISODIC_CATEGORIES[id].icon,
      regions: EPISODIC_CATEGORIES[id].regions,
      cluster: EPISODIC_CATEGORIES[id].cluster,
      score: scores[id].score
    }))
    .filter((c) => c.score >= 0.18)
    .sort((a, b) => b.score - a.score);

  const primary = ranked[0]?.id || 'artifact';
  const secondary = ranked[1]?.id || null;

  return {
    scores,
    dominant: ranked.slice(0, 2),
    primary,
    secondary
  };
}

function collectEvidence(text, patterns) {
  const out = new Set();
  for (const rx of patterns) {
    const flags = rx.flags.includes('g') ? rx.flags : rx.flags + 'g';
    const re = new RegExp(rx.source, flags);
    let m;
    let safety = 0;
    while ((m = re.exec(text)) !== null) {
      const snippet = m[0].trim();
      if (snippet.length >= 2 && snippet.length <= 60) {
        out.add(snippet.toLowerCase());
      }
      if (out.size >= 3) break;
      // Guard against zero-width matches.
      if (m.index === re.lastIndex) re.lastIndex++;
      if (++safety > 500) break;
    }
    if (out.size >= 3) break;
  }
  return Array.from(out);
}

function emptyClassification() {
  const scores = {};
  for (const id of EPISODIC_IDS) scores[id] = { score: 0, hits: 0, evidence: [] };
  return { scores, dominant: [], primary: 'artifact', secondary: null };
}

// ---------- region contributions ----------

/**
 * Merge the dominant episodic categories' region affinities with the
 * affective decoder's region contributions. The result is the
 * "this capture activates these regions" overlay used by the brain
 * scene.
 *
 * episodic regions are weighted by category score, affects by their
 * own score; we union both maps additively then renormalize so the
 * peak region sits between 0.55 and 0.95 (visible-but-not-saturating).
 */
export function mergeRegionContributions(classification, affectResult) {
  const acc = {};
  for (const k of REGION_KEYS) acc[k] = 0;

  for (const cat of classification.dominant) {
    const w = cat.score;
    for (const [r, v] of Object.entries(cat.regions || {})) {
      acc[r] = (acc[r] || 0) + v * w;
    }
  }

  if (affectResult?.regionHeatmap) {
    for (const [r, v] of Object.entries(affectResult.regionHeatmap)) {
      acc[r] = (acc[r] || 0) + v * 0.7;
    }
  }

  const peak = Math.max(...Object.values(acc), 1e-6);
  // Renormalize so the strongest activation lands ~0.85 — visible glow
  // without saturating the brain.
  const target = 0.85;
  const scale = peak > 0 ? target / peak : 0;
  const out = {};
  for (const k of REGION_KEYS) {
    out[k] = clamp(acc[k] * scale, 0, 0.95);
  }
  // If literally nothing activated, fall back to the diffuse default
  if (peak < 0.05) return { ...DEFAULT_REGIONS };
  return out;
}

// ---------- main route entry ----------

/**
 * Build a full capture record from raw text.
 * Caller is expected to add { id, ts, embedding } separately —
 * this function is synchronous and stateless.
 */
export function routeCapture(text, opts = {}) {
  const normalized = String(text || '').trim();
  if (normalized.length < 1) return null;

  const classification = classifyEpisodic(normalized);
  const firewall = scoreContent(normalized);
  const affects = decodeAffects(normalized);
  const genre = classifyGenre(normalized);
  const pii = detectPII(normalized);

  const urls = Array.from(new Set(normalized.match(URL_RE) || []));
  const tags = Array.from(new Set(extractAll(HASHTAG_RE, normalized, 1)));
  const mentions = Array.from(new Set(extractAll(MENTION_RE, normalized, 1)));

  const regions = mergeRegionContributions(classification, affects);

  const title = opts.title?.trim() || inferTitle(normalized);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  return {
    text: normalized,
    title,
    wordCount,
    primary: classification.primary,
    secondary: classification.secondary,
    classification,
    firewall: {
      score: firewall.score,
      pressure: firewall.pressure ?? firewall.score,
      dimensions: {
        emotionalActivation: firewall.emotionalActivation,
        cognitiveSuppression: firewall.cognitiveSuppression,
        manipulationPressure: firewall.manipulationPressure,
        trustErosion: firewall.trustErosion
      },
      templates: (firewall.templates || []).slice(0, 6),
      language: firewall.language || 'en'
    },
    affects: {
      dominant: affects.dominant.map((a) => ({ id: a.id, label: a.label, score: a.score, color: a.color })),
      valence: affects.valence,
      arousal: affects.arousal,
      quadrant: affects.quadrant
    },
    genre: {
      primary: genre.primary,
      ranked: (genre.ranked || []).slice(0, 3)
    },
    regions,
    urls,
    tags,
    mentions,
    pii: { total: pii.total, first: pii.first, kinds: Object.keys(pii.kinds) },
    hash: fnvHash(normalized.slice(0, 1024))
  };
}

/**
 * Convert a routed capture into a partial brain state the scene can
 * apply via setBrainState((cur) => ({ ...cur, regions, scenario })).
 *
 * additive=true → merge with existing regions instead of replacing them
 * (matches the affect-overlay pattern in Layer 29).
 */
export function captureToBrainState(curState, capture, { additive = true } = {}) {
  if (!curState || !capture?.regions) return curState;
  const regions = additive ? { ...curState.regions } : normalizeRegions(capture.regions);
  if (additive) {
    for (const [k, v] of Object.entries(capture.regions)) {
      if (!REGION_KEYS.includes(k)) continue;
      regions[k] = clamp((regions[k] || 0) * 0.55 + v * 0.65, 0.02, 0.95);
    }
  }
  const cat = EPISODIC_CATEGORIES[capture.primary];
  return {
    ...curState,
    regions,
    scenario: `Episodic · ${cat?.label || 'capture'} · ${capture.title.slice(0, 28)}`,
    burst: Math.max(curState.burst || 0, 3)
  };
}

export const __test__ = { fnvHash, normalizeRegions, REGION_KEYS };
