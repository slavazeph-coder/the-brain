import express from "express";
import path from "path";
import { readFileSync } from "node:fs";
import crypto from "crypto";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { analyzeContentLocally } from "./src/lib/analysisEngine.js";
import {
  createAutopsyFromLayerStack,
  createRewriteFromLayerStack,
  getEngineStatusSnapshot,
  runLayerRouter
} from "./src/lib/layerRouter.js";
import { LAYER_CATALOG } from "./src/lib/layerCatalog.js";
import { SOLITON_PRESETS, computeSolitonPreset, exploreSolitonField } from "./src/lib/solitonLayer.js";
import { computeFirewall } from "./src/lib/firewallLayer.js";
import { computeAffect } from "./src/lib/affectLayer.js";
import { applyRouteMeta } from "./src/lib/routeMeta.js";
import { buildSitemap } from "./src/lib/sitemap.js";
import { encodePng, fitInto } from "./src/lib/png.js";
import { PowderEngine } from "./src/features/powder/powderEngine.ts";
import { applyDecodedGrid, decodeGrid } from "./src/features/powder/share.ts";
import { renderGrid } from "./src/features/powder/renderGrid.ts";
import {
  createReplayNeuralInput,
  normalizeRemoteDecoderResponse,
  getNeuralGatewayCapabilities,
  deriveDecodeUncertainty,
} from "./src/lib/neuralInputGateway.js";
import { BODY_LIMITS, LIMITS, RateLimiter, SpendCeiling, resolveGeminiCeiling, routeTier } from "./src/lib/rateLimit.js";
import { formatEventLine, normalizeEvent } from "./src/lib/eventSink.js";

dotenv.config();

const app = express();

// Railway terminates TLS at its edge and forwards, so without this every
// request arrives from the proxy's address and the rate limiter below would key
// every visitor to one bucket — one busy user would lock out the site. Trusting
// exactly one hop takes the address Railway itself appended, which a client
// cannot forge by sending its own X-Forwarded-For.
app.set("trust proxy", 1);

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

// Body caps are per-route and mounted before the general parser, which then
// skips anything already parsed. The old single 2 MB cap applied to /api/analyze
// too, and that endpoint embeds the body in a Gemini prompt paid for with the
// operator's key — 2 MB is roughly 500,000 tokens of attacker-chosen text.
app.use("/api/analyze", express.json({ limit: BODY_LIMITS.analyze }));
app.use("/api/events", express.json({ limit: BODY_LIMITS.events }));
app.use(express.json({ limit: BODY_LIMITS.general }));

const PORT = Number(process.env.PORT) || 3000;
const APP_URL = process.env.APP_URL || process.env.PUBLIC_APP_URL || "https://www.brainsnn.com";
const STRIPE_API_BASE = "https://api.stripe.com/v1";
/** Shown to a visitor whenever a lead could not be delivered, so the trail never dead-ends. */
const LEADS_FALLBACK_EMAIL = process.env.LEADS_FALLBACK_EMAIL || "hello@brainsnn.com";

// Initialize Gemini safely
let ai: GoogleGenAI | null = null;
const apiKey = process.env.GEMINI_API_KEY;

// Global memory for storing Gemini quota-limited state (e.g., when 429 quota limits are hit)
let isGeminiQuotaLimited = false;
let lastQuotaCheckTime = 0;

if (apiKey && apiKey !== "MY_GEMINI_API_KEY" && apiKey !== "") {
  try {
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    console.log("Gemini API initialized successfully via process.env.GEMINI_API_KEY");
  } catch (error) {
    console.error("Failed to initialize Gemini API:", error);
  }
} else {
  console.log("No valid Gemini API key found. Defaulting to local physical SNN wave-equation simulation.");
}

// ----------------------------------------------------
// Deterministic High-Fidelity Local SNN Simulation Fallback
// ----------------------------------------------------
function runLocalSimulation(content: string, type: string): any {
  const localResult = (analyzeContentLocally as any)({ content, contentType: type, forceFallback: true });
  const baseResult = {
    ...localResult,
    riskRating: localResult.gaugeGapScore >= 70 ? "High" : localResult.gaugeGapScore >= 48 ? "Medium" : "Low",
  };
  return (runLayerRouter as any)({
    content,
    contentType: type,
    baseResult,
    providerTrace: [
      { stage: "Local fallback", status: "completed", note: "Deterministic BrainSNN local layer stack used because primary model was unavailable." }
    ],
    engineStatus: getEngineStatusSnapshot(process.env),
  });
}

