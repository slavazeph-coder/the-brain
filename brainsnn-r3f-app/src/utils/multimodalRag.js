/**
 * Layer 33 — Multimodal RAG Router
 *
 * Cannibalized from HKUDS/RAG-Anything's `modalprocessors.py` pattern:
 * heterogeneous content (text / image / table / equation / code) routes
 * through per-modality handlers that normalize each item into embeddable
 * "rendered text" while preserving a belongs_to hierarchy (doc → section →
 * block). That rendered text is embedded via Layer 24, retrieved via
 * cosine, falls back to Layer 20's BM25 index.
 *
 * Accepts two inputs:
 *   (a) Raw pasted markdown with inline block fences
 *         === Title ===
 *         Regular paragraph text.
 *         ```image { "src": "...", "alt": "..." }```
 *         ```table
 *         H1 | H2 | H3
 *         a  | b  | c
 *         ```
 *         ```equation
 *         E = mc^2
 *         ```
 *         ```code lang=js
 *         function foo() {}
 *         ```
 *   (b) Pre-parsed content list (Layer 35 hook — "direct content insertion")
 *         [{ type, docTitle, section?, ...payload }]
 *
 * Neither input assumes a browser-side parser — external parsers (MinerU,
 * Docling, Obsidian exports, MCP tools) can emit the content list directly.
 */

import { embed, cosineSimilarity, isReady as embeddingsReady } from './embeddings';
import { buildBM25Index, hybridSearch } from './bm25';
import { analyzeMultimodalWithGemma, isGemmaConfigured } from './gemmaEngine';

export const MODALITIES = ['text', 'image', 'table', 'equation', 'code'];

const MODALITY_WEIGHTS = {
  // Applied at query time — keeps text first-class but lets a query that
  // clearly targets one modality surface it. Tuneable from the panel later.
  text: 1.0,
  image: 0.95,
  table: 0.95,
  equation: 0.9,
  code: 0.95
};

// ---------- in-memory index ----------

let mmIndex = {
  items: [],           // normalized { id, type, docTitle, section, renderedText, payload, embedding? }
  bm25: null,          // fallback index over renderedText
  hierarchy: [],       // belongs_to edges [{ from, to, kind }]
  createdAt: null,
  usingEmbeddings: false,
  stats: { docs: 0, items: 0, byModality: {} }
};

const subscribers = new Set();

function emit() {
  const snap = getMultimodalStatus();
  for (const cb of subscribers) { try { cb(snap); } catch { /* ignore */ } }
}

export function subscribeMultimodalRag(cb) {
  subscribers.add(cb);
  cb(getMultimodalStatus());
  return () => subscribers.delete(cb);
}

export function getMultimodalStatus() {
  return {
    indexed: mmIndex.items.length > 0,
    usingEmbeddings: mmIndex.usingEmbeddings,
    stats: { ...mmIndex.stats, byModality: { ...mmIndex.stats.byModality } },
    createdAt: mmIndex.createdAt,
    hierarchySize: mmIndex.hierarchy.length
  };
}

export function clearMultimodalIndex() {
  mmIndex = {
    items: [],
    bm25: null,
    hierarchy: [],
    createdAt: null,
    usingEmbeddings: false,
    stats: { docs: 0, items: 0, byModality: {} }
  };
  emit();
}

// ---------- content parsing ----------

