import { describe, expect, it } from '../test/tinyVitest.js';
import {
  applyPatch,
  applyPatches,
  buildPatchPlan,
  evidenceStrength,
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

describe('capitalisation of a moved opening sentence', () => {
  it('capitalises a genuine lowercase sentence start', () => {
    const draft = 'Book a call today. we measured a 42% drop in cost.';
    const plan = buildPatchPlan(draft);
    const move = plan.patches.find((entry) => entry.id === 'move-proof-to-ask');
    expect(applyPatch(plan.draft, move).text).toBe('We measured a 42% drop in cost. Book a call today.');
  });

  it('leaves a deliberate lowercase brand alone', () => {
    // "iPhone" is not a missing capital, and mangling it into "IPhone" would be
    // a visible defect in the one artifact the user is about to send.
    const draft = 'iPhone sales grew. Book a call today. We measured a 42% drop in cost.';
    const plan = buildPatchPlan(draft);
    const move = plan.patches.find((entry) => entry.id === 'move-proof-to-ask');
    const result = applyPatch(plan.draft, move);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('iPhone sales grew.');
    expect(result.text).not.toContain('IPhone');
  });
});

describe('picking which sentence is the proof', () => {
  it('ranks by evidence strength instead of taking the first keyword hit', () => {
    // "Last chance to join the pilot" matches the proof keyword net on `pilot`
    // alone. Taking the first match made it the proof, and because it already
    // preceded the ask, the structural fix was silently withheld — while the
    // draft's real evidence sat three sentences further down.
    const draft = 'Last chance to join the pilot. Book a call before Friday. We cut review time by 42% across 18 pilot customers.';
    const plan = buildPatchPlan(draft);
    const move = plan.patches.find((entry) => entry.id === 'move-proof-to-ask');
    expect(Boolean(move)).toBe(true);
    expect(move.source.text).toContain('42%');
  });

  it('scores a checkable number above a bare soft noun', () => {
    expect(evidenceStrength('We cut cost by 42%.') > evidenceStrength('Join the pilot.')).toBe(true);
    expect(evidenceStrength('Join the pilot.')).toBe(1);
    expect(evidenceStrength('Nothing measurable at all here.')).toBe(0);
  });

  it('will not move a sentence whose only claim to evidence is one soft noun', () => {
    const plan = buildPatchPlan('Book a call today. Our customers like it.');
    expect(plan.patches.some((entry) => entry.id === 'move-proof-to-ask')).toBe(false);
  });

  it('still moves genuine evidence that sits after the ask', () => {
    const plan = buildPatchPlan('Book a call today. We measured a 42% drop in cost.');
    expect(plan.patches.some((entry) => entry.id === 'move-proof-to-ask')).toBe(true);
  });
});

describe('the draft survives intact (reported by review on #138)', () => {
  it('round-trips any draft through split and join unchanged', () => {
    // The invariant that would have caught the corruption below: whatever the
    // splitter does, rejoining must reproduce the normalized draft exactly.
    const drafts = [
      'We cut cost by 42.5% last quarter. Read more at example.com today.',
      'Version 1.2.3 shipped. It is fine.',
      'Call us on 555.1234 now. Or do not.',
      'No terminator at the end',
      'Multiple!! Terminators?? Here.',
      'One block.\n\nSecond block with 3.5 in it.\n\nThird.',
      'e.g. this abbreviation stays. And so does i.e. that one.',
    ];
    for (const draft of drafts) {
      const normalized = normalizeDraft(draft);
      const rejoined = locateSegments(normalized)
        .reduce((blocks, segment) => {
          blocks[segment.blockIndex] = [...(blocks[segment.blockIndex] || []), segment.text];
          return blocks;
        }, [])
        .map((sentences) => sentences.join(' '))
        .join('\n\n');
      expect(rejoined).toBe(normalized);
    }
  });

  it('never splits a decimal into two sentences', () => {
    const segments = locateSegments('We cut cost by 42.5% last quarter.');
    expect(segments.length).toBe(1);
    expect(segments[0].text).toContain('42.5%');
  });

  it('never splits a domain into two sentences', () => {
    const segments = locateSegments('Read more at example.com today.');
    expect(segments.length).toBe(1);
    expect(segments[0].text).toContain('example.com');
  });

  it('keeps decimals and links whole when an unrelated patch is applied', () => {
    // Before the fix this produced "5% and you can read more at example. Book a
    // call today. We cut cost by 42. com now." — the fragments were treated as
    // independent sentences and one of them was moved.
    const draft = 'Book a call today. We cut cost by 42.5% and you can read more at example.com now.';
    const plan = buildPatchPlan(draft);
    const result = applyPatch(plan.draft, plan.patches[0]);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('42.5%');
    expect(result.text).toContain('example.com');
    expect(result.text).not.toMatch(/42\.\s+5%/);
    expect(result.text).not.toMatch(/example\.\s+com/);
  });

  it('keeps every paragraph of a long draft', () => {
    // normalizeDraft used to slice to 40 blocks, and its output is both the
    // "Original" pane and the source for Copy final draft — so a long message
    // was silently truncated before the user copied it.
    const many = Array.from({ length: 45 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n');
    const normalized = normalizeDraft(many);
    expect(normalized.split('\n\n').length).toBe(45);
    expect(normalized).toContain('Paragraph 45.');
  });

  it('keeps every sentence of a very long paragraph', () => {
    const long = Array.from({ length: 80 }, (_, index) => `Sentence ${index + 1}.`).join(' ');
    expect(normalizeDraft(long)).toContain('Sentence 80.');
  });

  it('still bounds how much it scans for fixes', () => {
    const huge = Array.from({ length: 600 }, (_, index) => `Filler sentence ${index + 1}.`).join(' ');
    const plan = buildPatchPlan(`${huge} Last chance to act.`);
    // The trailing pressure phrase sits past the scan window, so no swap is
    // offered for it — but the draft still carries every sentence, which is the
    // property that matters for what the user copies.
    expect(plan.patches.some((patch) => /last-chance/.test(patch.id))).toBe(false);
    expect(plan.draft).toContain('Last chance to act.');
    expect(plan.segments.length).toBe(601);
  });
});
