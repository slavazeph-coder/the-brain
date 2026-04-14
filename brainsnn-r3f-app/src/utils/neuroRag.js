/**
 * Layer 28 — Neuro-RAG (Neural Retrieval-Augmented Generation)
 *
 * Paste documents → chunk into overlapping windows → embed each chunk
 * via Layer 24's transformers.js → ask a question → cosine-rank chunks
 * → return top-k with citations. Maps retrieval results onto brain
 * regions (HPC = memory hit strength, CTX = context breadth).
 *
 * Falls back to BM25 + trigram similarity when embeddings aren't ready.
 */

import { embed, embedBatch, cosineSimilarity, isReady as embeddingsReady } from './embeddings';
import { buildBM25Index, hybridSearch } from './bm25';

const CHUNK_SIZE = 180;       // words per chunk
const CHUNK_OVERLAP = 40;     // word overlap
const MIN_CHUNK_WORDS = 20;   // drop trailing fragments smaller than this

// ---------- in-memory index ----------

let ragIndex = {
  chunks: [],        // [{ id, docTitle, chunkIdx, text, embedding?: Float32Array }]
  bm25: null,        // fallback
  createdAt: null,
  usingEmbeddings: false,
  stats: { docs: 0, chunks: 0, words: 0 }
};

const subscribers = new Set();
function emit() {
  const snap = getRagStatus();
  for (const cb of subscribers) { try { cb(snap); } catch { /* ignore */ } }
}

export function subscribeRag(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getRagStatus() {
  return {
    indexed: ragIndex.chunks.length > 0,
    usingEmbeddings: ragIndex.usingEmbeddings,
    stats: { ...ragIndex.stats },
    createdAt: ragIndex.createdAt
  };
}

export function clearIndex() {
  ragIndex = {
    chunks: [],
    bm25: null,
    createdAt: null,
    usingEmbeddings: false,
    stats: { docs: 0, chunks: 0, words: 0 }
  };
  emit();
}

// ---------- parsing ----------

/**
 * Parse a blob of raw text into documents. Supports:
 *   === Title ===
 *   <body...>
 *   === Another Title ===
 *   <body...>
 * If no delimiters, treats the whole blob as a single "Document".
 */
export function parseDocuments(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const delim = /^\s*===\s*(.+?)\s*===\s*$/gm;
  const matches = [...raw.matchAll(delim)];
  if (!matches.length) {
    return [{ title: 'Document', body: raw.trim() }];
  }
  const docs = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const next = matches[i + 1];
    const start = m.index + m[0].length;
    const end = next ? next.index : raw.length;
    const body = raw.slice(start, end).trim();
    if (body) docs.push({ title: m[1].trim(), body });
  }
  return docs;
}

/**
 * Chunk a document into overlapping word windows.
 */
export function chunkDocument(title, body, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const words = body.split(/\s+/).filter(Boolean);
  const chunks = [];
  if (words.length <= chunkSize) {
    if (words.length >= MIN_CHUNK_WORDS) {
      chunks.push({ docTitle: title, chunkIdx: 0, text: words.join(' ') });
    }
    return chunks;
  }
  let i = 0;
  let idx = 0;
  const stride = Math.max(1, chunkSize - overlap);
  while (i < words.length) {
    const slice = words.slice(i, i + chunkSize);
    if (slice.length >= MIN_CHUNK_WORDS) {
      chunks.push({ docTitle: title, chunkIdx: idx++, text: slice.join(' ') });
    }
    if (i + chunkSize >= words.length) break;
    i += stride;
  }
  return chunks;
}

// ---------- indexing ----------

/**
 * Build the RAG index from raw pasted text. Uses embeddings if ready,
 * otherwise BM25. Returns { chunks, usingEmbeddings }.
 */
