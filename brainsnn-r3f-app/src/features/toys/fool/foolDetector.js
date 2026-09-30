// Fool the Detector — rules and scoring.
//
// The detector being fooled is the real one: the same lexical cue detector the
// analyzer, the firewall and Defend the Brain use, running in the browser. Its
// weaknesses are published on /evidence — on 17 held-out passages it missed all
// four techniques written in paraphrase — and this game is a playable version
// of that finding. Players are on their honour to actually use the trick; the
// detector cannot know intent, and the game says so instead of pretending.
import { DETECTOR_LIMITS, detectTechniques, TECHNIQUES } from '../../../lib/persuasionTechniques.js';

export const FOOL_MIN_WORDS = 5;
export const FOOL_MAX_CHARS = 240;
export const ROUND_POINTS = 20;

const LABELS = Object.fromEntries(TECHNIQUES.map((technique) => [technique.id, technique.label]));

/**
 * Five rounds that escalate by stacking tricks: one, one, one, two at once,
 * three at once. The more tricks in a line, the more chances the detector has.
 * `caught` is a line the detector does flag — shown so players know what
 * "obvious" looks like before they try to be subtle.
 */
export const FOOL_ROUNDS = Object.freeze([
  {
    id: 'deadline',
    title: 'Invent a deadline',
    brief: 'Make the reader feel they have to decide right now.',
    targets: ['appeal-to-time'],
    caught: 'Only 3 spots left — the offer ends tonight, so act now.',
  },
  {
    id: 'crowd',
    title: 'Everyone is doing it',
    brief: 'Make them feel everybody else has already said yes.',
    targets: ['bandwagon'],
    caught: "Everyone else has already joined. Don't be the last.",
  },
  {
    id: 'fear',
    title: 'Make them afraid',
    brief: 'Threaten something bad if they do not act.',
    targets: ['appeal-to-fear'],
    caught: "Your account will be suspended before it's too late.",
  },
  {
    id: 'double',
    title: 'Two at once',
    brief: 'A deadline and a crowd, in one line.',
    targets: ['appeal-to-time', 'bandwagon'],
    caught: 'Join thousands of others — the doors close tonight.',
  },
  {
    id: 'squeeze',
    title: 'The full squeeze',
    brief: 'Deadline, crowd and fear. One line. Get all three past it.',
    targets: ['appeal-to-time', 'bandwagon', 'appeal-to-fear'],
    caught: 'Everyone is switching. Act now or risk losing everything.',
  },
]);

export const FOOL_RANKS = Object.freeze([
  { min: 100, title: 'Prompt Ninja', line: 'Every trick got through. The detector saw nothing.' },
  { min: 80, title: 'Ghost', line: 'Barely a trace. The detector mostly looked straight through you.' },
  { min: 60, title: 'Ghostwriter', line: 'More slipped past than got caught.' },
  { min: 40, title: 'Spin Doctor', line: 'Half in, half out. The detector knows some of your moves.' },
  { min: 20, title: 'Smooth Talker', line: 'A few got by. Most were named on sight.' },
  { min: 0, title: 'Open Book', line: 'The detector read every trick. Try saying it the long way round.' },
]);

export const FOOL_HONESTY = 'You are on your honour to actually use the trick — the detector cannot tell what you meant, only what you wrote.';
export const FOOL_BOUNDARY = 'Model scores describe their tested conditions; they do not establish universal capability.';
export { DETECTOR_LIMITS };

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** Why a line cannot be judged yet, or '' if it can. */
export function validateLine(text) {
  const clean = String(text || '').trim();
  if (wordCount(clean) < FOOL_MIN_WORDS) return `Write at least ${FOOL_MIN_WORDS} words.`;
  if (clean.length > FOOL_MAX_CHARS) return `Keep it under ${FOOL_MAX_CHARS} characters.`;
  return '';
}

/**
 * Judge one line against one round.
 * Each target that slips past earns its share of the round's 20 points. If the
 * detector flagged something else instead, the slipped targets earn half —
 * it noticed pressure, even if it named the wrong trick.
 */
export function judgeRound(round, text) {
  const problem = validateLine(text);
  if (problem) return { valid: false, reason: problem };
  const clean = String(text).trim();
  const detected = detectTechniques(clean);
  const ids = new Set(detected.map((entry) => entry.id));
  const caught = round.targets.filter((target) => ids.has(target));
  const others = detected.filter((entry) => !round.targets.includes(entry.id));
  const slipped = round.targets.length - caught.length;
  let points = slipped * (ROUND_POINTS / round.targets.length);
  if (slipped > 0 && others.length) points *= 0.5;
  points = Math.round(points);

  let outcome = 'slipped';
  if (caught.length === round.targets.length) outcome = 'caught';
  else if (caught.length || others.length) outcome = 'partial';

  return {
    valid: true,
    roundId: round.id,
    outcome,
    points,
    caught: caught.map((id) => LABELS[id] || id),
    slippedTargets: round.targets.filter((target) => !ids.has(target)).map((id) => LABELS[id] || id),
    flagged: detected.map((entry) => ({ id: entry.id, label: entry.label, matches: entry.matches.slice(0, 3) })),
  };
}

export function rankFor(score) {
  return FOOL_RANKS.find((rank) => score >= rank.min) || FOOL_RANKS[FOOL_RANKS.length - 1];
}

/** Totals for a finished (or partial) game. */
export function summarizeGame(results) {
  const judged = results.filter((result) => result?.valid);
  const score = Math.min(100, judged.reduce((sum, result) => sum + result.points, 0));
  const slipped = judged.filter((result) => result.outcome === 'slipped').length;
  const caught = judged.filter((result) => result.outcome === 'caught').length;
  const rank = rankFor(score);
  return {
    score,
    slipped,
    caught,
    partial: judged.length - slipped - caught,
    rounds: judged.length,
    rank: rank.title,
    rankLine: rank.line,
    finished: judged.length === FOOL_ROUNDS.length,
  };
}
