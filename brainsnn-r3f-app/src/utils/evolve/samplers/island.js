/**
 * Layer 31 — Brain Evolve : Island + MAP-Elites sampler
 *
 * Trimmed port of ASI-Evolve's `database/algorithms/island.py`. The original
 * ~600 LOC version maintains diversity caches via embeddings; we skip that
 * (embeddings are expensive in-browser and we use feature-bin diversity instead)
 * and keep the two proven primitives:
 *
 *   1. ISLANDS — partition the population into K sub-populations.
 *      Each "round" samples from one island only; we rotate through islands.
 *      Periodically the best node from each island migrates to the next.
 *
 *   2. MAP-ELITES — within an island, bucket nodes by their feature bin
 *      (fpr tier × size tier, see `node.js::featureBin`). When sampling,
 *      pick the elite (best-scored) node from each bucket so we don't
 *      collapse onto one corner of the search space.
 *
 * Benefits in a firewall-evolution setting: islands let us explore multiple
 * distinct rule-topologies in parallel; MAP-Elites stops us from always
 * picking the "biggest ruleset with the most regex" just because size
 * correlates with detection.
 */

import { BaseSampler } from './base.js';
import { featureBin } from '../node.js';

export class IslandSampler extends BaseSampler {
  constructor({ numIslands = 3, migrationEvery = 3 } = {}) {
    super({ numIslands, migrationEvery });
    this.numIslands = numIslands;
    this.migrationEvery = migrationEvery;
    this.currentIsland = 0;
    this.roundCount = 0;
    // Map<islandIdx, Map<nodeId, node>>
    this.islands = new Map();
    for (let i = 0; i < numIslands; i++) this.islands.set(i, new Map());
  }

  _assignIsland(node) {
    if (node.metaInfo?.island != null && node.metaInfo.island < this.numIslands) {
      return node.metaInfo.island;
    }
    // Round-robin assignment on insertion
    let minSize = Infinity;
    let minIdx = 0;
    for (let i = 0; i < this.numIslands; i++) {
      const size = this.islands.get(i).size;
      if (size < minSize) {
        minSize = size;
        minIdx = i;
      }
    }
    return minIdx;
  }

  onNodeAdded(node) {
    const island = this._assignIsland(node);
    node.metaInfo = { ...(node.metaInfo || {}), island, featureBin: featureBin(node) };
    this.islands.get(island).set(node.id, node);
  }

  onNodeRemoved(node) {
    const island = node.metaInfo?.island;
    if (island != null) this.islands.get(island)?.delete(node.id);
  }

  _migrate() {
    // Each island exports its best node to the next island (ring topology).
    const bestPerIsland = [];
    for (let i = 0; i < this.numIslands; i++) {
      const pool = [...this.islands.get(i).values()];
      if (!pool.length) {
        bestPerIsland.push(null);
        continue;
      }
      pool.sort((a, b) => (b.score || 0) - (a.score || 0));
      bestPerIsland.push(pool[0]);
    }
    // Nothing is physically moved — we just note a "migration marker"
    // so the next sampling round can borrow across islands.
    this._lastMigrants = bestPerIsland;
  }

  _pickMapElite(island) {
    const pool = [...this.islands.get(island).values()];
    if (!pool.length) return null;

    // Bucket by featureBin; pick elite from each bucket; then pick randomly
    // among elites so MAP-Elites diversifies instead of collapsing.
    const buckets = new Map();
    for (const node of pool) {
      const bin = node.metaInfo?.featureBin || featureBin(node);
      const current = buckets.get(bin);
      if (!current || (node.score || 0) > (current.score || 0)) {
        buckets.set(bin, node);
      }
    }
    const elites = [...buckets.values()];
    return elites[Math.floor(Math.random() * elites.length)];
  }

  sample(nodes, n = 1) {
    if (!nodes || nodes.length === 0) return [];

    // Rebuild island cache on first call (idempotent if up to date)
    if (![...this.islands.values()].reduce((a, m) => a + m.size, 0)) {
      for (const node of nodes) this.onNodeAdded(node);
    }

    this.roundCount += 1;
    if (this.roundCount % this.migrationEvery === 0) this._migrate();

    const out = [];
    // Each selected parent rotates through islands so generation N samples
    // cross-island diversity automatically.
    for (let i = 0; i < n; i++) {
      const island = (this.currentIsland + i) % this.numIslands;
      const elite = this._pickMapElite(island);
      if (elite) out.push(elite);
      else if (this._lastMigrants?.length) {
        const migrant = this._lastMigrants[Math.floor(Math.random() * this._lastMigrants.length)];
        if (migrant) out.push(migrant);
      }
    }
    this.currentIsland = (this.currentIsland + 1) % this.numIslands;

    // Fill remaining with random from the global pool if any island was empty
    while (out.length < n && nodes.length) {
      const pick = nodes[Math.floor(Math.random() * nodes.length)];
      if (!out.includes(pick)) out.push(pick);
      else break;
    }
    return out;
  }
}
