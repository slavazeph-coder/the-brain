/**
 * Layer 31 — Brain Evolve : Node
 *
 * A Node represents one candidate firewall ruleset in the evolutionary tree.
 * Ported from ASI-Evolve's `utils/structures.py::Node` dataclass, trimmed
 * to what BrainSNN's firewall-evolution problem needs.
 *
 *   id          string            — short uid
 *   name        string            — human label, e.g. "gen3-island2-a"
 *   parent      string[]          — parent node ids (crossover can have 2)
 *   motivation  string            — why this mutation was proposed (Researcher step)
 *   ruleSet     { cat: [{source, flags}] }   — JSON-safe serialized rules
 *   results     { summary, perCategory }      — red team output (Engineer step)
 *   analysis    string            — LLM distilled lesson (Analyzer step)
 *   metaInfo    { sampler, operator, generation, island?, featureBin? }
 *   visitCount  number            — UCB1 arm pulls
 *   score       number            — fitness (F1 @ 0.3 by default)
 *   createdAt   number            — ms timestamp
 */

import { serializeRules } from '../cognitiveFirewall.js';

let _counter = 0;
function uid() {
  _counter += 1;
  return (
    Date.now().toString(36).slice(-4) +
    _counter.toString(36) +
    Math.random().toString(36).slice(2, 5)
  );
}

export function makeNode({
  name = '',
  parent = [],
  motivation = '',
  ruleSet = null,
  results = null,
  analysis = '',
  metaInfo = {},
  score = 0
} = {}) {
  // If ruleSet was passed as live RegExp arrays, serialize it.
  let serializedRules = ruleSet;
  if (ruleSet && Object.values(ruleSet)[0]?.[0] instanceof RegExp) {
    serializedRules = serializeRules(ruleSet);
  }
  return {
    id: uid(),
    name: name || `node-${uid()}`,
    parent: Array.isArray(parent) ? parent : [parent].filter(Boolean),
    motivation,
    ruleSet: serializedRules,
    results,
    analysis,
    metaInfo,
    visitCount: 0,
    score,
    createdAt: Date.now()
  };
}

/**
 * Normalize a batch of node scores to [0, 1] for UCB1. Undefined / NaN
 * scores become 0. If all scores are equal, returns 0.5 for each.
 */
export function normalizeScores(nodes) {
  const scores = nodes.map((n) => (Number.isFinite(n.score) ? n.score : 0));
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max - min < 1e-9) return scores.map(() => 0.5);
  return scores.map((s) => (s - min) / (max - min));
}

/**
 * Feature bin used by MAP-Elites sampler. Combines fpr tier + pattern count
 * tier. Produces strings like "fpr-low:size-med".
 */
export function featureBin(node) {
  const fpr = node.results?.summary?.thresholds?.[0.3]?.falsePositiveRate ?? 0.5;
  const fprTier = fpr < 0.1 ? 'low' : fpr < 0.25 ? 'med' : 'high';

  let patternCount = 0;
  for (const cat of Object.values(node.ruleSet || {})) patternCount += cat.length;
  const sizeTier = patternCount < 8 ? 'small' : patternCount < 14 ? 'med' : 'large';

  return `fpr-${fprTier}:size-${sizeTier}`;
}
