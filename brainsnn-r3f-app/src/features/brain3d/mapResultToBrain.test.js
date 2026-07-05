import { describe, expect, it } from '../../test/tinyVitest.js';
import { SOLITON_PRESETS, computeSolitonPreset } from '../../lib/solitonLayer.js';
import { BRAIN_REGIONS } from './brainRegions.js';
import {
  collisionSchedule,
  mapPresetToActivities,
  mapResultToActivities,
  particleParams,
  synchronyPalette,
} from './mapResultToBrain.js';

const codes = BRAIN_REGIONS.map((region) => region.code);

function assertActivities(activities) {
  for (const code of codes) {
    expect(activities[code]).toBeGreaterThanOrEqual(0);
    expect(activities[code]).toBeLessThanOrEqual(1);
  }
}

describe('mapResultToActivities', () => {
  it('maps tribe regions to clamped activities', () => {
    const activities = mapResultToActivities({
      tribeProjection: { regions: { CTX: 72, HPC: 64, THL: 48, AMY: 620, BG: -5, PFC: 55, CBL: 'x' } },
    });
    assertActivities(activities);
    expect(activities.CTX).toBe(0.72);
    expect(activities.AMY).toBe(1);
    expect(activities.BG).toBe(0);
  });

  it('tolerates an explicit null result', () => {
    assertActivities(mapResultToActivities(null));
  });

  it('falls back to metrics when the projection is missing', () => {
    const activities = mapResultToActivities({ metrics: { urgency: 90, fear: 80, trust: 20, excitement: 70, empathy: 30 } });
    assertActivities(activities);
    expect(activities.AMY).toBeGreaterThan(activities.PFC);
  });
});

describe('mapPresetToActivities', () => {
  it('produces valid activities for every soliton preset', () => {
    for (const preset of Object.values(SOLITON_PRESETS)) {
      assertActivities(mapPresetToActivities(preset.drivers));
    }
  });

  it('drives amygdala harder under high pressure than baseline', () => {
    const calm = mapPresetToActivities(SOLITON_PRESETS.baseline.drivers);
    const hot = mapPresetToActivities(SOLITON_PRESETS['high-pressure'].drivers);
    expect(hot.AMY).toBeGreaterThan(calm.AMY);
    expect(calm.PFC).toBeGreaterThan(hot.PFC);
  });
});

describe('synchronyPalette', () => {
  it('returns distinct hues per synchrony state', () => {
    expect(synchronyPalette('bound').edge).toBe('#00f5ff');
    expect(synchronyPalette('desynchronized').edge).toBe('#fb7185');
    expect(synchronyPalette('partial').label).toBe('partial');
    expect(synchronyPalette(undefined).label).toBe('neutral');
  });
});

describe('particleParams', () => {
  it('clamps speed into a watchable range for extreme fields', () => {
    const slow = particleParams({ frequencyTraceHz: [1, 1, 1], gammaCoherence: 0.1 }, { firingRate: 0 });
    const fast = particleParams({ frequencyTraceHz: [500], gammaCoherence: 0.95 }, { firingRate: 100 });
    expect(slow.speed).toBeGreaterThanOrEqual(0.4);
    expect(fast.speed).toBeLessThanOrEqual(2.2);
  });
});

describe('collisionSchedule', () => {
  it('returns a sorted schedule within the loop window from a real preset field', () => {
    const preset = computeSolitonPreset('high-pressure');
    const schedule = collisionSchedule(preset.solitonField);
    const loopMs = preset.solitonField.sampleTimesMs[preset.solitonField.sampleTimesMs.length - 1];
    for (let index = 0; index < schedule.length; index += 1) {
      expect(schedule[index].atMs).toBeGreaterThanOrEqual(0);
      expect(schedule[index].atMs).toBeLessThanOrEqual(loopMs);
      expect(schedule[index].intensity).toBeGreaterThanOrEqual(0);
      expect(schedule[index].intensity).toBeLessThanOrEqual(1);
      if (index > 0) expect(schedule[index].atMs).toBeGreaterThanOrEqual(schedule[index - 1].atMs);
    }
  });

  it('handles missing fields safely', () => {
    expect(collisionSchedule(undefined)).toEqual([]);
    expect(collisionSchedule({})).toEqual([]);
  });
});
