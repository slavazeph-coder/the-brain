/**
 * Gemini Deep Analysis Engine — sibling to gemmaEngine.js
 *
 * Wires BrainSNN's manipulation analysis, multimodal RAG captioning, and
 * counter-draft rewrite to Google's Gemini models via Google AI Studio.
 *
 * Configure via env vars:
 *   VITE_GEMINI_API_KEY    — Google AI Studio key
 *   VITE_GEMINI_MODEL      — gemini-2.5-flash (default) | gemini-2.5-pro
 *   VITE_GEMINI_API_BASE   — optional override (defaults to Google AI Studio)
 *
 * Return shape is identical to gemmaEngine.analyzeContentWithGemma() so any
 * call site can swap engines without touching downstream code.
 */

import {
  API_KEY,
  MODEL,
  API_BASE,
  isGeminiConfigured,
  getGeminiModel,
} from "./geminiConfig";

// Re-export the cheap config surface so existing *dynamic* importers of this
// module keep working unchanged; static importers use ./geminiConfig directly,
// which lets this engine stay purely dynamically imported (no chunk warning).
export { isGeminiConfigured, getGeminiModel };

function buildUrl(method = "generateContent") {
  return `${API_BASE}/models/${MODEL}:${method}?key=${API_KEY}`;
}

const ANALYSIS_SYSTEM_PROMPT = `You are a cognitive-manipulation analysis engine embedded in BrainSNN. Given input content, return a JSON object with EXACTLY these numeric fields (0-1 floats):
- emotionalActivation: degree of fear/outrage/panic optimization
- cognitiveSuppression: degree of urgency/certainty theater/cognitive overload
- manipulationPressure: overall steering-reaction-over-understanding
- trustErosion: sensationalism / coercive framing risk

Also include:
- evidence: array of up to 10 short phrases from the content that triggered your assessment
- reasoning: 1-2 sentence explanation
- confidence: "low" | "medium" | "high"
- recommendedAction: one sentence advice

Return ONLY valid JSON, no markdown fences, no commentary.`;

const MULTIMODAL_SYSTEM_PROMPT = `You are a multimodal cognitive-manipulation analysis engine. Analyse the provided media (image, video frame, or audio transcript) for manipulation patterns: emotional triggers, fear appeals, urgency cues, misleading framing, sensationalism.

Return ONLY a JSON object with these fields (0-1 floats):
- emotionalActivation, cognitiveSuppression, manipulationPressure, trustErosion
- evidence (array of up to 10 short descriptions of detected patterns)
- reasoning (1-2 sentences)
- confidence: "low" | "medium" | "high"
- recommendedAction (one sentence)`;

const REWRITE_SYSTEM_PROMPT = `You rewrite manipulative content into neutral, calm equivalents while preserving factual claims. Return ONLY JSON: { "rewrite": "..." }. No markdown fences.`;

async function callGemini(parts, systemPrompt, opts = {}) {
  if (!isGeminiConfigured()) {
    throw new Error("Gemini API not configured. Set VITE_GEMINI_API_KEY.");
  }
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      responseMimeType: "application/json",
    },
  });

  const res = await fetch(buildUrl("generateContent"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Unexpected Gemini response structure");
  return raw;
}

function parseAnalysis(raw) {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  return {
    emotionalActivation: clamp(parsed.emotionalActivation),
    cognitiveSuppression: clamp(parsed.cognitiveSuppression),
    manipulationPressure: clamp(parsed.manipulationPressure),
    trustErosion: clamp(parsed.trustErosion),
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.slice(0, 10)
      : [],
    reasoning: parsed.reasoning || "",
    confidence: ["low", "medium", "high"].includes(parsed.confidence)
      ? parsed.confidence
      : "medium",
    recommendedAction: parsed.recommendedAction || "",
    source: `gemini:${MODEL}`,
  };
}

export async function analyzeContentWithGemini(text) {
  const raw = await callGemini([{ text }], ANALYSIS_SYSTEM_PROMPT);
  return parseAnalysis(raw);
}

export async function analyzeMultimodalWithGemini(file) {
  const buffer = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const mimeType = file.type || "image/png";
  const parts = [
    { text: "Analyse this media for cognitive manipulation patterns." },
    { inlineData: { mimeType, data: base64 } },
  ];
  const raw = await callGemini(parts, MULTIMODAL_SYSTEM_PROMPT);
  return parseAnalysis(raw);
}

export async function captionWithGemini(file) {
  const buffer = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const mimeType = file.type || "image/png";
  const parts = [
    {
      text: 'Describe this image in one factual sentence. Return JSON: { "caption": "..." }.',
    },
    { inlineData: { mimeType, data: base64 } },
  ];
  const raw = await callGemini(
    parts,
    "You produce neutral, factual one-sentence image captions. Return ONLY JSON.",
  );
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  return JSON.parse(cleaned).caption || "";
}

export async function rewriteWithGemini(text) {
  const raw = await callGemini([{ text }], REWRITE_SYSTEM_PROMPT, {
    temperature: 0.4,
  });
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  return JSON.parse(cleaned).rewrite || "";
}

/**
 * Generic JSON-mode prompt — for use by knowledge gap analysis, classifiers,
 * and any caller that wants Gemini to return arbitrary structured JSON.
 */
export async function callGeminiJson(
  prompt,
  { temperature = 0.3, maxOutputTokens = 2048 } = {},
) {
  const raw = await callGemini(
    [{ text: prompt }],
    "Return ONLY valid JSON, no markdown fences.",
    { temperature, maxOutputTokens },
  );
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  return JSON.parse(cleaned);
}

export async function checkGeminiHealth() {
  if (!isGeminiConfigured()) return { ok: false, reason: "not_configured" };
  try {
    const t0 = Date.now();
    const result = await analyzeContentWithGemini(
      "This is a neutral test sentence with no manipulation.",
    );
    return { ok: true, model: MODEL, latency: Date.now() - t0, result };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
