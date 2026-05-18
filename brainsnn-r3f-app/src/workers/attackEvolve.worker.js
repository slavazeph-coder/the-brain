/**
 * attackEvolve.worker.js — Attack Evolve loop in a dedicated worker.
 *
 * Sister to evolve.worker.js (Brain Evolve). Same streaming protocol:
 *   main → worker:  { type: 'start', payload: <runAttackEvolutionOpts> }
 *   main → worker:  { type: 'stop' }
 *   worker → main:  { type: 'round',  payload: { round, total, child, pool, generation } }
 *   worker → main:  { type: 'done',   payload: { pool, best, sampler } }
 *   worker → main:  { type: 'error',  payload: { message } }
 *
 * Note: runAttackEvolution requires an initialPool seeded with the
 * current red-team corpus; the wrapper computes that on the main
 * thread before dispatching (corpus access in a worker would need
 * cross-thread coherence on Layer 25's mutable corpus state).
 */

import { runAttackEvolution } from '../utils/evolve/attackLoop.js';

let stopped = false;

self.onmessage = async (e) => {
  const { type, payload } = e.data || {};

  if (type === 'stop') {
    stopped = true;
    return;
  }

  if (type !== 'start') return;

  stopped = false;
  try {
    const opts = {
      ...payload,
      shouldStop: () => stopped,
      onRound: ({ round, total, child, pool, generation }) => {
        self.postMessage({
          type: 'round',
          payload: { round, total, child, pool, generation }
        });
      }
    };
    const { pool, best, sampler } = await runAttackEvolution(opts);
    self.postMessage({ type: 'done', payload: { pool, best, sampler } });
  } catch (err) {
    self.postMessage({ type: 'error', payload: { message: err?.message || String(err) } });
  }
};
