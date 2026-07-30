// Pure progress rules for the arcade passport.
//
// Kept out of the React component so the XP economy can be unit-tested: the
// bare-Node test runner cannot import .jsx, and rules this easy to get wrong
// (double-paying, losing fields on merge) deserve tests.

export const STORAGE_KEY = 'gaugegap-arcade-progress-v1';
export const XP_PER_LEVEL = 125;
export const XP_FIRST_VISIT = 25;
export const XP_REVISIT = 2;
export const XP_DAILY = 50;
// Paid for a real accomplishment, once ever, so achievements cannot be farmed.
export const ACHIEVEMENT_XP = 40;

export function emptyProgress() {
  return { visited: [], xp: 0, streak: 0, lastVisit: '', dailyWins: [], unlocked: [], bestScores: {} };
}

export function normalizeProgress(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    visited: Array.isArray(source.visited) ? source.visited : [],
    xp: Number(source.xp) || 0,
    streak: Number(source.streak) || 0,
    lastVisit: source.lastVisit || '',
    dailyWins: Array.isArray(source.dailyWins) ? source.dailyWins : [],
    unlocked: Array.isArray(source.unlocked) ? source.unlocked : [],
    bestScores: source.bestScores && typeof source.bestScores === 'object' ? source.bestScores : {},
  };
}

export function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function yesterdayKey(date = new Date()) {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return dateKey(previous);
}

export function applyVisit(progress, { id, dailyLabId, today = dateKey(), yesterday = yesterdayKey() }) {
  const current = normalizeProgress(progress);
  const firstVisit = !current.visited.includes(id);
  const firstToday = current.lastVisit !== today;
  const dailyWin = id === dailyLabId && !current.dailyWins.includes(today);
  let streak = current.streak;
  if (firstToday) streak = current.lastVisit === yesterday ? Math.max(1, current.streak + 1) : 1;
  return {
    ...current,
    visited: firstVisit ? [...current.visited, id] : current.visited,
    xp: current.xp + (firstVisit ? XP_FIRST_VISIT : XP_REVISIT) + (dailyWin ? XP_DAILY : 0),
    streak,
    lastVisit: today,
    dailyWins: dailyWin ? [...current.dailyWins.slice(-29), today] : current.dailyWins,
  };
}

/**
 * Award an achievement. Idempotent in XP: unlocking again pays nothing, though
 * a better score still updates the personal best.
 */
export function applyAchievement(progress, id, { score = null, labId = null } = {}) {
  const current = normalizeProgress(progress);
  if (!id) return current;
  const alreadyUnlocked = current.unlocked.includes(id);
  const key = labId || id;
  const previousBest = Number(current.bestScores[key]) || 0;
  const improved = score != null && score > previousBest;
  if (alreadyUnlocked && !improved) return current;
  return {
    ...current,
    xp: current.xp + (alreadyUnlocked ? 0 : ACHIEVEMENT_XP),
    unlocked: alreadyUnlocked ? current.unlocked : [...current.unlocked, id],
    bestScores: improved ? { ...current.bestScores, [key]: score } : current.bestScores,
  };
}

export function levelFor(xp) {
  return { level: Math.floor(xp / XP_PER_LEVEL) + 1, levelProgress: xp % XP_PER_LEVEL };
}
