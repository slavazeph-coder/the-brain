import { describe, expect, it } from '../test/tinyVitest.js';
import { attachBeliefReport, buildBeliefReport } from './beliefReport.js';

const MULTIMODAL = {
  temporalReadout: {
    points: [
      { timestamp: 0, attentionProxy: 28, responseChange: 12, loadProxy: 20, visualTone: 44, luminance: 34, stability: 88 },
      { timestamp: 5, attentionProxy: 76, responseChange: 82, loadProxy: 78, visualTone: 63, luminance: 71, stability: 18 },
      { timestamp: 10, attentionProxy: 42, responseChange: 30, loadProxy: 35, visualTone: 51, luminance: 48, stability: 70 },
      { timestamp: 15, attentionProxy: 35, responseChange: 18, loadProxy: 24, visualTone: 49, luminance: 43, stability: 82 },
    ],
    windows: {
      windows: [
        { start: 0, end: 5, attentionProxy: 35, responseChange: 26, loadProxy: 28, attentionDrop: -6 },
        { start: 5, end: 10, attentionProxy: 71, responseChange: 78, loadProxy: 76, attentionDrop: 19 },
        { start: 10, end: 15, attentionProxy: 39, responseChange: 27, loadProxy: 31, attentionDrop: 5 },
      ],
    },
    tracks: [{ id: 'response-change', label: 'Response change', values: [] }],
  },
  audioTimeline: {
    status: 'ready',
    points: [
      { timestamp: 0, energy: 18, dynamics: 8 },
      { timestamp: 5, energy: 92, dynamics: 81 },
      { timestamp: 10, energy: 36, dynamics: 24 },
      { timestamp: 15, energy: 22, dynamics: 15 },
    ],
  },
  transcriptTimeline: {
    segments: [
      { start: 1, end: 4, kind: 'claim', text: 'This can cut editing time.' },
      { start: 8, end: 11, kind: 'proof', text: 'A pilot saved 20 hours.' },
      { start: 13, end: 15, kind: 'cta', text: 'Book a demo.' },
    ],
  },
};

describe('Belief Report V0.1', () => {
  it('creates an S-DBN-ready pattern schema without pretending trained weights exist', () => {
    const report = buildBeliefReport(MULTIMODAL);
    expect(report.schemaVersion).toBe('brainsnn.belief.v0.1');
    expect(report.model.id).toBe('brainsnn-sdbn-proxy-v0');
    expect(report.model.learnedWeights).toBe(false);
    expect(report.windows).toHaveLength(3);
    expect(report.tracks).toHaveLength(4);
    expect(report.disclaimer.toLowerCase()).toMatch(/does not use trained s-dbn weights/);
  });

  it('keeps state, surprise, transition and agreement values bounded', () => {
    const report = buildBeliefReport(MULTIMODAL);
    report.windows.forEach((window) => {
      expect(window.stateId).toBeGreaterThanOrEqual(0);
      expect(window.stateId).toBeLessThanOrEqual(23);
      expect(window.surprise).toBeGreaterThanOrEqual(0);
      expect(window.surprise).toBeLessThanOrEqual(1);
      expect(window.transitionMagnitude).toBeGreaterThanOrEqual(0);
      expect(window.transitionMagnitude).toBeLessThanOrEqual(1);
      expect(window.agreement.score).toBeGreaterThanOrEqual(0);
      expect(window.agreement.score).toBeLessThanOrEqual(1);
    });
  });

  it('is deterministic for identical bounded multimodal input', () => {
    const first = buildBeliefReport(MULTIMODAL);
    const second = buildBeliefReport(MULTIMODAL);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('attaches pattern tracks without replacing existing temporal evidence', () => {
    const result = attachBeliefReport(MULTIMODAL);
    expect(result.temporalReadout.tracks).toHaveLength(5);
    expect(result.temporalReadout.tracks[0].id).toBe('response-change');
    expect(result.temporalReadout.tracks.some((track) => track.id === 'belief-surprise')).toBe(true);
    expect(result.beliefReport.summary.stateTransitions).toBeGreaterThanOrEqual(0);
  });
});
