/**
 * Layer 54 — Public Scoring API
 *
 * POST /api/score
 *   body: { text: string, lang?: string }
 *   header: x-api-key (optional if PUBLIC_API_DEMO is unset; required otherwise)
 *   → 200 { text, pressure, emotionalActivation, cognitiveSuppression,
 *           manipulationPressure, trustErosion, templates, language,
 *           engine: 'regex', receipt: string }
 *
 * Rate-limit: 20 requests per minute per IP (in-memory fallback when
 * Upstash isn't configured).
 *
 * Keep the surface small + dependency-free so any Node host can run it.
 * The client-side Firewall covers the whole cognitive ladder; this
 * endpoint is a minimal contract for partners.
 */

import { createHash } from "node:crypto";

// ---------- server-side Firewall (mirrors src/utils/cognitiveFirewall DEFAULT_RULES) ----------

// Mirrors src/utils/cognitiveFirewall.js DEFAULT_RULES — keep the two in sync.
// (src/utils/firewall-parity.test.js guards against drift.)
const RULES_EN = {
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

const RULES_ES = {
  urgency: [
    /\bahora\b|\binmediatamente\b|\burgente\b|\bya\b|\balerta\b/gi,
    /\búltima oportunidad\b|\bno (?:te )?pierdas\b|\btiempo limitado\b|\bactúa (?:ya|rápido)\b/gi,
    /!{2,}|\bAVISO\b|\bCRISIS\b|\bIMPACTANTE\b/gi,
  ],
  outrage: [
    /\bindigna(?:ción|nte)\b|\bfurioso\b|\besc[áa]ndalo\b|\bterrible\b|\bhorrible\b/gi,
    /\bincreíble\b|\basqueroso\b|\bimpactante\b|\btraición\b/gi,
    /\bno quieren que sepas\b|\boculto\b|\bsecreto\b|\bencubri(?:eron|do)\b/gi,
  ],
  certainty: [
    /\b100%\b|\bprobado\b|\bgarantizado\b|\bcientíficamente probado\b|\bhecho\b/gi,
    /\btodo el mundo sabe\b|\bobviamente\b|\bclaramente\b|\bsin duda\b/gi,
  ],
  fear: [
    /\bmuerte\b|\bmorir\b|\bmatar\b|\bpeligro\b|\bamenaza\b|\binseguro\b/gi,
    /\bvirus\b|\bpandemia\b|\bataque\b|\bguerra\b|\bcolapso\b/gi,
  ],
};

const RULES_FR = {
  urgency: [
    /\bmaintenant\b|\bimmédiatement\b|\burgent(?:e|es)?\b|\balerte\b/gi,
    /\bdernière chance\b|\bne (?:pas )?rater\b|\btemps limité\b|\bagis(?:sez)? vite\b/gi,
    /!{2,}|\bATTENTION\b|\bCRISE\b|\bCHOC\b/gi,
  ],
  outrage: [
    /\bindign(?:ation|é)\b|\bfurieux\b|\bscandale\b|\bterrible\b|\bhorrible\b/gi,
    /\bincroyable\b|\bdég[oo]utant\b|\bchoquant\b|\btrahison\b/gi,
    /\bils ne veulent pas que vous sachiez\b|\bcaché\b|\bsecret\b|\bétouff(?:é|er)\b/gi,
  ],
  certainty: [
    /\b100%\b|\bprouvé\b|\bgaranti\b|\bscientifiquement prouvé\b|\bfait\b/gi,
    /\btout le monde sait\b|\bévidemment\b|\bclairement\b|\bsans aucun doute\b/gi,
  ],
  fear: [
    /\bmort\b|\bmourir\b|\btuer\b|\bdanger\b|\bmenace\b|\brisqué\b/gi,
    /\bvirus\b|\bpandémie\b|\battaque\b|\bguerre\b|\beffondrement\b/gi,
  ],
};

const PACKS = { en: RULES_EN, es: RULES_ES, fr: RULES_FR };

function detectLanguage(text) {
  const t = (text || "").toLowerCase();
  if (t.length < 15) return "en";
  const esAccents = (t.match(/[ñáéíóúü]/g) || []).length;
  const frAccents = (t.match(/[àâçéèêëîïôùûüÿ]/g) || []).length;
  const esWords = (
    t.match(
      /\b(que|los|las|del|por|para|pero|muy|también|donde|actúa|todo el mundo|escándalo|encubri|impactante)\b/g,
    ) || []
  ).length;
  const frWords = (
    t.match(
      /\b(que|les|des|pour|avec|dans|aussi|très|mais|tout le monde|maintenant|agissez|sait|étouff|choquant|scandale)\b/g,
    ) || []
  ).length;
  const esScore = esWords * 2 + esAccents;
  const frScore = frWords * 2 + frAccents;
  if (esScore > 3 && esScore > frScore * 1.3) return "es";
  if (frScore > 3 && frScore > esScore * 1.3) return "fr";
  return "en";
}

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}
function normalize(c, base = 3) {
  return clamp(c / base);
}

