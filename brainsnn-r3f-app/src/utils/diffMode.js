/**
 * Layer 47 — Diff Mode
 *
 * Put two pieces of text side-by-side through the Firewall and show
 * the delta. Useful for: candidate A vs candidate B statements,
 * pre/post-edit of your own writing, "quoted" vs "summary" framings.
 *
 * Produces a compact share payload so the /v/<hash> card travels.
 */

import { scoreContent } from './cognitiveFirewall';

function pressureOf(score) {
  return (score.emotionalActivation + score.cognitiveSuppression + score.manipulationPressure) / 3;
}

export function runDiff({ labelA = 'A', labelB = 'B', textA = '', textB = '' }) {
  const sa = scoreContent(textA);
  const sb = scoreContent(textB);
  const pa = pressureOf(sa);
  const pb = pressureOf(sb);
  const delta = pa - pb;
  const winner = pa < pb ? 'A' : pb < pa ? 'B' : null; // lower pressure "wins" (cleaner)
  return {
    a: { label: String(labelA || 'A').slice(0, 24), text: textA, score: sa, pressure: pa, templates: sa.templates || [] },
    b: { label: String(labelB || 'B').slice(0, 24), text: textB, score: sb, pressure: pb, templates: sb.templates || [] },
    delta,
    absDelta: Math.abs(delta),
    winner,
  };
}

export function diffVerdict(absDelta) {
  if (absDelta < 0.05) return { label: 'Tied', color: '#77dbe4' };
  if (absDelta < 0.15) return { label: 'Edge', color: '#fdab43' };
  if (absDelta < 0.30) return { label: 'Clear', color: '#e57b40' };
  return { label: 'Landslide', color: '#dd6974' };
}

// ---------- share (Layer 47 /v/<hash>) ----------

function b64urlEncode(str) {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(str, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof window !== 'undefined' && typeof window.atob === 'function') return window.atob(base);
  return Buffer.from(base, 'base64').toString('utf-8');
}

export function buildDiffPayload(diff) {
  return {
    al: diff.a.label.slice(0, 24),
    at: diff.a.text.slice(0, 180),
    ap: +(diff.a.pressure).toFixed(3),
    bl: diff.b.label.slice(0, 24),
    bt: diff.b.text.slice(0, 180),
    bp: +(diff.b.pressure).toFixed(3),
    w: diff.winner || '',
    ts: Date.now(),
  };
}
export function encodeDiff(p) { try { return b64urlEncode(JSON.stringify(p)); } catch { return ''; } }
export function decodeDiff(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      aLabel: p.al || 'A', aText: p.at || '', aPressure: p.ap || 0,
      bLabel: p.bl || 'B', bText: p.bt || '', bPressure: p.bp || 0,
      winner: p.w || null,
      ts: p.ts || 0,
    };
  } catch { return null; }
}
export function diffUrl(origin, payload) { return `${origin}/v/${encodeDiff(payload)}`; }

export const DIFF_EXAMPLE = {
  labelA: 'Candidate A',
  textA: 'We face real challenges. I will work with anyone who shows up with a plan, not a slogan.',
  labelB: 'Candidate B',
  textB: 'If you are not FURIOUS, you are asleep! They betrayed us! Only I can fix this — act NOW before it is too late!',
};
