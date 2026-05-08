/**
 * Smoke tests for episodicStreak.
 *
 * Uses the localStorage shim and synthesizes captures with explicit
 * timestamps so streak math is deterministic regardless of the clock.
 */

import './_localStorage.mjs';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetLocalStorage } from './_localStorage.mjs';

import { computeStreak, streakLabel, clearStreak } from '../src/utils/episodicStreak.js';

const DAY = 24 * 60 * 60 * 1000;

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function makeCapturesAtDays(daysAgoArr) {
  // daysAgoArr is e.g. [0, 1, 2] meaning today, yesterday, day before
  return daysAgoArr.map((d, i) => ({ id: `c${i}`, ts: Date.now() - d * DAY }));
}

beforeEach(() => {
  resetLocalStorage();
  clearStreak();
});

describe('computeStreak', () => {
  it('returns 0 streak with empty captures', () => {
    const s = computeStreak([]);
    assert.equal(s.current, 0);
    assert.equal(s.todayCaptures, 0);
  });

  it('counts a single capture today as a 1-day streak', () => {
    const s = computeStreak(makeCapturesAtDays([0]));
    assert.equal(s.current, 1);
    assert.equal(s.todayCaptures, 1);
  });

  it('counts consecutive days as a multi-day streak', () => {
    const s = computeStreak(makeCapturesAtDays([0, 1, 2, 3]));
    assert.equal(s.current, 4);
  });

  it('treats yesterday-only as a still-alive streak (grace period)', () => {
    const s = computeStreak(makeCapturesAtDays([1]));
    assert.equal(s.current, 1);
  });

  it('resets when there is a gap', () => {
    // Today, then 5 days ago — gap breaks the streak
    const s = computeStreak(makeCapturesAtDays([0, 5, 6, 7]));
    assert.equal(s.current, 1);
  });

  it('multiple captures on the same day count as one day', () => {
    const captures = [
      { id: 'a', ts: Date.now() },
      { id: 'b', ts: Date.now() - 60 * 1000 },
      { id: 'c', ts: Date.now() - 60 * 60 * 1000 }
    ];
    const s = computeStreak(captures);
    assert.equal(s.current, 1);
    assert.equal(s.todayCaptures, 3);
    assert.equal(s.totalDays, 1);
  });

  it('persists longest across calls', () => {
    computeStreak(makeCapturesAtDays([0, 1, 2, 3, 4])); // 5
    const next = computeStreak(makeCapturesAtDays([0])); // 1
    assert.equal(next.longest, 5);
  });

  it('totalDays equals the number of distinct UTC days', () => {
    const s = computeStreak(makeCapturesAtDays([0, 0, 1, 2, 5, 5, 10]));
    assert.equal(s.totalDays, 5); // {today, today-1, today-2, today-5, today-10}
  });
});

describe('streakLabel', () => {
  it('handles no streak', () => {
    assert.equal(streakLabel({ current: 0 }), 'no streak yet');
  });

  it('handles 1-day', () => {
    assert.equal(streakLabel({ current: 1 }), '1-day streak');
  });

  it('plain text under 7', () => {
    assert.equal(streakLabel({ current: 3 }), '3-day streak');
  });

  it('one fire under 30', () => {
    assert.match(streakLabel({ current: 12 }), /🔥 12-day streak/);
  });

  it('two fires under 100', () => {
    assert.match(streakLabel({ current: 50 }), /🔥🔥 50-day streak/);
  });

  it('three fires at 100+', () => {
    assert.match(streakLabel({ current: 365 }), /🔥🔥🔥 365-day streak/);
  });
});
