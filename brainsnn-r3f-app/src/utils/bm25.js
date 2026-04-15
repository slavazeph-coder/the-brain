/**
 * Layer 20 — BM25 hybrid search
 *
 * Pure JS BM25 ranking + trigram similarity for hybrid retrieval.
 * Cannibalized from GitNexus's BM25 + semantic fusion pattern, simplified:
 * we skip the embedding step (no WASM deps) and use trigram Jaccard as
 * a cheap stand-in for semantic similarity. Reciprocal Rank Fusion
 * combines both rankings.
 */

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'of', 'in',
  'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'that', 'this',
  'these', 'those', 'it', 'its', 'if', 'then', 'else', 'so', 'not', 'no'
]);

export function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function trigrams(text) {
  if (!text) return new Set();
  const s = text.toLowerCase().replace(/\s+/g, ' ');
  const out = new Set();
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---------- BM25 ----------

export function buildBM25Index(docs) {
  // docs: [{ id, text, ...meta }]
  const tokenized = docs.map((d) => ({ ...d, tokens: tokenize(d.text || ''), tri: trigrams(d.text || '') }));
  const N = tokenized.length;
  const df = new Map();
  for (const doc of tokenized) {
    const seen = new Set(doc.tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const avgdl = tokenized.reduce((a, d) => a + d.tokens.length, 0) / Math.max(1, N);
  return { docs: tokenized, N, df, avgdl };
}

export function bm25Score(query, index, { k1 = 1.5, b = 0.75 } = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.length || !index.docs.length) return [];
  return index.docs.map((doc) => {
    let score = 0;
    for (const qt of qTokens) {
      const freq = doc.tokens.filter((t) => t === qt).length;
      if (!freq) continue;
      const idf = Math.log(1 + (index.N - (index.df.get(qt) || 0) + 0.5) / ((index.df.get(qt) || 0) + 0.5));
      const norm = freq * (k1 + 1) / (freq + k1 * (1 - b + b * (doc.tokens.length / index.avgdl)));
      score += idf * norm;
    }
    return { id: doc.id, score, doc };
  }).sort((a, b) => b.score - a.score);
}

// ---------- hybrid via RRF ----------

export function hybridSearch(query, index, { topK = 10, k = 60 } = {}) {
  const bm25Ranked = bm25Score(query, index);
  const qTri = trigrams(query);
  const semanticRanked = index.docs
    .map((doc) => ({ id: doc.id, score: jaccard(qTri, doc.tri), doc }))
    .sort((a, b) => b.score - a.score);

  return fuseRanked(bm25Ranked, semanticRanked, index.docs, topK, k, 'trigram');
}

/**
 * Layer 24 upgrade — hybrid search that uses real embeddings when available.
 * Falls back to trigram Jaccard if embeddings aren't loaded.
 * Requires async because embedding lookup is async.
 */
export async function hybridSearchSemantic(query, index, {
  topK = 10,
  k = 60,
  embedFn = null,    // async (text) => Float32Array
  cosineFn = null    // (a, b) => number
} = {}) {
  const bm25Ranked = bm25Score(query, index);

  let semanticRanked;
  let backend = 'trigram';

  if (embedFn && cosineFn) {
    try {
      const qVec = await embedFn(query);
      // Embed each doc (cache layer inside embedFn handles repeats)
      const docVecs = await Promise.all(index.docs.map((d) => embedFn(d.text || '')));
      semanticRanked = index.docs
        .map((doc, i) => ({ id: doc.id, score: cosineFn(qVec, docVecs[i]), doc }))
        .sort((a, b) => b.score - a.score);
      backend = 'embedding';
    } catch {
      // Fall back to trigram on any failure
      const qTri = trigrams(query);
      semanticRanked = index.docs
        .map((doc) => ({ id: doc.id, score: jaccard(qTri, doc.tri), doc }))
        .sort((a, b) => b.score - a.score);
    }
  } else {
    const qTri = trigrams(query);
    semanticRanked = index.docs
      .map((doc) => ({ id: doc.id, score: jaccard(qTri, doc.tri), doc }))
      .sort((a, b) => b.score - a.score);
  }

  const fused = fuseRanked(bm25Ranked, semanticRanked, index.docs, topK, k, backend);
  return { results: fused, backend };
}

function fuseRanked(bm25Ranked, semanticRanked, docs, topK, k, backendLabel) {
  // Reciprocal Rank Fusion
  const ranks = new Map();
  bm25Ranked.forEach((r, i) => {
    ranks.set(r.id, (ranks.get(r.id) || 0) + 1 / (k + i + 1));
  });
  semanticRanked.forEach((r, i) => {
    ranks.set(r.id, (ranks.get(r.id) || 0) + 1 / (k + i + 1));
  });

  const byId = new Map(docs.map((d) => [d.id, d]));
  return Array.from(ranks.entries())
    .map(([id, score]) => ({
      id,
      score,
      doc: byId.get(id),
      bm25: bm25Ranked.find((r) => r.id === id)?.score ?? 0,
      semantic: semanticRanked.find((r) => r.id === id)?.score ?? 0,
      backend: backendLabel
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
