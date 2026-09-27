import { describe, expect, it } from '../test/tinyVitest.js';
import { audioPointAtTime, deriveAudioEnvelope, unavailableAudioTimeline } from './audioFeatures.js';

describe('browser-local audio envelope', () => {
  it('keeps silence bounded without fabricating activity', () => {
    const samples = new Float32Array(44100);
    const timeline = deriveAudioEnvelope(samples, 44100, 1, 2);
    expect(timeline.status).toBe('ready');
    expect(timeline.points).toHaveLength(2);
    expect(timeline.summary.maxEnergy).toBe(0);
    expect(timeline.points.every((point) => point.energy === 0)).toBe(true);
  });

  it('detects non-zero energy and change for a simple waveform', () => {
    const sampleRate = 8000;
    const samples = new Float32Array(sampleRate * 2);
    for (let i = 0; i < samples.length; i += 1) {
      const amplitude = i < sampleRate ? 0.08 : 0.6;
      samples[i] = Math.sin((i / sampleRate) * Math.PI * 2 * 220) * amplitude;
    }
    const timeline = deriveAudioEnvelope(samples, sampleRate, 2, 2);
    expect(timeline.status).toBe('ready');
    expect(timeline.summary.maxEnergy).toBeGreaterThan(0);
    expect(timeline.summary.meanDynamics).toBeGreaterThan(0);
    timeline.points.forEach((point) => {
      expect(point.energy).toBeGreaterThanOrEqual(0);
      expect(point.energy).toBeLessThanOrEqual(100);
      expect(point.activityProxy).toBeGreaterThanOrEqual(0);
      expect(point.activityProxy).toBeLessThanOrEqual(100);
      expect(point.dynamics).toBeGreaterThanOrEqual(0);
      expect(point.dynamics).toBeLessThanOrEqual(100);
    });
  });

  it('is deterministic for identical PCM input', () => {
    const samples = Float32Array.from([0, 0.1, -0.1, 0.3, -0.3, 0.05, -0.05, 0]);
    const a = deriveAudioEnvelope(samples, 8, 1, 2);
    const b = deriveAudioEnvelope(samples, 8, 1, 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns the nearest audio point for a playhead timestamp', () => {
    const timeline = {
      points: [
        { timestamp: 0, energy: 10 },
        { timestamp: 1, energy: 40 },
        { timestamp: 2, energy: 80 },
      ],
    };
    expect(audioPointAtTime(timeline, 1.2).energy).toBe(40);
    expect(audioPointAtTime(timeline, 1.8).energy).toBe(80);
  });

  it('represents unavailable audio explicitly', () => {
    const timeline = unavailableAudioTimeline('codec missing');
    expect(timeline.status).toBe('unavailable');
    expect(timeline.points).toHaveLength(0);
    expect(timeline.reason).toBe('codec missing');
  });
});
