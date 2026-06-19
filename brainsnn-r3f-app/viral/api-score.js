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
// EN lexicons + the scorer come from the shared core so /api/score, the SSE
// stream, and the on-page scan never drift (src/utils/firewall-parity.test.js
// guards this). The ES/FR packs add their own lexicons below; coercion is
// shared from the core too.
import {
  EN_RULES,
  ES_COERCION,
  FR_COERCION,
  scoreWithRules,
  detectLanguage,
} from "../src/utils/firewallCore.js";
// Server-side semantic scorer — uses a NON-VITE GEMINI_API_KEY so the key never
// reaches the browser. Falls back to the regex scorer when unset or on error.
import {
  isGeminiServerConfigured,
  analyzeWithGeminiServer,
} from "./gemini-server.js";
// Server-side Crumb scorer — uses CRUMB_LLM_URL/CRUMB_LLM_KEY on the Node
// process, so production can use Crumb without exposing a browser token.
import {
  isCrumbServerConfigured,
  analyzeWithCrumbServer,
} from "./crumb-server.js";

// ---------- server-side Firewall ----------

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
  coercion: ES_COERCION,
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
  coercion: FR_COERCION,
};

const PACKS = { en: EN_RULES, es: RULES_ES, fr: RULES_FR };

// detectLanguage + scoreWithRules + clamp/normalize/countMatches all live in
// firewallCore.js (imported above) — single source of truth with the client.

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

  // Deterministic regex pass — always runs. It is the source of `signals`
  // (the matched-phrase evidence the UI shows), the receipt, and the fallback
  // dimensions when semantic scoring is unavailable.
  const regex = scoreWithRules(text, rules);
  const templates = detectTemplates(text);

  // Semantic overlay: prefer server-side Crumb LLM when configured, then
  // Gemini. Keep regex `signals` + templates so "why this score" still shows
  // matched phrases even when the semantic engine supplies the dimensions.
  let dims = regex;
  let engine = "regex-v1";
  let reasoning = "";
  if (isCrumbServerConfigured()) {
    try {
      const ai = await analyzeWithCrumbServer(text);
      dims = ai;
      engine = ai.source; // e.g. "crumb-llm:server"
      reasoning = ai.reasoning || "";
    } catch (err) {
      console.error("[score] crumb fallback:", err.message || err);
    }
  }
  if (engine === "regex-v1" && isGeminiServerConfigured()) {
    try {
      const ai = await analyzeWithGeminiServer(text);
      dims = ai;
      engine = ai.source; // e.g. "gemini:gemini-2.5-flash"
      reasoning = ai.reasoning || "";
    } catch (err) {
      console.error("[score] gemini fallback to regex:", err.message || err);
    }
  }

  const r = receipt(text, dims);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    text,
    pressure: +(
      (dims.emotionalActivation +
        dims.cognitiveSuppression +
        dims.manipulationPressure) /
      3
    ).toFixed(3),
    emotionalActivation: dims.emotionalActivation,
    cognitiveSuppression: dims.cognitiveSuppression,
    manipulationPressure: dims.manipulationPressure,
    trustErosion: dims.trustErosion,
    evidence: dims.evidence,
    signals: regex.signals, // matched-phrase breakdown (always from regex)
    templates,
    language: lang,
    confidence: dims.confidence,
    confidenceReason: reasoning || regex.confidenceReason,
    recommendedAction: dims.recommendedAction,
    receipt: r,
    engine,
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
