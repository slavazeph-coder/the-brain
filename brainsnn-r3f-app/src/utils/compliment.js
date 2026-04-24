/**
 * Layer 79 — Compliment Detector
 *
 * The inverse of the Firewall. Detects genuine positive regard and
 * distinguishes it from love-bombing (Layer 39 template). "Specific +
 * observed + bounded" scores high; "superlative + unconditional +
 * premature" tilts toward love-bombing.
 *
 * Not a sentiment classifier — those are blunt. This is a small
 * pattern set for the specific question "does this read like
 * real appreciation or recruitment?"
 */

const GENUINE_PATTERNS = [
  // Specificity markers
  /\bI (?:noticed|liked|appreciated) (?:how|when|that)\b/gi,
  /\b(?:the|your) (?:specific|particular|recent)\b/gi,
  /\bwhen you (?:said|did|handled|chose)\b/gi,
  // Observation framing
  /\bhere[’']?s what stood out\b/gi,
  /\b(?:in that|during the|at the) (?:meeting|call|session|project|review)\b/gi,
  // Bounded, not maximalist
  /\bone of the (?:best|better|most thoughtful)\b/gi,
  // Gratitude markers that aren't empty
  /\bthank you for (?:the|your|taking|sharing|explaining)\b/gi,
  /\bappreciate(?:d)? (?:the|your|how)\b/gi,
];

const LOVE_BOMBING_PATTERNS = [
  /\byou[’']?re the (?:most|best|only|perfect|greatest)\b/gi,
  /\b(?:never|no one) (?:met|seen|felt) anyone like you\b/gi,
  /\bsoul ?mates?\b|\bmade for each other\b/gi,
  /\byou[’']?re perfect\b|\bthe one\b/gi,
  /\b(?:unconditional|infinite|endless) love\b/gi,
  /\bI (?:love|adore|worship) everything (?:about you|you do)\b/gi,
  /\bfrom (?:the moment|day one)\b/gi,
];

const HEDGING_MARKERS = [
  /\b(?:to be fair|that said|in context|though|albeit|even if)\b/gi,
];

function countMatches(text, patterns) {
  return patterns.reduce((t, re) => t + ((text.match(re) || []).length), 0);
}

function clamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }

export function scoreCompliment(text = '') {
  const t = String(text || '');
  if (t.trim().split(/\s+/).length < 6) {
    return {
      genuineness: 0,
      loveBombingRisk: 0,
      specificityHits: 0,
      maximalistHits: 0,
      hedgingHits: 0,
      verdict: 'Too short',
      color: '#94a3b8',
    };
  }
  const specificity = countMatches(t, GENUINE_PATTERNS);
  const maximalism = countMatches(t, LOVE_BOMBING_PATTERNS);
  const hedging = countMatches(t, HEDGING_MARKERS);

  const words = t.split(/\s+/).filter(Boolean).length;
  const specRate = specificity / Math.max(1, words / 30);
  const maxRate = maximalism / Math.max(1, words / 30);
  const hedgeRate = hedging / Math.max(1, words / 40);

  // Genuineness: specificity + hedging + absence of maximalism
  const genuineness = clamp(0.3 + specRate * 0.35 + hedgeRate * 0.25 - maxRate * 0.45);
  const loveBombingRisk = clamp(maxRate * 0.7 + (maximalism >= 2 ? 0.2 : 0));

  let verdict;
  let color;
  if (loveBombingRisk >= 0.5) {
    verdict = 'Love-bombing risk';
    color = '#dd6974';
  } else if (genuineness >= 0.7) {
    verdict = 'Grounded appreciation';
    color = '#5ee69a';
  } else if (genuineness >= 0.45) {
    verdict = 'Warm but generic';
    color = '#77dbe4';
  } else {
    verdict = 'Flat';
    color = '#94a3b8';
  }

  return {
    genuineness: +genuineness.toFixed(3),
    loveBombingRisk: +loveBombingRisk.toFixed(3),
    specificityHits: specificity,
    maximalistHits: maximalism,
    hedgingHits: hedging,
    verdict,
    color,
  };
}

export const COMPLIMENT_EXAMPLES = [
  {
    label: 'Grounded',
    text: "I noticed how you handled the review — specifically when you disagreed with me on the pricing section, you did it without making it personal. That's one of the best conflict moments I've seen on this team.",
  },
  {
    label: 'Generic warm',
    text: "Great job on the project! You're really talented and hardworking. Keep it up!",
  },
  {
    label: 'Love-bombing',
    text: "You're the most incredible person I've ever met. I've never felt anything like this. We're soulmates — made for each other from the moment we met. You're perfect.",
  },
];
