// hackathon/codex-prep/firewallIntent.js
//
// SCAFFOLD for `brainsnn-r3f-app/src/utils/firewallIntent.js`.
//
// Claude wrote everything in this file EXCEPT the body of
// `classifyIntent()` (the actual Gemma call) and the system prompt
// content. Codex: copy this to brainsnn-r3f-app/src/utils/, fill in
// the two TODO blocks, and ship. The cache layer, error handling,
// merge function, and exports already match INTEGRATION.md.
//
// References:
// - Spec:  hackathon/INTEGRATION.md
// - Tests: hackathon/codex-prep/firewallIntent.test.js
// - Cache: hackathon/cache/intent-scores.example.json
//
// Once dropped into brainsnn-r3f-app/src/utils/, integrate via:
//   1. Update scoreContentSmart() in cognitiveFirewall.js to merge
//      classifyIntent() results into the returned score.
//   2. Add an `intent classifier` toggle to CognitiveFirewallPanel.jsx
//      that gates whether classifyIntent() is called per-scan.
//   3. Wire the toggle to a localStorage flag for persistence.

import { isGemmaConfigured } from "./gemmaEngine.js";

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MODEL = "gemma-4-31b-it";
const DEFAULT_CACHE_KEY = "brainsnn-firewall-intent-cache-v1";

// In-memory cache for the current session. Populated lazily from
// localStorage on first access; written back on every successful
// classify call.
let _memCache = null;

function loadCacheFromLocalStorage() {
  if (_memCache) return _memCache;
  if (typeof localStorage === "undefined") {
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
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DEFAULT_CACHE_KEY, JSON.stringify(_memCache));
  } catch (_e) {
    // Quota exceeded or storage unavailable. Silently degrade.
  }
}

async function sha256Hex(text) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node fallback (used in tests).
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex");
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
  return isGemmaConfigured();
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
 * @param {string} [opts.model='gemma-4-31b-it']
 * @param {boolean} [opts.cache=true]
 * @param {number} [opts.timeout_ms=4000]
 * @returns {Promise<IntentResult>}
 */
export async function classifyIntent(text = "", opts = {}) {
  const {
    model = DEFAULT_MODEL,
    cache = true,
    timeout_ms = DEFAULT_TIMEOUT_MS,
  } = opts;
  const trimmed = (text || "").trim();
  if (trimmed.split(/\s+/).filter(Boolean).length < 5) {
    return emptyIntent("too_short");
  }

  const cacheKey = await sha256Hex(`${model}:${trimmed}`);
  const cacheStore = loadCacheFromLocalStorage();

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
    return {
      ...score,
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

  return {
    ...score,
    intentLabels: intent.intentLabels,
    combinedManipulationPressure: combinedManip,
    combinedTrustErosion: combinedTrust,
    brainRegionShift: intent.brainRegionShift || { from: null, to: null },
    source: "hybrid",
  };
}

/**
 * INTERNAL: actually call Gemma 4 with the intent classifier system
 * prompt and parse the JSON response.
 *
 * Codex: this is the function to fill in. Use the Gemma client from
 * gemmaEngine.js (callGemma is internal but you can model after
 * analyzeContentWithGemma). The system prompt skeleton is at
 * hackathon/INTEGRATION.md "System prompt for Gemma" section.
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
  // TODO(Codex): implement Gemma call here.
  //
  // Reference: brainsnn-r3f-app/src/utils/gemmaEngine.js
  // - analyzeContentWithGemma(text) is the existing pattern; mirror it
  //   with INTENT_CLASSIFIER_SYSTEM_PROMPT instead.
  // - Honor `model` parameter (allow override of default Gemma model).
  // - Parse response.text() as JSON. If parsing fails, throw — the
  //   caller catches and degrades gracefully.
  // - Filter intentLabels to the allowed taxonomy from
  //   INTEGRATION.md (37 ids). Drop unknown ids silently.
  //
  // System prompt template at hackathon/INTEGRATION.md
  // "System prompt for Gemma (starting point)" section. Iterate on
  // it against the per-corpus expected outputs in INTEGRATION.md
  // (assertions in firewallIntent.test.js).

  throw new Error(
    "classifyIntent: Gemma call not implemented yet (Codex pickup)",
  );
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
    _callGemmaForIntent = fn;
  },
  resetMockClassifier() {
    // Caller must re-import to reset; this file does not auto-restore.
  },
  clearCache() {
    _memCache = {};
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(DEFAULT_CACHE_KEY);
      } catch (_e) {}
    }
  },
};
