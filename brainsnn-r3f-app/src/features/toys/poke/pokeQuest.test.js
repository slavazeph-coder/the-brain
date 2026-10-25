import { describe, expect, it } from '../../../test/tinyVitest.js';
import { completeQuest, currentQuest, QUEST } from './pokeQuest.js';

const ids = (...list) => new Set(list);

describe('poke guide', () => {
  it('guide: a new visitor is told to tap first', () => {
    expect(currentQuest(ids()).id).toBe('poke');
  });

  it('guide: it walks poke, stretch, slice, swipe, heal, shake, then gets out of the way', () => {
    let done = ids();
    const seen = [];
    for (let i = 0; i < QUEST.length; i += 1) {
      const step = currentQuest(done, { has3d: true, knife: true });
      seen.push(step.id);
      done = completeQuest(done, step.id);
    }
    expect(seen.join(',')).toBe('poke,stretch,slice,swipe,heal,shake');
    expect(currentQuest(done, { knife: true })).toBe(null);
  });

  it('guide: knife steps wait while the knife is away instead of blocking', () => {
    const done = ids('poke', 'stretch', 'slice');
    expect(currentQuest(done, { knife: false }).id).toBe('shake');
    expect(currentQuest(done, { knife: true }).id).toBe('swipe');
  });

  it('guide: it follows a visitor who jumps ahead instead of sending them back', () => {
    // Straight to Slice: offer the swipe, not "tap the brain".
    expect(currentQuest(ids('slice'), { knife: true }).id).toBe('swipe');
    // Shake first: nothing is left ahead, so circle back to the start.
    expect(currentQuest(ids('shake')).id).toBe('poke');
  });

  it('guide: the 2D brain only asks for what it can do', () => {
    expect(currentQuest(ids('poke'), { has3d: false }).id).toBe('shake');
    expect(currentQuest(ids('poke', 'shake'), { has3d: false })).toBe(null);
  });

  it('guide: completing a step twice returns the same set (no re-render churn)', () => {
    const done = ids('poke');
    expect(completeQuest(done, 'poke')).toBe(done);
    expect(completeQuest(done, 'shake').has('shake')).toBe(true);
  });

  it('guide: the swipe step keeps the wording the knife hint has always used', () => {
    expect(QUEST.find((step) => step.id === 'swipe').text).toBe('Swipe through the brain to slice it');
  });
});
