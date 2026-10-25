import { describe, expect, it } from '../test/tinyVitest.js';
import { deriveAudioEnvelope } from './audioFeatures.js';
import { buildBeliefMultimodalFusion } from './beliefFusion.js';

function mediaFixture() {
  const duration = 20;
  const signals = Array.from({ length: 21 }, (_, index) => ({
    timestamp: index,
    luminance: 0.22 + ((index % 5) * 0.08),
    red: 0.24 + ((index % 3) * 0.08),
    green: 0.24,
    blue: 0.3 + ((index % 4) * 0.05),
    motion: index >= 6 && index <= 10 ? 0.7 - ((index - 6) * 0.08) : 0.1 + ((index % 4) * 0.07),
  }));
  const sampleRate = 8000;
  const samples = new Float32Array(sampleRate * duration);
  for (let i = 0; i < samples.length; i += 1) {
    const second = i / sampleRate;
    const amplitude = second >= 6 && second < 10 ? 0.65 : second >= 14 ? 0.22 : 0.08;
    samples[i] = Math.sin((i / sampleRate) * Math.PI * 2 * 180) * amplitude;
  }
  return {
    duration,
    fileName: 'belief-demo.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    signals,
    audio: deriveAudioEnvelope(samples, sampleRate, duration, 2),
  };
}

describe('belief multimodal fusion', () => {
  it('attaches the Belief Report to the existing client-ready video result', () => {
    const fusion = buildBeliefMultimodalFusion({
      media: mediaFixture(),
      text: `[00:02] This can cut editing time dramatically\n[00:08] A customer pilot saved 20 hours\n[00:14] Book a demo today`,
    });

    expect(fusion.result.schemaVersion).toBe('brainsnn.multimodal.v0.3');
    expect(fusion.result.beliefReport.schemaVersion).toBe('brainsnn.belief.v0.1');
    expect(fusion.result.beliefReport.model.learnedWeights).toBe(false);
    expect(fusion.result.beliefReport.windows.length).toBeGreaterThan(0);
    expect(fusion.result.temporalReadout.tracks.some((track) => track.id === 'belief-surprise')).toBe(true);
    expect(fusion.result.temporalReadout.tracks.some((track) => track.id === 'belief-agreement')).toBe(true);
    expect(fusion.result.timelineTracks.some((track) => track.id === 'belief-transition')).toBe(true);
  });

  it('adds the belief summary to the model packet without making trained-model claims', () => {
    const fusion = buildBeliefMultimodalFusion({
      media: mediaFixture(),
      text: `[00:03] This can improve your workflow\n[00:09] Customer pilot saved 20 hours\n[00:16] Book a demo`,
    });

    expect(fusion.packet).toMatch(/BrainSNN belief report v0.1/);
    expect(fusion.packet).toMatch(/trained weights: false/);
    expect(fusion.packet).toMatch(/Cross-model agreement:/);
    expect(fusion.packet.toLowerCase()).toMatch(/not trained s-dbn weights|not trained s-dbn|not trained/);
  });

  it('preserves existing client moments while allowing pattern-review moments', () => {
    const fusion = buildBeliefMultimodalFusion({
      media: mediaFixture(),
      text: `[00:02] This can cut editing time dramatically\n[00:08] A customer pilot saved 20 hours\n[00:14] Book a demo today`,
    });

    expect(fusion.result.clientMoments.length).toBeGreaterThan(0);
    expect(fusion.result.clientMoments.some((moment) => moment.source === 'visual' || moment.source === 'transcript')).toBe(true);
    expect(fusion.result.provenance.belief).toMatch(/sdbn-proxy-v0/);
  });
});
