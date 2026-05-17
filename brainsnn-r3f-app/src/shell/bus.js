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

export const bus = {
  on(event, handler) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(handler);
    return () => bus.off(event, handler);
  },

  off(event, handler) {
    const set = _listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) _listeners.delete(event);
  },

  emit(event, payload) {
    const set = _listeners.get(event);
    if (!set) return;
    // Snapshot so handlers can off() themselves without breaking iteration.
    for (const fn of Array.from(set)) {
      try { fn(payload); } catch (err) {
        console.error(`[bus] handler for "${event}" threw:`, err);
      }
    }
  }
};

// React hook helper — auto-cleanup on unmount.
import { useEffect } from 'react';
export function useBusEvent(event, handler) {
  useEffect(() => bus.on(event, handler), [event, handler]);
}
