/**
 * Layer 108 — Telemetry Sanitizer
 *
 * Run span attributes through a regex-based PII redactor before they
 * leave the device (export, OTLP push, sync). Uses the standard
 * email / phone / IP / SSN-like patterns. Custom patterns are
 * persisted in localStorage so users can add domain-specific rules
 * (employee IDs, internal slugs, etc).
 *
 * Sanitization is opt-in for the buffer ("redactInPlace") but the
 * sanitized() helper is always used by export paths.
 */

const CUSTOM_KEY = 'brainsnn_sanitizer_patterns_v1';

export const STANDARD_PATTERNS = [
  { id: 'email', label: 'email', source: '[\\w.+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' },
  { id: 'phone', label: 'phone', source: '\\+?\\d[\\d\\s().-]{7,}\\d' },
  { id: 'ipv4', label: 'IPv4', source: '\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b' },
  { id: 'ssn', label: 'SSN-like', source: '\\b\\d{3}-\\d{2}-\\d{4}\\b' },
  { id: 'card', label: 'credit-card', source: '\\b(?:\\d[ -]?){13,16}\\b' },
  { id: 'token', label: 'bearer-token', source: 'Bearer\\s+[A-Za-z0-9\\-_.=]+' },
];

export function loadCustomPatterns() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch { return []; }
}

function persistCustom(list) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* noop */ }
}

export function addCustomPattern({ label, source }) {
  if (!source) throw new Error('source required');
  // Validate by attempting to compile
  try { new RegExp(source); } catch (e) { throw new Error(`invalid regex: ${e.message}`); }
  const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const list = [...loadCustomPatterns(), { id, label: (label || source).slice(0, 32), source }].slice(-40);
  persistCustom(list);
  return list;
}

export function removeCustomPattern(id) {
  persistCustom(loadCustomPatterns().filter((p) => p.id !== id));
}

export function clearCustomPatterns() {
  try { localStorage.removeItem(CUSTOM_KEY); } catch { /* noop */ }
}

function buildRegex(patterns) {
  return patterns.map((p) => {
    try { return { ...p, re: new RegExp(p.source, 'gi') }; }
    catch { return null; }
  }).filter(Boolean);
}

/**
 * Redact a single string against the active pattern list. Replaces
 * every match with `[REDACTED:label]`.
 */
export function redactString(s, patterns) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const p of patterns) {
    out = out.replace(p.re, `[REDACTED:${p.label}]`);
  }
  return out;
}

function activePatterns() {
  return buildRegex([...STANDARD_PATTERNS, ...loadCustomPatterns()]);
}

/**
 * Walk a span's attributes + events.attributes and redact every
 * string value. Numbers / bools pass through.
 */
export function sanitizeSpan(span, patterns = activePatterns()) {
  if (!span) return span;
  const cleanAttrs = (obj) => {
    if (!obj) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === 'string' ? redactString(v, patterns) : v;
    }
    return out;
  };
  return {
    ...span,
    attributes: cleanAttrs(span.attributes),
    events: (span.events || []).map((e) => ({ ...e, attributes: cleanAttrs(e.attributes) })),
    status: span.status?.message
      ? { ...span.status, message: redactString(span.status.message, patterns) }
      : span.status,
  };
}

export function sanitizeSpans(spans) {
  const patterns = activePatterns();
  return spans.map((s) => sanitizeSpan(s, patterns));
}

/**
 * Quick-check for a panel: how many of the recent spans contain
 * one or more PII matches? Useful to nudge users to enable export
 * sanitization before pushing to a collector.
 */
export function piiAuditSummary(spans) {
  const patterns = activePatterns();
  const counts = new Map();
  let flagged = 0;
  for (const s of spans) {
    let hit = false;
    const scan = (obj) => {
      for (const v of Object.values(obj || {})) {
        if (typeof v !== 'string') continue;
        for (const p of patterns) {
          if (p.re.test(v)) {
            counts.set(p.label, (counts.get(p.label) || 0) + 1);
            hit = true;
          }
          // reset because of /g flag stateful lastIndex
          p.re.lastIndex = 0;
        }
      }
    };
    scan(s.attributes);
    for (const e of s.events || []) scan(e.attributes);
    if (hit) flagged += 1;
  }
  return {
    flagged,
    total: spans.length,
    byLabel: [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };
}
