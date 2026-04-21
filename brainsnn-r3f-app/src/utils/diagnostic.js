/**
 * Layer 61 — Firewall Diagnostic
 *
 * Runs the currently active ruleset through the Layer 25 red-team
 * corpus + benign controls and reports:
 *   - per-pattern hit counts (dead patterns = 0 hits ever)
 *   - false-positive contributors (patterns that fire on benigns)
 *   - F1 at a given threshold (0.3 default)
 *   - overall A–F grade
 *
 * Useful for: users who wrote custom rules (Layer 55) or imported
 * someone else's, and want to see whether those rules are working.
 */

import { getActiveRules, scoreContentWithRules } from './cognitiveFirewall';
import { getAttackCorpus } from './redTeam';

function pressureOf(s) {
  return (s.emotionalActivation + s.cognitiveSuppression + s.manipulationPressure) / 3;
}

/**
 * Returns full diagnostic report for the active rules.
 */
export function runDiagnostic({ threshold = 0.3 } = {}) {
  const rules = getActiveRules();
  const corpus = getAttackCorpus();
  const attacks = [];
  const benigns = [];
  for (const [cat, samples] of Object.entries(corpus || {})) {
    if (cat === 'benign') benigns.push(...samples);
    else attacks.push(...samples.map((s) => ({ text: s, category: cat })));
  }

  const allPatterns = [];
  for (const [category, list] of Object.entries(rules)) {
    for (let i = 0; i < list.length; i++) {
      allPatterns.push({
        category,
        idx: i,
        re: list[i],
        source: list[i].source,
        flags: list[i].flags,
        hits: 0,
        attackHits: 0,
        benignHits: 0,
      });
    }
  }

  let attackCatches = 0;
  let benignFalsePositives = 0;

  const scoreOne = (text, isAttack) => {
    const s = scoreContentWithRules(text, rules, { deterministic: true });
    const p = pressureOf(s);
    if (isAttack && p >= threshold) attackCatches++;
    if (!isAttack && p >= threshold) benignFalsePositives++;
    for (const pat of allPatterns) {
      const re = pat.re;
      // Reset lastIndex for /g patterns before using .match from a string context
      re.lastIndex = 0;
      const m = text.match(re);
      if (m) {
        pat.hits += m.length;
        if (isAttack) pat.attackHits += m.length;
        else pat.benignHits += m.length;
      }
    }
  };

  for (const a of attacks) scoreOne(a.text, true);
  for (const b of benigns) scoreOne(b, false);
  const totalAttacks = attacks.length;
  const totalBenigns = benigns.length;

  const detectionRate = attackCatches / Math.max(1, totalAttacks);
  const fpr = benignFalsePositives / Math.max(1, totalBenigns);

  const precision = (attackCatches) / Math.max(1, attackCatches + benignFalsePositives);
  const recall = detectionRate;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const dead = allPatterns.filter((p) => p.hits === 0);
  const fpContributors = allPatterns.filter((p) => p.benignHits > 0);

  const grade = gradeFor(f1, fpr);

  return {
    threshold,
    totalAttacks,
    totalBenigns,
    detectionRate,
    fpr,
    precision,
    recall,
    f1,
    grade,
    patterns: allPatterns,
    dead,
    fpContributors,
  };
}

function gradeFor(f1, fpr) {
  if (f1 >= 0.85 && fpr <= 0.1) return { letter: 'A', color: '#5ee69a' };
  if (f1 >= 0.75 && fpr <= 0.2) return { letter: 'B', color: '#77dbe4' };
  if (f1 >= 0.60) return { letter: 'C', color: '#fdab43' };
  if (f1 >= 0.45) return { letter: 'D', color: '#e57b40' };
  return { letter: 'F', color: '#dd6974' };
}
