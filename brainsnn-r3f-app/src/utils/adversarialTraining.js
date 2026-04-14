/**
 * Layer 27 — Adversarial Training Loop
 *
 * Closes the loop on Layer 25 (Red Team): take the attacks that the
 * Cognitive Firewall missed, mine discriminative n-grams that appear
 * in attack text but rarely in benign text, and add them as learned
 * patterns that augment future scoring.
 *
 * Approach:
 *   1. tokenize(text) — normalized unigrams
 *   2. extract n-grams (bigrams + trigrams) from attack vs benign corpora
 *   3. compute lift = P(ngram|attack) / P(ngram|benign) with Laplace smoothing
 *   4. filter by min attack count + lift threshold
 *   5. store top N as learnedPatterns in localStorage
 *   6. scoreWithLearned(text) augments scoreContent with learned matches
 *
 * This turns the firewall from static regex into a self-improving
 * detector that learns from the red team's successes.
 */

import { scoreContent } from './cognitiveFirewall';
import { runRedTeam } from './redTeam';

const STORAGE_KEY = 'brainsnn_learned_patterns_v1';
const MAX_PATTERNS = 40;
const STOPWORDS = new Set([
  'the','a','an','and','or','but','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should','may',
  'might','can','must','shall','of','to','in','on','at','for','with','by',
  'from','as','it','this','that','these','those','i','you','he','she','we',
  'they','my','your','his','her','our','their','me','him','us','them','so',
  'if','then','than','too','very','just','not','no','yes','all','any','some',
  'what','when','where','why','how','which','who','whom','whose'
]);

// ---------- storage ----------

export function getLearnedPatterns() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveLearnedPatterns(patterns) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patterns.slice(0, MAX_PATTERNS)));
  } catch { /* quota */ }
}

export function clearLearnedPatterns() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ---------- tokenization ----------

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

function extractCandidates(text) {
  const toks = tokenize(text);
  return [...ngrams(toks, 2), ...ngrams(toks, 3)];
}

// ---------- training ----------

/**
 * Train on a redTeam report: mine discriminative n-grams from attacks
 * that the current firewall failed to catch at the given threshold.
 * Returns a new learned-pattern list (not yet persisted — caller decides).
 */
export function trainFromRedTeam(report, { threshold = 0.3, topK = 20, minLift = 3, minAttackCount = 2 } = {}) {
  if (!report?.perAttack) return { learned: [], stats: null };

  // Partition: missed attacks (false negatives) vs all benign
  const missed = report.perAttack.filter((a) => a.isAttack && a.pressure <= threshold);
  const benign = report.perAttack.filter((a) => !a.isAttack);

  if (!missed.length) {
    return {
      learned: getLearnedPatterns(),
      stats: { missed: 0, benign: benign.length, candidates: 0, learned: 0 }
    };
  }

  // Count n-grams
  const attackCounts = new Map();
  const benignCounts = new Map();
  for (const a of missed) {
    for (const g of extractCandidates(a.text)) {
      attackCounts.set(g, (attackCounts.get(g) || 0) + 1);
    }
  }
  for (const b of benign) {
    for (const g of extractCandidates(b.text)) {
      benignCounts.set(g, (benignCounts.get(g) || 0) + 1);
    }
  }

  // Compute lift with Laplace smoothing
  const attackTotal = missed.length;
  const benignTotal = benign.length;
  const candidates = [];
  for (const [ngram, attCnt] of attackCounts.entries()) {
    if (attCnt < minAttackCount) continue;
    const benCnt = benignCounts.get(ngram) || 0;
    const pAttack = (attCnt + 0.5) / (attackTotal + 1);
    const pBenign = (benCnt + 0.5) / (benignTotal + 1);
    const lift = pAttack / pBenign;
    if (lift >= minLift) {
      candidates.push({
        ngram,
        lift: Number(lift.toFixed(2)),
        attackCount: attCnt,
        benignCount: benCnt
      });
    }
  }

  candidates.sort((a, b) => b.lift - a.lift || b.attackCount - a.attackCount);
  const newPatterns = candidates.slice(0, topK);

  // Merge with existing learned patterns; keep highest lift, dedupe
  const existing = getLearnedPatterns();
  const merged = new Map(existing.map((p) => [p.ngram, p]));
  for (const np of newPatterns) {
    const prev = merged.get(np.ngram);
    if (!prev || prev.lift < np.lift) {
      merged.set(np.ngram, { ...np, addedAt: Date.now() });
    }
  }
  const learned = [...merged.values()].sort((a, b) => b.lift - a.lift).slice(0, MAX_PATTERNS);

  return {
    learned,
    stats: {
      missed: missed.length,
      benign: benign.length,
      candidates: candidates.length,
      newPatterns: newPatterns.length,
      totalLearned: learned.length
    }
  };
}

