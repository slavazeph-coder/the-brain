/**
 * Layer 98 — Theme + Accessibility
 *
 * Applies CSS custom properties to <html> based on the user's theme
 * selection + accessibility toggles. Four axes:
 *   - theme: 'auto' | 'dark' | 'light'
 *   - highContrast: boolean
 *   - reduceMotion: boolean
 *   - fontScale: 0.9 | 1 | 1.15 | 1.3
 *
 * Persisted to brainsnn_theme_v1. Auto-applies on load.
 */

const STORAGE_KEY = 'brainsnn_theme_v1';

export const DEFAULT_THEME = {
  theme: 'auto',
  highContrast: false,
  reduceMotion: false,
  fontScale: 1,
};

export function getTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME };
    return { ...DEFAULT_THEME, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_THEME }; }
}

export function setTheme(next) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  applyTheme(next);
}

function effectiveTheme(settings) {
  if (settings.theme === 'auto') {
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return settings.theme;
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function applyTheme(settings = getTheme()) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const theme = effectiveTheme(settings);
  html.dataset.theme = theme;
  html.dataset.highContrast = settings.highContrast ? 'on' : 'off';
  const reduce = settings.reduceMotion || prefersReducedMotion();
  html.dataset.reduceMotion = reduce ? 'on' : 'off';
  html.style.setProperty('--bsnn-font-scale', String(settings.fontScale || 1));
  // Minimal direct style tweaks so we don't rely on global CSS edits
  if (theme === 'light') {
    html.style.setProperty('color-scheme', 'light');
  } else {
    html.style.setProperty('color-scheme', 'dark');
  }
  if (reduce) {
    html.style.setProperty('--bsnn-anim-duration', '0ms');
  } else {
    html.style.removeProperty('--bsnn-anim-duration');
  }
}

export function registerTheme() {
  applyTheme(getTheme());
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', () => applyTheme(getTheme()));
  }
}
