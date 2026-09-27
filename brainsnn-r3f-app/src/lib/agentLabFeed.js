const SOURCE = 'https://www.xioai.co/api/agent-lab/summary';
const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;
const CACHE_MAX_AGE_SECONDS = 30;
const EVENT_LABELS = Object.freeze({
  ACCEPTED: 'Work packet accepted by the owner',
  REJECTED: 'Work packet returned for revision',
  BLOCKED: 'Work paused for a missing dependency',
  NEEDS_REVIEW: 'Work packet ready for independent review',
  RETIRED: 'Worker configuration retired; evidence preserved',
});

export function unavailableAgentLab() {
  return {
    schemaVersion: 1, mode: 'unavailable', generatedAt: null,
    mission: { title: 'Sell and deliver useful AI helpers with XIO', priceUsd: 1500 },
    work: { ready: null, running: null, blocked: null, review: null, accepted: null },
    evidence: { acceptedDeliveries: null, verifiedPaidDeliveries: null, contextCandidates: null, promotedContexts: null },
    events: [], reason: 'Recorded work is currently unavailable. No outcomes are inferred.',
  };
}

/** Copy an allowlist, never forward a control-plane response wholesale. */
export function sanitizeAgentLabFeed(value, now = Date.now()) {
  const empty = unavailableAgentLab();
  if (!value || value.schemaVersion !== 1 || value.mode !== 'recorded') return empty;
  const at = Date.parse(value.generatedAt);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > SNAPSHOT_MAX_AGE_MS) return empty;
  const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : null;
  return {
    ...empty, mode: 'recorded', reason: undefined, generatedAt: new Date(at).toISOString(),
    work: Object.fromEntries(Object.keys(empty.work).map((key) => [key, count(value.work?.[key])])),
    evidence: Object.fromEntries(Object.keys(empty.evidence).map((key) => [key, count(value.evidence?.[key])])),
    events: (Array.isArray(value.events) ? value.events : []).slice(0, 12)
      .filter((event) => Object.hasOwn(EVENT_LABELS, event?.status) && Number.isFinite(Date.parse(event.at)))
      .map((event, index) => ({ id: `event-${index + 1}`, status: event.status, at: new Date(event.at).toISOString(), label: EVENT_LABELS[event.status] })),
  };
}

/** Neither the relay nor downstream caches may extend a snapshot's freshness. */
export function agentLabCacheMaxAge(value, now = Date.now()) {
  if (value?.mode !== 'recorded') return CACHE_MAX_AGE_SECONDS;
  const remaining = Date.parse(value.generatedAt) + SNAPSHOT_MAX_AGE_MS - now;
  if (!Number.isFinite(remaining)) return 0;
  return Math.max(0, Math.min(CACHE_MAX_AGE_SECONDS, Math.floor(remaining / 1000)));
}

export function createAgentLabFeed({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cache = null;
  let expires = 0;
  let pending = null;
  return async function getFeed() {
    if (cache && now() < expires) return cache;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetchImpl(SOURCE, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error('source unavailable');
        if (Number(response.headers.get('content-length')) > 65536) throw new Error('source too large');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('missing source');
        const decoder = new TextDecoder();
        let body = '', size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) { await reader.cancel(); throw new Error('source too large'); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        cache = sanitizeAgentLabFeed(JSON.parse(body), now());
      } catch {
        cache = unavailableAgentLab();
      } finally {
        const cachedAt = now();
        expires = cachedAt + agentLabCacheMaxAge(cache, cachedAt) * 1000;
        pending = null;
      }
      return cache;
    })();
    return pending;
  };
}