const BLOCK_FENCE = /```(image|table|equation|code)(?:\s+([^\n`]*))?\n([\s\S]*?)```/g;
const DOC_DELIM = /^\s*===\s*(.+?)\s*===\s*$/gm;

/**
 * Parse raw markdown into a content list: text paragraphs + fenced
 * multimodal blocks. Returns [{ type, docTitle, section?, ...payload }].
 */
export function parseMultimodalDocs(raw) {
  if (!raw || typeof raw !== 'string') return [];

  // Split into docs first
  const docMatches = [...raw.matchAll(DOC_DELIM)];
  const docs = [];
  if (!docMatches.length) {
    docs.push({ title: 'Document', body: raw });
  } else {
    for (let i = 0; i < docMatches.length; i++) {
      const m = docMatches[i];
      const next = docMatches[i + 1];
      const start = m.index + m[0].length;
      const end = next ? next.index : raw.length;
      docs.push({ title: m[1].trim(), body: raw.slice(start, end) });
    }
  }

  const out = [];
  for (const doc of docs) {
    let cursor = 0;
    let section = null;
    const body = doc.body;

    // Detect fenced blocks first, keeping intervening text as paragraphs
    const fences = [];
    let fm;
    const re = new RegExp(BLOCK_FENCE.source, 'g');
    while ((fm = re.exec(body)) !== null) {
      fences.push({
        kind: fm[1],
        meta: (fm[2] || '').trim(),
        content: fm[3].trim(),
        start: fm.index,
        end: fm.index + fm[0].length
      });
    }

    for (const f of fences) {
      if (f.start > cursor) {
        addTextParagraphs(out, doc.title, section, body.slice(cursor, f.start));
      }
      out.push(buildFencedItem(doc.title, section, f));
      cursor = f.end;
    }
    if (cursor < body.length) {
      addTextParagraphs(out, doc.title, section, body.slice(cursor));
    }
  }

  return out;
}

function addTextParagraphs(out, docTitle, section, chunk) {
  const trimmed = chunk.trim();
  if (!trimmed) return;
  // Split on blank lines — each paragraph is its own indexable unit so
  // retrieval can pull the tightest relevant text.
  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const p of paragraphs) {
    // Section heading detection (`## Heading` or `# Heading`)
    const heading = p.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      out.push({ type: 'heading', docTitle, section, text: heading[1].trim() });
      continue;
    }
    out.push({ type: 'text', docTitle, section, text: p });
  }
}

function buildFencedItem(docTitle, section, f) {
  if (f.kind === 'image') {
    // meta is JSON-ish: { "src": "...", "alt": "...", "caption": "..." }
    let payload = {};
    try { payload = f.meta ? JSON.parse(f.meta) : {}; } catch { payload = { alt: f.meta }; }
    return {
      type: 'image',
      docTitle,
      section,
      src: payload.src || null,
      alt: payload.alt || '',
      caption: payload.caption || f.content || ''
    };
  }
  if (f.kind === 'table') {
    const lines = f.content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const [headerLine, ...rowLines] = lines;
    const headers = (headerLine || '').split(/\s*\|\s*/).filter(Boolean);
    const rows = rowLines
      .filter((l) => !/^[-|\s]+$/.test(l))   // skip markdown separator lines
      .map((l) => l.split(/\s*\|\s*/).filter(Boolean));
    return { type: 'table', docTitle, section, headers, rows, caption: parseMetaCaption(f.meta) };
  }
  if (f.kind === 'equation') {
    return {
      type: 'equation',
      docTitle,
      section,
      latex: f.content,
      caption: parseMetaCaption(f.meta)
    };
  }
  if (f.kind === 'code') {
    const lang = (f.meta.match(/lang=(\S+)/) || [])[1] || 'text';
    return { type: 'code', docTitle, section, lang, code: f.content };
  }
  return { type: 'text', docTitle, section, text: f.content };
}

function parseMetaCaption(meta) {
  if (!meta) return '';
  try {
    const parsed = JSON.parse(meta);
    return parsed.caption || parsed.alt || '';
  } catch {
    return meta;
  }
}

// ---------- per-modality handlers ----------

/**
 * Each handler turns a structured content item into "renderedText" that
 * can be embedded into the same vector space as plain text. That's the
 * core RAG-Anything trick: a vision caption is just text from the
 * retriever's point of view.
 */

