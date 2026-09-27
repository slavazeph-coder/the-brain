import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  eventStatusLabel, fetchLabSummary, formatCount, formatRecordTime,
  normalizeLabSummary, unavailableSummary,
} from './agentLabModel.js';

const recorded = (overrides = {}) => ({
  schemaVersion: 1, mode: 'recorded', generatedAt: '2026-09-08T12:00:00.000Z',
  mission: { title: 'AI Team Setup Day', priceUsd: 1500 },
  work: { ready: 3, running: 1, blocked: 1, review: 2, accepted: 0 },
  evidence: { acceptedDeliveries: 0, verifiedPaidDeliveries: 0, contextCandidates: 2, promotedContexts: 0 },
  events: [], ...overrides,
});

describe('public agent lab evidence boundary', () => {
  it('never manufactures zeros from missing, unavailable or unsupported records', () => {
    for (const payload of [null, {}, recorded({ mode: 'unavailable' }), recorded({ mode: 'simulation' }), recorded({ schemaVersion: 2 }), recorded({ generatedAt: null })]) {
      const summary = normalizeLabSummary(payload);
      expect(summary.mode).toBe('unavailable');
      expect(summary.work.ready).toBe(null);
      expect(summary.evidence.verifiedPaidDeliveries).toBe(null);
      expect(summary.events).toEqual([]);
    }
    expect(formatCount(undefined)).toBe('—');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(0)).toBe('0');
  });

  it('preserves known zero separately from unknown and rejects implausible counts', () => {
    const summary = normalizeLabSummary(recorded({
      work: { ready: 0, running: '6', blocked: -1, review: 1.5, accepted: Number.MAX_SAFE_INTEGER + 1 },
      evidence: { acceptedDeliveries: 2, verifiedPaidDeliveries: 1 },
    }));
    expect(summary.work).toEqual({ ready: 0, running: null, blocked: null, review: null, accepted: null });
    expect(summary.evidence).toEqual({ acceptedDeliveries: 2, verifiedPaidDeliveries: 1, contextCandidates: null, promotedContexts: null });
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(Infinity)).toBe('—');
  });

  it('keeps the approved mission price fixed, separate from financial evidence', () => {
    const summary = normalizeLabSummary(recorded({ mission: { title: 'Wrong mission', priceUsd: 999999 }, revenue: 999999 }));
    expect(summary.mission).toEqual({ title: 'AI Team Setup Day', priceUsd: 1500 });
    expect(Object.hasOwn(summary, 'revenue')).toBe(false);
  });

  it('filters malformed events, removes duplicates and orders recorded replay chronologically', () => {
    const events = [
      { id: 'review', label: 'Artifact accepted', at: '2026-09-08T13:00:00Z', status: 'accepted' },
      { id: 'start', label: 'Work started', at: '2026-09-08T11:00:00Z', status: 'running' },
      { id: 'review', label: 'Duplicate', at: '2026-09-08T14:00:00Z', status: 'accepted' },
      { id: 'invalid-time', label: 'Undated claim', at: 'not-a-date' },
      { id: 'missing-label', at: '2026-09-08T12:00:00Z' },
      { id: '   ', label: 'Missing identity', at: '2026-09-08T12:00:00Z' },
    ];
    const summary = normalizeLabSummary(recorded({ events }));
    expect(summary.events.map((event) => event.id)).toEqual(['start', 'review']);
    expect(summary.events[1].status).toBe('accepted');
  });

  it('does not turn unrecognized agent claims into accepted or paid statuses', () => {
    const summary = normalizeLabSummary(recorded({ events: [
      { id: 'claim', label: 'Worker submitted a claim', at: '2026-09-08T12:00:00Z', status: 'earned-million-dollars' },
    ] }));
    expect(summary.events[0].status).toBe('recorded');
    expect(eventStatusLabel('__proto__')).toBe('Recorded');
    expect(eventStatusLabel('blocked')).toBe('Blocked');
    expect(eventStatusLabel({ toString: null, valueOf: null })).toBe('Recorded');
    expect(normalizeLabSummary(recorded({ events: [
      { id: 'odd-status', label: 'Submitted', at: '2026-09-08T12:00:00Z', status: { toString: null, valueOf: null } },
    ] })).events[0].status).toBe('recorded');
  });

  it('preserves the server feed lifecycle when its enum uses uppercase statuses', () => {
    const statuses = ['ACCEPTED', 'REJECTED', 'BLOCKED', 'NEEDS_REVIEW', 'RETIRED'];
    const summary = normalizeLabSummary(recorded({ events: statuses.map((status, index) => ({
      id: `server-event-${index}`, label: 'Approved public event label',
      at: `2026-09-08T12:0${index}:00Z`, status,
    })) }));
    expect(summary.events.map((event) => event.status)).toEqual(['accepted', 'rejected', 'blocked', 'review', 'retired']);
    expect(eventStatusLabel(summary.events[1].status)).toBe('Returned for revision');
  });

  it('does not leak arbitrary fields or private unavailable reasons into the display model', () => {
    const summary = normalizeLabSummary(recorded({ reason: 'Private runtime path', customerEmail: 'private@example.test' }));
    expect(Object.hasOwn(summary, 'customerEmail')).toBe(false);
    expect(Object.hasOwn(summary, 'reason')).toBe(false);
    expect(normalizeLabSummary({ reason: 'Secret missing' })).toEqual(unavailableSummary());
  });

  it('shows dated snapshots explicitly in UTC', () => {
    expect(formatRecordTime('2026-09-08T12:00:00Z')).toContain('UTC');
    expect(formatRecordTime('2026-09-08T12:00:00Z')).toContain('2026');
    expect(formatRecordTime('bad-date')).toBe('No dated snapshot');
  });

  it('requests fresh public records and passes cancellation to the network', async () => {
    const signal = new AbortController().signal;
    let called = null;
    const summary = await fetchLabSummary({ signal, fetcher: async (url, options) => {
      called = { url, options };
      return { ok: true, json: async () => recorded() };
    } });
    expect(called.url).toBe('/api/agent-lab/summary');
    expect(called.options.cache).toBe('no-store');
    expect(called.options.signal).toBe(signal);
    expect(summary.mode).toBe('recorded');
  });

  it('rejects HTTP failures instead of reading an error payload as evidence', async () => {
    let failed = false;
    let parsed = false;
    try {
      await fetchLabSummary({ fetcher: async () => ({ ok: false, json: async () => { parsed = true; return recorded(); } }) });
    } catch { failed = true; }
    expect(failed).toBe(true);
    expect(parsed).toBe(false);
  });
});
