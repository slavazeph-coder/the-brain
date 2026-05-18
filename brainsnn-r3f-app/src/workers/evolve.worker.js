/**
 * evolve.worker.js — Brain Evolve loop in a dedicated worker.
 *
 * Hosts the Layer 31 evolution machinery (UCB1 / Island / MAP-Elites
 * samplers + n-gram mining + mutation operators + red-team scoring)
 * off the main thread. Each round's red-team evaluation is the
 * expensive step — running it in a worker keeps the 3D brain at
 * full framerate during a 16-round evolution.
 *
 * Streaming protocol (one-shot worker per evolution run):
 *   main → worker:  { type: 'start',  payload: <runEvolutionOpts> }
 *   main → worker:  { type: 'stop' }   // cooperative cancel
 *   worker → main:  { type: 'round',  payload: { round, total, child, pool, generation } }
 *   worker → main:  { type: 'done',   payload: { pool, best, sampler } }
 *   worker → main:  { type: 'error',  payload: { message } }
 */

import { runEvolution, seedNode } from '../utils/evolve/loop.js';

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
    const initialPool = payload?.initialPool || [seedNode()];
    const opts = {
      ...payload,
      initialPool,
      shouldStop: () => stopped,
      onRound: ({ round, total, child, pool, generation }) => {
        // Strip non-serializable fields if any sneaked in (defensive).
        self.postMessage({
          type: 'round',
          payload: { round, total, child, pool, generation }
        });
      }
    };
    const { pool, best, sampler } = await runEvolution(opts);
    self.postMessage({ type: 'done', payload: { pool, best, sampler } });
  } catch (err) {
    self.postMessage({ type: 'error', payload: { message: err?.message || String(err) } });
  }
};
