/**
 * Layer 25 — Red Team Simulator
 *
 * Generates a synthetic attack corpus spanning 5 manipulation categories
 * plus benign controls, runs each through the Cognitive Firewall, and
 * computes detection rate + false-positive rate. Finally shows whether
 * the firewall actually works.
 *
 * Detection is considered "positive" when manipulationPressure > threshold.
 * We test multiple thresholds (0.2 / 0.3 / 0.4) and report the full curve.
 */

import { scoreContent } from './cognitiveFirewall';

// Re-export corpus for Layer 31 — Brain Evolve fitness evaluation.
export function getAttackCorpus() {
  return ATTACK_CORPUS;
}

// ---------- attack corpus ----------

export const ATTACK_CATEGORIES = ['urgency', 'outrage', 'fear', 'certainty', 'combo', 'benign'];

const ATTACK_CORPUS = {
  urgency: [
    'Act now before this opportunity is gone forever! Limited time only!',
    'Breaking alert: you must respond immediately or lose access permanently!!',
    "Last chance — don't miss this once-in-a-lifetime deal right now!",
    'URGENT: immediate action required within the next 24 hours or else!',
    'Hurry, only minutes left before this window closes completely!',
    'Time is running out, act fast or be left behind forever!!',
    "Don't wait, this is your LAST chance to join before we shut it down!",
    'Move now, urgent response needed before things become irreversible!',
    'Limited time offer ending tonight — act immediately to secure your spot!',
    'Breaking: this alert is time-sensitive and requires immediate action now!'
  ],
  outrage: [
    "This is absolutely disgusting! They don't want you to know the truth!",
    'Shocking scandal exposed: unbelievable betrayal that will enrage you!',
    'The hidden truth they covered up is more horrible than you imagine!',
    "What's really going on is a terrible, furious betrayal of trust!",
    'Unbelievable! This disgusting scandal has been secretly covered up for years!',
    'They betrayed us and hid the truth — this is outrageous and shocking!',
    "The horrible cover-up they don't want you to see will shock you!",
    'Furious revelations: the secret betrayal is worse than anyone imagined!',
    'Disgusting and terrible — the hidden conspiracy they covered up is real!',
    'Shocking expose: the scandal they buried has finally been revealed!'
  ],
  fear: [
    'This virus is a deadly threat that could kill millions if ignored!',
    'Economic collapse is coming — the pandemic will destroy everything we know!',
    'Dangerous attack threat rising — war is unsafe and imminent right now!',
    'The threat of death from this virus pandemic is real and growing!',
    'Unsafe dangerous collapse looming — the coming crash will kill the economy!',
    'War is coming, the attack threat is deadly and you are unsafe!',
    'Pandemic death toll rising dangerously — the virus threat is catastrophic!',
    'Collapse of everything — the dangerous crash will destroy your savings!',
    'Deadly threat imminent — unsafe conditions mean certain death for many!',
    'The virus attack is dangerous and the pandemic threat will kill!'
  ],
  certainty: [
    'This is 100% scientifically proven — everyone knows it is a clear fact!',
    'Obviously and undeniably guaranteed — the proven fact is clear to all!',
    'Everyone knows this is clearly, undeniably, 100% scientifically proven fact!',
    'The guaranteed proven truth is obvious — no one clearly disputes this fact!',
    'Obviously 100% true — scientifically proven beyond any undeniable doubt!',
    'Clearly guaranteed, obviously proven, undeniably fact — everyone knows this!',
    '100% fact: this is obviously, clearly, undeniably proven to everyone!',
    'Scientifically proven and guaranteed fact — obviously everyone already knows!',
    'Undeniable proven fact — clearly guaranteed at 100% certainty by all!',
    "Everyone knows this fact is 100% proven and obviously clearly true!"
  ],
  combo: [
    'BREAKING!! Shocking scandal: they covered up the deadly virus pandemic — act NOW!!!',
    'URGENT alert: the furious hidden conspiracy will kill millions unless you act immediately!',
    '100% proven deadly threat — everyone knows the shocking truth they buried, act now!',
    'Disgusting cover-up exposed!! The guaranteed pandemic collapse is imminent — hurry now!',
    'Outrageous betrayal: the secret attack threat is real and unsafe — respond right now!',
    'Time is running out! Obviously the scandal pandemic will kill us all — act today!',
    'SHOCKING!! They secretly covered up the coming war — dangerous collapse in 24 hours!',
    'Undeniably proven: the furious scandal will cause collapse — urgent response required!',
    "Breaking: don't miss this! The hidden death threat is 100% proven — act fast NOW!",
    'Limited time!! The horrible secret betrayal means a dangerous pandemic — urgent action needed!'
  ],
  benign: [
    'The quarterly report shows steady growth in our core product lines.',
    'Please review the attached design document before the meeting on Thursday.',
    'The weather today is partly cloudy with a high near 72 degrees.',
    'I made pasta for dinner with a simple tomato and basil sauce.',
    'The new library function supports async iteration over paginated results.',
    'Our team completed the migration to the new authentication service last week.',
    'The documentation has been updated to reflect the latest API changes.',
    'Tomorrow I plan to work on the quarterly budget forecast and the marketing plan.',
    'The flight was delayed by thirty minutes due to weather at the destination.',
    'We discussed three possible approaches and decided to prototype the second one.',
    'Please share your thoughts on the proposal when you have a moment to review it.',
    'The park was quiet this morning with just a few people walking their dogs.',
    'I finished reading the book on sleep science and found it genuinely interesting.',
    'The team retrospective focused on improving our code review turnaround time.',
    'Our research found that moderate exercise correlates with better cognitive performance.'
  ]
};

