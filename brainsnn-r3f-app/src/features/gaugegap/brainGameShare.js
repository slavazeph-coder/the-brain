// Challenge links for Defend the Brain.
//
// The lab has always written `?lab=braingame&state=<seed>` when you press Share
// or Copy link — and it was the only lab in the arcade that never read `state`
// back. Every recipient landed on the default level with the default seed, so
// "beat my score" was an invitation to play something else entirely.
//
// A shareable run needs three things: the mode (the rules differ), the level
// (what attacks you), and the seed (when it attacks). Curated levels rebuild
// from their id. Custom levels carry their text, the same way the Content
// Reaction Lab's challenge links do — capped, validated, and only ever produced
// by someone deliberately pressing Share on their own text.
//
// Pure and DOM-free apart from the URL parsing, so the bare-Node runner covers
// the round trip.
import { GAME_MODES } from './brainGame.js';
import { CURATED_LEVELS, MAX_LEVEL_TEXT } from './brainGameLevels.js';

// `~` separates the fields. It survives a URL without escaping and cannot occur
// in a mode id or a curated level id, so a custom level's text can contain
// commas and still parse.
export const FIELD_SEPARATOR = '~';
export const CUSTOM_LEVEL_ID = 'custom';

const MODE_IDS = new Set(GAME_MODES.map((entry) => entry.id));
const CURATED_IDS = new Set(CURATED_LEVELS.map((entry) => entry.id));

/**
 * Encode a run into the `state` param.
 * Text is included only for a custom level, and only what the game would have
 * used anyway (`MAX_LEVEL_TEXT`).
 */
export function encodeGameState({ mode = 'mission', levelId = CURATED_LEVELS[0].id, text = '' } = {}) {
  const safeMode = MODE_IDS.has(mode) ? mode : 'mission';
  if (levelId === CUSTOM_LEVEL_ID) {
    const body = String(text || '').slice(0, MAX_LEVEL_TEXT);
    // A custom level with no text is not shareable; fall back to the ladder.
    if (!body.trim()) return `${safeMode}${FIELD_SEPARATOR}${CURATED_LEVELS[0].id}`;
    return [safeMode, CUSTOM_LEVEL_ID, body].join(FIELD_SEPARATOR);
  }
  const safeLevel = CURATED_IDS.has(levelId) ? levelId : CURATED_LEVELS[0].id;
  return `${safeMode}${FIELD_SEPARATOR}${safeLevel}`;
}

/**
 * Read a shared run out of a query string.
 * Returns null unless this is a braingame link with a state we understand —
 * an unrecognised level id is treated as absent rather than guessed at, so a
 * stale link degrades to the default rather than to something wrong.
 */
export function parseGameState(search) {
  const params = new URLSearchParams(search || '');
  if (params.get('lab') !== 'braingame') return null;
  const raw = params.get('state');
  if (!raw) return null;

  const [mode, levelId, ...rest] = String(raw).split(FIELD_SEPARATOR);
  if (!MODE_IDS.has(mode)) return null;

  if (levelId === CUSTOM_LEVEL_ID) {
    // Re-join so text containing the separator survives a round trip.
    const text = rest.join(FIELD_SEPARATOR).slice(0, MAX_LEVEL_TEXT).trim();
    if (!text) return null;
    return { mode, levelId: CUSTOM_LEVEL_ID, text };
  }

  if (!CURATED_IDS.has(levelId)) return null;
  return { mode, levelId, text: '' };
}

/** Build the full challenge URL for a run. */
export function buildGameShareUrl(href, { mode, levelId, text } = {}) {
  const url = new URL(href);
  url.searchParams.set('lab', 'braingame');
  url.searchParams.delete('run');
  url.searchParams.set('state', encodeGameState({ mode, levelId, text }));
  url.hash = 'playground';
  return url.toString();
}

/** Human-readable summary of a shared run, for the notice line. */
export function describeSharedGame(state) {
  if (!state) return '';
  const level = CURATED_LEVELS.find((entry) => entry.id === state.levelId);
  const where = level ? level.title : 'a passage someone else pasted';
  return `Challenge loaded: ${where} on ${state.mode}.`;
}
