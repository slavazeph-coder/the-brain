import { detectTemplates } from "./propagandaTemplates.js";
import {
  detectLanguage,
  patternsFor,
  labelFor as languageLabel,
} from "./firewallI18n.js";
// The lexicons + scorer live in firewallCore so the on-page scan, the public
// /api/score endpoint, and the SSE stream all share one definition (guarded by
// src/utils/firewall-parity.test.js).
import { EN_RULES, scoreWithRules } from "./firewallCore.js";

/**
 * Default ruleset — the shared English lexicons. Exposed so Layer 31 (Brain
 * Evolve) can clone, mutate, and evolve firewall patterns without editing this
 * file, and so custom rules can layer onto it.
 */
export const DEFAULT_RULES = EN_RULES;

/**
 * Serialize a ruleset to a JSON-safe shape — each category becomes
 * `[{ source, flags }]`. Used by the evolve engine for snapshots + persistence.
 */
export function serializeRules(rules = DEFAULT_RULES) {
  const out = {};
  for (const [cat, patterns] of Object.entries(rules)) {
    out[cat] = patterns.map((re) => ({ source: re.source, flags: re.flags }));
  }
  return out;
}

/**
 * Inverse of serializeRules — rehydrates a JSON ruleset into RegExp objects.
 * Invalid patterns are silently dropped (evolution may produce broken regex).
 */
export function deserializeRules(serialized) {
  const out = {};
  for (const [cat, items] of Object.entries(serialized || {})) {
    out[cat] = (items || [])
      .map((it) => {
        try {
          return new RegExp(it.source, it.flags || "gi");
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  return out;
}

export const SCORE_FIELDS = [
  {
    key: "emotionalActivation",
    label: "Emotional activation",
    desc: "Fear / outrage / panic optimization",
    color: "#dd6974",
    regions: "AMY + THL",
  },
  {
    key: "cognitiveSuppression",
    label: "Cognitive suppression",
    desc: "Urgency / certainty theater / overload",
    color: "#fdab43",
    regions: "PFC dampens",
  },
  {
    key: "manipulationPressure",
    label: "Manipulation pressure",
    desc: "Steering reaction over understanding",
    color: "#a86fdf",
    regions: "BG rises",
  },
  {
    key: "trustErosion",
    label: "Trust erosion risk",
    desc: "Sensationalism / coercive framing",
    color: "#5591c7",
    regions: "composite",
  },
];

/**
 * Score content against an arbitrary ruleset — the hot path Brain Evolve uses to
 * benchmark candidate rulesets against the red-team corpus. Delegates to the
 * shared firewallCore scorer so client + server stay byte-identical.
 */
export const scoreContentWithRules = scoreWithRules;

// ---------- active ruleset (Layer 31 hook) ----------
// Starts as a reference to DEFAULT_RULES. Layer 31's "Promote winner" replaces
// this with an evolved set; callers of scoreContent() automatically pick it up.
let _activeRules = DEFAULT_RULES;

export function getActiveRules() {
  return _activeRules;
}

export function setActiveRules(rules) {
  _activeRules = rules || DEFAULT_RULES;
}

export function resetActiveRules() {
  _activeRules = DEFAULT_RULES;
}

export function scoreContent(text = "") {
  // Layer 52 — route to a language-specific pack when the active rules
  // are the default English set. Manual promotion via setActiveRules
  // always wins (user intent > auto-detection).
  const lang = detectLanguage(text);
  let rules = _activeRules;
  if (_activeRules === DEFAULT_RULES) {
    const packed = patternsFor(lang);
    if (packed) rules = packed;
  }
  const base = scoreContentWithRules(text, rules);
  // Layer 39 — decorate with named propaganda templates.
  base.templates = detectTemplates(text);
  // Layer 52 — record which language pack was used
  base.language = lang;
  base.languageLabel = languageLabel(lang);
  return base;
}

/**
 * Smart scoring — prefers Gemini, then Gemma, then regex.
 * Returns a promise that always resolves to a score object.
 */
export async function scoreContentSmart(text = "") {
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 5) return { ...scoreContent(text), source: "regex" };

  // Pre-screen every AI scan with Lobster Trap. Blocks prompt-injection
  // and secret leaks before they leave the browser; redacts PII inline.
  const { inspectPrompt } = await import("./lobsterTrap.js");
  const trap = inspectPrompt({ prompt: text, surface: "firewall.smart" });
  if (trap.action === "block") {
    return {
      ...scoreContent(text),
      source: "regex_lobster_blocked",
      lobsterTrap: trap,
    };
  }
  const safeText =
    trap.action === "redact" && trap.redacted ? trap.redacted : text;

  const { isGeminiConfigured, analyzeContentWithGemini } =
    await import("./geminiEngine.js");
  if (isGeminiConfigured()) {
    try {
      const result = await analyzeContentWithGemini(safeText);
      return { ...result, lobsterTrap: trap };
    } catch (_err) {
      // fall through to Gemma
    }
  }

  const { isGemmaConfigured, analyzeContentWithGemma } =
    await import("./gemmaEngine.js");
  if (isGemmaConfigured()) {
    try {
      const result = await analyzeContentWithGemma(safeText);
      return { ...result, lobsterTrap: trap };
    } catch (_err) {
      return {
        ...scoreContent(text),
        source: "regex_fallback",
        lobsterTrap: trap,
      };
    }
  }
  return { ...scoreContent(text), source: "regex" };
}

export function mapTRIBEToRegions(state, tribe) {
  const { emotionalActivation, cognitiveSuppression, manipulationPressure } =
    tribe;

  return {
    ...state,
    regions: {
      ...state.regions,
      AMY: Math.min(0.95, state.regions.AMY + emotionalActivation * 0.28),
      THL: Math.min(0.95, state.regions.THL + emotionalActivation * 0.18),
      PFC: Math.max(0.04, state.regions.PFC - cognitiveSuppression * 0.22),
      BG: Math.min(0.95, state.regions.BG + manipulationPressure * 0.16),
      CTX: Math.max(0.06, state.regions.CTX - cognitiveSuppression * 0.12),
    },
    burst:
      manipulationPressure > 0.55 ? Math.max(state.burst, 12) : state.burst,
    scenario: "TRIBE V2 Content Scan",
  };
}