// Helper function to call Gemini with robust exponential backoff retry for transient errors.
//
// maxRetries was 2, and the caller loops over two models, so one HTTP request
// could bill six calls. It is now 1: two models × two attempts, and the loop
// stops on quota rather than trying the second model with the same exhausted
// project. Every attempt is charged against the process-wide spend ceiling
// first, so the count is of calls actually paid for, not requests received.
async function callGeminiWithRetry(aiClient: GoogleGenAI, options: any, maxRetries = 1, delayMs = 600): Promise<any> {
  let attempt = 0;
  while (true) {
    try {
      if (!geminiCeiling.tryConsume()) throw new GeminiCeilingReached("Gemini hourly ceiling reached.");
      return await aiClient.models.generateContent(options);
    } catch (error: any) {
      if (error instanceof GeminiCeilingReached) throw error;
      attempt++;
      const errorStr = String(error?.message || error || "");
      
      // If the error represents hard quota exhaustion, we fail-fast immediately
      const isQuotaLimit = errorStr.toLowerCase().includes("quota") || 
                           errorStr.toLowerCase().includes("exhausted") ||
                           errorStr.toLowerCase().includes("billing") ||
                           errorStr.toLowerCase().includes("limit") ||
                           errorStr.toLowerCase().includes("resource_exhausted");

      const isTransient = (errorStr.includes("503") || 
                           errorStr.includes("502") || 
                           (errorStr.includes("429") && !isQuotaLimit) ||
                           errorStr.toLowerCase().includes("unavailable") || 
                           errorStr.toLowerCase().includes("high demand") ||
                           (errorStr.toLowerCase().includes("rate limit") && !isQuotaLimit));
      
      if (attempt <= maxRetries && isTransient) {
        console.log(`Gemini API returned transient congestion error (attempt ${attempt}/${maxRetries}): ${errorStr.substring(0, 80)}. Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2;
        continue;
      }
      throw error;
    }
  }
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader = "", secret = "") {
  if (!rawBody || !signatureHeader || !secret) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => {
    const [key, ...value] = part.split("=");
    return [key, value.join("=")];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleStripeWebhook(req: express.Request, res: express.Response) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(501).json({ error: "Stripe webhook secret is not configured." });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const signature = req.header("stripe-signature") || "";
  if (!verifyStripeSignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: "Invalid Stripe signature." });
  }
  let event: any;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid Stripe event JSON." });
  }
  const trackedEvents = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
  if (trackedEvents.has(event.type)) {
    console.log(`[Stripe] ${event.type}`, {
      id: event.id,
      customer: event.data?.object?.customer,
      subscription: event.data?.object?.subscription || event.data?.object?.id,
      status: event.data?.object?.status,
    });
  }
  return res.json({ received: true });
}

// ----------------------------------------------------
// RATE LIMITING
// ----------------------------------------------------
//
// The logic lives in src/lib/rateLimit.js with unit tests and an injected clock;
// this is only the wiring. See that file for why the endpoints below are the
// risky ones and why an in-memory limiter is per-process.

const limiters = {
  analyze: new RateLimiter(LIMITS.analyze),
  magicLink: new RateLimiter(LIMITS.magicLink),
  general: new RateLimiter(LIMITS.general),
  events: new RateLimiter(LIMITS.events),
};

/** Bounds what the process can spend on Gemini however many callers ask.
 *  Tune with GEMINI_HOURLY_CEILING; 0 stops paid calls without removing the key. */
const geminiCeiling = new SpendCeiling(resolveGeminiCeiling(process.env));

/** Marks the one error the analyze handler must answer with the local engine. */
class GeminiCeilingReached extends Error {}

// Keys are attacker-supplied, so the maps are swept rather than left to grow.
// unref() so this timer never holds the process open by itself.
setInterval(() => {
  for (const limiter of Object.values(limiters)) limiter.sweep();
}, 5 * 60 * 1000).unref();

function limit(name: keyof typeof limiters, keyOf?: (req: express.Request) => string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = keyOf ? `${req.ip}|${keyOf(req)}` : String(req.ip);
    const result = limiters[name].consume(key);
    res.setHeader("X-RateLimit-Limit", String(limiters[name].limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (result.allowed) return next();
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many requests. Please wait a moment and try again.",
      retryAfter: result.retryAfterSeconds,
    });
  };
}

// ----------------------------------------------------
// API ENDPOINTS
// ----------------------------------------------------

// Health check endpoint for container orchestrators (Railway healthcheckPath).
// Declared before the limiter so a throttled instance never fails its own health
// check and gets restarted for being popular.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// The sitemap, built from the same route table that decides what each URL's
// title and social card say. robots.txt points here. Declared above the API
// limiter for the same reason as the health check: it is cheap, it is public,
// and a crawler that gets a 429 on it may not come back for a while.
app.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml").send(buildSitemap(APP_URL));
});

// Floor under every API route that does not declare its own tier. Routes that
// do are skipped here and limited once, at their own mount — see DEDICATED_ROUTES
// in rateLimit.js for why stacking the two was wrong rather than cautious.
const generalLimit = limit("general");
app.use("/api", (req, res, next) => {
  // Inside a mounted middleware req.path is relative to "/api", so the full
  // path has to be reassembled before it can be matched against the table.
  if (routeTier(req.originalUrl.split("?")[0]) !== "general") return next();
  return generalLimit(req, res, next);
});

app.get("/api/layers", (_req, res) => {
  const status = getEngineStatusSnapshot(process.env);
  res.json({
    totalLayers: LAYER_CATALOG.length,
    coreLayers: status.coreLayers,
    layers: LAYER_CATALOG,
  });
});

// ----------------------------------------------------
// SOCIAL CARD FOR A SHARED CIRCUIT
// ----------------------------------------------------
//
// The share button says the link "carries the whole grid, no server involved",
// and it does — but the preview everyone sees before deciding whether to open it
// was the same generic site card as every other URL. A shared circuit is the one
// thing on this site whose preview can show what was actually shared.
//
// So the card is drawn from the link: decode the grid, load it into a real
// engine, and render it with the same function the browser canvas uses, which
// means the preview cannot drift from what opening the link shows.
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

app.get("/api/og/lab", (req, res) => {
  const share = typeof req.query.grid === "string" ? req.query.grid : "";
  const grid = decodeGrid(share);
  // decodeGrid already bounds the string length and the dimensions, and returns
  // null for anything it does not fully understand.
  if (!grid) return res.status(404).json({ error: "not_a_grid" });

  const engine = new PowderEngine({ width: grid.width, height: grid.height });
  if (!applyDecodedGrid(engine, grid)) return res.status(404).json({ error: "not_a_grid" });

  const pixels = { data: new Uint8ClampedArray(engine.size * 4) };
  // No neuro layer: a card is one still frame of the drawn circuit, not a run of
  // it, so nothing is firing and weights come from the link itself.
  renderGrid(engine, null, pixels);

  const framed = fitInto(
    { width: grid.width, height: grid.height, data: pixels.data },
    OG_WIDTH,
    OG_HEIGHT,
  );

  // The whole grid is in the URL, so the response is a pure function of it and
  // can be cached forever. A different circuit is a different URL.
  res.type("image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(encodePng(OG_WIDTH, OG_HEIGHT, framed));
});

app.get("/api/engines/status", async (_req, res) => {
  const status = getEngineStatusSnapshot(process.env);
  if (status.engines.tribe.configured) {
    try {
      const health = await fetch(`${process.env.TRIBE_API_URL}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => r.json());
      status.engines.tribe = { ...status.engines.tribe, status: "online", modelLoaded: Boolean(health.model_loaded) };
    } catch {
      status.engines.tribe = { ...status.engines.tribe, status: "unreachable" };
    }
  }
  res.json(status);
});

