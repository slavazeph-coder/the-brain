import { describe, expect, it } from '../../test/tinyVitest.js';
import { buildContentShareUrl, parseSharedContent, SHARED_TEXT_LIMIT } from './useContentScan.js';

const SAMPLE = 'Only forty were ever made. Private viewings close this week.';

describe('content lab challenge links', () => {
  it('round-trips shared text through the state param', () => {
    const url = buildContentShareUrl('https://brainsnn.com/', SAMPLE);
    expect(url).toContain('lab=content');
    expect(url).toContain('#playground');
    const parsed = parseSharedContent(new URL(url).search);
    expect(parsed).toBe(SAMPLE);
  });

  it('ignores the state param when another lab owns the URL', () => {
    expect(parseSharedContent('?lab=attractor&state=10,28,2.667,1')).toBe(null);
    expect(parseSharedContent('?state=hello%20there%20everyone')).toBe(null);
    expect(parseSharedContent('')).toBe(null);
  });

  it('rejects shared text that fails scan validation', () => {
    expect(parseSharedContent('?lab=content&state=hi')).toBe(null);
  });

  it('caps oversized shared text at the limit', () => {
    const long = 'a '.repeat(SHARED_TEXT_LIMIT);
    const url = buildContentShareUrl('https://brainsnn.com/', long);
    const parsed = parseSharedContent(new URL(url).search);
    expect(parsed.length).toBeLessThanOrEqual(SHARED_TEXT_LIMIT);
  });

  it('drops a stale attractor run param from the shared URL', () => {
    const url = buildContentShareUrl('https://brainsnn.com/?run=10,28,2.667,1', SAMPLE);
    expect(url.includes('run=')).toBe(false);
  });
});
