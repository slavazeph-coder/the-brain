import { describe, expect, it } from '../test/tinyVitest.js';
import {
  ALLOWED_EVENTS,
  LOG_PREFIX,
  REDACTED_PROPERTIES,
  formatEventLine,
  normalizeEvent,
} from './eventSink.js';

const at = new Date('2026-08-09T12:00:00.000Z');

describe('normalizeEvent', () => {
  it('accepts a well-formed event', () => {
    const record = normalizeEvent(
      { event: 'pilot_clicked', properties: { segment: 'brands' }, path: '/' },
      { at },
    );
    expect(record.event).toBe('pilot_clicked');
    expect(record.properties.segment).toBe('brands');
    expect(record.at).toBe('2026-08-09T12:00:00.000Z');
  });

  it('drops an event name it does not know', () => {
    // The endpoint is public, so the client-side allowlist is a courtesy. This
    // is the one that actually holds.
    expect(normalizeEvent({ event: 'not_a_real_event' }, { at })).toBe(null);
    expect(normalizeEvent({ event: '' }, { at })).toBe(null);
    expect(normalizeEvent({}, { at })).toBe(null);
    expect(normalizeEvent(null, { at })).toBe(null);
    expect(normalizeEvent('pilot_clicked', { at })).toBe(null);
  });

  // The product analyses text people paste. None of it may reach a log line,
  // and a forged request must not be able to put it there.
  it('strips the content fields even when a forged request includes them', () => {
    const record = normalizeEvent({
      event: 'scan_completed',
      properties: {
        content: 'a confidential campaign draft',
        rawContent: 'a confidential campaign draft',
        text: 'a confidential campaign draft',
        ok: true,
      },
    }, { at });

    for (const field of REDACTED_PROPERTIES) {
      expect(record.properties[field]).toBe(undefined);
    }
    expect(record.properties.ok).toBe(true);
    expect(formatEventLine(record)).not.toContain('confidential');
  });

  it('refuses nested values, which is how prose would smuggle itself in', () => {
    const record = normalizeEvent({
      event: 'scan_completed',
      properties: { payload: { body: 'a long confidential paste' }, list: ['also prose'] },
    }, { at });
    expect(record.properties.payload).toBe(undefined);
    expect(record.properties.list).toBe(undefined);
    expect(formatEventLine(record)).not.toContain('confidential');
  });

  it('truncates long strings rather than logging an essay', () => {
    const record = normalizeEvent({
      event: 'scan_completed',
      properties: { label: 'x'.repeat(5000) },
    }, { at });
    expect(record.properties.label.length).toBeLessThanOrEqual(120);
  });

  it('caps how many properties one event can carry', () => {
    const properties = {};
    for (let i = 0; i < 100; i += 1) properties[`k${i}`] = i;
    const record = normalizeEvent({ event: 'scan_completed', properties }, { at });
    expect(Object.keys(record.properties).length).toBeLessThanOrEqual(12);
  });

  it('bounds the path', () => {
    const record = normalizeEvent(
      { event: 'scan_completed', path: `/${'p'.repeat(4000)}` },
      { at },
    );
    expect(record.path.length).toBeLessThanOrEqual(512);
  });

  it('falls back to the request path when the client sends none', () => {
    const record = normalizeEvent({ event: 'scan_completed' }, { path: '/api/events', at });
    expect(record.path).toBe('/api/events');
  });

  it('tolerates properties being the wrong type', () => {
    const record = normalizeEvent({ event: 'scan_completed', properties: 'nope' }, { at });
    expect(record.properties).toEqual({});
  });
});

describe('formatEventLine', () => {
  it('emits one greppable line', () => {
    const line = formatEventLine(normalizeEvent({ event: 'pricing_viewed' }, { at }));
    expect(line.startsWith(LOG_PREFIX)).toBe(true);
    expect(line.includes('\n')).toBe(false);
    expect(JSON.parse(line.slice(LOG_PREFIX.length + 1)).event).toBe('pricing_viewed');
  });
});

describe('the server allowlist matches the client one', () => {
  it('covers every event analytics.js can send', async () => {
    // Two lists that drift apart would silently drop real events, which looks
    // identical to "nobody did that".
    const analytics = await import('./analytics.js');
    const clientEvents = analytics.__ALLOWED_EVENTS_FOR_TEST;
    expect(Array.isArray(clientEvents)).toBe(true);
    for (const name of clientEvents) {
      expect(ALLOWED_EVENTS.has(name)).toBe(true);
    }
    expect(ALLOWED_EVENTS.size).toBe(clientEvents.length);
  });
});