const HANDLERS = {
  text: (item) => ({
    renderedText: item.text,
    summary: item.text.slice(0, 120)
  }),

  heading: (item) => ({
    renderedText: `Section: ${item.text}`,
    summary: item.text
  }),

  image: async (item, { useGemma } = {}) => {
    let caption = item.caption || item.alt || '';
    let gemmaUsed = false;
    if (useGemma && item.file && isGemmaConfigured()) {
      try {
        const gem = await analyzeMultimodalWithGemma(item.file);
        caption = [caption, gem.reasoning, gem.evidence?.join('; ')].filter(Boolean).join(' · ');
        gemmaUsed = true;
      } catch { /* keep fallback caption */ }
    }
    const src = item.src ? ` [${item.src}]` : '';
    const rendered = `Image${src} alt="${item.alt || ''}" caption: ${caption || '(no caption)'}`;
    return { renderedText: rendered, summary: caption || item.alt || item.src || 'Image', gemmaUsed };
  },

  table: (item) => {
    // Flatten the table into row-level sentences so retrieval can hit the
    // specific cell that matters — this is what RAG-Anything's TableProcessor
    // does (statistical pattern + semantic relationship extraction),
    // simplified to just the semantic part.
    const headers = item.headers || [];
    const rowSentences = (item.rows || []).map((row) =>
      headers.length
        ? headers.map((h, i) => `${h}: ${row[i] ?? ''}`).join(', ')
        : row.join(', ')
    );
    const rendered = [
      `Table (${item.rows?.length ?? 0} rows × ${headers.length} cols)${item.caption ? `: ${item.caption}` : ''}`,
      headers.length ? `Columns: ${headers.join(', ')}.` : '',
      rowSentences.join(' | ')
    ].filter(Boolean).join(' ');
    return { renderedText: rendered, summary: item.caption || `Table · ${headers.join(' / ')}` };
  },

  equation: (item) => {
    // Simple LaTeX → natural language: strip common operators to reveal
    // the variables/constants that matter for lexical retrieval.
    const vars = (item.latex || '').match(/[A-Za-z_][A-Za-z_0-9]*/g) || [];
    const uniqVars = [...new Set(vars)].slice(0, 8).join(', ');
    const rendered = `Equation: ${item.latex}. Symbols: ${uniqVars}.${item.caption ? ` Caption: ${item.caption}.` : ''}`;
    return { renderedText: rendered, summary: item.latex.slice(0, 80) };
  },

  code: (item) => {
    // Surface identifiers + comments so BM25 + trigrams hit. Full code
    // stays in the payload for the panel to display.
    const identifiers = (item.code.match(/[A-Za-z_][A-Za-z_0-9]*/g) || []).slice(0, 40);
    const comments = (item.code.match(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g) || []).join(' ');
    const rendered = `Code (${item.lang}): ${comments} Identifiers: ${[...new Set(identifiers)].join(' ')}`;
    return { renderedText: rendered, summary: `${item.lang} · ${(identifiers[0] || '(snippet)')}` };
  }
};

async function renderItem(item, options) {
  const handler = HANDLERS[item.type] || HANDLERS.text;
  return handler(item, options);
}

// ---------- indexing ----------

/**
 * Build the multimodal index from either:
 *   - rawText: markdown-style documents with inline fences, OR
 *   - contentList: pre-parsed [{ type, docTitle, ... }] array
 */
