/**
 * multiTab — cross-tab brain-state sync via BroadcastChannel.
 *
 * When the user has BrainSNN open in two tabs, changes in one should
 * be observable in the other. This wraps a single 'brainsnn-state'
 * channel and exposes publish() + subscribe() helpers.
 *
 * Payload shape is intentionally generic: { kind, payload, origin, ts }.
 * Consumers filter on `kind` (e.g. 'brain:state', 'firewall:scan',
 * 'snapshot:saved'). `origin` is a per-tab id so listeners can ignore
 * their own broadcasts.
 *
 * Falls back to a no-op shim if BroadcastChannel is unavailable
 * (Safari has it since 15.4 — wide coverage now, but still safe).
 */

const CHANNEL = 'brainsnn-state';
const ORIGIN = `tab-${Math.random().toString(36).slice(2, 8)}-${Date.now() & 0xffff}`;

let _channel = null;
const _subs = new Map();

function ensureChannel() {
  if (_channel) return _channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    _channel = new BroadcastChannel(CHANNEL);
    _channel.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.origin === ORIGIN) return;
      const subs = _subs.get(msg.kind);
      if (!subs) return;
      for (const cb of subs) {
        try { cb(msg.payload, msg); } catch (err) {
          console.warn('[multiTab] subscriber threw:', err);
        }
      }
    };
    return _channel;
  } catch {
    return null;
  }
}

export function publish(kind, payload) {
  const ch = ensureChannel();
  if (!ch) return;
  try {
    ch.postMessage({ kind, payload, origin: ORIGIN, ts: Date.now() });
  } catch { /* clone failures swallowed */ }
}

export function subscribe(kind, cb) {
  ensureChannel();
  if (!_subs.has(kind)) _subs.set(kind, new Set());
  _subs.get(kind).add(cb);
  return () => {
    const set = _subs.get(kind);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) _subs.delete(kind);
  };
}

export function tabId() { return ORIGIN; }
