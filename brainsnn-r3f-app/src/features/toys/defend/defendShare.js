// What a Defend the Brain score card says, and where its link lands.
//
// The link reuses the arcade's own challenge encoding (brainGameShare.js), so
// "beat my score" opens the same level on the same rules on the toy route —
// the lab restores `?lab=braingame&state=…` from any path on mount.
//
// DOM-free so the bare-Node runner covers it.
import { CUSTOM_LEVEL_ID, encodeGameState } from '../../gaugegap/brainGameShare.js';

// The game's own disclaimers, kept verbatim alongside the card.
export const DEFEND_SCORE_NOTE = 'Scores are 0–100 indices, not probabilities.';
export const DEFEND_BOUNDARY = 'Results describe tested conditions, not universal capability.';

export function defendTitle(run) {
  if (!run) return '';
  if (run.status !== 'won') return 'Judgment offline';
  if (run.scores.defense >= 85) return 'Cortex Guardian';
  if (run.scores.defense >= 65) return 'Held the line';
  return 'Scraped through';
}

/**
 * Query params that reopen this run's level and mode for whoever gets the link.
 * A pasted custom level is left out on purpose: the card is a brag, and the
 * player's own text should not ride along in a URL they did not ask to share.
 * The recipient lands on the default level instead.
 */
export function defendChallengeParams(run) {
  if (!run || !run.levelId || run.levelId === CUSTOM_LEVEL_ID) return {};
  return { lab: 'braingame', state: encodeGameState({ mode: run.mode, levelId: run.levelId }) };
}
