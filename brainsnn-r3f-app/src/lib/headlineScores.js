// The four headline scores for the playable Content Reaction Lab:
// Attention, Trust, Emotional Charge, Manipulation Risk. Thin relabeling of
// getBusinessMetrics so the playground, share card and full app never drift.
import { getBusinessMetrics } from './scoreMapping.js';

const HEADLINES = [
  { id: 'hookStrength', label: 'Attention', detail: (result) => (result?.viralScore != null ? `Viral pull ${result.viralScore}` : '') },
  { id: 'trust', label: 'Trust', detail: (result) => result?.riskRating || '' },
  { id: 'emotionalCharge', label: 'Emotional Charge', detail: (result) => result?.affectProfile?.dominantAffect || '' },
  { id: 'manipulationRisk', label: 'Manipulation Risk', detail: (result) => (result?.firewallSignals?.grade ? `Firewall grade ${result.firewallSignals.grade}` : '') },
];

export function getHeadlineScores(result = {}) {
  const safeResult = result || {};
  const byId = Object.fromEntries(getBusinessMetrics(safeResult).map((metric) => [metric.id, metric]));
  return HEADLINES.map(({ id, label, detail }) => ({
    ...byId[id],
    label,
    detail: detail(safeResult),
  }));
}
