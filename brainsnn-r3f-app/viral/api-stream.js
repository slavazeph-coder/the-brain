/**
 * Layer 76 — Streaming Scoring (Server-Sent Events)
 *
 * POST body: { text: string }
 * Response: text/event-stream — incremental events as the scorer
 * chunks through the text.
 *
 * event: dim   data: {"dim":"emotionalActivation","value":0.31}
 * event: tpl   data: {"id":"gaslighting","hits":2}
 * event: final data: { ...fullScore }
 *
 * This is a thin demo wrapper that exercises the same Firewall logic
 * chunk-by-chunk. Intended for devs who want to wire a live UI to the
 * score as it computes — e.g. showing bars grow one dimension at a time.
 */

import { createHash } from 'node:crypto';

// Minimal English-only rule set (mirrors api-score.js defaults)
const RULES = {
  urgency: [
    /\bnow\b|\bimmediately\b|\burgent\b|\bbreaking\b|\balert\b/gi,
    /\blimited time\b|\bdon't miss\b|\blast chance\b|\bact(?:s)? fast\b/gi,
    /!{2,}|\bWARNING\b|\bCRISIS\b|\bSHOCKING\b/gi,
  ],
  outrage: [
    /\boutrage\b|\bfurious\b|\bscandal\b|\bterrible\b|\bhorrible\b/gi,
    /\bunbelievable\b|\bdisgusting\b|\bshocking\b|\bbetray/gi,
    /\bthey don't want you to know\b|\bhidden\b|\bsecret\b|\bcovered up\b/gi,
  ],
  certainty: [
    /\b100%\b|\bproven\b|\bguaranteed\b|\bscientifically proven\b|\bfact\b/gi,
    /\beveryone knows\b|\bobviously\b|\bclearly\b|\bundeniably\b/gi,
  ],
  fear: [
    /\bdie\b|\bdeath\b|\bkill\b|\bdanger\b|\bthreat\b|\bsafe\b|\bunsafe\b/gi,
    /\bvirus\b|\bpandemic\b|\battack\b|\bwar\b|\bcrash\b|\bcollapse\b/gi,
  ],
};

function clamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
function normalize(c, base = 3) { return clamp(c / base); }
function countMatches(text, patterns) {
  return patterns.reduce((t, re) => t + ((text.match(re) || []).length), 0);
}

function scoreFull(text) {
  const u = countMatches(text, RULES.urgency);
  const o = countMatches(text, RULES.outrage);
  const c = countMatches(text, RULES.certainty);
  const f = countMatches(text, RULES.fear);
  const emotionalActivation = clamp(normalize(f + o, 4) * 0.85);
  const cognitiveSuppression = clamp(normalize(u + c, 4) * 0.80);
  const manipulationPressure = clamp(emotionalActivation * 0.55 + cognitiveSuppression * 0.45);
  const trustErosion = clamp(normalize(o + c, 5) * 0.78);
  return {
    emotionalActivation: +emotionalActivation.toFixed(3),
    cognitiveSuppression: +cognitiveSuppression.toFixed(3),
    manipulationPressure: +manipulationPressure.toFixed(3),
    trustErosion: +trustErosion.toFixed(3),
  };
}

const TEMPLATE_PATTERNS = {
  gaslighting: /\byou\'?re imagining\b|\bthat never happened\b|\byou always (?:twist|exaggerate)\b/i,
  darvo: /\byou are the (?:real )?victim\b|\bhow dare you accuse\b/i,
  scarcity: /\blast chance\b|\blimited (?:time|supply)\b|\bonly \d+ (?:left|remaining|spots)\b/i,
  authority: /\bexperts? (?:agree|say)\b|\bscientifically proven\b/i,
  'fear-appeal': /\bif you don\'?t act now\b|\bfamily is at (?:risk|stake)\b|\bcatastrophic consequences\b/i,
  'hidden-truth': /\bthey don\'?t want you to know\b|\bwake up\b/i,
};

function detectTemplates(text) {
  const out = [];
  for (const [id, re] of Object.entries(TEMPLATE_PATTERNS)) {
    const m = text.match(re);
    if (m) out.push({ id, hits: m.length || 1 });
  }
  return out;
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const mem = { rate: new Map() };
const WINDOW = 60 * 1000;
const LIMIT = 20;
function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
function rateLimited(key) {
  const bucket = Math.floor(Date.now() / WINDOW);
  const k = `${key}:${bucket}`;
  const n = (mem.rate.get(k) || 0) + 1;
  mem.rate.set(k, n);
  if (mem.rate.size > 2000) {
    for (const rk of mem.rate.keys()) if (!rk.endsWith(`:${bucket}`)) mem.rate.delete(rk);
  }
  return n > LIMIT;
}

export async function handleScoreStream(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (rateLimited(`stream:${clientIp(req)}`)) {
    res.status(429).json({ error: 'rate limited: 20 req/min' });
    return;
  }
  const body = req.body || {};
  const text = String(body.text || '').slice(0, 6000);
  if (text.trim().length < 5) {
    res.status(400).json({ error: 'text must be >= 5 chars' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  const full = scoreFull(text);

  // Emit each dimension sequentially with a tiny stagger so the
  // client can animate bars growing one-by-one.
  const DIMS = ['emotionalActivation', 'cognitiveSuppression', 'manipulationPressure', 'trustErosion'];
  for (const d of DIMS) {
    sseWrite(res, 'dim', { dim: d, value: full[d] });
    await new Promise((r) => setTimeout(r, 120));
  }

  const tpls = detectTemplates(text);
  for (const t of tpls) {
    sseWrite(res, 'tpl', t);
    await new Promise((r) => setTimeout(r, 80));
  }

  const pressure = +(((full.emotionalActivation + full.cognitiveSuppression + full.manipulationPressure) / 3)).toFixed(3);
  const bucket = Math.floor(Date.now() / 86400000);
  const canonical = `brainsnn/v1|${bucket}|e=${Math.round(full.emotionalActivation * 1000)}|c=${Math.round(full.cognitiveSuppression * 1000)}|m=${Math.round(full.manipulationPressure * 1000)}|txt=${text.slice(0, 200).toLowerCase()}`;
  const hex = createHash('sha256').update(canonical).digest('hex');
  const receipt = `R-${bucket.toString(36).toUpperCase().padStart(4, '0').slice(-4)}${hex.slice(0, 4).toUpperCase()}-${hex.slice(4, 8).toUpperCase()}`;

  sseWrite(res, 'final', {
    ...full,
    pressure,
    templates: tpls,
    receipt,
    text: text.slice(0, 200),
  });
  res.write('event: done\ndata: {}\n\n');
  res.end();
}
