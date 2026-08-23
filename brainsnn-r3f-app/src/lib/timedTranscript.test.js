import { describe, expect, it } from '../test/tinyVitest.js';
import { classifyTranscriptSegment, parseTimedTranscript, parseTimecode } from './timedTranscript.js';

describe('timed transcript parsing', () => {
  it('parses SRT/VTT cue timestamps without inventing timing', () => {
    const timeline = parseTimedTranscript(`1\n00:00:02,000 --> 00:00:05,000\nThis can cut editing time dramatically.\n\n2\n00:00:08,000 --> 00:00:11,500\nA customer pilot saved 20 hours.\n\n3\n00:00:14,000 --> 00:00:17,000\nBook a demo today.`, 20);
    expect(timeline.mode).toBe('timed');
    expect(timeline.segments).toHaveLength(3);
    expect(timeline.segments[0].start).toBe(2);
    expect(timeline.segments[1].end).toBe(11.5);
    expect(timeline.sequence.firstClaim.start).toBe(2);
    expect(timeline.sequence.firstProof.start).toBe(8);
    expect(timeline.sequence.firstCta.start).toBe(14);
    expect(timeline.sequence.claimProofGapSeconds).toBe(6);
  });

  it('parses bracketed timestamped lines and infers ends from the next supplied start', () => {
    const timeline = parseTimedTranscript(`[00:00] Hook here\n[00:05] This can save your team time\n[00:09] Customer pilot saved 20 hours\n[00:15] Book a demo`, 20);
    expect(timeline.mode).toBe('timed');
    expect(timeline.sourceFormat).toBe('timestamped-lines');
    expect(timeline.segments).toHaveLength(4);
    expect(timeline.segments[1].start).toBe(5);
    expect(timeline.segments[1].end).toBe(9);
    expect(timeline.sequence.claimProofGapSeconds).toBe(4);
  });

  it('clearly labels plain transcript timing as estimated', () => {
    const timeline = parseTimedTranscript('This can save your team time. A customer pilot saved 20 hours. Book a demo today.', 18);
    expect(timeline.mode).toBe('estimated');
    expect(timeline.confidence).toBe(0.35);
    expect(timeline.segments.length).toBeGreaterThan(1);
    expect(timeline.segments.every((segment) => segment.alignment === 'estimated')).toBe(true);
    expect(timeline.disclaimer.toLowerCase()).toMatch(/estimated/);
  });

  it('refuses to invent timing when neither timestamps nor duration are available', () => {
    const timeline = parseTimedTranscript('This is plain transcript text without timestamps.', 0);
    expect(timeline.mode).toBe('none');
    expect(timeline.segments).toHaveLength(0);
    expect(timeline.disclaimer.toLowerCase()).toMatch(/did not invent timing/);
  });

  it('classifies commercial beats while preserving multiple tags', () => {
    const classified = classifyTranscriptSegment('Our customer pilot saved 20 hours and you can book a demo now.');
    expect(classified.tags.includes('proof')).toBe(true);
    expect(classified.tags.includes('cta')).toBe(true);
    expect(classified.kind).toBe('cta');
  });

  it('parses mm:ss and hh:mm:ss timecodes', () => {
    expect(parseTimecode('01:30.5')).toBe(90.5);
    expect(parseTimecode('01:02:03.250')).toBe(3723.25);
  });
});
