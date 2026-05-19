import { detectTemplates } from './propagandaTemplates.js';
import { detectLanguage, patternsFor, labelFor as languageLabel } from './firewallI18n.js';
import { createPool } from './workerPool.js';

const URGENCY_PATTERNS = [
  /\bnow\b|\bimmediately\b|\burgent\b|\bbreaking\b|\balert\b/gi,
  /\blimited time\b|\bdon't miss\b|\blast chance\b|\bact(?:s)? fast\b/gi,
  /!{2,}|\bWARNING\b|\bCRISIS\b|\bSHOCKING\b/gi
];

const OUTRAGE_PATTERNS = [
  /\boutrage\b|\bfurious\b|\bscandal\b|\bterrible\b|\bhorrible\b/gi,
  /\bunbelievable\b|\bdisgusting\b|\bshocking\b|\bbetray/gi,
  /\bthey don't want you to know\b|\bhidden\b|\bsecret\b|\bcovered up\b/gi
];

const CERTAINTY_THEATER = [
  /\b100%\b|\bproven\b|\bguaranteed\b|\bscientifically proven\b|\bfact\b/gi,
  /\beveryone knows\b|\bobviously\b|\bclearly\b|\bundeniably\b/gi
];

const FEAR_PATTERNS = [
  /\bdie\b|\bdeath\b|\bkill\b|\bdanger\b|\bthreat\b|\bsafe\b|\bunsafe\b/gi,
  /\bvirus\b|\bpandemic\b|\battack\b|\bwar\b|\bcrash\b|\bcollapse\b/gi
];

/**
 * Default ruleset — exposed so Layer 31 (Brain Evolve) can clone, mutate,
 * and evolve firewall patterns without editing this file.
 */
export const DEFAULT_RULES = {
  urgency: URGENCY_PATTERNS,
  outrage: OUTRAGE_PATTERNS,
  certainty: CERTAINTY_THEATER,
  fear: FEAR_PATTERNS
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
          return new RegExp(it.source, it.flags || 'gi');
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
  { key: 'emotionalActivation', label: 'Emotional activation', desc: 'Fear / outrage / panic optimization', color: 'var(--danger)', regions: 'AMY + THL' },
  { key: 'cognitiveSuppression', label: 'Cognitive suppression', desc: 'Urgency / certainty theater / overload', color: 'var(--severity-mid)', regions: 'PFC dampens' },
  { key: 'manipulationPressure', label: 'Manipulation pressure', desc: 'Steering reaction over understanding', color: 'var(--severity-purple)', regions: 'BG rises' },
  { key: 'trustErosion', label: 'Trust erosion risk', desc: 'Sensationalism / coercive framing', color: '#5591c7', regions: 'composite' }
];

/**
 * Score content against an arbitrary ruleset. This is the hot path used by
 * Layer 31 (Brain Evolve) when benchmarking candidate rulesets against the
 * red team corpus. Results are deterministic when `deterministic: true`.
 */
