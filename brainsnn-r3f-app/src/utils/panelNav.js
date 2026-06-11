/**
 * Panel navigation helpers — the one place that knows how to find, scroll
 * to, and flash a layer's panel in the DOM.
 *
 * Panels are addressed by a `data-panel-id` anchor (`l<N>` for catalog
 * layers, or a plain string for the few non-layer panels). The legacy
 * eyebrow-text match ("Layer N") remains as a fallback for panels that
 * haven't been wrapped in an anchor yet.
 *
 * Cross-section navigation is event-based: `navigateToLayer()` dispatches
 * `bsnn:navigate-layer`, and App (which owns `activeSection`) switches to
 * the right section before scrolling — without it, panels in unvisited
 * sections are unmounted and a plain scroll silently does nothing.
 */

export const NAVIGATE_LAYER_EVENT = 'bsnn:navigate-layer';
export const OPEN_PALETTE_EVENT = 'bsnn:open-palette';

/** Briefly ring a panel so the eye lands on it after a programmatic scroll. */
export function flashPanel(el) {
  if (!el) return;
  el.classList.remove('panel-flash');
  // Force a reflow so re-adding the class restarts the animation.
  void el.offsetWidth;
  el.classList.add('panel-flash');
  setTimeout(() => el.classList.remove('panel-flash'), 1400);
}

/**
 * Find a panel's DOM element by layer id (number) or string anchor.
 * Returns the element to scroll to, or null.
 */
export function findPanelByLayer(layerId) {
  const key = typeof layerId === 'number' ? `l${layerId}` : String(layerId);
  const anchor = document.querySelector(`[data-panel-id="${key}"]`);
  if (anchor) return anchor;

  // Legacy fallback: match "Layer N" in panel eyebrows.
  if (typeof layerId === 'number') {
    try {
      const re = new RegExp(`\\blayer\\s*${layerId}\\b`, 'i');
      for (const el of document.querySelectorAll('.eyebrow')) {
        if (re.test(el.textContent || '')) {
          const panel = el.closest('.panel');
          if (panel) return panel;
        }
      }
    } catch {
      /* noop */
    }
  }
  return null;
}

/** True when the element is laid out (not inside a `hidden` section). */
function isVisible(el) {
  return Boolean(el && el.offsetParent !== null);
}

/** Scroll to + flash a layer's panel if it's present and visible. */
export function scrollToLayerPanel(layerId) {
  const el = findPanelByLayer(layerId);
  if (!isVisible(el)) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Flash the inner .panel when the anchor wraps one; the ring reads
  // better on the card itself than on the invisible wrapper.
  flashPanel(el.classList.contains('panel') ? el : el.querySelector('.panel') || el);
  return true;
}

/**
 * Ask the app to navigate to a layer, switching sections if needed.
 * Handled by an App-level listener that owns `activeSection`.
 */
export function navigateToLayer(layerId) {
  window.dispatchEvent(
    new CustomEvent(NAVIGATE_LAYER_EVENT, { detail: { layerId } }),
  );
}

/** Ask the command palette to open (e.g. from a visible search button). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
}

/**
 * Retry until the panel exists *and* is visible — covers section switches
 * where the lazy chunk (and per-panel LazyOnVisible placeholders) need a
 * moment to mount.
 */
export function pollForPanel(layerId, { timeout = 4000, interval = 120 } = {}) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    function attempt() {
      const el = findPanelByLayer(layerId);
      if (el && el.offsetParent !== null) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(attempt, interval);
    }
    attempt();
  });
}
