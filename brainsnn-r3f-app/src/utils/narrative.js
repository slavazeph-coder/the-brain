/**
 * Neural Narrative Engine
 *
 * Generates human-readable descriptions of brain state changes
 * in real time. Narrates region activity, trends, anomalies,
 * scenario shifts, and cognitive firewall results.
 */

import { REGION_INFO } from '../data/network';

const REGION_ROLES = {};
for (const [k, v] of Object.entries(REGION_INFO)) {
  REGION_ROLES[k] = v.name;
}

// ---------- phrase banks ----------

const ACTIVITY_HIGH = [
  (r) => `${REGION_ROLES[r]} (${r}) is firing intensely.`,
  (r) => `Strong activation detected in ${REGION_ROLES[r]}.`,
  (r) => `${r} shows elevated neural activity.`,
];

const ACTIVITY_LOW = [
  (r) => `${REGION_ROLES[r]} (${r}) has gone quiet.`,
  (r) => `${r} activity is suppressed.`,
  (r) => `Minimal firing from ${REGION_ROLES[r]}.`,
];

const TREND_RISING = [
  (r) => `${r} activity is climbing steadily.`,
  (r) => `${REGION_ROLES[r]} is trending upward.`,
];

const TREND_FALLING = [
  (r) => `${r} is losing momentum.`,
  (r) => `${REGION_ROLES[r]} is winding down.`,
];

const SCENARIO_SHIFTS = {
  'Sensory Burst': 'A sensory burst is flooding the thalamic relay — expect THL and CTX to spike.',
  'Memory Replay': 'Hippocampal replay activated — the brain is consolidating recent experiences.',
  'Emotional Salience': 'Amygdala-driven emotional salience is coloring perception across the network.',
  'Executive Focus': 'Prefrontal cortex is asserting top-down control — executive focus engaged.',
  'Default Mode': 'The brain has entered its default mode — internal thought and self-referential processing.',
};

const FIREWALL_HIGH = 'The cognitive firewall detects strong manipulation signatures. Emotional circuits are being targeted.';
const FIREWALL_MODERATE = 'Moderate persuasion pressure detected — some manipulation cues present.';
const FIREWALL_LOW = 'Content appears clean — minimal manipulation signatures.';

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- narrative generator ----------

/**
 * Generate a narrative paragraph from current brain state.
 * @param {Object} params
 * @param {Object} params.regions - { CTX: 0.5, ... }
 * @param {string} params.scenario
 * @param {Object} params.trends - { CTX: 'rising', ... } (from analytics)
 * @param {Object|null} params.firewallResult
 * @param {number} params.tick
 * @returns {string[]} Array of narrative sentences
 */
export function generateNarrative({ regions, scenario, trends = {}, firewallResult = null, tick = 0 }) {
  const sentences = [];

  // Scenario context
  if (scenario && SCENARIO_SHIFTS[scenario]) {
    sentences.push(SCENARIO_SHIFTS[scenario]);
  }

  // Lead region
  const sorted = Object.entries(regions).sort((a, b) => b[1] - a[1]);
  const lead = sorted[0];
  if (lead && lead[1] > 0.6) {
    sentences.push(pick(ACTIVITY_HIGH)(lead[0]));
  }

  // Trailing region
  const trailing = sorted[sorted.length - 1];
  if (trailing && trailing[1] < 0.12) {
    sentences.push(pick(ACTIVITY_LOW)(trailing[0]));
  }

  // Trends
  for (const [region, direction] of Object.entries(trends)) {
    if (direction === 'rising' && regions[region] > 0.4) {
      sentences.push(pick(TREND_RISING)(region));
      break; // one trend note is enough
    }
    if (direction === 'falling' && regions[region] < 0.3) {
      sentences.push(pick(TREND_FALLING)(region));
      break;
    }
  }

  // Cross-region dynamics
  if (regions.AMY > 0.6 && regions.PFC < 0.3) {
    sentences.push('Amygdala dominance with prefrontal suppression — emotional override in progress.');
  } else if (regions.PFC > 0.6 && regions.AMY < 0.3) {
    sentences.push('Prefrontal cortex is overriding limbic responses — rational control prevails.');
  }

  if (regions.HPC > 0.5 && regions.CTX > 0.5) {
    sentences.push('Hippocampal-cortical coupling suggests active memory encoding.');
  }

  if (regions.THL > 0.65) {
    sentences.push('Thalamic relay is wide open — sensory throughput is at maximum.');
  }

  // Firewall overlay
  if (firewallResult) {
    const overall = (firewallResult.emotionalActivation + firewallResult.cognitiveSuppression + firewallResult.manipulationPressure) / 3;
    if (overall > 0.65) sentences.push(FIREWALL_HIGH);
    else if (overall > 0.35) sentences.push(FIREWALL_MODERATE);
    else sentences.push(FIREWALL_LOW);
  }

  // Fallback
  if (sentences.length === 0) {
    sentences.push(`Tick ${tick}: The neural network hums along in its current state — all regions within normal parameters.`);
  }

  return sentences;
}

/**
 * Generate a one-line status summary.
 */
export function statusLine(regions, scenario) {
  const sorted = Object.entries(regions).sort((a, b) => b[1] - a[1]);
  const lead = sorted[0];
  const mean = Object.values(regions).reduce((a, v) => a + v, 0) / Object.keys(regions).length;
  return `${scenario} — ${lead[0]} leads at ${(lead[1] * 100).toFixed(0)}%, mean ${(mean * 100).toFixed(0)}%`;
}
