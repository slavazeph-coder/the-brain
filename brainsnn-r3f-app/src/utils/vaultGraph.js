/**
 * Build the link graph for a vault.
 *
 * Inputs: an array of vault notes (`{ id, title, body, tags }`).
 * Outputs:
 *   - nodes: every note (id, title, tags, count, missing flag)
 *   - edges: directed `from -> to` for every wikilink
 *   - backlinksByNoteId: { id: [{from, alias}] }
 *   - missing: target wikilinks that don't resolve to any note (broken)
 *
 * Wikilink resolution: case-insensitive title match (slug-like). A target
 * "Foo Bar" matches a note with title "foo bar", "Foo bar", or
 * "foo-bar" (slug).
 */

import { extractWikilinks, extractTags } from './vaultMarkdown.js';
import { slugify } from './vault.js';

function normalizeTitle(t) {
  return String(t || '').trim().toLowerCase();
}

/**
 * Build a fast title → id resolver. Each note is keyed by its lowercased
 * title and its slug, so [[Foo Bar]] and [[foo-bar]] both resolve.
 */
function buildResolver(notes) {
  const map = new Map();
  for (const n of notes) {
    map.set(normalizeTitle(n.title), n.id);
    map.set(n.id, n.id);
  }
  return (target) => {
    const direct = map.get(normalizeTitle(target));
    if (direct) return direct;
    const slug = slugify(target);
    return map.get(slug) || null;
  };
}

/**
 * Build the full link graph in one pass.
 */
export function buildLinkGraph(notes) {
  const resolve = buildResolver(notes);
  const edges = [];
  const backlinksByNoteId = {};
  const missing = new Map();

  for (const note of notes) {
    const targets = extractWikilinks(note.body || '');
    for (const target of targets) {
      const targetId = resolve(target);
      if (targetId) {
        edges.push({ from: note.id, to: targetId, target });
        if (!backlinksByNoteId[targetId]) backlinksByNoteId[targetId] = [];
        backlinksByNoteId[targetId].push({ from: note.id, target });
      } else {
        missing.set(target, (missing.get(target) || 0) + 1);
      }
    }
  }

  // out-degree / in-degree for layout sizing.
  const outBy = {};
  const inBy = {};
  for (const e of edges) {
    outBy[e.from] = (outBy[e.from] || 0) + 1;
    inBy[e.to] = (inBy[e.to] || 0) + 1;
  }

  const nodes = notes.map((n) => ({
    id: n.id,
    title: n.title,
    tags: n.tags || [],
    out: outBy[n.id] || 0,
    in: inBy[n.id] || 0,
  }));

  return {
    nodes,
    edges,
    backlinksByNoteId,
    missing: Array.from(missing.entries()).map(([target, count]) => ({ target, count })),
    resolve,
  };
}

/**
 * Backlinks for a single note. Each entry is { from, target } where
 * `from` is the source note id and `target` is the *exact* wikilink text
 * the source used (so the UI can show the alias if any).
 */
export function backlinksFor(notes, noteId) {
  const g = buildLinkGraph(notes);
  return g.backlinksByNoteId[noteId] || [];
}

/**
 * Forward links for a single note: every wikilink target inside its body,
 * resolved to a note id where one exists.
 */
export function forwardLinksFor(notes, noteId) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return [];
  const g = buildLinkGraph(notes);
  return g.edges.filter((e) => e.from === noteId).map((e) => ({ to: e.to, target: e.target }));
}

/**
 * Tag → [note ids] index.
 */
export function tagIndex(notes) {
  const out = {};
  for (const n of notes) {
    const fromBody = extractTags(n.body || '');
    const merged = new Set([...(n.tags || []), ...fromBody]);
    for (const t of merged) {
      if (!out[t]) out[t] = [];
      out[t].push(n.id);
    }
  }
  return out;
}

/**
 * Compute simple force-directed layout coordinates for the graph.
 * Lightweight: small constant number of iterations, suitable for a
 * couple-hundred-node browser render. Not for production-grade graph viz.
 *
 * Returns the same `g` shape as buildLinkGraph plus a `layout` field of
 * { id: { x, y } } in the unit square [0, 1]^2.
 */
export function layoutGraph(graph, { iterations = 200, width = 1, height = 1 } = {}) {
  const nodes = graph.nodes.map((n) => ({
    ...n,
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0,
    vy: 0,
  }));
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = graph.edges
    .map((e) => ({ from: idToIdx.get(e.from), to: idToIdx.get(e.to) }))
    .filter((e) => e.from != null && e.to != null);

  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1)) * 0.6;
  const repulsion = k * k;
  const attraction = 1 / k;
  const damping = 0.85;
  const center = { x: width / 2, y: height / 2 };

  for (let iter = 0; iter < iterations; iter += 1) {
    // repulsion
    for (let i = 0; i < nodes.length; i += 1) {
      let fx = 0;
      let fy = 0;
      for (let j = 0; j < nodes.length; j += 1) {
        if (i === j) continue;
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist2 = dx * dx + dy * dy + 0.0001;
        const f = repulsion / dist2;
        fx += dx * f;
        fy += dy * f;
      }
      // gentle pull to center so disconnected nodes don't fly off
      fx += (center.x - nodes[i].x) * 0.001;
      fy += (center.y - nodes[i].y) * 0.001;
      nodes[i].vx = (nodes[i].vx + fx) * damping;
      nodes[i].vy = (nodes[i].vy + fy) * damping;
    }
    // attraction along edges
    for (const e of edges) {
      const a = nodes[e.from];
      const b = nodes[e.to];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.0001;
      const f = dist * attraction;
      const ux = dx / dist;
      const uy = dy / dist;
      a.vx += ux * f;
      a.vy += uy * f;
      b.vx -= ux * f;
      b.vy -= uy * f;
    }
    // integrate, clamped
    const maxStep = 0.05;
    for (const n of nodes) {
      const step = Math.min(maxStep, Math.sqrt(n.vx * n.vx + n.vy * n.vy));
      const len = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 1;
      n.x += (n.vx / len) * step;
      n.y += (n.vy / len) * step;
      n.x = Math.max(0.02, Math.min(width - 0.02, n.x));
      n.y = Math.max(0.02, Math.min(height - 0.02, n.y));
    }
  }

  const layout = {};
  for (const n of nodes) layout[n.id] = { x: n.x, y: n.y };

  return { ...graph, layout };
}
