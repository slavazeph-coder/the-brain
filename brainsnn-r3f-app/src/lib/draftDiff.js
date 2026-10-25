// Sentence-level diff between the original draft and the edited one.
//
// WHY NOT A WORD DIFF
//
// The previous implementation built a Set of words from each side and marked
// any word missing from the other. That cannot see the edit this product makes
// most often: "Move the proof in front of the ask" reorders two sentences and
// changes no words at all, so both sets are identical and the diff renders
// completely unmarked. The user clicks the headline fix, looks at "What
// changed", and sees nothing changed.
//
// Patches operate on whole sentences, so the diff does too. A sentence is
// matched to its counterpart by exact text first; what is left over is paired
// by word overlap, which is what catches a phrase swap inside an otherwise
// untouched sentence.

import { locateSegments } from './draftPatch.js';

// Below this share of shared words two leftover sentences are different
// sentences, not an edit of one another. Set by the shape of the edits made
// here: a phrase swap replaces one or two words in a sentence and leaves the
// rest, so real pairs score far above this, and unrelated sentences fall well
// below it.
const PAIR_THRESHOLD = 0.5;

function words(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

function overlap(a, b) {
  const left = words(a);
  const right = new Set(words(b));
  if (!left.length || !right.size) return 0;
  const shared = left.filter((word) => right.has(word)).length;
  return shared / Math.max(left.length, right.size);
}

/**
 * Word-level marks for a matched pair, so an edited sentence shows which words
 * actually moved. Positional rather than set-based: a word repeated on one side
 * only should still be marked.
 */
function markWords(from, to) {
  const target = words(to);
  const used = new Array(target.length).fill(false);
  return String(from || '').split(/(\s+)/).filter(Boolean).map((token) => {
    if (/^\s+$/.test(token)) return { text: token, changed: false };
    const normalized = token.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
    const index = target.findIndex((word, position) => !used[position] && word === normalized);
    if (index === -1) return { text: token, changed: true };
    used[index] = true;
    return { text: token, changed: false };
  });
}

/**
 * Compare two drafts.
 *
 * Returns parallel rows for each side. Every row carries a status the UI can
 * style: `same`, `moved` (identical text, different position), `edited` (paired
 * by overlap, with per-word marks), `removed` (before only) and `added` (after
 * only).
 */
export function diffDrafts(before, after) {
  const left = locateSegments(before).map((segment, index) => ({ text: segment.text, index }));
  const right = locateSegments(after).map((segment, index) => ({ text: segment.text, index }));

  const leftStatus = left.map(() => null);
  const rightStatus = right.map(() => null);

  // Pass 1: exact text. First unused occurrence wins, so a sentence repeated
  // verbatim pairs up in order rather than every copy claiming the same match.
  for (const row of left) {
    const match = right.find((candidate) => rightStatus[candidate.index] === null && candidate.text === row.text);
    if (!match) continue;
    const moved = match.index !== row.index;
    leftStatus[row.index] = { status: moved ? 'moved' : 'same', partner: match.index };
    rightStatus[match.index] = { status: moved ? 'moved' : 'same', partner: row.index };
  }

  // Pass 2: what is left is either an edit of something or genuinely new. Take
  // the best-scoring available partner rather than the first one over the line.
  for (const row of left) {
    if (leftStatus[row.index]) continue;
    let best = null;
    for (const candidate of right) {
      if (rightStatus[candidate.index]) continue;
      const score = overlap(row.text, candidate.text);
      if (score >= PAIR_THRESHOLD && (!best || score > best.score)) best = { candidate, score };
    }
    if (!best) continue;
    leftStatus[row.index] = { status: 'edited', partner: best.candidate.index };
    rightStatus[best.candidate.index] = { status: 'edited', partner: row.index };
  }

  const beforeRows = left.map((row) => {
    const state = leftStatus[row.index] || { status: 'removed', partner: null };
    return {
      text: row.text,
      status: state.status,
      partner: state.partner,
      tokens: state.status === 'edited' ? markWords(row.text, right[state.partner]?.text) : null,
    };
  });

  const afterRows = right.map((row) => {
    const state = rightStatus[row.index] || { status: 'added', partner: null };
    return {
      text: row.text,
      status: state.status,
      partner: state.partner,
      tokens: state.status === 'edited' ? markWords(row.text, left[state.partner]?.text) : null,
    };
  });

  return {
    before: beforeRows,
    after: afterRows,
    changed: beforeRows.some((row) => row.status !== 'same') || afterRows.some((row) => row.status !== 'same'),
    counts: {
      moved: afterRows.filter((row) => row.status === 'moved').length,
      edited: afterRows.filter((row) => row.status === 'edited').length,
      added: afterRows.filter((row) => row.status === 'added').length,
      removed: beforeRows.filter((row) => row.status === 'removed').length,
    },
  };
}

/** One line naming what changed, for the section header. */
export function summarizeDiff(diff) {
  if (!diff?.changed) return 'No changes yet.';
  const parts = [];
  const { moved, edited, added, removed } = diff.counts;
  if (moved) parts.push(`${moved} sentence${moved === 1 ? '' : 's'} moved`);
  if (edited) parts.push(`${edited} sentence${edited === 1 ? '' : 's'} reworded`);
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  return parts.join(' · ');
}
