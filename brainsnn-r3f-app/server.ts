import express from "express";
import path from "path";
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

dotenv.config();

const app = express();
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT) || 3000;
const APP_URL = process.env.APP_URL || process.env.PUBLIC_APP_URL || "https://www.brainsnn.com";
const STRIPE_API_BASE = "https://api.stripe.com/v1";

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

// Helper function to call Gemini with robust exponential backoff retry for transient errors
async function callGeminiWithRetry(aiClient: GoogleGenAI, options: any, maxRetries = 2, delayMs = 600): Promise<any> {
  let attempt = 0;
  while (true) {
    try {
      return await aiClient.models.generateContent(options);
    } catch (error: any) {
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
// API ENDPOINTS
// ----------------------------------------------------

// Health check endpoint for container orchestrators (Railway healthcheckPath).
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/layers", (_req, res) => {
  const status = getEngineStatusSnapshot(process.env);
  res.json({
    totalLayers: LAYER_CATALOG.length,
    coreLayers: status.coreLayers,
    layers: LAYER_CATALOG,
  });
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

app.post("/api/auth/magic-link", async (req, res) => {
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

app.post("/api/analyze", async (req, res) => {
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
        } else {
          console.warn(`[Warn] Attempt with model ${model} failed:`, errMsg);
        }
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
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log(`Serving static distribution assets from ${distPath}`);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BrainSNN Engine running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
