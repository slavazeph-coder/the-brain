// Gesture-layer helpers for the jelly lab: two-finger pinch/stretch, the
// hemisphere slice, and the jelly colour palettes.
//
// Pure functions only — the scene owns pointer tracking and uniforms — so the
// maths is testable here in bare Node, like jellyPhysics.js.

export const PINCH = Object.freeze({
  // Whole-body squash/stretch from a two-finger pinch, written into uPinch
  // with the same axis/amount math as the release squash: negative amount
  // squashes along the pinch axis (fingers together), positive stretches it
  // (fingers apart).
  gain: 0.55,
  max: 0.32,
  // A second finger landing this close (screen px) to the first counts as the
  // same touch, not a pinch.
  minStartDist: 24,
});

/**
 * Pinch amount from the finger-distance ratio. Negative when the fingers move
 * together (squash along the axis), positive when they spread (stretch),
 * clamped so the body can never invert.
 */
export function pinchAmount(startDist, curDist, cfg = PINCH) {
  if (!(startDist > 0)) return 0;
  const raw = (curDist / startDist - 1) * cfg.gain;
  return Math.max(-cfg.max, Math.min(cfg.max, raw));
}

/** Normalized axis between two grab origins, in the shell's own space. */
export function pinchAxis(originA, originB) {
  const dx = originB[0] - originA[0];
  const dy = originB[1] - originA[1];
  const dz = originB[2] - originA[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  return [dx / length, dy / length, dz / length];
}

export const SLICE = Object.freeze({
  // World units each hemisphere travels when the slice is fully open.
  maxGap: 0.8,
  // How fast the cut eases open/closed (per second).
  rate: 7,
});

/** Ease the slice toward its target. Frame-rate independent, no overshoot. */
export function sliceStep(current, target, dt) {
  const t = Math.min(1, Math.max(0, dt) * SLICE.rate);
  return current + (target - current) * t;
}

// Jelly colours. `cyan` is the frontal pole, `violet` the occipital pole —
// the shader blends between them — and `cut` is the fresh-slice interior.
export const POKE_PALETTES = Object.freeze([
  { id: 'brain', name: 'Brain', cyan: '#68eaff', violet: '#947cff', cut: '#e8fbff' },
  { id: 'watermelon', name: 'Watermelon', cyan: '#4ade80', violet: '#fb7185', cut: '#ffe9ef' },
  { id: 'grape', name: 'Grape', cyan: '#c4b5fd', violet: '#7c3aed', cut: '#f1e8ff' },
  { id: 'ocean', name: 'Ocean', cyan: '#7dd3fc', violet: '#2563eb', cut: '#e2f3fe' },
  { id: 'sunset', name: 'Sunset', cyan: '#fdba74', violet: '#f43f5e', cut: '#fff0e2' },
]);

/** Unknown ids fall back to Brain — a stored id is never allowed to break the shader. */
export function paletteById(id) {
  return POKE_PALETTES.find((palette) => palette.id === id) || POKE_PALETTES[0];
}

export const PALETTE_STORAGE_KEY = 'poke-palette';

export function readStoredPalette() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'brain';
    return paletteById(window.localStorage.getItem(PALETTE_STORAGE_KEY)).id;
  } catch {
    return 'brain';
  }
}

export function storePalette(id) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(PALETTE_STORAGE_KEY, paletteById(id).id);
  } catch {
    // Private mode: the toy still works, the choice just doesn't persist.
  }
}
