/**
 * Worker pool — Comlink-lite postMessage proxy.
 *
 * Spawns N module workers (default: hardwareConcurrency - 1, capped 4),
 * round-robins requests, and resolves a Promise per request via reply ID.
 *
 * Used by the firewall / evolve / search / embeddings tracks (§10 of the
 * shell redesign plan) to keep heavy work off the main thread so the 3D
 * brain renders at full framerate during long scans.
 *
 * Usage:
 *   const pool = createPool(() => new Worker(
 *     new URL('../workers/firewall.worker.js', import.meta.url),
 *     { type: 'module' }
 *   ), { size: 2 });
 *   const result = await pool.call('score', { text: '…' });
 *
 * Graceful fallback: if Worker is unavailable (SSR, ancient browsers, test
 * env) `call()` invokes the optional `fallback` fn synchronously.
 */

const DEFAULT_SIZE = Math.max(
  1,
  Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency - 1) || 2)
);

let nextRequestId = 0;

function workerAvailable() {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

export function createPool(workerFactory, { size = DEFAULT_SIZE, fallback = null } = {}) {
  if (!workerAvailable()) {
    return {
      call: async (type, payload) => {
        if (!fallback) throw new Error('workerPool: no Worker and no fallback');
        return fallback(type, payload);
      },
      terminate: () => {},
      size: 0,
      degraded: true
    };
  }

  const workers = [];
  const pending = new Map();
  let cursor = 0;

  function spawn() {
    const w = workerFactory();
    w.onmessage = (e) => {
      const { id, ok, result, error } = e.data || {};
      const slot = pending.get(id);
      if (!slot) return;
      pending.delete(id);
      if (ok) slot.resolve(result);
      else slot.reject(new Error(error || 'worker error'));
    };
    w.onerror = (err) => {
      // surface to console; per-request rejections handled via onmessage error path
      // eslint-disable-next-line no-console
      console.warn('[workerPool] worker error', err.message || err);
    };
    return w;
  }

  for (let i = 0; i < size; i++) workers.push(spawn());

  return {
    size: workers.length,
    degraded: false,
    call(type, payload, transferList) {
      return new Promise((resolve, reject) => {
        const id = ++nextRequestId;
        pending.set(id, { resolve, reject });
        const w = workers[cursor++ % workers.length];
        try {
          w.postMessage({ id, type, payload }, transferList || []);
        } catch (err) {
          pending.delete(id);
          if (fallback) {
            try { resolve(fallback(type, payload)); } catch (fe) { reject(fe); }
          } else {
            reject(err);
          }
        }
      });
    },
    terminate() {
      for (const w of workers) {
        try { w.terminate(); } catch { /* noop */ }
      }
      workers.length = 0;
      pending.clear();
    }
  };
}

/**
 * Standard worker-side request handler. Wires a single `handlers` object
 * (type -> async fn) to self.onmessage and posts back the canonical reply
 * envelope expected by the pool above.
 *
 *   // inside a worker:
 *   import { handleRequests } from '../utils/workerPool.js';
 *   handleRequests({
 *     score: async ({ text }) => scoreContent(text),
 *   });
 */
export function handleRequests(handlers) {
  // self is the DedicatedWorkerGlobalScope inside a worker
  self.onmessage = async (e) => {
    const { id, type, payload } = e.data || {};
    const fn = handlers[type];
    if (!fn) {
      self.postMessage({ id, ok: false, error: `no handler: ${type}` });
      return;
    }
    try {
      const result = await fn(payload);
      self.postMessage({ id, ok: true, result });
    } catch (err) {
      self.postMessage({ id, ok: false, error: err?.message || String(err) });
    }
  };
}
