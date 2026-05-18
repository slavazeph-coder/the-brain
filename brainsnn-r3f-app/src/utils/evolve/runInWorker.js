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

import { runEvolution as runInline } from './loop.js';

const workerAvailable = typeof Worker !== 'undefined' && typeof URL !== 'undefined';

export function runEvolutionAsync(opts = {}) {
  const { onRound, ...passThrough } = opts;

  if (!workerAvailable) {
    // Inline path — pure delegation. Returns a Promise + a no-op cancel.
    const cancelRef = { stopped: false };
    const promise = runInline({
      ...opts,
      shouldStop: () => cancelRef.stopped
    });
    promise.cancel = () => { cancelRef.stopped = true; };
    return promise;
  }

  const worker = new Worker(
    new URL('../../workers/evolve.worker.js', import.meta.url),
    { type: 'module' }
  );

  let settled = false;
  const promise = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const { type, payload } = e.data || {};
      if (type === 'round') {
        if (onRound) {
          try { onRound(payload); } catch { /* swallow — UI errors aren't worker errors */ }
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
    // Worker exits cleanly via shouldStop between rounds; if we
    // really need an instant kill, the caller can terminate() the
    // worker, but that risks losing the final done message.
  };
  return promise;
}
