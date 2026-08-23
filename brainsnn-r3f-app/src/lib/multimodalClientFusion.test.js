import { describe, expect, it } from '../test/tinyVitest.js';
import { deriveAudioEnvelope } from './audioFeatures.js';
import { buildClientMultimodalFusion } from './multimodalClientFusion.js';

function mediaFixture() {
  const duration = 20;
  const signals = Array.from({ length: 21 }, (_, index) => ({
    timestamp: index,
    luminance: 0.25 + ((index % 5) * 0.04),
    red: 0.28 + ((index % 3) * 0.03),
    green: 0.25,
    blue: 0.31 + ((index % 4) * 0.02),
    motion: index >= 10 && index <= 14 ? 0.72 - ((index - 10) * 0.1) : 0.14 + ((index % 4) * 0.05),
  }));
  const samples = new Float32Array(8000 * duration);
  for (let i = 0; i < samples.length; i += 1) {
    const second = i / 8000;
    const amplitude = second >= 8 && second < 12 ? 0.55 : 0.12;
    samples[i] = Math.sin((i / 8000) * Math.PI * 2 * 180) * amplitude;
  }
  return {
    duration,
    fileName: 'demo.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    signals,
    audio: deriveAudioEnvelope(samples, 8000, duration, 2),
  };
}

function localAsrMediaFixture() {
  return {
    ...mediaFixture(),
    localTranscript: {
      schemaVersion: 'brainsnn.local-transcript.v0.3',
      status: 'ready',
      provider: 'transformers.js',
      model: 'Xenova/whisper-tiny.en',
      device: 'wasm',
      timing: 'model-word-timestamps',
      timingIsMeasured: false,
      rawAudioUploaded: false,
      wordCount: 12,
      segmentCount: 3,
      disclaimer: 'Speech and timestamps are model-generated locally in the browser.',
    },
  };
}

describe('client-ready multimodal fusion v0.3', () => {
  it('combines visual, audio and supplied transcript timing into one client brief', () => {
    const { result } = buildClientMultimodalFusion({
      media: mediaFixture(),
      text: `[00:02] This can cut your editing time dramatically\n[00:08] A customer pilot saved 20 hours\n[00:14] Book a demo today`,
    });
    expect(result.schemaVersion).toBe('brainsnn.multimodal.v0.3');
    expect(result.transcriptTimeline.mode).toBe('timed');
    expect(result.transcriptTimeline.timingOrigin).toBe('supplied');
    expect(result.audioTimeline.status).toBe('ready');
    expect(result.timelineTracks.some((track) => track.id === 'audio-energy')).toBe(true);
    expect(result.clientBrief.headline).toBe('Proof arrives after the claim');
    expect(result.clientBrief.primaryIssue).toMatch(/00:02/);
    expect(result.clientBrief.primaryIssue).toMatch(/00:08/);
    expect(result.clientBrief.exactEdit).toMatch(/00:08/);
    expect(result.clientBrief.exactEdit).toMatch(/00:02/);
    expect(result.clientMoments.length).toBeGreaterThan(0);
  });

  it('marks plain-transcript timing as estimated and avoids pretending timestamps are measured', () => {
    const { result } = buildClientMultimodalFusion({
      media: mediaFixture(),
      text: 'This can cut your editing time dramatically. A customer pilot saved 20 hours. Book a demo today.',
    });
    expect(result.transcriptTimeline.mode).toBe('estimated');
    expect(result.transcriptTimeline.timingOrigin).toBe('estimated');
    expect(result.clientBrief.alignmentMode).toBe('estimated');
    expect(result.recommendedEdit.timingNote.toLowerCase()).toMatch(/estimated/);
    expect(result.disclaimer.toLowerCase()).toMatch(/does not measure/);
    expect(result.provenance.transcript.toLowerCase()).toMatch(/estimated/);
  });

  it('preserves explicit scientific and privacy boundaries in the client payload', () => {
    const { result, packet } = buildClientMultimodalFusion({
      media: mediaFixture(),
      text: `[00:03] This can improve your workflow\n[00:09] Customer pilot saved 20 hours`,
    });
    expect(result.disclaimer.toLowerCase()).toMatch(/does not measure human attention/);
    expect(result.audioTimeline.disclaimer.toLowerCase()).toMatch(/do not transcribe speech/);
    expect(packet).toMatch(/client-ready multimodal v0.3/);
    expect(packet).toMatch(/Transcript alignment: supplied/);
  });

  it('keeps local Whisper timestamps useful without mislabelling them as supplied ground truth', () => {
    const { result, packet } = buildClientMultimodalFusion({
      media: localAsrMediaFixture(),
      text: `[00:02.0] This can cut your editing time dramatically\n[00:08.1] A customer pilot saved 20 hours\n[00:14.2] Book a demo today`,
    });
    expect(result.transcriptTimeline.mode).toBe('timed');
    expect(result.transcriptTimeline.timingOrigin).toBe('local-asr');
    expect(result.transcriptTimeline.timingIsMeasured).toBe(false);
    expect(result.clientBrief.alignmentMode).toBe('local-asr');
    expect(result.clientBrief.timingLabel.toLowerCase()).toMatch(/model-generated/);
    expect(result.recommendedEdit.timingNote.toLowerCase()).toMatch(/verify/);
    expect(result.recommendedEdit.timingNote.toLowerCase()).toMatch(/whisper/);
    expect(result.provenance.transcript.toLowerCase()).toMatch(/browser-local speech-to-text/);
    expect(result.provenance.transcript.toLowerCase()).toMatch(/raw audio not uploaded/);
    expect(result.clientBrief.presenterNotes[0].toLowerCase()).toMatch(/model-generated/);
    expect(result.clientBrief.presenterNotes[0].toLowerCase()).toMatch(/verify/);
    expect(result.clientBrief.presenterNotes[0].toLowerCase()).not.toMatch(/exact caption/);
    expect(result.disclaimer.toLowerCase()).toMatch(/speech and word timestamps are model-generated/);
    expect(packet).toMatch(/Transcript alignment: local-asr/);
    expect(packet).toMatch(/browser-local Xenova\/whisper-tiny.en/);
  });
});
