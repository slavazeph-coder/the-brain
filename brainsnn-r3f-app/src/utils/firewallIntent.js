// LLM-backed intent classifier for the Cognitive Firewall.
//
// References:
// - Spec:  hackathon/INTEGRATION.md
// - Tests: hackathon/codex-prep/firewallIntent.test.js
// - Cache: hackathon/cache/intent-scores.example.json

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MODEL = "gemini-2.5-flash";
const ESCALATION_MODEL = "gemini-2.5-pro"; // used when Flash returns low-confidence labels only
const DEFAULT_CACHE_KEY = "brainsnn-firewall-intent-cache-v1";
const GOOGLE_GENERATE_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
const SERVER_PROXY_PATH = "/api/intent-classify";
const STATIC_CACHE_PATH = "/api/intent-cache";

// In-memory cache for the current session. Populated lazily from
// localStorage on first access; written back on every successful
// classify call.
let _memCache = null;
let _staticCacheLoaded = false;
let _mockClassifier = null;

function runtimeEnv() {
  const viteEnv = import.meta.env || {};
  const nodeEnv =
    typeof process !== "undefined" && process.env ? process.env : {};
  return { ...nodeEnv, ...viteEnv };
}

function envValue(...keys) {
  const env = runtimeEnv();
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function defaultModel() {
  return envValue("TRIBE_GEMMA_MODEL", "VITE_GEMMA_MODEL") || DEFAULT_MODEL;
}

function fallbackModel() {
  return (
    envValue("TRIBE_FALLBACK_MODEL", "VITE_GEMMA_FALLBACK_MODEL") ||
    ESCALATION_MODEL
  );
}

function apiKey() {
  return envValue(
    "TRIBE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "VITE_GEMMA_API_KEY",
  );
}

function configuredEndpoint() {
  return envValue("VITE_GEMMA_API_ENDPOINT", "GEMMA_API_ENDPOINT");
}

function isBrowserRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isGoogleEndpoint(url) {
  return /generativelanguage\.googleapis\.com/i.test(url || "");
}

function endpointForModel(model) {
  const endpoint = configuredEndpoint();
  if (!endpoint) return `${GOOGLE_GENERATE_BASE}/${model}:generateContent`;
  if (!isGoogleEndpoint(endpoint)) return endpoint;
  return endpoint.replace(
    /\/models\/[^/:]+:generateContent(?:\?.*)?$/i,
    `/models/${model}:generateContent`,
  );
}

function hasDirectGeminiConfig() {
  const endpoint = configuredEndpoint();
  if (endpoint && !isGoogleEndpoint(endpoint)) return true;
  return Boolean(apiKey());
}

function loadCacheFromLocalStorage() {
  if (_memCache) return _memCache;
  if (!isBrowserRuntime() || typeof localStorage === "undefined") {
    _memCache = {};
    return _memCache;
  }
  try {
    const raw = localStorage.getItem(DEFAULT_CACHE_KEY);
    _memCache = raw ? JSON.parse(raw) : {};
  } catch (_e) {
    _memCache = {};
  }
  return _memCache;
}

function persistCacheToLocalStorage() {
  if (!isBrowserRuntime() || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DEFAULT_CACHE_KEY, JSON.stringify(_memCache));
  } catch (_e) {
    // Quota exceeded or storage unavailable. Silently degrade.
  }
}

async function hydrateStaticIntentCache() {
  if (_staticCacheLoaded || !isBrowserRuntime()) return;
  _staticCacheLoaded = true;
  try {
    const res = await fetch(STATIC_CACHE_PATH, { cache: "force-cache" });
    if (!res.ok) return;
    const payload = await res.json();
    preloadIntentCache(payload);
  } catch (_e) {
    // Static cache is optional. Live classification or regex fallback still works.
  }
}

async function sha256Hex(text) {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto?.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await runtimeCrypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  throw new Error("SHA-256 is unavailable in this runtime");
}

function emptyIntent(source = "unavailable", extras = {}) {
  return {
    intentLabels: [],
    intentManipulationDelta: 0,
    intentTrustErosionDelta: 0,
    brainRegionShift: { from: null, to: null },
    source,
    cached: false,
    latency_ms: 0,
    ...extras,
  };
}

/**
 * Returns true if the intent classifier can run (Gemma configured).
 * Mirrors isGemmaConfigured() so callers don't need to import both.
 */
export function isIntentClassifierAvailable() {
  return Boolean(
    _mockClassifier || hasDirectGeminiConfig() || isBrowserRuntime(),
  );
}

