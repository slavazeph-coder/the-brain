import { describe, expect, it } from '../test/tinyVitest.js';
import {
  buildMultimodalFusion,
  deriveVisualEvents,
  extractProofPoints,
  extractWorkflowSteps,
  frameSignalFromPixels,
} from './mediaFusion.js';

describe('multimodal fusion', () => {
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
          { timestamp: 0, luminance: 0.2, motion: 0 },
          { timestamp: 10, luminance: 0.7, motion: 0.5 },
        ],
      },
    });
    expect(fusion.packet.includes('demo.mp4')).toBe(true);
    expect(fusion.result.frameCount).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(fusion.result, 'rawFrames')).toBe(false);
  });
});
