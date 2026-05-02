/**
 * Layer 102 (foundation) — Telemetry / OpenTelemetry-shaped spans
 *
 * One unified trace buffer for every layer that wants to be observable.
 * Schema borrows OpenTelemetry span fields directly so traces can later
 * be exported into any OTel-compatible analyzer (this is what HALO uses
 * for its harness-optimization loop in context-labs/halo).
 *
 *   {
 *     trace_id, span_id, parent_span_id,
 *     name, kind, start_time, end_time, duration_ms,
 *     status: { code: 'ok' | 'error', message? },
 *     attributes: { ... },
 *     events: [{ name, time, attributes }]
 *   }
 *
 * Storage:
 *   - in-memory ring buffer of MAX_SPANS most recent ended spans
 *   - localStorage mirror, throttled, so the buffer survives reload
 *   - subscribers fire on every recorded span so panels can react live
 *
 * Usage:
 *   const span = startSpan('firewall.scan', { attributes: { lang: 'en' } });
 *   …work…
 *   endSpan(span, { status: { code: 'ok' }, attributes: { pressure } });
 *
 *   // Or one-shot:
 *   recordSpan({ name: 'mcp.tool', attributes: { tool: 'get_state' }, status });
 */

const STORAGE_KEY = 'brainsnn_telemetry_spans_v1';
const MAX_SPANS = 500;
const PERSIST_DEBOUNCE_MS = 500;

let _spans = loadFromStorage();
const _subscribers = new Set();
let _persistTimer = null;
let _enabled = true;

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SPANS) : [];
  } catch { return []; }
}

function schedulePersist() {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_spans)); }
    catch { /* quota — buffer keeps working in memory */ }
  }, PERSIST_DEBOUNCE_MS);
}

function emit(span) {
  for (const fn of _subscribers) {
    try { fn(span); } catch { /* swallow subscriber errors */ }
  }
}

function rngHex(bytes) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let out = '';
  for (let i = 0; i < bytes * 2; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function newTraceId() { return rngHex(8); }
function newSpanId() { return rngHex(4); }

/**
 * Start an open span. Returns a handle — pass it to endSpan when done.
 * If `parent` is supplied, inherits its trace_id and links via parent_span_id.
 */
export function startSpan(name, { kind = 'internal', attributes = {}, parent = null } = {}) {
  const trace_id = parent?.trace_id || newTraceId();
  const span_id = newSpanId();
  return {
    trace_id,
    span_id,
    parent_span_id: parent?.span_id || null,
    name: String(name || 'unnamed'),
    kind,
    start_time: Date.now(),
    end_time: null,
    duration_ms: null,
    status: { code: 'unset' },
    attributes: { ...attributes },
    events: [],
  };
}

/**
 * Add an event to an open span (analogous to OTel span events).
 */
export function addEvent(span, name, attributes = {}) {
  if (!span) return;
  span.events.push({ name: String(name), time: Date.now(), attributes });
}

/**
 * Close a span and record it into the buffer.
 */
export function endSpan(span, { status, attributes, events } = {}) {
  if (!span || span.end_time != null) return;
  span.end_time = Date.now();
  span.duration_ms = span.end_time - span.start_time;
  if (status) span.status = status;
  else if (span.status.code === 'unset') span.status = { code: 'ok' };
  if (attributes) Object.assign(span.attributes, attributes);
  if (events) span.events.push(...events);
  recordSpan(span);
}

/**
 * Record a fully-formed span (one-shot path; bypasses startSpan/endSpan).
 */
export function recordSpan(span) {
  if (!_enabled || !span) return;
  if (!span.trace_id) span.trace_id = newTraceId();
  if (!span.span_id) span.span_id = newSpanId();
  if (span.end_time == null) span.end_time = Date.now();
  if (span.duration_ms == null) {
    span.duration_ms = span.end_time - (span.start_time || span.end_time);
  }
  if (!span.status) span.status = { code: 'ok' };
  _spans.unshift(span);
  if (_spans.length > MAX_SPANS) _spans.length = MAX_SPANS;
  schedulePersist();
  emit(span);
}

/**
 * Convenience: instrument a sync or async fn so its return-value /
 * exception is captured as a span.
 */
export async function withSpan(name, fn, options = {}) {
  const span = startSpan(name, options);
  try {
    const result = await fn(span);
    endSpan(span, { status: { code: 'ok' } });
    return result;
  } catch (err) {
    endSpan(span, {
      status: { code: 'error', message: String(err?.message || err) },
      attributes: { 'exception.type': err?.name || 'Error' },
    });
    throw err;
  }
}

/* ------------------------------ readers ------------------------------ */

export function recentSpans(limit = MAX_SPANS) {
  return _spans.slice(0, Math.max(0, limit));
}

export function spanCount() { return _spans.length; }

export function clearSpans() {
  _spans = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  emit({ name: '_cleared', span_id: '0', trace_id: '0', start_time: Date.now(), end_time: Date.now(), duration_ms: 0, status: { code: 'ok' }, attributes: {}, events: [] });
}

export function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

export function setEnabled(v) { _enabled = !!v; }
export function isEnabled() { return _enabled; }

/**
 * Export the buffer as a portable JSON envelope.
 */
export function exportSpans() {
  return {
    brainsnn: 'telemetry-v1',
    exportedAt: new Date().toISOString(),
    spanCount: _spans.length,
    spans: _spans,
  };
}

/**
 * Group spans by name → { name, count, errorCount, p50, p95, lastTs }.
 * Cheap aggregation for diagnostic panels.
 */
export function aggregateByName(spans = _spans) {
  const buckets = new Map();
  for (const s of spans) {
    const b = buckets.get(s.name) || {
      name: s.name, count: 0, errorCount: 0, durations: [], lastTs: 0,
    };
    b.count += 1;
    if (s.status?.code === 'error') b.errorCount += 1;
    if (typeof s.duration_ms === 'number') b.durations.push(s.duration_ms);
    b.lastTs = Math.max(b.lastTs, s.end_time || s.start_time || 0);
    buckets.set(s.name, b);
  }
  const out = [];
  for (const b of buckets.values()) {
    const sorted = b.durations.slice().sort((x, y) => x - y);
    const p = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
    out.push({
      name: b.name,
      count: b.count,
      errorCount: b.errorCount,
      errorRate: b.count ? b.errorCount / b.count : 0,
      p50: p(0.5),
      p95: p(0.95),
      lastTs: b.lastTs,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
