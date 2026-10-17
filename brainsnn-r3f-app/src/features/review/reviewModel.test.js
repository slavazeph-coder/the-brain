import { describe, expect, it } from '../../test/tinyVitest.js';
import { buildVideoReview, inspectPassage, isSourceFinding, reviewTabFromSearch, splitClaimCues } from './reviewModel.js';

describe('Review source evidence', () => {
  it('keeps exact source offsets through emoji, repeated words and whitespace', () => {
    const text = '🧠 ACT   NOW! Act now! This guaranteed solution will save time.';
    const result = inspectPassage(text);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) expect(isSourceFinding(text, finding)).toBe(true);
    expect(result.findings.some(finding => finding.quotation === 'ACT   NOW')).toBe(true);
    expect(result.findings.some(finding => finding.quotation === 'Act now')).toBe(true);
  });
  it('does not anchor a matched phrase inside an unrelated longer word', () => {
    const result = inspectPassage('Act now. React now is unrelated wording.');
    expect(result.findings.filter(finding => finding.quotation.toLowerCase() === 'act now').length).toBe(1);
  });
  it('refuses malformed or mismatched evidence rather than presenting a false location', () => {
    expect(isSourceFinding('example', { start: -1, end: 4, quotation: 'exam' })).toBe(false);
    expect(isSourceFinding('example', { start: 0, end: 4, quotation: 'fake' })).toBe(false);
    expect(isSourceFinding('example', { start: 0, end: 40, quotation: 'example' })).toBe(false);
    for (const finding of splitClaimCues('This will save time. We tested it on three tasks.').findings) expect(isSourceFinding('This will save time. We tested it on three tasks.', finding)).toBe(true);
  });
  it('never estimates timecodes from untimed text even when video duration exists', () => {
    const review = buildVideoReview({ transcript: 'This will save time.', media: { duration: 20 } });
    expect(review.captions).toEqual([]);
    expect(review.untimed).toBe(true);
  });
  it('keeps supplied starts and omits cues outside a supplied video duration', () => {
    const review = buildVideoReview({ transcript: '00:02 This will save time.\n00:18 Too late.', media: { duration: 10 } });
    expect(review.captions.length).toBe(1);
    expect(review.captions[0].start).toBe(2);
    expect(review.omittedCaptions).toBe(1);
    expect(review.captionOrigin).toContain('unverified');
  });
  it('falls back to Passage for unrecognized tab links', () => {
    expect(reviewTabFromSearch('?tab=drafts')).toBe('drafts');
    expect(reviewTabFromSearch('?tab=pricing')).toBe('passage');
  });
});
