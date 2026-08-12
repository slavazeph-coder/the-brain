import { describe, expect, it } from '../test/tinyVitest.js';
import {
  ATTRIBUTION_FIELDS,
  readAttribution,
  referrerHost,
} from './attribution.js';

describe('referrerHost', () => {
  it('keeps the host and nothing else', () => {
    // The whole point of the module. A search referrer carries the query in its
    // URL, and that must not reach a log line.
    expect(referrerHost('https://www.google.com/search?q=is+my+boss+gaslighting+me'))
      .toBe('google.com');
    expect(referrerHost('https://news.ycombinator.com/item?id=123'))
      .toBe('news.ycombinator.com');
  });

  it('treats www and bare host as one channel', () => {
    expect(referrerHost('https://www.reddit.com/r/somewhere')).toBe('reddit.com');
    expect(referrerHost('https://reddit.com/r/somewhere')).toBe('reddit.com');
  });

  it('drops an internal navigation, which is not an acquisition source', () => {
    // Otherwise the site becomes its own largest referrer and the report is
    // worse than having none.
    expect(referrerHost('https://www.brainsnn.com/lab', 'www.brainsnn.com')).toBe('');
    expect(referrerHost('https://brainsnn.com/evidence', 'www.brainsnn.com')).toBe('');
  });

  it('returns empty for nothing, junk and non-strings', () => {
    expect(referrerHost('')).toBe('');
    expect(referrerHost('not a url')).toBe('');
    expect(referrerHost(undefined)).toBe('');
    expect(referrerHost(null)).toBe('');
    expect(referrerHost(42)).toBe('');
  });
});

describe('readAttribution', () => {
  it('reads utm tags', () => {
    const found = readAttribution('?utm_source=hn&utm_medium=social&utm_campaign=evidence');
    expect(found.utm_source).toBe('hn');
    expect(found.utm_medium).toBe('social');
    expect(found.utm_campaign).toBe('evidence');
  });

  it('reads the share tag separately from utm_source', () => {
    // A shared circuit is our tag, not the visitor's campaign. Folding one into
    // the other would report a source nobody set.
    const found = readAttribution('?s=lab');
    expect(found.share).toBe('lab');
    expect(found.utm_source).toBe(undefined);
  });

  it('combines a referrer with tags', () => {
    const found = readAttribution('?s=lab', 'https://x.com/someone/status/1', 'brainsnn.com');
    expect(found.share).toBe('lab');
    expect(found.ref).toBe('x.com');
  });

  it('reports a direct visit as an empty object', () => {
    // A real answer, and stored as one so it cannot be overwritten later.
    expect(readAttribution('', '', 'brainsnn.com')).toEqual({});
  });

  it('emits nothing outside the declared field list', () => {
    const found = readAttribution(
      '?utm_source=hn&utm_medium=social&utm_campaign=c&s=lab&utm_term=secret&fbclid=xyz',
      'https://news.ycombinator.com/item?id=1',
      'brainsnn.com',
    );
    for (const key of Object.keys(found)) {
      expect(ATTRIBUTION_FIELDS.includes(key)).toBe(true);
    }
    // Not on the list, so it never leaves the browser.
    expect(found.utm_term).toBe(undefined);
    expect(found.fbclid).toBe(undefined);
  });

  it('truncates a long tag rather than carrying an essay', () => {
    const found = readAttribution(`?utm_campaign=${'x'.repeat(5000)}`);
    expect(found.utm_campaign.length).toBeLessThanOrEqual(120);
  });

  it('survives a malformed query string', () => {
    expect(readAttribution('%')).toEqual({});
    expect(readAttribution(undefined, undefined, undefined)).toEqual({});
  });
});
