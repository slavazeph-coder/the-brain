import { describe, expect, it } from '../test/tinyVitest.js';
import {
  __resetLocalTranscriberForTests,
  groupWordsIntoSegments,
  normalizeTranscriptionOutput,
  normalizeWordChunks,
  resampleAudio,
  transcriptSegmentsToBracketedText,
  transcribeAudioLocally,
} from './localTranscription.js';

describe('browser-local transcription v0.3', () => {
  it('resamples decoded PCM to the Whisper sample rate deterministically', () => {
    const input = new Float32Array(48000);
    for (let i = 0; i < input.length; i += 1) input[i] = Math.sin(i / 10);
    const output = resampleAudio(input, 48000, 16000);
    expect(output.length).toBe(16000);
    expect(Number.isFinite(output[7999])).toBe(true);
  });

  it('normalizes word-level timestamps without inventing negative time', () => {
    const words = normalizeWordChunks([
      { text: ' Hello', timestamp: [-0.1, 0.4] },
      { text: 'world.', timestamp: [0.45, 1.1] },
    ], 2);
    expect(words.length).toBe(2);
    expect(words[0].start).toBe(0);
    expect(words[1].end).toBe(1.1);
  });

  it('groups word timestamps into client-readable semantic lines', () => {
    const words = normalizeWordChunks([
      { text: 'We', timestamp: [0, 0.2] },
      { text: 'save', timestamp: [0.25, 0.5] },
      { text: 'twenty', timestamp: [0.55, 0.9] },
      { text: 'hours.', timestamp: [0.95, 1.3] },
      { text: 'Book', timestamp: [2.6, 2.9] },
      { text: 'a', timestamp: [2.95, 3.05] },
      { text: 'demo.', timestamp: [3.1, 3.5] },
    ], 5);
    const segments = groupWordsIntoSegments(words);
    expect(segments.length).toBe(2);
    expect(segments[0].text).toMatch(/twenty hours/);
    expect(transcriptSegmentsToBracketedText(segments)).toMatch(/\[00:00\.0\]/);
    expect(transcriptSegmentsToBracketedText(segments)).toMatch(/\[00:02\.6\]/);
  });

  it('marks locally generated timestamps as model output, not measured timing', () => {
    const result = normalizeTranscriptionOutput({
      text: 'We save twenty hours.',
      chunks: [
        { text: ' We', timestamp: [0, 0.3] },
        { text: ' save', timestamp: [0.35, 0.7] },
        { text: ' twenty', timestamp: [0.75, 1.05] },
        { text: ' hours.', timestamp: [1.1, 1.5] },
      ],
    }, { duration: 2, device: 'wasm' });
    expect(result.schemaVersion).toBe('brainsnn.local-transcript.v0.3');
    expect(result.timing).toBe('model-word-timestamps');
    expect(result.timingIsMeasured).toBe(false);
    expect(result.rawAudioUploaded).toBe(false);
    expect(result.disclaimer.toLowerCase()).toMatch(/model-generated/);
  });

  it('runs the full transcription orchestration against an injected pipeline without network access', async () => {
    __resetLocalTranscriberForTests();
    const calls = [];
    const fakePipeline = async (task, model, options) => {
      calls.push({ task, model, options });
      return async (waveform, inferenceOptions) => {
        calls.push({ waveformLength: waveform.length, inferenceOptions });
        return {
          text: 'Claim first. Proof follows.',
          chunks: [
            { text: ' Claim', timestamp: [0, 0.35] },
            { text: ' first.', timestamp: [0.4, 0.9] },
            { text: ' Proof', timestamp: [1.4, 1.8] },
            { text: ' follows.', timestamp: [1.85, 2.3] },
          ],
        };
      };
    };
    const progress = [];
    const samples = new Float32Array(48000 * 3);
    const result = await transcribeAudioLocally({
      samples,
      sampleRate: 48000,
      duration: 3,
      preferWebGPU: false,
      pipelineFactory: fakePipeline,
      onProgress: (event) => progress.push(event.stage),
    });
    expect(calls[0].task).toBe('automatic-speech-recognition');
    expect(calls[1].waveformLength).toBe(48000);
    expect(calls[1].inferenceOptions.return_timestamps).toBe('word');
    expect(result.timedText).toMatch(/Claim first/);
    expect(result.timedText).toMatch(/Proof follows/);
    expect(progress.includes('transcribing')).toBe(true);
    expect(progress.includes('complete')).toBe(true);
    __resetLocalTranscriberForTests();
  });
});
