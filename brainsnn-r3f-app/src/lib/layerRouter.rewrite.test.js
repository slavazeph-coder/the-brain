import { describe, expect, it } from '../test/tinyVitest.js';
import { createRewriteFromLayerStack } from './layerRouter.js';

describe('layer-stack rewrite guidance', () => {
  it('never appends the old generic proof template to publishable copy', () => {
    const source = 'Our platform will double qualified leads for agencies. Book a demo today.';
    const rewrite = createRewriteFromLayerStack(source, 'trust');

    expect(rewrite.content).not.toContain('Add one specific proof point before publishing.');
    expect(rewrite.content).not.toContain('Lead with proof before the ask.');
    expect(rewrite.changes.join(' ')).toContain('double qualified leads');
  });

  it('keeps contextual advice in the change log instead of polluting the copy', () => {
    const rewrite = createRewriteFromLayerStack('Last chance. Act now before every competitor passes you.', 'reduce-risk');
    expect(rewrite.content.toLowerCase()).not.toContain('last chance');
    expect(rewrite.content.toLowerCase()).not.toContain('act now');
    expect(rewrite.changes.some((change) => change.includes('Layer 42'))).toBe(true);
  });
});
