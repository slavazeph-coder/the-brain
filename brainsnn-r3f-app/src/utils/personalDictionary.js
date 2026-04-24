/**
 * Layer 90 — Personal Dictionary
 *
 * User-curated phrases that THEY have experienced as manipulative in
 * their own life — a specific line an ex used, a phrase their boss
 * reaches for, a family member's guilt-trip opener. Each phrase gets
 * a personal weight; matches surface on every scan.
 *
 * Distinct from Layer 55 custom rules (regex per category). Layer 90
 * entries are literal-or-approximate strings with personal notes,
 * because users think in examples, not in regex.
 */

const STORAGE_KEY = 'brainsnn_personal_dict_v1';
const MAX_ENTRIES = 120;

function read() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES))); } catch { /* quota */ }
}

export function listEntries() { return read(); }

export function addEntry({ phrase, note = '', weight = 0.5, tag = '' }) {
  const clean = String(phrase || '').trim();
  if (clean.length < 2) throw new Error('phrase must be at least 2 chars');
  const entry = {
    id: `pd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    phrase: clean.slice(0, 200),
    note: String(note || '').slice(0, 200),
    weight: Math.max(0, Math.min(1, Number(weight) || 0.5)),
    tag: String(tag || '').slice(0, 24),
    ts: Date.now(),
    hits: 0,
  };
  const list = read();
  write([entry, ...list]);
  return entry;
}

export function removeEntry(id) {
  const list = read().filter((e) => e.id !== id);
  write(list);
}

export function clearAll() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export function bumpHit(id) {
  const list = read();
  const idx = list.findIndex((e) => e.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], hits: (list[idx].hits || 0) + 1 };
  write(list);
}

/**
 * Scan a text against the personal dictionary. Returns all matches
 * with their per-entry weight contribution, plus a combined
 * `personalPressure` (0–1) that the Firewall panel can layer on top
 * of the base score.
 */
export function scanPersonal(text = '') {
  const t = String(text || '').toLowerCase();
  if (t.length < 4) return { matches: [], personalPressure: 0 };
  const entries = read();
  const matches = [];
  let sum = 0;
  for (const e of entries) {
    const needle = e.phrase.toLowerCase();
    if (!needle) continue;
    // Approximate match: word-boundary if the phrase is a single
    // word, substring otherwise.
    let hits = 0;
    if (/^\s*\S+\s*$/.test(needle)) {
      const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      hits = (t.match(re) || []).length;
    } else if (t.includes(needle)) {
      hits = 1;
    }
    if (hits > 0) {
      const contribution = Math.min(1, hits * e.weight);
      sum += contribution;
      matches.push({
        id: e.id,
        phrase: e.phrase,
        note: e.note,
        weight: e.weight,
        hits,
        tag: e.tag,
        contribution: +contribution.toFixed(3),
      });
    }
  }
  const personalPressure = Math.min(1, sum / 2.5);
  return { matches, personalPressure: +personalPressure.toFixed(3) };
}
