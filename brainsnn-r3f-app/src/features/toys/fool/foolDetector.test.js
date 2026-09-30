import { describe, expect, it } from '../../../test/tinyVitest.js';
import { TECHNIQUES } from '../../../lib/persuasionTechniques.js';
import {
  FOOL_MAX_CHARS,
  FOOL_RANKS,
  FOOL_ROUNDS,
  judgeRound,
  rankFor,
  summarizeGame,
  validateLine,
} from './foolDetector.js';

const KNOWN = new Set(TECHNIQUES.map((technique) => technique.id));

describe('fool the detector', () => {
  it('fool: five rounds that escalate from one trick to three', () => {
    expect(FOOL_ROUNDS).toHaveLength(5);
    expect(FOOL_ROUNDS.map((round) => round.targets.length)).toEqual([1, 1, 1, 2, 3]);
    for (const round of FOOL_ROUNDS) for (const target of round.targets) expect(KNOWN.has(target)).toBe(true);
  });

  it('fool: every "obvious" example really is caught by the real detector', () => {
    // If a detector change stopped catching these, the game would be teaching
    // players the wrong thing about what the detector sees.
    for (const round of FOOL_ROUNDS) {
      const result = judgeRound(round, round.caught);
      expect(result.valid).toBe(true);
      expect(result.outcome).toBe('caught');
      expect(result.points).toBe(0);
    }
  });

  it('fool: the published paraphrase blind spot is reproducible in the game', () => {
    // The README's own example: Appeal to Time by any annotator's reading, and
    // invisible to the lexical detector.
    const result = judgeRound(FOOL_ROUNDS[0], 'The window shuts Friday and we are not reopening it.');
    expect(result.outcome).toBe('slipped');
    expect(result.points).toBe(20);
    expect(result.flagged).toHaveLength(0);
  });

  it('fool: naming the wrong trick earns half, catching some of several earns a share', () => {
    const half = judgeRound(FOOL_ROUNDS[0], 'Doctors recommend this, so the window shuts on Friday for good.');
    expect(half.outcome).toBe('partial');
    expect(half.points).toBe(10);
    const share = judgeRound(FOOL_ROUNDS[3], 'Doors close tonight and I think you would like it here.');
    expect(share.outcome).toBe('partial');
    expect(share.caught).toHaveLength(1);
    expect(share.points).toBe(10);
  });

  it('fool: lines that are too short or too long are not judged', () => {
    expect(validateLine('act now')).toContain('at least');
    expect(validateLine('a '.repeat(FOOL_MAX_CHARS))).toContain('under');
    expect(judgeRound(FOOL_ROUNDS[0], 'too short').valid).toBe(false);
    expect(validateLine('This one has enough words in it.')).toBe('');
  });

  it('fool: totals and ranks cover the full 0–100 range', () => {
    expect(rankFor(100).title).toBe('Prompt Ninja');
    expect(rankFor(85).title).toBe('Ghost');
    expect(rankFor(0).title).toBe('Open Book');
    expect(FOOL_RANKS[FOOL_RANKS.length - 1].min).toBe(0);
    const perfect = FOOL_ROUNDS.map((round) => ({ valid: true, outcome: 'slipped', points: 20, roundId: round.id }));
    const summary = summarizeGame(perfect);
    expect(summary.score).toBe(100);
    expect(summary.slipped).toBe(5);
    expect(summary.finished).toBe(true);
    expect(summarizeGame([{ valid: false }]).rounds).toBe(0);
  });
});
