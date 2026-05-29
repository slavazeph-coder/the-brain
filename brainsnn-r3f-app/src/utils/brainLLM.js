/**
 * brainLLM — the single backend-LLM entry point for the main page scan flow.
 *
 * Backend is swappable WITHOUT touching call sites:
 *   1. Crumb LLM   — if VITE_CRUMB_LLM_URL is set, POST the content there.
 *                    (The physics-based O(N log N) model — host it on a GPU
 *                    endpoint and point this env var at it. Not on Railway.)
 *   2. Gemini      — via scoreContentSmart() when VITE_GEMINI_API_KEY is set.
 *   3. Gemma       — next fallback inside scoreContentSmart().
 *   4. Regex       — local Cognitive Firewall, always available, zero config.
 *
 * Every backend resolves to the SAME score shape so the brain mapping
 * (mapTRIBEToRegions) and the hero UI never change:
 *   { emotionalActivation, cognitiveSuppression, manipulationPressure,
 *     trustErosion, evidence[], reasoning, confidence, recommendedAction,
 *     source }
 */

import { scoreContent, scoreContentSmart } from "./cognitiveFirewall.js";

const CRUMB_LLM_URL = (import.meta.env.VITE_CRUMB_LLM_URL || "").replace(
  /\/$/,
  "",
);
const CRUMB_LLM_KEY = import.meta.env.VITE_CRUMB_LLM_KEY || "";

export function activeBackendLabel() {
  if (CRUMB_LLM_URL) return "Crumb LLM";
  // These read import.meta.env at module load in their own files; mirror here.
  if (import.meta.env.VITE_GEMINI_API_KEY) return "Gemini";
  if (import.meta.env.VITE_GEMMA_API_KEY) return "Gemma";
  return "Cognitive Firewall (local)";
}

export function isCrumbLlmConfigured() {
  return CRUMB_LLM_URL.length > 0;
}

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** Normalize any backend payload into the canonical brain-score shape. */
function normalize(raw, source) {
  return {
    emotionalActivation: clamp(raw.emotionalActivation),
    cognitiveSuppression: clamp(raw.cognitiveSuppression),
    manipulationPressure: clamp(raw.manipulationPressure),
    trustErosion: clamp(raw.trustErosion),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 10) : [],
    reasoning: raw.reasoning || "",
    confidence: ["low", "medium", "high"].includes(raw.confidence)
      ? raw.confidence
      : "medium",
    recommendedAction: raw.recommendedAction || "",
    source: raw.source || source,
  };
}

async function analyzeWithCrumbLlm(text) {
  const res = await fetch(`${CRUMB_LLM_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CRUMB_LLM_KEY ? { Authorization: `Bearer ${CRUMB_LLM_KEY}` } : {}),
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Crumb LLM ${res.status}`);
  const json = await res.json();
  return normalize(json, "crumb-llm");
}

/**
 * Analyze content for the brain. Always resolves to a score object — never
 * throws — so the main page scan flow degrades gracefully to local regex.
 */
export async function analyzeForBrain(text = "") {
  const trimmed = text.trim();
  if (!trimmed) return { ...scoreContent(""), source: "regex" };

  if (CRUMB_LLM_URL) {
    try {
      return await analyzeWithCrumbLlm(trimmed);
    } catch (_err) {
      // Crumb LLM endpoint unreachable — fall back to the smart chain.
    }
  }

  return scoreContentSmart(trimmed);
}
