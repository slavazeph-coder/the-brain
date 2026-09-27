import { describe, expect, it } from '../test/tinyVitest.js';
import { buildInsertStatement, createEventStore } from './eventStore.js';

function sample(event = 'scan_completed', at = '2026-09-07T10:00:00.000Z') {
  return { event, properties: { goal: 'trust' }, from: { utm_source: 'x' }, path: '/app', at };
}

function fakeClock(start = 0) {
  const state = { value: start };
  return { now: () => state.value, advance: (ms) => { state.value += ms; } };
}

describe('buildInsertStatement', () => {
  it('passes the batch as one psql variable rather than inlining values', () => {
    const { sql, variables } = buildInsertStatement([sample(), sample('visit')]);
    expect(sql).toContain(":'batch'::jsonb");
    expect(JSON.parse(variables.batch).length).toBe(2);
  });

  it('never concatenates event text into the statement', () => {
    const hostile = sample("visit'); DROP TABLE brainsnn_events;--");
    const { sql, variables } = buildInsertStatement([hostile]);
    expect(sql).not.toContain('DROP TABLE');
    expect(JSON.parse(variables.batch)[0].event).toContain('DROP TABLE');
  });
});

describe('createEventStore', () => {
  it('buffers records and writes them in one batch', async () => {
    const calls = [];
    const clock = fakeClock();
    const store = createEventStore({ execute: (sql, vars) => { calls.push(vars); }, now: clock.now });

    store.record(sample());
    store.record(sample('visit'));
    expect(store.pending()).toBe(2);

    await store.flush({ force: true });
    expect(calls.length).toBe(1);
    expect(JSON.parse(calls[0].batch).length).toBe(2);
    expect(store.stats().written).toBe(2);
    expect(store.pending()).toBe(0);
  });

  it('throttles flushes until the interval elapses', async () => {
    const calls = [];
    const clock = fakeClock(10_000);
    const store = createEventStore({ execute: () => { calls.push(1); }, now: clock.now, flushIntervalMs: 5_000 });

    store.record(sample());
    await store.flush({ force: true });
    store.record(sample());
    const throttled = await store.flush();
    expect(throttled.skipped).toBe('throttled');
    expect(calls.length).toBe(1);

    clock.advance(5_001);
    await store.flush();
    expect(calls.length).toBe(2);
  });

  it('flushes early once a full batch has accumulated', async () => {
    const calls = [];
    const clock = fakeClock(10_000);
    const store = createEventStore({ execute: () => { calls.push(1); }, now: clock.now, maxBatch: 3 });

    for (let i = 0; i < 3; i += 1) store.record(sample());
    await store.flush();
    expect(calls.length).toBe(1);
  });

  it('returns a failed batch to the buffer instead of losing it', async () => {
    let attempt = 0;
    const clock = fakeClock();
    const store = createEventStore({
      execute: () => { attempt += 1; if (attempt === 1) throw new Error('connection refused'); },
      now: clock.now,
    });

    store.record(sample());
    const failed = await store.flush({ force: true });
    expect(failed.written).toBe(0);
    expect(store.pending()).toBe(1);
    expect(store.stats().failedFlushes).toBe(1);

    const retried = await store.flush({ force: true });
    expect(retried.written).toBe(1);
    expect(store.pending()).toBe(0);
  });

  it('never throws out of record or flush when the database is down', async () => {
    const errors = [];
    const store = createEventStore({
      execute: () => { throw new Error('psql not found'); },
      onError: (error) => errors.push(error.message),
    });
    store.record(sample());
    const result = await store.flush({ force: true });
    expect(result.error).toContain('psql not found');
    expect(errors.length).toBe(1);
  });

  it('drops the oldest events rather than growing without bound', () => {
    const store = createEventStore({ execute: () => {}, maxBuffer: 3 });
    for (let i = 0; i < 5; i += 1) store.record(sample(`visit-${i}`));
    expect(store.pending()).toBe(3);
    expect(store.stats().dropped).toBe(2);
    expect(store.stats().recorded).toBe(5);
  });

  it('reports the drop count so data loss is visible rather than silent', async () => {
    const store = createEventStore({ execute: () => { throw new Error('down'); }, maxBuffer: 2, maxBatch: 2 });
    store.record(sample());
    store.record(sample());
    await store.flush({ force: true });
    store.record(sample());
    store.record(sample());
    await store.flush({ force: true });
    expect(store.stats().dropped > 0).toBe(true);
  });

  it('does nothing useful, and stays quiet, with no executor configured', async () => {
    const store = createEventStore({});
    store.record(sample());
    const result = await store.flush({ force: true });
    expect(result.skipped).toBe('no-executor');
    expect(store.pending()).toBe(1);
  });

  it('ignores a null record', () => {
    const store = createEventStore({ execute: () => {} });
    expect(store.record(null)).toBe(false);
    expect(store.pending()).toBe(0);
  });

  it('skips a flush with nothing buffered', async () => {
    const store = createEventStore({ execute: () => {} });
    expect((await store.flush({ force: true })).skipped).toBe('empty');
  });
});

describe('recovery from a synchronous executor failure', () => {
  it('keeps accepting flushes after execute throws before its first await', async () => {
    // Regression: the in-flight guard used to be cleared from inside the task,
    // which runs to completion before the guard is even assigned when execute
    // throws synchronously. The store then jammed and never wrote again.
    let attempts = 0;
    const store = createEventStore({
      execute: () => { attempts += 1; if (attempts < 3) throw new Error('psql not found'); },
    });
    store.record({ event: 'visit', at: '2026-09-07T10:00:00.000Z' });
    await store.flush({ force: true });
    await store.flush({ force: true });
    const third = await store.flush({ force: true });
    expect(attempts).toBe(3);
    expect(third.written).toBe(1);
  });
});

describe('command-line size ceiling', () => {
  function bigEvent(size) {
    return { event: 'visit', properties: { blob: 'x'.repeat(size) }, from: {}, path: '/app', at: '2026-09-07T10:00:00.000Z' };
  }

  it('splits a batch that would exceed one argv entry', async () => {
    // Linux caps a single argv entry at 128 KiB and fails with E2BIG rather
    // than truncating, so an oversized batch would be retried forever.
    const sizes = [];
    const store = createEventStore({
      execute: (_sql, vars) => { sizes.push(Buffer.byteLength(vars.batch, 'utf8')); },
      maxBatchBytes: 4_000,
      maxBatch: 100,
    });
    for (let i = 0; i < 10; i += 1) store.record(bigEvent(1_000));

    while (store.pending() > 0) await store.flush({ force: true });

    expect(sizes.length > 1).toBe(true);
    for (const size of sizes) expect(size <= 4_200).toBe(true);
    expect(store.stats().written).toBe(10);
  });

  it('still sends a single event that is larger than the budget', async () => {
    const store = createEventStore({ execute: () => {}, maxBatchBytes: 100 });
    store.record(bigEvent(5_000));
    const result = await store.flush({ force: true });
    expect(result.written).toBe(1);
    expect(store.pending()).toBe(0);
  });

  it('keeps every event across repeated size-bounded flushes', async () => {
    const seen = [];
    const store = createEventStore({
      execute: (_sql, vars) => { for (const e of JSON.parse(vars.batch)) seen.push(e.properties.n); },
      maxBatchBytes: 800,
    });
    for (let i = 0; i < 25; i += 1) store.record({ event: 'visit', properties: { n: i }, from: {}, path: '/app', at: '2026-09-07T10:00:00.000Z' });
    while (store.pending() > 0) await store.flush({ force: true });
    expect(seen).toEqual([...Array(25).keys()]);
  });
});