export function scoreContentWithRules(text = '', rules = DEFAULT_RULES, opts = {}) {
  const { deterministic = false } = opts;
  const words = text.trim().split(/\s+/).length;
  if (words < 5) {
    return {
      emotionalActivation: 0,
      cognitiveSuppression: 0,
      manipulationPressure: 0,
      trustErosion: 0,
      evidence: [],
      confidence: 'low',
      recommendedAction: 'Too short to score reliably.'
    };
  }

  const urgencyPatterns = rules.urgency || [];
  const outragePatterns = rules.outrage || [];
  const certaintyPatterns = rules.certainty || [];
  const fearPatterns = rules.fear || [];

  const urgency = countMatches(text, urgencyPatterns);
  const outrage = countMatches(text, outragePatterns);
  const certainty = countMatches(text, certaintyPatterns);
  const fear = countMatches(text, fearPatterns);

  const jitter = deterministic ? 0 : Math.random() * 0.04;
  const emotionalActivation = clamp(normalize(fear + outrage, 4) * 0.85 + jitter);
  const cognitiveSuppression = clamp(normalize(urgency + certainty, 4) * 0.80 + (deterministic ? 0 : Math.random() * 0.04));
  const manipulationPressure = clamp((emotionalActivation * 0.55 + cognitiveSuppression * 0.45));
  const trustErosion = clamp(normalize(outrage + certainty, 5) * 0.78 + (deterministic ? 0 : Math.random() * 0.04));

  const evidence = [];
  [...urgencyPatterns, ...outragePatterns, ...certaintyPatterns, ...fearPatterns].forEach((re) => {
    const matches = text.match(re);
    if (matches) matches.forEach((m) => evidence.push(m.toLowerCase()));
  });
  const uniqueEvidence = [...new Set(evidence)].slice(0, 8);

  const overall = (emotionalActivation + cognitiveSuppression + manipulationPressure) / 3;
  const confidence = words > 80 ? 'high' : words > 30 ? 'medium' : 'low';
  const recommendedAction =
    overall > 0.65
      ? 'High manipulation-signature density \u2014 pause before sharing or reacting.'
      : overall > 0.35
      ? 'Moderate pressure cues detected \u2014 verify sources before acting.'
      : 'Low manipulation indicators \u2014 content appears relatively low-risk.';

  return {
    emotionalActivation: parseFloat(emotionalActivation.toFixed(3)),
    cognitiveSuppression: parseFloat(cognitiveSuppression.toFixed(3)),
    manipulationPressure: parseFloat(manipulationPressure.toFixed(3)),
    trustErosion: parseFloat(trustErosion.toFixed(3)),
    evidence: uniqueEvidence,
    confidence,
    recommendedAction
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

export function scoreContent(text = '') {
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
export async function scoreContentSmart(text = '') {
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 5) return { ...scoreContent(text), source: 'regex' };

  // Pre-screen every AI scan with Lobster Trap. Blocks prompt-injection
  // and secret leaks before they leave the browser; redacts PII inline.
  const { inspectPrompt } = await import('./lobsterTrap.js');
  const trap = inspectPrompt({ prompt: text, surface: 'firewall.smart' });
  if (trap.action === 'block') {
    return { ...scoreContent(text), source: 'regex_lobster_blocked', lobsterTrap: trap };
  }
  const safeText = trap.action === 'redact' && trap.redacted ? trap.redacted : text;

  const { isGeminiConfigured, analyzeContentWithGemini } = await import('./geminiEngine.js');
  if (isGeminiConfigured()) {
    try {
      const result = await analyzeContentWithGemini(safeText);
      return { ...result, lobsterTrap: trap };
    } catch (_err) {
      // fall through to Gemma
    }
  }

  const { isGemmaConfigured, analyzeContentWithGemma } = await import('./gemmaEngine.js');
  if (isGemmaConfigured()) {
    try {
      const result = await analyzeContentWithGemma(safeText);
      return { ...result, lobsterTrap: trap };
    } catch (_err) {
      return { ...scoreContent(text), source: 'regex_fallback', lobsterTrap: trap };
    }
  }
  return { ...scoreContent(text), source: 'regex' };
}

/**
 * Async scoring — offloads regex sweep to the firewall worker when text is
 * long enough that the spin-up overhead pays back. Falls back to sync
 * scoreContent on any failure (or when running inside the worker itself,
 * to avoid recursive spawning).
 *
 * Threshold: 500 chars. Below that the sync path completes in <2ms; the
 * postMessage round-trip costs more than the work itself.
 */
const ASYNC_THRESHOLD = 500;
let _firewallPool = null;

function ensurePool() {
  if (_firewallPool) return _firewallPool;
  // Inside a worker, window is undefined — never instantiate another pool.
  if (typeof window === 'undefined') return null;
  try {
    _firewallPool = createPool(
      () => new Worker(new URL('../workers/firewall.worker.js', import.meta.url), { type: 'module' }),
      {
        // size omitted → defaults to min(4, cores-1). Red Team batch scans
        // and parallel inbox triage benefit from real parallelism here.
        fallback: (type, payload) => {
          if (type === 'score') return scoreContent(payload?.text || '');
          if (type === 'scoreWithRules') return scoreContentWithRules(payload?.text || '', payload?.rules || DEFAULT_RULES);
          return null;
        }
      }
    );
    return _firewallPool;
  } catch {
    return null;
  }
}

/**
 * Generic worker dispatch for sister modules (redTeam, adversarial-
 * Training) that want to share the firewall pool without re-spawning
 * their own workers. Returns the worker result on success, or null
 * on fallback / no-pool — caller decides whether to run inline.
 */
export async function callFirewallWorker(type, payload, transferList) {
  const pool = ensurePool();
  if (!pool || pool.degraded) return null;
  try {
    return await pool.call(type, payload, transferList);
  } catch {
    return null;
  }
}

export async function scoreContentAsync(text = '') {
  if (!text || text.length < ASYNC_THRESHOLD) return scoreContent(text);
  const pool = ensurePool();
  if (!pool || pool.degraded) return scoreContent(text);
  try {
    // Workers carry their own module-level state, so the main-thread
    // active ruleset (custom rules, evolved firewall, rule packs) does
    // NOT propagate automatically. When the user has promoted a non-
    // default ruleset, send it along with each score call so the worker
    // mirrors the same behavior as scoreContent on the main thread.
    const rules = getActiveRules();
    if (rules === DEFAULT_RULES) {
      return await pool.call('score', { text });
    }
    return await pool.call('scoreWithRules', {
      text,
      rules: serializeRules(rules)
    });
  } catch {
    return scoreContent(text);
  }
}

export function mapTRIBEToRegions(state, tribe) {
  const { emotionalActivation, cognitiveSuppression, manipulationPressure } = tribe;

  return {
    ...state,
    regions: {
      ...state.regions,
      AMY: Math.min(0.95, state.regions.AMY + emotionalActivation * 0.28),
      THL: Math.min(0.95, state.regions.THL + emotionalActivation * 0.18),
      PFC: Math.max(0.04, state.regions.PFC - cognitiveSuppression * 0.22),
      BG: Math.min(0.95, state.regions.BG + manipulationPressure * 0.16),
      CTX: Math.max(0.06, state.regions.CTX - cognitiveSuppression * 0.12)
    },
    burst: manipulationPressure > 0.55 ? Math.max(state.burst, 12) : state.burst,
    scenario: 'TRIBE V2 Content Scan'
  };
}
