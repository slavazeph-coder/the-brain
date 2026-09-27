const DEFAULT_SEGMENT_SECONDS = 4;
const MAX_TRANSCRIPT_SEGMENTS = 80;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function words(value = '') {
  return String(value).trim().split(/\s+/).filter(Boolean);
}

export function parseTimecode(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  const value = String(raw).trim().replace(',', '.');
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const parts = value.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return null;
}

export function formatTranscriptTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

export function classifyTranscriptSegment(text = '') {
  const value = String(text || '').trim();
  const lower = value.toLowerCase();
  const tags = [];

  const hasMoney = /(?:[$€£]\s?\d|\b(?:usd|cad|dollars?|price|pricing|costs?|per month|\/mo)\b)/i.test(value);
  const hasProof = /(?:\b\d+(?:\.\d+)?%|\b\d{2,}\b|customer|client|case stud|pilot|tested|measured|benchmark|result|revenue|conversion|ctr|cpa|roas|saved|reduced|increased|accuracy|hours? saved|orders?|users?)/i.test(value);
  const hasCta = /(?:\b(?:buy|click|book|sign up|signup|get started|try it|try now|download|contact|apply|schedule|start free|subscribe|order|call us|dm me|message me|visit)\b)/i.test(value);
  const hasClaim = /(?:\b(?:will|can|could|helps?|reduces?|increases?|improves?|better|faster|cheaper|saves?|proven|guarantee|guaranteed|best|most|only|never)\b)/i.test(value);
  const hasWorkflow = /(?:\b(?:open|select|choose|enter|type|submit|send|review|approve|upload|create|add|remove|check|verify|scan|record|label|convert|export|save|move|route|assign|publish|login|navigate|press|tap)\b)/i.test(value);

  if (hasMoney) tags.push('price');
  if (hasProof) tags.push('proof');
  if (hasCta) tags.push('cta');
  if (hasClaim) tags.push('claim');
  if (hasWorkflow) tags.push('workflow');

  let kind = 'narration';
  if (hasCta) kind = 'cta';
  else if (hasProof) kind = 'proof';
  else if (hasMoney) kind = 'price';
  else if (hasClaim) kind = 'claim';
  else if (hasWorkflow) kind = 'workflow';

  return { kind, tags, lower };
}

function makeSegment({ start, end, text, alignment, sourceFormat, index }) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  const classified = classifyTranscriptSegment(cleaned);
  return {
    id: `tx-${String(index + 1).padStart(3, '0')}`,
    start: Number(Math.max(0, start || 0).toFixed(2)),
    end: Number(Math.max(start || 0, end || start || 0).toFixed(2)),
    text: cleaned,
    kind: classified.kind,
    tags: classified.tags,
    alignment,
    sourceFormat,
  };
}

function parseCueBlocks(text, duration) {
  const cleaned = String(text || '').replace(/^\uFEFF/, '').replace(/^WEBVTT[^\n]*\n?/i, '').trim();
  if (!cleaned.includes('-->')) return [];
  const blocks = cleaned.split(/\n\s*\n/);
  const segments = [];

  for (const block of blocks) {
    const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const match = lines[timingIndex].match(/((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[,.]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[,.]\d{1,3})?)/);
    if (!match) continue;
    const start = parseTimecode(match[1]);
    const end = parseTimecode(match[2]);
    if (start == null || end == null) continue;
    const body = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!body) continue;
    segments.push(makeSegment({
      start,
      end: duration ? Math.min(duration, end) : end,
      text: body,
      alignment: 'provided',
      sourceFormat: /^WEBVTT/i.test(String(text || '').trim()) ? 'vtt' : 'srt',
      index: segments.length,
    }));
    if (segments.length >= MAX_TRANSCRIPT_SEGMENTS) break;
  }

  return segments;
}

function parseTimestampedLines(text, duration) {
  const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const drafts = [];
  const pattern = /^\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[,.]\d{1,3})?)(?:\s*[-–—]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[,.]\d{1,3})?))?\]?\s*(?:[:\-–—]\s*)?(.+)$/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const start = parseTimecode(match[1]);
    const explicitEnd = parseTimecode(match[2]);
    if (start == null) continue;
    drafts.push({ start, explicitEnd, text: match[3].trim() });
    if (drafts.length >= MAX_TRANSCRIPT_SEGMENTS) break;
  }

  if (!drafts.length) return [];
  return drafts.map((draft, index) => {
    const nextStart = drafts[index + 1]?.start;
    let end = draft.explicitEnd;
    if (end == null) end = nextStart != null ? nextStart : draft.start + DEFAULT_SEGMENT_SECONDS;
    if (duration) end = Math.min(duration, end);
    if (end <= draft.start) end = Math.min(duration || (draft.start + DEFAULT_SEGMENT_SECONDS), draft.start + DEFAULT_SEGMENT_SECONDS);
    return makeSegment({
      start: draft.start,
      end,
      text: draft.text,
      alignment: 'provided',
      sourceFormat: 'timestamped-lines',
      index,
    });
  });
}

