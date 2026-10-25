import { describe, it, expect } from '../test/tinyVitest.js';
import { agentLabCacheMaxAge, createAgentLabFeed, sanitizeAgentLabFeed } from './agentLabFeed.js';

const now = Date.parse('2026-09-08T12:00:00Z');
const record = { schemaVersion: 1, mode: 'recorded', generatedAt: new Date(now).toISOString(), work: { ready: 0 }, evidence: { acceptedDeliveries: 1 }, events: [] };
describe('agent lab recorded feed', () => {
  it('keeps unknown distinct from zero and excludes arbitrary upstream fields', () => {
    const result = sanitizeAgentLabFeed({ ...record, secret: 'private', work: { ready: 0, running: -1 }, events: [{ id: 'client-email', label: 'Customer Alice', status: 'ACCEPTED', at: record.generatedAt }] }, now);
    expect(result.work.ready).toBe(0);
    expect(result.work.running).toBe(null);
    expect(result.events[0].label).toBe('Work packet accepted by the owner');
    expect(JSON.stringify(result).includes('Alice')).toBe(false);
    expect(JSON.stringify(result).includes('private')).toBe(false);
  });
  it('does not present stale or future snapshots as current evidence', () => {
    expect(sanitizeAgentLabFeed(record, now + 400000).mode).toBe('unavailable');
    expect(sanitizeAgentLabFeed(record, now - 400000).mode).toBe('unavailable');
  });
  it('rejects inherited object keys instead of accepting them as event statuses', () => {
    const result = sanitizeAgentLabFeed({ ...record, events: [
      ...['constructor', '__proto__', 'toString'].map((status) => ({ status, at: record.generatedAt })),
      { status: 'NEEDS_REVIEW', at: record.generatedAt, label: 'Private upstream wording' },
    ] }, now);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].status).toBe('NEEDS_REVIEW');
    expect(result.events[0].label).toBe('Work packet ready for independent review');
    expect(result.work.ready).toBe(0);
  });
  it('deduplicates requests and never promotes a failed request to zero outcomes', async () => {
    let calls = 0;
    const feed = createAgentLabFeed({ now: () => now, fetchImpl: async () => { calls++; return new Response(JSON.stringify(record)); } });
    const results = await Promise.all([feed(), feed()]);
    expect(calls).toBe(1);
    expect(results[0].work.ready).toBe(0);
    const failing = createAgentLabFeed({ fetchImpl: async () => { throw new Error('offline'); } });
    expect((await failing()).evidence.verifiedPaidDeliveries).toBe(null);
  });
  it('rejects oversized source bodies', async () => {
    const feed = createAgentLabFeed({ fetchImpl: async () => new Response('x'.repeat(70000)) });
    expect((await feed()).mode).toBe('unavailable');
  });
  it('expires a nearly stale cached snapshot before its five-minute deadline', async () => {
    let clock = now;
    let calls = 0;
    const agedRecord = { ...record, generatedAt: new Date(now - 290_000).toISOString() };
    const feed = createAgentLabFeed({ now: () => clock, fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify(agedRecord));
    } });
    expect((await feed()).mode).toBe('recorded');
    clock += 5_000;
    expect((await feed()).mode).toBe('recorded');
    expect(calls).toBe(1);
    clock += 15_000;
    const expired = await feed();
    expect(calls).toBe(2);
    expect(expired.mode).toBe('unavailable');
    expect(expired.work.ready).toBe(null);
    expect(expired.evidence.acceptedDeliveries).toBe(null);
  });
  it('caps cache lifetimes by remaining freshness and rounds down partial seconds', () => {
    expect(agentLabCacheMaxAge(record, now)).toBe(30);
    expect(agentLabCacheMaxAge(record, now + 290_000)).toBe(10);
    expect(agentLabCacheMaxAge(record, now + 290_001)).toBe(9);
    expect(agentLabCacheMaxAge(record, now + 300_000)).toBe(0);
    expect(agentLabCacheMaxAge(record, now + 310_000)).toBe(0);
    expect(agentLabCacheMaxAge({ ...record, generatedAt: 'invalid' }, now)).toBe(0);
    expect(agentLabCacheMaxAge({ mode: 'unavailable' }, now)).toBe(30);
  });
});
