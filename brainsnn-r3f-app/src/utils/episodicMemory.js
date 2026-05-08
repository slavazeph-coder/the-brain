/**
 * Layer 101 — Episodic Memory Store
 *
 * Persistent capture log with on-demand embeddings and similarity
 * search. Backs the Episodic Cortex panel and the synthesis engine.
 *
 * Design:
 *   - Captures live in `brainsnn_episodic_v1` localStorage as a flat
 *     array of routed records (synchronous classification +
 *     firewall + affect + genre + regions; see episodicRouter.js).
 *   - Embeddings live in a separate `brainsnn_episodic_emb_v1` slot
 *     keyed by capture hash so model upgrades can wipe the vector
 *     cache without losing the notes themselves.
 *   - `subscribe()` lets the panel re-render on every mutation.
 *   - `findSimilar()` and `mineClusters()` are the connection
 *     surface used by Daily Brief / Weekly Synthesis.
 *
 * Why not just Obsidian's graph? Because every capture here flows
 * through the firewall + affect decoder + genre + 8-way episodic
 * router before it lands. Connections aren't just lexical/wikilink —
 * they're semantic (MiniLM cosine), affective (shared emotion
 * fingerprint), and episodic (same category + nearby in time).
 */

import { embed, isReady as embeddingsReady, cosineSimilarity } from './embeddings';
import { routeCapture } from './episodicRouter';
import { EPISODIC_CATEGORIES } from '../data/episodicTaxonomy';

const STORE_KEY = 'brainsnn_episodic_v1';
const EMB_KEY = 'brainsnn_episodic_emb_v1';
const MAX_CAPTURES = 800;
const MAX_EMBED_CACHE = 800;

let memCaptures = null; // null = not yet loaded
let memEmbeddings = null;
const subscribers = new Set();

// ---------- load / save ----------

function loadCaptures() {
  if (memCaptures) return memCaptures;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    memCaptures = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(memCaptures)) memCaptures = [];
  } catch {
    memCaptures = [];
  }
  return memCaptures;
}

function saveCaptures() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(memCaptures || []));
  } catch { /* quota — ignore */ }
}

function loadEmbeddings() {
  if (memEmbeddings) return memEmbeddings;
  memEmbeddings = new Map();
  try {
    const raw = localStorage.getItem(EMB_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      for (const [hash, arr] of Object.entries(obj || {})) {
        memEmbeddings.set(hash, Float32Array.from(arr));
      }
    }
  } catch { /* ignore */ }
  return memEmbeddings;
}

function saveEmbeddings() {
  try {
    const obj = {};
    let n = 0;
    for (const [hash, vec] of memEmbeddings) {
      if (n++ >= MAX_EMBED_CACHE) break;
      obj[hash] = Array.from(vec);
    }
    localStorage.setItem(EMB_KEY, JSON.stringify(obj));
  } catch { /* quota — ignore */ }
}

// ---------- subscribe ----------

