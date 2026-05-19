/**
 * search.worker.js — CodeBrain workloads off the main thread.
 *
 * The Layer 20 panel parses source files, builds a code graph,
 * detects Louvain communities, and indexes for BM25 + trigram
 * hybrid search. On large pastes this freezes the UI for a second
 * or two. All three steps are pure compute over JSON-safe data —
 * perfect worker fodder.
 *
 * Handlers:
 *   parseFiles   ({ files })                → graph
 *   analyzeCode  ({ files })                → { graph, communities, index }
 *   hybridSearch ({ query, index, topK })   → results
 *
 * Communities + BM25 are folded into `analyzeCode` because the
 * CodeBrain panel always runs them together; saves a postMessage
 * round-trip.
 */

import { handleRequests } from '../utils/workerPool.js';
import { parseFiles } from '../utils/codeParser.js';
import { buildBM25Index, hybridSearch } from '../utils/bm25.js';
import { detectCommunities } from '../utils/communities.js';

handleRequests({
  parseFiles: async ({ files }) => parseFiles(files || []),

  analyzeCode: async ({ files }) => {
    const graph = parseFiles(files || []);
    const communities = detectCommunities({ nodes: graph.nodes, edges: graph.edges });
    const index = buildBM25Index(graph.docs);
    return { ...graph, communities, index };
  },

  hybridSearch: async ({ query, index, topK }) =>
    hybridSearch(query || '', index, { topK: topK || 10 })
});
