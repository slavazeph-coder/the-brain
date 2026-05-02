/**
 * Layer 107 — OTLP HTTP Exporter
 *
 * Push the unified span buffer (Layer 102) to any OpenTelemetry
 * collector that speaks OTLP-HTTP/JSON. Lets BrainSNN telemetry
 * land in Honeycomb, Grafana Tempo, Datadog, Jaeger via the OTel
 * collector — same shape HALO uses upstream.
 *
 * Conversion: our internal span format already mirrors OTel; this
 * module just maps field names + envelopes them as a ResourceSpans
 * payload. Time fields go to nanoseconds.
 *
 * No side-effects unless explicitly invoked. The endpoint URL +
 * optional auth header live in localStorage so users can flip
 * collectors without recompiling.
 *
 * Gated by user opt-in: nothing leaves the device until enableExport()
 * is called and an endpoint is set.
 */

import { recentSpans } from './telemetry.js';
import { sanitizeSpans } from './telemetrySanitizer.js';

const CONFIG_KEY = 'brainsnn_otlp_config_v1';
const RESULTS_KEY = 'brainsnn_otlp_results_v1';
const MAX_RESULTS = 20;

const DEFAULT_CONFIG = {
  enabled: false,
  endpoint: '',
  authHeader: '',
  serviceName: 'brainsnn',
  batchSize: 100,
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveConfig(partial) {
  const next = { ...loadConfig(), ...partial };
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); } catch { /* noop */ }
  return next;
}

export function exportResults() {
  try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); }
  catch { return []; }
}

function logResult(entry) {
  try {
    const next = [entry, ...exportResults()].slice(0, MAX_RESULTS);
    localStorage.setItem(RESULTS_KEY, JSON.stringify(next));
  } catch { /* noop */ }
}

/* ------------------------------ mapping ------------------------------ */

function attrToOtlp(attributes = {}) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: typeAttrValue(value),
  }));
}

function typeAttrValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(typeAttrValue) } };
  return { stringValue: String(v) };
}

const STATUS_CODE = { ok: 1, error: 2, unset: 0 };

function spanToOtlp(span) {
  return {
    traceId: padHex(span.trace_id, 32),
    spanId: padHex(span.span_id, 16),
    parentSpanId: span.parent_span_id ? padHex(span.parent_span_id, 16) : '',
    name: span.name,
    kind: kindFor(span.kind),
    startTimeUnixNano: msToNano(span.start_time),
    endTimeUnixNano: msToNano(span.end_time ?? span.start_time),
    attributes: attrToOtlp(span.attributes),
    events: (span.events || []).map((e) => ({
      timeUnixNano: msToNano(e.time),
      name: e.name,
      attributes: attrToOtlp(e.attributes),
    })),
    status: {
      code: STATUS_CODE[span.status?.code] ?? 0,
      message: span.status?.message || '',
    },
  };
}

function padHex(s, len) {
  const t = String(s || '').padStart(len, '0');
  return t.length === len ? t : t.slice(-len);
}

function msToNano(ms) {
  if (ms == null) return '0';
  return String(Math.floor(ms) * 1_000_000);
}

function kindFor(k) {
  // 1=internal, 2=server, 3=client, 4=producer, 5=consumer, 0=unspecified
  return ({ internal: 1, server: 2, client: 3, producer: 4, consumer: 5 })[k] ?? 0;
}

export function buildPayload({ spans, serviceName }) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName || 'brainsnn' } },
            { key: 'telemetry.sdk.language', value: { stringValue: 'javascript' } },
            { key: 'telemetry.sdk.name', value: { stringValue: 'brainsnn-layer-107' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'brainsnn.harness', version: '1.0.0' },
            spans: spans.map(spanToOtlp),
          },
        ],
      },
    ],
  };
}

/* ------------------------------- send -------------------------------- */

export async function exportSpansOnce({ spans, dryRun = false } = {}) {
  const cfg = loadConfig();
  if (!cfg.enabled && !dryRun) {
    return { ok: false, reason: 'disabled' };
  }
  if (!cfg.endpoint && !dryRun) {
    return { ok: false, reason: 'no-endpoint' };
  }

  const buffer = spans || recentSpans(cfg.batchSize);
  if (buffer.length === 0) return { ok: false, reason: 'empty-buffer' };

  // Layer 108 — always sanitize before egress
  const slice = sanitizeSpans(buffer.slice(0, cfg.batchSize));
  const payload = buildPayload({ spans: slice, serviceName: cfg.serviceName });

  if (dryRun) {
    const summary = { ts: Date.now(), count: slice.length, dryRun: true, ok: true };
    logResult(summary);
    return { ok: true, dryRun: true, payload, summary };
  }

  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.authHeader ? { authorization: cfg.authHeader } : {}),
      },
      body: JSON.stringify(payload),
    });
    const ok = res.ok;
    const summary = { ts: Date.now(), count: slice.length, ok, status: res.status };
    logResult(summary);
    return { ok, status: res.status };
  } catch (err) {
    const summary = { ts: Date.now(), count: slice.length, ok: false, error: err.message || String(err) };
    logResult(summary);
    return { ok: false, error: err.message || String(err) };
  }
}

export function clearResults() {
  try { localStorage.removeItem(RESULTS_KEY); } catch { /* noop */ }
}