export function subscribeEpisodic(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function emit() {
  for (const cb of subscribers) {
    try { cb(); } catch { /* ignore */ }
  }
}

// ---------- core API ----------

/**
 * Capture a new note. Returns the routed record immediately.
 * Embeddings happen asynchronously when MiniLM is warm.
 */
export function addCapture(text, opts = {}) {
  const routed = routeCapture(text, opts);
  if (!routed) return null;
  const list = loadCaptures();

  // Dedup: if the same hash already exists in the last hour, bump ts
  // instead of adding a duplicate.
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recent = list.find((c) => c.hash === routed.hash && c.ts > cutoff);
  if (recent) {
    recent.ts = Date.now();
    saveCaptures();
    emit();
    return recent;
  }

  const record = {
    id: `cap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    kind: opts.kind || 'capture',         // 'capture' | 'insight' | 'brief' | 'synthesis'
    source: opts.source || 'manual',       // 'manual' | 'paste' | 'url' | 'voice' | 'import' | 'dream'
    pinned: !!opts.pinned,
    ...routed
  };

  list.unshift(record);
  if (list.length > MAX_CAPTURES) list.length = MAX_CAPTURES;
  memCaptures = list;
  saveCaptures();
  emit();

  // Background embed — don't block the UI.
  ensureEmbeddingFor(record).catch(() => { /* graceful — fall back to lexical */ });

  return record;
}

/**
 * Push a synthesis result back into the store as a derived insight.
 * This is the "vault talks back" loop — outputs from Daily Brief /
 * Weekly Synthesis become first-class captures the brain can read
 * on the next pass.
 */
export function addInsight(text, opts = {}) {
  return addCapture(text, { ...opts, kind: opts.kind || 'insight', source: 'synthesis' });
}

export function getCaptures(filter = {}) {
  const list = loadCaptures().slice();
  let out = list;
  if (filter.since) out = out.filter((c) => c.ts >= filter.since);
  if (filter.until) out = out.filter((c) => c.ts <= filter.until);
  if (filter.category) out = out.filter((c) => c.primary === filter.category);
  if (filter.kind) out = out.filter((c) => c.kind === filter.kind);
  if (filter.search) {
    const q = String(filter.search).toLowerCase();
    out = out.filter((c) =>
      c.text.toLowerCase().includes(q)
      || c.title.toLowerCase().includes(q)
      || (c.tags || []).some((t) => t.toLowerCase().includes(q))
      || (c.mentions || []).some((m) => m.toLowerCase().includes(q))
    );
  }
  if (filter.minPressure != null) {
    out = out.filter((c) => (c.firewall?.pressure || 0) >= filter.minPressure);
  }
  return out;
}

export function getCaptureById(id) {
  return loadCaptures().find((c) => c.id === id) || null;
}

export function deleteCapture(id) {
  const list = loadCaptures();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveCaptures();
  emit();
  return true;
}

export function togglePinned(id) {
  const cap = getCaptureById(id);
  if (!cap) return false;
  cap.pinned = !cap.pinned;
  saveCaptures();
  emit();
  return true;
}

export function clearAllCaptures() {
  memCaptures = [];
  saveCaptures();
  memEmbeddings?.clear();
  saveEmbeddings();
  emit();
}

export function captureCount() {
  return loadCaptures().length;
}

// ---------- aggregate stats ----------

export function captureStats() {
  const list = loadCaptures();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const week = 7 * day;

  const byCategory = {};
  for (const id of Object.keys(EPISODIC_CATEGORIES)) byCategory[id] = 0;
  let pressureSum = 0;
  let pressureN = 0;
  let last24h = 0;
  let last7d = 0;
  let dreamConsolidated = 0;
  for (const c of list) {
    byCategory[c.primary] = (byCategory[c.primary] || 0) + 1;
    if (c.firewall?.pressure != null) {
      pressureSum += c.firewall.pressure;
      pressureN += 1;
    }
    if (now - c.ts <= day) last24h++;
    if (now - c.ts <= week) last7d++;
    if (c.consolidatedAt) dreamConsolidated++;
  }

  return {
    total: list.length,
    last24h,
    last7d,
    meanPressure: pressureN > 0 ? pressureSum / pressureN : 0,
    byCategory,
    dreamConsolidated
  };
}

// ---------- embeddings ----------

async function ensureEmbeddingFor(record) {
  const cache = loadEmbeddings();
  if (cache.has(record.hash)) return cache.get(record.hash);
  if (!embeddingsReady()) return null;
  try {
    const text = `${record.title}\n\n${record.text}`.slice(0, 2400);
    const vec = await embed(text);
    cache.set(record.hash, vec);
    if (cache.size % 5 === 0) saveEmbeddings();
    return vec;
  } catch {
    return null;
  }
}

/**
 * Batch-embed every capture that doesn't yet have a vector.
 * Called by the panel's "Warm up" button or implicitly from
 * findSimilar / mineClusters.
 */
export async function ensureAllEmbeddings(progressCb) {
  if (!embeddingsReady()) return { ok: false, reason: 'embeddings-not-ready' };
  const list = loadCaptures();
  const cache = loadEmbeddings();
  let done = 0;
  for (const c of list) {
    if (cache.has(c.hash)) { done++; continue; }
    const text = `${c.title}\n\n${c.text}`.slice(0, 2400);
    try {
      const vec = await embed(text);
      cache.set(c.hash, vec);
    } catch { /* skip */ }
    done++;
    if (progressCb) progressCb({ done, total: list.length });
  }
  saveEmbeddings();
  return { ok: true, done, total: list.length };
}

export function getEmbeddingFor(hash) {
  return loadEmbeddings().get(hash) || null;
}

// ---------- similarity / connection mining ----------

/**
 * Find captures most similar to the target capture.
 * Cosine over MiniLM when warm, lexical Jaccard fallback otherwise.
 */
export function findSimilar(captureId, { k = 5, minScore = 0.32 } = {}) {
  const list = loadCaptures();
  const target = list.find((c) => c.id === captureId);
  if (!target) return [];

  const cache = loadEmbeddings();
  const targetVec = cache.get(target.hash);

  const scored = [];
  for (const c of list) {
    if (c.id === target.id) continue;
    let score;
    const cVec = cache.get(c.hash);
    if (targetVec && cVec) {
      score = cosineSimilarity(targetVec, cVec);
    } else {
      score = lexicalJaccard(target.text, c.text);
    }
    if (score >= minScore) scored.push({ id: c.id, score, capture: c });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function lexicalJaccard(a, b) {
  const trigrams = (s) => {
    const out = new Set();
    const t = s.toLowerCase().replace(/\s+/g, ' ');
    for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Mine connection clusters from a set of captures.
 *
 * Builds a similarity graph (edges where cosine ≥ threshold) and runs
 * union-find to extract connected components — same shape as the echo
 * detector (Layer 53). Each cluster is a "thread" the synthesis engine
 * can summarize as a connection or pattern.
 */
export function mineClusters(captures, { threshold = 0.42 } = {}) {
  const cache = loadEmbeddings();
  const n = captures.length;
  if (n < 2) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = captures[i];
    const va = cache.get(a.hash);
    for (let j = i + 1; j < n; j++) {
      const b = captures[j];
      const vb = cache.get(b.hash);
      let sim;
      if (va && vb) sim = cosineSimilarity(va, vb);
      else sim = lexicalJaccard(a.text, b.text);
      if (sim >= threshold) {
        edges.push({ i, j, sim });
        union(i, j);
      }
    }
  }

  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(captures[i]);
  }

  const clusters = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const meanPressure = members.reduce((s, c) => s + (c.firewall?.pressure || 0), 0) / members.length;
    const tsSpan = members.length > 1
      ? Math.max(...members.map((m) => m.ts)) - Math.min(...members.map((m) => m.ts))
      : 0;
    clusters.push({
      members,
      size: members.length,
      meanPressure,
      tsSpanMs: tsSpan,
      categories: dominantCategories(members)
    });
  }
  clusters.sort((a, b) => b.size - a.size);
  return clusters;
}

function dominantCategories(captures) {
  const tally = {};
  for (const c of captures) tally[c.primary] = (tally[c.primary] || 0) + 1;
  return Object.entries(tally)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([id, count]) => ({ id, count, label: EPISODIC_CATEGORIES[id]?.label || id }));
}

/**
 * Mark a capture as having been visited by Dream Mode consolidation.
 * Used to surface "the brain reinforced this in idle" in the UI.
 */
export function markConsolidated(id) {
  const cap = getCaptureById(id);
  if (!cap) return false;
  cap.consolidatedAt = Date.now();
  cap.consolidatedCount = (cap.consolidatedCount || 0) + 1;
  saveCaptures();
  return true;
}

// ---------- dev / export ----------

export function exportEpisodicBundle() {
  return {
    version: 'brainsnn-episodic-v1',
    exportedAt: new Date().toISOString(),
    captures: loadCaptures()
  };
}

export function importEpisodicBundle(bundle, { merge = true } = {}) {
  if (!bundle || !Array.isArray(bundle.captures)) return { ok: false, reason: 'bad-bundle' };
  const incoming = bundle.captures.filter(Boolean);
  if (!merge) {
    memCaptures = incoming.slice(0, MAX_CAPTURES);
  } else {
    const list = loadCaptures();
    const seen = new Set(list.map((c) => c.hash));
    for (const c of incoming) {
      if (!seen.has(c.hash)) {
        list.unshift(c);
        seen.add(c.hash);
      }
    }
    list.sort((a, b) => b.ts - a.ts);
    if (list.length > MAX_CAPTURES) list.length = MAX_CAPTURES;
    memCaptures = list;
  }
  saveCaptures();
  emit();
  return { ok: true, count: memCaptures.length };
}
