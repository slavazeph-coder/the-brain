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
  { key: 'emotionalActivation', label: 'Emotional activation', desc: 'Fear / outrage / panic optimization', color: '#dd6974', regions: 'AMY + THL' },
  { key: 'cognitiveSuppression', label: 'Cognitive suppression', desc: 'Urgency / certainty theater / overload', color: '#fdab43', regions: 'PFC dampens' },
  { key: 'manipulationPressure', label: 'Manipulation pressure', desc: 'Steering reaction over understanding', color: '#a86fdf', regions: 'BG rises' },
  { key: 'trustErosion', label: 'Trust erosion risk', desc: 'Sensationalism / coercive framing', color: '#5591c7', regions: 'composite' }
];

export function scoreContent(text = '') {
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

  const urgency = countMatches(text, URGENCY_PATTERNS);
  const outrage = countMatches(text, OUTRAGE_PATTERNS);
  const certainty = countMatches(text, CERTAINTY_THEATER);
  const fear = countMatches(text, FEAR_PATTERNS);

  const emotionalActivation = clamp(normalize(fear + outrage, 4) * 0.85 + Math.random() * 0.04);
  const cognitiveSuppression = clamp(normalize(urgency + certainty, 4) * 0.80 + Math.random() * 0.04);
  const manipulationPressure = clamp((emotionalActivation * 0.55 + cognitiveSuppression * 0.45));
  const trustErosion = clamp(normalize(outrage + certainty, 5) * 0.78 + Math.random() * 0.04);

  const evidence = [];
  [...URGENCY_PATTERNS, ...OUTRAGE_PATTERNS, ...CERTAINTY_THEATER, ...FEAR_PATTERNS].forEach((re) => {
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

/**
 * Smart scoring — uses Gemma 4 when configured, falls back to regex.
 * Returns a promise that always resolves to a score object.
 */
export async function scoreContentSmart(text = '') {
  // Lazy import to avoid circular deps
  const { isGemmaConfigured, analyzeContentWithGemma } = await import('./gemmaEngine.js');
  if (isGemmaConfigured() && text.trim().split(/\s+/).length >= 5) {
    try {
      return await analyzeContentWithGemma(text);
    } catch (_err) {
      // Fall back to deterministic scoring on API failure
      return { ...scoreContent(text), source: 'regex_fallback' };
    }
  }
  return { ...scoreContent(text), source: 'regex' };
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
