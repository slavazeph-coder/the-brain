// WHAT THESE SAY MUST BE WHAT THE CODE DOES.
//
// The previous table listed "5 / 30 / 200 analyses per month", "watermarked
// exports" and "synced history when Supabase is configured". None of it
// existed: there is no quota code, no watermarking, no Supabase client and no
// account state anywhere in src/. Every tier was unlimited and identical, and
// the Stripe webhook only console.logs, so paying would have changed nothing.
//
// Rather than invent entitlements to justify the table, it now describes the
// two things that are true today: everything is free while in beta, and pilots
// are what you can buy.
//
// This lives in a plain .js module rather than inside the component so
// `pricingClaims.test.js` can assert against the exact strings a visitor reads
// — the bare-Node test runner cannot import .jsx.

export const PRICING_PLANS = Object.freeze([
  {
    id: 'free',
    name: 'Free while in beta',
    price: '$0',
    description: 'The whole engine, in your browser, with no account and no limit.',
    features: Object.freeze([
      'Every layer on every scan',
      'Improve and Autopsy workflows',
      'PNG and text exports',
      'History kept in this browser',
    ]),
    highlighted: true,
  },
  {
    id: 'team',
    name: 'Pilot',
    price: "Let's scope it",
    description: 'A built interactive experience for your audience, with a visible model and claim boundary.',
    features: Object.freeze([
      'One audience, one concept, one interaction',
      'Custom scoring and missions',
      'Shareable, reproducible run states',
      'Launch and measurement plan',
    ]),
  },
]);

/** Said plainly rather than implied by a greyed-out tier nobody can click. */
export const BETA_NOTE =
  'Subscription plans are not open yet. When they are, they will list limits the '
  + 'code actually enforces — until then everything above is free and unmetered.';

/** Every string a visitor actually reads on a plan card. */
export function planCopy() {
  return PRICING_PLANS
    .flatMap((plan) => [plan.name, plan.price, plan.description, ...plan.features])
    .join(' | ');
}
