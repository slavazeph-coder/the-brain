/**
 * Layer 69 — Similarity Search
 *
 * "Find similar" across the receipts + context log. We don't store
 * the full scanned text for privacy reasons (receipts.excerpt caps
 * at 80 chars; context.excerpt caps at 160). So this is a trigram
 * Jaccard search — fast, local, effective enough for "have I seen
 * something like this before?"
 *
 * When MiniLM embeddings are ready (Layer 24), we upgrade to cosine
 * over embed-on-demand — same API, better recall.
 */

import { recentReceipts } from './receipt';
import { listContextEntries } from './contextMemory';
import { isReady as embReady, embed, cosineSimilarity } from './embeddings';

function trigrams(text) {
  const clean = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const out = new Set();
  for (let i = 0; i + 3 <= clean.length; i++) {
    out.add(clean.slice(i, i + 3));
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function buildHaystack() {
  const seen = new Map();
  for (const r of recentReceipts()) {
    if (!r.excerpt) continue;
    const key = `r:${r.id}`;
    seen.set(key, {
      id: key,
      source: 'receipt',
      ts: r.ts,
      pressure: r.pressure || 0,
      excerpt: r.excerpt,
    });
  }
  for (const e of listContextEntries()) {
    if (!e.excerpt) continue;
    const key = `c:${e.entity}:${e.ts}`;
    seen.set(key, {
      id: key,
      source: 'context',
      entity: e.entity,
      ts: e.ts,
      pressure: e.pressure || 0,
      excerpt: e.excerpt,
    });
  }
  return [...seen.values()];
}

export async function searchSimilar(query, { limit = 10, minScore = 0.12 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 8) return [];
  const haystack = buildHaystack();
  if (!haystack.length) return [];

  // Prefer embeddings when ready
  if (embReady()) {
    try {
      const qVec = await embed(q.slice(0, 600));
      const results = [];
      for (const item of haystack) {
        try {
          const vec = await embed(item.excerpt.slice(0, 600));
          results.push({ ...item, score: cosineSimilarity(qVec, vec), via: 'embed' });
        } catch { /* skip */ }
      }
      return results
        .filter((r) => r.score >= Math.max(minScore, 0.3))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch { /* fall through */ }
  }

  // Trigram fallback
  const qTri = trigrams(q);
  return haystack
    .map((item) => ({ ...item, score: jaccard(qTri, trigrams(item.excerpt)), via: 'trigram' }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function haystackSize() {
  return buildHaystack().length;
}
