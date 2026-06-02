import { detectTemplates } from "./propagandaTemplates.js";
import {
  detectLanguage,
  patternsFor,
  labelFor as languageLabel,
} from "./firewallI18n.js";

const URGENCY_PATTERNS = [
  /\bnow\b|\bimmediately\b|\burgent\b|\bbreaking\b|\balert\b/gi,
  /\blimited time\b|\bdon't miss\b|\blast chance\b|\bact(?:s)? fast\b/gi,
  /!{2,}|\bWARNING\b|\bCRISIS\b|\bSHOCKING\b/gi,
];

const OUTRAGE_PATTERNS = [
  /\boutrage\b|\bfurious\b|\bscandal\b|\bterrible\b|\bhorrible\b/gi,
  /\bunbelievable\b|\bdisgusting\b|\bshocking\b|\bbetray/gi,
  /\bthey don't want you to know\b|\bhidden\b|\bsecret\b|\bcovered up\b/gi,
];

const CERTAINTY_THEATER = [
  /\b100%\b|\bproven\b|\bguaranteed\b|\bscientifically proven\b|\bfact\b/gi,
  /\beveryone knows\b|\bobviously\b|\bclearly\b|\bundeniably\b/gi,
];

const FEAR_PATTERNS = [
  /\bdie\b|\bdeath\b|\bkill\b|\bdanger\b|\bthreat\b|\bsafe\b|\bunsafe\b/gi,
  /\bvirus\b|\bpandemic\b|\battack\b|\bwar\b|\bcrash\b|\bcollapse\b/gi,
];

/**
 * Default ruleset — exposed so Layer 31 (Brain Evolve) can clone, mutate,
 * and evolve firewall patterns without editing this file.
 */
export const DEFAULT_RULES = {
  urgency: URGENCY_PATTERNS,
  outrage: OUTRAGE_PATTERNS,
  certainty: CERTAINTY_THEATER,
  fear: FEAR_PATTERNS,
};

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

