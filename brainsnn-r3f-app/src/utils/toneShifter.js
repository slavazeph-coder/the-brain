/**
 * Layer 68 — Tone Shifter
 *
 * The inverse of Layer 42 Counter-Draft. Take neutral text and
 * inject a chosen manipulation style — for DEFENSIVE training only:
 * the point is to let you see "what does my writing look like if I
 * unintentionally drift into this style?" and to produce adversarial
 * samples for your own red-team.
 *
 * Every output gets tagged explicitly so it can't be misused without
 * the user noticing — the panel also shows the before/after Firewall
 * scores.
 */

import { scoreContent } from './cognitiveFirewall';

export const SHIFT_STYLES = [
  {
    id: 'urgency',
    label: 'Urgency',
    desc: 'Injects deadline pressure, exclamation stacks, CAPS alerts.',
    transforms: [
      { re: /(?:^|\.\s+)([A-Z])/g, sub: (m, c) => m.replace(c, `URGENT: ${c}`) },
      { re: /\bsoon\b/gi, sub: 'immediately' },
      { re: /\.(?=\s|$)/g, sub: '!' },
      { prepend: 'BREAKING! ' },
    ],
  },
  {
    id: 'outrage',
    label: 'Outrage',
    desc: 'Adds scandal vocabulary and "they"-framing.',
    transforms: [
      { re: /\bmistake\b/gi, sub: 'scandal' },
      { re: /\bdisappointing\b/gi, sub: 'disgusting' },
      { re: /\bsomeone\b/gi, sub: 'they' },
      { prepend: 'UNBELIEVABLE: ' },
      { append: ' They covered it up for years.' },
    ],
  },
  {
    id: 'certainty',
    label: 'Certainty theater',
    desc: 'Swaps hedging for absolutes.',
    transforms: [
      { re: /\bmight\b|\bmay\b|\bcould\b|\bperhaps\b|\bmaybe\b/gi, sub: 'obviously' },
      { re: /\bseems? to\b/gi, sub: 'clearly' },
      { re: /\bsuggests?\b/gi, sub: 'proves' },
      { append: ' 100% guaranteed. Everyone knows this.' },
    ],
  },
  {
    id: 'fear',
    label: 'Fear appeal',
    desc: 'Adds catastrophic framing.',
    transforms: [
      { re: /\brisk\b/gi, sub: 'deadly threat' },
      { re: /\bproblem\b/gi, sub: 'looming disaster' },
      { re: /\bissue\b/gi, sub: 'catastrophic issue' },
      { append: ' If you don\'t act now, it may already be too late.' },
    ],
  },
  {
    id: 'guilt-trip',
    label: 'Guilt trip',
    desc: 'Injects sacrifice + obligation framing.',
    transforms: [
      { prepend: 'After everything I\'ve done for you — ' },
      { append: ' I guess I\'ll just carry this alone, as usual.' },
    ],
  },
];

function applyTransforms(text, style) {
  let out = text;
  for (const t of style.transforms) {
    if (t.prepend) out = t.prepend + out;
    if (t.append) out = out + t.append;
    if (t.re) {
      if (typeof t.sub === 'function') out = out.replace(t.re, t.sub);
      else out = out.replace(t.re, t.sub);
    }
  }
  // Nudge toward exclamation density for urgency/outrage/fear
  if (['urgency', 'outrage', 'fear'].includes(style.id)) {
    out = out.replace(/([.!?])([ ]*[A-Z])/g, (m, p, c) => `${p === '.' ? '!' : p}${c}`);
  }
  return out.trim();
}

export function shiftTone(text, styleId) {
  const style = SHIFT_STYLES.find((s) => s.id === styleId);
  if (!style) return { ok: false, error: 'unknown style' };
  if (!text || text.trim().length < 5) return { ok: false, error: 'empty input' };
  const before = scoreContent(text);
  const shifted = applyTransforms(text, style);
  const after = scoreContent(shifted);
  const beforeP = (before.emotionalActivation + before.cognitiveSuppression + before.manipulationPressure) / 3;
  const afterP = (after.emotionalActivation + after.cognitiveSuppression + after.manipulationPressure) / 3;
  return {
    ok: true,
    style,
    before: text,
    after: shifted,
    beforePressure: beforeP,
    afterPressure: afterP,
    increase: Math.max(0, afterP - beforeP),
  };
}

export const TONE_EXAMPLE = 'The team hit a bump on the Q3 rollout. We\'re rescoping to hit the December milestone.';
