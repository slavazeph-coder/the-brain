import { describe, expect, it } from '../test/tinyVitest.js';
import { buildRescueMailto, RESCUE_CONTACT } from './coherenceRequest.js';

describe('manual video rescue request', () => {
  it('prepares an actual owner mail draft with the clip, problem, reply and acceptance terms', () => {
    const link = buildRescueMailto({ email: ' creator@example.com ',
      clip: 'https://example.com/clip?part=1&quality=1080', notes: 'Color jumps at 00:12\nKeep the camera movement.' });
    const url = new URL(link);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe(RESCUE_CONTACT);
    expect(url.searchParams.get('subject')).toContain('clip evaluation');
    const body = url.searchParams.get('body');
    expect(body).toContain('creator@example.com');
    expect(body).toContain('https://example.com/clip?part=1&quality=1080');
    expect(body).toContain('Color jumps at 00:12\nKeep the camera movement.');
    expect(body).toContain('only if the result is useful and I accept it');
    expect(body).toContain('one clip up to 15 seconds');
    expect(body).toContain('native HD quality gates have not passed');
  });
  it('encodes user-supplied query characters as draft text, not another mail header', () => {
    const link = buildRescueMailto({ notes: 'hello&bcc=unexpected@example.com?subject=changed' });
    const url = new URL(link);
    expect(url.searchParams.has('bcc')).toBe(false);
    expect(url.searchParams.get('subject')).toBe('BrainSNN video rescue pilot — clip evaluation');
    expect(url.searchParams.get('body')).toContain('hello&bcc=unexpected@example.com?subject=changed');
  });
  it('keeps an incomplete request explicit without claiming receipt or payment', () => {
    const body = new URL(buildRescueMailto()).searchParams.get('body');
    expect(body).toContain('(add a link before sending)');
    expect(body).toContain('confirm scope and eligibility before processing or payment');
    expect(body.includes('Received')).toBe(false);
  });
});