/**
 * Preload the cache from a JSON object (used by the precompute CLI
 * and by the demo wrapper to inject pre-warmed scores before
 * recording). Merges with any existing in-memory cache.
 */
export function preloadIntentCache(cacheObject = {}) {
  const cache = loadCacheFromLocalStorage();
  for (const [key, value] of Object.entries(cacheObject)) {
    cache[key] = value;
  }
  persistCacheToLocalStorage();
}

/**
 * Classify the manipulation intent of a piece of text.
 *
 * Always resolves — never throws on API failure (returns
 * { intentLabels: [], source: 'unavailable' } instead).
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.model='gemini-2.5-flash']
 * @param {boolean} [opts.cache=true]
 * @param {number} [opts.timeout_ms=4000]
 * @returns {Promise<IntentResult>}
 */
export async function classifyIntent(text = "", opts = {}) {
  const {
    model = defaultModel(),
    cache = true,
    timeout_ms = DEFAULT_TIMEOUT_MS,
  } = opts;
  const trimmed = (text || "").trim();
  if (trimmed.split(/\s+/).filter(Boolean).length < 5) {
    return emptyIntent("too_short");
  }

  const cacheKey = await sha256Hex(`${model}:${trimmed}`);
  const cacheStore = loadCacheFromLocalStorage();

  if (cache) {
    await hydrateStaticIntentCache();
  }

  if (cache && cacheStore[cacheKey]) {
    return {
      ...cacheStore[cacheKey],
      cached: true,
      source: "cache",
      latency_ms: 0,
    };
  }

  if (!isIntentClassifierAvailable()) {
    return emptyIntent("unavailable");
  }

  const start = Date.now();
  try {
    const result = await Promise.race([
      _callGemmaForIntent(trimmed, model),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("intent-classifier-timeout")),
          timeout_ms,
        ),
      ),
    ]);

    const enriched = {
      ...result,
      source: "gemma",
      cached: false,
      latency_ms: Date.now() - start,
    };

    if (cache) {
      cacheStore[cacheKey] = enriched;
      persistCacheToLocalStorage();
    }

    return enriched;
  } catch (err) {
    return emptyIntent("fallback_to_regex", {
      latency_ms: Date.now() - start,
      error: err?.message || String(err),
    });
  }
}

/**
 * Merge an IntentResult into a deterministic Score object.
 * Returns a new object with the same shape as scoreContent() returns,
 * plus `intentLabels`, `combinedManipulationPressure`,
 * `combinedTrustErosion`, and `source: 'hybrid'`.
 */
export function mergeIntentIntoScore(score, intent) {
  if (!intent || !intent.intentLabels || intent.intentLabels.length === 0) {
    const clearedTemplate = intent?.explicitlyClearsTemplate;
    const templates =
      clearedTemplate && Array.isArray(score.templates)
        ? score.templates.filter((tpl) => tpl.id !== clearedTemplate)
        : score.templates;
    return {
      ...score,
      templates,
      intentLabels: [],
      combinedManipulationPressure: score.manipulationPressure || 0,
      combinedTrustErosion: score.trustErosion || 0,
      source:
        intent?.source === "unavailable"
          ? "regex_only"
          : score.source || "regex_only",
    };
  }

  const baseManip = score.manipulationPressure || 0;
  const baseTrust = score.trustErosion || 0;
  const combinedManip = Math.min(
    1,
    Math.max(baseManip, baseManip + (intent.intentManipulationDelta || 0)),
  );
  const combinedTrust = Math.min(
    1,
    Math.max(baseTrust, baseTrust + (intent.intentTrustErosionDelta || 0)),
  );
  const baseOverall =
    ((score.emotionalActivation || 0) +
      (score.cognitiveSuppression || 0) +
      baseManip) /
    3;
  const overallRisk = Math.min(
    1,
    Math.max(baseOverall, combinedManip * 0.86, combinedTrust * 0.72),
  );

  return {
    ...score,
    baseManipulationPressure: baseManip,
    baseTrustErosion: baseTrust,
    manipulationPressure: combinedManip,
    trustErosion: combinedTrust,
    intentLabels: intent.intentLabels,
    combinedManipulationPressure: combinedManip,
    combinedTrustErosion: combinedTrust,
    overallRisk,
    brainRegionShift: intent.brainRegionShift || { from: null, to: null },
    source: "hybrid",
  };
}

/**
 * INTERNAL: call Gemini/Gemma with the intent classifier system
 * prompt and parse the JSON response.
 *
 * Required output shape (parsed from Gemma's JSON response):
 *   {
 *     intentLabels: [{ id, confidence, evidence }, ...],
 *     intentManipulationDelta: number,
 *     intentTrustErosionDelta: number,
 *     brainRegionShift: { from, to }
 *   }
 *
 * If Gemma returns invalid JSON or a label outside the taxonomy,
 * filter to known labels and let the rest fall through.
 */