function sentenceCandidates(text = '') {
  return String(text || '')
    .replace(/^WEBVTT[^\n]*\n?/i, '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((line) => line.length >= 3)
    .slice(0, MAX_TRANSCRIPT_SEGMENTS);
}

function estimateSegments(text, duration) {
  const candidates = sentenceCandidates(text);
  if (!candidates.length || !duration) return [];
  const totalWeight = candidates.reduce((sum, item) => sum + Math.max(1, words(item).length), 0);
  let cursor = 0;
  return candidates.map((item, index) => {
    const weight = Math.max(1, words(item).length);
    const remaining = Math.max(0, duration - cursor);
    const span = index === candidates.length - 1
      ? remaining
      : Math.max(0.5, duration * (weight / totalWeight));
    const start = cursor;
    const end = Math.min(duration, start + span);
    cursor = end;
    return makeSegment({
      start,
      end,
      text: item,
      alignment: 'estimated',
      sourceFormat: 'estimated-sentence-spacing',
      index,
    });
  });
}

function firstOf(segments, tag) {
  return segments.find((segment) => segment.tags.includes(tag) || segment.kind === tag) || null;
}

export function deriveTranscriptSequence(segments = []) {
  const firstClaim = firstOf(segments, 'claim');
  const firstProof = firstOf(segments, 'proof');
  const firstCta = firstOf(segments, 'cta');
  const firstPrice = firstOf(segments, 'price');
  const claimProofGapSeconds = firstClaim && firstProof && firstProof.start > firstClaim.start
    ? Number((firstProof.start - firstClaim.start).toFixed(2))
    : null;
  const proofCtaGapSeconds = firstProof && firstCta && firstCta.start > firstProof.start
    ? Number((firstCta.start - firstProof.start).toFixed(2))
    : null;
  return { firstClaim, firstProof, firstCta, firstPrice, claimProofGapSeconds, proofCtaGapSeconds };
}

export function parseTimedTranscript(text = '', duration = 0) {
  const raw = String(text || '').trim();
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (!raw) {
    return {
      schemaVersion: 'brainsnn.transcript-timeline.v0.2',
      mode: 'none',
      sourceFormat: 'none',
      confidence: 0,
      segments: [],
      sequence: deriveTranscriptSequence([]),
      counts: {},
      disclaimer: 'No transcript was supplied. BrainSNN will not invent spoken content or exact semantic timing.',
    };
  }

  let segments = parseCueBlocks(raw, safeDuration);
  let sourceFormat = segments[0]?.sourceFormat || '';
  let mode = segments.length ? 'timed' : '';
  let confidence = segments.length ? 1 : 0;

  if (!segments.length) {
    segments = parseTimestampedLines(raw, safeDuration);
    if (segments.length) {
      sourceFormat = 'timestamped-lines';
      mode = 'timed';
      confidence = 0.95;
    }
  }

  if (!segments.length && safeDuration > 0) {
    segments = estimateSegments(raw, safeDuration);
    if (segments.length) {
      sourceFormat = 'estimated-sentence-spacing';
      mode = 'estimated';
      confidence = 0.35;
    }
  }

  if (!segments.length) {
    return {
      schemaVersion: 'brainsnn.transcript-timeline.v0.2',
      mode: 'none',
      sourceFormat: 'plain-text-untimed',
      confidence: 0,
      segments: [],
      sequence: deriveTranscriptSequence([]),
      counts: {},
      disclaimer: 'Transcript text was supplied without usable timestamps and video duration was unavailable, so BrainSNN did not invent timing.',
    };
  }

  const counts = segments.reduce((acc, segment) => {
    acc[segment.kind] = (acc[segment.kind] || 0) + 1;
    return acc;
  }, {});

  return {
    schemaVersion: 'brainsnn.transcript-timeline.v0.2',
    mode,
    sourceFormat,
    confidence,
    segments,
    sequence: deriveTranscriptSequence(segments),
    counts,
    disclaimer: mode === 'timed'
      ? 'Transcript timing comes from user-supplied captions/timecodes. BrainSNN classifies the supplied words; it does not independently verify what was spoken.'
      : 'Transcript timing is estimated from sentence length across the video duration. Treat ranges as review cues, not exact speech timestamps.',
  };
}

export function segmentAtTime(timeline, time) {
  const seconds = Math.max(0, Number(time) || 0);
  const segments = timeline?.segments || [];
  return segments.find((segment) => seconds >= segment.start && seconds < segment.end)
    || segments.reduce((best, segment) => (
      Math.abs(segment.start - seconds) < Math.abs((best?.start ?? Infinity) - seconds) ? segment : best
    ), null);
}

export function transcriptConfidenceLabel(timeline) {
  if (timeline?.mode === 'timed') return 'Provided timestamps';
  if (timeline?.mode === 'estimated') return 'Estimated timing';
  return 'No timed transcript';
}
