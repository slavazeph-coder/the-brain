// Does the front door actually demonstrate the product?
//
// Every canned example was written to show off the SCORING, so every one of
// them was clean, well-argued copy. The consequence went unnoticed until the
// fixer shipped: not one example in the example row produced a single
// applicable fix, so anybody who started the way the UI invites them to —
// click a sample, run a scan — was told "Nothing mechanical left to fix" on
// their first ever result. The feature that edits your draft was unreachable
// from the front door.
//
// This test does not care which example carries the load, only that one does.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../../test/tinyVitest.js';
import { buildPatchPlan } from '../../lib/draftPatch.js';

/** Parse the example table out of the source rather than importing JSX. */
function examples() {
  const source = readFileSync('src/features/scan/ExampleSelector.jsx', 'utf8');
  return [...source.matchAll(/label: '([^']+)',\s*\n\s*content: '([^']+)'/g)]
    .map(([, label, content]) => ({ label, content }));
}

describe('example drafts', () => {
  it('finds the example table at all, so a silent pass is impossible', () => {
    // If the file layout changes, an empty list would make every assertion
    // below trivially true. This is the canary for that.
    expect(examples().length >= 5).toBe(true);
  });

  it('offers at least one example that the fixer can actually act on', () => {
    const withFixes = examples().filter((example) => buildPatchPlan(example.content).patches.length > 0);
    expect(withFixes.length >= 1).toBe(true);
  });

  it('covers more than one kind of fix, so the fix list is not a single row', () => {
    const categories = new Set();
    for (const example of examples()) {
      for (const patch of buildPatchPlan(example.content).patches) categories.add(patch.category);
    }
    // Structural and phrase-level fixes read very differently; a demo that
    // shows only one of them undersells what the screen does.
    expect(categories.has('structure')).toBe(true);
    expect(categories.size >= 3).toBe(true);
  });

  it('keeps the demonstrating example realistic rather than a parody', () => {
    // The high-risk sample already in this file is deliberately exaggerated and
    // lives behind a disclosure. A front-row example has to read like copy
    // somebody would really send, or the fix list looks like a toy.
    const best = examples()
      .map((example) => ({ ...example, count: buildPatchPlan(example.content).patches.length }))
      .sort((a, b) => b.count - a.count)[0];
    expect(best.content.length > 120).toBe(true);
    expect(/[.!?]/.test(best.content)).toBe(true);
    // Not a wall of pressure. Counting patches against sentences is the wrong
    // measure — two swaps can land in one sentence, and the structural fix
    // names two sentences without either being manipulative. What matters is
    // how many DISTINCT sentences read as pressure copy: some of the draft has
    // to be ordinary prose, or the example is a parody.
    const sentences = best.content.split(/[.!?]+/).filter((part) => part.trim()).length;
    const pressured = new Set(
      buildPatchPlan(best.content).patches
        .filter((patch) => patch.kind === 'replace-phrase')
        .map((patch) => patch.source.text),
    );
    expect(pressured.size < sentences).toBe(true);
  });
});
