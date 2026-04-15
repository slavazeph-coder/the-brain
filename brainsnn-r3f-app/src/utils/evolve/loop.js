/**
 * Layer 31 — Brain Evolve : 4-step orchestrator
 *
 * Runs ASI-Evolve's canonical Learn → Design → Experiment → Analyze loop,
 * but specialized to cognitive-firewall rule evolution. Each "round"
 * produces one or more child nodes; each child is a mutated ruleset that
 * is scored against the red team corpus.
 *
 * Steps
 * -----
 *  1. LEARN      — mine n-gram lift candidates from the red team corpus
 *                  (missed attacks only once a baseline exists). Returns
 *                  a list of promising new regex sources.
 *
 *  2. DESIGN     — sample parent(s) via the configured sampler, pick a
 *                  mutation operator (or crossover for 2 parents), build
 *                  the child ruleset + motivation string.
 *
 *  3. EXPERIMENT — run `runRedTeam` with a score fn bound to the child's
 *                  rules and compute F1 at threshold 0.3.
 *
 *  4. ANALYZE    — distill a short lesson ("dropping 'hidden' improved FPR
 *                  by 18%") so the human operator can read the story of
 *                  the search.
 *
 * The loop is async + cooperatively yielding — we `await` a microtask
 * between rounds so React can repaint the progress bar.
 */

import { runRedTeam, getAttackCorpus } from '../redTeam.js';
import { scoreContentWithRules, DEFAULT_RULES, deserializeRules, serializeRules } from '../cognitiveFirewall.js';
import { makeNode, featureBin } from './node.js';
import { makeSampler } from './samplers/factory.js';
import {
  applyRandomMutation,
  crossover,
  mineNGramCandidates,
  MUTATION_OPERATORS
} from './mutations.js';

/**
 * Build the seed node (= current default rules).
 */
export function seedNode() {
  return makeNode({
    name: 'gen0-seed',
    ruleSet: serializeRules(DEFAULT_RULES),
    motivation: 'default firewall rules',
    metaInfo: { sampler: 'seed', operator: 'seed', generation: 0 }
  });
}

/**
 * Evaluate a single node against the red team corpus. Mutates the node
 * in place with `results`, `score`, and increments visitCount.
 */
export function evaluateNode(node, { threshold = 0.3 } = {}) {
  const rules = deserializeRules(node.ruleSet);
  const result = runRedTeam({
    thresholds: [threshold],
    scoreFn: (text) => scoreContentWithRules(text, rules, { deterministic: true })
  });
  const metric = result.summary.thresholds[threshold];
  node.results = result;
  node.score = metric?.f1 ?? 0;
  node.visitCount = (node.visitCount || 0) + 1;
  node.metaInfo = { ...(node.metaInfo || {}), featureBin: featureBin(node) };
  return node;
}

/**
 * Analyzer step: produce a short lesson string by diffing child vs parent.
 * Purely local — no LLM required. Highlights the biggest change in FPR /
 * detection rate and attributes it to the operator used.
 */
export function analyzeChild(child, parent) {
  const t = 0.3;
  const cm = child.results?.summary?.thresholds?.[t];
  const pm = parent?.results?.summary?.thresholds?.[t];
  if (!cm) return 'no results';

  const dF1 = pm ? cm.f1 - pm.f1 : cm.f1;
  const dDR = pm ? cm.detectionRate - pm.detectionRate : cm.detectionRate;
  const dFPR = pm ? cm.falsePositiveRate - pm.falsePositiveRate : cm.falsePositiveRate;

  const op = child.metaInfo?.operator || 'mutation';
  const sign = (x) => (x >= 0 ? '+' : '');
  const parts = [];
  parts.push(`F1 ${cm.f1.toFixed(3)} (${sign(dF1)}${dF1.toFixed(3)})`);
  parts.push(`detection ${(cm.detectionRate * 100).toFixed(0)}% (${sign(dDR * 100)}${(dDR * 100).toFixed(0)}%)`);
  parts.push(`FPR ${(cm.falsePositiveRate * 100).toFixed(0)}% (${sign(dFPR * 100)}${(dFPR * 100).toFixed(0)}%)`);
  parts.push(`via ${op}`);
  return parts.join(' · ');
}

/**
 * Run one round: sample parent(s), mutate, evaluate, analyze. Returns the
 * new child node (unattached — caller decides whether to keep it in the pool).
 */
export function runOneRound({
  sampler,
  pool,
  candidates,
  generation = 0,
  crossoverProb = 0.2
}) {
  const useCrossover = pool.length >= 2 && Math.random() < crossoverProb;
  let child;
  if (useCrossover) {
    const parents = sampler.sample(pool, 2);
    if (parents.length < 2) return null;
    const { rules, note } = crossover(parents[0], parents[1]);
    child = makeNode({
      name: `gen${generation}-xover`,
      parent: parents.map((p) => p.id),
      motivation: note,
      ruleSet: rules,
      metaInfo: { sampler: sampler.name, operator: 'crossover', generation }
    });
  } else {
    const [parent] = sampler.sample(pool, 1);
    if (!parent) return null;
    const { rules, note, operator } = applyRandomMutation(parent, candidates);
    child = makeNode({
      name: `gen${generation}-${operator}`,
      parent: [parent.id],
      motivation: note,
      ruleSet: rules,
      metaInfo: { sampler: sampler.name, operator, generation }
    });
  }
  evaluateNode(child);
  return child;
}

/**
 * Full loop. Kicks off from `initialPool` (defaults to `[seedNode()]`), runs
 * `generations` × `populationPerGen` rounds, and invokes `onRound({ round,
 * total, child, pool })` after each child is evaluated so the UI can update.
 *
 * Returns the final pool + best node.
 */
export async function runEvolution({
  generations = 5,
  populationPerGen = 4,
  samplerKey = 'ucb1',
  samplerOpts = {},
  poolCap = 30,
  initialPool = null,
  crossoverProb = 0.2,
  onRound,
  shouldStop
} = {}) {
  const sampler = makeSampler(samplerKey, samplerOpts);
  let pool = initialPool || [seedNode()];

  // Score + register seed(s) if unscored
  for (const node of pool) {
    if (!node.results) evaluateNode(node);
    sampler.onNodeAdded(node);
  }

  const corpus = getAttackCorpus();
  const candidates = mineNGramCandidates(corpus, { n: 2, topK: 25 });
  const total = generations * populationPerGen;
  let round = 0;

  for (let g = 1; g <= generations; g++) {
    for (let i = 0; i < populationPerGen; i++) {
      if (shouldStop && shouldStop()) break;
      round += 1;
      const child = runOneRound({
        sampler,
        pool,
        candidates,
        generation: g,
        crossoverProb
      });
      if (!child) continue;

      // Attach Analyzer result by diffing against best parent
      const parentNode = pool.find((p) => p.id === child.parent[0]);
      child.analysis = analyzeChild(child, parentNode);

      pool.push(child);
      sampler.onNodeAdded(child);

      // Cap the pool to the strongest N (keeps memory bounded)
      if (pool.length > poolCap) {
        pool.sort((a, b) => (b.score || 0) - (a.score || 0));
        const removed = pool.slice(poolCap);
        pool = pool.slice(0, poolCap);
        for (const r of removed) sampler.onNodeRemoved(r);
      }

      if (onRound) onRound({ round, total, child, pool, generation: g });
      // Yield to the browser so the UI can repaint
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }
    if (shouldStop && shouldStop()) break;
  }

  const best = [...pool].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  return { pool, best, sampler: samplerKey };
}

export { MUTATION_OPERATORS };
