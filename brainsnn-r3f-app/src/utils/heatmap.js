/**
 * Layer 40 — Sentence Heatmap
 *
 * Break text into sentences, score each one through the Cognitive
 * Firewall, and emit a per-sentence pressure timeline. Lets the UI
 * color-annotate the exact sentences responsible for a high overall
 * score instead of just showing summary bars.
 *
 * Sentence splitter is deliberately simple — abbreviations and edge
 * cases matter less than "obvious sentence chunks" for display.
 */

import { scoreContent } from './cognitiveFirewall';

const SPLIT_RE = /([.!?]+["')\]]*\s+|\n{2,})/;

export function splitSentences(text = '') {
  if (!text || !text.trim()) return [];
  // Split but keep terminators glued to the previous fragment
  const parts = text.split(SPLIT_RE);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] || '';
    const sep = parts[i + 1] || '';
    const combined = (body + sep).trim();
    if (combined) out.push(combined);
  }
  return out;
}

/**
 * Score each sentence. Returns:
 *   [{ idx, text, pressure, templates: [...], evidence: [...] }]
 */
export function scoreSentences(text = '') {
  const sentences = splitSentences(text);
  return sentences.map((s, idx) => {
    const score = scoreContent(s);
    const pressure =
      (score.emotionalActivation + score.cognitiveSuppression + score.manipulationPressure) / 3;
    return {
      idx,
      text: s,
      pressure,
      templates: score.templates || [],
      evidence: score.evidence || [],
    };
  });
}

/**
 * Map a pressure value to a tailwind-ish color band for the inline
 * highlight. Transparent for calm sentences so the text doesn't look
 * like a highlighter explosion.
 */
export function pressureBand(pressure) {
  if (pressure >= 0.65) return { bg: 'rgba(221,105,116,0.22)', border: '#dd6974', label: 'High' };
  if (pressure >= 0.45) return { bg: 'rgba(229,123,64,0.18)', border: '#e57b40', label: 'Heavy' };
  if (pressure >= 0.28) return { bg: 'rgba(253,171,67,0.14)', border: '#fdab43', label: 'Tilted' };
  if (pressure >= 0.12) return { bg: 'rgba(109,170,69,0.10)', border: '#6daa45', label: 'Low' };
  return { bg: 'transparent', border: 'rgba(255,255,255,0.04)', label: 'Calm' };
}

/**
 * Summary stats for the heatmap header.
 */
export function heatmapSummary(rows) {
  if (!rows.length) return { count: 0, peak: 0, peakIdx: -1, mean: 0, high: 0 };
  let peak = 0;
  let peakIdx = -1;
  let sum = 0;
  let high = 0;
  for (const r of rows) {
    sum += r.pressure;
    if (r.pressure > peak) { peak = r.pressure; peakIdx = r.idx; }
    if (r.pressure >= 0.65) high++;
  }
  return {
    count: rows.length,
    peak,
    peakIdx,
    mean: sum / rows.length,
    high,
  };
}
