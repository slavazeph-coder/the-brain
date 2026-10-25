import { clampScore } from './formatters.js';

export function getBusinessMetrics(result = {}) {
  const m = result?.metrics || {};
  const fw = result?.firewallSignals || {};
  const hookStrength = clampScore((Number(m.excitement) || 40) * 0.55 + (Number(m.urgency) || 25) * 0.45);
  const trust = clampScore(Number(m.trust) || 50);
  const urgency = clampScore(Number(m.urgency) || 20);
  const manipulationRisk = clampScore(
    fw.manipulationPressure != null
      ? fw.manipulationPressure * 100
      : ((Number(m.fear) || 15) + (Number(m.anger) || 10) + urgency) / 3,
  );
  const shareability = clampScore(Number(result?.viralScore) || (hookStrength * 0.6 + trust * 0.4));

  return [
    { id: 'hookStrength', label: 'Hook Strength', value: hookStrength },
    { id: 'trust', label: 'Trust', value: trust },
    { id: 'urgency', label: 'Urgency', value: urgency },
    { id: 'manipulationRisk', label: 'Manipulation Risk', value: manipulationRisk },
    { id: 'shareability', label: 'Shareability', value: shareability },
  ];
}

export function deriveExecutiveVerdict(result = {}) {
  const firstRec = Array.isArray(result?.recommendations) ? result.recommendations[0] : null;
  const headline = typeof firstRec === 'object' && firstRec !== null
    ? firstRec.title || 'Anchor claims with verifiable evidence'
    : String(firstRec || result?.title || 'Signal evaluated');
  const primaryRisk = typeof firstRec === 'object' && firstRec !== null
    ? firstRec.rationale || result?.riskDescription || 'Monitor manipulation pressure.'
    : result?.riskDescription || 'Monitor manipulation pressure.';
  const bestNextMove = typeof firstRec === 'object' && firstRec !== null
    ? firstRec.rewriteHint || 'Pair high-arousal hooks with concrete proof.'
    : 'Pair high-arousal hooks with concrete proof.';
  const metrics = getBusinessMetrics(result);
  const trust = metrics.find((m) => m.id === 'trust')?.value ?? 50;

  return {
    headline,
    primaryRisk,
    bestNextMove,
    label: result?.isFallback === false ? 'Model-assisted result' : 'Deterministic local result',
    score: trust,
  };
}

export function compareResults(original = {}, revised = {}) {
  const origMap = Object.fromEntries(getBusinessMetrics(original).map((m) => [m.id, m]));
  const revMap = Object.fromEntries(getBusinessMetrics(revised).map((m) => [m.id, m]));
  const ids = ['hookStrength', 'trust', 'urgency', 'manipulationRisk'];
  return ids.map((id) => {
    const before = origMap[id]?.value ?? 0;
    const after = revMap[id]?.value ?? 0;
    return {
      id,
      label: origMap[id]?.label || id,
      before,
      after,
      delta: after - before,
    };
  });
}