app.get("/api/engines/tribe/health", async (_req, res) => {
  if (!process.env.TRIBE_API_URL) {
    return res.status(501).json({ error: "TRIBE_API_URL is not configured.", status: "not_configured" });
  }
  try {
    const response = await fetch(`${process.env.TRIBE_API_URL}/health`, { signal: AbortSignal.timeout(4000) });
    const body = await response.json();
    return res.status(response.ok ? 200 : response.status).json(body);
  } catch (error: any) {
    return res.status(503).json({ error: error?.message || "TRIBE health check failed.", status: "unreachable" });
  }
});

app.get("/api/engines/tribe/scenarios", async (_req, res) => {
  if (!process.env.TRIBE_API_URL) {
    return res.status(501).json({ error: "TRIBE_API_URL is not configured.", scenarios: [] });
  }
  try {
    const response = await fetch(`${process.env.TRIBE_API_URL}/scenarios`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    return res.status(response.ok ? 200 : response.status).json(body);
  } catch (error: any) {
    return res.status(503).json({ error: error?.message || "TRIBE scenarios unavailable.", scenarios: [] });
  }
});

app.post("/api/rewrite", (req, res) => {
  const { content, goal } = req.body || {};
  if (!content || String(content).trim().length < 12) {
    return res.status(400).json({ error: "Content is required for rewrite." });
  }
  const rewrite = createRewriteFromLayerStack(content, goal || "trust");
  const comparison = (runLayerRouter as any)({
    content: rewrite.content,
    contentType: "text",
    baseResult: (analyzeContentLocally as any)({ content: rewrite.content, contentType: "text", forceFallback: true }),
    providerTrace: [{ stage: "Rewrite layer stack", status: "completed", note: "Counter-Draft, Refutation, Tone Shifter and Persona Simulator generated the rewrite." }],
    engineStatus: getEngineStatusSnapshot(process.env),
  });
  return res.json({ ...rewrite, comparison });
});

app.post("/api/autopsy", (req, res) => {
  const { leftContent, rightContent, left, right } = req.body || {};
  const resolvedLeft = leftContent || left;
  const resolvedRight = rightContent || right;
  if (!resolvedLeft || !resolvedRight) {
    return res.status(400).json({ error: "Both leftContent and rightContent are required." });
  }
  return res.json(createAutopsyFromLayerStack(resolvedLeft, resolvedRight));
});

// Layer 103 — 39 Hz Soliton Field. Deterministic microtubule ionic-soliton /
// gamma-synchrony model. Runs fully offline (no model key required).
app.post("/api/soliton", (req, res) => {
  try {
    const { content, type, contentType } = req.body || {};
    const inputType = type || contentType || "text";
    if (!content || String(content).trim().length < 4) {
      return res.status(400).json({ error: "Content is required for the 39 Hz soliton field." });
    }
    const routed = (runLayerRouter as any)({
      content,
      contentType: inputType,
      baseResult: (analyzeContentLocally as any)({ content, contentType: inputType, forceFallback: true }),
      providerTrace: [
        { stage: "L103 39 Hz Soliton Field", status: "completed", note: "Microtubule ionic-soliton gamma model evaluated locally." }
      ],
      engineStatus: getEngineStatusSnapshot(process.env),
    });
    return res.json({
      solitonField: routed.solitonField,
      affectProfile: routed.affectProfile,
      firewallSignals: routed.firewallSignals,
      receipt: routed.receipt,
    });
  } catch (error: any) {
    console.error("Error evaluating 39 Hz soliton field:", error?.message || error);
    return res.status(500).json({ error: "Failed to evaluate the 39 Hz soliton field." });
  }
});

// Layer 4 — Cognitive Firewall. Deterministic manipulation-pressure profile
// (categories, per-sentence heatmap, grade, tactics). Offline, no model key.
app.post("/api/firewall", (req, res) => {
  try {
    const { content, type, contentType } = req.body || {};
    const inputType = type || contentType || "text";
    if (!content || String(content).trim().length < 4) {
      return res.status(400).json({ error: "Content is required for the Cognitive Firewall." });
    }
    const base = (analyzeContentLocally as any)({ content, contentType: inputType, forceFallback: true });
    const firewall = (computeFirewall as any)({ content, metrics: base.metrics, isFallback: true });
    return res.json({ firewall, metrics: base.metrics });
  } catch (error: any) {
    console.error("Error evaluating Cognitive Firewall:", error?.message || error);
    return res.status(500).json({ error: "Failed to evaluate the Cognitive Firewall." });
  }
});

// Layer 29 — Affective Decoder. Deterministic affect taxonomy on Russell's
// valence×arousal circumplex + per-sentence trajectory. Offline, no model key.
app.post("/api/affect", (req, res) => {
  try {
    const { content, type, contentType } = req.body || {};
    const inputType = type || contentType || "text";
    if (!content || String(content).trim().length < 4) {
      return res.status(400).json({ error: "Content is required for the Affective Decoder." });
    }
    const base = (analyzeContentLocally as any)({ content, contentType: inputType, forceFallback: true });
    const firewall = (computeFirewall as any)({ content, metrics: base.metrics, isFallback: true });
    const affect = (computeAffect as any)({ content, metrics: base.metrics, firewallSignals: firewall });
    return res.json({ affect, metrics: base.metrics });
  } catch (error: any) {
    console.error("Error evaluating Affective Decoder:", error?.message || error);
    return res.status(500).json({ error: "Failed to evaluate the Affective Decoder." });
  }
});

// Layer 19 — Neural decoder integration. Runs an authorized decoded-text
// envelope through the full deterministic stack and surfaces the decoder's
// confidence as an uncertainty label. Analyzes decoded text only — no raw
// signals, no model keys. A real external decoder plugs in via NEURAL_DECODER_URL.
function analyzeNeuralEnvelope(envelope: any) {
  const content = envelope.decodedText;
  const baseResult = (analyzeContentLocally as any)({ content, contentType: "text", forceFallback: true });
  const result = (runLayerRouter as any)({
    content,
    contentType: "text",
    baseResult,
    providerTrace: [
      { stage: "L19 Neural Input Gateway", status: "completed", note: `Decoded transcript via ${envelope.provenance?.decoder || "decoder"} (${Math.round((envelope.confidence || 0) * 100)}% confidence).` },
    ],
    engineStatus: getEngineStatusSnapshot(process.env),
  });
  return { neuralInput: envelope, uncertainty: (deriveDecodeUncertainty as any)(envelope), result };
}

app.get("/api/neural/capabilities", (_req, res) => {
  return res.json((getNeuralGatewayCapabilities as any)(process.env));
});

app.post("/api/neural/analyze", (req, res) => {
  let envelope: any;
  try {
    envelope = (createReplayNeuralInput as any)(req.body || {});
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "Could not import the decoded transcript." });
  }
  try {
    return res.json(analyzeNeuralEnvelope(envelope));
  } catch (error: any) {
    console.error("Error analyzing decoded transcript:", error?.message || error);
    return res.status(500).json({ error: "Failed to analyze the decoded transcript." });
  }
});

