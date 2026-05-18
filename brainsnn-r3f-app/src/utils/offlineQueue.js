/**
 * offlineQueue — main-thread half of the service-worker write queue.
 *
 * sw.js enqueues failed non-GET requests automatically (see fetch
 * handler). This module is for code paths that want to:
 *   - opt in / out of queuing explicitly
 *   - observe queue depth for UI feedback
 *   - trigger an immediate replay attempt without waiting for the
 *     Background Sync trigger (which may be throttled by the browser)
 *
 * Most callers can keep using fetch() unchanged; the SW catches network
 * failures and persists the request. This helper is here for the few
 * surfaces that want explicit feedback.
 */

import { openStore } from './store';

const QUEUE_COLLECTION = 'offline-queue-view';  // for UI mirroring only

export async function replayNow() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return;
  try {
    navigator.serviceWorker.controller.postMessage({ type: 'replayNow' });
  } catch { /* noop */ }
}

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

const _listeners = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    replayNow();
    for (const cb of _listeners) {
      try { cb({ online: true }); } catch { /* noop */ }
    }
  });
  window.addEventListener('offline', () => {
    for (const cb of _listeners) {
      try { cb({ online: false }); } catch { /* noop */ }
    }
  });
}

export function onOnlineChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/**
 * Wrap a fetch call with explicit offline awareness. Returns
 *   { ok: true, response }  → success
 *   { ok: false, queued: true } → SW will retry when online
 *   { ok: false, reason } → real failure
 *
 * Use this for the share / sync / room writes where the UI wants to
 * say "queued — will sync when online" instead of "error."
 */
export async function fetchOrQueue(input, init = {}) {
  try {
    const resp = await fetch(input, init);
    // SW returns 202 when it queued the request after a network failure.
    if (resp.status === 202) {
      const data = await resp.json().catch(() => ({}));
      if (data?.queued) return { ok: false, queued: true };
    }
    return { ok: resp.ok, response: resp };
  } catch (err) {
    return { ok: false, reason: err?.message || 'network error' };
  }
}

export { QUEUE_COLLECTION };
