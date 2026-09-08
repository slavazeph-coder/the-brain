import { describe, expect, it } from '../test/tinyVitest.js';
import { diffDrafts, summarizeDiff } from './draftDiff.js';

describe('diffDrafts', () => {
  it('marks a pure reorder as moved, which a word-set diff cannot see', () => {
    // The regression this file exists for. "Move the proof in front of the ask"
    // changes no words, so the old Set-based diff rendered nothing at all and
    // the headline fix looked like it had done nothing.
    const before = 'Book a call today. We measured a 42% drop in cost.';
    const after = 'We measured a 42% drop in cost. Book a call today.';
    const diff = diffDrafts(before, after);
    expect(diff.changed).toBe(true);
    expect(diff.counts.moved).toBe(2);
    expect(diff.after[0].status).toBe('moved');
    expect(diff.after[0].partner).toBe(1);
  });

  it('reports no change for identical drafts', () => {
    const draft = 'We shipped on Tuesday. The team is happy.';
    const diff = diffDrafts(draft, draft);
    expect(diff.changed).toBe(false);
    expect(diff.before.every((row) => row.status === 'same')).toBe(true);
    expect(summarizeDiff(diff)).toBe('No changes yet.');
  });

  it('pairs a phrase swap as an edit and marks only the swapped words', () => {
    const diff = diffDrafts('This is your last chance to act.', 'This is your final reminder to act.');
    expect(diff.counts.edited).toBe(1);
    const changed = diff.after[0].tokens.filter((token) => token.changed).map((token) => token.text);
    expect(changed).toEqual(['final', 'reminder']);
  });

  it('leaves the untouched words of an edited sentence unmarked', () => {
    const diff = diffDrafts('This is your last chance to act.', 'This is your final reminder to act.');
    const kept = diff.after[0].tokens.filter((token) => !token.changed && token.text.trim()).map((token) => token.text);
    expect(kept).toEqual(['This', 'is', 'your', 'to', 'act.']);
  });

  it('separates a genuine addition from an edit', () => {
    const diff = diffDrafts('We shipped on Tuesday.', 'We shipped on Tuesday. Completely unrelated new sentence here.');
    expect(diff.counts.added).toBe(1);
    expect(diff.counts.edited).toBe(0);
    expect(diff.after[1].status).toBe('added');
  });

  it('reports a removal', () => {
    const diff = diffDrafts('We shipped on Tuesday. Some other line entirely.', 'We shipped on Tuesday.');
    expect(diff.counts.removed).toBe(1);
    expect(diff.before[1].status).toBe('removed');
  });

  it('handles a move and an edit in the same draft', () => {
    const before = 'Last chance to book a call. We measured a 42% drop in cost.';
    const after = 'We measured a 42% drop in cost. Final reminder to book a call.';
    const diff = diffDrafts(before, after);
    expect(diff.counts.moved).toBe(1);
    expect(diff.counts.edited).toBe(1);
  });

  it('does not pair two unrelated sentences as an edit', () => {
    const diff = diffDrafts('The quarterly migration finished early.', 'Penguins waddle across the ice rink.');
    expect(diff.counts.edited).toBe(0);
    expect(diff.counts.added).toBe(1);
    expect(diff.counts.removed).toBe(1);
  });

  it('pairs each repeated sentence in order rather than all to one match', () => {
    const diff = diffDrafts('Act now. Act now.', 'Act now. Act now.');
    expect(diff.before.every((row) => row.status === 'same')).toBe(true);
    expect(diff.before[0].partner).toBe(0);
    expect(diff.before[1].partner).toBe(1);
  });

  it('survives empty input on either side', () => {
    expect(diffDrafts('', '').changed).toBe(false);
    expect(diffDrafts('Something here.', '').counts.removed).toBe(1);
    expect(diffDrafts('', 'Something here.').counts.added).toBe(1);
  });

  it('marks a word repeated only on one side', () => {
    const diff = diffDrafts('We tested it.', 'We tested and tested it.');
    const changed = diff.after[0].tokens.filter((token) => token.changed).map((token) => token.text);
    expect(changed).toEqual(['and', 'tested']);
  });
});

describe('summarizeDiff', () => {
  it('names what changed rather than counting words', () => {
    const diff = diffDrafts('Book a call today. We measured a 42% drop in cost.', 'We measured a 42% drop in cost. Book a call today.');
    expect(summarizeDiff(diff)).toBe('2 sentences moved');
  });

  it('combines several kinds of change', () => {
    const before = 'Last chance to book a call. We measured a 42% drop in cost.';
    const after = 'We measured a 42% drop in cost. Final reminder to book a call.';
    expect(summarizeDiff(diffDrafts(before, after))).toBe('1 sentence moved · 1 sentence reworded');
  });

  it('handles a missing diff without throwing', () => {
    expect(summarizeDiff(null)).toBe('No changes yet.');
  });
});
