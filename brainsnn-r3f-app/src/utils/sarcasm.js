/**
 * Layer 80 — Sarcasm / Decoy Detector (FPR reducer)
 *
 * When a match for a Firewall keyword falls inside a sarcasm wrapper
 * or a quoted/reported-speech context, it's likely NOT manipulation by
 * the speaker — it's the speaker CALLING OUT manipulation. This layer
 * flags those cases and emits a recommended pressure adjustment so
 * the caller can attenuate the score.
 *
 * We don't modify `scoreContent` output directly; we expose
 * `adjustmentFor(text, originalPressure)` so the Firewall panel can
 * show both raw and adjusted.
 */

const SARCASM_WRAPPERS = [
  // Explicit sarcasm markers
  /\b(?:lol|lmao|sarcasm|\/s)\b/gi,
  // Scare quotes surrounding keywords
  /["“”][^"“”]{2,40}["“”]/g,
  // "so-called" / "allegedly" / "supposedly" — reported/distanced
  /\bso-called\b|\ballegedly\b|\bsupposedly\b|\bapparently\b|\bquote unquote\b/gi,
  // "as if" / "right?" / "as they call it" — ironic framing
  /\bas if\b|\bright\?\b|\bsure\b|\bohh? yeah\b/gi,
  // Reported speech framing
  /\bthey (?:say|claim|call it|told me)\b|\bshe said\b|\bhe said\b/gi,
  // Meta commentary
  /\bclassic (?:phishing|scam|gaslighting|urgency|outrage)\b/gi,
];

const CALLOUT_FRAMES = [
  /\bthat(?:['’]?s| is) (?:literally )?(?:gaslighting|phishing|a scam|manipulation)\b/gi,
  /\b(?:reads like|sounds like|smells like) (?:a scam|manipulation|phishing|gaslighting)\b/gi,
  /\bred flag\b|\btextbook (?:phishing|gaslighting|scam)\b/gi,
  /\bhere[’']?s (?:the|a) (?:scam|trick|phishing)\b/gi,
];

function countMatches(text, patterns) {
  return patterns.reduce((t, re) => t + ((text.match(re) || []).length), 0);
}

function clamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Returns { sarcasmScore, calloutScore, suggestedAdjustment }
 * suggestedAdjustment is multiplicative on pressure: 1.0 = keep,
 * 0.5 = halve, 0.2 = strongly attenuate. The Firewall UI surfaces
 * both the raw score and the adjusted one so users see both.
 */
export function analyzeDecoy(text = '') {
  const t = String(text || '');
  if (t.length < 10) {
    return { sarcasmScore: 0, calloutScore: 0, suggestedAdjustment: 1, markers: [] };
  }
  const sarcasm = countMatches(t, SARCASM_WRAPPERS);
  const callout = countMatches(t, CALLOUT_FRAMES);
  const markers = [];
  for (const re of [...SARCASM_WRAPPERS, ...CALLOUT_FRAMES]) {
    const m = t.match(re);
    if (m) markers.push(...m.slice(0, 3).map((x) => x.toString().toLowerCase()));
  }

  const sarcasmScore = clamp(sarcasm / 3);
  const calloutScore = clamp(callout / 2);

  // Stronger attenuation when the text is ABOUT manipulation (callouts)
  // than when it just uses ironic wrappers.
  const suggestedAdjustment = clamp(1 - (calloutScore * 0.75 + sarcasmScore * 0.35), 0.15, 1);

  return {
    sarcasmScore: +sarcasmScore.toFixed(3),
    calloutScore: +calloutScore.toFixed(3),
    suggestedAdjustment: +suggestedAdjustment.toFixed(3),
    markers: [...new Set(markers)].slice(0, 8),
  };
}

export function verdictFor({ suggestedAdjustment }) {
  if (suggestedAdjustment < 0.4) return { label: 'Likely callout / sarcasm — heavy attenuation', color: '#5ee69a' };
  if (suggestedAdjustment < 0.75) return { label: 'Some irony markers — moderate attenuation', color: '#77dbe4' };
  if (suggestedAdjustment < 0.95) return { label: 'Mild ironic framing', color: '#fdab43' };
  return { label: 'No decoy markers — raw score stands', color: '#94a3b8' };
}
