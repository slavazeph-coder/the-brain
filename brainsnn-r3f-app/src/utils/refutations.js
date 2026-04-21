/**
 * Layer 41 — Refutation Library
 *
 * Pre-written counter-responses for every propaganda template the
 * Firewall can detect. Short, quotable, actionable — designed to be
 * copied into a reply and said with a straight face.
 *
 * Map keys mirror propagandaTemplates.js `id` values exactly.
 */

export const REFUTATIONS = {
  gaslighting: {
    core: 'Name the specific behavior. Document it. Stop debating reality with someone who denies it.',
    script: "I'm not going to argue about whether this happened. It happened. Here's what happened and here's what I need from you.",
    stance: 'Trust your own observation. Gaslighting wins when you let the argument move to whether you can trust yourself.',
  },
  darvo: {
    core: 'Return to the original issue. Do not defend the reversed accusation — the reversal is the tactic.',
    script: 'I can answer that concern after we finish this one. The issue on the table is X.',
    stance: 'A reversed accusation is not a rebuttal. Parking it without engaging is not rudeness — it is hygiene.',
  },
  'love-bombing': {
    core: 'Watch consistency over time, not intensity in the moment. Real closeness is a graph, not a spike.',
    script: 'This is a lot quickly — I\'d rather know each other over more of the ordinary stuff first.',
    stance: 'Flattery at the beginning is an investment, not a gift. Measure withdrawals too.',
  },
  scarcity: {
    core: 'Walk away from any offer that requires instant compliance. The ones that matter survive a night\'s sleep.',
    script: 'If this opportunity disappears because I took a day to think, it was not an opportunity.',
    stance: 'Scarcity wins when the clock matters more than the decision. Change the metric.',
  },
  'social-proof': {
    core: 'Ask what you would do if no one else were doing it. That answer is yours.',
    script: 'I\'m not choosing based on what everyone else is doing. Here\'s what matters to me.',
    stance: 'Crowds amplify — they rarely originate. Point back to the source they cite.',
  },
  authority: {
    core: 'Ask for a specific citation. "Experts say" is a mask; "Dr. X, 2024, Journal Y" is a source.',
    script: 'Which expert? Which study? I\'ll read it and get back to you.',
    stance: 'Deferring to authority is fine. Deferring to a vague plural is not.',
  },
  'loaded-question': {
    core: 'Refuse the premise before answering. "That assumes X — I don\'t agree X is true."',
    script: 'I\'m not going to answer that as phrased. It assumes something that isn\'t true. Ask it without the assumption.',
    stance: 'Answering a loaded question validates its hidden claim. Unpack it first.',
  },
  'straw-man': {
    core: 'Restate your actual position in one sentence, then stop. Refuse to defend the distortion.',
    script: 'That\'s not what I said. What I said was X. If you want to push back on X, go ahead.',
    stance: 'You are not required to argue against claims you never made.',
  },
  whataboutism: {
    core: 'Name the deflection. Offer to handle the other issue after the current one is resolved.',
    script: 'That\'s a separate issue. I\'m happy to talk about it next. First, this one.',
    stance: 'A deflection can be valid AND off-topic. Both things can be true.',
  },
  'false-dichotomy': {
    core: 'Name a third option. Any third option defeats the binary.',
    script: 'Those aren\'t the only two choices. A third path is X.',
    stance: 'A forced choice is a tell. There are almost always more than two options.',
  },
  'fear-appeal': {
    core: 'Separate the probability of the scary outcome from the urgency of the proposed action. They rarely match.',
    script: 'Even if the risk is real, that doesn\'t mean this is the right response. What\'s the base rate?',
    stance: 'Fear earns attention, not compliance. Slow down the action step.',
  },
  'hidden-truth': {
    core: 'Ask for the evidence that is supposedly being hidden. "Hidden" should still leave traces.',
    script: 'Can you point me at the primary source? I\'ll read it directly.',
    stance: 'Conspiracies that can\'t be checked at all aren\'t revelations — they\'re vibes.',
  },
  'moral-outrage': {
    core: 'Decide your moral priorities on your own clock, not someone else\'s share prompt.',
    script: 'I care about this, and I will engage on my own timeline.',
    stance: 'Outrage demanded at a deadline is usually performance, not justice.',
  },
  'purity-test': {
    core: 'Your alignment is not measured by your agreement with any one person. Keep the disagreement specific.',
    script: 'I agree on X. I disagree on Y. Both are real; one doesn\'t erase the other.',
    stance: 'Coalitions are built on overlap, not uniformity.',
  },
  'guilt-trip': {
    core: 'Name the maneuver. Offer to discuss the underlying need once the guilt framing is dropped.',
    script: 'It sounds like you\'re feeling unsupported. I want to hear that — but not as a guilt trip.',
    stance: 'Guilt is not a language. Translate it back into a request before answering.',
  },
};

/**
 * Lookup helper. Returns an entry or null.
 */
export function refutationFor(id) {
  return REFUTATIONS[id] || null;
}

/**
 * Return all refutations for an ordered list of template hits. Filters
 * unknowns, preserves order.
 */
export function refutationsFor(templates = []) {
  return templates
    .map((t) => {
      const r = refutationFor(t.id);
      return r ? { ...t, refutation: r } : null;
    })
    .filter(Boolean);
}
