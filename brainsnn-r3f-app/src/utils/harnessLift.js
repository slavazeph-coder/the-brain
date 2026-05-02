/**
 * Layer 102 — Harness Lift Miner (generalized)
 *
 * Layer 27 (Adversarial Training) mines n-gram lift between attack vs
 * benign text to grow the firewall. HALO does the same trick over
 * trace spans: which span attribute values are over-represented in
 * "bad" outcomes vs "good" ones?
 *
 * This module generalizes the lift idea so it works on any labelled
 * collection of records — spans, scans, or arbitrary {features, label}
 * tuples — and surfaces the top-K most discriminative features.
 *
 *   mineLift(records, { features, isPositive, minPositive, minLift })
 *
 *   features:    (record) => string[] — extract feature tokens
 *   isPositive:  (record) => boolean   — positive vs negative class
 *
 * Returns:
 *   {
 *     candidates: [{ feature, lift, posCount, negCount }, …],
 *     stats: { positive, negative, candidates }
 *   }
 *
 * Laplace-smoothed lift = P(f|pos) / P(f|neg). Feature is interesting
 * if pos-count >= minPositive AND lift >= minLift.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'it', 'this',
  'that', 'these', 'those', 'i', 'you', 'we', 'they', 'so', 'if', 'then', 'than',
]);

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

export function textNgrams(text, sizes = [2, 3]) {
  const toks = tokenize(text);
  const out = [];
  for (const n of sizes) out.push(...ngrams(toks, n));
  return out;
}

/**
 * Generic lift miner. Works on any labelled records once you give it
 * a feature-extraction function.
 */
export function mineLift(records, {
  features,
  isPositive,
  minPositive = 2,
  minLift = 3,
  topK = 20,
} = {}) {
  if (!Array.isArray(records) || records.length === 0 || !features || !isPositive) {
    return { candidates: [], stats: { positive: 0, negative: 0, candidates: 0 } };
  }

  const posCounts = new Map();
  const negCounts = new Map();
  let posTotal = 0;
  let negTotal = 0;

  for (const r of records) {
    const feats = features(r) || [];
    if (feats.length === 0) continue;
    if (isPositive(r)) {
      posTotal += 1;
      const seen = new Set();
      for (const f of feats) {
        if (seen.has(f)) continue;
        seen.add(f);
        posCounts.set(f, (posCounts.get(f) || 0) + 1);
      }
    } else {
      negTotal += 1;
      const seen = new Set();
      for (const f of feats) {
        if (seen.has(f)) continue;
        seen.add(f);
        negCounts.set(f, (negCounts.get(f) || 0) + 1);
      }
    }
  }

  if (posTotal === 0) {
    return { candidates: [], stats: { positive: 0, negative: negTotal, candidates: 0 } };
  }

  const candidates = [];
  for (const [f, pc] of posCounts.entries()) {
    if (pc < minPositive) continue;
    const nc = negCounts.get(f) || 0;
    const pPos = (pc + 0.5) / (posTotal + 1);
    const pNeg = (nc + 0.5) / (negTotal + 1);
    const lift = pPos / pNeg;
    if (lift >= minLift) {
      candidates.push({
        feature: f,
        lift: Number(lift.toFixed(2)),
        posCount: pc,
        negCount: nc,
      });
    }
  }

  candidates.sort((a, b) => b.lift - a.lift || b.posCount - a.posCount);

  return {
    candidates: candidates.slice(0, topK),
    stats: { positive: posTotal, negative: negTotal, candidates: candidates.length },
  };
}

/**
 * Convenience wrapper: mine lift over a collection of telemetry spans
 * by extracting the span name + selected attribute keys as features.
 */
export function mineSpansByOutcome(spans, {
  attributeKeys = [],
  isPositive,
  minPositive = 2,
  minLift = 3,
  topK = 20,
} = {}) {
  const features = (span) => {
    const out = [`name:${span.name}`];
    for (const key of attributeKeys) {
      const v = span.attributes?.[key];
      if (v == null) continue;
      out.push(`${key}:${String(v).toLowerCase()}`);
    }
    if (span.status?.code) out.push(`status:${span.status.code}`);
    return out;
  };
  return mineLift(spans, { features, isPositive, minPositive, minLift, topK });
}
