/**
 * Layer 31 — Brain Evolve : Greedy sampler
 *
 * Pure exploit: always pick the top-N by score. Useful as a baseline against
 * UCB1 / Island to see whether exploration is actually helping.
 */

import { BaseSampler } from './base.js';

export class GreedySampler extends BaseSampler {
  sample(nodes, n = 1) {
    if (!nodes || !nodes.length) return [];
    return [...nodes]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, n);
  }
}
