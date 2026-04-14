/**
 * Layer 29 — Affective Trigger Decoder
 *
 * decodeAffects(text) scans pasted content against the 12-affect lexicon and
 * returns:
 *   - per-affect scores + example matches
 *   - dominant affects (top 3 over threshold)
 *   - valence/arousal coords (weighted average) + Russell-circumplex quadrant
 *   - regionHeatmap: additive per-region contribution from dominant affects
 *   - clusterTotals: summed intensity by cluster
 *   - crossCategoryInsight: which regions are targeted by multiple clusters
 *
 * buildAffectOverride(decoded) converts that result into the map BrainScene
 * consumes: { regionId: { color, strength, affect } } — one color per region,
 * picked from the single highest-contributing affect per region.
 *
 * applyAffectsToBrainState(state, decoded) is an additive nudge to the brain
 * state (mirrors the cognitive firewall's mapTRIBEToRegions pattern).
 */

import { AFFECT_LEXICON, AFFECT_IDS, AFFECT_CLUSTERS } from '../data/affectLexicon';
import { clamp } from './sim';

const MIN_DOMINANT_SCORE = 0.15;
const MAX_DOMINANT = 3;

function scoreAffect(text, affect, baseline) {
  let matches = 0;
  const examples = new Set();
  for (const rx of affect.triggers) {
    const found = text.match(new RegExp(rx.source, 'gi'));
    if (found) {
      matches += found.length;
      for (const m of found.slice(0, 2)) examples.add(m.toLowerCase());
      if (examples.size >= 4) break;
    }
  }
  const score = clamp(matches / baseline, 0, 1);
  return { score, matches, examples: Array.from(examples).slice(0, 4) };
}

/**
 * Main entry. Returns a decoded-result object ready to drive the UI and
 * the brain overlay.
 */
export function decodeAffects(text) {
  const normalized = (text || '').trim();
  if (normalized.length < 3) {
    return emptyResult();
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length || 1;
  const baseline = Math.max(3, 4 + Math.log(Math.max(wordCount, 10) / 50));

  const scores = {};
  for (const id of AFFECT_IDS) {
    scores[id] = scoreAffect(normalized, AFFECT_LEXICON[id], baseline);
  }

  // Dominant: top-N by score, filtered by threshold.
  const dominant = AFFECT_IDS
    .map((id) => ({
      id,
      score: scores[id].score,
      matches: scores[id].matches,
      examples: scores[id].examples,
      ...AFFECT_LEXICON[id]
    }))
    .filter((a) => a.score >= MIN_DOMINANT_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DOMINANT);

  // Russell coords: weighted average of dominant affects. If nothing dominant,
  // fall back to a neutral centroid.
  let valence = 0;
  let arousal = 0;
  const totalWeight = dominant.reduce((acc, a) => acc + a.score, 0);
  if (totalWeight > 0) {
    for (const a of dominant) {
      valence += a.valence * (a.score / totalWeight);
      arousal += a.arousal * (a.score / totalWeight);
    }
  }

  const quadrant = quadrantFor(valence, arousal, dominant.length > 0);

  // Cluster totals: summed score per cluster.
  const clusterTotals = {};
  for (const key of Object.keys(AFFECT_CLUSTERS)) clusterTotals[key] = 0;
  for (const id of AFFECT_IDS) {
    clusterTotals[AFFECT_LEXICON[id].cluster] += scores[id].score;
  }
  // Normalize cluster totals to 0..1 by dividing by per-cluster count.
  for (const key of Object.keys(clusterTotals)) {
    const count = AFFECT_IDS.filter((id) => AFFECT_LEXICON[id].cluster === key).length;
    clusterTotals[key] = clamp(clusterTotals[key] / count, 0, 1);
  }

  // Region heatmap: additive contribution from EVERY affect (not just
  // dominant) so faint signals still register. Tracked per-affect so we can
  // later pick the top contributor for the color override.
  const heatmap = {};
  const contribution = {}; // { regionId: [{ id, delta }, ...] }
  for (const id of AFFECT_IDS) {
    const a = AFFECT_LEXICON[id];
    const s = scores[id].score;
    if (s <= 0) continue;
    for (const [region, weight] of Object.entries(a.regions)) {
      const delta = weight * s;
      heatmap[region] = clamp((heatmap[region] ?? 0) + delta, -1, 1);
      if (!contribution[region]) contribution[region] = [];
      contribution[region].push({ id, delta: Math.abs(delta), signed: delta, cluster: a.cluster, color: a.color });
    }
  }

  // Cross-category insight: for each region where heatmap > 0.3, find which
  // clusters contributed > 20% of the absolute total. Two+ clusters = a
  // "same neural target, different route" moment.
  const crossCategoryInsight = [];
  for (const region of Object.keys(contribution)) {
    const total = contribution[region].reduce((acc, c) => acc + c.delta, 0);
    if (total < 0.3) continue;
    const byCluster = {};
    for (const c of contribution[region]) {
      byCluster[c.cluster] = (byCluster[c.cluster] ?? 0) + c.delta;
    }
    const clustersHit = Object.entries(byCluster)
      .filter(([, v]) => v / total >= 0.2)
      .map(([k, v]) => ({ cluster: k, share: v / total }))
      .sort((a, b) => b.share - a.share);
    if (clustersHit.length >= 2) {
      const affectsHit = contribution[region]
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 3)
        .map((c) => AFFECT_LEXICON[c.id].label);
      crossCategoryInsight.push({
        region,
        percent: Math.round(clamp(total, 0, 1) * 100),
        clusters: clustersHit.map((c) => c.cluster),
        affects: affectsHit,
        message: `${region} (${Math.round(clamp(total, 0, 1) * 100)}%) · targeted via ${clustersHit
          .map((c) => AFFECT_CLUSTERS[c.cluster].label.toLowerCase())
          .join(' + ')} — ${affectsHit.join(', ')}. Same neural button, different finger.`
      });
    }
  }

  // Per-region dominant contributor (for color override).
  const regionDominant = {};
  for (const region of Object.keys(contribution)) {
    const top = contribution[region]
      .slice()
      .sort((a, b) => b.delta - a.delta)[0];
    if (top) {
      regionDominant[region] = {
        id: top.id,
        color: top.color,
        strength: clamp(top.delta, 0, 1)
      };
    }
  }

  return {
    empty: dominant.length === 0,
    wordCount,
    scores,
    dominant,
    valence: clamp(valence, -1, 1),
    arousal: clamp(arousal, 0, 1),
    quadrant,
    clusterTotals,
    regionHeatmap: heatmap,
    regionDominant,
    crossCategoryInsight
  };
}

