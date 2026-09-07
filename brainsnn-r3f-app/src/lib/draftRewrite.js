import { applyPatches, buildPatchPlan, normalizeDraft } from './draftPatch.js';

export const REWRITE_GOALS = [
  { id: 'curiosity', label: 'Increase curiosity', description: 'Open with tension, contrast, or a useful unanswered question.' },
  { id: 'trust', label: 'Build trust', description: 'Add proof, specificity, and constraints before asking for action.' },
  { id: 'reduce-risk', label: 'Reduce manipulation', description: 'Remove unsupported scarcity, fear pressure, and forced commands.' },
  { id: 'urgency', label: 'Add real urgency', description: 'Give the reader an honest, concrete reason to act now.' },
  { id: 'clarity', label: 'Make it clearer', description: 'Simplify the promise and make the next action obvious.' },
  { id: 'resonance', label: 'More emotionally resonant', description: 'Keep the audience visible without raising pressure.' },
];

// Which mechanical edits belong to which goal. A goal that finds no matching
// edit says so rather than inventing one — see `note` in createRewritePlan.
const GOAL_CATEGORIES = {
  trust: ['structure', 'certainty'],
  'reduce-risk': ['urgency', 'outrage', 'certainty'],
  clarity: ['vague', 'structure'],
  urgency: ['urgency'],
  curiosity: ['vague'],
  resonance: ['urgency', 'outrage'],
};

const GOAL_NOTES = {
  trust: 'Trust comes from proof placement and checkable claims, so this pass only moved evidence and tightened absolute statements.',
  'reduce-risk': 'This pass removed pressure the evidence in the draft does not support.',
  clarity: 'This pass replaced broad praise with language a reader can actually picture.',
  urgency: 'Manufactured urgency was removed so a real deadline — if you have one — is the only urgency left.',
  curiosity: 'Vague superlatives were replaced; curiosity comes from a specific unanswered question, which only you can supply.',
  resonance: 'Pressure language was softened so warmth is not competing with a demand.',
};

export function selectPatchesForGoal(patches = [], goal = 'trust') {
  const wanted = GOAL_CATEGORIES[goal];
  if (!wanted) return patches;
  return patches.filter((entry) => wanted.includes(entry.category));
}

/**
 * Build the improved draft plus a record of what changed.
 *
 * The previous version of this function bolted a canned opener and closer onto
 * the user's text — instruction sentences addressed to the author ("Add one
 * concrete proof point before the ask") glued to copy addressed to the
 * author's customer. Anyone who copied the result shipped our coaching notes.
 * Advice belongs in `changes`; only the user's own words belong in `content`.
 */
export function createRewritePlan(content, goal = 'trust') {
  const draft = normalizeDraft(content);
  if (!draft) return { content: '', changes: [], patches: [], outcomes: [], appliedCount: 0, note: '' };

  const plan = buildPatchPlan(draft);
  const selected = selectPatchesForGoal(plan.patches, goal);
  const run = applyPatches(draft, selected);

  const changes = selected
    .filter((entry) => run.outcomes.find((outcome) => outcome.id === entry.id)?.applied)
    .map((entry) => `${entry.label} — ${entry.detail}`);

  const note = changes.length
    ? GOAL_NOTES[goal] || ''
    : 'Nothing in this draft could be fixed mechanically for this goal. The recommendations below need a judgement call only you can make.';

  return {
    content: run.text,
    changes,
    patches: selected,
    outcomes: run.outcomes,
    appliedCount: run.appliedCount,
    note,
  };
}

/** The improved draft on its own — safe to copy straight into a send field. */
export function createRewrite(content, goal = 'trust') {
  return createRewritePlan(content, goal).content;
}
