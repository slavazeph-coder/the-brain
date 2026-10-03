import { describe, expect, it } from '../../../test/tinyVitest.js';
import {
  KNIFE,
  knifeOpacity,
  knifeY,
  PALETTE_STORAGE_KEY,
  pinchAmount,
  pinchAxis,
  PINCH,
  paletteById,
  POKE_PALETTES,
  readStoredPalette,
  storePalette,
} from './jellyGestures.js';
import { SHELL } from './brainShell.js';

describe('pinch', () => {
  it('jelly: fingers together squash (negative), apart stretch (positive), still is zero', () => {
    expect(pinchAmount(200, 200)).toBe(0);
    expect(pinchAmount(200, 100)).toBeLessThan(0);
    expect(pinchAmount(200, 300)).toBeGreaterThan(0);
  });

  it('jelly: the pinch amount can never invert the body', () => {
    expect(pinchAmount(200, 0)).toBe(-PINCH.max);
    expect(pinchAmount(200, 2000)).toBe(PINCH.max);
  });

  it('jelly: a degenerate start distance pinches to nothing, not NaN', () => {
    expect(pinchAmount(0, 100)).toBe(0);
    expect(pinchAmount(-5, 100)).toBe(0);
  });

  it('jelly: the pinch axis is the normalized line between the two grabs', () => {
    expect(pinchAxis([0, 0, 0], [3, 0, 0])).toEqual([1, 0, 0]);
    const diagonal = pinchAxis([1, 1, 1], [2, 2, 2]);
    expect(Math.hypot(...diagonal)).toBeLessThan(1.0001);
    expect(Math.hypot(...diagonal)).toBeGreaterThan(0.9999);
  });
});

describe('knife cut', () => {
  it('jelly: the blade starts above the brain and ends through it', () => {
    expect(knifeY(0)).toBe(KNIFE.topY);
    expect(knifeY(1)).toBe(KNIFE.bottomY);
    expect(knifeY(0.3)).toBeLessThan(KNIFE.topY);
    expect(knifeY(0.3)).toBeGreaterThan(KNIFE.bottomY);
  });

  it('jelly: the blade fades in fast and out at the end', () => {
    expect(knifeOpacity(0)).toBe(0);
    expect(knifeOpacity(0.05)).toBeGreaterThan(0);
    expect(knifeOpacity(0.5)).toBe(1);
    expect(knifeOpacity(1)).toBe(0);
  });

  it('jelly: the cut opens when the edge is inside the brain, not before it arrives', () => {
    const edge = (t) => knifeY(t) - KNIFE.edgeBelow;
    expect(edge(0)).toBeGreaterThan(SHELL.radii[1]);
    expect(edge(KNIFE.biteAt)).toBeLessThan(SHELL.radii[1]);
    expect(edge(KNIFE.biteAt)).toBeGreaterThan(-SHELL.radii[1]);
  });
});

describe('palettes', () => {
  it('jelly: every palette carries the three colours the shader needs', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const palette of POKE_PALETTES) {
      expect(hex.test(palette.cyan)).toBe(true);
      expect(hex.test(palette.violet)).toBe(true);
      expect(hex.test(palette.cut)).toBe(true);
    }
  });

  it('jelly: the zombie palette exists for Halloween', () => {
    expect(POKE_PALETTES.length).toBe(6);
    const zombie = paletteById('zombie');
    expect(zombie.name).toBe('Zombie');
    expect(zombie.cut).toBe('#e11d48');
  });

  it('jelly: an unknown palette id falls back to Brain', () => {
    expect(paletteById('nope').id).toBe('brain');
    expect(paletteById(undefined).id).toBe('brain');
  });

  it('jelly: the stored palette round-trips, and garbage reads as Brain', () => {
    const realWindow = globalThis.window;
    const store = {};
    globalThis.window = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
    try {
      expect(readStoredPalette()).toBe('brain');
      storePalette('watermelon');
      expect(store[PALETTE_STORAGE_KEY]).toBe('watermelon');
      expect(readStoredPalette()).toBe('watermelon');
      store[PALETTE_STORAGE_KEY] = 'mouldy';
      expect(readStoredPalette()).toBe('brain');
    } finally {
      globalThis.window = realWindow;
    }
  });
});
