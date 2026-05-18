/**
 * threeTokens — bridge CSS custom properties into Three.js color space.
 *
 * Three.js parses CSS color strings (`'#c96442'`) but NOT CSS variables
 * (`'var(--accent)'`) — its color parser doesn't traverse the cascade.
 * This helper reads the resolved values from <html> once, caches them,
 * and exposes a React hook that re-reads on theme switches so the brain
 * scene reskins when the user toggles light/dark or high-contrast.
 */

import { useEffect, useState } from 'react';

const FALLBACKS = {
  accent:       '#c96442',
  accentBright: '#e08868',
  danger:       '#c46666',
  ok:           '#7a9c5f',
  warn:         '#c9a14b',
  bg3d:         '#0f0e0c',
  signal:       '#e8b8a8',
  floorTint:    '#1f1c19'
};

let _cache = null;

function readTokens() {
  if (typeof window === 'undefined' || !document?.documentElement) return FALLBACKS;
  const style = getComputedStyle(document.documentElement);
  const read = (name, fb) => {
    const v = style.getPropertyValue(name).trim();
    return v || fb;
  };
  return {
    accent:       read('--accent',        FALLBACKS.accent),
    accentBright: read('--accent-bright', FALLBACKS.accentBright),
    danger:       read('--danger',        FALLBACKS.danger),
    ok:           read('--ok',            FALLBACKS.ok),
    warn:         read('--warn',          FALLBACKS.warn),
    bg3d:         read('--bg-3d',         FALLBACKS.bg3d),
    signal:       read('--accent-bright', FALLBACKS.signal),
    floorTint:    read('--surface-3',     FALLBACKS.floorTint)
  };
}

export function getThreeTokens() {
  if (!_cache) _cache = readTokens();
  return _cache;
}

export function invalidateThreeTokens() {
  _cache = null;
}

/**
 * React hook — returns current tokens, re-reads when the user toggles
 * theme or high-contrast (theme.js writes data-theme / data-high-contrast
 * on <html>; we observe both attributes and invalidate the cache).
 */
export function useThreeTokens() {
  const [tokens, setTokens] = useState(getThreeTokens);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const observer = new MutationObserver(() => {
      invalidateThreeTokens();
      setTokens(getThreeTokens());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-high-contrast']
    });
    return () => observer.disconnect();
  }, []);
  return tokens;
}
