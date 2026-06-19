/**
 * Server-side Crumb LLM scorer.
 *
 * Production should configure CRUMB_LLM_URL and CRUMB_LLM_KEY as Railway
 * service variables. The browser may still use VITE_CRUMB_LLM_URL for local
 * experiments, but privileged Crumb credentials belong here, never in Vite.
 */

const API_BASE = (
  process.env.CRUMB_LLM_URL ||
  process.env.VITE_CRUMB_LLM_URL ||
  ""
).replace(/\/$/, "");
const API_KEY = process.env.CRUMB_LLM_KEY || "";
const MODEL = process.env.CRUMB_LLM_MODEL || "crumb-llm";
const TIMEOUT_MS = Number(process.env.CRUMB_LLM_TIMEOUT_MS) || 12000;

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export function isCrumbServerConfigured() {
  return API_BASE.length > 0;
}

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function normalizeCrumbAnalysis(raw) {
  const body = raw?.score || raw?.analysis || raw?.result || raw || {};
  const scores = body.scores || body.affect || body.metrics || {};
  return {
    emotionalActivation: clamp(
      pick(
        body.emotionalActivation,
        body.emotional_activation,
        scores.emotionalActivation,
        scores.emotional_activation,
        scores.affectiveScore,
      ),
    ),
    cognitiveSuppression: clamp(
      pick(
        body.cognitiveSuppression,
        body.cognitive_suppression,
        scores.cognitiveSuppression,
        scores.cognitive_suppression,
        scores.cognitiveLoad,
      ),
    ),
    manipulationPressure: clamp(
      pick(
        body.manipulationPressure,
        body.manipulation_pressure,
        scores.manipulationPressure,
        scores.manipulation_pressure,
        scores.behaviorPressure,
      ),
    ),
    trustErosion: clamp(
      pick(
        body.trustErosion,
        body.trust_erosion,
        scores.trustErosion,
        scores.trust_erosion,
        scores.brandRisk,
      ),
    ),
    evidence: asArray(body.evidence || body.phrases || body.signals)
      .map((item) =>
        typeof item === "string"
          ? item
          : item?.phrase || item?.text || item?.label || "",
      )
      .filter(Boolean)
      .slice(0, 10),
    reasoning: body.reasoning || body.explanation || "",
    confidence: ["low", "medium", "high"].includes(body.confidence)
      ? body.confidence
      : "medium",
    recommendedAction:
      body.recommendedAction ||
      body.recommended_action ||
      body.recommendation ||
      "",
    source: body.source || `crumb-llm:${MODEL}`,
  };
}

export async function analyzeWithCrumbServer(text) {
  if (!isCrumbServerConfigured()) {
    throw new Error("CRUMB_LLM_URL not set");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        text: String(text).slice(0, 12000),
        task: "brainsnn-affective-scan",
        output: "cognitive-firewall-v1",
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Crumb LLM ${res.status}: ${errText.slice(0, 160)}`);
    }

    return normalizeCrumbAnalysis(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
