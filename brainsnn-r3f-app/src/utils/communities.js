/**
 * Layer 20 — Community detection (Louvain-lite + Leiden refinement)
 *
 * Cannibalized from GitNexus's Leiden clustering for code symbols.
 * Pure JS Louvain-lite: greedy modularity optimization in one pass.
 * Sufficient for small-to-medium knowledge graphs (<1k nodes).
 *
 * `detectCommunities` runs Louvain.
 * `detectCommunitiesLeiden` runs Louvain + a Leiden-style refinement
 * that splits any community whose induced subgraph is disconnected —
 * the main guarantee Leiden adds over Louvain (Traag, Waltman, van Eck
 * 2019). The full multi-level Leiden is overkill at this scale.
 *
 * Input: { nodes: [{id, label?}], edges: [{source, target, weight?}] }
 * Output: { communities: [{id, members, label, size}], modularity, assignments }
 */

export function detectCommunities(graph) {
  const { nodes = [], edges = [] } = graph;
  if (!nodes.length) return { communities: [], modularity: 0, assignments: {} };

  // Build adjacency + degrees
  const adj = new Map();
  const degree = new Map();
  let m2 = 0; // total edge weight * 2

  for (const n of nodes) {
    adj.set(n.id, new Map());
    degree.set(n.id, 0);
  }

  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    const w = e.weight ?? 1;
    adj.get(e.source).set(e.target, (adj.get(e.source).get(e.target) || 0) + w);
    adj.get(e.target).set(e.source, (adj.get(e.target).get(e.source) || 0) + w);
    degree.set(e.source, degree.get(e.source) + w);
    degree.set(e.target, degree.get(e.target) + w);
    m2 += 2 * w;
  }

  if (m2 === 0) {
    // No edges — each node is its own community
    return {
      communities: nodes.map((n, i) => ({ id: `c${i}`, members: [n.id], label: n.label || n.id })),
      modularity: 0,
      assignments: Object.fromEntries(nodes.map((n, i) => [n.id, `c${i}`]))
    };
  }

  // Initialize — each node is its own community
  const community = new Map(nodes.map((n) => [n.id, n.id]));
  const commDegree = new Map(nodes.map((n) => [n.id, degree.get(n.id)]));

  // Greedy one-pass: move each node to the neighbor community that
  // yields the largest modularity gain.
  let moved = true;
  let passes = 0;
  while (moved && passes < 5) {
    moved = false;
    passes++;
    for (const n of nodes) {
      const nodeId = n.id;
      const curComm = community.get(nodeId);
      const ki = degree.get(nodeId);

      // Sum of weights to each neighbor community
      const commWeights = new Map();
      for (const [neighbor, w] of adj.get(nodeId)) {
        if (neighbor === nodeId) continue;
        const c = community.get(neighbor);
        commWeights.set(c, (commWeights.get(c) || 0) + w);
      }

      // Remove node from current community
      commDegree.set(curComm, commDegree.get(curComm) - ki);

      // Find best gain
      let bestComm = curComm;
      let bestGain = 0;
      for (const [c, kiIn] of commWeights) {
        const sigmaTot = commDegree.get(c) || 0;
        // ΔQ ≈ kiIn / m - ki * sigmaTot / (2 m^2)
        const gain = kiIn / (m2 / 2) - (ki * sigmaTot) / (m2 * m2 / 2);
        if (gain > bestGain) {
          bestGain = gain;
          bestComm = c;
        }
      }

      community.set(nodeId, bestComm);
      commDegree.set(bestComm, (commDegree.get(bestComm) || 0) + ki);
      if (bestComm !== curComm) moved = true;
    }
  }

  // Collect final communities
  const grouped = new Map();
  for (const [nodeId, cid] of community) {
    if (!grouped.has(cid)) grouped.set(cid, []);
    grouped.get(cid).push(nodeId);
  }

  // Compute modularity
  let Q = 0;
  for (const [cid, members] of grouped) {
    let inWeight = 0;
    let totDeg = 0;
    const memberSet = new Set(members);
    for (const mid of members) {
      totDeg += degree.get(mid);
      for (const [neighbor, w] of adj.get(mid)) {
        if (memberSet.has(neighbor)) inWeight += w;
      }
    }
    Q += inWeight / m2 - (totDeg / m2) ** 2;
  }

  // Label each community with the node that has the highest internal degree
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const communities = Array.from(grouped.entries()).map(([cid, members], idx) => {
    const scored = members.map((mid) => {
      let internal = 0;
      for (const [neighbor, w] of adj.get(mid)) {
        if (members.includes(neighbor)) internal += w;
      }
      return { id: mid, internal };
    }).sort((a, b) => b.internal - a.internal);
    const leader = nodeById.get(scored[0].id);
    return {
      id: `c${idx}`,
      members,
      label: leader?.label || leader?.id || cid,
      size: members.length
    };
  }).sort((a, b) => b.size - a.size);

  const assignments = {};
  communities.forEach((c) => {
    c.members.forEach((m) => { assignments[m] = c.id; });
  });

  return { communities, modularity: Q, assignments };
}