export async function indexMultimodal({
  rawText = null,
  contentList = null,
  useGemma = false,
  onProgress = null
} = {}) {
  const items = contentList && contentList.length
    ? contentList.slice()
    : parseMultimodalDocs(rawText || '');

  if (!items.length) throw new Error('No content found to index.');

  const normalized = [];
  const hierarchy = [];
  const byDoc = new Map();
  const byModality = {};

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const rendered = await renderItem(raw, { useGemma });
    const id = `${raw.docTitle || 'doc'}-${i}`;
    const entry = {
      id,
      type: raw.type,
      docTitle: raw.docTitle || 'Document',
      section: raw.section || null,
      renderedText: rendered.renderedText,
      summary: rendered.summary,
      payload: raw,
      gemmaUsed: rendered.gemmaUsed || false
    };
    normalized.push(entry);

    // belongs_to: item → doc (and → section when tracked)
    hierarchy.push({ from: id, to: `doc::${entry.docTitle}`, kind: 'belongs_to' });
    byDoc.set(entry.docTitle, (byDoc.get(entry.docTitle) || 0) + 1);
    byModality[entry.type] = (byModality[entry.type] || 0) + 1;

    if (onProgress) onProgress({ phase: 'parse', done: i + 1, total: items.length });
  }

  // Embed rendered text via Layer 24
  const useEmbed = embeddingsReady();
  if (useEmbed) {
    for (let i = 0; i < normalized.length; i++) {
      try {
        normalized[i].embedding = await embed(normalized[i].renderedText);
      } catch {
        break;    // fall through to BM25 for the rest
      }
      if (onProgress) onProgress({ phase: 'embed', done: i + 1, total: normalized.length });
    }
  }

  // BM25 fallback over the rendered text (same corpus for fused retrieval)
  const bm25Docs = normalized.map((n, idx) => ({ id: n.id, text: n.renderedText, index: idx }));
  const bm25Index = buildBM25Index(bm25Docs);

  mmIndex = {
    items: normalized,
    bm25: bm25Index,
    hierarchy,
    createdAt: Date.now(),
    usingEmbeddings: useEmbed && !!normalized[0]?.embedding,
    stats: {
      docs: byDoc.size,
      items: normalized.length,
      byModality
    }
  };

  emit();
  return {
    docs: byDoc.size,
    items: normalized.length,
    byModality,
    usingEmbeddings: mmIndex.usingEmbeddings
  };
}

// ---------- query ----------

/**
 * Retrieve top-k multimodal items. Optional `filterTypes` narrows to a
 * subset of modalities. Modality-weighted cosine when embeddings are
 * active, BM25+trigram hybrid otherwise.
 */
