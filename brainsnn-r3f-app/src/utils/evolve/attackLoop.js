/**
 * Layer 32 — Attack Evolve : Orchestrator
 *
 * Mirrors Layer 31's `loop.js` but evolves ATTACKS instead of RULES. Each
 * "node" is a candidate attack string, scored on evasion (= 1 − manipulation
 * pressure detected by the CURRENT active firewall). Higher score = sneakier.
 *
 * Samplers are reused (UCB1 / Island / Greedy / Random) — the algorithm is
 * parent-selection-agnostic. Mutations come from `attackMutations.js`.
 *
 * Key constraint: evolved attacks must still be recognizably attack-shaped.
 * We enforce this by requiring the evasion score to be paired with a
 * "semantic continuity" check: the evolved text must share ≥2 content words
 * (length > 4) with the original parent. Otherwise mutation reduces to
 * "replace with benign text" and the evolution is uninteresting.
 */

import { scoreContent } from '../cognitiveFirewall.js';
import { makeSampler } from './samplers/factory.js';
import { applyRandomAttackMutation, crossoverAttacks } from './attackMutations.js';

let _counter = 0;
function uid() {
  _counter += 1;
  return (
    Date.now().toString(36).slice(-4) +
    _counter.toString(36) +
    Math.random().toString(36).slice(2, 5)
  );
}

/**
 * Create an attack node. `text` is the candidate string; `origin` is the
 * red-team-corpus category it descended from (for provenance).
 */
export function makeAttackNode({
  text,
  origin = 'combo',
  parent = [],
  operator = 'seed',
  generation = 0,
  note = ''
} = {}) {
  return {
    id: uid(),
    text,
    origin,
    parent: Array.isArray(parent) ? parent : [parent].filter(Boolean),
    operator,
    generation,
    note,
    score: 0,
    visitCount: 0,
    detection: null, // filled by evaluateAttack
    continuity: 1,
    createdAt: Date.now()
  };
}

/**
 * Score an attack against the currently active firewall. Returns the node
 * with `score` (evasion), `detection` (pressure), and `continuity` populated.
 *
 * Continuity = fraction of parent's content words (len > 4) still present.
 * Evolved attacks with continuity < 0.25 are heavily penalized so the search
 * stays in attack space.
 */
export function evaluateAttack(node, parentText) {
  const pressure = scoreContent(node.text).manipulationPressure || 0;
  const evasion = 1 - pressure;

  let continuity = 1;
  if (parentText) {
    const parentWords = new Set(
      (parentText.toLowerCase().match(/\b[a-z]{5,}\b/g) || []).slice(0, 30)
    );
    if (parentWords.size) {
      const childWords = new Set(
        (node.text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])
      );
      let kept = 0;
      for (const w of parentWords) if (childWords.has(w)) kept += 1;
      continuity = kept / parentWords.size;
    }
  }

  // Fitness = evasion, penalized when continuity collapses.
  const penalty = continuity < 0.25 ? continuity / 0.25 : 1;
  node.detection = pressure;
  node.continuity = continuity;
  node.score = evasion * penalty;
  node.visitCount = (node.visitCount || 0) + 1;
  return node;
}

/**
 * Seed pool from a subset of the red team corpus. Caller provides the corpus
 * (usually `getAttackCorpus()` from redTeam.js) and selects which categories
 * to seed from.
 */
export function seedAttackPool(corpus, { categories = ['combo', 'urgency', 'outrage', 'fear', 'certainty'], perCategory = 2 } = {}) {
  const pool = [];
  for (const cat of categories) {
    const samples = corpus[cat] || [];
    const take = samples.slice(0, perCategory);
    for (const text of take) {
      const node = makeAttackNode({ text, origin: cat, operator: 'seed', generation: 0 });
      evaluateAttack(node, null);
      pool.push(node);
    }
  }
  return pool;
}

/**
 * Run one evolution round: sample parent(s), mutate, evaluate.
 */
function runOneRound({ sampler, pool, generation, crossoverProb = 0.15 }) {
  const useCrossover = pool.length >= 2 && Math.random() < crossoverProb;
  if (useCrossover) {
    const [a, b] = sampler.sample(pool, 2);
    if (!a || !b) return null;
    const { text, note } = crossoverAttacks(a, b);
    const child = makeAttackNode({
      text,
      origin: a.origin,
      parent: [a.id, b.id],
      operator: 'crossover',
      generation,
      note
    });
    evaluateAttack(child, a.text);
    return child;
  }
  const [parent] = sampler.sample(pool, 1);
  if (!parent) return null;
  const { text, note, operator } = applyRandomAttackMutation(parent);
  const child = makeAttackNode({
    text,
    origin: parent.origin,
    parent: [parent.id],
    operator,
    generation,
    note
  });
  evaluateAttack(child, parent.text);
  return child;
}

/**
 * Full attack-evolution loop. Same shape as Layer 31's `runEvolution` so
 * the UI can share patterns.
 */
export async function runAttackEvolution({
  generations = 4,
  populationPerGen = 4,
  samplerKey = 'ucb1',
  samplerOpts = {},
  poolCap = 24,
  initialPool = null,
  crossoverProb = 0.15,
  onRound,
  shouldStop
} = {}) {
  const sampler = makeSampler(samplerKey, samplerOpts);
  let pool = initialPool || [];
  for (const node of pool) sampler.onNodeAdded(node);

  const total = generations * populationPerGen;
  let round = 0;

  for (let g = 1; g <= generations; g++) {
    for (let i = 0; i < populationPerGen; i++) {
      if (shouldStop && shouldStop()) break;
      round += 1;
      const child = runOneRound({ sampler, pool, generation: g, crossoverProb });
      if (!child) continue;
      pool.push(child);
      sampler.onNodeAdded(child);

      if (pool.length > poolCap) {
        pool.sort((a, b) => (b.score || 0) - (a.score || 0));
        const removed = pool.slice(poolCap);
        pool = pool.slice(0, poolCap);
        for (const r of removed) sampler.onNodeRemoved(r);
      }

      if (onRound) onRound({ round, total, child, pool, generation: g });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }
    if (shouldStop && shouldStop()) break;
  }

  pool.sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = pool[0];
  return { pool, best };
}