function countMatches(text, patterns) {
  return patterns.reduce((total, re) => {
    const matches = text.match(re);
    return total + (matches ? matches.length : 0);
  }, 0);
}

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function normalize(count, baseline = 3) {
  return clamp(count / baseline);
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
 * Score content against an arbitrary ruleset. This is the hot path used by
 * Layer 31 (Brain Evolve) when benchmarking candidate rulesets against the
 * red team corpus. Results are deterministic when `deterministic: true`.
 */
/**
 * Maps each pattern category to the score dimensions it drives. This is the
 * single source of truth for the per-signal "why this score" breakdown.
 */
const SIGNAL_CATEGORIES = {
  urgency: { label: "Urgency", drives: ["cognitiveSuppression"] },
  outrage: {
    label: "Outrage",
    drives: ["emotionalActivation", "trustErosion"],
  },
  certainty: {
    label: "Certainty theater",
    drives: ["cognitiveSuppression", "trustErosion"],
  },
  fear: { label: "Fear", drives: ["emotionalActivation"] },
};

export function scoreContentWithRules(
  text = "",
  rules = DEFAULT_RULES,
  opts = {},
) {
  // Scores are DETERMINISTIC \u2014 the same text always yields the same numbers.
  // (Reproducibility is the whole point of "proving the lens"; the previous
  // Math.random() jitter is gone. `opts.deterministic` is still accepted for
  // backward-compat but no longer changes the output.)
  void opts;
  const words = text.trim().split(/\s+/).length;
  if (words < 5) {
    return {
      emotionalActivation: 0,
      cognitiveSuppression: 0,
      manipulationPressure: 0,
      trustErosion: 0,
      evidence: [],
      signals: [],
      confidence: "low",
      confidenceScore: 0.15,
      confidenceReason: "Too short to score reliably (under 5 words).",
      recommendedAction: "Too short to score reliably.",
    };
  }

  // Collect matched phrases per category so the score AND the evidence
  // breakdown come from exactly the same data.
  const rulesByCat = {
    urgency: rules.urgency || [],
    outrage: rules.outrage || [],
    certainty: rules.certainty || [],
    fear: rules.fear || [],
  };
  const counts = { urgency: 0, outrage: 0, certainty: 0, fear: 0 };
  const signals = [];
  for (const [key, patterns] of Object.entries(rulesByCat)) {
    const phrases = [];
    patterns.forEach((re) => {
      const matches = text.match(re);
      if (matches) matches.forEach((m) => phrases.push(m.toLowerCase().trim()));
    });
    counts[key] = phrases.length;
    if (phrases.length) {
      signals.push({
        category: key,
        label: SIGNAL_CATEGORIES[key].label,
        count: phrases.length,
        phrases: [...new Set(phrases)].slice(0, 8),
        drives: SIGNAL_CATEGORIES[key].drives,
      });
    }
  }

  const { urgency, outrage, certainty, fear } = counts;
  const emotionalActivation = clamp(normalize(fear + outrage, 4) * 0.85);
  const cognitiveSuppression = clamp(normalize(urgency + certainty, 4) * 0.8);
  const manipulationPressure = clamp(
    emotionalActivation * 0.55 + cognitiveSuppression * 0.45,
  );
  const trustErosion = clamp(normalize(outrage + certainty, 5) * 0.78);

  // Backward-compatible flat evidence (receipt hashing + AI paths consume it).
  const evidence = [...new Set(signals.flatMap((s) => s.phrases))].slice(0, 8);

  const overall =
    (emotionalActivation + cognitiveSuppression + manipulationPressure) / 3;

  // ---- Calibrated confidence ----
  // Confidence answers "how sure are we about THIS verdict?" \u2014 and a verdict
  // can be confident at BOTH ends: clearly clean OR loudly corroborated. The
  // uncertain middle is what scores low: too little text to judge, or a notable
  // score resting on a single category (a possible false positive).
  // NOTE (tunable): the weights + thresholds below are the knob that most
  // shapes how trustworthy the tool *feels*. Worth your calibration.
  const totalHits = urgency + outrage + certainty + fear;
  const distinctCats = signals.length;
  const lengthFactor = clamp(words / 60);
  const volumeFactor = clamp(totalHits / 6);
  const agreementFactor = clamp(distinctCats / 3);
  // A notable score driven by a single category lacks corroboration.
  const fragile = overall > 0.45 && distinctCats <= 1;

  let confidenceScore;
  if (totalHits === 0) {
    // "Clean" verdict: how sure scales with how much text we got to judge.
    confidenceScore = clamp(0.45 + lengthFactor * 0.55);
  } else {
    const signalStrength = clamp(volumeFactor * 0.6 + agreementFactor * 0.4);
    confidenceScore =
      clamp(lengthFactor * 0.3 + signalStrength * 0.7) * (fragile ? 0.5 : 1);
  }
  const confidence =
    confidenceScore >= 0.66
      ? "high"
      : confidenceScore >= 0.36
        ? "medium"
        : "low";

  let confidenceReason;
  if (totalHits === 0) {
    confidenceReason =
      confidenceScore >= 0.66
        ? `No manipulation patterns matched across ${words} words \u2014 confident this reads as low-signal.`
        : `No manipulation patterns matched, but only ${words} words to judge \u2014 read this as tentative.`;
  } else {
    const catWord = distinctCats === 1 ? "category" : "categories";
    const hitWord = totalHits === 1 ? "match" : "matches";
    confidenceReason =
      `${totalHits} signal ${hitWord} across ${distinctCats} ${catWord}, in ${words} words` +
      (fragile
        ? " \u2014 but all of it comes from a single category, so treat with caution."
        : ".");
  }

  const recommendedAction =
    overall > 0.65
      ? "High manipulation-signature density \u2014 pause before sharing or reacting."
      : overall > 0.35
        ? "Moderate pressure cues detected \u2014 verify sources before acting."
        : "Low manipulation indicators \u2014 content appears relatively low-risk.";

  return {
    emotionalActivation: parseFloat(emotionalActivation.toFixed(3)),
    cognitiveSuppression: parseFloat(cognitiveSuppression.toFixed(3)),
    manipulationPressure: parseFloat(manipulationPressure.toFixed(3)),
    trustErosion: parseFloat(trustErosion.toFixed(3)),
    evidence,
    signals,
    confidence,
    confidenceScore: parseFloat(confidenceScore.toFixed(3)),
    confidenceReason,
    recommendedAction,
  };
}

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
