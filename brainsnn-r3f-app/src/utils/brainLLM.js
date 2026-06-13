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
import { looksLikeUrl, fetchUrlText, domainOf } from "./urlScan.js";

const CRUMB_LLM_URL = (import.meta.env.VITE_CRUMB_LLM_URL || "").replace(
  /\/$/,
  "",
);
// SECURITY: VITE_* vars are inlined into the public client bundle. Do NOT put a
// privileged/billable Crumb LLM token here — it would be visible in page source.
// Use a short-lived/per-origin token, or (preferred) proxy through the BrainSNN
// server so the real key never reaches the browser.
const CRUMB_LLM_KEY = import.meta.env.VITE_CRUMB_LLM_KEY || "";
const CRUMB_LLM_TIMEOUT_MS = 12000;

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
  raw = raw || {};
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CRUMB_LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${CRUMB_LLM_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CRUMB_LLM_KEY ? { Authorization: `Bearer ${CRUMB_LLM_KEY}` } : {}),
      },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Crumb LLM ${res.status}`);
    return normalize(await res.json(), "crumb-llm");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Analyze content for the brain. Accepts EITHER text OR a bare link — the one
 * front door for the whole app. A link is fetched into clean article text
 * (via the server reader) and THAT is scored, so "paste a link and scan it"
 * reads the page, not the URL string. Always resolves to a score object — never
 * throws — so the main page scan flow degrades gracefully to local regex.
 *
 * @param {string} input            text or a bare URL
 * @param {object} [opts]
 * @param {(stage:object)=>void} [opts.onStage]  progress hook:
 *        { phase: "reading"|"scoring", domain? }
 */
export async function analyzeForBrain(input = "", opts = {}) {
  const { onStage } = opts;
  const raw = String(input).trim();
  if (!raw) return { ...scoreContent(""), source: "regex" };

  // --- Link path: read the page, then score its text ----------------------
  if (looksLikeUrl(raw)) {
    const domain = domainOf(raw);
    onStage?.({ phase: "reading", domain });
    const page = await fetchUrlText(raw);
    if (!page.ok) {
      // Don't score the raw URL (it would read as "too short"). Surface a
      // friendly, actionable error the hero can render instead of a fake score.
      return {
        ...scoreContent(""),
        source: "url_error",
        fetchError: page.error,
        fetchedFrom: { url: page.url, domain },
      };
    }
    onStage?.({ phase: "scoring", domain });
    const score = await analyzeText(page.text);
    return {
      ...score,
      scannedText: page.text,
      fetchedFrom: {
        url: page.url,
        domain,
        title: page.title,
        words: page.words,
      },
    };
  }

  // --- Text path ----------------------------------------------------------
  onStage?.({ phase: "scoring" });
  return analyzeText(raw);
}

/** Score already-extracted text through the swappable backend chain. */
async function analyzeText(trimmed) {
  if (CRUMB_LLM_URL) {
    try {
      // Mirror the safety pre-screen scoreContentSmart applies before any
      // remote call: block prompt-injection / secret leakage and redact PII
      // BEFORE the content leaves the browser for the Crumb LLM endpoint.
      const { inspectPrompt } = await import("./lobsterTrap.js");
      const trap = inspectPrompt({
        prompt: trimmed,
        surface: "brainllm.crumb",
      });
      if (trap.action === "block") {
        return {
          ...scoreContent(trimmed),
          source: "regex_lobster_blocked",
          lobsterTrap: trap,
        };
      }
      const safeText =
        trap.action === "redact" && trap.redacted ? trap.redacted : trimmed;
      const result = await analyzeWithCrumbLlm(safeText);
      return { ...result, lobsterTrap: trap };
    } catch (_err) {
      // Endpoint unreachable / slow / aborted — fall back to the smart chain.
    }
  }

  return scoreContentSmart(trimmed);
}
