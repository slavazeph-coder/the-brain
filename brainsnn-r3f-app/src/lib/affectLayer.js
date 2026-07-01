// Layer 29 — Affective Decoder
// ---------------------------------------------------------------------------
// Decodes which feeling a piece of content installs. Keeps the core fields the
// rest of the stack depends on (dominantAffect / valence / arousal / clusters)
// and adds depth: a 9-affect taxonomy plotted on Russell's valence×arousal
// circumplex, the scan's dominant circumplex point, and a per-sentence emotion
// trajectory. Deterministic — seeded only by the text and base metrics.

import { clampScore } from './formatters.js';
import { splitIntoSegments } from './validation.js';

const empathyTerms = /\b(you|your|together|help|support|understand|people|customers|team|community)\b/gi;
const curiosityTerms = /\b(why|how|what if|surprising|discover|learn|before|after|mistake|lesson)\b/gi;
const negativeTerms = /\b(risk|danger|lose|fail|threat|panic|crisis|angry|furious|hate|scam|fear|worse|betray|rigged)\b/gi;
const urgencyTerms = /\b(now|today|urgent|immediately|hurry|deadline|last chance|act fast)\b/gi;

// Fixed Russell circumplex coordinates (valence x, arousal y, each -1..1).
const AFFECT_TAXONOMY = [
  { id: 'outrage', label: 'Outrage', x: -0.85, y: 0.55 },
  { id: 'anger', label: 'Anger', x: -0.75, y: 0.6 },
  { id: 'fear', label: 'Fear', x: -0.6, y: 0.65 },
  { id: 'anticipation', label: 'Anticipation', x: 0.15, y: 0.6 },
  { id: 'curiosity', label: 'Curiosity', x: 0.4, y: 0.35 },
  { id: 'joy', label: 'Joy', x: 0.7, y: 0.45 },
  { id: 'trust', label: 'Trust', x: 0.6, y: -0.05 },
  { id: 'calm', label: 'Calm', x: 0.5, y: -0.6 },
  { id: 'sadness', label: 'Sadness', x: -0.55, y: -0.45 },
];

function count(text, regex) {
  return (String(text || '').match(regex) || []).length;
}

function affectScores(m, curiosity, emotionalActivation) {
  return {
    outrage: clampScore(m.anger * 0.7 + m.fear * 0.15),
    anger: clampScore(m.anger),
    fear: clampScore(m.fear),
    anticipation: clampScore(m.urgency),
    curiosity: clampScore(curiosity * 16 + m.excitement * 0.2),
    joy: clampScore(m.excitement),
    trust: clampScore(m.trust),
    calm: clampScore(100 - m.urgency * 0.6 - emotionalActivation * 80 - m.fear * 0.3),
    sadness: clampScore(m.fear * 0.25 + (100 - m.excitement) * 0.15 + m.anger * 0.1),
  };
}

/**
 * Deterministic affect profile. `firewallSignals` is optional; when present its
 * `emotionalActivation` sharpens the arousal estimate (same as before).
 */
export function computeAffect({ content = '', metrics = {}, firewallSignals = {} } = {}) {
  const text = String(content || '');
  const curiosity = count(text, curiosityTerms);
  const empathy = count(text, empathyTerms);
  const m = {
    trust: Number(metrics.trust) || 50,
    excitement: Number(metrics.excitement) || 40,
    fear: Number(metrics.fear) || 0,
    anger: Number(metrics.anger) || 0,
    urgency: Number(metrics.urgency) || 0,
  };
  const emotionalActivation = Number(firewallSignals?.emotionalActivation) || 0;

  const dominantAffect = m.fear + m.anger > 115
    ? 'threat'
    : m.trust > 68 && empathy > 2
      ? 'trust'
      : curiosity + m.excitement / 30 > 3
        ? 'curiosity'
        : m.urgency > 70
          ? 'pressure'
          : 'clarity';

  const valence = clampScore(48 + m.trust * 0.32 + empathy * 4 - m.fear * 0.18 - m.anger * 0.16, 50);
  const arousal = clampScore(32 + m.excitement * 0.32 + m.urgency * 0.25 + emotionalActivation * 32, 45);

  const scores = affectScores(m, curiosity, emotionalActivation);
  const taxonomy = AFFECT_TAXONOMY
    .map((affect) => ({ ...affect, score: scores[affect.id] }))
    .sort((a, b) => b.score - a.score);

  // Per-sentence emotion trajectory across the copy.
  const trajectory = splitIntoSegments(text).map((sentence, index) => {
    const emp = count(sentence, empathyTerms);
    const cur = count(sentence, curiosityTerms);
    const neg = count(sentence, negativeTerms);
    const urg = count(sentence, urgencyTerms);
    return {
      id: `aseg-${index + 1}`,
      text: sentence,
      valence: clampScore(50 + emp * 6 + cur * 3 - neg * 12),
      arousal: clampScore(40 + urg * 14 + neg * 8 + cur * 4),
    };
  });

  return {
    dominantAffect,
    valence,
    arousal,
    clusters: [
      { id: 'threat', label: 'Threat', value: clampScore((m.fear + m.anger) / 2, 20) },
      { id: 'reward', label: 'Reward', value: clampScore(m.excitement, 40) },
      { id: 'social', label: 'Social trust', value: clampScore((m.trust + empathy * 10) / 2, 45) },
      { id: 'cognitive', label: 'Curiosity / clarity', value: clampScore(curiosity * 16 + m.trust * 0.28, 38) },
    ],
    // Depth:
    taxonomy,
    dominantEmotion: taxonomy[0]?.id || 'trust',
    circumplex: { x: Number(((valence - 50) / 50).toFixed(3)), y: Number(((arousal - 50) / 50).toFixed(3)) },
    trajectory,
  };
}
