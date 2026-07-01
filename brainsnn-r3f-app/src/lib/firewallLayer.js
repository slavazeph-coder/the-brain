// Layer 4 — Cognitive Firewall
// ---------------------------------------------------------------------------
// Deterministic manipulation-pressure scoring for a piece of content. The core
// signals (emotionalActivation / cognitiveSuppression / manipulationPressure /
// trustErosion) drive the rest of the layer stack, so this module keeps those
// exact fields and adds depth around them: a per-category breakdown, a
// per-sentence pressure heatmap (so manipulation *location* is visible), an
// overall A-F grade + tier, and named tactics with confidence.
//
// Pure and seeded only by the text — identical content yields an identical
// profile, so it backs regression tests and audit receipts.

import { clampScore } from './formatters.js';
import { splitIntoSegments } from './validation.js';

const urgencyTerms = /\b(now|today|deadline|limited|last chance|urgent|immediately|act fast|before it'?s too late)\b/gi;
const outrageTerms = /\b(outrage|furious|rigged|corrupt|betrayed|enemy|disgusting|they don't want|scandal)\b/gi;
const fearTerms = /\b(risk|danger|lose|fail|threat|panic|crisis|damage|warning|unsafe|hidden truth)\b/gi;
const certaintyTerms = /\b(guaranteed|proven|everyone knows|obviously|undeniably|100%|fact|scientifically proven)\b/gi;
const trustTerms = /\b(proof|data|tested|customer|source|case study|measured|verified|transparent|specific|evidence)\b/gi;

const CATEGORY_DEFS = [
  { id: 'urgency', label: 'Urgency', regex: urgencyTerms },
  { id: 'outrage', label: 'Outrage', regex: outrageTerms },
  { id: 'fear', label: 'Fear', regex: fearTerms },
  { id: 'certainty', label: 'Certainty', regex: certaintyTerms },
  { id: 'trust', label: 'Trust / proof', regex: trustTerms },
];

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function count(text, regex) {
  return (String(text || '').match(regex) || []).length;
}

function matchedPhrases(text, regex, limit = 6) {
  const matches = String(text || '').match(regex) || [];
  return [...new Set(matches.map((match) => match.trim().toLowerCase()))].slice(0, limit);
}

function findEvidence(text, regex, label) {
  return matchedPhrases(text, regex, 5).map((match) => ({ label, match }));
}

// Named manipulation templates (kept for back-compat with the layer trace).
export function detectTemplates(text) {
  const templates = [];
  if (count(text, urgencyTerms) > 0 && count(text, trustTerms) === 0) templates.push({ id: 'forced-urgency', label: 'Forced urgency', risk: 'Pressure appears before proof.' });
  if (count(text, fearTerms) > 0) templates.push({ id: 'fear-pressure', label: 'Fear pressure', risk: 'Risk framing may attract attention while lowering trust.' });
  if (count(text, outrageTerms) > 0) templates.push({ id: 'outrage-hook', label: 'Outrage hook', risk: 'Conflict language may increase charge and brand risk.' });
  if (count(text, certaintyTerms) > 0) templates.push({ id: 'certainty-theater', label: 'Certainty theater', risk: 'Absolute claims need evidence or qualification.' });
  if (!templates.length) templates.push({ id: 'organic-baseline', label: 'Organic baseline', risk: 'No high-pressure template dominates.' });
  return templates.slice(0, 5);
}

// Same tactics, ranked with a confidence derived from the hit counts.
export function detectTactics(text) {
  const urgency = count(text, urgencyTerms);
  const outrage = count(text, outrageTerms);
  const fear = count(text, fearTerms);
  const certainty = count(text, certaintyTerms);
  const trust = count(text, trustTerms);
  const tactics = [];
  if (urgency > 0 && trust === 0) tactics.push({ id: 'forced-urgency', label: 'Forced urgency', confidence: clampScore(40 + urgency * 20), risk: 'Pressure appears before proof.' });
  if (fear > 0) tactics.push({ id: 'fear-pressure', label: 'Fear pressure', confidence: clampScore(35 + fear * 22), risk: 'Risk framing attracts attention while lowering trust.' });
  if (outrage > 0) tactics.push({ id: 'outrage-hook', label: 'Outrage hook', confidence: clampScore(35 + outrage * 22), risk: 'Conflict language raises charge and brand risk.' });
  if (certainty > 0) tactics.push({ id: 'certainty-theater', label: 'Certainty theater', confidence: clampScore(35 + certainty * 20), risk: 'Absolute claims need evidence or qualification.' });
  if (!tactics.length) tactics.push({ id: 'organic-baseline', label: 'Organic baseline', confidence: 20, risk: 'No high-pressure tactic dominates.' });
  return tactics.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function gradeFrom(pressure) {
  if (pressure < 0.15) return 'A';
  if (pressure < 0.3) return 'B';
  if (pressure < 0.5) return 'C';
  if (pressure < 0.7) return 'D';
  if (pressure < 0.85) return 'E';
  return 'F';
}

function tierFrom(pressure) {
  if (pressure < 0.3) return 'Low';
  if (pressure < 0.55) return 'Medium';
  if (pressure < 0.78) return 'High';
  return 'Critical';
}

/**
 * Deterministic Cognitive Firewall profile for a piece of content.
 * `metrics` are the base BrainMetrics (fear/anger/urgency/trust/...).
 */
export function computeFirewall({ content = '', metrics = {}, isFallback = false } = {}) {
  const text = String(content || '');
  const urgency = count(text, urgencyTerms);
  const outrage = count(text, outrageTerms);
  const fear = count(text, fearTerms);
  const certainty = count(text, certaintyTerms);
  const trust = count(text, trustTerms);
  const wordCount = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
  const density = Math.min(1, (urgency + outrage + fear + certainty) / Math.max(3, wordCount / 18));

  // Core signals — identical formulas to the original layer router.
  const emotionalActivation = clamp01(((Number(metrics?.fear) || 0) + (Number(metrics?.anger) || 0) + fear * 12 + outrage * 10) / 180);
  const cognitiveSuppression = clamp01(((Number(metrics?.urgency) || 0) + urgency * 11 + certainty * 9) / 160);
  const trustErosion = clamp01((((100 - (Number(metrics?.trust) || 50)) / 100) * 0.58) + density * 0.34 - Math.min(0.18, trust * 0.03));
  const manipulationPressure = clamp01((emotionalActivation * 0.42) + (cognitiveSuppression * 0.38) + (trustErosion * 0.2));

  const evidence = [
    ...findEvidence(text, urgencyTerms, 'urgency'),
    ...findEvidence(text, outrageTerms, 'outrage'),
    ...findEvidence(text, fearTerms, 'fear'),
    ...findEvidence(text, certaintyTerms, 'certainty'),
    ...findEvidence(text, trustTerms, 'proof'),
  ].slice(0, 10);

  // Per-category breakdown (density-normalized 0-100 with matched phrases).
  const categories = CATEGORY_DEFS.map((def) => {
    const hits = count(text, def.regex);
    return {
      id: def.id,
      label: def.label,
      hits,
      score: clampScore(Math.min(100, hits * (100 / Math.max(2, wordCount / 14)))),
      matches: matchedPhrases(text, def.regex),
    };
  });

  // Per-sentence pressure heatmap so manipulation location is visible.
  const heatmap = splitIntoSegments(text).map((sentence, index) => {
    const u = count(sentence, urgencyTerms);
    const o = count(sentence, outrageTerms);
    const f = count(sentence, fearTerms);
    const c = count(sentence, certaintyTerms);
    const t = count(sentence, trustTerms);
    const counts = { urgency: u, outrage: o, fear: f, certainty: c };
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return {
      id: `fseg-${index + 1}`,
      text: sentence,
      pressure: clampScore(u * 22 + o * 24 + f * 20 + c * 18 - t * 16 + 8),
      top: top && top[1] > 0 ? top[0] : (t > 0 ? 'trust' : 'neutral'),
    };
  });

  return {
    emotionalActivation: Number(emotionalActivation.toFixed(3)),
    cognitiveSuppression: Number(cognitiveSuppression.toFixed(3)),
    manipulationPressure: Number(manipulationPressure.toFixed(3)),
    trustErosion: Number(trustErosion.toFixed(3)),
    density: Number(density.toFixed(3)),
    evidence,
    templates: detectTemplates(text),
    source: isFallback ? 'deterministic-firewall-fallback' : 'model-plus-firewall',
    // Depth:
    grade: gradeFrom(manipulationPressure),
    tier: tierFrom(manipulationPressure),
    wordCount,
    categories,
    heatmap,
    tactics: detectTactics(text),
  };
}
