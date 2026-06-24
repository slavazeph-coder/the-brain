import { clampScore } from './formatters.js';

export function getBusinessMetrics(result = {}) {
  const metrics = result.metrics || {};
  const hookStrength = clampScore((Number(metrics.excitement) || 0) * 0.44 + (Number(metrics.urgency) || 0) * 0.22 + (Number(result.viralScore) || 0) * 0.34, 50);
  const trust = clampScore(metrics.trust, 50);
  const urgency = clampScore(metrics.urgency, 0);
  const emotionalCharge = clampScore(((Number(metrics.fear) || 0) + (Number(metrics.anger) || 0) + (Number(metrics.excitement) || 0)) / 3, 35);
  const empathy = clampScore(metrics.empathy, 40);
  const manipulationRisk = clampScore((Number(result.gaugeGapScore) || 0) * 0.5 + (Number(metrics.fear) || 0) * 0.16 + (Number(metrics.anger) || 0) * 0.16 + (Number(metrics.urgency) || 0) * 0.18, 40);
  const shareability = clampScore(result.viralScore, 45);
  const confidence = clampScore(result.confidence, 60);
  return [
    {
      id: 'hookStrength',
      label: 'Hook Strength',
      value: hookStrength,
      color: 'cyan',
      direction: 'higher-good',
      explanation: 'Estimated ability to earn the first few seconds of attention.',
    },
    {
      id: 'trust',
      label: 'Trust',
      value: trust,
      color: 'green',
      direction: 'higher-good',
      explanation: 'How much the copy supports credibility and belief.',
    },
    {
      id: 'urgency',
      label: 'Urgency',
      value: urgency,
      color: urgency > 72 && trust < 55 ? 'yellow' : 'purple',
      direction: 'contextual',
      explanation: 'Pressure to act. Useful with proof, risky without it.',
    },
    {
      id: 'emotionalCharge',
      label: 'Emotional Charge',
      value: emotionalCharge,
      color: emotionalCharge > 72 ? 'orange' : 'purple',
      direction: 'contextual',
      explanation: 'The intensity of the emotional language.',
    },
    {
      id: 'empathy',
      label: 'Empathy',
      value: empathy,
      color: 'green',
      direction: 'higher-good',
      explanation: 'Signals that the message understands the audience.',
    },
    {
      id: 'manipulationRisk',
      label: 'Manipulation Risk',
      value: manipulationRisk,
      color: manipulationRisk > 62 ? 'red' : 'yellow',
      direction: 'lower-good',
      explanation: 'Risk that the message feels forced, coercive, or unsupported.',
    },
    {
      id: 'shareability',
      label: 'Shareability',
      value: shareability,
      color: 'cyan',
      direction: 'higher-good',
      explanation: 'Directional estimate of how memorable and repeatable it is.',
    },
    {
      id: 'confidence',
      label: 'Confidence',
      value: confidence,
      color: 'purple',
      direction: 'higher-good',
      explanation: 'Confidence in this estimate based on available content.',
    },
  ];
}

export function deriveExecutiveVerdict(result = {}) {
  const metrics = getBusinessMetrics(result);
  const byId = Object.fromEntries(metrics.map((metric) => [metric.id, metric]));
  const hook = byId.hookStrength.value;
  const trust = byId.trust.value;
  const risk = byId.manipulationRisk.value;
  const score = clampScore((hook * 0.34) + (trust * 0.3) + ((100 - risk) * 0.22) + (byId.shareability.value * 0.14), 50);

  let headline = 'Clear draft. Needs sharper proof.';
  if (hook >= 72 && risk >= 62) headline = 'Strong hook. Trust risk.';
  else if (hook >= 72 && trust >= 62) headline = 'Strong hook. Credible signal.';
  else if (trust >= 70 && hook < 62) headline = 'Credible, but too quiet.';
  else if (risk >= 72) headline = 'High pressure. Rebuild trust.';

  const primaryStrength = hook >= trust
    ? 'The opening gives the audience a reason to keep reading.'
    : 'The message has credibility signals worth keeping.';
  const primaryRisk = risk >= 62
    ? 'Pressure or emotional charge may be doing more work than proof.'
    : trust < 55
      ? 'The promise needs clearer evidence.'
      : 'The close can be more specific.';
  const bestNextMove = risk >= 62
    ? 'Keep the opening. Replace unsupported urgency with proof.'
    : trust < 55
      ? 'Add a concrete reason to believe the claim.'
      : 'Tighten the ask and preserve the strongest sentence.';

  return {
    headline,
    score,
    interpretation: result.summary || 'AI-estimated response signals for this content.',
    primaryStrength,
    primaryRisk,
    bestNextMove,
    label: result.isFallback ? 'Demo model result' : 'AI-estimated response',
  };
}

export function compareResults(original, revised) {
  const originalMetrics = Object.fromEntries(getBusinessMetrics(original).map((metric) => [metric.id, metric.value]));
  const revisedMetrics = Object.fromEntries(getBusinessMetrics(revised).map((metric) => [metric.id, metric.value]));
  return ['hookStrength', 'trust', 'manipulationRisk', 'shareability'].map((id) => {
    const delta = revisedMetrics[id] - originalMetrics[id];
    const lowerGood = id === 'manipulationRisk';
    return {
      id,
      label: {
        hookStrength: 'Hook Strength',
        trust: 'Trust',
        manipulationRisk: 'Manipulation Risk',
        shareability: 'Shareability',
      }[id],
      before: originalMetrics[id],
      after: revisedMetrics[id],
      delta,
      status: delta === 0 ? 'flat' : (lowerGood ? delta < 0 : delta > 0) ? 'good' : 'bad',
    };
  });
}
