/**
 * Layer 101 — Graph Insights
 *
 * Cannibalized from safishamsi/graphify's analyze.py. Three primitives
 * that turn a code knowledge graph from a viewer into an analyst:
 *
 *   1. God-nodes      — high-degree hubs that bridge multiple communities,
 *                       with synthetic-artifact filtering (degree-1 stubs,
 *                       container files, etc.) so the list is honest.
 *   2. Surprising     — connections that cross communities AND file types,
 *                       weighted by peripheral→hub asymmetry. Optional
 *                       semantic-similarity bonus when embeddings exist.
 *   3. Suggested      — graph-derived questions a reader should ask:
 *                       unresolved AMBIGUOUS edges, high-betweenness
 *                       bridges, isolated nodes, low-cohesion communities.
 *
 * Pure structural analysis — no LLM calls. Operates on the output of
 * Layer 20's parseFiles + detectCommunities/detectCommunitiesLeiden.
 */

// ---------- helpers ----------

function buildAdjacency(edges, nodes) {
  const adj = new Map(nodes.map((n) => [n.id, new Map()]));
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    const w = e.weight ?? 1;
    adj.get(e.source).set(e.target, (adj.get(e.source).get(e.target) || 0) + w);
    adj.get(e.target).set(e.source, (adj.get(e.target).get(e.source) || 0) + w);
    degree.set(e.source, (degree.get(e.source) || 0) + w);
    degree.set(e.target, (degree.get(e.target) || 0) + w);
  }
  return { adj, degree };
}

function fileTypeOf(node) {
  if (!node) return 'unknown';
  if (node.kind === 'external') return 'external';
  if (node.kind === 'file') return node.lang || 'unknown';
  // symbol — derive from path
  const path = node.path || '';
  const m = path.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : (node.lang || 'unknown');
}

// ---------- god-node detection ----------

/**
 * Return nodes that act as cross-community hubs.
 * A node is a god-node iff:
 *   - degree >= minDegree
 *   - touches >= minCommunities distinct communities
 *   - is NOT a synthetic artifact:
 *       * not a degree-≤1 module function
 *       * not a "file" node whose only edges are its own contained symbols
 *       * not an external module (those are AMBIGUOUS by construction)
 */
