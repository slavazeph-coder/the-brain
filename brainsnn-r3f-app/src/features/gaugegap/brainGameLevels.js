// Levels for the 3D game.
//
// Two sources, deliberately:
//
//   Curated — hand-picked archetypes from the labelled calibration corpus, so a
//   first-time visitor gets a difficulty curve instead of a blank textarea. They
//   are real corpus items, not bespoke game content, which means the level a
//   player fights is the same text the calibration harness is scored against.
//
//   Your own text — paste anything and the detector builds the level from what
//   it finds. This is the point of the whole exercise: the things attacking the
//   brain are the persuasion techniques actually present in your writing.
//
// A level is a pure data structure. Nothing here touches React or three.
import { detectTechniques } from '../../lib/persuasionTechniques.js';
import { CALIBRATION_CORPUS } from '../../lib/calibrationCorpus.js';
import { MISSION, CHALLENGE } from './brainGame.js';
import { buildPacketSchedule } from './brainGame3d.js';

/**
 * The curated ladder. Ordered by how hard the passage actually is to defend,
 * which is not the same as its manipulation label — a passage with four
 * different techniques on three different routes is harder than a more
 * manipulative one that only attacks through the threat loop.
 *
 * `honest: true` marks the hold-your-fire levels. They contain little or
 * nothing for the detector to find, and spending budget on them costs you
 * efficiency — the game's way of teaching that a null result is not a licence
 * to intervene.
 */
export const CURATED_LEVELS = Object.freeze([
  { id: 'plain-status-update', title: 'Warm-up: an honest notice', corpusId: 'plain-status-update', honest: true, blurb: 'Nothing is attacking. Spending budget here only costs you.' },
  { id: 'countdown-flash-sale', title: 'Deadline pressure', corpusId: 'countdown-flash-sale', blurb: 'Manufactured time pressure down the threat loop.' },
  { id: 'account-phishing-email', title: 'The phishing email', corpusId: 'account-phishing-email', blurb: 'Fear, an ultimatum and a clock, all at once.' },
  { id: 'authority-bandwagon-pitch', title: 'Everyone already agrees', corpusId: 'authority-bandwagon-pitch', blurb: 'Familiarity attacks — cuts will not save you here.' },
  { id: 'corporate-non-apology', title: 'The non-apology', corpusId: 'corporate-non-apology', blurb: 'Vagueness aimed straight at your judgment.' },
  { id: 'outrage-bait-post', title: 'Outrage bait', corpusId: 'outrage-bait-post', blurb: 'Loaded language plus doubt. Two routes at once.' },
  { id: 'fear-health-claim', title: 'The health scare', corpusId: 'fear-health-claim', blurb: 'Authority lending its credibility to a threat.' },
  { id: 'guru-urgency-pitch', title: 'Boss level: the guru pitch', corpusId: 'guru-urgency-pitch', blurb: 'Five techniques across every route. Budget will not stretch.' },
]);

export const MAX_LEVEL_TEXT = 2000;

function corpusItem(corpusId) {
  return CALIBRATION_CORPUS.find((item) => item.id === corpusId) || null;
}

/**
 * Build a playable level from arbitrary text.
 * `seed` keeps the packet schedule reproducible; the same text and seed always
 * produce the same fight, which is what makes a challenge link meaningful.
 */
export function buildLevel({
  text = '',
  id = 'custom',
  title = 'Your text',
  blurb = '',
  seed = null,
  mode = 'mission',
  honest = false,
} = {}) {
  const content = String(text || '').slice(0, MAX_LEVEL_TEXT);
  const techniques = detectTechniques(content);
  const rules = mode === 'challenge' ? CHALLENGE : MISSION;
  const levelSeed = seed || `defend-${id}`;
  const packets = buildPacketSchedule({
    techniques,
    seed: levelSeed,
    durationTicks: rules.durationTicks,
  });

  return {
    id,
    title,
    blurb,
    honest,
    text: content,
    seed: levelSeed,
    techniques,
    packets,
    // A level with no detections is not proof the text is clean — it is the
    // detector finding nothing it has a cue for. Surfaced so the UI can say so
    // rather than implying an all-clear.
    empty: packets.length === 0,
    routes: [...new Set(packets.map((packet) => packet.route))],
  };
}

/** Resolve a curated level id into a playable level. */
export function buildCuratedLevel(levelId, { mode = 'mission' } = {}) {
  const entry = CURATED_LEVELS.find((level) => level.id === levelId) || CURATED_LEVELS[0];
  const item = corpusItem(entry.corpusId);
  if (!item) return null;
  return buildLevel({
    text: item.content,
    id: entry.id,
    title: entry.title,
    blurb: entry.blurb,
    honest: Boolean(entry.honest),
    seed: `defend-${entry.id}`,
    mode,
  });
}

/** Every curated level, built. Used for the level picker and for tests. */
export function buildAllCuratedLevels({ mode = 'mission' } = {}) {
  return CURATED_LEVELS.map((level) => buildCuratedLevel(level.id, { mode })).filter(Boolean);
}

/**
 * A rough difficulty read, used to order the picker and to warn a player that a
 * pasted passage is going to be brutal. Route variety matters more than raw
 * packet count: three packets on three routes need three different answers,
 * while eight on one route need a single cut.
 */
export function levelDifficulty(level) {
  if (!level || !level.packets.length) return { score: 0, label: 'Nothing detected' };
  const routes = new Set(level.packets.map((packet) => packet.route)).size;
  const volume = Math.min(1, level.packets.length / 20);
  const variety = routes / 3;
  const score = Math.round((variety * 0.62 + volume * 0.38) * 100);
  let label = 'Gentle';
  if (score >= 78) label = 'Brutal';
  else if (score >= 55) label = 'Hard';
  else if (score >= 32) label = 'Moderate';
  return { score, label, routes, packets: level.packets.length };
}
