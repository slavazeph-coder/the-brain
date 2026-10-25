import { describe, expect, it } from '../../../test/tinyVitest.js';
import { parseGameState } from '../../gaugegap/brainGameShare.js';
import { CURATED_LEVELS } from '../../gaugegap/brainGameLevels.js';
import { toyShareUrl } from '../toyConfig.js';
import { DEFEND_BOUNDARY, DEFEND_SCORE_NOTE, defendChallengeParams, defendTitle } from './defendShare.js';

const run = (overrides = {}) => ({ status: 'won', mode: 'mission', levelId: CURATED_LEVELS[1].id, scores: { defense: 90 }, ...overrides });

describe('defend the brain share card', () => {
  it('defend: keeps the game disclaimers verbatim', () => {
    expect(DEFEND_SCORE_NOTE).toBe('Scores are 0–100 indices, not probabilities.');
    expect(DEFEND_BOUNDARY).toBe('Results describe tested conditions, not universal capability.');
  });

  it('defend: titles a run by outcome first, then by score', () => {
    expect(defendTitle(run())).toBe('Cortex Guardian');
    expect(defendTitle(run({ scores: { defense: 70 } }))).toBe('Held the line');
    expect(defendTitle(run({ scores: { defense: 20 } }))).toBe('Scraped through');
    expect(defendTitle(run({ status: 'lost', scores: { defense: 99 } }))).toBe('Judgment offline');
    expect(defendTitle(null)).toBe('');
  });

  it('defend: a shared card reopens the same level and mode on the toy route, tagged with its source', () => {
    const url = new URL(toyShareUrl('defend', { params: defendChallengeParams(run({ mode: 'challenge' })) }));
    expect(url.pathname).toBe('/toys/defend-the-brain');
    expect(url.searchParams.get('src')).toBe('toy4-share');
    expect(parseGameState(url.search)).toEqual({ mode: 'challenge', levelId: CURATED_LEVELS[1].id, text: '' });
  });

  it('defend: a pasted custom level never rides along in the link', () => {
    expect(defendChallengeParams(run({ levelId: 'custom' }))).toEqual({});
    expect(defendChallengeParams(null)).toEqual({});
  });
});