export function findGodNodes(graph, communities, opts = {}) {
  const cfg = {
    minDegree: 4,
    minCommunities: 2,
    excludeFileContainers: true,
    excludeExternals: true,
    topK: 10,
    ...opts
  };

  const { nodes = [], edges = [] } = graph;
  const { assignments = {} } = communities || {};
  const { adj, degree } = buildAdjacency(edges, nodes);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const ranked = [];
  for (const node of nodes) {
    const deg = degree.get(node.id) || 0;
    if (deg < cfg.minDegree) continue;

    if (cfg.excludeExternals && node.kind === 'external') continue;

    // Synthetic-artifact filter: a "file" whose neighborhood is exactly
    // its contained symbols and nothing else is a structural container,
    // not a real hub.
    if (cfg.excludeFileContainers && node.kind === 'file') {
      const neighbors = Array.from(adj.get(node.id)?.keys() || []);
      const onlyOwnSymbols = neighbors.every((nb) => {
        const m = nodeById.get(nb);
        return m && m.path === node.path && m.kind !== 'file';
      });
      if (onlyOwnSymbols) continue;
    }

    // Count distinct communities touched
    const commsTouched = new Set();
    for (const nb of adj.get(node.id)?.keys() || []) {
      const c = assignments[nb];
      if (c) commsTouched.add(c);
    }
    if (commsTouched.size < cfg.minCommunities) continue;

    ranked.push({
      id: node.id,
      label: node.label,
      kind: node.kind,
      path: node.path,
      degree: deg,
      communities: commsTouched.size,
      score: deg * Math.log2(1 + commsTouched.size)
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, cfg.topK);
}

// ---------- surprising connections ----------

/**
 * Score every edge for surprise. The composite score follows graphify's
 * recipe (analyze.py):
 *   base                          = edge confidence (1.0 EXTRACTED, 0.8 INFERRED, 0.5 AMBIGUOUS)
 *   + cross-community bonus       (+0.5 if endpoints are in different communities)
 *   + cross-filetype bonus        (+0.3 if endpoints have different file types)
 *   + peripheral→hub bonus        (+0.4 if degree asymmetry > 4×)
 *   × semantic similarity ×1.5    (when embeddings provided and cosine > 0.4)
 *
 * Returns top-K edges by surprise score, with a human-readable reason
 * string per hit so the panel can show "why" without reverse-engineering.
 */
export function findSurprisingConnections(graph, communities, opts = {}) {
  const cfg = {
    topK: 10,
    minConfidence: 0.5,
    semanticBonus: 1.5,
    semanticThreshold: 0.4,
    embeddings: null,    // optional Map<nodeId, Float32Array>
    cosineFn: null,      // optional (a, b) => number
    ...opts
  };

  const { nodes = [], edges = [] } = graph;
  const { assignments = {} } = communities || {};
  const { degree } = buildAdjacency(edges, nodes);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const scored = [];
  for (const e of edges) {
    const a = nodeById.get(e.source);
    const b = nodeById.get(e.target);
    if (!a || !b) continue;

    const conf = typeof e.confidence === 'number' ? e.confidence : 1;
    if (conf < cfg.minConfidence) continue;

    const reasons = [];
    let score = conf;

    const ca = assignments[a.id];
    const cb = assignments[b.id];
    if (ca && cb && ca !== cb) {
      score += 0.5;
      reasons.push('cross-community');
    }

    const fa = fileTypeOf(a);
    const fb = fileTypeOf(b);
    if (fa !== fb && fa !== 'unknown' && fb !== 'unknown') {
      score += 0.3;
      reasons.push(`cross-filetype (${fa}↔${fb})`);
    }

    const da = degree.get(a.id) || 0;
    const db = degree.get(b.id) || 0;
    const ratio = da && db ? Math.max(da, db) / Math.max(1, Math.min(da, db)) : 0;
    if (ratio >= 4) {
      score += 0.4;
      reasons.push(`peripheral→hub (×${ratio.toFixed(1)})`);
    }

    if (cfg.embeddings && cfg.cosineFn) {
      const va = cfg.embeddings.get(a.id);
      const vb = cfg.embeddings.get(b.id);
      if (va && vb) {
        const sim = cfg.cosineFn(va, vb);
        if (sim > cfg.semanticThreshold) {
          score *= cfg.semanticBonus * sim;
          reasons.push(`semantic ${sim.toFixed(2)}`);
        }
      }
    }

    if (reasons.length === 0) continue;

    scored.push({
      source: a.id,
      target: b.id,
      sourceLabel: a.label,
      targetLabel: b.label,
      kind: e.kind,
      provenance: e.provenance,
      score,
      reasons
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cfg.topK);
}

// ---------- betweenness centrality (Brandes) ----------

/**
 * Brandes' algorithm, unweighted. Cost O(VE). Fine for <1k nodes.
 * Returns Map<nodeId, centrality>.
 */
function betweennessCentrality(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  }

  const cb = new Map(nodes.map((n) => [n.id, 0]));

  for (const s of nodes.map((n) => n.id)) {
    const stack = [];
    const pred = new Map(nodes.map((n) => [n.id, []]));
    const sigma = new Map(nodes.map((n) => [n.id, 0]));
    const dist = new Map(nodes.map((n) => [n.id, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue = [s];

    while (queue.length) {
      const v = queue.shift();
      stack.push(v);
      for (const w of adj.get(v) || []) {
        if (dist.get(w) < 0) {
          queue.push(w);
          dist.set(w, dist.get(v) + 1);
        }
        if (dist.get(w) === dist.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          pred.get(w).push(v);
        }
      }
    }

    const delta = new Map(nodes.map((n) => [n.id, 0]));
    while (stack.length) {
      const w = stack.pop();
      for (const v of pred.get(w) || []) {
        const ratio = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
        delta.set(v, delta.get(v) + ratio);
      }
      if (w !== s) cb.set(w, cb.get(w) + delta.get(w));
    }
  }

  // Normalize by 1/((n-1)(n-2)) for undirected
  const n = nodes.length;
  const norm = n > 2 ? 1 / ((n - 1) * (n - 2)) : 1;
  for (const [k, v] of cb) cb.set(k, v * norm);
  return cb;
}

// ---------- suggested questions ----------

/**
 * 7 question archetypes derived purely from graph structure.
 * Each returned question is { archetype, prompt, target?, score? } so
 * the UI can render them as actionable chips.
 */
export function generateSuggestedQuestions(graph, communities, opts = {}) {
  const cfg = {
    minIsolated: 1,
    cohesionThreshold: 0.15,
    bridgeTopK: 5,
    maxQuestions: 12,
    ...opts
  };

  const { nodes = [], edges = [] } = graph;
  const { assignments = {}, communities: commList = [] } = communities || {};
  const { adj, degree } = buildAdjacency(edges, nodes);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const questions = [];

  // (1) Unresolved AMBIGUOUS edges
  const ambiguous = edges.filter((e) => e.provenance === 'AMBIGUOUS');
  if (ambiguous.length) {
    const samples = ambiguous.slice(0, 3).map((e) => {
      const a = nodeById.get(e.source);
      const b = nodeById.get(e.target);
      return `${a?.label || e.source} → ${b?.label || e.target}`;
    });
    questions.push({
      archetype: 'ambiguous-edge',
      prompt: `${ambiguous.length} import${ambiguous.length === 1 ? '' : 's'} couldn't be resolved (${samples.join(', ')}). Are these external libraries you actually use, or stale references?`,
      score: ambiguous.length
    });
  }

  // (2) High-betweenness bridges (only if graph is small enough)
  if (nodes.length <= 600) {
    const bc = betweennessCentrality(nodes, edges);
    const bridges = Array.from(bc.entries())
      .filter(([id]) => {
        const n = nodeById.get(id);
        return n && n.kind !== 'external';
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, cfg.bridgeTopK)
      .filter(([, v]) => v > 0);
    bridges.forEach(([id, score]) => {
      const n = nodeById.get(id);
      questions.push({
        archetype: 'bridge',
        prompt: `If you removed ${n.label}, the graph fractures. What guarantees does it actually carry?`,
        target: id,
        score
      });
    });
  }

  // (3) Isolated nodes (degree 0 or 1, non-external)
  const isolated = nodes.filter((n) => {
    const d = degree.get(n.id) || 0;
    return n.kind !== 'external' && d <= cfg.minIsolated;
  });
  if (isolated.length) {
    const samples = isolated.slice(0, 3).map((n) => n.label).join(', ');
    questions.push({
      archetype: 'isolated',
      prompt: `${isolated.length} node${isolated.length === 1 ? '' : 's'} (${samples}) sit on the periphery with ≤1 connection. Dead code, or future hooks waiting to be wired up?`,
      score: isolated.length
    });
  }

  // (4) Low-cohesion communities
  for (const c of commList) {
    if (c.members.length < 3) continue;
    const memberSet = new Set(c.members);
    let internal = 0;
    let external = 0;
    for (const mid of c.members) {
      for (const [nb, w] of adj.get(mid) || []) {
        if (memberSet.has(nb)) internal += w;
        else external += w;
      }
    }
    const total = internal + external;
    if (total === 0) continue;
    const cohesion = internal / total;
    if (cohesion < cfg.cohesionThreshold) {
      questions.push({
        archetype: 'low-cohesion',
        prompt: `Community "${c.label}" has more outbound edges than internal ones (cohesion ${(cohesion * 100).toFixed(0)}%). Should it be split, or is it really a router/coordinator?`,
        target: c.id,
        score: 1 - cohesion
      });
    }
  }

  // (5) Cross-community heavyweight pairs — communities that are
  //     joined by an unusually large number of edges
  const interCommEdges = new Map();
  for (const e of edges) {
    const ca = assignments[e.source];
    const cb = assignments[e.target];
    if (!ca || !cb || ca === cb) continue;
    const key = [ca, cb].sort().join('|');
    interCommEdges.set(key, (interCommEdges.get(key) || 0) + 1);
  }
  const heavyPairs = Array.from(interCommEdges.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  for (const [key, count] of heavyPairs) {
    if (count < 3) continue;
    const [ca, cb] = key.split('|');
    const lA = commList.find((c) => c.id === ca)?.label || ca;
    const lB = commList.find((c) => c.id === cb)?.label || cb;
    questions.push({
      archetype: 'tight-coupling',
      prompt: `"${lA}" and "${lB}" are joined by ${count} edges. Is this one concept the clusterer split, or genuinely two layers that talk a lot?`,
      score: count
    });
  }

  // (6) External-heavy files — files leaning on lots of unresolved imports
  const externalLoad = new Map();
  for (const e of edges) {
    if (e.provenance !== 'AMBIGUOUS') continue;
    const src = nodeById.get(e.source);
    if (!src || src.kind !== 'file') continue;
    externalLoad.set(src.id, (externalLoad.get(src.id) || 0) + 1);
  }
  const heaviest = Array.from(externalLoad.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1);
  for (const [fid, count] of heaviest) {
    if (count < 3) continue;
    const n = nodeById.get(fid);
    questions.push({
      archetype: 'external-load',
      prompt: `${n.label} imports ${count} unresolved modules. Is its complexity coming from your code, or from third-party glue?`,
      target: fid,
      score: count
    });
  }

  // (7) Singleton communities — likely orphans the clusterer couldn't
  //     attach. Worth a glance.
  const singletons = commList.filter((c) => c.members.length === 1);
  if (singletons.length >= 3) {
    questions.push({
      archetype: 'singletons',
      prompt: `${singletons.length} singleton communities — nodes the clusterer couldn't fit anywhere. Add edges to attach them, or accept they're standalone?`,
      score: singletons.length
    });
  }

  questions.sort((a, b) => (b.score || 0) - (a.score || 0));
  return questions.slice(0, cfg.maxQuestions);
}

// ---------- one-shot analyzer ----------

/**
 * Run all three analytics in one pass. Returns
 *   { godNodes, surprising, questions, summary }
 */
export function analyzeGraph(graph, communities, opts = {}) {
  const godNodes = findGodNodes(graph, communities, opts.godNodes);
  const surprising = findSurprisingConnections(graph, communities, opts.surprising);
  const questions = generateSuggestedQuestions(graph, communities, opts.questions);

  const summary = {
    nodes: graph.nodes?.length || 0,
    edges: graph.edges?.length || 0,
    communities: communities?.communities?.length || 0,
    modularity: communities?.modularity || 0,
    godNodeCount: godNodes.length,
    surprisingCount: surprising.length,
    questionCount: questions.length
  };

  return { godNodes, surprising, questions, summary };
}
