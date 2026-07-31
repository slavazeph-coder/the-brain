// Persuasion-technique detection against the published taxonomy.
//
// The firewall's original tactic list has four entries, and only one of them
// (fear-pressure) maps cleanly onto a class anyone else has defined. That makes
// its output hard to check: you cannot compare "certainty theater" against a
// corpus nobody has annotated for it.
//
// This detector uses technique names from the SemEval propaganda / persuasion
// tasks (SemEval-2020 Task 11 "PTC" and SemEval-2023 Task 3), so a detection is
// comparable against published annotation and published baselines. Each
// technique carries the class it maps to AND how honest that mapping is:
//
//   mapping: 'exact'       — the class name is taken verbatim from the taxonomy
//   mapping: 'approximate' — a variant we detect that the taxonomy folds into a
//                            broader class, or splits differently
//
// The split matters. Claiming coverage of a published class you only partly
// approximate is exactly the kind of borrowed credibility this codebase is
// meant to avoid, so `coveredClasses()` reports only the exact ones.
//
// Detection is deterministic and mostly lexical — cue phrases, not a trained
// classifier. That is a real ceiling on recall (published systems are
// transformer models) and it is stated in DETECTOR_LIMITS rather than implied
// away. What it buys is a signal that is explainable per match, reproducible,
// and free to run in the browser. One technique (Repetition) is structural
// rather than lexical, because repetition has no cue phrase to look for.
import { splitIntoSegments } from './validation.js';

// Words too common to count as deliberate repetition.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'for', 'is', 'it', 'its',
  'be', 'are', 'was', 'were', 'this', 'that', 'these', 'those', 'with', 'as', 'at', 'by', 'from',
  'you', 'your', 'we', 'our', 'i', 'they', 'their', 'he', 'she', 'his', 'her', 'them', 'has',
  'have', 'had', 'will', 'would', 'can', 'could', 'do', 'does', 'did', 'not', 'no', 'so', 'up',
]);

const MIN_REPEATS = 3;

/**
 * Structural detector for the Repetition class: the same distinctive word or
 * short phrase hammered several times. No cue list can catch this, which is
 * why it gets its own detector rather than a pattern array.
 */
