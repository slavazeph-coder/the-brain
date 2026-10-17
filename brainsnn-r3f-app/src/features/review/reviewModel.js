import { techniquePressure } from '../../lib/persuasionTechniques.js';
import { classifyTranscriptSegment, parseTimedTranscript } from '../../lib/timedTranscript.js';
import { deriveVisualEvents } from '../../lib/mediaFusion.js';

export const REVIEW_TABS = [
  { id: 'passage', label: 'Passage' },
  { id: 'drafts', label: 'Two drafts' },
  { id: 'claims', label: 'Claim split' },
  { id: 'video', label: 'Video cues' },
];

export function reviewTabFromSearch(search = '') {
  const requested = new URLSearchParams(search).get('tab');
  return REVIEW_TABS.some(({ id }) => id === requested) ? requested : 'passage';
}

export function isSourceFinding(content, finding) {
  return Number.isInteger(finding?.start) && Number.isInteger(finding?.end)
    && finding.start >= 0 && finding.end > finding.start && finding.end <= content.length
    && content.slice(finding.start, finding.end) === finding.quotation;
}

function phrasePattern(phrase) {
  // Detector matches are lowercased and can normalize repeated-word spacing.
  // Match against the original string so UTF-16 offsets always select its bytes.
  return new RegExp('(?<![\\p{L}\\p{N}_])' + phrase.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+') + '(?![\\p{L}\\p{N}_])', 'giu');
}

export function inspectPassage(content) {
  const pressure = techniquePressure(content);
  const findings = pressure.techniques.flatMap((technique) => {
    const seen = new Set();
    return technique.matches.flatMap((phrase) => [...content.matchAll(phrasePattern(phrase))].flatMap((match) => {
      const key = `${match.index}:${match[0].length}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ start: match.index, end: match.index + match[0].length, quotation: match[0], signal: technique.label, explanation: `${technique.description}${technique.mapping === 'approximate' ? ' Approximate taxonomy mapping.' : ''}` }];
    }));
  });
  return { content, pressure: pressure.score, findings };
}

export function splitClaimCues(content) {
  const findings = [];
  for (const match of content.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)) {
    const quotation = match[0].trim();
    if (!quotation) continue;
    const start = match.index + match[0].indexOf(quotation);
    const { tags } = classifyTranscriptSegment(quotation);
    const detected = techniquePressure(quotation).techniques;
    if (tags.includes('claim')) findings.push({ start, end: start + quotation.length, quotation, signal: 'Claim wording', explanation: 'A promise, comparison or assertion to check against independent evidence.' });
    if (tags.includes('proof')) findings.push({ start, end: start + quotation.length, quotation, signal: 'Evidence-like wording', explanation: 'Numbers or evidence-related words occur here. This does not establish that the claim is supported.' });
    if (detected.length) findings.push({ start, end: start + quotation.length, quotation, signal: 'Framing cues', explanation: detected.map(({ label }) => label).join(' · ') });
  }
  return { content, findings };
}

export function buildVideoReview({ transcript = '', media = null } = {}) {
  // Supplying duration to this parser would invent sentence spacing for untimed
  // text. Review accepts only supplied timecodes or explicitly labelled ASR.
  const timeline = parseTimedTranscript(transcript);
  const duration = Number(media?.duration) || 0;
  const inRange = (timestamp) => Number.isFinite(timestamp) && timestamp >= 0 && (!duration || timestamp < duration);
  const captions = timeline.segments.filter((segment) => segment.alignment === 'provided' && inRange(segment.start));
  const visual = deriveVisualEvents(media?.signals || []).filter((event) => inRange(event.timestamp));
  const audio = (media?.audio?.status === 'ready' ? media.audio.points : [])
    .filter((point) => inRange(point.timestamp) && Number.isFinite(point.energy) && Number.isFinite(point.dynamics))
    .sort((a, b) => b.dynamics - a.dynamics).slice(0, 8).sort((a, b) => a.timestamp - b.timestamp);
  return {
    transcript, captions, visual, audio,
    captionOrigin: media?.localTranscript?.status === 'ready' ? 'Local Whisper · estimated timestamps' : 'Supplied captions · unverified timestamps',
    omittedCaptions: timeline.segments.length - captions.length,
    untimed: Boolean(transcript.trim()) && !timeline.segments.length,
  };
}
