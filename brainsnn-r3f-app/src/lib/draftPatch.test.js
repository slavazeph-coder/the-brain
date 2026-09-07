import { describe, expect, it } from '../test/tinyVitest.js';
import {
  applyPatch,
  applyPatches,
  buildPatchPlan,
  locateSegments,
  normalizeDraft,
  usablePatches,
} from './draftPatch.js';

const PROOF_AFTER_ASK = 'Book a call with our team today. We cut onboarding time by 42% across 18 pilot customers.';

describe('normalizeDraft', () => {
  it('collapses inline whitespace but keeps paragraph breaks', () => {
    const draft = normalizeDraft('First   line\nstill first.\n\n\n  Second block.  ');
    expect(draft).toBe('First line still first.\n\nSecond block.');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeDraft('   \n\n  ')).toBe('');
    expect(normalizeDraft(null)).toBe('');
  });
});

describe('locateSegments', () => {
  it('gives every sentence a block-aware identity', () => {
    const segments = locateSegments('One. Two.\n\nThree.');
    expect(segments.length).toBe(3);
    expect(segments[1].text).toBe('Two.');
    expect(segments[1].blockIndex).toBe(0);
    expect(segments[1].indexInBlock).toBe(1);
    expect(segments[2].blockIndex).toBe(1);
    expect(segments[2].indexInBlock).toBe(0);
  });

  it('keeps ids unique across blocks', () => {
    const ids = locateSegments('One. Two.\n\nThree. Four.').map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildPatchPlan', () => {
  it('offers to move proof in front of the ask', () => {
    const plan = buildPatchPlan(PROOF_AFTER_ASK);
    const move = plan.patches.find((entry) => entry.id === 'move-proof-to-ask');
    expect(Boolean(move)).toBe(true);
    expect(move.kind).toBe('move-before');
    expect(move.source.text.includes('42%')).toBe(true);
  });

  it('does not offer the move when proof already precedes the ask', () => {
    const plan = buildPatchPlan('We cut onboarding time by 42% across 18 pilot customers. Book a call with our team today.');
    expect(plan.patches.some((entry) => entry.id === 'move-proof-to-ask')).toBe(false);
  });

  it('offers pressure-phrase swaps with a stated reason', () => {
    const plan = buildPatchPlan('This is your last chance to join. It is a total game-changer.');
    const ids = plan.patches.map((entry) => entry.id);
    expect(ids.some((id) => id.includes('last-chance'))).toBe(true);
    expect(ids.some((id) => id.includes('game-changer'))).toBe(true);
    expect(plan.patches.every((entry) => Boolean(entry.detail))).toBe(true);
  });

  it('returns nothing to fix for a clean draft', () => {
    const plan = buildPatchPlan('We shipped the migration on Tuesday. The team is happy with it.');
    expect(plan.patches.length).toBe(0);
  });

  it('handles empty input without throwing', () => {
    const plan = buildPatchPlan('');
    expect(plan.patches.length).toBe(0);
    expect(plan.segments.length).toBe(0);
  });
});

describe('applyPatch', () => {
  it('moves the proof sentence in front of the ask', () => {
    const plan = buildPatchPlan(PROOF_AFTER_ASK);
    const move = plan.patches.find((entry) => entry.id === 'move-proof-to-ask');
    const result = applyPatch(plan.draft, move);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('We cut onboarding time by 42% across 18 pilot customers. Book a call with our team today.');
  });

  it('reports not-applicable instead of editing when the anchor is gone', () => {
    const plan = buildPatchPlan(PROOF_AFTER_ASK);
    const move = plan.patches.find((entry) => entry.id === 'move-proof-to-ask');
    const result = applyPatch('A completely different draft now lives here.', move);
    expect(result.ok).toBe(false);
    expect(result.applicable).toBe(false);
    expect(result.text).toBe(null);
  });

  it('is a no-op the second time, rather than moving the sentence again', () => {
    const plan = buildPatchPlan(PROOF_AFTER_ASK);
    const move = plan.patches.find((entry) => entry.id === 'move-proof-to-ask');
    const once = applyPatch(plan.draft, move);
    const twice = applyPatch(once.text, move);
    expect(twice.ok).toBe(false);
    expect(twice.reason.includes('already')).toBe(true);
  });

  it('keeps the sentence capitalised when a swap lands at position zero', () => {
    const plan = buildPatchPlan('Act now before the price rises.');
    const swap = plan.patches.find((entry) => entry.kind === 'replace-phrase');
    const result = applyPatch(plan.draft, swap);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Take a look before the price rises.');
  });

  it('leaves mid-sentence swaps lower-case', () => {
    const plan = buildPatchPlan('Please act now before the price rises.');
    const swap = plan.patches.find((entry) => entry.kind === 'replace-phrase');
    const result = applyPatch(plan.draft, swap);
    expect(result.text).toBe('Please take a look before the price rises.');
  });

  it('punctuates a trailing sentence that moves into the middle', () => {
    const draft = 'Book a call today. Filler line here. We measured a 42% drop in cost';
    const plan = buildPatchPlan(draft);
    const move = plan.patches.find((entry) => entry.id === 'move-proof-to-ask');
    const result = applyPatch(plan.draft, move);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('We measured a 42% drop in cost. Book a call today. Filler line here.');
  });

  it('never moves a sentence across a paragraph break', () => {
    const plan = buildPatchPlan('Book a call today.\n\nWe measured a 42% drop in cost.');
    expect(plan.patches.some((entry) => entry.id === 'move-proof-to-ask')).toBe(false);
  });

  it('preserves paragraph structure through an edit', () => {
    const draft = 'This is your last chance to act.\n\nThe second paragraph stays put.';
    const plan = buildPatchPlan(draft);
    const result = applyPatch(plan.draft, plan.patches[0]);
    expect(result.text).toBe('This is your final reminder to act.\n\nThe second paragraph stays put.');
  });

  it('rejects an unknown patch kind', () => {
    expect(applyPatch('Some draft here.', { kind: 'nonsense' }).ok).toBe(false);
  });
});

describe('applyPatches', () => {
  it('applies every patch and reports each outcome', () => {
    const draft = 'This is your last chance. It is a game-changer for massive teams.';
    const plan = buildPatchPlan(draft);
    const run = applyPatches(plan.draft, plan.patches);
    expect(run.appliedCount).toBe(plan.patches.length);
    expect(run.text.includes('last chance')).toBe(false);
    expect(run.text.includes('game-changer')).toBe(false);
    expect(run.text.includes('massive')).toBe(false);
    expect(run.outcomes.every((outcome) => outcome.applied)).toBe(true);
  });

  it('skips patches that stopped applying without losing the rest', () => {
    const plan = buildPatchPlan('This is your last chance to act.');
    const stale = { id: 'stale', kind: 'move-to-open', source: { text: 'Not in the draft.' } };
    const run = applyPatches(plan.draft, [stale, ...plan.patches]);
    expect(run.appliedCount).toBe(plan.patches.length);
    expect(run.outcomes[0].applied).toBe(false);
    expect(run.text.includes('final reminder')).toBe(true);
  });

  it('leaves a clean draft byte-identical', () => {
    const draft = 'We shipped the migration on Tuesday. The team is happy with it.';
    const run = applyPatches(draft, buildPatchPlan(draft).patches);
    expect(run.text).toBe(draft);
    expect(run.appliedCount).toBe(0);
  });
});

describe('usablePatches', () => {
  it('drops patches that no longer apply to the current draft', () => {
    const plan = buildPatchPlan(PROOF_AFTER_ASK);
    const applied = applyPatches(plan.draft, plan.patches);
    expect(usablePatches(applied.text, plan.patches).length).toBe(0);
    expect(usablePatches(plan.draft, plan.patches).length).toBe(plan.patches.length);
  });
});

describe('overlapping swaps in one sentence', () => {
  it('applies both when the first rewrites the second patch anchor', () => {
    const draft = 'It is a game-changer for massive teams.';
    const plan = buildPatchPlan(draft);
    expect(plan.patches.length).toBe(2);
    const run = applyPatches(plan.draft, plan.patches);
    expect(run.appliedCount).toBe(2);
    expect(run.text).toBe('It is a meaningful improvement for substantial teams.');
  });

  it('still refuses once the phrase is gone from the whole draft', () => {
    const plan = buildPatchPlan('Act now before the price rises.');
    const swap = plan.patches[0];
    const once = applyPatch(plan.draft, swap);
    expect(applyPatch(once.text, swap).ok).toBe(false);
  });

  it('walks to the next occurrence rather than corrupting the first', () => {
    const draft = 'Act now for the trial. Act now for the upgrade.';
    const plan = buildPatchPlan(draft);
    const run = applyPatches(plan.draft, plan.patches);
    expect(run.text).toBe('Take a look for the trial. Take a look for the upgrade.');
  });
});