function detectRepetition(text) {
  const tokens = String(text || '').toLowerCase().match(/[a-z']+/g) || [];
  const content = tokens.filter((token) => token.length > 3 && !STOPWORDS.has(token));
  const counts = new Map();
  for (const token of content) counts.set(token, (counts.get(token) || 0) + 1);
  // Repeated adjacent pairs count too — "it's gone, it's gone" is repetition
  // even when each word alone is common.
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    counts.set(bigram, (counts.get(bigram) || 0) + 1);
  }
  const repeated = [...counts.entries()]
    .filter(([phrase, n]) => n >= MIN_REPEATS && (phrase.includes(' ') ? n >= MIN_REPEATS : true))
    .sort((a, b) => b[1] - a[1]);
  if (!repeated.length) return [];
  // Report one entry per excess occurrence so confidence scales with insistence.
  return repeated.flatMap(([phrase, n]) => Array.from({ length: n - 1 }, () => phrase));
}

/**
 * Each technique: the published class it corresponds to, how exact that
 * correspondence is, cue patterns (or a structural detector), and a short
 * description of what the reader is being pushed by.
 */
export const TECHNIQUES = Object.freeze([
  {
    id: 'appeal-to-fear',
    label: 'Appeal to fear',
    published: 'Appeal to Fear/Prejudice',
    mapping: 'exact',
    weight: 1,
    description: 'Threatens a bad outcome to force the decision.',
    patterns: [
      /\b(?:danger|dangerous|disaster|catastroph\w*|destroy\w*|devastat\w*|irreversible)\b/gi,
      /\b(?:before it'?s too late|or you'?ll lose|risk losing|at risk of|will be (?:permanently )?(?:deleted|closed|suspended|terminated)|suspended due to|suspicious activity)\b/gi,
      /\b(?:terrif\w+|frighten\w+|scared|panic|silently (?:destroy|kill|damag)\w*)\b/gi,
    ],
  },
  {
    id: 'loaded-language',
    label: 'Loaded language',
    published: 'Loaded Language',
    mapping: 'exact',
    weight: 0.9,
    description: 'Emotionally charged wording substituting for argument.',
    patterns: [
      /\b(?:disgusting|shocking|outrageous|horrifying|disgraceful|shameful|appalling|sickening)\b/gi,
      /\b(?:corrupt|rigged|betray\w*|scandal\w*|evil|toxic|quietly (?:banning|removing|burying))\b/gi,
    ],
  },
  {
    id: 'name-calling',
    label: 'Name calling / labelling',
    published: 'Name Calling, Labeling',
    mapping: 'exact',
    weight: 0.8,
    description: 'Attaches a label instead of making an argument.',
    patterns: [
      /\b(?:sheep|shills?|grifters?|frauds?|liars?|clowns?|puppets?|parasites?)\b/gi,
      /\b(?:the (?:elites?|establishment|mainstream media)|big (?:pharma|tech|food))\b/gi,
    ],
  },
  {
    id: 'exaggeration',
    label: 'Exaggeration / minimisation',
    published: 'Exaggeration, Minimisation',
    mapping: 'exact',
    weight: 0.7,
    description: 'Overstates or understates scale beyond what evidence supports.',
    patterns: [
      // "all of them" is deliberately absent: it reads as exaggeration in a
      // cue list but is benign in ordinary prose, and precision wins here.
      /\b(?:never|always|everyone|nobody|no one)\b/gi,
      /\b(?:revolutionary|game[- ]?chang\w+|unprecedented|world[- ]class|ultimate|the best|massive|explosive)\b/gi,
      /\b(?:changes everything|nothing will ever)\b/gi,
      // Minimisation: making the ask sound smaller than it is.
      /\b(?:simply |just )(?:confirm|send|pay|click|share|reply)|\b(?:small (?:processing )?(?:fee|charge|payment)|tiny (?:fee|cost)|all you (?:have to|need to) do|nothing more than)\b/gi,
    ],
  },
  {
    id: 'doubt',
    label: 'Casting doubt',
    published: 'Doubt',
    mapping: 'exact',
    weight: 0.8,
    description: 'Undermines a source or authority without evidence.',
    patterns: [
      /\b(?:they don'?t want you to|what they'?re not telling you|hiding (?:the )?truth|wake up|do your own research|hoping you won'?t notice)\b/gi,
      /\b(?:so[- ]called|allegedly|supposed(?:ly)? experts?)\b/gi,
    ],
  },
  {
    id: 'bandwagon',
    label: 'Bandwagon / appeal to popularity',
    published: 'Bandwagon, Appeal to Popularity',
    mapping: 'exact',
    weight: 0.7,
    description: 'Urges agreement because others already agree.',
    patterns: [
      /\b(?:everyone(?: else)? (?:is|has|knows|agrees)|join (?:the )?(?:thousands|millions|others)|don'?t be (?:the )?last)\b/gi,
      /\b(?:the smart money|serious people|people like you are)\b/gi,
    ],
  },
  {
    id: 'appeal-to-authority',
    label: 'Appeal to authority',
    published: 'Appeal to Authority',
    mapping: 'exact',
    weight: 0.6,
    description: 'Leans on status rather than evidence.',
    patterns: [
      /\b(?:experts? (?:agree|say|confirm)|doctors? (?:agree|say|recommend|are)|scientists? (?:agree|say)|studies show)\b/gi,
      /\b(?:scientifically proven|clinically proven|award[- ]winning)\b/gi,
    ],
  },
  {
    id: 'thought-terminating',
    label: 'Thought-terminating cliché',
    published: 'Thought-terminating Cliché',
    mapping: 'exact',
    weight: 0.8,
    description: 'Shuts down consideration instead of answering it.',
    patterns: [
      /\b(?:it is what it is|end of story|no further questions|that'?s just how it is|case closed|consider(?:s)? this matter closed)\b/gi,
      /\b(?:if you (?:have to|need to) (?:ask|think about it)|this isn'?t for you)\b/gi,
    ],
  },
  {
    id: 'false-dilemma',
    label: 'False dilemma / no choice',
    published: 'Black-and-White Fallacy, Dictatorship',
    mapping: 'exact',
    weight: 0.8,
    description: 'Presents two options when more exist, or none at all.',
    patterns: [
      /\b(?:either you|you'?re either)\b[^.!?]{0,60}\bor\b/gi,
      /\b(?:within \d+ hours? or|now or never|no other (?:option|choice)|there is no alternative|you have no choice)\b/gi,
      /\b(?:verify|confirm|respond|act)\b[^.!?]{0,40}\bor your\b[^.!?]{0,40}\b(?:will be|gets?)\b/gi,
    ],
  },
  {
    id: 'obfuscation',
    label: 'Obfuscation / intentional vagueness',
    published: 'Obfuscation, Intentional Vagueness, Confusion',
    mapping: 'exact',
    weight: 0.7,
    description: 'Blurs who did what, so nothing can be checked.',
    patterns: [
      /\b(?:some customers|certain (?:users|parties|individuals)|recent events|any inconvenience|may have (?:felt|been|experienced))\b/gi,
      /\b(?:mistakes were made|issues (?:were|have been) identified|steps (?:are|have) being taken|we remain committed)\b/gi,
      /\b(?:the highest standards|industry[- ]leading|best[- ]in[- ]class)\b/gi,
    ],
  },
  {
    id: 'appeal-to-time',
    label: 'Appeal to time / manufactured scarcity',
    published: 'Appeal to Time',
    mapping: 'exact',
    weight: 0.9,
    description: 'Invents a deadline to compress the decision.',
    patterns: [
      /\b(?:only \d+ (?:left|remain\w*|spots?|seats?)|while (?:supplies|stocks) last|limited time|last chance|final (?:call|hours?)|never be repeated)\b/gi,
      /\b(?:doors close|closing (?:tonight|today|soon)|act (?:now|fast|today)|order (?:now|today|within)|click here immediately)\b/gi,
      // A deadline with no stated reason. "closes on 30 November because the
      // cohort starts in December" is a real date and must not match here.
      /\b(?:closes? (?:this|next) (?:week|weekend|month)|only \w+ (?:were|was) ever (?:made|produced|released)|won'?t be (?:offered|available) again)\b/gi,
    ],
  },
  {
    id: 'repetition',
    label: 'Repetition',
    published: 'Repetition',
    mapping: 'exact',
    weight: 0.6,
    description: 'Hammers the same word or phrase to make it feel settled.',
    detect: detectRepetition,
  },
  {
    id: 'guilt-appeal',
    label: 'Shame or guilt appeal',
    published: 'Appeal to Fear/Prejudice',
    mapping: 'approximate',
    mappingNote: 'The taxonomy folds shame framing into the broader fear/prejudice class.',
    weight: 0.8,
    description: 'Implies the reader is deficient for hesitating.',
    patterns: [
      /\b(?:if you'?re not ready to|excuses|stop making excuses|don'?t come back|serious people only|not for everyone)\b/gi,
      /\b(?:you owe it to yourself|what'?s your excuse)\b/gi,
    ],
  },
  {
    id: 'prize-lure',
    label: 'Prize lure / manufactured reward',
    published: 'Loaded Language',
    mapping: 'approximate',
    mappingNote: 'Reward framing is a social-engineering cue with no dedicated class in the taxonomy.',
    weight: 0.9,
    description: 'Dangles a windfall the reader did nothing to earn.',
    patterns: [
      /\b(?:congratulations|you have been (?:selected|chosen)|you'?ve won|lucky winner|final winner|grand prize)\b/gi,
      /\b(?:claim your (?:prize|reward|funds)|release your (?:prize|funds)|sweepstakes|unclaimed (?:funds|balance))\b/gi,
    ],
  },
]);

function countMatches(text, technique) {
  if (typeof technique.detect === 'function') return technique.detect(text);
  const matches = [];
  for (const pattern of technique.patterns) {
    const found = String(text || '').match(pattern);
    if (found) matches.push(...found.map((match) => match.trim().toLowerCase()));
  }
  return matches;
}

/**
 * Detect techniques in a passage.
 * Returns one entry per technique found, each with the exact phrases that
 * triggered it and the sentences they came from, so a detection is always
 * explainable rather than an opaque score.
 */
export function detectTechniques(content) {
  const text = String(content || '');
  if (!text.trim()) return [];
  const sentences = splitIntoSegments(text);

  const detected = [];
  for (const technique of TECHNIQUES) {
    const matches = countMatches(text, technique);
    if (!matches.length) continue;
    const unique = [...new Set(matches)];
    const locations = sentences
      .map((sentence, index) => ({ index, sentence }))
      .filter(({ sentence }) => countMatches(sentence, technique).length > 0)
      .map(({ index }) => index);
    detected.push({
      id: technique.id,
      label: technique.label,
      published: technique.published,
      mapping: technique.mapping,
      mappingNote: technique.mappingNote || '',
      description: technique.description,
      matches: unique.slice(0, 6),
      hits: matches.length,
      sentences: locations,
      // Confidence rises with repetition but saturates: three cues is a
      // pattern, ten is not three times more certain.
      confidence: Math.round(Math.min(1, 0.45 + 0.18 * Math.log2(matches.length + 1)) * technique.weight * 100),
    });
  }
  return detected.sort((a, b) => b.confidence - a.confidence);
}

/**
 * A single 0-100 pressure score derived from the techniques present.
 * Distinct techniques count for more than repetition of one, since variety of
 * pressure is what distinguishes a manipulative passage from an emphatic one.
 */
export function techniquePressure(content) {
  const detected = detectTechniques(content);
  if (!detected.length) return { score: 0, techniques: [], distinct: 0 };
  const weighted = detected.reduce((sum, entry) => sum + entry.confidence / 100, 0);
  const variety = Math.min(1, detected.length / 4);
  const score = Math.round(Math.min(100, (weighted * 22 + variety * 38)));
  return { score, techniques: detected, distinct: detected.length };
}

/**
 * Published class names this detector claims verbatim coverage of.
 * Approximate mappings are deliberately excluded — see `approximateTechniques`.
 */
export function coveredClasses() {
  return [...new Set(TECHNIQUES.filter((t) => t.mapping === 'exact').map((t) => t.published))];
}

/** Techniques whose published mapping is a stretch, with the reason why. */
export function approximateTechniques() {
  return TECHNIQUES.filter((t) => t.mapping === 'approximate')
    .map(({ id, label, published, mappingNote }) => ({ id, label, published, mappingNote }));
}

export const DETECTOR_LIMITS = 'Lexical cue detection, not a trained classifier. '
  + 'Precision is favoured over recall: paraphrased or novel phrasings of a technique will be missed. '
  + 'Class names follow the SemEval propaganda/persuasion taxonomies so results are comparable to published annotation, '
  + 'and techniques whose mapping is approximate rather than verbatim are marked as such.';
