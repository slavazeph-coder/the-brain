/**
 * bus — tiny global event bus for the AppShell.
 *
 * Used by Workspace navigation (`shell:goto`), command palette / hotkeys
 * (`shell:flash`), onboarding (`shell:goto` before highlighting), and
 * any panel that needs to communicate cross-workspace without prop
 * drilling.
 *
 * Intentionally ~50 LOC and dependency-free. Replaces the scattered
 * window.dispatchEvent / addEventListener patterns the legacy code uses.
 */

const _listeners = new Map();

// Sticky-event buffer. The composer emits `shell:compose` before the
// destination workspace's lazy chunk has finished loading; without
// this, the event is fired into the void and the panel never sees
// it (silent drop). Sticky events are stored with a timestamp and
// replayed to late subscribers if still inside the TTL window.
const _sticky = new Map();
const STICKY_EVENTS = {
  'shell:compose': 2500   // ms — covers a cold lazy-chunk fetch
};

export const bus = {
  on(event, handler) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(handler);

    // Late-subscriber replay for sticky events.
    const ttl = STICKY_EVENTS[event];
    if (ttl != null) {
      const buffered = _sticky.get(event);
      if (buffered && Date.now() - buffered.ts <= ttl) {
        // Defer one microtask so the subscriber's component has
        // finished mounting before its handler runs.
        Promise.resolve().then(() => {
          try { handler(buffered.payload); } catch (err) {
            console.error(`[bus] sticky replay for "${event}" threw:`, err);
          }
        });
      }
    }

    return () => bus.off(event, handler);
  },

  off(event, handler) {
    const set = _listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) _listeners.delete(event);
  },

  emit(event, payload) {
    // Stash sticky events so late subscribers (lazy workspaces) can
    // pick them up after the cold chunk fetch resolves.
    if (event in STICKY_EVENTS) {
      _sticky.set(event, { payload, ts: Date.now() });
    }
    const set = _listeners.get(event);
    if (!set) return;
    // Snapshot so handlers can off() themselves without breaking iteration.
    for (const fn of Array.from(set)) {
      try { fn(payload); } catch (err) {
        console.error(`[bus] handler for "${event}" threw:`, err);
      }
    }
  },

  /**
   * Clear a sticky event so a stale value doesn't replay to a
   * subscriber that mounts much later. Used by the composer after
   * its event has been seen (or after a workspace switch).
   */
  clearSticky(event) {
    _sticky.delete(event);
  }
};

// React hook helper — auto-cleanup on unmount.
import { useEffect } from 'react';
export function useBusEvent(event, handler) {
  useEffect(() => bus.on(event, handler), [event, handler]);
}
