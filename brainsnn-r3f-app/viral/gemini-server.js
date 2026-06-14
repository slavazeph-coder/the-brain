/**
 * Server-side Gemini scorer — the secret-safe twin of src/utils/geminiEngine.js.
 *
 * The client engine reads VITE_GEMINI_API_KEY, which Vite inlines into the
 * PUBLIC browser bundle (anyone can read it in page source). This module runs
 * ONLY on the Node server, so it uses a NON-VITE key — `GEMINI_API_KEY` — that
 * never reaches the browser. /api/score calls this; the on-page scan reaches it
 * by routing through /api/score (VITE_SERVER_SCORING), so the key stays secret.
 *
 * Prompt + parser are kept identical to geminiEngine.js so client-side and
 * server-side semantic scoring produce the same shape. (geminiEngine.js can't
 * be imported here — it pulls in import.meta.env, which is Vite-only.)
 */

const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const API_BASE =
  process.env.GEMINI_API_BASE ||
  "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 12000;

export function isGeminiServerConfigured() {
  return API_KEY.length > 0;
}

export function geminiServerModel() {
  return MODEL;
}

// Mirrors ANALYSIS_SYSTEM_PROMPT in src/utils/geminiEngine.js — keep in sync.
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

const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** Parse Gemini's JSON text into the canonical brain-score shape. */
export function parseGeminiAnalysis(raw) {
  const cleaned = String(raw || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  const parsed = JSON.parse(cleaned);
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

/**
 * Score text with server-side Gemini. Throws on misconfig / network / parse
 * failure so the caller can fall back to the deterministic regex scorer.
 */
export async function analyzeWithGeminiServer(text) {
  if (!isGeminiServerConfigured()) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${API_BASE}/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: ANALYSIS_SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: String(text).slice(0, 12000) }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
        }),
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 160)}`);
    }
    const json = await res.json();
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("unexpected Gemini response structure");
    return parseGeminiAnalysis(raw);
  } finally {
    clearTimeout(timer);
  }
}
