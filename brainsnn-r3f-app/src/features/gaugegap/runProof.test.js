import { describe, expect, it } from '../../test/tinyVitest.js';
import { buildRunProof, replayRun, RUN_PROOF_SCHEMA, verifyRunProof } from './runProof.js';

const NOW = new Date('2026-07-29T00:00:00Z');
const WINNING_LOG = [{ tick: 5, id: 'lesion-amy' }];
const IDLE_LOG = [];

describe('replayRun', () => {
  it('is deterministic', () => {
    const a = replayRun({ mode: 'mission', seed: 'abc', log: WINNING_LOG });
    const b = replayRun({ mode: 'mission', seed: 'abc', log: WINNING_LOG });
    expect(JSON.stringify(a.scores)).toBe(JSON.stringify(b.scores));
  });

  it('reproduces the outcome the live game reaches', () => {
    expect(replayRun({ mode: 'mission', seed: 'abc', log: IDLE_LOG }).status).toBe('lost');
    expect(replayRun({ mode: 'mission', seed: 'abc', log: WINNING_LOG }).status).toBe('won');
  });

  it('respects when an intervention was applied', () => {
    // Acting immediately should never score worse than acting far too late.
    const early = replayRun({ mode: 'mission', seed: 'abc', log: [{ tick: 0, id: 'lesion-amy' }] });
    const late = replayRun({ mode: 'mission', seed: 'abc', log: [{ tick: 250, id: 'lesion-amy' }] });
    expect(early.scores.stability).toBeGreaterThanOrEqual(late.scores.stability);
  });

  it('ignores unknown intervention ids', () => {
    const result = replayRun({ mode: 'mission', seed: 'abc', log: [{ tick: 3, id: 'not-a-real-move' }] });
    expect(result.used).toBe(0);
  });
});

describe('buildRunProof', () => {
  it('carries the schema, seed, log and a content hash', async () => {
    const proof = await buildRunProof({ mode: 'mission', seed: 'abc', log: WINNING_LOG, now: NOW });
    expect(proof.schema).toBe(RUN_PROOF_SCHEMA);
    expect(proof.seed).toBe('abc');
    expect(proof.log.length).toBe(1);
    expect(proof.result.status).toBe('won');
    expect(proof.content_hash.length).toBe(64);
  });

  it('carries no user text — only ticks and intervention ids', async () => {
    const proof = await buildRunProof({ mode: 'mission', seed: 'abc', log: WINNING_LOG, now: NOW });
    expect(JSON.stringify(proof).includes('rawContent')).toBe(false);
    for (const entry of proof.log) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'tick']);
    }
  });

  it('is reproducible for identical input', async () => {
    const a = await buildRunProof({ mode: 'mission', seed: 'abc', log: WINNING_LOG, now: NOW });
    const b = await buildRunProof({ mode: 'mission', seed: 'abc', log: WINNING_LOG, now: NOW });
    expect(a.content_hash).toBe(b.content_hash);
  });
});

describe('verifyRunProof', () => {
  it('accepts an untouched proof', async () => {
    const proof = await buildRunProof({ mode: 'mission', seed: 'abc', log: WINNING_LOG, now: NOW });
    const verdict = await verifyRunProof(proof);
    expect(verdict.verified).toBe(true);
    expect(verdict.problems).toEqual([]);
  });

  // The point of the whole design: inflating a score requires producing a log
  // that actually replays to it, not editing the number.
  it('rejects an inflated score', async () => {
    const proof = await buildRunProof({ mode: 'mission', seed: 'abc', log: WINNING_LOG, now: NOW });
    proof.result.scores.defense = 100;
    const verdict = await verifyRunProof(proof);
    expect(verdict.verified).toBe(false);
    expect(verdict.problems.some((problem) => problem.includes('score mismatch'))).toBe(true);
  });

  it('rejects a claimed win that replays as a loss', async () => {
    const proof = await buildRunProof({ mode: 'mission', seed: 'abc', log: IDLE_LOG, now: NOW });
    proof.result.status = 'won';
    const verdict = await verifyRunProof(proof);
    expect(verdict.verified).toBe(false);
    expect(verdict.problems.some((problem) => problem.includes('status mismatch'))).toBe(true);
  });

  it('rejects a tampered log even if the score is left alone', async () => {
    const proof = await buildRunProof({ mode: 'mission', seed: 'abc', log: IDLE_LOG, now: NOW });
    proof.log = WINNING_LOG;
    const verdict = await verifyRunProof(proof);
    expect(verdict.verified).toBe(false);
  });

  it('rejects malformed submissions with reasons', async () => {
    expect((await verifyRunProof(null)).verified).toBe(false);
    const bad = await verifyRunProof({ schema: 'something.else' });
    expect(bad.verified).toBe(false);
    expect(bad.problems.length).toBeGreaterThan(0);
  });
});
