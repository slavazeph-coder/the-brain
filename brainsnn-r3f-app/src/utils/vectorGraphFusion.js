/**
 * Layer 34 — Vector-Graph Fusion
 *
 * Cannibalized from HKUDS/RAG-Anything's "Vector-Graph Fusion" retrieval
 * strategy. Takes Layer 33's cosine/BM25 candidate hits and reranks them
 * by traversing the belongs_to hierarchy + optional Louvain community
 * edges from Layer 20.
 *
 * Flow:
 *   1. Initial retrieval (Layer 33 queryMultimodal → candidate set)
 *   2. Graph expansion: for each hit, collect siblings (same doc/section),
 *      parent docs, and community neighbors
 *   3. RRF-style fusion of vector score + graph coherence score
 *   4. Deduplication + final top-k
 *
 * The result is retrieval that's aware of document structure — if one row
 * of a table matched, nearby rows and the section heading are pulled in,
 * even if they didn't directly score high on cosine.
 */

import { queryMultimodal, _debugSnapshot } from './multimodalRag';
import { detectCommunities } from './communities';

const DEFAULT_FUSION_OPTS = {
  topK: 6,
  graphWeight: 0.35,     // how much graph coherence influences the final score
  siblingBoost: 0.20,    // score boost for items sharing a doc/section
  communityBoost: 0.15,  // score boost for items in the same Louvain community
  parentBoost: 0.10,     // score boost for the section/doc heading itself
  rrf_k: 60              // RRF smoothing constant
};

// ---------- graph build ----------

/**
 * Build a lightweight graph from the current multimodal index's
 * belongs_to hierarchy. Nodes are item IDs, edges are:
 *   - sibling:    two items share the same doc + section
 *   - parent:     item → doc heading
 *   - community:  Louvain community assignment over co-occurrence edges
 */
