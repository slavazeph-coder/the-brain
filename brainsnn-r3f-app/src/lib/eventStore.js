// Durable analytics.
//
// WHY THIS EXISTS
//
// analytics.js maintains a 112-name event allowlist, strips pasted content,
// and delivers over sendBeacon so events survive a page close. /api/events then
// console.logged the result and returned 204. Nothing was stored. The product
// has shipped a hundred catalogued layers with no way to answer "did anyone use
// the last one", and when you cannot see which features get used, every feature
// looks equally justified — which is how a scan tool ends up with a soliton
// panel competing with the recommendation.
//
// DESIGN
//
// Pure logic here with an injected executor and clock; thin wiring in
// server.ts. This mirrors rateLimit.js and routeMeta.js, and for the same
// reason: no test in this repo executes server.ts, so logic that must be
// correct lives in a module that tests can reach.
//
// Three rules:
//
//  1. Recording must never fail a request. /api/events answers a beacon; a
//     database hiccup is not the browser's problem. Every error path here ends
//     in a counter, not a throw.
//  2. Writes are batched. One INSERT per pageview would put a psql process
//     behind every click.
//  3. The buffer is bounded. If the database is unreachable, events are dropped
//     with a count rather than growing until the process dies — and the count
//     is reported, so "we lost data" is visible instead of silent.

export const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
export const DEFAULT_MAX_BATCH = 100;
export const DEFAULT_MAX_BUFFER = 1_000;

// The batch travels as a single psql `-v` argument, and Linux caps ONE argv
// entry at MAX_ARG_STRLEN (128 KiB) regardless of how much total room argv has.
// Going over does not truncate — execve fails with E2BIG, which this store
// would read as a failed flush, return the batch to the buffer, and retry
// forever on a batch that can never fit. Half the ceiling leaves room for the
// rest of the command line and for JSON escaping that inflates the payload.
export const DEFAULT_MAX_BATCH_BYTES = 64 * 1024;

/**
 * Build the batch insert. The whole batch travels as one JSON string in a psql
 * variable and is expanded server-side, so the number of rows never changes the
 * shape of the statement and no value is ever concatenated into SQL text.
 */
export function buildInsertStatement(records) {
  return {
    sql: `
      INSERT INTO brainsnn_events (event, properties, attribution, path, occurred_at)
      SELECT
        entry->>'event',
        COALESCE(entry->'properties', '{}'::jsonb),
        COALESCE(entry->'from', '{}'::jsonb),
        entry->>'path',
        (entry->>'at')::timestamptz
      FROM jsonb_array_elements(:'batch'::jsonb) AS entry;
    `,
    variables: { batch: JSON.stringify(records) },
  };
}

/**
 * @param {object} [options]
 * @param {(sql: string, variables: Record<string, string>) => (void | Promise<void>)} [options.execute]
 *   Runs one statement. Omit it and the store buffers but never writes, which
 *   is what happens locally with no DATABASE_URL set.
 * @param {() => number} [options.now]
 * @param {number} [options.flushIntervalMs]
 * @param {number} [options.maxBatch]
 * @param {number} [options.maxBatchBytes]
 * @param {number} [options.maxBuffer]
 * @param {(error: any) => void} [options.onError]
 */
export function createEventStore({
  execute = undefined,
  now = () => Date.now(),
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  maxBatch = DEFAULT_MAX_BATCH,
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES,
  maxBuffer = DEFAULT_MAX_BUFFER,
  // Named parameter, not `() => {}`: the inferred type of a zero-arg default
  // rejects any caller that actually wants to see the error.
  onError = (_error) => {},
} = {}) {
  const buffer = [];
  const stats = { recorded: 0, written: 0, dropped: 0, failedFlushes: 0 };
  let lastFlushAt = 0;
  let inFlight = null;

  function record(entry) {
    if (!entry) return false;
    stats.recorded += 1;
    if (buffer.length >= maxBuffer) {
      // Drop the oldest: a backlog of stale events is less useful than the
      // ones describing what is happening right now.
      buffer.shift();
      stats.dropped += 1;
    }
    buffer.push(entry);
    return true;
  }

  /**
   * How many buffered events fit in one command line. Always at least one: a
   * single event that somehow exceeds the budget still has to go out, or it
   * would block every event behind it forever.
   */
  function takeCount() {
    let bytes = 2; // the enclosing [] of the JSON array
    for (let index = 0; index < Math.min(buffer.length, maxBatch); index += 1) {
      bytes += Buffer.byteLength(JSON.stringify(buffer[index]), 'utf8') + 1;
      if (bytes > maxBatchBytes) return Math.max(1, index);
    }
    return Math.min(buffer.length, maxBatch);
  }

  async function flush({ force = false } = {}) {
    if (inFlight) return inFlight;
    if (!buffer.length) return { written: 0, skipped: 'empty' };
    if (!force && now() - lastFlushAt < flushIntervalMs && buffer.length < maxBatch) {
      return { written: 0, skipped: 'throttled' };
    }
    if (typeof execute !== 'function') return { written: 0, skipped: 'no-executor' };

    const batch = buffer.splice(0, takeCount());
    lastFlushAt = now();
    const { sql, variables } = buildInsertStatement(batch);

    // The task must be assigned to `inFlight` from OUT here, not cleared from a
    // `finally` inside it. An `execute` that throws synchronously (psql missing,
    // for one) runs the whole body — finally included — before the assignment
    // below completes, so a self-clearing task would leave a settled promise
    // parked in `inFlight` forever and jam every later flush.
    const task = (async () => {
      try {
        await execute(sql, variables);
        stats.written += batch.length;
        return { written: batch.length };
      } catch (error) {
        stats.failedFlushes += 1;
        // Put the batch back at the front so a transient outage does not lose
        // it — but only up to the buffer ceiling, which still applies.
        const room = Math.max(0, maxBuffer - buffer.length);
        const returned = batch.slice(0, room);
        stats.dropped += batch.length - returned.length;
        buffer.unshift(...returned);
        onError(error);
        return { written: 0, error: error?.message || String(error) };
      }
    })();

    inFlight = task;
    try {
      return await task;
    } finally {
      if (inFlight === task) inFlight = null;
    }
  }

  return {
    record,
    flush,
    pending: () => buffer.length,
    stats: () => ({ ...stats, pending: buffer.length }),
  };
}