app.post("/api/neural/decode", async (req, res) => {
  const decoderUrl = process.env.NEURAL_DECODER_URL;
  if (!decoderUrl) {
    return res.status(501).json({ error: "No external neural decoder configured (set NEURAL_DECODER_URL).", status: "not_configured" });
  }
  try {
    const request = req.body || {};
    const upstream = await fetch(decoderUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.NEURAL_DECODER_KEY ? { Authorization: `Bearer ${process.env.NEURAL_DECODER_KEY}` } : {}),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Neural decoder returned ${upstream.status}.` });
    }
    const decoded = await upstream.json();
    const envelope = (normalizeRemoteDecoderResponse as any)(decoded, request);
    return res.json(analyzeNeuralEnvelope(envelope));
  } catch (error: any) {
    console.error("Error calling neural decoder:", error?.message || error);
    return res.status(502).json({ error: error?.message || "Neural decoder request failed." });
  }
});

// Named soliton presets and their fields — lets agents/UI preview archetypes
// (high-pressure / trustful / mixed / baseline) without a content scan. Offline.
app.get("/api/soliton/presets", (_req, res) => {
  try {
    const presets = Object.keys(SOLITON_PRESETS).map((name) => (computeSolitonPreset as any)(name));
    return res.json({ presets });
  } catch (error: any) {
    console.error("Error building soliton presets:", error?.message || error);
    return res.status(500).json({ error: "Failed to build soliton presets." });
  }
});

// Deterministic sensitivity sweep of one driver axis (e.g. pressure) so the
// coherence/binding response curve can be charted without a full scan. Offline.
app.post("/api/soliton/explore", (req, res) => {
  try {
    const { axis, steps, base, contentType } = req.body || {};
    return res.json((exploreSolitonField as any)({ axis, steps, base, contentType }));
  } catch (error: any) {
    console.error("Error exploring soliton field:", error?.message || error);
    return res.status(500).json({ error: "Failed to explore the 39 Hz soliton field." });
  }
});

// Limited per IP *and* per email address: without the second key one mailbox
// could be bombed from many addresses, which is the abuse that gets a sending
// domain flagged. Supabase is unset today, so this endpoint returns 501 — the
// cap goes in now, while it is still theoretical.
app.post("/api/auth/magic-link", limit("magicLink", (req) => String(req.body?.email || "").toLowerCase()), async (req, res) => {
  const { email } = req.body || {};
  if (!email || !String(email).includes("@")) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(501).json({ error: "Supabase Auth is not configured.", status: "not_configured" });
  }
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        email,
        create_user: true,
        options: { email_redirect_to: `${APP_URL}/app/` },
      }),
    });
    if (!response.ok) {
      return res.status(response.status).json(await response.json().catch(() => ({ error: "Supabase sign-in failed." })));
    }
    return res.json({ ok: true, status: "magic_link_sent" });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || "Supabase sign-in failed." });
  }
});

// ----------------------------------------------------
// ANALYTICS SINK
// ----------------------------------------------------
//
// track() forwards to VITE_ANALYTICS_URL, which was unset, so every call site
// fed a function that sent nothing anywhere. This gives the events somewhere to
// land that is already owned and already running: one JSON line per event on
// stdout, which Railway retains and which is greppable for the prefix.
//
// Validation lives in src/lib/eventSink.js and is re-applied here rather than
// trusted from the client, because this endpoint is public — see that file.
// 204 regardless of whether the event was kept: a rejected event is not the
// visitor's problem, and sendBeacon ignores the body anyway.
app.post("/api/events", limit("events"), (req, res) => {
  const record = normalizeEvent(req.body, { path: req.path });
  if (record) console.log(formatEventLine(record));
  return res.status(204).end();
});

// ----------------------------------------------------
// LEAD CAPTURE
// ----------------------------------------------------
//
// The only conversion mechanism this product had was a bare
// `mailto:hello@brainsnn.com`, which does nothing visible for anyone on mobile
// or webmail — so an unknown share of people who wanted to buy simply bounced.
//
// The hard rule here, and the reason this endpoint exists at all: it must never
// report success for a lead that was not delivered. The pricing page used to
// tell people "You're on the Pro list" while storing nothing anywhere, and that
// is the exact failure this replaces. When no destination is configured it
// returns 501 like every other unconfigured integration in this file, and the
// UI is required to show the mailto fallback rather than a confirmation.
const LEAD_SEGMENTS = new Set([
  "schools", "publishers", "brands", "research", "self-serve", "other",
]);

/** Trim, cap and drop anything empty so one long paste cannot fill the log. */
function leadField(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

app.post("/api/leads", async (req, res) => {
  const body = req.body || {};
  const email = leadField(body.email, 320);
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "A valid email is required." });
  }

  const segment = LEAD_SEGMENTS.has(body.segment) ? body.segment : "other";
  const lead = {
    email,
    segment,
    name: leadField(body.name, 200),
    audience: leadField(body.audience),
    concept: leadField(body.concept),
    outcome: leadField(body.outcome),
    timeline: leadField(body.timeline, 200),
    receivedAt: new Date().toISOString(),
  };

  const webhook = process.env.LEADS_WEBHOOK_URL;
  if (!webhook) {
    // No destination: say so plainly rather than swallowing the lead.
    return res.status(501).json({
      error: "Lead capture is not configured.",
      status: "not_configured",
      fallbackEmail: LEADS_FALLBACK_EMAIL,
    });
  }

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LEADS_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.LEADS_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(lead),
    });
    if (!response.ok) {
      // Upstream rejected it, so it is not captured. Do not claim otherwise.
      return res.status(502).json({
        error: "Lead could not be delivered.",
        status: "delivery_failed",
        fallbackEmail: LEADS_FALLBACK_EMAIL,
      });
    }
    return res.json({ ok: true, status: "received" });
  } catch (error: any) {
    return res.status(502).json({
      error: error?.message || "Lead could not be delivered.",
      status: "delivery_failed",
      fallbackEmail: LEADS_FALLBACK_EMAIL,
    });
  }
});

app.post("/api/billing/checkout", async (req, res) => {
  const { plan = "basic", email } = req.body || {};
  const priceId = plan === "pro" ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_BASIC;
  if (!process.env.STRIPE_SECRET_KEY || !priceId) {
    return res.status(501).json({ error: "Stripe Checkout is not configured.", status: "not_configured" });
  }
  try {
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("success_url", `${APP_URL}/app/?checkout=success&plan=${encodeURIComponent(plan)}`);
    params.set("cancel_url", `${APP_URL}/app/?checkout=cancelled`);
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    params.set("allow_promotion_codes", "true");
    if (email) params.set("customer_email", String(email));
    params.set("metadata[product]", "brainsnn");
    params.set("metadata[plan]", String(plan));
    const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const body = await response.json();
    if (!response.ok) return res.status(response.status).json(body);
    return res.json({ url: body.url, id: body.id });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || "Stripe Checkout failed." });
  }
});

app.post("/api/billing/portal", async (req, res) => {
  const { customerId } = req.body || {};
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({ error: "Stripe customer portal is not configured.", status: "not_configured" });
  }
  if (!customerId) return res.status(400).json({ error: "customerId is required." });
  try {
    const params = new URLSearchParams();
    params.set("customer", String(customerId));
    params.set("return_url", `${APP_URL}/app/`);
    const response = await fetch(`${STRIPE_API_BASE}/billing_portal/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const body = await response.json();
    if (!response.ok) return res.status(response.status).json(body);
    return res.json({ url: body.url, id: body.id });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || "Stripe portal failed." });
  }
});

