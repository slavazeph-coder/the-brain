/**
 * Layer 99 — Federated Community Firewall
 *
 *   GET  /api/community-pack  → { pack: { id, name, week, rules: [...] } }
 *
 * Returns the "pack of the week" — a rotating curated rule set pulled
 * from a short in-repo array indexed by ISO-week. No submission flow
 * here (yet); this is read-only federation so the server stays simple.
 * Users install packs via Layer 83 rule-pack plumbing on the client.
 */

const PACKS = [
  {
    id: 'community-2026-w16',
    name: 'Week 16 — AI-generated scam copy',
    desc: 'Patterns flagged by the community in week 16, 2026: LLM-style scam prose with unnatural urgency + generic authority.',
    rules: [
      { category: 'urgency', pattern: "don'?t let this opportunity slip through your fingers", label: 'LLM urgency idiom' },
      { category: 'certainty', pattern: "in today'?s fast-paced world", label: 'LLM opener' },
      { category: 'outrage', pattern: "the shocking truth (?:about|behind)", label: 'LLM clickbait' },
      { category: 'urgency', pattern: "time is of the essence", label: 'LLM stakes' },
      { category: 'certainty', pattern: "rest assured|let me assure you", label: 'LLM soothing' },
    ],
  },
  {
    id: 'community-2026-w17',
    name: 'Week 17 — Wellness-grift vocabulary',
    desc: 'Supplement/wellness influencer phrasing collected from the red-team feed.',
    rules: [
      { category: 'certainty', pattern: "big pharma|mainstream medicine|they (?:don\\'t|wont|can\\'t) cure", label: 'health-contrarian framing' },
      { category: 'urgency', pattern: "detox (?:in|within) \\d+ days?|cleanse now", label: 'detox urgency' },
      { category: 'certainty', pattern: "ancient (?:wisdom|remedy|secret)", label: 'ancient-secret appeal' },
      { category: 'fear', pattern: "hidden (?:toxin|chemical|poison)", label: 'toxin fear' },
    ],
  },
  {
    id: 'community-2026-w18',
    name: 'Week 18 — Workplace PIP-bait',
    desc: 'Manager-to-report phrases that precede a performance-improvement plan — collected from contributors.',
    rules: [
      { category: 'outrage', pattern: "for the good of the team|team\\'s best interest", label: 'collective pressure' },
      { category: 'certainty', pattern: "it\\'s not personal|purely a business decision", label: 'impersonal shield' },
      { category: 'fear', pattern: "we need to start thinking about (?:your )?fit", label: 'fit-framing' },
      { category: 'urgency', pattern: "before (?:the|a) (?:formal|written) (?:warning|process)", label: 'pre-PIP urgency' },
    ],
  },
];

function weekKey(ts = Date.now()) {
  const d = new Date(ts);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((ts - start) / 86400000);
  return Math.floor(dayOfYear / 7);
}

export function handleCommunityPack(_req, res) {
  const idx = weekKey() % PACKS.length;
  const pack = PACKS[idx];
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
  res.json({
    pack,
    totalPacks: PACKS.length,
    rotation: 'UTC weekly',
    week: `${new Date().getUTCFullYear()}-W${weekKey()}`,
  });
}

export function handleCommunityList(_req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
  res.json({ packs: PACKS.map((p) => ({ id: p.id, name: p.name, desc: p.desc, ruleCount: p.rules.length })) });
}
