import { describe, expect, it } from '../test/tinyVitest.js';
import {
  buildMultimodalFusion,
  deriveTemporalReadout,
  deriveVisualEvents,
  deriveWindowMoments,
  extractProofPoints,
  extractWorkflowSteps,
  frameSignalFromPixels,
  sampleCountForDuration,
} from './mediaFusion.js';

describe('multimodal fusion', () => {
  it('gives short-form creative denser browser-local sampling while staying bounded', () => {
    expect(sampleCountForDuration(12)).toBe(24);
    expect(sampleCountForDuration(30)).toBe(45);
    expect(sampleCountForDuration(60)).toBe(60);
    expect(sampleCountForDuration(120)).toBe(60);
    expect(sampleCountForDuration(600)).toBe(120);
    expect(sampleCountForDuration(3600)).toBe(120);
  });

  it('measures a changed frame as motion', () => {
    const first = new Uint8ClampedArray([0, 0, 0, 255, 20, 20, 20, 255]);
    const second = new Uint8ClampedArray([255, 255, 255, 255, 20, 20, 20, 255]);
    const signal = frameSignalFromPixels(second, first, 2.5);
    expect(signal.motion).toBeGreaterThan(0);
    expect(signal.timestamp).toBe(2.5);
  });

  it('turns visual change signals into timestamped events', () => {
    const events = deriveVisualEvents([
      { timestamp: 0, luminance: 0.2, motion: 0 },
      { timestamp: 5, luminance: 0.8, motion: 0.7 },
    ]);
    expect(events.some((event) => event.level === 'high')).toBe(true);
    expect(events.some((event) => event.timeLabel === '0:05')).toBe(true);
  });

  it('creates bounded temporal proxy tracks without claiming measured neural data', () => {
    const readout = deriveTemporalReadout([
      { timestamp: 0, luminance: 0.2, motion: 0, red: 0.2, green: 0.2, blue: 0.2 },
      { timestamp: 5, luminance: 0.8, motion: 0.7, red: 0.8, green: 0.3, blue: 0.2 },
    ]);
    expect(readout.tracks.length).toBe(6);
    expect(readout.strongest.timestamp).toBe(5);
    expect(readout.disclaimer.includes('not measured')).toBe(true);
    expect(readout.tracks.some((track) => track.label === 'Visual tone')).toBe(true);
    expect(readout.tracks.some((track) => track.provenance.includes('heuristic'))).toBe(true);
  });

  it('ranks real five-second windows instead of pretending one point is a five-second span', () => {
    const windows = deriveWindowMoments([
      { timestamp: 0, attentionProxy: 80, responseChange: 20, loadProxy: 20 },
      { timestamp: 2, attentionProxy: 75, responseChange: 30, loadProxy: 25 },
      { timestamp: 4, attentionProxy: 70, responseChange: 35, loadProxy: 30 },
      { timestamp: 6, attentionProxy: 25, responseChange: 80, loadProxy: 70 },
      { timestamp: 8, attentionProxy: 20, responseChange: 90, loadProxy: 75 },
      { timestamp: 10, attentionProxy: 18, responseChange: 70, loadProxy: 68 },
    ], 5);
    expect(windows.windowSeconds).toBe(5);
    expect(windows.weakest.start).toBeGreaterThanOrEqual(6);
    expect(windows.strongest.start).toBeGreaterThanOrEqual(4);
    expect(windows.weakest.sampleCount).toBeGreaterThan(1);
  });

  it('extracts workflow actions and concrete proof', () => {
    const text = 'Open the dashboard. Click export. We cut review time by 40% for 12 clients.';
    expect(extractWorkflowSteps(text).length).toBeGreaterThan(0);
    expect(extractProofPoints(text).length).toBeGreaterThan(0);
  });

  it('builds a compact packet without raw frames', () => {
    const fusion = buildMultimodalFusion({
      text: 'Click export. Revenue increased 20%.',
      media: {
        fileName: 'demo.mp4',
        duration: 10,
        signals: [
          { timestamp: 0, luminance: 0.2, motion: 0, red: 0.2, green: 0.2, blue: 0.2 },
          { timestamp: 5, luminance: 0.4, motion: 0.2, red: 0.4, green: 0.3, blue: 0.2 },
          { timestamp: 10, luminance: 0.7, motion: 0.5, red: 0.7, green: 0.4, blue: 0.2 },
        ],
      },
    });
    expect(fusion.packet.includes('demo.mp4')).toBe(true);
    expect(fusion.result.frameCount).toBe(3);
    expect(fusion.result.temporalReadout.tracks.length).toBe(6);
    expect(fusion.result.temporalReadout.windows.weakest).not.toBe(null);
    expect(fusion.result.provenance.audio).toBe('not analyzed');
    expect(fusion.result.recommendedEdit.instruction.length).toBeGreaterThan(0);
    expect(fusion.result.disclaimer.includes('pixels changed')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(fusion.result, 'rawFrames')).toBe(false);
  });
});
