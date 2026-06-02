/**
 * Layer 49b — Manipulation Log
 *
 * Auto-logs the per-signal breakdown of every Firewall scan to localStorage so
 * scans COMPOUND into a personal profile instead of being scored-and-forgotten.
 *
 * Distinct from:
 *   - receipt.js   (rolling display log, cap 20, no signal breakdown)
 *   - scanArchive  (user-starred scans only)
 *
 * Powers the "Your week in manipulation" card — the retention hook.
 * Local-only, privacy-preserving: it stores signal *counts* and pressure, not
 * the scanned text.
 */

const KEY = "brainsnn_maniplog_v1";
const MAX_ENTRIES = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_MS = 35 * DAY_MS; // keep ~5 weeks so week-over-week deltas work

const CAT_LABELS = {
  urgency: "Urgency",
  outrage: "Outrage",
  certainty: "Certainty theater",
  fear: "Fear",
};

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(list) {
  try {
    const cutoff = Date.now() - PRUNE_MS;
    const pruned = list
      .filter((e) => (e.ts || 0) >= cutoff)
      .slice(-MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(pruned));
  } catch {
    /* quota — drop silently */
  }
}

/**
 * Record one scan. Stores signal counts + pressure only (never the text).
 */
export function logScan({ score, ts = Date.now() } = {}) {
  if (!score) return null;
  const pressure =
    ((score.emotionalActivation || 0) +
      (score.cognitiveSuppression || 0) +
      (score.manipulationPressure || 0)) /
    3;
  const sig = { urgency: 0, outrage: 0, certainty: 0, fear: 0 };
  (score.signals || []).forEach((s) => {
    if (s && s.category in sig) sig[s.category] = s.count || 0;
  });
  const entry = {
    ts,
    pressure: +pressure.toFixed(3),
    sig,
    tpl: (score.templates || [])
      .map((t) => t.label || t.id || t)
      .filter(Boolean)
      .slice(0, 3),
  };
  write([...read(), entry]);
  return entry;
}

function sumSignals(rows) {
  return rows.reduce(
    (acc, e) => {
      for (const k of Object.keys(CAT_LABELS)) {
        acc[k] += (e.sig && e.sig[k]) || 0;
      }
      return acc;
    },
    { urgency: 0, outrage: 0, certainty: 0, fear: 0 },
  );
}

function dailyPressureSpark(all, now) {
  // 7 daily buckets, oldest → today, each = mean pressure that day (0 if none).
  const buckets = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  all.forEach((e) => {
    const age = now - (e.ts || 0);
    if (age < 0 || age >= 7 * DAY_MS) return;
    const idx = 6 - Math.floor(age / DAY_MS); // 0 = oldest, 6 = today
    if (idx >= 0 && idx < 7) {
      buckets[idx].sum += e.pressure || 0;
      buckets[idx].n += 1;
    }
  });
  return buckets.map((b) => (b.n ? +(b.sum / b.n).toFixed(3) : 0));
}

/**
 * Aggregate the last 7 days into a shareable summary, with week-over-week
 * deltas vs the prior 7 days.
 */
export function weekInManipulation(now = Date.now()) {
  const all = read();
  const weekAgo = now - 7 * DAY_MS;
  const priorWeekAgo = now - 14 * DAY_MS;

  const week = all.filter((e) => (e.ts || 0) >= weekAgo);
  const prior = all.filter(
    (e) => (e.ts || 0) >= priorWeekAgo && (e.ts || 0) < weekAgo,
  );

  const sig = sumSignals(week);
  const totalHits = Object.values(sig).reduce((a, b) => a + b, 0);
  const ranked = Object.entries(sig)
    .map(([category, count]) => ({
      category,
      label: CAT_LABELS[category],
      count,
    }))
    .sort((a, b) => b.count - a.count);
  const maxCount = ranked.length ? ranked[0].count : 0;
  const top = ranked.find((r) => r.count > 0) || null;

  const meanPressure = week.length
    ? week.reduce((a, e) => a + (e.pressure || 0), 0) / week.length
    : 0;
  const priorMean = prior.length
    ? prior.reduce((a, e) => a + (e.pressure || 0), 0) / prior.length
    : 0;
  const pressureDelta = prior.length ? meanPressure - priorMean : 0;

  const peak = week.reduce(
    (best, e) => (e.pressure > (best?.pressure || 0) ? e : best),
    null,
  );

  return {
    scans: week.length,
    priorScans: prior.length,
    totalHits,
    signals: ranked,
    maxCount,
    top,
    meanPressure: +meanPressure.toFixed(3),
    priorMean: +priorMean.toFixed(3),
    pressureDelta: +pressureDelta.toFixed(3),
    peakPressure: peak ? peak.pressure : 0,
    spark: dailyPressureSpark(all, now),
  };
}

export function manipulationLogCount() {
  return read().length;
}

export function clearManipulationLog() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