export async function queryMultimodal(question, {
  topK = 5,
  filterTypes = null,
  modalityBias = null   // e.g. { image: 1.3 } to boost a modality for this query
} = {}) {
  if (!mmIndex.items.length) throw new Error('Index empty. Index content first.');
  if (!question?.trim()) return { results: [], mode: 'empty' };

  const weights = { ...MODALITY_WEIGHTS, ...(modalityBias || {}) };

  const candidates = filterTypes
    ? mmIndex.items.filter((n) => filterTypes.includes(n.type))
    : mmIndex.items;

  if (!candidates.length) return { results: [], mode: 'no-match' };

  if (mmIndex.usingEmbeddings) {
    try {
      const qVec = await embed(question);
      const scored = candidates
        .filter((n) => n.embedding)
        .map((n) => {
          const baseSim = cosineSimilarity(qVec, n.embedding);
          const weight = weights[n.type] ?? 1.0;
          return { ...projectResult(n), score: baseSim * weight, rawScore: baseSim };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { results: scored, mode: 'embeddings', byModality: modalityHistogram(scored) };
    } catch { /* fall through */ }
  }

  const bm25Ranked = hybridSearch(question, mmIndex.bm25, { topK: topK * 2 });
  const results = bm25Ranked
    .map((r) => {
      const item = mmIndex.items[r.doc?.index ?? 0];
      if (!item) return null;
      if (filterTypes && !filterTypes.includes(item.type)) return null;
      const weight = weights[item.type] ?? 1.0;
      return { ...projectResult(item), score: (r.score ?? 0) * weight, rawScore: r.score ?? 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return { results, mode: 'bm25', byModality: modalityHistogram(results) };
}

function projectResult(item) {
  return {
    id: item.id,
    type: item.type,
    docTitle: item.docTitle,
    section: item.section,
    summary: item.summary,
    renderedText: item.renderedText,
    payload: item.payload,
    gemmaUsed: item.gemmaUsed
  };
}

function modalityHistogram(results) {
  const out = {};
  for (const r of results) out[r.type] = (out[r.type] || 0) + 1;
  return out;
}

// ---------- direct content insertion (Layer 35 hook) ----------

/**
 * "Direct content insertion" — append pre-parsed items to an existing
 * index without reparsing. Mirrors RAG-Anything's `insert_content_list`.
 * Items must carry at minimum { type, docTitle }.
 */
export async function insertContentList(contentList, { useGemma = false } = {}) {
  if (!Array.isArray(contentList) || !contentList.length) {
    throw new Error('contentList must be a non-empty array');
  }
  if (!mmIndex.items.length) {
    return indexMultimodal({ contentList, useGemma });
  }

  const offset = mmIndex.items.length;
  const useEmbed = embeddingsReady() && mmIndex.usingEmbeddings;

  for (let i = 0; i < contentList.length; i++) {
    const raw = contentList[i];
    const rendered = await renderItem(raw, { useGemma });
    const id = `${raw.docTitle || 'doc'}-${offset + i}`;
    const entry = {
      id,
      type: raw.type,
      docTitle: raw.docTitle || 'Document',
      section: raw.section || null,
      renderedText: rendered.renderedText,
      summary: rendered.summary,
      payload: raw,
      gemmaUsed: rendered.gemmaUsed || false
    };
    if (useEmbed) {
      try { entry.embedding = await embed(entry.renderedText); } catch { /* ignore */ }
    }
    mmIndex.items.push(entry);
    mmIndex.hierarchy.push({ from: id, to: `doc::${entry.docTitle}`, kind: 'belongs_to' });
    mmIndex.stats.byModality[entry.type] = (mmIndex.stats.byModality[entry.type] || 0) + 1;
  }

  // Rebuild BM25 — cheap enough on small indexes, keeps scoring consistent
  const bm25Docs = mmIndex.items.map((n, idx) => ({ id: n.id, text: n.renderedText, index: idx }));
  mmIndex.bm25 = buildBM25Index(bm25Docs);
  mmIndex.stats.items = mmIndex.items.length;
  // docs stat: recount distinct
  mmIndex.stats.docs = new Set(mmIndex.items.map((n) => n.docTitle)).size;
  emit();

  return {
    added: contentList.length,
    total: mmIndex.items.length,
    usingEmbeddings: mmIndex.usingEmbeddings
  };
}

// ---------- brain mapping ----------

/**
 * Map multimodal retrieval onto the brain. Same HPC/CTX/PFC/THL skeleton
 * as Layer 28's `mapRagToRegions`, but with modality-specific biases:
 *   - images  → CTX (visual cortex proxy) gets a boost
 *   - tables  → PFC (executive / structured reasoning) gets a boost
 *   - equations → PFC + HPC (symbolic recall)
 *   - code    → PFC + CTX
 *
 * Each hit is a single coherent neural recall event.
 */
export function mapMultimodalToRegions(state, queryResult) {
  if (!queryResult?.results?.length) return state;
  const regions = { ...state.regions };
  const clamp = (v) => Math.max(0.04, Math.min(0.95, v));

  const topScore = queryResult.results[0]?.score ?? 0;
  const mean = queryResult.results.reduce((a, r) => a + (r.score ?? 0), 0) / queryResult.results.length;
  const breadth = Math.min(1, queryResult.results.length / 6);
  const hist = queryResult.byModality || {};

  regions.HPC = clamp(regions.HPC + topScore * 0.35);
  regions.CTX = clamp(regions.CTX + breadth * 0.20);
  regions.PFC = clamp(regions.PFC + (topScore - mean) * 0.30);
  regions.THL = clamp(regions.THL + breadth * 0.10);

  const n = Math.max(1, queryResult.results.length);
  const imgShare = (hist.image || 0) / n;
  const tableShare = (hist.table || 0) / n;
  const eqShare = (hist.equation || 0) / n;
  const codeShare = (hist.code || 0) / n;

  regions.CTX = clamp(regions.CTX + imgShare * 0.25 + codeShare * 0.10);
  regions.PFC = clamp(regions.PFC + tableShare * 0.25 + codeShare * 0.15 + eqShare * 0.20);
  regions.HPC = clamp(regions.HPC + eqShare * 0.15);

  return {
    ...state,
    regions,
    scenario: `Multimodal RAG · ${queryResult.mode}`,
    burst: Math.max(state.burst, 8)
  };
}

// ---------- exports for testing / Layer 34 ----------

export function _debugSnapshot() {
  return {
    items: mmIndex.items,
    hierarchy: mmIndex.hierarchy,
    stats: mmIndex.stats
  };
}
