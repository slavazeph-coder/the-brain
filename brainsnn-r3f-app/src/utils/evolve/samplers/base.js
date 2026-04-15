/**
 * Layer 31 — Brain Evolve : BaseSampler
 *
 * Abstract interface. Concrete samplers implement `sample(nodes, n)` to pick
 * `n` parents from the pool. Lifecycle hooks (`onNodeAdded`, `onNodeRemoved`)
 * let stateful samplers (island, MAP-Elites) maintain auxiliary structures.
 */

export class BaseSampler {
  constructor(opts = {}) {
    this.opts = opts;
  }

  /**
   * Return `n` parent nodes sampled from the pool. Default: random uniform.
   * Subclasses should override.
   */
  sample(nodes, _n = 1) {
    if (!nodes || !nodes.length) return [];
    const out = [];
    const max = Math.min(_n, nodes.length);
    const copy = [...nodes];
    while (out.length < max && copy.length) {
      const idx = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  }

  onNodeAdded(_node) {}
  onNodeRemoved(_node) {}

  get name() {
    return this.constructor.name;
  }
}