/**
 * Leiden-lite. Run Louvain, then for each community check connectedness
 * inside its own subgraph. Any community that decomposes into multiple
 * connected components gets split — each component becomes its own
 * community. Modularity is recomputed after the split.
 *
 * This costs one extra BFS per community plus a modularity recompute
 * (O(V + E) total). Cheap, deterministic, no new deps.
 */
export function detectCommunitiesLeiden(graph) {
  const base = detectCommunities(graph);
  if (!base.communities.length) return { ...base, refined: 0, algorithm: 'leiden-lite' };

  const { nodes = [], edges = [] } = graph;
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  }

  const refined = [];
  let splitCount = 0;
  for (const comm of base.communities) {
    const memberSet = new Set(comm.members);
    const seen = new Set();
    const components = [];

    for (const start of comm.members) {
      if (seen.has(start)) continue;
      const queue = [start];
      const component = [];
      seen.add(start);
      while (queue.length) {
        const cur = queue.shift();
        component.push(cur);
        for (const nb of adj.get(cur) || []) {
          if (memberSet.has(nb) && !seen.has(nb)) {
            seen.add(nb);
            queue.push(nb);
          }
        }
      }
      components.push(component);
    }

    if (components.length === 1) {
      refined.push(comm);
    } else {
      splitCount += components.length - 1;
      components.forEach((members, i) => {
        refined.push({
          id: `${comm.id}_${i}`,
          members,
          label: comm.label + (i ? ` ·${i}` : ''),
          size: members.length
        });
      });
    }
  }

  refined.sort((a, b) => b.size - a.size);
  refined.forEach((c, idx) => { c.id = `c${idx}`; });

  // Recompute modularity over the split set
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  let m2 = 0;
  for (const e of edges) {
    if (!degree.has(e.source) || !degree.has(e.target)) continue;
    const w = e.weight ?? 1;
    degree.set(e.source, degree.get(e.source) + w);
    degree.set(e.target, degree.get(e.target) + w);
    m2 += 2 * w;
  }

  const adjW = new Map(nodes.map((n) => [n.id, new Map()]));
  for (const e of edges) {
    if (!adjW.has(e.source) || !adjW.has(e.target)) continue;
    const w = e.weight ?? 1;
    adjW.get(e.source).set(e.target, (adjW.get(e.source).get(e.target) || 0) + w);
    adjW.get(e.target).set(e.source, (adjW.get(e.target).get(e.source) || 0) + w);
  }

  let Q = 0;
  if (m2 > 0) {
    for (const c of refined) {
      const memberSet = new Set(c.members);
      let inWeight = 0;
      let totDeg = 0;
      for (const mid of c.members) {
        totDeg += degree.get(mid) || 0;
        for (const [neighbor, w] of adjW.get(mid)) {
          if (memberSet.has(neighbor)) inWeight += w;
        }
      }
      Q += inWeight / m2 - (totDeg / m2) ** 2;
    }
  }

  const assignments = {};
  refined.forEach((c) => {
    c.members.forEach((m) => { assignments[m] = c.id; });
  });

  return {
    communities: refined,
    modularity: Q,
    assignments,
    refined: splitCount,
    algorithm: 'leiden-lite'
  };
}
