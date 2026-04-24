/**
 * Layer 89 — Refutation Composer
 *
 * Stitch a full reply draft from the refutations of every template
 * detected in a scanned message. The output has three movable parts:
 *
 *   OPENING — a boundary statement that names what's happening
 *   BODY    — one-liner from each matched template's refutation.script
 *   CLOSE   — "what I need from you next"
 *
 * The goal isn't to hand the user perfect words — it's to give a
 * scaffolded draft they can edit. Much easier to edit text than
 * face a blank reply box after a manipulative message.
 */

import { scoreContent } from './cognitiveFirewall';
import { refutationsFor } from './refutations';

const OPENINGS = {
  high: 'I want to name what just happened before I respond to the substance.',
  moderate: 'Before I reply, I want to flag how this message is framed.',
  low: 'Quick observation before I answer in detail.',
};

const CLOSINGS = [
  'If we can keep the conversation to the specifics, I\'ll engage fully.',
  'I\'m happy to discuss the underlying issue once we agree on what happened.',
  'I\'ll respond to the actual question once we\'re talking on level ground.',
  'Message me back when we can discuss without the framing above.',
];

function hashChoice(list, seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

export function composeReply(text = '', { tone = 'direct' } = {}) {
  const t = String(text || '').trim();
  if (t.length < 10) return { ok: false, error: 'empty input' };
  const score = scoreContent(t);
  const pressure =
    ((score.emotionalActivation || 0) + (score.cognitiveSuppression || 0) + (score.manipulationPressure || 0)) / 3;
  const refs = refutationsFor(score.templates || []);

  const opening = pressure >= 0.6
    ? OPENINGS.high
    : pressure >= 0.3
      ? OPENINGS.moderate
      : OPENINGS.low;

  const bodyLines = refs.slice(0, 3).map((r) => r.refutation.script);
  const closing = hashChoice(CLOSINGS, t.slice(0, 48));

  const softenWrap = (str) => tone === 'soft' ? `I hear you. ${str}` : str;
  const firmWrap = (str) => tone === 'firm' ? `To be direct: ${str}` : str;

  const draft = [
    firmWrap(softenWrap(opening)),
    ...bodyLines,
    closing,
  ].filter(Boolean).join('\n\n');

  return {
    ok: true,
    draft,
    pressure,
    usedTemplates: refs.map((r) => r.label),
    tone,
  };
}

export const COMPOSER_TONES = ['direct', 'soft', 'firm'];

export const COMPOSER_EXAMPLE =
  "You're imagining it. That never happened — I never said that. After everything I've done for you, this is how you respond? Everyone knows the truth anyway. You need to act now before this gets worse.";
