/**
 * Layer 48 — Ad Transparency (archetype detection)
 *
 * Watches for the distinctive co-occurrence patterns that show up in
 * specific real-world manipulation genres. Each archetype is defined
 * as a small set of Layer 39 template IDs + a minimum score threshold
 * — when the input scores fire ≥K of the required templates, we call
 * the archetype.
 *
 * Archetypes are named so a reader can verify the classification:
 * "this reads like growth-hacker ad copy" is a falsifiable claim.
 */

const ARCHETYPES = [
  {
    id: 'growth-ad',
    label: 'Growth-hacker ad copy',
    desc: 'Limited-time scarcity + loud social proof + certainty theater.',
    require: ['scarcity', 'social-proof'],
    bonus: ['authority', 'fear-appeal'],
    min: 2,
  },
  {
    id: 'phishing',
    label: 'Phishing / account-compromise',
    desc: 'Urgency + fear appeal + authority name-drop (no social proof).',
    require: ['fear-appeal', 'authority'],
    bonus: ['scarcity'],
    min: 2,
  },
  {
    id: 'political-attack',
    label: 'Political attack frame',
    desc: 'Moral outrage bait + false dichotomy + purity test.',
    require: ['moral-outrage', 'false-dichotomy'],
    bonus: ['purity-test', 'straw-man', 'whataboutism'],
    min: 2,
  },
  {
    id: 'conspiracy-hook',
    label: 'Conspiracy hook',
    desc: 'Hidden-truth framing + loaded question + straw-man.',
    require: ['hidden-truth'],
    bonus: ['loaded-question', 'straw-man', 'moral-outrage'],
    min: 2,
  },
  {
    id: 'cult-recruitment',
    label: 'Cult / high-control recruiting',
    desc: 'Love bombing + purity test + guilt trip. Closeness + conditionality.',
    require: ['love-bombing', 'purity-test'],
    bonus: ['guilt-trip', 'hidden-truth'],
    min: 2,
  },
  {
    id: 'abusive-domestic',
    label: 'Abusive / gaslighting frame',
    desc: 'Gaslighting + DARVO + guilt trip — the "you\'re the problem" cluster.',
    require: ['gaslighting', 'darvo'],
    bonus: ['guilt-trip', 'loaded-question'],
    min: 2,
  },
  {
    id: 'fomo-pitch',
    label: 'FOMO launch pitch',
    desc: 'Scarcity + social proof + authority — SaaS / crypto / course launch.',
    require: ['scarcity', 'authority'],
    bonus: ['social-proof'],
    min: 2,
  },
];

/**
 * Given the merged template hits array ([{id,...}]), return the
 * archetypes that match.
 */
export function detectArchetypes(templateHits = []) {
  const ids = new Set(templateHits.map((t) => t.id));
  const hit = [];
  for (const arch of ARCHETYPES) {
    const matchedRequired = arch.require.filter((r) => ids.has(r)).length;
    const matchedBonus = (arch.bonus || []).filter((b) => ids.has(b)).length;
    const score = matchedRequired + 0.5 * matchedBonus;
    if (matchedRequired >= arch.min) {
      hit.push({
        id: arch.id,
        label: arch.label,
        desc: arch.desc,
        score,
        matched: [...arch.require.filter((r) => ids.has(r)), ...arch.bonus.filter((b) => ids.has(b))],
      });
    }
  }
  return hit.sort((a, b) => b.score - a.score);
}

export const ARCHETYPE_CATALOG = ARCHETYPES;
