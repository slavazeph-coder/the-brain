import { describe, expect, it } from '../../test/tinyVitest.js';
import { createRewrite, createRewritePlan, REWRITE_GOALS, selectPatchesForGoal } from './rewrite.js';
import { buildPatchPlan } from '../../lib/draftPatch.js';

const pressureDraft = 'Last chance to join us. Everyone is switching to the massive new platform. Act now before prices double.';

describe('createRewrite', () => {
  it('returns an empty string for empty content', () => {
    expect(createRewrite('')).toBe('');
    expect(createRewrite('   ')).toBe('');
  });

  it('never injects sentences the user did not write', () => {
    // The regression this file exists for: the rewrite used to prepend
    // "Here is the clearest reason to believe this message before you publish
    // it:" and append an instruction, both addressed to the author. Copying
    // the result put our coaching notes into the reader's inbox.
    for (const goal of REWRITE_GOALS) {
      const rewrite = createRewrite(pressureDraft, goal.id);
      expect(rewrite).not.toMatch(/before you publish/i);
      expect(rewrite).not.toMatch(/Here is the clearest reason/i);
      expect(rewrite).not.toMatch(/Add one concrete proof point/i);
      expect(rewrite).not.toMatch(/real deadline or cost of waiting/i);
    }
  });

  it('emits no more sentences than the original draft', () => {
    const count = (text) => (text.match(/[.!?]/g) || []).length;
    for (const goal of REWRITE_GOALS) {
      expect(count(createRewrite(pressureDraft, goal.id))).toBe(count(pressureDraft));
    }
  });

  it('softens pressure phrases for the reduce-risk goal', () => {
    const rewrite = createRewrite(pressureDraft, 'reduce-risk');
    expect(rewrite).not.toMatch(/last chance/i);
    expect(rewrite).not.toMatch(/act now/i);
    expect(rewrite).not.toMatch(/everyone is/i);
  });

  it('never leaves a sentence starting with a lowercase letter', () => {
    for (const goal of REWRITE_GOALS) {
      const rewrite = createRewrite(pressureDraft, goal.id);
      expect(/(^|[.!?]\s+)[a-z]/.test(rewrite)).toBe(false);
    }
  });

  it('is deterministic for identical input', () => {
    expect(createRewrite(pressureDraft, 'clarity')).toBe(createRewrite(pressureDraft, 'clarity'));
  });

  it('returns a clean draft unchanged rather than padding it', () => {
    const clean = 'We shipped the migration on Tuesday. The team is happy with it.';
    expect(createRewrite(clean, 'trust')).toBe(clean);
  });

  it('preserves the paragraph structure the author wrote', () => {
    const rewrite = createRewrite('Last chance to join.\n\nThe second paragraph stays.', 'reduce-risk');
    expect(rewrite).toBe('Final reminder to join.\n\nThe second paragraph stays.');
  });
});

describe('createRewritePlan', () => {
  it('reports each applied change as advice, kept out of the copy', () => {
    const plan = createRewritePlan(pressureDraft, 'reduce-risk');
    expect(plan.changes.length > 0).toBe(true);
    for (const change of plan.changes) expect(plan.content.includes(change)).toBe(false);
  });

  it('says plainly when a goal has no mechanical fix available', () => {
    const plan = createRewritePlan('We shipped the migration on Tuesday.', 'curiosity');
    expect(plan.changes.length).toBe(0);
    expect(plan.note).toMatch(/judgement call/i);
  });

  it('counts only the patches that actually landed', () => {
    const plan = createRewritePlan(pressureDraft, 'reduce-risk');
    expect(plan.appliedCount).toBe(plan.changes.length);
  });
});

describe('selectPatchesForGoal', () => {
  it('keeps only the categories a goal is about', () => {
    const { patches } = buildPatchPlan(pressureDraft);
    const risk = selectPatchesForGoal(patches, 'reduce-risk');
    expect(risk.every((entry) => ['urgency', 'outrage', 'certainty'].includes(entry.category))).toBe(true);
    expect(risk.length < patches.length).toBe(true);
  });

  it('passes everything through for an unknown goal', () => {
    const { patches } = buildPatchPlan(pressureDraft);
    expect(selectPatchesForGoal(patches, 'not-a-goal').length).toBe(patches.length);
  });
});
