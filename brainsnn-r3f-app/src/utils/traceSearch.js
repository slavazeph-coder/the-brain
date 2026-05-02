/**
 * Layer 112 — Trace Search
 *
 * Mini query language over the span buffer:
 *
 *   name=firewall.scan status=ok duration>200 lang=en
 *   tool=get_brain_state status=error
 *   "act now" name=firewall.scan
 *
 * Operators: =, !=, >, <, >=, <=. Bare tokens become free-text matches
 * over `name` + JSON-stringified attributes.
 *
 * Pure parser + filter — no I/O.
 */

import { recentSpans } from './telemetry.js';

const TOKEN_RE = /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g;
const OP_RE = /^([\w_.]+)(>=|<=|!=|>|<|=)(.*)$/;

const FIELD_GETTERS = {
  name: (s) => s.name,
  status: (s) => s.status?.code,
  duration: (s) => s.duration_ms,
  duration_ms: (s) => s.duration_ms,
  trace_id: (s) => s.trace_id,
  span_id: (s) => s.span_id,
  kind: (s) => s.kind,
};

function getField(s, field) {
  if (FIELD_GETTERS[field]) return FIELD_GETTERS[field](s);
  return s.attributes?.[field];
}

function compare(a, op, b) {
  if (op === '=' || op === '!=') {
    const ok = String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
    return op === '=' ? ok : !ok;
  }
  const an = Number(a);
  const bn = Number(b);
  if (Number.isNaN(an) || Number.isNaN(bn)) {
    return false;
  }
  switch (op) {
    case '>': return an > bn;
    case '<': return an < bn;
    case '>=': return an >= bn;
    case '<=': return an <= bn;
    default: return false;
  }
}

export function parseQuery(q) {
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(String(q || '')))) {
    tokens.push(m[1] || m[2] || m[3]);
  }
  const clauses = [];
  for (const t of tokens) {
    const op = OP_RE.exec(t);
    if (op) {
      clauses.push({ kind: 'op', field: op[1], op: op[2], value: op[3] });
    } else {
      clauses.push({ kind: 'text', value: t });
    }
  }
  return clauses;
}

export function matches(span, clauses) {
  for (const c of clauses) {
    if (c.kind === 'op') {
      const v = getField(span, c.field);
      if (!compare(v, c.op, c.value)) return false;
    } else {
      const blob = `${span.name} ${JSON.stringify(span.attributes || {})}`.toLowerCase();
      if (!blob.includes(c.value.toLowerCase())) return false;
    }
  }
  return true;
}

export function searchSpans(query, spans = recentSpans(500), { limit = 100 } = {}) {
  if (!query || !query.trim()) return spans.slice(0, limit);
  const clauses = parseQuery(query);
  const out = [];
  for (const s of spans) {
    if (matches(s, clauses)) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
