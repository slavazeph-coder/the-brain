import { describe, expect, it } from '../test/tinyVitest.js';
import { EvidenceGapAnalyzer, analyzeEvidenceGaps } from './evidenceGapAnalyzer.js';

describe('EvidenceGapAnalyzer', () => {
  it('turns a footage-labeling price claim into specific missing proof', () => {
    const result = analyzeEvidenceGaps({
      content: 'Security companies could pay $300+ for footage labeling.',
      context: 'video_script',
      segments: [{ id: 's-1', startMs: 6000, endMs: 7500, text: 'Security companies could pay $300+ for footage labeling.' }],
    });
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].classification).toBe('price_claim');
    expect(result.gaps[0].mostValuableProof).toHaveLength(5);
    expect(result.gaps[0].mostValuableProof.join(' ')).toContain('quality-control');
    expect(result.topRecommendation.recommendedEdit).toContain('demonstration');
    expect(result.topRecommendation.timestampMs).toBe(6000);
    expect(result.topRecommendation.recommendedEdit).not.toContain('Add proof');
  });

  it('changes the edit recommendation to fit the commercial context', () => {
    const content = 'Our platform can reduce turnaround time by 40%.';
    const paid = analyzeEvidenceGaps({ content, context: 'paid_ad' });
    const email = new EvidenceGapAnalyzer().analyze({ content, context: 'sales_email' });
    expect(paid.topRecommendation.recommendedEdit).toContain('call to action');
    expect(email.topRecommendation.recommendedEdit).toContain('reply or meeting');
    expect(paid.topRecommendation.recommendedEdit === email.topRecommendation.recommendedEdit).toBe(false);
  });

  it('records nearby evidence separately and states deterministic limitations', () => {
    const result = analyzeEvidenceGaps('Our pilot processed 12 hours of video. The system can process representative video.');
    expect(result.evidenceInventory.length).toBeGreaterThan(0);
    expect(result.limitations).toContain('does not verify');
  });
});
