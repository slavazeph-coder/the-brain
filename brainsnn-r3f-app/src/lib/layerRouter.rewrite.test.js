import { describe, expect, it } from '../test/tinyVitest.js';
import { createRewriteFromLayerStack } from './layerRouter.js';

describe('layer-stack rewrite guidance', () => {
  it('never appends the old generic proof template to publishable copy', () => {
    const source = 'Our platform will double qualified leads for agencies. Book a demo today.';
    const rewrite = createRewriteFromLayerStack(source, 'trust');

    expect(rewrite.content).not.toContain('Add one specific proof point before publishing.');
    expect(rewrite.content).not.toContain('Lead with proof before the ask.');
    // Advice that quotes the author's own claim belongs beside the draft, not
    // inside it. `remaining` is where the judgement call the mechanical pass
    // cannot make gets reported.
    expect(rewrite.remaining).toContain('double qualified leads');
    expect(rewrite.content).toBe(source);
  });

  it('keeps contextual advice in the change log instead of polluting the copy', () => {
    const rewrite = createRewriteFromLayerStack('Last chance. Act now before every competitor passes you.', 'reduce-risk');
    expect(rewrite.content.toLowerCase()).not.toContain('last chance');
    expect(rewrite.content.toLowerCase()).not.toContain('act now');
    // Every change describes an edit that is visible in the diff, so the log
    // can be checked rather than believed.
    expect(rewrite.changes.length).toBe(2);
    expect(rewrite.changes.join(' ')).toContain('Last chance');
    for (const change of rewrite.changes) expect(rewrite.content.includes(change)).toBe(false);
  });

  it('cites only rewrite layers that have an implementation', () => {
    const rewrite = createRewriteFromLayerStack('Last chance to act now.', 'reduce-risk');
    // 88 and 89 exist only as names in layerCatalog; citing them made the
    // engine trace look deeper than the code behind it.
    expect(rewrite.layersUsed.some((layer) => layer.id === 88 || layer.id === 89)).toBe(false);
    expect(rewrite.layersUsed.length).toBe(3);
  });

  it('returns the draft untouched when nothing mechanical applies', () => {
    const clean = 'We shipped the migration on Tuesday. The team is happy with it.';
    const rewrite = createRewriteFromLayerStack(clean, 'reduce-risk');
    expect(rewrite.content).toBe(clean);
    expect(rewrite.changes.length).toBe(0);
    expect(rewrite.note).toMatch(/judgement call/i);
  });

  it('handles empty content without throwing', () => {
    const rewrite = createRewriteFromLayerStack('', 'trust');
    expect(rewrite.content).toBe('');
    expect(rewrite.changes.length).toBe(0);
  });
});
