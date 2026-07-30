import { describe, expect, it } from '../../test/tinyVitest.js';
import { createRewrite, REWRITE_GOALS } from './rewrite.js';

const pressureDraft = 'Last chance! Our AI-powered platform guarantees 10x growth in 30 days or your money back. Only 3 spots left — act now before prices double at midnight!';

function middleSection(rewrite) {
  return rewrite.split('\n\n')[1] || '';
}

describe('createRewrite', () => {
  it('returns an empty string for empty content', () => {
    expect(createRewrite('')).toBe('');
    expect(createRewrite('   ')).toBe('');
  });

  it('softens pressure phrases including present-tense guarantees', () => {
    const body = middleSection(createRewrite(pressureDraft, 'trust'));
    expect(body).not.toMatch(/last chance/i);
    expect(body).not.toMatch(/act now/i);
    expect(body).not.toMatch(/guarantee/i);
    expect(body).toContain('is built to support');
  });

  it('never leaves a sentence starting with a lowercase letter', () => {
    for (const goal of REWRITE_GOALS) {
      const body = middleSection(createRewrite(pressureDraft, goal.id));
      expect(/(^|[.!?]\s+)[a-z]/.test(body)).toBe(false);
    }
  });

  it('is deterministic for identical input', () => {
    expect(createRewrite(pressureDraft, 'clarity')).toBe(createRewrite(pressureDraft, 'clarity'));
  });

  it('supports the urgency goal with its own opener and closer', () => {
    expect(REWRITE_GOALS.some((goal) => goal.id === 'urgency')).toBe(true);
    const rewrite = createRewrite(pressureDraft, 'urgency');
    expect(rewrite.startsWith('Here is why this matters right now')).toBe(true);
    expect(rewrite).toContain('real deadline or cost of waiting');
  });
});
