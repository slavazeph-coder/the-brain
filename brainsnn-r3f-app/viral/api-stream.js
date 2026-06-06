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

import { createHash } from "node:crypto";

// Minimal English-only rule set (mirrors api-score.js RULES_EN — keep in sync).
const RULES = {
  urgency: [
    /\bnow\b|\bimmediat(?:e|ely)\b|\burgent(?:ly)?\b|\bbreaking\b|\balert\b|\basap\b|\bright away\b/gi,
    /\blimited[- ]time\b|\bdon'?t miss\b|\blast chance\b|\bact(?:s|ing)? (?:now|fast)\b|\bhurry\b|\bbefore it'?s too late\b/gi,
    /!{2,}|\bWARNING\b|\bCRISIS\b|\bSHOCKING\b|\bfinal notice\b|\bexpir(?:es?|ing|ation)\b|\bdeadline\b|\bwithin (?:the |\d+ ?)?(?:hour|hours|minute|minutes|days?)\b|\btime[- ]sensitive\b/gi,
  ],
  outrage: [
    /\boutrage(?:d|ous)?\b|\bfurious\b|\bscandal(?:ous)?\b|\bterrible\b|\bhorrible\b|\bdisgrace(?:ful)?\b/gi,
    /\bunbelievable\b|\bdisgusting\b|\bshocking\b|\bbetray(?:al|ed|s)?\b|\bcorrupt(?:ion)?\b/gi,
    /\bthey don'?t want you to (?:know|see)\b|\bhidden\b|\bsecret\b|\bcover(?:ed)?[- ]?up\b|\bexposed?\b/gi,
  ],
  certainty: [
    /\b100%\b|\bproven\b|\bguarantee(?:d)?\b|\bscientifically proven\b|\bfact\b|\bno doubt\b/gi,
    /\beveryone knows\b|\bobviously\b|\bclearly\b|\bundeniabl[ey]\b|\bnobody can deny\b|\bthe truth is\b/gi,
  ],
  fear: [
    /\bdie\b|\bdeath\b|\bkill(?:ed|s)?\b|\bdanger(?:ous)?\b|\bthreat(?:en(?:ed|ing)?|s)?\b|\bunsafe\b|\bat risk\b/gi,
    /\bvirus\b|\bpandemic\b|\battack(?:ed|s)?\b|\bwar\b|\bcrash\b|\bcollapse\b|\bdisaster\b|\bemergency\b/gi,
    /\blose (?:access|your|everything)\b|\bcompromis(?:e|ed)\b|\bbreach(?:ed)?\b|\bpenalt(?:y|ies)\b|\bconsequences\b/gi,
  ],
  coercion: [
    /\bverify your (?:identity|account|details|information|payment)\b|\bconfirm your (?:account|identity|password|details|payment|information)\b/gi,
    /\bclick (?:here|below|this link|the link|now)\b|\blog ?in to (?:verify|secure|confirm|restore|unlock)\b|\bupdate your (?:payment|billing|account|details|information|password)\b/gi,
    /\bunauthor(?:i[sz]ed) (?:login|access|transaction|activity|sign[- ]?in)\b|\bsuspicious (?:login|activity|sign[- ]?in|transaction)\b|\baccount(?:\s+\w+){0,3}\s+(?:suspended|terminated|locked|disabled|deactivated|compromised|limited|closed)\b/gi,
    /\bfailure to (?:comply|respond|verify|act|pay)\b|\byou must\b|\brequired to\b|\b(?:immediate )?action (?:required|needed|requested)\b|\bdo not (?:ignore|delay|share)\b|\bofficial (?:notice|notification|warning)\b|\bgift card\b|\bwire transfer\b|\bsocial security (?:number)?\b/gi,
  ],
};

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}
function normalize(c, base = 3) {
  return clamp(c / base);
}
function countMatches(text, patterns) {
  return patterns.reduce((t, re) => t + (text.match(re) || []).length, 0);
}