function countMatches(text, patterns) {
  return patterns.reduce((t, re) => {
    const m = text.match(re);
    return t + (m ? m.length : 0);
  }, 0);
}

function scoreWithRules(text, rules) {
  const words = text.trim().split(/\s+/).length;
  if (words < 5) {
    return {
      emotionalActivation: 0,
      cognitiveSuppression: 0,
      manipulationPressure: 0,
      trustErosion: 0,
      evidence: [],
      confidence: "low",
      recommendedAction: "Too short to score.",
    };
  }
  const u = countMatches(text, rules.urgency);
  const o = countMatches(text, rules.outrage);
  const c = countMatches(text, rules.certainty);
  const f = countMatches(text, rules.fear);
  const x = countMatches(text, rules.coercion || []);
  const emotionalActivation = clamp(normalize(f + o + x * 0.4, 4) * 0.85);
  const cognitiveSuppression = clamp(normalize(u + c, 4) * 0.8);
  const trustErosion = clamp(normalize(o + c + x, 5) * 0.82);
  const manipulationPressure = clamp(
    emotionalActivation * 0.4 +
      cognitiveSuppression * 0.3 +
      normalize(x, 6) * 0.55,
  );
  const evidence = [];
  for (const cat of Object.values(rules)) {
    for (const re of cat) {
      const m = text.match(re);
      if (m) m.forEach((hit) => evidence.push(hit.toLowerCase()));
    }
  }
  const overall =
    (emotionalActivation + cognitiveSuppression + manipulationPressure) / 3;
  const confidence = words > 80 ? "high" : words > 30 ? "medium" : "low";
  // Verdict tracks the worst credible signal so a trust attack (high trust
  // erosion / manipulation, modest emotional load) still reads high-risk.
  const risk = Math.max(
    overall,
    manipulationPressure * 0.95,
    trustErosion * 0.9,
  );
  const recommendedAction =
    risk > 0.6
      ? "High manipulation-signature density — pause before sharing or reacting."
      : risk > 0.33
        ? "Moderate pressure cues detected — verify sources before acting."
        : "Low manipulation indicators — content appears relatively low-risk.";
  return {
    emotionalActivation: +emotionalActivation.toFixed(3),
    cognitiveSuppression: +cognitiveSuppression.toFixed(3),
    manipulationPressure: +manipulationPressure.toFixed(3),
    trustErosion: +trustErosion.toFixed(3),
    evidence: [...new Set(evidence)].slice(0, 12),
    confidence,
    recommendedAction,
  };
}

