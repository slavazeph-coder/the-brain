/**
 * Layer 51 — Style Fingerprint
 *
 * Stylometric signature of any text. Captures the features authors
 * are notoriously bad at disguising: sentence length distribution,
 * function-word frequency, punctuation rhythm, caps density, typo
 * habits. Two fingerprints can be compared for "same author?"
 * likelihood (cosine similarity over the feature vector).
 *
 * Dependency-free — works in the browser and on the server.
 */

const FUNCTION_WORDS = [
  'the','of','and','to','a','in','that','it','is','i','was','for','on','you','with',
  'as','at','be','this','but','they','have','not','from','or','one','had','by','word',
  'an','we','when','your','can','said','there','use','each','which','she','do','how',
  'if','will','up','about','out','many','then','them','these','so','some','her','would',
];

function countRegex(re, text) {
  return (text.match(re) || []).length;
}

function pushDist(buckets, val, edges) {
  for (let i = 0; i < edges.length; i++) {
    if (val <= edges[i]) { buckets[i]++; return; }
  }
  buckets[buckets.length - 1]++;
}

/**
 * 12-dim fingerprint of a text. All values are 0..1 (ratios).
 */
export function fingerprint(text = '') {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (trimmed.length < 20) {
    return {
      vector: new Array(12).fill(0),
      stats: null,
    };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lower = trimmed.toLowerCase();
  const sentences = trimmed.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const sentCount = Math.max(1, sentences.length);

  // Sentence length distribution (words per sentence) — 3 buckets: short, med, long
  const sentBuckets = [0, 0, 0];
  for (const s of sentences) {
    pushDist(sentBuckets, s.split(/\s+/).filter(Boolean).length, [8, 20]);
  }
  const sentShort = sentBuckets[0] / sentCount;
  const sentMed = sentBuckets[1] / sentCount;
  const sentLong = sentBuckets[2] / sentCount;

  // Function-word frequency (fraction of tokens that are function words)
  const funcHits = words.filter((w) => FUNCTION_WORDS.includes(w.replace(/[^a-z']/gi, '').toLowerCase())).length;
  const funcFreq = funcHits / wordCount;

  // Punctuation rhythm (commas per sentence, semicolons per 1k chars)
  const commaPerSent = countRegex(/,/g, trimmed) / sentCount;
  const semiPerK = countRegex(/;/g, trimmed) / Math.max(1, trimmed.length / 1000);

  // Caps + exclamation density
  const capsRuns = countRegex(/\b[A-Z]{3,}\b/g, trimmed);
  const capsDensity = capsRuns / Math.max(1, sentCount);
  const exclPer100 = countRegex(/!/g, trimmed) / Math.max(1, wordCount / 100);

  // Ellipsis + em-dash habits
  const ellipsisPer100 = countRegex(/\.{3,}|…/g, trimmed) / Math.max(1, wordCount / 100);
  const emdashPer100 = countRegex(/—/g, trimmed) / Math.max(1, wordCount / 100);

  // Average word length
  const avgWordLen = words.reduce((a, w) => a + w.length, 0) / wordCount;

  // Hedging words — "maybe", "perhaps", "possibly", "seems", "appears"
  const hedgeHits = countRegex(/\b(maybe|perhaps|possibly|seems?|appears?)\b/gi, trimmed);
  const hedgeRate = hedgeHits / Math.max(1, wordCount / 100);

  // Normalize each feature into 0..1 for cosine comparison
  const norm = (v, min, max) => Math.max(0, Math.min(1, (v - min) / (max - min)));

  const vector = [
    sentShort,
    sentMed,
    sentLong,
    norm(funcFreq, 0.2, 0.55),
    norm(commaPerSent, 0, 6),
    norm(semiPerK, 0, 4),
    norm(capsDensity, 0, 3),
    norm(exclPer100, 0, 5),
    norm(ellipsisPer100, 0, 3),
    norm(emdashPer100, 0, 3),
    norm(avgWordLen, 3, 7),
    norm(hedgeRate, 0, 2.5),
  ];

  return {
    vector,
    stats: {
      words: wordCount,
      sentences: sentCount,
      sentShort, sentMed, sentLong,
      funcFreq,
      commaPerSent,
      semiPerK,
      capsDensity,
      exclPer100,
      ellipsisPer100,
      emdashPer100,
      avgWordLen,
      hedgeRate,
    },
  };
}

/**
 * Cosine similarity between two fingerprint vectors. 0..1.
 */
export function compareFingerprints(a, b) {
  if (!a?.vector?.length || !b?.vector?.length || a.vector.length !== b.vector.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.vector.length; i++) {
    dot += a.vector[i] * b.vector[i];
    na += a.vector[i] * a.vector[i];
    nb += b.vector[i] * b.vector[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function similarityVerdict(sim) {
  if (sim >= 0.97) return { label: 'Very likely same author', color: '#5ee69a' };
  if (sim >= 0.90) return { label: 'Likely same author', color: '#77dbe4' };
  if (sim >= 0.78) return { label: 'Plausible overlap', color: '#fdab43' };
  if (sim >= 0.60) return { label: 'Weak overlap', color: '#e57b40' };
  return { label: 'Distinct styles', color: '#dd6974' };
}

// Labels for the 12 features, used by the panel's bar display
export const FEATURE_LABELS = [
  'Short sentences', 'Medium sentences', 'Long sentences',
  'Function-word freq', 'Commas / sentence', 'Semicolons / 1k',
  'Caps runs / sent', 'Exclam / 100 w', 'Ellipsis / 100 w',
  'Em-dash / 100 w', 'Avg word length', 'Hedging / 100 w',
];
