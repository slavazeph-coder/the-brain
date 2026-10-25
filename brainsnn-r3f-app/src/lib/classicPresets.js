// "Scan the classics" — recognizable content archetypes as one-click scans.
// Every text is an ORIGINAL, genericized paraphrase of a formula, labeled by
// archetype. No brand names, product names or real people (enforced by test).

export const CLASSIC_PRESETS = [
  {
    id: 'luxury-scarcity-ad',
    archetype: 'Iconic ad formula',
    label: 'Luxury scarcity line',
    content: 'Only forty were ever made. You are not buying a watch — you are joining the small circle of people who understand why that matters. Private viewings close this week.',
    teaser: { label: 'Manipulation risk', level: 'low', line: 'Prestige carries it — pressure stays quiet' },
  },
  {
    id: 'infomercial-pitch',
    archetype: 'Direct-response classic',
    label: 'Late-night infomercial pitch',
    content: "But wait — there's more. Order in the next ten minutes and we'll double your order, throw in the deluxe kit, and cover the shipping. This deal will never be repeated. Call now!",
    teaser: { label: 'Urgency', level: 'high', line: 'Stacked bonuses + fake countdown' },
  },
  {
    id: 'underdog-brand-ad',
    archetype: 'Challenger ad formula',
    label: 'Underdog brand manifesto',
    content: "We're number two. So we try harder. The big guys have the budgets; we have the reason to earn you every single day. That's the whole pitch.",
    teaser: { label: 'Trust', level: 'high', line: 'Honesty as the hook — low pressure' },
  },
  {
    id: 'curiosity-gap-hook',
    archetype: 'Viral hook formula',
    label: 'Curiosity-gap opener',
    content: "I studied the top 1% of creators for 90 days and found one habit nobody talks about. It takes four minutes a day, and it changed how I write everything. Here's what it is:",
    teaser: { label: 'Viral pull', level: 'high', line: 'Open loop does the heavy lifting' },
  },
  {
    id: 'outrage-bait-post',
    archetype: 'Engagement-bait formula',
    label: 'Outrage-bait post',
    content: "They are quietly banning this and hoping you won't notice. Share this before it gets taken down, because once it's gone, it's gone for good. Wake up.",
    teaser: { label: 'Manipulation risk', level: 'extreme', line: 'Hidden-truth framing + share pressure' },
  },
  {
    id: 'account-phishing-email',
    archetype: 'Scam email pattern',
    label: '"Account suspended" phishing',
    content: 'URGENT: Your account has been suspended due to suspicious activity. Verify your identity within 24 hours or your account will be permanently deleted. Click here immediately to restore access.',
    teaser: { label: 'Manipulation risk', level: 'extreme', line: 'Fear + deadline + forced click' },
  },
  {
    id: 'prize-scam-email',
    archetype: 'Scam email pattern',
    label: 'Unclaimed prize scam',
    content: 'Congratulations! You have been selected as the final winner of our international sweepstakes. To release your prize of $2,500,000, simply confirm your details and pay the small processing fee today.',
    teaser: { label: 'Manipulation risk', level: 'extreme', line: 'Reward bait + advance-fee ask' },
  },
  {
    id: 'corporate-non-apology',
    archetype: 'Crisis comms pattern',
    label: 'Corporate non-apology',
    content: 'We regret that some customers may have felt inconvenienced by recent events. We remain committed to the highest standards and consider this matter closed as we look to the future together.',
    teaser: { label: 'Trust', level: 'low', line: 'Deflection erodes the apology' },
  },
  {
    id: 'sincere-apology',
    archetype: 'Crisis comms pattern',
    label: 'Sincere apology statement',
    content: 'We got this wrong. On Tuesday our update broke checkout for six hours, and our first message understated it. Here is exactly what failed, what we refunded, and the two changes that stop it happening again.',
    teaser: { label: 'Trust', level: 'high', line: 'Specifics repair credibility' },
  },
  {
    id: 'guru-urgency-pitch',
    archetype: 'Guru funnel formula',
    label: 'Guru urgency pitch',
    content: "Doors close tonight at midnight. If you're not ready to invest in yourself, this isn't for you — but don't come back in a year asking why everyone else is ahead. Serious people only.",
    teaser: { label: 'Manipulation risk', level: 'high', line: 'Shame framing + false deadline' },
  },
];

export function getClassicPreset(id) {
  return CLASSIC_PRESETS.find((preset) => preset.id === id) || null;
}