app.post("/api/analyze", limit("analyze"), async (req, res) => {
  const { content, type, contentType } = req.body || {};
  const inputType = type || contentType || "text";

  if (!content) {
    return res.status(400).json({ error: "Content parameter is required." });
  }

  const now = Date.now();
  // If we had a quota error within the last 5 minutes, go straight to fallback simulation to avoid log warning storms
  if (isGeminiQuotaLimited && (now - lastQuotaCheckTime < 5 * 60 * 1000)) {
    console.log("[Quota Memory Status] Gemini is currently flagged as quota-limited of the free tier. Bypassing slow retries to run local SNN simulation instantly.");
    const localResult = runLocalSimulation(content, inputType);
    return res.json(localResult);
  }

  // If Gemini is not set up, go straight to fallback simulation
  if (!ai) {
    console.log("No Gemini API connection. Executing SNN local simulation...");
    const localResult = runLocalSimulation(content, inputType);
    return res.json(localResult);
  }

  try {
    const prompt = `
      You are BrainSNN's content decision engine. Estimate how the content may affect attention, trust, manipulation risk, and brand safety. Do not claim literal human brain measurement.

      Analyze this content and map it to a complex Spiking Neural Network simulation result:
      ---
      Content Type: ${inputType}
      Content Body: "${content}"
      ---

      Analyze and return a JSON object aligning with this schema exactly. Make sure values range from 0 to 100 where requested:
      {
        "title": "A short, viral, punchy diagnostic classification title for this analysis",
        "fear": 0-100 score indicating panic, FOMO, risk warnings, or safety concerns,
        "anger": 0-100 score indicating aggression, indignation, or high emotional charge,
        "urgency": 0-100 score indicating scarcity, direct commands, immediacy,
        "trust": 0-100 score indicating factual tone, transparency, credibility,
        "excitement": 0-100 score indicating narrative energy, sensory burst, entertainment value,
        "empathy": 0-100 score indicating warm tone, connection, community focus,
        "firingRate": 20-120 range (representing simulated SNN mean firing rate in Hz),
        "plasticity": 10-100 range (representing simulated neuromodulation adaptability),
        "attentionCurve": An array of EXACTLY 10 integer numbers (0 to 100) representing audience interest over time ticks 0 to 9,
        "riskRating": Must be one of "Low", "Medium", "High", "Critical",
        "riskDescription": A precise explanation of any brand-safety risks or manipulation mechanisms,
        "viralScore": 0-100 predicting virality based on emotional multipliers (high excitement, urgency, and outrage fuel virality),
        "gaugeGapScore": A score (-50 to +50) indicating the deviation of this message's tone from an objective, fair, baseline tone,
        "summary": "A 2-3 sentence overview describing the emotional waveform, primary triggers, and underlying psychological effect.",
        "insights": [
          "An array of 3 unique, plain-English content and audience-response insights concerning this piece of content."
        ],
        "recommendations": [
          "An array of 3 distinct, actionable editing or brand safety optimization recommendations."
        ],
        "payloadType": "Pick one of: 'Sensory Burst', 'Fear Cascade', 'Emotional Salience', 'Organic Baseline', 'Outrage Vortex', 'Sustained Baseline'",
        "confidence": 0-100 rating indicating model certainty
      }

      CRITICAL: You MUST write ONLY valid parsable JSON. Do not write any markdown codeblock wraps like \`\`\`json. Return only raw json.
    `;

    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
    let response = null;
    let selectedModel = "";
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        console.log(`Submitting content to Gemini API (${model})...`);
        response = await callGeminiWithRetry(ai, {
          model: model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 1.0,
            systemInstruction: "You are the cognitive backend of BrainSNN.com, decoding affective content triggers utilizing SNN wave architecture."
          }
        });
        selectedModel = model;
        console.log(`Successfully completed analysis using model: ${model}`);
        // Reset quota state
        isGeminiQuotaLimited = false;
        break;
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);

        // The hourly spend ceiling is not a model problem, so trying the second
        // model would just be a second refusal. Serve the local engine instead —
        // which is already what runs when no key is set, so this is the
        // well-travelled path rather than an error nobody has seen.
        if (err instanceof GeminiCeilingReached) {
          console.warn("[Warn] Gemini hourly ceiling reached. Serving the local SNN engine.");
          const localResult = runLocalSimulation(content, inputType);
          return res.json(localResult);
        }

        // Check for quota
        const isQuota = errMsg.toLowerCase().includes("quota") ||
                        errMsg.toLowerCase().includes("exhausted") ||
                        errMsg.toLowerCase().includes("limit") ||
                        errMsg.toLowerCase().includes("billing") ||
                        err?.status === "RESOURCE_EXHAUSTED";

        if (isQuota) {
          isGeminiQuotaLimited = true;
          lastQuotaCheckTime = Date.now();
          console.warn(`[Warn] Quota-limit hit for model ${model}. Flagging Gemini as quota-limited.`);
          // Both models bill the same exhausted project, so the fallback model
          // would only add a second charge for the same refusal.
          break;
        }
        console.warn(`[Warn] Attempt with model ${model} failed:`, errMsg);
      }
    }

    if (!response) {
      throw lastError || new Error("All cascade models failed.");
    }

    let textOutput = response.text?.trim() || "";
    if (textOutput.startsWith("```")) {
      textOutput = textOutput.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }
    const parsedData = JSON.parse(textOutput);

    // Map JSON parameters safely to full AnalysisResult format
    const outputResult = {
      id: "sc_" + Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toISOString(),
      title: parsedData.title || "Affective Analysis Decoded",
      rawContent: content,
      contentType: inputType,
      metrics: {
        fear: Number(parsedData.fear) || 15,
        anger: Number(parsedData.anger) || 10,
        urgency: Number(parsedData.urgency) || 20,
        trust: Number(parsedData.trust) || 50,
        excitement: Number(parsedData.excitement) || 40,
        empathy: Number(parsedData.empathy) || 30,
        firingRate: Number(parsedData.firingRate) || 60,
        plasticity: Number(parsedData.plasticity) || 55
      },
      attentionCurve: (parsedData.attentionCurve || [30, 45, 50, 60, 55, 45, 52, 70, 65, 60]).map((lvl: number, idx: number) => ({
        second: idx * 3,
        level: lvl
      })),
      riskRating: parsedData.riskRating || "Low",
      riskDescription: parsedData.riskDescription || "No brand safety risks detected.",
      viralScore: Number(parsedData.viralScore) || 50,
      gaugeGapScore: Number(parsedData.gaugeGapScore) || 0,
      summary: parsedData.summary || "Content analyzed successfully with SNN cognitive filters.",
      insights: parsedData.insights || ["No specific insights generated."],
      recommendations: parsedData.recommendations || ["Consider regular engagement with audiences."],
      payloadType: parsedData.payloadType || "Organic Baseline",
      confidence: Number(parsedData.confidence) || 90,
      crumbModelStats: {
        wavesDamping: 0.12,
        wavesFrequency: 5.2,
        attentionComplexity: "O(N log N) wave-equation core",
        perplexityDelta: -16.8
      },
      isFallback: false
    };

    return res.json((runLayerRouter as any)({
      content,
      contentType: inputType,
      baseResult: outputResult,
      providerTrace: [
        { stage: "Gemini Deep Analysis", status: "completed", provider: selectedModel, note: "Primary model returned the base AnalysisResult payload." }
      ],
      engineStatus: getEngineStatusSnapshot(process.env),
    }));

  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.log("[Info] Gemini API returned temporary rate limit/congestion. Swapped seamlessly to local SNN physical emulator fallback.", errorMsg);
    const localResult = runLocalSimulation(content, inputType);
    return res.json(localResult);
  }
});


