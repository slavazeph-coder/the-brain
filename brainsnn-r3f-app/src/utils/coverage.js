/**
 * Layer 66 — Coverage Heatmap
 *
 * For a given input text, identify exactly which of the active
 * Firewall regex patterns fired, on which match substring, and how
 * many times. Produces an ordered list of spans that the panel can
 * use to render an inline highlight over the text.
 */

import { getActiveRules } from './cognitiveFirewall';

/**
 * Walk each pattern once, record every match's start/end + matched
 * substring + category. Returns:
 *   - spans: sorted by start, possibly overlapping (UI merges)
 *   - perPattern: aggregated counts
 */
export function coverageFor(text = '') {
  const rules = getActiveRules();
  const spans = [];
  const perPattern = [];

  for (const [category, list] of Object.entries(rules)) {
    for (let i = 0; i < list.length; i++) {
      const re = list[i];
      let hits = 0;
      // Create a fresh /g regex so we can iterate matches without
      // fighting lastIndex state shared from elsewhere.
      const src = re.source;
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const cloned = (() => {
        try { return new RegExp(src, flags); } catch { return null; }
      })();
      if (!cloned) continue;
      let m;
      while ((m = cloned.exec(text)) !== null) {
        if (m[0].length === 0) { cloned.lastIndex++; continue; }
        spans.push({
          start: m.index,
          end: m.index + m[0].length,
          category,
          patternIdx: i,
          match: m[0],
          source: src,
        });
        hits++;
        if (hits > 2000) break; // safety
      }
      perPattern.push({ category, idx: i, source: src, flags: re.flags, hits });
    }
  }

  spans.sort((a, b) => a.start - b.start);
  const fired = perPattern.filter((p) => p.hits > 0).sort((a, b) => b.hits - a.hits);
  return {
    spans,
    perPattern,
    fired,
    totalHits: spans.length,
    firedPatternCount: fired.length,
    totalPatternCount: perPattern.length,
  };
}

export const CATEGORY_COLORS = {
  urgency: '#fdab43',
  outrage: '#e57b40',
  certainty: '#a86fdf',
  fear: '#dd6974',
};

/**
 * Split raw text into an array of { text, spans } tokens where each
 * token is either unmatched text or a matched substring with its
 * contributing patterns. Overlapping matches collapse to the
 * earliest-starting pattern for display clarity.
 */
export function tokenizeWithSpans(text, spans) {
  if (!text) return [];
  const cleaned = [];
  let last = 0;
  // Collapse overlaps greedily
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const s of sorted) {
    if (s.start < last) continue; // overlapped with previous
    if (s.start > last) {
      cleaned.push({ plain: true, text: text.slice(last, s.start) });
    }
    cleaned.push({
      plain: false,
      text: text.slice(s.start, s.end),
      category: s.category,
    });
    last = s.end;
  }
  if (last < text.length) cleaned.push({ plain: true, text: text.slice(last) });
  return cleaned;
}