export function buildFusionGraph() {
  const snap = _debugSnapshot();
  if (!snap.items.length) return { nodes: [], edges: [], communities: {} };

  const nodes = snap.items.map((n) => ({
    id: n.id,
    label: n.summary || n.id,
    docTitle: n.docTitle,
    section: n.section,
    type: n.type
  }));

  const edges = [];

  // Sibling edges — items that share the same (docTitle, section)
  const buckets = new Map();
  for (const n of nodes) {
    const key = `${n.docTitle}||${n.section || ''}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n.id);
  }
  for (const members of buckets.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        edges.push({ source: members[i], target: members[j], weight: 1, kind: 'sibling' });
      }
    }
  }

  // Sequence edges — adjacent items in index order (preserves document flow)
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i].docTitle === nodes[i + 1].docTitle) {
      edges.push({ source: nodes[i].id, target: nodes[i + 1].id, weight: 0.5, kind: 'sequence' });
    }
  }

  // Run Louvain over the graph
  const louvain = detectCommunities({ nodes, edges });

  return {
    nodes,
    edges,
    communities: louvain.assignments,
    modularity: louvain.modularity,
    communityList: louvain.communities
  };
}

// ---------- fusion reranker ----------

/**
 * Fused retrieval: vector-first, graph-reranked.
 *
 * @param {string} question        — user query
 * @param {object} [opts]          — override DEFAULT_FUSION_OPTS
 * @param {object} [vectorOpts]    — passed through to queryMultimodal (filterTypes, modalityBias)
 * @returns {{ results, mode, graph, fusionStats }}
 */
export async function fusedQuery(question, opts = {}, vectorOpts = {}) {
  const cfg = { ...DEFAULT_FUSION_OPTS, ...opts };

  // Step 1 — initial vector retrieval (pull more candidates than final topK)
  const vectorResult = await queryMultimodal(question, {
    topK: cfg.topK * 3,
    ...vectorOpts
  });

  if (!vectorResult.results.length) {
    return { results: [], mode: 'empty', graph: null, fusionStats: {} };
  }

  // Step 2 — build the fusion graph
  const graph = buildFusionGraph();
  const communityOf = graph.communities || {};

  // Step 3 — expand candidate set with graph neighbors
  const candidateIds = new Set(vectorResult.results.map((r) => r.id));
  const snap = _debugSnapshot();
  const itemById = new Map(snap.items.map((n) => [n.id, n]));
  const expanded = new Map();

  // Seed with vector hits
  for (const r of vectorResult.results) {
    expanded.set(r.id, { vectorScore: r.score, graphScore: 0, item: r });
  }

  // Collect graph neighbor IDs for each vector hit
  const edgeIndex = new Map();
  for (const e of graph.edges) {
    if (!edgeIndex.has(e.source)) edgeIndex.set(e.source, []);
    if (!edgeIndex.has(e.target)) edgeIndex.set(e.target, []);
    edgeIndex.get(e.source).push({ neighbor: e.target, kind: e.kind, weight: e.weight });
    edgeIndex.get(e.target).push({ neighbor: e.source, kind: e.kind, weight: e.weight });
  }

  let siblingPulls = 0;
  let communityPulls = 0;
  let sequencePulls = 0;

  for (const hitId of [...candidateIds]) {
    const neighbors = edgeIndex.get(hitId) || [];
    for (const { neighbor, kind, weight } of neighbors) {
      const boost = kind === 'sibling' ? cfg.siblingBoost
        : kind === 'sequence' ? cfg.siblingBoost * 0.5
        : 0;
      if (!expanded.has(neighbor)) {
        const item = itemById.get(neighbor);
        if (!item) continue;
        expanded.set(neighbor, {
          vectorScore: 0,
          graphScore: boost * (weight || 1),
          item: projectFromSnap(item)
        });
        if (kind === 'sibling') siblingPulls++;
        else if (kind === 'sequence') sequencePulls++;
      } else {
        expanded.get(neighbor).graphScore += boost * (weight || 1);
      }
    }

    // Community boost: items in the same Louvain community get a nudge
    const hitComm = communityOf[hitId];
    if (hitComm) {
      for (const [nodeId, comm] of Object.entries(communityOf)) {
        if (comm === hitComm && nodeId !== hitId) {
          if (!expanded.has(nodeId)) {
            const item = itemById.get(nodeId);
            if (!item) continue;
            expanded.set(nodeId, {
              vectorScore: 0,
              graphScore: cfg.communityBoost,
              item: projectFromSnap(item)
            });
            communityPulls++;
          } else {
            expanded.get(nodeId).graphScore += cfg.communityBoost;
          }
        }
      }
    }
  }

  // Step 4 — RRF fusion of vectorScore and graphScore
  // Normalize graph scores to [0, 1]
  let maxGraph = 0;
  for (const entry of expanded.values()) {
    if (entry.graphScore > maxGraph) maxGraph = entry.graphScore;
  }
  if (maxGraph === 0) maxGraph = 1;

  const fused = [];
  for (const [id, entry] of expanded) {
    const normGraph = entry.graphScore / maxGraph;
    const score = (1 - cfg.graphWeight) * entry.vectorScore + cfg.graphWeight * normGraph;
    fused.push({
      ...entry.item,
      id,
      score,
      vectorScore: entry.vectorScore,
      graphScore: entry.graphScore,
      graphNorm: normGraph,
      community: communityOf[id] || null,
      source: entry.vectorScore > 0 ? (entry.graphScore > 0 ? 'vector+graph' : 'vector') : 'graph'
    });
  }

  fused.sort((a, b) => b.score - a.score);
  const results = fused.slice(0, cfg.topK);

  return {
    results,
    mode: `fused (${vectorResult.mode}+graph)`,
    byModality: modalityHistogram(results),
    graph: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      modularity: graph.modularity,
      communities: graph.communityList?.length || 0
    },
    fusionStats: {
      vectorCandidates: vectorResult.results.length,
      expanded: expanded.size,
      siblingPulls,
      communityPulls,
      sequencePulls,
      graphWeight: cfg.graphWeight
    }
  };
}

// ---------- helpers ----------

function projectFromSnap(item) {
  return {
    id: item.id,
    type: item.type,
    docTitle: item.docTitle,
    section: item.section,
    summary: item.summary,
    renderedText: item.renderedText,
    payload: item.payload,
    gemmaUsed: item.gemmaUsed || false
  };
}

function modalityHistogram(results) {
  const out = {};
  for (const r of results) out[r.type] = (out[r.type] || 0) + 1;
  return out;
}

// ---------- brain mapping (augmented) ----------

/**
 * Like Layer 33's mapMultimodalToRegions, but adds a graph-coherence
 * bump to BG (basal ganglia — pattern recognition / habit circuits).
 * When the fusion graph pulls in siblings and community neighbors it
 * implies a structured recall pattern — BG lights up.
 */
export function mapFusedToRegions(state, fusedResult) {
  if (!fusedResult?.results?.length) return state;
  const regions = { ...state.regions };
  const clamp = (v) => Math.max(0.04, Math.min(0.95, v));

  const topScore = fusedResult.results[0]?.score ?? 0;
  const mean = fusedResult.results.reduce((a, r) => a + (r.score ?? 0), 0) / fusedResult.results.length;
  const breadth = Math.min(1, fusedResult.results.length / 6);
  const hist = fusedResult.byModality || {};

  // Base activations (same as Layer 33)
  regions.HPC = clamp(regions.HPC + topScore * 0.35);
  regions.CTX = clamp(regions.CTX + breadth * 0.20);
  regions.PFC = clamp(regions.PFC + (topScore - mean) * 0.30);
  regions.THL = clamp(regions.THL + breadth * 0.10);

  // Modality-specific bumps
  const n = Math.max(1, fusedResult.results.length);
  regions.CTX = clamp(regions.CTX + ((hist.image || 0) / n) * 0.25);
  regions.PFC = clamp(regions.PFC + ((hist.table || 0) / n) * 0.25 + ((hist.equation || 0) / n) * 0.20);

  // Graph-coherence bump: BG lights up when structured recall fires
  const stats = fusedResult.fusionStats || {};
  const graphPulls = (stats.siblingPulls || 0) + (stats.communityPulls || 0) + (stats.sequencePulls || 0);
  const graphIntensity = Math.min(1, graphPulls / 10);
  regions.BG = clamp(regions.BG + graphIntensity * 0.30);
  regions.HPC = clamp(regions.HPC + graphIntensity * 0.10);

  return {
    ...state,
    regions,
    scenario: `Fused RAG · ${fusedResult.mode}`,
    burst: Math.max(state.burst, 10)
  };
}
