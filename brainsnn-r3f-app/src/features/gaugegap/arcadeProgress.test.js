import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  ACHIEVEMENT_XP,
  applyAchievement,
  applyVisit,
  emptyProgress,
  levelFor,
  normalizeProgress,
  XP_DAILY,
  XP_FIRST_VISIT,
  XP_REVISIT,
} from './arcadeProgressCore.js';

const TODAY = '2026-07-29';
const YESTERDAY = '2026-07-28';

describe('normalizeProgress', () => {
  it('fills in every field from junk input', () => {
    for (const input of [null, undefined, 'nonsense', { xp: 'lots' }]) {
      const progress = normalizeProgress(input);
      expect(Array.isArray(progress.visited)).toBe(true);
      expect(Array.isArray(progress.unlocked)).toBe(true);
      expect(progress.xp).toBe(0);
      expect(typeof progress.bestScores).toBe('object');
    }
  });

  it('preserves progress saved by an older version without the new fields', () => {
    const legacy = { visited: ['attractor'], xp: 40, streak: 2, lastVisit: TODAY, dailyWins: [TODAY] };
    const progress = normalizeProgress(legacy);
    expect(progress.xp).toBe(40);
    expect(progress.visited).toContain('attractor');
    expect(progress.unlocked).toEqual([]);
  });
});

describe('applyVisit', () => {
  it('pays more for a first visit than a repeat', () => {
    const first = applyVisit(emptyProgress(), { id: 'braingame', today: TODAY, yesterday: YESTERDAY });
    expect(first.xp).toBe(XP_FIRST_VISIT);
    const second = applyVisit(first, { id: 'braingame', today: TODAY, yesterday: YESTERDAY });
    expect(second.xp).toBe(XP_FIRST_VISIT + XP_REVISIT);
  });

  it('pays the daily bonus once per day', () => {
    const first = applyVisit(emptyProgress(), { id: 'spiking', dailyLabId: 'spiking', today: TODAY, yesterday: YESTERDAY });
    expect(first.xp).toBe(XP_FIRST_VISIT + XP_DAILY);
    const again = applyVisit(first, { id: 'spiking', dailyLabId: 'spiking', today: TODAY, yesterday: YESTERDAY });
    expect(again.xp).toBe(first.xp + XP_REVISIT);
  });

  it('extends a streak on consecutive days and resets after a gap', () => {
    const day1 = applyVisit(emptyProgress(), { id: 'a', today: YESTERDAY, yesterday: '2026-07-27' });
    expect(day1.streak).toBe(1);
    const day2 = applyVisit(day1, { id: 'b', today: TODAY, yesterday: YESTERDAY });
    expect(day2.streak).toBe(2);
    const afterGap = applyVisit(day2, { id: 'c', today: '2026-08-05', yesterday: '2026-08-04' });
    expect(afterGap.streak).toBe(1);
  });

  it('does not drop achievement state when recording a visit', () => {
    const unlocked = applyAchievement(emptyProgress(), 'defender', { score: 80, labId: 'braingame' });
    const visited = applyVisit(unlocked, { id: 'braingame', today: TODAY, yesterday: YESTERDAY });
    expect(visited.unlocked).toContain('defender');
    expect(visited.bestScores.braingame).toBe(80);
  });
});

describe('applyAchievement', () => {
  it('pays once and never again', () => {
    const first = applyAchievement(emptyProgress(), 'defender', { score: 70, labId: 'braingame' });
    expect(first.xp).toBe(ACHIEVEMENT_XP);
    expect(first.unlocked).toContain('defender');

    const repeat = applyAchievement(first, 'defender', { score: 70, labId: 'braingame' });
    expect(repeat.xp).toBe(ACHIEVEMENT_XP);
  });

  it('updates the personal best without paying again', () => {
    const first = applyAchievement(emptyProgress(), 'defender', { score: 70, labId: 'braingame' });
    const better = applyAchievement(first, 'defender', { score: 91, labId: 'braingame' });
    expect(better.bestScores.braingame).toBe(91);
    expect(better.xp).toBe(ACHIEVEMENT_XP);
  });

  it('keeps the best score when a later run is worse', () => {
    const best = applyAchievement(emptyProgress(), 'defender', { score: 91, labId: 'braingame' });
    const worse = applyAchievement(best, 'defender', { score: 40, labId: 'braingame' });
    expect(worse.bestScores.braingame).toBe(91);
  });

  it('ignores a missing id', () => {
    const progress = applyAchievement(emptyProgress(), null, { score: 10 });
    expect(progress.xp).toBe(0);
    expect(progress.unlocked).toEqual([]);
  });

  it('keeps the reward bounded so it cannot be farmed', () => {
    expect(ACHIEVEMENT_XP).toBeGreaterThan(0);
    expect(ACHIEVEMENT_XP).toBeLessThanOrEqual(50);
  });
});

describe('levelFor', () => {
  it('advances a level every 125 XP', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(124).level).toBe(1);
    expect(levelFor(125).level).toBe(2);
    expect(levelFor(130).levelProgress).toBe(5);
  });
});
