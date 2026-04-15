/**
 * Layer 31 — Brain Evolve : Sampler factory
 *
 * Centralized lookup used by the UI to select a strategy at runtime.
 */

import { UCB1Sampler } from './ucb1.js';
import { IslandSampler } from './island.js';
import { GreedySampler } from './greedy.js';
import { RandomSampler } from './random.js';

export const SAMPLER_KEYS = ['ucb1', 'island', 'greedy', 'random'];

export const SAMPLER_LABELS = {
  ucb1: 'UCB1 (explore + exploit)',
  island: 'Island + MAP-Elites (diverse)',
  greedy: 'Greedy (pure exploit)',
  random: 'Random (baseline)'
};

export const SAMPLER_DESCRIPTIONS = {
  ucb1:
    'Multi-armed bandit: balances trying fresh mutations against exploiting known strong rules. c=1.414.',
  island:
    'Partitions population into islands; within each island, picks elites across feature bins (FPR × size). Periodic migration every 3 rounds.',
  greedy:
    'Always picks the highest-scoring nodes. Good for final polishing, can get stuck in local maxima.',
  random:
    'Uniform random parents — the control baseline. If your other samplers can’t beat this, something is off.'
};

export function makeSampler(key, opts = {}) {
  switch (key) {
    case 'ucb1':
      return new UCB1Sampler(opts);
    case 'island':
      return new IslandSampler(opts);
    case 'greedy':
      return new GreedySampler(opts);
    case 'random':
    default:
      return new RandomSampler(opts);
  }
}
