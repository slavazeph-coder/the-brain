/**
 * Layer 31 — Brain Evolve : UCB1 sampler
 *
 * Port of ASI-Evolve's `database/algorithms/ucb1.py`. UCB1 is a multi-armed
 * bandit policy that balances exploitation (pick nodes with high score) with
 * exploration (pick nodes visited fewer times). The bandit term
 *
 *     c * sqrt(ln(totalVisits) / nodeVisits)
 *
 * grows unbounded for unvisited nodes, guaranteeing every candidate gets
 * sampled at least once before we pile onto the leader.
 *
 * Fitness is normalized to [0,1] across the current population so the tradeoff
 * between exploit + explore terms stays calibrated as scores shift.
 */

import { BaseSampler } from './base.js';
import { normalizeScores } from '../node.js';

export class UCB1Sampler extends BaseSampler {
  constructor({ c = 1.414 } = {}) {
    super({ c });
    this.c = c;
  }

  sample(nodes, n = 1) {
    if (!nodes || nodes.length === 0) return [];
    if (nodes.length <= n) return [...nodes];

    const totalVisits = Math.max(
      1,
      nodes.reduce((sum, node) => sum + (node.visitCount || 0), 0)
    );
    const lnN = Math.log(totalVisits);
    const normalized = normalizeScores(nodes);

    const scored = nodes.map((node, idx) => {
      const visits = node.visitCount || 0;
      // Unvisited nodes get +Infinity — they must be explored first.
      const explorationBonus =
        visits === 0 ? Number.POSITIVE_INFINITY : this.c * Math.sqrt(lnN / visits);
      return {
        node,
        ucb: normalized[idx] + explorationBonus
      };
    });

    scored.sort((a, b) => b.ucb - a.ucb);
    return scored.slice(0, n).map((s) => s.node);
  }
}
