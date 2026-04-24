/**
 * Layer 87 — Genre Classifier
 *
 * Lightweight heuristic classifier — feature-bag + weighted hits
 * across a catalog of text genres. Not a trained model; a calibrated
 * rule set that gives readable signals ("this reads 60% ad copy, 30%
 * news, 10% personal").
 *
 * Archetype detection (Layer 48) asks "what kind of manipulation";
 * this asks "what kind of text is this in the first place?"
 */

const GENRES = [
  {
    id: 'news-headline',
    label: 'News headline / lede',
    patterns: [
      /^[A-Z][^.!?]{20,160}$/m,                // single title-cased sentence
      /\b(?:reportedly|sources say|according to|officials said)\b/i,
      /\b(?:on (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/i,
      /\b(?:Reuters|AP|BBC|CNN|NYT|Bloomberg)\b/,
    ],
  },
  {
    id: 'ad-copy',
    label: 'Advertising / marketing copy',
    patterns: [
      /\b(?:sign up|free trial|limited time|get started|shop now|subscribe)\b/i,
      /\b(?:save \$?\d+|off\s+(?:with|when|today))\b/i,
      /\b(?:unlock|discover|transform|level up|join the|the #1)\b/i,
      /[🎁✨💯🔥⚡]/,
    ],
  },
  {
    id: 'political-speech',
    label: 'Political speech / op-ed',
    patterns: [
      /\b(?:my fellow (?:Americans|citizens)|our nation|the American people|democracy|freedom|liberty)\b/i,
      /\b(?:tonight|today|in this moment|at this hour)\b/i,
      /\b(?:(?:left|right|party|government|establishment)[- ](?:wing|line|agenda))\b/i,
      /\bwe (?:will|must|shall) (?:never|always|stand|fight|defend)\b/i,
    ],
  },
  {
    id: 'personal-message',
    label: 'Personal message (chat / DM / email)',
    patterns: [
      /\b(?:hey|hi|hello|hiya|yo|sup)\b/i,
      /\b(?:thx|thanks|ty|lol|haha|ok|k)\b/i,
      /\b(?:tomorrow|tonight|later|this weekend|next week)\b/i,
      /\?\s*$/,
    ],
  },
  {
    id: 'customer-support',
    label: 'Customer-support template',
    patterns: [
      /\b(?:thank you for contacting|we apologize|ticket (?:#|number)|please allow \d+[- ]\d* (?:hours|business days))\b/i,
      /\b(?:at this time|we are unable|we understand|we appreciate)\b/i,
      /\b(?:reference number|case id|case number)\b/i,
    ],
  },
  {
    id: 'academic',
    label: 'Academic / technical prose',
    patterns: [
      /\b(?:et al|ibid|cf\.)\b/i,
      /\b(?:the present study|we observe|we argue|we contend|in this (?:paper|work|study))\b/i,
      /\b(?:p\s?<\s?0\.\d|confidence interval|null hypothesis)\b/i,
      /\b(?:section \d|fig(?:ure)? \d|table \d)\b/i,
    ],
  },
  {
    id: 'dating-profile',
    label: 'Dating profile / intro',
    patterns: [
      /\b(?:looking for|seeking|my ideal|i'?m into|love to|hmu|dm me)\b/i,
      /\b(?:\d+ (?:miles|km) away|based in|just moved to)\b/i,
      /\b(?:ENFJ|INFP|Virgo|Pisces|Taurus|Leo|6[']? \d|6 foot)\b/i,
    ],
  },
  {
    id: 'legalese',
    label: 'Legal / terms-of-service',
    patterns: [
      /\b(?:hereinafter|notwithstanding|pursuant to|subject to the terms|in accordance with)\b/i,
      /\b(?:shall|hereby|thereof|whereas|heretofore)\b/i,
      /\b(?:indemnify|warrant|represent|covenant)\b/i,
    ],
  },
  {
    id: 'corporate-allhands',
    label: 'Corporate all-hands / memo',
    patterns: [
      /\b(?:team|organization|mission|north star|q\d|quarterly|leadership team|rollout)\b/i,
      /\b(?:as we (?:grow|scale|head into)|going forward|in the coming (?:weeks|months|quarter))\b/i,
      /\b(?:excited to (?:announce|share)|proud to (?:announce|share)|thrilled to)\b/i,
    ],
  },
];

function countMatches(text, patterns) {
  return patterns.reduce((n, re) => n + ((text.match(re) || []).length), 0);
}

/**
 * Returns sorted [{id, label, score, share}] where share sums to 1.
 * Also exposes `primary` (top match) and `signalStrength` (raw hit
 * count across all genres — low signal means "not much to go on").
 */
export function classifyGenre(text = '') {
  const t = String(text || '');
  if (t.trim().length < 20) {
    return {
      primary: { id: 'unknown', label: 'Too short', score: 0 },
      ranked: [],
      signalStrength: 0,
    };
  }
  const raw = GENRES.map((g) => ({
    id: g.id,
    label: g.label,
    score: countMatches(t, g.patterns),
  }));
  const total = raw.reduce((a, g) => a + g.score, 0);
  const ranked = raw
    .map((g) => ({ ...g, share: total > 0 ? g.score / total : 0 }))
    .sort((a, b) => b.score - a.score);
  const primary = ranked[0]?.score > 0 ? ranked[0] : { id: 'unknown', label: 'No strong genre signal', score: 0, share: 0 };
  return { primary, ranked, signalStrength: total };
}

export const GENRE_CATALOG = GENRES;
