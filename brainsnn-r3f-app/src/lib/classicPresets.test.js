import { describe, expect, it } from '../test/tinyVitest.js';
import { CLASSIC_PRESETS, getClassicPreset } from './classicPresets.js';

// Real brand/person tokens must never appear — all presets are genericized.
const BANNED_TOKENS = ['nike', 'apple', 'avis', 'hertz', 'rolex', 'tesla', 'musk', 'trump', 'coca', 'pepsi', 'mcdonald', 'amazon', 'paypal', 'netflix'];

describe('CLASSIC_PRESETS', () => {
  it('has unique ids and at least 8 presets', () => {
    const ids = CLASSIC_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(8);
  });

  it('every preset has scannable content and a teaser', () => {
    for (const preset of CLASSIC_PRESETS) {
      expect(preset.content.length).toBeGreaterThanOrEqual(12);
      expect(preset.content.length).toBeLessThanOrEqual(400);
      expect(typeof preset.archetype).toBe('string');
      expect(typeof preset.teaser.label).toBe('string');
      expect(['low', 'high', 'extreme'].includes(preset.teaser.level)).toBe(true);
    }
  });

  it('contains no real brand or person names', () => {
    for (const preset of CLASSIC_PRESETS) {
      const haystack = `${preset.label} ${preset.content}`.toLowerCase();
      for (const token of BANNED_TOKENS) {
        expect(haystack.includes(token)).toBe(false);
      }
    }
  });

  it('getClassicPreset resolves ids and rejects unknowns', () => {
    expect(getClassicPreset('account-phishing-email')?.teaser.level).toBe('extreme');
    expect(getClassicPreset('nope')).toBe(null);
  });
});
