// TRIBE V2 — Cognitive Risk Scoring Engine
// Deterministic baseline heuristics for Phase 1.
// This describes likely manipulation / response signatures, not literal mind reading.

const URGENCY_PATTERNS = [
  /\bnow\b|\bimmediately\b|\burgent\b|\bbreaking\b|\balert\b/gi,
  /\blimited time\b|\bdon't miss\b|\blast chance\b|\bacts fast\b/gi,
  /\b!{2,}\b|\bWARNING\b|\bCRISIS\b|\bSHOCKING\b/gi,
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

export function scoreContent(text = '') {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;

  if (words < 5) {
    return {
      emotionalActivation: 0,
      cognitiveSuppression: 0,
      manipulationPressure: 0,
      trustErosion: 0,
      evidence: [],
      confidence: 'low',
      recommendedAction: 'Too short to score reliably.',
    };
  }

  const urgency = countMatches(trimmed, URGENCY_PATTERNS);
  const outrage = countMatches(trimmed, OUTRAGE_PATTERNS);
  const certainty = countMatches(trimmed, CERTAINTY_THEATER);
  const fear = countMatches(trimmed, FEAR_PATTERNS);

  const emotionalActivation = clamp(normalize(fear + outrage, 4) * 0.85);
  const cognitiveSuppression = clamp(normalize(urgency + certainty, 4) * 0.8);
  const manipulationPressure = clamp(emotionalActivation * 0.55 + cognitiveSuppression * 0.45);
  const trustErosion = clamp(normalize(outrage + certainty, 5) * 0.78);

  const evidence = [];
  [...URGENCY_PATTERNS, ...OUTRAGE_PATTERNS, ...CERTAINTY_THEATER, ...FEAR_PATTERNS].forEach((re) => {
    const matches = trimmed.match(re);
    if (matches) matches.forEach((m) => evidence.push(m.toLowerCase()));
  });
  const uniqueEvidence = [...new Set(evidence)].slice(0, 8);

  const overall = (emotionalActivation + cognitiveSuppression + manipulationPressure) / 3;
  const confidence = words > 80 ? 'high' : words > 30 ? 'medium' : 'low';
  const recommendedAction =
    overall > 0.65
      ? 'High manipulation-signature density — pause before sharing or reacting.'
      : overall > 0.35
        ? 'Moderate pressure cues detected — verify sources before acting.'
        : 'Low manipulation indicators — content appears relatively low-risk.';

  return {
    emotionalActivation: Number(emotionalActivation.toFixed(3)),
    cognitiveSuppression: Number(cognitiveSuppression.toFixed(3)),
    manipulationPressure: Number(manipulationPressure.toFixed(3)),
    trustErosion: Number(trustErosion.toFixed(3)),
    evidence: uniqueEvidence,
    confidence,
    recommendedAction,
  };
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
      CTX: Math.max(0.06, state.regions.CTX - cognitiveSuppression * 0.12),
    },
    burst: manipulationPressure > 0.55 ? Math.max(state.burst, 12) : state.burst,
    scenario: 'TRIBE V2 Content Scan',
  };
}
