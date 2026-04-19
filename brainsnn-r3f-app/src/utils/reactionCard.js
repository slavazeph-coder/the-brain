/**
 * Reaction Card — compact, self-contained encoding of a Cognitive Firewall
 * scan so it can travel as a URL (/r/<base64>) and be rendered as an OG
 * image without any database lookup.
 *
 * Keep this file dependency-free — it's imported from both the SPA and
 * the /api/og Vercel function (which runs on the Edge runtime).
 */

const MAX_EXCERPT = 280;

export const AFFECT_LABELS = {
  fear: { label: 'Fear', color: '#dd6974' },
  outrage: { label: 'Outrage', color: '#e57b40' },
  urgency: { label: 'Urgency', color: '#fdab43' },
  certainty: { label: 'Certainty theater', color: '#a86fdf' },
  awe: { label: 'Awe', color: '#5591c7' },
  belonging: { label: 'Belonging', color: '#ec87b5' },
  curiosity: { label: 'Curiosity', color: '#5fb7c1' },
  neutral: { label: 'Low-signal', color: '#6daa45' },
};

function pickAffect(score) {
  const emo = score.emotionalActivation || 0;
  const cog = score.cognitiveSuppression || 0;
  const evidence = (score.evidence || []).join(' ').toLowerCase();

  if (emo < 0.25 && cog < 0.25) return 'neutral';
  if (/die|death|kill|danger|threat|virus|attack|crash/.test(evidence)) return 'fear';
  if (/outrage|furious|scandal|disgust|betray|horrib|shock/.test(evidence)) return 'outrage';
  if (/now|immediately|urgent|limited time|last chance|breaking|alert/.test(evidence)) return 'urgency';
  if (/100%|proven|guaranteed|everyone knows|obviously|undeniably|fact/.test(evidence)) return 'certainty';
  if (emo > cog) return 'outrage';
  return 'urgency';
}

export function buildReactionPayload(text, score) {
  const excerpt = (text || '').trim().slice(0, MAX_EXCERPT);
  const affect = pickAffect(score);
  return {
    t: excerpt,
    e: +(score.emotionalActivation || 0).toFixed(3),
    c: +(score.cognitiveSuppression || 0).toFixed(3),
    m: +(score.manipulationPressure || 0).toFixed(3),
    u: +(score.trustErosion || 0).toFixed(3),
    a: affect,
    ts: Date.now(),
  };
}

function b64urlEncode(str) {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Edge / Node fallback
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return window.atob(base);
  }
  return Buffer.from(base, 'base64').toString('utf-8');
}

export function encodeReaction(payload) {
  try {
    return b64urlEncode(JSON.stringify(payload));
  } catch {
    return '';
  }
}

export function decodeReaction(hash) {
  try {
    const json = b64urlDecode(hash);
    const p = JSON.parse(json);
    if (!p || typeof p !== 'object') return null;
    return {
      text: p.t || '',
      emotionalActivation: p.e || 0,
      cognitiveSuppression: p.c || 0,
      manipulationPressure: p.m || 0,
      trustErosion: p.u || 0,
      affect: p.a || 'neutral',
      ts: p.ts || 0,
    };
  } catch {
    return null;
  }
}

export function reactionUrl(origin, payload) {
  const hash = encodeReaction(payload);
  return `${origin}/r/${hash}`;
}