function emptyResult() {
  const clusterTotals = {};
  for (const key of Object.keys(AFFECT_CLUSTERS)) clusterTotals[key] = 0;
  return {
    empty: true,
    wordCount: 0,
    scores: {},
    dominant: [],
    valence: 0,
    arousal: 0,
    quadrant: 'neutral',
    clusterTotals,
    regionHeatmap: {},
    regionDominant: {},
    crossCategoryInsight: []
  };
}

function quadrantFor(valence, arousal, hasSignal) {
  if (!hasSignal) return 'neutral';
  // Russell's circumplex: arousal threshold at 0.45 (since arousal is 0..1).
  const highArousal = arousal >= 0.45;
  if (valence >= 0) return highArousal ? 'excited' : 'calm';
  return highArousal ? 'tense' : 'depressed';
}

export const QUADRANT_INFO = {
  excited: { label: 'Excited · Energized', color: '#ffd54a' },
  tense:   { label: 'Tense · Agitated',    color: '#ff4066' },
  calm:    { label: 'Calm · Contented',    color: '#7dd87f' },
  depressed:{label: 'Depressed · Withdrawn', color: '#6a4a80' },
  neutral: { label: 'Neutral',              color: '#8a8f99' }
};

/**
 * Build the { regionId: { color, strength, affect } } map that BrainScene's
 * BrainNode consumes. Strength is clamped so a single very-dominant affect
 * still blends toward (not fully replaces) the region's base color.
 */
export function buildAffectOverride(decoded) {
  if (!decoded || decoded.empty) return null;
  const out = {};
  for (const [region, info] of Object.entries(decoded.regionDominant)) {
    // Strength is capped at 0.85 so a tiny bit of the original region hue
    // always bleeds through — the override is a tint, not a repaint.
    out[region] = {
      color: info.color,
      strength: clamp(info.strength * 1.2, 0, 0.85),
      affect: info.id
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Additive nudge on state.regions (mirrors cognitiveFirewall.mapTRIBEToRegions).
 * Used when the user clicks "Apply activation to brain".
 */
export function applyAffectsToBrainState(state, decoded) {
  if (!decoded || decoded.empty) return state;
  const regions = { ...state.regions };
  for (const [region, delta] of Object.entries(decoded.regionHeatmap)) {
    if (regions[region] === undefined) continue;
    regions[region] = clamp(regions[region] + delta * 0.3, 0.04, 0.95);
  }
  return {
    ...state,
    regions,
    tick: (state.tick ?? 0) + 1,
    scenario: 'Affective Decoder',
    burst: Math.max(state.burst ?? 0, decoded.arousal * 0.6)
  };
}