async function _callGemmaForIntent(text, model) {
  if (_mockClassifier) {
    return sanitizeIntentResult(await _mockClassifier(text, model));
  }

  if (!hasDirectGeminiConfig() && isBrowserRuntime()) {
    const proxied = await callIntentProxy(text, model);
    if (["unavailable", "fallback_to_regex", "too_short"].includes(proxied?.source)) {
      throw new Error(proxied.error || proxied.source);
    }
    return sanitizeIntentResult(proxied);
  }

  const primary = sanitizeIntentResult(await callIntentModel(text, model));
  if (shouldEscalate(primary, model)) {
    return sanitizeIntentResult(await callIntentModel(text, fallbackModel()));
  }
  return primary;
}

function shouldEscalate(result, model) {
  if (model !== DEFAULT_MODEL && model !== defaultModel()) return false;
  if (fallbackModel() === model) return false;
  const labels = result.intentLabels || [];
  if (labels.length === 0) return result.intentManipulationDelta >= 0.2;
  const topConfidence = Math.max(...labels.map((label) => label.confidence || 0));
  return topConfidence < 0.7 && result.intentManipulationDelta >= 0.35;
}

async function callIntentProxy(text, model) {
  const res = await fetch(SERVER_PROXY_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, model }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Intent proxy ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

async function callIntentModel(text, model) {
  const endpoint = endpointForModel(model);
  const key = apiKey();
  const googleStyle = isGoogleEndpoint(endpoint);
  if (googleStyle && !key) {
    throw new Error("TRIBE_API_KEY is required for Gemini intent classification");
  }

  const headers = { "Content-Type": "application/json" };
  let url = endpoint;
  let body;

  if (googleStyle) {
    const sep = endpoint.includes("?") ? "&" : "?";
    url = `${endpoint}${sep}key=${encodeURIComponent(key)}`;
    body = JSON.stringify({
      system_instruction: { parts: [{ text: buildIntentSystemPrompt() }] },
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 1400,
        responseMimeType: "application/json",
      },
    });
  } else {
    if (key) headers.Authorization = `Bearer ${key}`;
    body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildIntentSystemPrompt() },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 1400,
      response_format: { type: "json_object" },
    });
  }

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini intent API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  return parseIntentResponse(extractModelText(json));
}

function extractModelText(json) {
  const googleText = json?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("");
  if (googleText) return googleText;
  const openAiText = json?.choices?.[0]?.message?.content;
  if (openAiText) return openAiText;
  throw new Error("Unexpected intent classifier response structure");
}