// ---------- augmented scoring ----------

/**
 * Score content using the base firewall, then augment with learned
 * patterns. Each learned match adds to manipulation pressure + emotional
 * activation proportional to the match's training lift.
 */
export function scoreWithLearned(text = '') {
  const base = scoreContent(text);
  const learned = getLearnedPatterns();
  if (!learned.length) return { ...base, learnedMatches: [], augmented: false };

  const lower = (text || '').toLowerCase();
  const hits = [];
  for (const p of learned) {
    if (lower.includes(p.ngram)) hits.push(p);
  }

  if (!hits.length) return { ...base, learnedMatches: [], augmented: true };

  // Bonus scales with the lift of matched patterns
  const avgLift = hits.reduce((a, p) => a + p.lift, 0) / hits.length;
  const liftFactor = Math.min(1, (avgLift - 1) / 10); // 1→0, 11→1
  const bonus = Math.min(0.35, hits.length * 0.06 * (0.5 + liftFactor));

  return {
    ...base,
    manipulationPressure: Math.min(1, base.manipulationPressure + bonus),
    emotionalActivation: Math.min(1, base.emotionalActivation + bonus * 0.45),
    cognitiveSuppression: Math.min(1, base.cognitiveSuppression + bonus * 0.3),
    learnedMatches: hits.map((h) => h.ngram),
    augmentBonus: Number(bonus.toFixed(3)),
    augmented: true
  };
}

// ---------- evaluation ----------

/**
 * Re-run the red team using augmented scoring so the panel can show
 * before/after detection improvement. Mirrors runRedTeam but swaps
 * scoreContent for scoreWithLearned.
 */
export function evaluateWithLearned({ thresholds = [0.2, 0.3, 0.4] } = {}) {
  // Monkey-patch-free approach: reuse base runRedTeam to get baseline first,
  // then recompute per-attack pressure with scoreWithLearned.
  const baseline = runRedTeam({ thresholds });
  const perAttack = baseline.perAttack.map((a) => {
    const s = scoreWithLearned(a.text);
    return {
      ...a,
      pressure: s.manipulationPressure,
      emotional: s.emotionalActivation,
      suppression: s.cognitiveSuppression,
      learnedMatches: s.learnedMatches || []
    };
  });

  // Recompute summary on new pressures
  const summary = { thresholds: {}, totalSamples: perAttack.length };
  for (const t of thresholds) {
    let tp = 0, fn = 0, fp = 0, tn = 0;
    for (const r of perAttack) {
      const det = r.pressure > t;
      if (r.isAttack && det) tp++;
      else if (r.isAttack && !det) fn++;
      else if (!r.isAttack && det) fp++;
      else tn++;
    }
    const attackTotal = tp + fn;
    const benignTotal = fp + tn;
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    summary.thresholds[t] = {
      truePositive: tp,
      falseNegative: fn,
      falsePositive: fp,
      trueNegative: tn,
      detectionRate: attackTotal ? tp / attackTotal : 0,
      falsePositiveRate: benignTotal ? fp / benignTotal : 0,
      f1: tp ? (2 * precision * recall) / (precision + recall) : 0
    };
  }

  return { perAttack, summary, baseline: baseline.summary };
}