function scoreFull(text) {
  const u = countMatches(text, RULES.urgency);
  const o = countMatches(text, RULES.outrage);
  const c = countMatches(text, RULES.certainty);
  const f = countMatches(text, RULES.fear);
  const x = countMatches(text, RULES.coercion || []);
  const emotionalActivation = clamp(normalize(f + o + x * 0.4, 4) * 0.85);
  const cognitiveSuppression = clamp(normalize(u + c, 4) * 0.8);
  const trustErosion = clamp(normalize(o + c + x, 5) * 0.82);
  const manipulationPressure = clamp(
    emotionalActivation * 0.4 +
      cognitiveSuppression * 0.3 +
      normalize(x, 6) * 0.55,
  );
  return {
    emotionalActivation: +emotionalActivation.toFixed(3),
    cognitiveSuppression: +cognitiveSuppression.toFixed(3),
    manipulationPressure: +manipulationPressure.toFixed(3),
    trustErosion: +trustErosion.toFixed(3),
  };
}

const TEMPLATE_PATTERNS = {
  gaslighting:
    /\byou\'?re imagining\b|\bthat never happened\b|\byou always (?:twist|exaggerate)\b/i,
  darvo: /\byou are the (?:real )?victim\b|\bhow dare you accuse\b/i,
  scarcity:
    /\blast chance\b|\blimited (?:time|supply)\b|\bonly \d+ (?:left|remaining|spots)\b/i,
  authority: /\bexperts? (?:agree|say)\b|\bscientifically proven\b/i,
  "fear-appeal":
    /\bif you don\'?t act now\b|\bfamily is at (?:risk|stake)\b|\bcatastrophic consequences\b/i,
  "hidden-truth": /\bthey don\'?t want you to know\b|\bwake up\b/i,
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
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}
function rateLimited(key) {
  const bucket = Math.floor(Date.now() / WINDOW);
  const k = `${key}:${bucket}`;
  const n = (mem.rate.get(k) || 0) + 1;
  mem.rate.set(k, n);
  if (mem.rate.size > 2000) {
    for (const rk of mem.rate.keys())
      if (!rk.endsWith(`:${bucket}`)) mem.rate.delete(rk);
  }
  return n > LIMIT;
}

export async function handleScoreStream(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (rateLimited(`stream:${clientIp(req)}`)) {
    res.status(429).json({ error: "rate limited: 20 req/min" });
    return;
  }
  const body = req.body || {};
  const text = String(body.text || "").slice(0, 6000);
  if (text.trim().length < 5) {
    res.status(400).json({ error: "text must be >= 5 chars" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();

  const full = scoreFull(text);

  // Emit each dimension sequentially with a tiny stagger so the
  // client can animate bars growing one-by-one.
  const DIMS = [
    "emotionalActivation",
    "cognitiveSuppression",
    "manipulationPressure",
    "trustErosion",
  ];
  for (const d of DIMS) {
    sseWrite(res, "dim", { dim: d, value: full[d] });
    await new Promise((r) => setTimeout(r, 120));
  }

  const tpls = detectTemplates(text);
  for (const t of tpls) {
    sseWrite(res, "tpl", t);
    await new Promise((r) => setTimeout(r, 80));
  }

  const pressure = +(
    (full.emotionalActivation +
      full.cognitiveSuppression +
      full.manipulationPressure) /
    3
  ).toFixed(3);
  const bucket = Math.floor(Date.now() / 86400000);
  const canonical = `brainsnn/v1|${bucket}|e=${Math.round(full.emotionalActivation * 1000)}|c=${Math.round(full.cognitiveSuppression * 1000)}|m=${Math.round(full.manipulationPressure * 1000)}|txt=${text.slice(0, 200).toLowerCase()}`;
  const hex = createHash("sha256").update(canonical).digest("hex");
  const receipt = `R-${bucket.toString(36).toUpperCase().padStart(4, "0").slice(-4)}${hex.slice(0, 4).toUpperCase()}-${hex.slice(4, 8).toUpperCase()}`;

  sseWrite(res, "final", {
    ...full,
    pressure,
    templates: tpls,
    receipt,
    text: text.slice(0, 200),
  });
  res.write("event: done\ndata: {}\n\n");
  res.end();
}