function parseIntentResponse(raw) {
  const cleaned = String(raw || "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw _err;
    return JSON.parse(match[0]);
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizeRegion(region) {
  if (region === null || region === undefined || region === "") return null;
  const normalized = String(region).toUpperCase();
  const mapped = normalized === "AMY" ? "AMG" : normalized;
  return ["CTX", "HPC", "THL", "AMG", "BG", "PFC", "CBL"].includes(mapped)
    ? mapped
    : null;
}

function sanitizeIntentResult(raw = {}) {
  const labels = Array.isArray(raw.intentLabels)
    ? raw.intentLabels
        .map((label) => ({
          id: String(label?.id || ""),
          confidence: clamp01(label?.confidence),
          evidence: String(label?.evidence || "").slice(0, 220),
        }))
        .filter(
          (label) =>
            ALLOWED_INTENT_IDS.includes(label.id) && label.confidence >= 0.5,
        )
        .slice(0, 8)
    : [];

  const hasLabels = labels.length > 0;
  return {
    intentLabels: labels,
    intentManipulationDelta: hasLabels ? clamp01(raw.intentManipulationDelta) : 0,
    intentTrustErosionDelta: hasLabels ? clamp01(raw.intentTrustErosionDelta) : 0,
    brainRegionShift: {
      from: normalizeRegion(raw.brainRegionShift?.from),
      to: normalizeRegion(raw.brainRegionShift?.to),
    },
    ...(typeof raw.explicitlyClearsTemplate === "string"
      ? { explicitlyClearsTemplate: raw.explicitlyClearsTemplate }
      : {}),
  };
}

function buildIntentSystemPrompt() {
  return `You are BrainSNN's cognitive-manipulation intent classifier.

Return ONLY a JSON object with this exact shape:
{
  "intentLabels": [{"id": "<allowed-id>", "confidence": 0.0, "evidence": "short quote"}],
  "intentManipulationDelta": 0.0,
  "intentTrustErosionDelta": 0.0,
  "brainRegionShift": {"from": "CTX|HPC|THL|AMG|BG|PFC|CBL|null", "to": "CTX|HPC|THL|AMG|BG|PFC|CBL|null"}
}

Allowed ids: ${ALLOWED_INTENT_IDS.join(", ")}.

Rules:
- Include only labels with confidence >= 0.5.
- Use exact short quotes from the input as evidence.
- Prefer high precision over exhaustive labeling.
- A benign medical/procedural briefing is not conspiracy content just because it says a patient will "wake up" in recovery.
- Label legitimate but over-tuned safety warnings as "safety-overcalibration" instead of malicious deception.
- If no manipulation pattern is present, return empty labels, zero deltas, and null target region.
- Region mapping: AMG=fear/threat, BG=action gating/compliance, THL=salience/interruption, PFC=executive control/decision laundering, HPC=memory/evidence, CTX=analysis, CBL=motor/autonomy.

Few-shot examples:

Input: "Don't loop finance in yet. I'm boarding in 20 minutes. Send the wire to Routing: 021000021 Account: 9442190885."
Output: {"intentLabels":[{"id":"authority-pressure","confidence":0.92,"evidence":"I'm boarding in 20 minutes"},{"id":"secrecy-request","confidence":0.95,"evidence":"Don't loop finance in yet"},{"id":"procedural-bypass","confidence":0.88,"evidence":"Don't loop finance in yet"},{"id":"time-fence","confidence":0.8,"evidence":"boarding in 20 minutes"},{"id":"funds-redirect","confidence":0.96,"evidence":"Routing: 021000021 Account: 9442190885"}],"intentManipulationDelta":0.78,"intentTrustErosionDelta":0.45,"brainRegionShift":{"from":"CTX","to":"BG"}}

Input: "You will wake up in recovery with a nurse next to you. Most patients report feeling thirsty and a little disoriented for about twenty minutes. That is normal."
Output: {"intentLabels":[],"intentManipulationDelta":0,"intentTrustErosionDelta":0,"brainRegionShift":{"from":"HPC","to":null},"explicitlyClearsTemplate":"hidden-truth"}

Input: "10 SECONDS UNTIL CONTROL HANDOFF. Your driver score will be downgraded if you fail to comply."
Output: {"intentLabels":[{"id":"safety-overcalibration","confidence":0.9,"evidence":"10 SECONDS UNTIL CONTROL HANDOFF"},{"id":"consequence-laundering","confidence":0.55,"evidence":"Your driver score will be downgraded"}],"intentManipulationDelta":0.2,"intentTrustErosionDelta":0.3,"brainRegionShift":{"from":"AMG","to":"AMG"}}`;
}

// Allowed intent label taxonomy. See INTEGRATION.md for descriptions.
// Exported so the merge step + tests + UI can validate labels.
export const ALLOWED_INTENT_IDS = [
  "authority-impersonation",
  "authority-pressure",
  "authority-namedrop",
  "authority-bypass",
  "authority-flattery",
  "loss-aversion",
  "consequence-laundering",
  "time-fence",
  "secrecy-request",
  "procedural-bypass",
  "peer-priming",
  "peer-pressure",
  "bystander-pressure",
  "reputational-threat",
  "outcome-fence",
  "friction-reframe",
  "false-relief",
  "credential-elicitation",
  "identity-proof-bypass",
  "executable-attachment-bait",
  "family-emergency-pretext",
  "voice-clone-pattern",
  "funds-redirect",
  "fabricated-authority",
  "fear-of-falling-behind",
  "competitive-pressure",
  "fake-scarcity",
  "identity-attack-framing",
  "bandwagon-pressure",
  "false-cause-certainty",
  "link-fenced-urgency",
  "dissent-suppression",
  "decision-laundering",
  "emotional-hijack",
  "autonomy-override",
  "commercial-bias",
  "safety-overcalibration",
];

// Test hook — exposed for unit tests to inject a fake Gemma response
// without going through the network. Only used when running under
// vitest / jest.
export const __test__ = {
  setMockClassifier(fn) {
    _mockClassifier = fn;
  },
  resetMockClassifier() {
    _mockClassifier = null;
  },
  clearCache() {
    _memCache = {};
    _staticCacheLoaded = false;
    _mockClassifier = null;
    if (isBrowserRuntime() && typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(DEFAULT_CACHE_KEY);
      } catch (_e) {}
    }
  },
};
