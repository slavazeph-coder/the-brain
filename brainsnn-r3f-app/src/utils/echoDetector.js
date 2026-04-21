/**
 * Layer 53 — Echo Detector
 *
 * Detects coordinated-campaign signatures in a batch of messages:
 * if multiple messages share long n-grams (5-word chunks or 40-char
 * strings), they're likely echoes of the same script.
 *
 * Fast path: shingled Jaccard on 5-word shingles. Returns clusters
 * whose intra-cluster similarity exceeds a threshold.
 */

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(tokens, k = 5) {
  const out = new Set();
  for (let i = 0; i + k <= tokens.length; i++) {
    out.add(tokens.slice(i, i + k).join(' '));
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * analyzeEchoes(items) → clusters + per-item duplication ratio.
 * items: [{id?, text}] (id optional — we'll fill with index).
 */
export function analyzeEchoes(items = [], { threshold = 0.35, k = 5 } = {}) {
  const prepared = items.map((it, idx) => {
    const tokens = tokenize(it.text || '');
    return {
      id: it.id || idx,
      text: it.text || '',
      tokens,
      shingles: shingles(tokens, k),
    };
  });

  // Pairwise similarity → clusters via union-find
  const parent = prepared.map((_, i) => i);
  function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
  function union(a, b) { parent[find(a)] = find(b); }

  const edges = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const s = jaccard(prepared[i].shingles, prepared[j].shingles);
      if (s >= threshold) {
        edges.push({ a: i, b: j, sim: s });
        union(i, j);
      }
    }
  }

  const clustersMap = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const root = find(i);
    if (!clustersMap.has(root)) clustersMap.set(root, []);
    clustersMap.get(root).push(prepared[i]);
  }

  const clusters = [...clustersMap.values()]
    .filter((c) => c.length > 1)
    .map((c, idx) => ({
      id: `echo-${idx + 1}`,
      size: c.length,
      members: c.map((x) => ({ id: x.id, excerpt: x.text.slice(0, 120) })),
      // Cluster exemplar: pick the longest item as the "script"
      exemplar: c.reduce((best, cur) => (cur.text.length > best.text.length ? cur : best)).text.slice(0, 240),
    }))
    .sort((a, b) => b.size - a.size);

  // Items involved in any echo cluster
  const echoedSet = new Set();
  for (const c of clusters) for (const m of c.members) echoedSet.add(m.id);

  return {
    total: items.length,
    echoed: echoedSet.size,
    clusters,
    edges,
  };
}

export function echoRisk(result) {
  if (!result || !result.total) return { label: 'No data', color: '#77dbe4' };
  const ratio = result.echoed / result.total;
  if (ratio >= 0.5) return { label: 'Coordinated campaign', color: '#dd6974' };
  if (ratio >= 0.25) return { label: 'Partial amplification', color: '#e57b40' };
  if (ratio > 0) return { label: 'Scattered overlap', color: '#fdab43' };
  return { label: 'Organic', color: '#6daa45' };
}
