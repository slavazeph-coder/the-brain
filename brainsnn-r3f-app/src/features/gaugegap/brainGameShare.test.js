import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  buildGameShareUrl,
  CUSTOM_LEVEL_ID,
  describeSharedGame,
  encodeGameState,
  parseGameState,
} from './brainGameShare.js';
import { CURATED_LEVELS, MAX_LEVEL_TEXT } from './brainGameLevels.js';

const HREF = 'https://example.test/?lab=braingame';

function stateOf(url) {
  return new URL(url).searchParams.get('state');
}

describe('challenge link round trip', () => {
  it('restores a curated run exactly', () => {
    const url = buildGameShareUrl(HREF, { mode: 'challenge', levelId: 'outrage-bait-post' });
    expect(parseGameState(new URL(url).search)).toEqual({
      mode: 'challenge',
      levelId: 'outrage-bait-post',
      text: '',
    });
  });

  it('restores a custom run with its text', () => {
    const text = 'Doors close tonight. Everyone else has already joined.';
    const url = buildGameShareUrl(HREF, { mode: 'mission', levelId: CUSTOM_LEVEL_ID, text });
    expect(parseGameState(new URL(url).search)).toEqual({
      mode: 'mission',
      levelId: CUSTOM_LEVEL_ID,
      text,
    });
  });

  // The separator has to survive appearing inside shared text.
  it('survives text containing the field separator', () => {
    const text = 'Act now ~ before it is too late ~ seriously.';
    const url = buildGameShareUrl(HREF, { mode: 'mission', levelId: CUSTOM_LEVEL_ID, text });
    expect(parseGameState(new URL(url).search).text).toBe(text);
  });

  it('survives text containing commas and ampersands', () => {
    const text = 'Only 3 left, and doors close tonight & tomorrow.';
    const url = buildGameShareUrl(HREF, { mode: 'mission', levelId: CUSTOM_LEVEL_ID, text });
    expect(parseGameState(new URL(url).search).text).toBe(text);
  });

  it('sets the playground anchor and clears the attractor-only run param', () => {
    const url = buildGameShareUrl('https://example.test/?run=abc', { mode: 'mission', levelId: 'outrage-bait-post' });
    const parsed = new URL(url);
    expect(parsed.hash).toBe('#playground');
    expect(parsed.searchParams.get('run')).toBe(null);
    expect(parsed.searchParams.get('lab')).toBe('braingame');
  });
});

describe('parseGameState rejects what it does not understand', () => {
  it('ignores links for other labs', () => {
    expect(parseGameState('?lab=content&state=mission~outrage-bait-post')).toBe(null);
  });

  it('ignores a missing state', () => {
    expect(parseGameState('?lab=braingame')).toBe(null);
  });

  it('ignores an unknown mode', () => {
    expect(parseGameState('?lab=braingame&state=godmode~outrage-bait-post')).toBe(null);
  });

  // A stale link should fall back to the default rather than resolve to
  // something that merely looks plausible.
  it('ignores an unknown level rather than guessing', () => {
    expect(parseGameState('?lab=braingame&state=mission~level-that-was-removed')).toBe(null);
  });

  it('ignores a custom link with no text', () => {
    expect(parseGameState('?lab=braingame&state=mission~custom~')).toBe(null);
    expect(parseGameState('?lab=braingame&state=mission~custom~%20%20')).toBe(null);
  });

  it('handles empty and malformed input without throwing', () => {
    expect(parseGameState('')).toBe(null);
    expect(parseGameState(null)).toBe(null);
    expect(parseGameState('?lab=braingame&state=')).toBe(null);
  });
});

describe('encodeGameState', () => {
  it('falls back to a real mode and level for junk input', () => {
    const encoded = encodeGameState({ mode: 'nope', levelId: 'nope' });
    expect(encoded).toBe(`mission~${CURATED_LEVELS[0].id}`);
  });

  it('does not emit a custom level with empty text', () => {
    expect(encodeGameState({ mode: 'mission', levelId: CUSTOM_LEVEL_ID, text: '   ' }))
      .toBe(`mission~${CURATED_LEVELS[0].id}`);
  });

  it('caps shared text at the length the game would use anyway', () => {
    const url = buildGameShareUrl(HREF, { mode: 'mission', levelId: CUSTOM_LEVEL_ID, text: 'danger '.repeat(2000) });
    const text = parseGameState(new URL(url).search).text;
    expect(text.length).toBeLessThanOrEqual(MAX_LEVEL_TEXT);
  });

  it('encodes every curated level', () => {
    for (const level of CURATED_LEVELS) {
      const url = buildGameShareUrl(HREF, { mode: 'mission', levelId: level.id });
      expect(parseGameState(new URL(url).search).levelId).toBe(level.id);
      expect(stateOf(url).startsWith('mission~')).toBe(true);
    }
  });
});

describe('describeSharedGame', () => {
  it('names a curated level', () => {
    expect(describeSharedGame({ mode: 'mission', levelId: 'outrage-bait-post' })).toContain('Outrage bait');
  });

  it('does not claim to know what a pasted passage was', () => {
    expect(describeSharedGame({ mode: 'mission', levelId: CUSTOM_LEVEL_ID, text: 'x' }))
      .toContain('someone else pasted');
  });

  it('is empty for nothing', () => {
    expect(describeSharedGame(null)).toBe('');
  });
});
