/**
 * Layer 101 — Decision Drift Detector
 *
 * Looks for "decision" captures that newer captures may quietly
 * contradict — the shape of a belief shift before the user has
 * consciously updated.
 *
 * Method:
 *   1. Restrict to captures classified as `decision` older than
 *      MIN_AGE_DAYS (default 3).
 *   2. For each, find recent captures (≤ DRIFT_WINDOW_DAYS) with:
 *        - cosine similarity ≥ 0.40 (or trigram fallback ≥ 0.20)
 *        - valence delta ≥ 0.45 (sign flip in affect)
 *        OR a primary category of `incident` in the same cluster.
 *   3. Score by similarity × |valence delta| × log2(daysApart + 2).
 *   4. Return the top N drifts.
 *
 * Pure deterministic — no LLM. Renders in the Weekly Synthesis card
 * under the contradictions list.
 */

import { findSimilar } from './episodicMemory';

const DAY = 24 * 60 * 60 * 1000;
const MIN_AGE_DAYS = 3;
const DRIFT_WINDOW_DAYS = 28;
const MIN_SIMILARITY = 0.34;
const MIN_VALENCE_DELTA = 0.45;

export function detectDecisionDrifts(captures, { topK = 3 } = {}) {
  if (!Array.isArray(captures) || captures.length < 2) return [];
  const now = Date.now();

  const decisions = captures.filter((c) => c?.primary === 'decision' && now - c.ts >= MIN_AGE_DAYS * DAY);
  if (!decisions.length) return [];

  const drifts = [];
  for (const dec of decisions) {
    const decValence = dec.affects?.valence ?? 0;
    const sims = findSimilar(dec.id, { k: 5, minScore: MIN_SIMILARITY });

    for (const { score, capture } of sims) {
      if (!capture) continue;
      if (capture.ts <= dec.ts) continue;
      const daysApart = (capture.ts - dec.ts) / DAY;
      if (daysApart > DRIFT_WINDOW_DAYS) continue;

      const newValence = capture.affects?.valence ?? 0;
      const valenceDelta = Math.abs(decValence - newValence);
      const sameSign = (decValence > 0) === (newValence > 0);
      const flip = !sameSign && valenceDelta >= MIN_VALENCE_DELTA;
      const incidentShadow = capture.primary === 'incident';

      if (!flip && !incidentShadow) continue;

      const driftScore = score * Math.max(0.3, valenceDelta) * Math.log2(daysApart + 2);
      drifts.push({
        decisionId: dec.id,
        decisionTitle: dec.title,
        decisionTs: dec.ts,
        decisionValence: decValence,
        contradictionId: capture.id,
        contradictionTitle: capture.title,
        contradictionTs: capture.ts,
        contradictionPrimary: capture.primary,
        contradictionValence: newValence,
        similarity: score,
        valenceDelta,
        daysApart,
        driftScore,
        kind: flip ? 'valence-flip' : 'incident-shadow'
      });
    }
  }

  drifts.sort((a, b) => b.driftScore - a.driftScore);
  return drifts.slice(0, topK);
}

export function formatDrift(d) {
  if (!d) return null;
  const days = Math.round(d.daysApart);
  const reason = d.kind === 'valence-flip'
    ? `valence flipped from ${d.decisionValence.toFixed(2)} → ${d.contradictionValence.toFixed(2)}`
    : `followed by an incident in the same cluster`;
  return {
    kind: 'drift',
    headline: `Decision drift — ${days}d apart`,
    detail: `Decision "${truncate(d.decisionTitle, 90)}" → ${d.kind === 'valence-flip' ? 'now contradicted' : 'shadowed'} by "${truncate(d.contradictionTitle, 90)}" (${reason}, cosine ${d.similarity.toFixed(2)}).`
  };
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
