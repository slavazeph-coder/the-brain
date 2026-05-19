/**
 * searchWorker — main-thread API for the CodeBrain worker.
 *
 * Spawns a dedicated worker on first use (lazy), keeps it alive for
 * subsequent calls. The CodeBrain panel typically does
 * analyze → many searches → re-analyze; reusing the worker avoids
 * the worker-spawn cost on each query.
 *
 * Falls back to inline (sync) when Workers are unavailable.
 */

import { createPool } from './workerPool';
import { parseFiles as parseFilesInline } from './codeParser';
import {
  buildBM25Index as buildBM25IndexInline,
  hybridSearch as hybridSearchInline
} from './bm25';
import { detectCommunities as detectCommunitiesInline } from './communities';

let _pool = null;

function ensurePool() {
  if (_pool) return _pool;
  if (typeof window === 'undefined') return null;
  try {
    _pool = createPool(
      () => new Worker(new URL('../workers/search.worker.js', import.meta.url), { type: 'module' }),
      {
        size: 1, // serial code analysis fits one slot
        fallback: (type, payload) => {
          if (type === 'parseFiles') return parseFilesInline(payload?.files || []);
          if (type === 'analyzeCode') {
            const graph = parseFilesInline(payload?.files || []);
            const communities = detectCommunitiesInline({ nodes: graph.nodes, edges: graph.edges });
            const index = buildBM25IndexInline(graph.docs);
            return { ...graph, communities, index };
          }
          if (type === 'hybridSearch') {
            return hybridSearchInline(payload?.query || '', payload?.index, { topK: payload?.topK || 10 });
          }
          return null;
        }
      }
    );
    return _pool;
  } catch { return null; }
}

export async function analyzeCodeAsync(files) {
  const pool = ensurePool();
  if (!pool || pool.degraded) {
    const graph = parseFilesInline(files || []);
    const communities = detectCommunitiesInline({ nodes: graph.nodes, edges: graph.edges });
    const index = buildBM25IndexInline(graph.docs);
    return { ...graph, communities, index };
  }
  try {
    return await pool.call('analyzeCode', { files });
  } catch {
    const graph = parseFilesInline(files || []);
    const communities = detectCommunitiesInline({ nodes: graph.nodes, edges: graph.edges });
    const index = buildBM25IndexInline(graph.docs);
    return { ...graph, communities, index };
  }
}

export async function hybridSearchAsync(query, index, { topK = 10 } = {}) {
  const pool = ensurePool();
  if (!pool || pool.degraded) {
    return hybridSearchInline(query || '', index, { topK });
  }
  try {
    return await pool.call('hybridSearch', { query, index, topK });
  } catch {
    return hybridSearchInline(query || '', index, { topK });
  }
}
