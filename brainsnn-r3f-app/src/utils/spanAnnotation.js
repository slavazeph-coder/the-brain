/**
 * Layer 105 — Span Annotation
 *
 * The harness diagnostic gets sharper when humans label spans:
 * "this scan was a false positive", "this rule fired on benign text",
 * "this MCP call was a real bug". Annotations get folded into the
 * lift miner so user feedback shows up in the next report.
 *
 * Storage: keyed by span_id → annotation. Capped, persisted in
 * localStorage. Annotated spans are pulled into runDiagnostic() as
 * extra signal (e.g. an "fp-marked" attribute).
 *
 * Annotation labels (defaults):
 *   - false-positive  : the span result was wrong (over-fired)
 *   - false-negative  : missed something real
 *   - real-bug        : confirmed actual bug
 *   - benign          : looked bad but was fine
 *   - investigate     : todo for the operator
 *
 * Custom labels are allowed; they're stored verbatim.
 */

const STORE_KEY = 'brainsnn_span_annotations_v1';
const MAX_ANNOTATIONS = 200;

export const STANDARD_LABELS = [
  { id: 'false-positive', tone: '#fdab43', desc: 'Over-fired — score should have been lower' },
  { id: 'false-negative', tone: '#dd6974', desc: 'Missed something — score should have been higher' },
  { id: 'real-bug', tone: '#dd6974', desc: 'Confirmed an actual bug in the harness' },
  { id: 'benign', tone: '#5ee69a', desc: 'Looked alarming but was fine' },
  { id: 'investigate', tone: '#7a8fe7', desc: 'Worth a closer look later' },
];

export function listAnnotations() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch { return {}; }
}

function persist(map) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch { /* noop */ }
}

export function annotate({ spanId, label, note }) {
  if (!spanId || !label) return;
  const map = listAnnotations();
  map[spanId] = {
    spanId,
    label,
    note: (note || '').slice(0, 200),
    ts: Date.now(),
  };
  // Cap entries by recency
  const entries = Object.values(map).sort((a, b) => b.ts - a.ts).slice(0, MAX_ANNOTATIONS);
  const trimmed = Object.fromEntries(entries.map((e) => [e.spanId, e]));
  persist(trimmed);
  return trimmed[spanId];
}

export function unannotate(spanId) {
  const map = listAnnotations();
  delete map[spanId];
  persist(map);
}

export function getAnnotation(spanId) {
  return listAnnotations()[spanId] || null;
}

export function clearAnnotations() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* noop */ }
}

/**
 * Decorate a span buffer with `attributes._annotation` so the lift
 * miner and detectors can use them.
 */
export function decorateSpansWithAnnotations(spans) {
  const map = listAnnotations();
  return spans.map((s) => {
    const a = map[s.span_id];
    if (!a) return s;
    return {
      ...s,
      attributes: { ...s.attributes, _annotation: a.label },
    };
  });
}

/**
 * Aggregate annotations into a small report — counts per label +
 * recent entries. Cheap input for the diagnostic UI.
 */
export function annotationStats() {
  const map = listAnnotations();
  const byLabel = new Map();
  for (const a of Object.values(map)) {
    byLabel.set(a.label, (byLabel.get(a.label) || 0) + 1);
  }
  const totals = [...byLabel.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((x, y) => y.count - x.count);
  const recent = Object.values(map).sort((a, b) => b.ts - a.ts).slice(0, 12);
  return { totals, recent, count: Object.keys(map).length };
}
