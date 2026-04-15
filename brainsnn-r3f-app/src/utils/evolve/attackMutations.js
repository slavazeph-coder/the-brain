/**
 * Layer 32 — Attack Evolve : String-level mutation operators
 *
 * These mutate a single attack string (a piece of manipulative text) into a
 * variant that might slip past the firewall. The counterpart to Layer 31's
 * rule-level mutations. Together the two form a co-evolution loop:
 *
 *   - Layer 31 evolves REGEX to catch attacks
 *   - Layer 32 evolves ATTACKS to dodge regex
 *   - Promoting an evolved attack into the red team corpus gives Layer 31
 *     a harder target, which forces its rules to broaden, etc.
 *
 * Cannibalized conceptually from ASI-Evolve: their `pipeline/explorer` loop
 * mutates prompts to find inputs that expose failure modes. Here the
 * "failure mode" is firewall evasion.
 *
 * Each operator returns `{ text, note, operator }`.
 */

// ---------- synonym / softening dictionaries ----------
// Map strong trigger words → blander synonyms. Lose the trigger, keep the
// semantic load. Kept small + deterministic so evolved attacks stay readable.
const SOFTEN = {
  urgent: 'time-sensitive',
  immediately: 'as soon as you can',
  now: 'soon',
  breaking: 'new',
  alert: 'note',
  warning: 'heads-up',
  crisis: 'situation',
  shocking: 'notable',
  outrage: 'frustration',
  disgusting: 'unpleasant',
  horrible: 'bad',
  terrible: 'difficult',
  scandal: 'incident',
  betrayal: 'disappointment',
  virus: 'pathogen',
  pandemic: 'outbreak',
  attack: 'event',
  war: 'conflict',
  danger: 'risk',
  threat: 'concern',
  collapse: 'decline',
  kill: 'harm',
  death: 'loss',
  die: 'suffer',
  unsafe: 'risky',
  proven: 'supported',
  guaranteed: 'assured',
  'everyone knows': 'many people believe',
  obviously: 'arguably',
  clearly: 'reasonably',
  undeniably: 'notably',
  secret: 'quiet',
  hidden: 'unannounced',
  'covered up': 'not discussed',
  furious: 'upset'
};

// Benign wrappers that dilute signature density by adding non-trigger tokens.
const BENIGN_WRAPPERS = [
  (s) => `Just sharing this for context: ${s} Thanks for reading.`,
  (s) => `FYI — my neighbor mentioned that ${s.toLowerCase()} Not sure what to make of it.`,
  (s) => `Interesting article I came across: "${s}" Curious what you think.`,
  (s) => `From the quarterly newsletter: ${s} The authors cite several sources.`,
  (s) => `Saw this on a discussion board: ${s} Posting for reference only.`,
  (s) => `Per the attached document (page 3): ${s} The methodology seems standard.`
];

// ---------- helpers ----------

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Case-insensitive word replacement preserving surrounding whitespace.
function replaceWord(text, word, replacement) {
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
  return text.replace(re, replacement);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

// ---------- operators ----------

/**
 * Dilute the attack by wrapping it in benign framing. Lowers match density
 * because the total word count grows while triggers stay constant.
 */
export function injectBenign(text) {
  const wrapper = pickRandom(BENIGN_WRAPPERS);
  return {
    text: wrapper(text),
    note: 'wrapped in benign framing'
  };
}

/**
 * Replace detected trigger words with softened synonyms. Attacks that had
 * "urgent!! 100% proven scandal" become "time-sensitive. supported incident."
 * — same structure, drained of regex bait.
 */
export function substituteSynonyms(text) {
  let out = text;
  const replacements = [];
  // Shuffle keys to avoid bias toward first-dictionary-entry replacement
  const keys = Object.keys(SOFTEN).sort(() => Math.random() - 0.5);
  for (const key of keys) {
    if (replacements.length >= 3) break;
    const before = out;
    out = replaceWord(out, key, SOFTEN[key]);
    if (before !== out) replacements.push(key);
  }
  return {
    text: out,
    note: replacements.length
      ? `softened: ${replacements.join(', ')}`
      : 'no synonyms matched'
  };
}

/**
 * Zero-width + hyphen-split common trigger words so regex word boundaries
 * fail to match. "urgent" → "u-r-g-e-n-t". Still readable to a human.
 */
export function letterSplit(text) {
  const targets = [
    'urgent',
    'now',
    'breaking',
    'shocking',
    'scandal',
    'danger',
    'threat',
    'collapse',
    'proven',
    'guaranteed',
    'fact',
    'secret'
  ];
  const target = pickRandom(targets);
  const re = new RegExp(`\\b${target}\\b`, 'i');
  const match = text.match(re);
  if (!match) return { text, note: `letter-split: no '${target}'` };
  const split = target.split('').join('-');
  const out = text.replace(re, split);
  return { text: out, note: `split '${target}' → '${split}'` };
}

/**
 * Shuffle sentence order. Changes how locality-aware patterns (adjacent
 * trigger pairs) trip. Cheap, often surprisingly effective.
 */
export function reorderSentences(text) {
  const sentences = splitSentences(text);
  if (sentences.length < 2) return { text, note: 'single sentence' };
  const shuffled = [...sentences].sort(() => Math.random() - 0.5);
  return { text: shuffled.join(' '), note: `reordered ${sentences.length} sentences` };
}

/**
 * Remove the most-triggering word entirely. Sacrifices a bit of semantic
 * punch to avoid firewall detection.
 */
export function dropTrigger(text) {
  const triggers = [
    'urgent',
    'immediately',
    'now',
    'breaking',
    'shocking',
    'scandal',
    'outrage',
    'horrible',
    'terrible',
    'disgusting',
    'unbelievable',
    '100%',
    'proven',
    'guaranteed',
    'everyone knows'
  ];
  for (const t of triggers) {
    const re = new RegExp(`\\b${escapeRegex(t)}\\b\\s*`, 'i');
    if (re.test(text)) {
      return { text: text.replace(re, ''), note: `dropped '${t}'` };
    }
  }
  return { text, note: 'no triggers to drop' };
}

/**
 * Two-parent combo: take the first half of one attack + second half of the
 * other. Creates hybrid signatures.
 */
export function crossoverAttacks(parentA, parentB) {
  const a = parentA.text.split(/\s+/);
  const b = parentB.text.split(/\s+/);
  if (a.length < 4 || b.length < 4) {
    return { text: parentA.text, note: 'too short for crossover' };
  }
  const midA = Math.floor(a.length / 2);
  const midB = Math.floor(b.length / 2);
  const hybrid = [...a.slice(0, midA), ...b.slice(midB)].join(' ');
  return {
    text: hybrid,
    note: `crossover ${parentA.id.slice(0, 4)} × ${parentB.id.slice(0, 4)}`
  };
}

// ---------- public operator list ----------

export const ATTACK_OPERATORS = [
  { key: 'injectBenign', label: 'inject-benign', fn: injectBenign },
  { key: 'substituteSynonyms', label: 'soften-synonyms', fn: substituteSynonyms },
  { key: 'letterSplit', label: 'letter-split', fn: letterSplit },
  { key: 'reorderSentences', label: 'reorder', fn: reorderSentences },
  { key: 'dropTrigger', label: 'drop-trigger', fn: dropTrigger }
];

export function applyRandomAttackMutation(parent) {
  const op = ATTACK_OPERATORS[Math.floor(Math.random() * ATTACK_OPERATORS.length)];
  const result = op.fn(parent.text);
  return { ...result, operator: op.key };
}
