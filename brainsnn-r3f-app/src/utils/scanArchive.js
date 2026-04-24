/**
 * Layer 84 — Scan Archive
 *
 * Starred scans — a user-curated set distinct from the rolling receipt
 * log (which caps at 20 and evicts). Archive entries hold the full
 * excerpt + the key score fields so they can be browsed, searched,
 * and exported without touching Context Memory.
 */

const STORAGE_KEY = 'brainsnn_archive_v1';
const MAX_ENTRIES = 200;

function read() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_ENTRIES))); } catch { /* quota */ }
}

export function listArchive() { return read(); }

export function archiveScan({ text, score, receipt, tags = [], entity = '' }) {
  const existing = read();
  const excerpt = String(text || '').slice(0, 400);
  const pressure =
    (((score?.emotionalActivation || 0) + (score?.cognitiveSuppression || 0) + (score?.manipulationPressure || 0)) / 3);
  const entry = {
    id: receipt?.id || `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    excerpt,
    pressure: +pressure.toFixed(3),
    templates: (score?.templates || []).map((t) => t.id || t.label || t).slice(0, 5),
    language: score?.language || 'en',
    tags: (tags || []).filter(Boolean).slice(0, 6),
    entity: String(entity || '').slice(0, 48),
  };
  write([entry, ...existing.filter((e) => e.id !== entry.id)]);
  return entry;
}

export function removeFromArchive(id) {
  write(read().filter((e) => e.id !== id));
}

export function clearArchive() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export function searchArchive(query = '') {
  const q = String(query || '').trim().toLowerCase();
  const all = read();
  if (!q) return all;
  return all.filter((e) =>
    e.excerpt.toLowerCase().includes(q)
    || e.entity.toLowerCase().includes(q)
    || (e.tags || []).some((t) => String(t).toLowerCase().includes(q))
    || (e.templates || []).some((t) => String(t).toLowerCase().includes(q))
    || e.language.toLowerCase() === q,
  );
}

export function exportArchiveJson() {
  return JSON.stringify({ brainsnn: 'archive-v1', entries: read(), exportedAt: new Date().toISOString() }, null, 2);
}

export function exportArchiveCsv() {
  const rows = read();
  const header = 'ts,pressure,language,entity,templates,tags,excerpt';
  const escape = (s) => {
    const str = String(s ?? '').replace(/"/g, '""');
    return `"${str}"`;
  };
  const lines = rows.map((r) =>
    [r.ts, r.pressure, r.language, r.entity, (r.templates || []).join(';'), (r.tags || []).join(';'), r.excerpt]
      .map(escape).join(','),
  );
  return [header, ...lines].join('\n');
}