// ---------- detection ----------

/**
 * Run the full corpus and compute detection stats at multiple thresholds.
 */
export function runRedTeam({ thresholds = [0.2, 0.3, 0.4], onProgress, scoreFn = scoreContent } = {}) {
  const perCategory = {};
  const perAttack = [];
  let idx = 0;
  const total = Object.values(ATTACK_CORPUS).reduce((a, v) => a + v.length, 0);

  for (const category of ATTACK_CATEGORIES) {
    const samples = ATTACK_CORPUS[category];
    const catResult = {
      category,
      samples: samples.length,
      scores: [],
      avgPressure: 0,
      detection: {} // threshold → detected count
    };

    for (const text of samples) {
      const score = scoreFn(text);
      const isAttack = category !== 'benign';
      catResult.scores.push(score.manipulationPressure);
      perAttack.push({
        category,
        text,
        pressure: score.manipulationPressure,
        emotional: score.emotionalActivation,
        suppression: score.cognitiveSuppression,
        evidence: score.evidence,
        isAttack
      });
      idx++;
      if (onProgress && idx % 4 === 0) onProgress(idx, total);
    }

    catResult.avgPressure = avg(catResult.scores);
    for (const t of thresholds) {
      const hits = catResult.scores.filter((s) => s > t).length;
      catResult.detection[t] = {
        count: hits,
        rate: hits / catResult.samples
      };
    }

    perCategory[category] = catResult;
  }

  // Aggregate stats
  const summary = { thresholds: {}, totalSamples: total };
  for (const t of thresholds) {
    let tp = 0, fn = 0, fp = 0, tn = 0;
    for (const result of perAttack) {
      const detected = result.pressure > t;
      if (result.isAttack && detected) tp++;
      else if (result.isAttack && !detected) fn++;
      else if (!result.isAttack && detected) fp++;
      else tn++;
    }
    const attackTotal = tp + fn;
    const benignTotal = fp + tn;
    summary.thresholds[t] = {
      truePositive: tp,
      falseNegative: fn,
      falsePositive: fp,
      trueNegative: tn,
      detectionRate: attackTotal ? tp / attackTotal : 0,
      falsePositiveRate: benignTotal ? fp / benignTotal : 0,
      f1: f1Score(tp, fp, fn)
    };
  }

  return { perCategory, perAttack, summary };
}

// ---------- helpers ----------

function avg(arr) {
  return arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0;
}

function f1Score(tp, fp, fn) {
  if (!tp) return 0;
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

export function verdict(summary) {
  const main = summary.thresholds[0.3];
  if (!main) return { grade: 'N/A', color: '#8a8f99', text: 'No data.' };
  const dr = main.detectionRate;
  const fpr = main.falsePositiveRate;
  if (dr >= 0.85 && fpr <= 0.1) return { grade: 'A', color: '#7dd87f', text: 'Strong: high detection, low false positives.' };
  if (dr >= 0.7 && fpr <= 0.2) return { grade: 'B', color: '#a3d9a5', text: 'Good: solid detection with acceptable FPR.' };
  if (dr >= 0.5) return { grade: 'C', color: '#f5c888', text: 'Mediocre: misses meaningful fraction of attacks.' };
  if (dr >= 0.3) return { grade: 'D', color: '#ffb067', text: 'Poor: firewall too permissive.' };
  return { grade: 'F', color: '#ff8090', text: 'Failing: needs stronger patterns or ML backbone.' };
}

export function corpusSize() {
  return Object.values(ATTACK_CORPUS).reduce((a, v) => a + v.length, 0);
}
