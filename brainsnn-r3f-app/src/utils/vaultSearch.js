/**
 * Fuzzy + prefix search over a vault.
 *
 * The contract:
 *   searchVault(notes, query, opts) → ranked array of
 *     { note, score, matches: { title?, body?, tag? } }
 *
 * Score model (higher = better):
 *   - title prefix exact:        +100
 *   - title contains:            +50
 *   - tag exact:                 +40
 *   - body word match (1+):      +5 per match, capped at 25
 *   - subsequence in title:      +20
 *
 * Cheap, deterministic, no external deps. Designed for vaults of a few
 * thousand notes — well within hot-path budget on a modern device.
 */

import { extractTags } from './vaultMarkdown.js';

function normalize(s) {
  return String(s || '').toLowerCase();
}

function isSubsequence(needle, haystack) {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

/**
 * Score a single note against a normalized query. Returns { score, matches }.
 */
function scoreNote(note, q) {
  const title = normalize(note.title);
  const body = normalize(note.body);
  const explicitTags = (note.tags || []).map(normalize);
  const bodyTags = extractTags(note.body || '').map(normalize);
  const tags = new Set([...explicitTags, ...bodyTags]);

  let score = 0;
  const matches = {};

  if (title === q) {
    score += 200;
    matches.title = 'exact';
  } else if (title.startsWith(q)) {
    score += 100;
    matches.title = 'prefix';
  } else if (title.includes(q)) {
    score += 50;
    matches.title = 'contains';
  } else if (isSubsequence(q, title)) {
    score += 20;
    matches.title = 'subsequence';
  }

  for (const t of tags) {
    if (t === q || t === q.replace(/^#/, '')) {
      score += 40;
      matches.tag = t;
      break;
    }
  }

  if (body) {
    let bodyHits = 0;
    let pos = 0;
    while (pos !== -1 && bodyHits < 5) {
      pos = body.indexOf(q, pos);
      if (pos !== -1) {
        bodyHits += 1;
        pos += q.length;
      }
    }
    if (bodyHits) {
      score += Math.min(25, bodyHits * 5);
      matches.body = bodyHits;
    }
  }

  return { score, matches };
}

/**
 * Search a vault. Notes can be a list of {id, title, body, tags} or
 * an iterable returning the same shape.
 *
 * Options:
 *   - limit: max results (default 25)
 *   - minScore: drop matches below this (default 1)
 */
export function searchVault(notes, query, { limit = 25, minScore = 1 } = {}) {
  const q = normalize(query);
  if (!q) return [];

  const out = [];
  for (const note of notes) {
    const { score, matches } = scoreNote(note, q);
    if (score >= minScore) out.push({ note, score, matches });
  }
  out.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
  return out.slice(0, limit);
}

/**
 * Title autocomplete: cheap prefix + subsequence match against titles
 * only. Returns up to `limit` { id, title } entries.
 */
export function autocompleteTitles(notes, query, { limit = 8 } = {}) {
  const q = normalize(query);
  if (!q) return [];
  const out = [];
  for (const note of notes) {
    const t = normalize(note.title);
    let s = 0;
    if (t === q) s = 100;
    else if (t.startsWith(q)) s = 80;
    else if (t.includes(q)) s = 50;
    else if (isSubsequence(q, t)) s = 20;
    if (s) out.push({ note, score: s });
  }
  out.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
  return out.slice(0, limit).map(({ note }) => ({ id: note.id, title: note.title }));
}
