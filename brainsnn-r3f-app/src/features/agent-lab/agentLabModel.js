export const LAB_TITLE = 'BrainSNN | An evidence engine for agent work.';
export const LAB_DESCRIPTION = 'Analyze content, improve a draft, and test a decision. Keep the sources, edits and results visible so the next step has something to stand on.';
export const SETUP_DAY_URL = 'https://www.xioai.co/ai-team-setup-day';

export const WORK_STAGES = Object.freeze([
  { key: 'ready', label: 'Ready', description: 'Bounded work, ready to assign' },
  { key: 'running', label: 'Running', description: 'An execution is in progress' },
  { key: 'blocked', label: 'Blocked', description: 'Waiting on access or a dependency' },
  { key: 'review', label: 'In review', description: 'Output awaiting independent review' },
  { key: 'accepted', label: 'Accepted', description: 'Output passed its acceptance criteria' },
]);

export const EVIDENCE_METRICS = Object.freeze([
  { key: 'acceptedDeliveries', label: 'Accepted deliveries', description: 'Reviewed against the agreed scope' },
  { key: 'verifiedPaidDeliveries', label: 'Verified paid deliveries', description: 'Accepted work linked to payment evidence' },
  { key: 'contextCandidates', label: 'Context candidates', description: 'Proposed lessons awaiting validation' },
  { key: 'promotedContexts', label: 'Promoted contexts', description: 'Lessons supported by subsequent work' },
]);

const EVENT_STATUSES = Object.freeze({
  ready: 'Ready', running: 'Running', blocked: 'Blocked', review: 'In review',
  accepted: 'Accepted', completed: 'Completed', failed: 'Failed', retired: 'Retired',
  promoted: 'Promoted', candidate: 'Context candidate', recorded: 'Recorded',
  interrupted: 'Interrupted', cancelled: 'Cancelled', refunded: 'Refunded',
  rejected: 'Returned for revision',
});

function normalizeEventStatus(value) {
  if (typeof value !== 'string') return 'recorded';
  const status = value === 'NEEDS_REVIEW' ? 'review' : value.toLowerCase();
  return Object.hasOwn(EVENT_STATUSES, status) ? status : 'recorded';
}

const countOrUnknown = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const validTimestamp = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

export function unavailableSummary() {
  return {
    schemaVersion: 1, mode: 'unavailable', generatedAt: null,
    mission: { title: 'AI Team Setup Day', priceUsd: 1500 },
    work: Object.fromEntries(WORK_STAGES.map(({ key }) => [key, null])),
    evidence: Object.fromEntries(EVIDENCE_METRICS.map(({ key }) => [key, null])),
    events: [],
  };
}

// This is a display boundary, not an authority for accepting work or payments.
// Even a well-formed count is only displayed when the server labels the snapshot
// recorded. Unknown counts must never become a persuasive-looking zero.
export function normalizeLabSummary(payload) {
  if (payload?.schemaVersion !== 1 || payload?.mode !== 'recorded'
    || !validTimestamp(payload.generatedAt)) return unavailableSummary();

  const base = unavailableSummary();
  const seen = new Set();
  const events = (Array.isArray(payload.events) ? payload.events : [])
    .filter((event) => {
      if (!event || typeof event.id !== 'string' || !event.id.trim() || event.id.length > 160
        || typeof event.label !== 'string' || !event.label.trim()
        || !validTimestamp(event.at) || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .map((event) => ({
      id: event.id.slice(0, 160), label: event.label.trim().slice(0, 300), at: event.at,
      status: normalizeEventStatus(event.status),
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-100);

  return {
    ...base, mode: 'recorded', generatedAt: payload.generatedAt,
    work: Object.fromEntries(WORK_STAGES.map(({ key }) => [key, countOrUnknown(payload.work?.[key])])),
    evidence: Object.fromEntries(EVIDENCE_METRICS.map(({ key }) => [key, countOrUnknown(payload.evidence?.[key])])),
    events,
  };
}

export function formatCount(value) {
  return countOrUnknown(value) === null ? '—' : value.toLocaleString('en-US');
}

export function formatRecordTime(value) {
  if (!validTimestamp(value)) return 'No dated snapshot';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  }).format(new Date(value));
}

export function eventStatusLabel(status) {
  return typeof status === 'string' && Object.hasOwn(EVENT_STATUSES, status) ? EVENT_STATUSES[status] : 'Recorded';
}

export async function fetchLabSummary({ signal, fetcher = globalThis.fetch } = {}) {
  const response = await fetcher('/api/agent-lab/summary', {
    signal, cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Recorded evidence is temporarily unavailable.');
  const summary = normalizeLabSummary(await response.json());
  return summary;
}
