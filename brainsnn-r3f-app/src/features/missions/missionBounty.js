const MAX_BOUNTY_CENTS = 100_000_000;
const MAX_RULES_LENGTH = 700;
const MAX_CREATOR_LENGTH = 80;
const ALLOWED_CURRENCIES = new Set(['CAD', 'USD']);

function clampInteger(value, min, max, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanText(value, fallback, maxLength) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return cleaned || fallback;
}

function normalizeDeadline(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function normalizeBountyTerms(raw = {}) {
  const currency = String(raw.currency || 'CAD').trim().toUpperCase();
  return {
    schema: 'brainsnn.mission_bounty_terms.v1',
    creatorLabel: cleanText(raw.creatorLabel, 'Mission creator', MAX_CREATOR_LENGTH),
    amountCents: clampInteger(raw.amountCents, 0, MAX_BOUNTY_CENTS, 0),
    currency: ALLOWED_CURRENCIES.has(currency) ? currency : 'CAD',
    deadline: normalizeDeadline(raw.deadline),
    rules: cleanText(
      raw.rules,
      'Top verified MISSION SUCCESS submissions are eligible. The creator selects the winner.',
      MAX_RULES_LENGTH,
    ),
    fundingStatus: 'NOT_ESCROWED',
    paymentRail: 'NOT_CONNECTED',
  };
}

export function normalizeBountyState(raw = {}) {
  const status = ['OPEN', 'CLOSED', 'AWARDED'].includes(raw.status) ? raw.status : 'OPEN';
  return {
    status,
    winnerSubmissionId: raw.winnerSubmissionId || null,
    winnerSelectedAt: raw.winnerSelectedAt || null,
    paymentStatus: 'NOT_CONNECTED',
  };
}

export function deriveBountyLifecycle(terms, state, now = Date.now()) {
  const normalizedTerms = normalizeBountyTerms(terms);
  const normalizedState = normalizeBountyState(state);
  if (normalizedState.status === 'AWARDED') return 'AWARDED';
  if (normalizedState.status === 'CLOSED') return 'CLOSED';
  if (normalizedTerms.deadline && new Date(normalizedTerms.deadline).getTime() <= Number(now)) return 'EXPIRED';
  return 'OPEN';
}

export function isMissionSubmissionOpen(terms, state, now = Date.now()) {
  return deriveBountyLifecycle(terms, state, now) === 'OPEN';
}

export function pickVerifiedWinner(entries = []) {
  return entries.find((entry) => entry?.status === 'MISSION SUCCESS') || null;
}

export function bountyDisplayAmount(terms) {
  const normalized = normalizeBountyTerms(terms);
  return normalized.amountCents / 100;
}
