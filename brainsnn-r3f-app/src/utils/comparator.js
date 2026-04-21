/**
 * Layer 74 — Firewall Comparator
 *
 * Run the same input through two distinct rulesets (defaults vs
 * current active / evolved, or any pair) and show the delta per
 * dimension plus evidence diff.
 */

import {
  DEFAULT_RULES,
  getActiveRules,
  scoreContentWithRules,
  serializeRules,
  deserializeRules,
} from './cognitiveFirewall';
import { detectTemplates } from './propagandaTemplates';

function pressure(s) {
  return (s.emotionalActivation + s.cognitiveSuppression + s.manipulationPressure) / 3;
}

export function compareRulesets(text = '', rulesetA = DEFAULT_RULES, rulesetB = null) {
  const rA = rulesetA || DEFAULT_RULES;
  const rB = rulesetB || getActiveRules();
  const a = scoreContentWithRules(text, rA, { deterministic: true });
  const b = scoreContentWithRules(text, rB, { deterministic: true });
  const templates = detectTemplates(text);
  return {
    a: { score: a, pressure: pressure(a) },
    b: { score: b, pressure: pressure(b) },
    delta: pressure(b) - pressure(a),
    evidenceInA: new Set(a.evidence).size,
    evidenceInB: new Set(b.evidence).size,
    onlyA: a.evidence.filter((x) => !b.evidence.includes(x)),
    onlyB: b.evidence.filter((x) => !a.evidence.includes(x)),
    shared: a.evidence.filter((x) => b.evidence.includes(x)),
    templates,
  };
}

/**
 * Serialize + deserialize is useful when the caller wants to save /
 * restore a particular ruleset snapshot for comparison later.
 */
export function snapshotRuleset(rules) {
  return serializeRules(rules);
}
export function restoreRuleset(serialized) {
  return deserializeRules(serialized);
}
