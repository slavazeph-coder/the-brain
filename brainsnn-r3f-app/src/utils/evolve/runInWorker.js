/**
 * runInWorker — main-thread wrapper around evolve.worker.js.
 *
 * Identical signature to runEvolution() in loop.js, so panels can swap
 * imports without changing their call site. Falls back to the inline
 * runEvolution when Worker isn't available (SSR, tests).
 *
 * Returns { pool, best, sampler, cancel }. `cancel()` posts a stop
 * message and the worker honors it between rounds.
 */

import { runEvolution as runInlineEvolution } from './loop.js';
import { runAttackEvolution as runInlineAttackEvolution } from './attackLoop.js';

const workerAvailable = typeof Worker !== 'undefined' && typeof URL !== 'undefined';

/**
 * Shared dispatcher. Caller passes an already-constructed Worker
 * (the `new URL(...)` call MUST live at the call site so Vite's
 * static analyzer can trace it and bundle the worker source) plus
 * the inline fallback. Both emit the same { pool, best, sampler }
 * shape and forward `round` events to onRound.
 */
function dispatch(worker, inlineFn, opts = {}) {
  const { onRound, ...passThrough } = opts;

  if (!worker) {
    const cancelRef = { stopped: false };
    const promise = inlineFn({
      ...opts,
      shouldStop: () => cancelRef.stopped
    });
    promise.cancel = () => { cancelRef.stopped = true; };
    return promise;
  }

  let settled = false;
  const promise = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const { type, payload } = e.data || {};
      if (type === 'round') {
        if (onRound) {
          try { onRound(payload); } catch { /* UI errors aren't worker errors */ }
        }
        return;
      }
      if (type === 'done') {
        settled = true;
        worker.terminate();
        resolve(payload);
        return;
      }
      if (type === 'error') {
        settled = true;
        worker.terminate();
        reject(new Error(payload?.message || 'worker error'));
      }
    };
    worker.onerror = (err) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(err?.message || 'worker error'));
    };
    worker.postMessage({ type: 'start', payload: passThrough });
  });

  promise.cancel = () => {
    if (settled) return;
    try { worker.postMessage({ type: 'stop' }); } catch { /* noop */ }
  };
  return promise;
}

export function runEvolutionAsync(opts = {}) {
  // new URL inline so Vite picks up the worker source for bundling.
  const worker = workerAvailable
    ? new Worker(new URL('../../workers/evolve.worker.js', import.meta.url), { type: 'module' })
    : null;
  return dispatch(worker, runInlineEvolution, opts);
}

export function runAttackEvolutionAsync(opts = {}) {
  const worker = workerAvailable
    ? new Worker(new URL('../../workers/attackEvolve.worker.js', import.meta.url), { type: 'module' })
    : null;
  return dispatch(worker, runInlineAttackEvolution, opts);
}
