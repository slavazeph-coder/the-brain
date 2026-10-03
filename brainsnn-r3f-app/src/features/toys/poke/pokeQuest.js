// The one-line guide under the brain: it always suggests the next fun thing
// you have not tried yet, in the order that shows the toy off best, then
// gets out of the way. Pure, so the order and the skipping rules are tested.

export const QUEST = Object.freeze([
  { id: 'poke', text: 'Tap the brain' },
  { id: 'stretch', text: 'Grab it and drag — it stretches', needs3d: true },
  { id: 'slice', text: 'Now hit Slice', needs3d: true },
  // Swiping and healing only make sense with the knife out.
  { id: 'swipe', text: 'Swipe through the brain to slice it', needs3d: true, needsKnife: true },
  { id: 'heal', text: 'Tap Heal to put it back together', needs3d: true, needsKnife: true },
  { id: 'shake', text: 'Now shake it' },
]);

/**
 * The step to show, or null once everything has been tried. It follows the
 * visitor: the next untried step after the furthest one they have done, so
 * someone who goes straight for Slice is offered the swipe, not sent back to
 * "tap". Only when nothing is left ahead does it circle back to what they
 * skipped. Steps the current mode can't do (3D-only on the 2D brain, knife
 * steps with the knife away) are passed over, not blocking: they come back
 * when they become possible.
 */
export function currentQuest(done, { has3d = true, knife = false } = {}) {
  const open = (step) => !done.has(step.id) && !(step.needs3d && !has3d) && !(step.needsKnife && !knife);
  let furthest = -1;
  QUEST.forEach((step, index) => { if (done.has(step.id)) furthest = index; });
  return QUEST.slice(furthest + 1).find(open) || QUEST.find(open) || null;
}

/** A new done-set with `id` added; the same set back if nothing changed. */
export function completeQuest(done, id) {
  if (done.has(id)) return done;
  const next = new Set(done);
  next.add(id);
  return next;
}
