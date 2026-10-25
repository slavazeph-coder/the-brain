import { describe, expect, it } from '../../../test/tinyVitest.js';
import { detectPokeTier } from './pokeTier.js';

describe('poke tier policy', () => {
  it('poke tier: a capable laptop gets the full-detail jelly', () => {
    expect(detectPokeTier({ webgl: true, width: 1440, deviceMemory: 8, cores: 8 })).toBe('high');
  });

  it('poke tier: phones get the real, touchable jelly at lower detail rather than a picture', () => {
    expect(detectPokeTier({ webgl: true, width: 390, deviceMemory: 4, coarsePointer: true })).toBe('low');
    expect(detectPokeTier({ webgl: true, width: 1024, coarsePointer: true })).toBe('low');
    expect(detectPokeTier({ webgl: true, width: 1440, cores: 4 })).toBe('low');
  });

  it('poke tier: only devices that cannot run it at all fall back to 2D', () => {
    expect(detectPokeTier({ webgl: false, width: 1440 })).toBe('2d');
    expect(detectPokeTier({ webgl: true, deviceMemory: 1 })).toBe('2d');
    expect(detectPokeTier({ webgl: true, forced: '1' })).toBe('2d');
    // Unknown memory (Safari and Firefox do not report it) is not a reason to degrade.
    expect(detectPokeTier({ webgl: true, width: 1440 })).toBe('high');
  });
});
