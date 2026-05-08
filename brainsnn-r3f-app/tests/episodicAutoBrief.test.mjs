/**
 * Smoke tests for episodicAutoBrief.
 * Uses an in-memory localStorage shim and synthesizes captures.
 */

import './_localStorage.mjs';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetLocalStorage } from './_localStorage.mjs';

import {
  shouldRunBrief,
  shouldRunSynthesis,
  recordBrief,
  recordSynthesis,
  getAutoBriefState,
  clearAutoBrief,
  nextBriefRelative,
  nextSynthesisRelative
} from '../src/utils/episodicAutoBrief.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function captureAt(tsOffsetMs) {
  return { id: `cap_${Math.random()}`, ts: Date.now() + tsOffsetMs, text: 'x', firewall: { pressure: 0.1 } };
}

beforeEach(() => {
  resetLocalStorage();
  clearAutoBrief();
});

describe('shouldRunBrief', () => {
  it('rejects when too few captures', () => {
    const captures = [captureAt(-1 * HOUR), captureAt(-2 * HOUR)];
    const r = shouldRunBrief(captures);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too-few-captures');
    assert.equal(r.have, 2);
  });

  it('approves with 3 fresh captures and never-run history', () => {
    const captures = [captureAt(-1 * HOUR), captureAt(-2 * HOUR), captureAt(-3 * HOUR)];
    const r = shouldRunBrief(captures);
    assert.equal(r.ok, true);
    assert.equal(r.freshCount, 3);
  });

  it('rejects when last brief was too recent', () => {
    const captures = [captureAt(-1 * HOUR), captureAt(-2 * HOUR), captureAt(-3 * HOUR)];
    recordBrief({ count: 3, source: 'local', pattern: 'p', question: 'q' }, 3);
    const r = shouldRunBrief(captures);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too-soon');
  });

  it('rejects when no fresh captures since last brief', () => {
    // brief recorded with a window of captures, then no new ones
    const captures = [captureAt(-25 * HOUR), captureAt(-26 * HOUR), captureAt(-27 * HOUR)];
    recordBrief({ count: 3 }, 3);
    const r = shouldRunBrief(captures);
    // captures are all > 24h old → eligible filter empties → too-few-captures
    assert.equal(r.ok, false);
  });
});

describe('shouldRunSynthesis', () => {
  it('rejects when too few captures in 7d', () => {
    const captures = [captureAt(-1 * DAY), captureAt(-2 * DAY)];
    const r = shouldRunSynthesis(captures);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too-few-captures');
  });

  it('approves with 4+ captures in 7d when never run', () => {
    const captures = Array.from({ length: 4 }, (_, i) => captureAt(-(i + 1) * DAY));
    const r = shouldRunSynthesis(captures);
    assert.equal(r.ok, true);
    assert.equal(r.weeklyCount, 4);
  });

  it('rejects when synth ran recently', () => {
    const captures = Array.from({ length: 4 }, (_, i) => captureAt(-(i + 1) * DAY));
    recordSynthesis({ count: 4, source: 'local', emergingThesis: 't', oneAction: 'a' });
    const r = shouldRunSynthesis(captures);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too-soon');
  });
});

describe('history persistence', () => {
  it('keeps brief history across reads', () => {
    recordBrief({ count: 3, source: 'local', pattern: 'p1', question: 'q1' }, 3);
    recordBrief({ count: 4, source: 'local', pattern: 'p2', question: 'q2' }, 4);
    const s = getAutoBriefState();
    assert.equal(s.briefHistory.length, 2);
    assert.equal(s.briefHistory[0].pattern, 'p2');
  });

  it('caps history at 12', () => {
    for (let i = 0; i < 20; i++) recordBrief({ count: i, pattern: `p${i}` }, i);
    const s = getAutoBriefState();
    assert.equal(s.briefHistory.length, 12);
  });
});

describe('relative timers', () => {
  it('reports never-run when no history', () => {
    assert.equal(nextBriefRelative(), 'never run');
    assert.equal(nextSynthesisRelative(), 'never run');
  });

  it('reports a relative window after recording', () => {
    recordBrief({ count: 3, source: 'local', pattern: 'p', question: 'q' }, 3);
    const t = nextBriefRelative();
    assert.match(t, /^(?:ready now|\d+h \d+m|\d+m)$/);
  });
});