// ----------------------------------------------------
// VITE DEV SERVER / STATIC FILE SERVING MIDDLEWARE
// ----------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Dynamically load Vite to avoid loading client-side dependencies in production bundle
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    
    // Bind Vite's middleware
    app.use(vite.middlewares);
    console.log("Mounted Vite development middleware");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // `index: false` matters more than it looks. By default express.static
    // answers "/" with dist/index.html straight off disk, so the homepage — the
    // most-linked URL on the site — was the one route that never reached
    // applyRouteMeta below. It looked correct only because the baked-in tags in
    // index.html happen to be the homepage's own. Anything the server computes
    // per route, including the content a crawler reads, was silently skipped
    // there. Letting "/" fall through to the catch-all fixes that.
    app.use(express.static(distPath, { index: false }));

    // Every route used to be served the identical index.html, so a shared
    // /lab?grid=... link, a challenge link and the homepage all previewed as
    // the same generic card. Social scrapers do not run JavaScript, so the
    // client cannot fix this — the tags have to be right in the HTML we send.
    const indexHtml = readFileSync(path.join(distPath, "index.html"), "utf8");
    app.get("*", (req, res) => {
      const [pathname, search = ""] = req.originalUrl.split("?");
      const origin = APP_URL.replace(/\/$/, "");
      res.type("html").send(applyRouteMeta(indexHtml, pathname, search, origin));
    });
    console.log(`Serving static distribution assets from ${distPath}`);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BrainSNN Engine running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
