/**
 * Layer 42 — Counter-Draft Mode
 *
 * Rewrite manipulative text into a neutral version. Two paths:
 *
 *  1) Local (always on): regex substitution + sentence dampening
 *     — urgency words → neutral synonyms, absolutist claims softened,
 *       loaded hooks dropped. Good enough for headlines, captions,
 *       short ad copy.
 *
 *  2) Gemma (when VITE_GEMMA_API_ENDPOINT is set): asks the model for
 *     a single neutral rewrite with the same information content.
 *     Produces better long-form rewrites. Falls back to local on any
 *     API error.
 */

import { scoreContent } from './cognitiveFirewall';

// ---------- local rewrite ------------------------------------------------

const SUBSTITUTIONS = [
  // urgency softeners
  [/\bURGENT:?\b/gi, ''],
  [/\bBREAKING:?\b/gi, ''],
  [/\bWARNING:?\b/gi, 'Note:'],
  [/\bSHOCKING\b/gi, 'notable'],
  [/\bCRISIS\b/gi, 'situation'],
  [/\bnow\b(?!\s+and\s+then)/gi, 'soon'],
  [/\bimmediately\b/gi, 'when convenient'],
  [/\burgent(ly)?\b/gi, 'time-sensitive'],
  [/\bact fast\b/gi, 'consider this'],
  [/\blast chance\b/gi, 'an option'],
  [/\bdon'?t miss\b/gi, 'you may want to see'],
  [/\blimited time\b/gi, 'for now'],

  // outrage softeners
  [/\boutrage\b/gi, 'disagreement'],
  [/\bfurious\b/gi, 'frustrated'],
  [/\bscandal\b/gi, 'incident'],
  [/\bhorrible\b/gi, 'disappointing'],
  [/\bdisgusting\b/gi, 'unsettling'],
  [/\bterrible\b/gi, 'poor'],
  [/\bunbelievable\b/gi, 'notable'],
  [/\bbetray(al|ed|ing)?\b/gi, 'disappointment'],
  [/\bthey don'?t want you to know\b/gi, 'a less-discussed point:'],
  [/\bcovered up\b/gi, 'under-reported'],

  // certainty theater
  [/\b100%\b/gi, 'broadly'],
  [/\bguaranteed\b/gi, 'likely'],
  [/\bproven\b/gi, 'reported'],
  [/\bscientifically proven\b/gi, 'supported by some research'],
  [/\beveryone knows\b/gi, 'some argue'],
  [/\bobviously\b/gi, 'arguably'],
  [/\bclearly\b/gi, 'arguably'],
  [/\bundeniably\b/gi, 'often'],

  // fear softeners
  [/\bdeadly\b/gi, 'serious'],
  [/\bcollapse\b/gi, 'disruption'],
  [/\bthreat\b/gi, 'risk'],
  [/\bcatastroph(ic|e)\b/gi, 'significant'],
  [/\bdevastating\b/gi, 'substantial'],

  // exclamation stacks + caps lock tirades
  [/!{2,}/g, '.'],
  [/([A-Z]{4,})\b/g, (m) => m.charAt(0) + m.slice(1).toLowerCase()],
];

export function localCounterDraft(text = '') {
  let out = text || '';
  for (const [pat, rep] of SUBSTITUTIONS) {
    out = out.replace(pat, rep);
  }
  // Collapse leftover double spaces and stray leading punctuation
  out = out.replace(/\s{2,}/g, ' ').replace(/^\s*[:—,]\s*/, '').trim();
  return out;
}

// ---------- Gemma-backed rewrite -----------------------------------------

function buildPrompt(text) {
  return [
    'Rewrite the following text so it conveys the same factual information',
    'without manipulation signatures: no urgency theatre, no absolutist claims,',
    'no outrage priming, no fear appeals, no loaded framings. Keep it concise.',
    'Return ONLY the rewritten text — no preface, no explanation.',
    '',
    '---',
    text,
    '---',
  ].join('\n');
}

async function rewriteViaGemma(text) {
  const endpoint = import.meta.env?.VITE_GEMMA_API_ENDPOINT;
  const apiKey = import.meta.env?.VITE_GEMMA_API_KEY;
  if (!endpoint) throw new Error('no_gemma');

  const isGoogleStyle = /generativelanguage\.googleapis\.com/.test(endpoint);
  const body = isGoogleStyle
    ? { contents: [{ parts: [{ text: buildPrompt(text) }] }] }
    : {
        messages: [
          { role: 'system', content: 'You rewrite text to strip manipulation signatures while preserving facts.' },
          { role: 'user', content: buildPrompt(text) },
        ],
        temperature: 0.2,
        max_tokens: 600,
      };

  const url = isGoogleStyle && apiKey ? `${endpoint}?key=${apiKey}` : endpoint;
  const headers = { 'Content-Type': 'application/json' };
  if (!isGoogleStyle && apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`gemma_${r.status}`);
  const data = await r.json();

  const textOut =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.choices?.[0]?.message?.content ||
    '';
  return (textOut || '').trim().replace(/^"+|"+$/g, '');
}

// ---------- public API ---------------------------------------------------

/**
 * Produce a neutralized rewrite + before/after Firewall scores.
 * Always resolves (never throws) — returns engine: 'local' | 'gemma'.
 */
export async function counterDraft(text = '') {
  const input = (text || '').trim();
  if (!input) {
    return { ok: false, error: 'empty_input' };
  }

  const beforeScore = scoreContent(input);
  const beforePressure =
    (beforeScore.emotionalActivation + beforeScore.cognitiveSuppression + beforeScore.manipulationPressure) / 3;

  let output = localCounterDraft(input);
  let engine = 'local';
  try {
    const gemma = await rewriteViaGemma(input);
    if (gemma && gemma.length >= 10) {
      output = gemma;
      engine = 'gemma';
    }
  } catch {
    // keep local rewrite
  }

  const afterScore = scoreContent(output);
  const afterPressure =
    (afterScore.emotionalActivation + afterScore.cognitiveSuppression + afterScore.manipulationPressure) / 3;

  return {
    ok: true,
    engine,
    before: input,
    after: output,
    beforePressure,
    afterPressure,
    reduction: Math.max(0, beforePressure - afterPressure),
  };
}

/**
 * Shareable /x/<hash> payload — keep it small (trim to first 200 chars
 * on each side so the URL stays under ~1KB).
 */
function b64urlEncode(str) {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
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

export function buildCounterDraftPayload({ before, after, beforePressure, afterPressure, engine }) {
  return {
    b: String(before || '').slice(0, 240),
    a: String(after || '').slice(0, 240),
    bp: +(beforePressure || 0).toFixed(3),
    ap: +(afterPressure || 0).toFixed(3),
    e: engine || 'local',
    ts: Date.now(),
  };
}

export function encodeCounterDraft(p) {
  try { return b64urlEncode(JSON.stringify(p)); } catch { return ''; }
}

export function decodeCounterDraft(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      before: p.b || '',
      after: p.a || '',
      beforePressure: p.bp || 0,
      afterPressure: p.ap || 0,
      engine: p.e || 'local',
      ts: p.ts || 0,
    };
  } catch { return null; }
}

export function counterDraftUrl(origin, payload) {
  return `${origin}/x/${encodeCounterDraft(payload)}`;
}
