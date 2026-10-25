const FRESHNESS_MS = 300_000;
const MAX_CACHE_SECONDS = 30;
const MAX_BODY_BYTES = 65_536;

const EVENT_LABELS = Object.freeze({
  ACCEPTED: 'Work packet accepted by the owner',
  NEEDS_REVIEW: 'Work packet ready for independent review',
  REJECTED: 'Work packet returned for revision',
  RUNNING: 'Work packet in bounded execution',
  QUEUED: 'Work packet queued for review',
});

function nonNegativeIntOrNull(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function unavailableAgentLabFeed(now = Date.now()) {
  return {
    schemaVersion: 1,
    mode: 'unavailable',
    generatedAt: new Date(now).toISOString(),
    work: {
      ready: null,
      running: null,
      needsReview: null,
      blocked: null,
    },
    evidence: {
      acceptedDeliveries: null,
      verifiedPaidDeliveries: null,
      rejectedPackets: null,
    },
    events: [],
  };
}

export function sanitizeAgentLabFeed(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return unavailableAgentLabFeed(now);
  const ts = Date.parse(String(raw.generatedAt || ''));
  if (!Number.isFinite(ts) || Math.abs(now - ts) >= FRESHNESS_MS) {
    return unavailableAgentLabFeed(now);
  }
  const work = raw.work && typeof raw.work === 'object' ? raw.work : {};
  const evidence = raw.evidence && typeof raw.evidence === 'object' ? raw.evidence : {};
  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  const events = [];
  for (const item of rawEvents.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const status = String(item.status || '');
    if (!Object.hasOwn(EVENT_LABELS, status)) continue;
    const atMs = Date.parse(String(item.at || ''));
    if (!Number.isFinite(atMs)) continue;
    events.push({
      status,
      label: EVENT_LABELS[status],
      at: new Date(atMs).toISOString(),
    });
  }
  return {
    schemaVersion: 1,
    mode: 'recorded',
    generatedAt: new Date(ts).toISOString(),
    work: {
      ready: nonNegativeIntOrNull(work.ready),
      running: nonNegativeIntOrNull(work.running),
      needsReview: nonNegativeIntOrNull(work.needsReview),
      blocked: nonNegativeIntOrNull(work.blocked),
    },
    evidence: {
      acceptedDeliveries: nonNegativeIntOrNull(evidence.acceptedDeliveries),
      verifiedPaidDeliveries: nonNegativeIntOrNull(evidence.verifiedPaidDeliveries),
      rejectedPackets: nonNegativeIntOrNull(evidence.rejectedPackets),
    },
    events,
  };
}

export function agentLabCacheMaxAge(feed, now = Date.now()) {
  if (!feed || feed.mode === 'unavailable') return MAX_CACHE_SECONDS;
  const ts = Date.parse(String(feed.generatedAt || ''));
  if (!Number.isFinite(ts)) return 0;
  const remainingMs = FRESHNESS_MS - (now - ts);
  if (remainingMs <= 0) return 0;
  return Math.min(MAX_CACHE_SECONDS, Math.floor(remainingMs / 1000));
}

export function createAgentLabFeed({
  url = process.env.AGENT_LAB_FEED_URL || '',
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  let inflight = null;
  let cached = null;
  let cachedExpiresAt = 0;

  return async function readFeed() {
    const currentNow = now();
    if (cached && currentNow < cachedExpiresAt) {
      return cached;
    }
    if (inflight) return inflight;

    inflight = (async () => {
      try {
        if (!url && fetchImpl === globalThis.fetch) {
          return unavailableAgentLabFeed(currentNow);
        }
        const response = await fetchImpl(url || 'http://127.0.0.1/agent-lab-feed.json');
        const text = await response.text();
        if (text.length > MAX_BODY_BYTES) {
          return unavailableAgentLabFeed(currentNow);
        }
        const parsed = JSON.parse(text);
        const sanitized = sanitizeAgentLabFeed(parsed, currentNow);
        const maxAgeSec = agentLabCacheMaxAge(sanitized, currentNow);
        if (sanitized.mode === 'recorded' && maxAgeSec > 0) {
          cached = sanitized;
          cachedExpiresAt = currentNow + maxAgeSec * 1000;
        } else {
          cached = null;
          cachedExpiresAt = 0;
        }
        return sanitized;
      } catch {
        return unavailableAgentLabFeed(currentNow);
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  };
}
