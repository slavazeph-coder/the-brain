/**
 * atomicWrites — Web Locks API wrapper for cross-tab atomicity.
 *
 * Some writes (snapshot list, custom-rules list, archive append) can
 * race when two tabs save simultaneously — last-write-wins clobbers
 * the other tab's change.
 *
 * Web Locks API serializes a named critical section across all
 * same-origin tabs. Falls back to a per-tab Promise queue when the
 * API is unavailable (Firefox < 96 etc.).
 */

const _localQueues = new Map();

function locksAvailable() {
  return typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function';
}

/**
 * Run `fn` inside an exclusive lock named `name`. The lock auto-releases
 * when `fn` resolves or rejects. Cross-tab on supporting browsers,
 * single-tab serial on others.
 */
export async function withLock(name, fn) {
  if (locksAvailable()) {
    return navigator.locks.request(name, { mode: 'exclusive' }, async () => fn());
  }
  // Fallback: per-tab Promise chain so at least same-tab callers
  // don't race each other.
  const prev = _localQueues.get(name) || Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  _localQueues.set(name, next.catch(() => { /* swallow for next chain link */ }));
  return next;
}

/**
 * Convenience: read → modify → write under a single lock. The reader
 * receives the existing value (or `init` if absent); whatever it
 * returns is written back.
 */
export async function mutate(name, store, key, init, fn) {
  return withLock(`${name}:${key}`, async () => {
    const current = (await store.get(key)) ?? init;
    const next = await fn(current);
    await store.set(key, next);
    return next;
  });
}