export async function indexDocuments(raw, { onProgress } = {}) {
  const docs = parseDocuments(raw);
  if (!docs.length) throw new Error('No documents found.');

  const allChunks = [];
  let totalWords = 0;
  for (const d of docs) {
    const cs = chunkDocument(d.title, d.body);
    for (const c of cs) {
      allChunks.push({
        id: `${d.title}-${c.chunkIdx}`,
        docTitle: d.title,
        chunkIdx: c.chunkIdx,
        text: c.text
      });
      totalWords += c.text.split(/\s+/).length;
    }
  }

  if (!allChunks.length) throw new Error('No chunks produced — documents too short.');

  const useEmbed = embeddingsReady();
  if (useEmbed) {
    // Batch embed (embedBatch exists but is a sequential wrapper; track progress)
    for (let i = 0; i < allChunks.length; i++) {
      try {
        allChunks[i].embedding = await embed(allChunks[i].text);
      } catch (_err) {
        // If embedding fails mid-way, fall back to BM25 for the rest
        break;
      }
      if (onProgress) onProgress(i + 1, allChunks.length);
    }
  }

  // Always build BM25 as a fallback + hybrid signal
  const bm25Docs = allChunks.map((c, i) => ({ id: c.id, text: c.text, index: i }));
  const bm25Index = buildBM25Index(bm25Docs);

  ragIndex = {
    chunks: allChunks,
    bm25: bm25Index,
    createdAt: Date.now(),
    usingEmbeddings: useEmbed && !!allChunks[0]?.embedding,
    stats: { docs: docs.length, chunks: allChunks.length, words: totalWords }
  };

  emit();
  return {
    chunks: allChunks.length,
    docs: docs.length,
    usingEmbeddings: ragIndex.usingEmbeddings
  };
}

// ---------- query ----------

/**
 * Query the RAG index. Returns top-k chunks with similarity scores.
 * Uses cosine similarity on embeddings when available, falls back to
 * BM25 + trigram hybrid otherwise.
 */
export async function queryRag(question, { topK = 4 } = {}) {
  if (!ragIndex.chunks.length) throw new Error('Index empty. Index documents first.');
  if (!question?.trim()) return { results: [], mode: 'empty' };

  if (ragIndex.usingEmbeddings) {
    try {
      const qVec = await embed(question);
      const scored = ragIndex.chunks
        .filter((c) => c.embedding)
        .map((c) => ({
          id: c.id,
          docTitle: c.docTitle,
          chunkIdx: c.chunkIdx,
          text: c.text,
          score: cosineSimilarity(qVec, c.embedding)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return {
        results: scored,
        mode: 'embeddings',
        queryWords: question.split(/\s+/).length
      };
    } catch (_err) {
      // Fall through to BM25
    }
  }

  const ranked = hybridSearch(question, ragIndex.bm25, { topK });
  const results = ranked.map((r) => {
    const chunk = ragIndex.chunks[r.doc?.index ?? 0];
    return {
      id: chunk.id,
      docTitle: chunk.docTitle,
      chunkIdx: chunk.chunkIdx,
      text: chunk.text,
      score: r.score ?? 0,
      backends: { bm25: r.bm25, trigram: r.semantic }
    };
  });
  return { results, mode: 'bm25', queryWords: question.split(/\s+/).length };
}

// ---------- brain mapping ----------

/**
 * Map RAG results onto brain regions: HPC rises with retrieval strength
 * (memory recall), CTX with result count (active context), PFC with
 * top-hit dominance (focused reasoning).
 */
export function mapRagToRegions(state, ragResult) {
  if (!ragResult?.results?.length) return state;
  const regions = { ...state.regions };

  const topScore = ragResult.results[0]?.score ?? 0;
  const meanScore = ragResult.results.reduce((a, r) => a + (r.score ?? 0), 0) / ragResult.results.length;
  const breadth = Math.min(1, ragResult.results.length / 6);

  // Clamp and blend
  const clamp = (v) => Math.max(0.04, Math.min(0.95, v));
  regions.HPC = clamp(regions.HPC + topScore * 0.35);
  regions.CTX = clamp(regions.CTX + breadth * 0.20);
  regions.PFC = clamp(regions.PFC + (topScore - meanScore) * 0.30);
  regions.THL = clamp(regions.THL + breadth * 0.10);

  return {
    ...state,
    regions,
    scenario: `Neuro-RAG · ${ragResult.mode}`,
    burst: Math.max(state.burst, 6)
  };
}

// ---------- highlight helper ----------

export function highlightMatches(text, query) {
  if (!query) return [{ text, match: false }];
  const qTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (!qTokens.length) return [{ text, match: false }];
  const pattern = new RegExp(`\\b(${qTokens.map(escapeRegex).join('|')})\\b`, 'gi');
  const parts = [];
  let last = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