// Simple server-side propaganda template detection (15 keys)
const TEMPLATE_PATTERNS = {
  gaslighting:
    /\byou\'?re imagining\b|\bthat never happened\b|\byou always (?:twist|exaggerate)\b/i,
  darvo:
    /\byou are the (?:real )?victim\b|\bi\'?m the victim here\b|\bhow dare you accuse\b/i,
  "love-bombing":
    /\bmost (?:amazing|incredible)\b|\bsoul ?mates\b|\bmade for each other\b/i,
  scarcity:
    /\blast chance\b|\blimited (?:time|supply)\b|\bonly \d+ (?:left|remaining|spots)\b/i,
  "social-proof":
    /\beveryone is (?:switching|using)\b|\b(?:thousands|millions) of (?:people|users)\b|\b9 out of 10\b/i,
  authority:
    /\bexperts? (?:agree|say)\b|\bscientifically proven\b|\baccording to (?:top|leading) experts?\b/i,
  "loaded-question":
    /\bwhy do you (?:keep|always) (?:lie|hide|deny)\b|\bwhen did you stop\b/i,
  "straw-man":
    /\bso (?:you\'?re saying|your argument is) that we should\b|\boh so (?:now )?nobody\b/i,
  whataboutism: /\bwhat about (?:when|the time|all the times)\b/i,
  "false-dichotomy":
    /\beither .* or\b|\bonly two (?:choices|options)\b|\bthere is no middle\b/i,
  "fear-appeal":
    /\bif you don\'?t act now\b|\bfamily is at (?:risk|stake)\b|\bcatastrophic consequences\b/i,
  "hidden-truth":
    /\bthey don\'?t want you to know\b|\bthe truth is being hidden\b|\bwake up\b/i,
  "moral-outrage":
    /\bif you\'?re not (?:furious|outraged)\b|\bsilence is (?:violence|complicity)\b/i,
  "purity-test":
    /\breal (?:allies|patriots|leftists|conservatives) (?:would|don\'?t)\b/i,
  "guilt-trip":
    /\bafter (?:all|everything) (?:i|we)\'?ve done\b|\byou\'?re (?:selfish|ungrateful)\b/i,
};

function detectTemplates(text) {
  const out = [];
  for (const [id, re] of Object.entries(TEMPLATE_PATTERNS)) {
    const m = text.match(re);
    if (m) out.push({ id, hits: m.length || 1 });
  }
  return out.sort((a, b) => b.hits - a.hits);
}

// ---------- receipt ----------

function receipt(text, score) {
  const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const norm = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 4000);
  const canonical = `brainsnn/v1|${bucket}|e=${Math.round((score.emotionalActivation || 0) * 1000)}|c=${Math.round((score.cognitiveSuppression || 0) * 1000)}|m=${Math.round((score.manipulationPressure || 0) * 1000)}|u=${Math.round((score.trustErosion || 0) * 1000)}|txt=${norm}`;
  const hex = createHash("sha256").update(canonical).digest("hex");
  const day = bucket.toString(36).toUpperCase().padStart(4, "0").slice(-4);
  return `R-${day}${hex.slice(0, 4).toUpperCase()}-${hex.slice(4, 8).toUpperCase()}`;
}

// ---------- rate limit (in-memory; Upstash-friendly if env set) ----------

const mem = { rate: new Map() };
const WINDOW = 60 * 1000;
const LIMIT = 20;

async function rateLimited(key) {
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

function clientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// ---------- handler ----------

const DEMO_KEYS = new Set(
  (process.env.BRAINSNN_PUBLIC_API_KEYS || "demo-public-launch-key")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Single server-side scoring entry point — mirrors the client scoreContent().
// Exported so src/utils/firewall-parity.test.js can assert the two never drift.
export function scoreServer(text) {
  const lang = detectLanguage(text);
  return scoreWithRules(text, PACKS[lang] || PACKS.en);
}

export async function handleScore(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const provided = req.headers["x-api-key"];
  if (process.env.BRAINSNN_PUBLIC_API_KEYS && !DEMO_KEYS.has(provided)) {
    res.status(401).json({ error: "invalid or missing x-api-key" });
    return;
  }

  const ip = clientIp(req);
  if (await rateLimited(`score:${ip}`)) {
    res.status(429).json({ error: "rate limited: 20 req/min" });
    return;
  }

  const body = req.body || {};
  const text = String(body.text || "").slice(0, 6000);
  if (text.trim().length < 5) {
    res.status(400).json({ error: "text must be >= 5 chars" });
    return;
  }

  const lang = body.lang && PACKS[body.lang] ? body.lang : detectLanguage(text);
  const rules = PACKS[lang] || PACKS.en;
  const score = scoreWithRules(text, rules);
  const templates = detectTemplates(text);
  const r = receipt(text, score);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    text,
    pressure: +(
      (score.emotionalActivation +
        score.cognitiveSuppression +
        score.manipulationPressure) /
      3
    ).toFixed(3),
    emotionalActivation: score.emotionalActivation,
    cognitiveSuppression: score.cognitiveSuppression,
    manipulationPressure: score.manipulationPressure,
    trustErosion: score.trustErosion,
    evidence: score.evidence,
    templates,
    language: lang,
    confidence: score.confidence,
    recommendedAction: score.recommendedAction,
    receipt: r,
    engine: "regex-v1",
  });
}

export function handleOpenApi(_req, res) {
  res.setHeader("Content-Type", "application/json");
  res.json({
    openapi: "3.0.0",
    info: {
      title: "BrainSNN Scoring API",
      version: "1.0.0",
      description: "Public scoring endpoint for Cognitive Firewall.",
    },
    servers: [{ url: "https://brainsnn.com" }],
    paths: {
      "/api/score": {
        post: {
          summary: "Score content against the Cognitive Firewall",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["text"],
                  properties: {
                    text: { type: "string", maxLength: 6000 },
                    lang: { type: "string", enum: ["en", "es", "fr"] },
                  },
                },
              },
            },
          },
          parameters: [
            {
              name: "x-api-key",
              in: "header",
              schema: { type: "string" },
              description:
                "Optional; required when BRAINSNN_PUBLIC_API_KEYS is set.",
            },
          ],
          responses: {
            200: { description: "Scored result with receipt." },
            401: { description: "Missing/invalid API key." },
            429: { description: "Rate limited." },
          },
        },
      },
    },
  });
}
