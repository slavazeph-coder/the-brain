import { describe, expect, it } from '../test/tinyVitest.js';
import { computeAffect } from './affectLayer.js';

const manipulative = {
  content: 'Act now! This is a furious, rigged scam and a dangerous threat. You will lose everything before the deadline.',
  metrics: { fear: 70, anger: 65, urgency: 80, trust: 20, excitement: 40 },
  firewallSignals: { emotionalActivation: 0.8 },
};
const trustworthy = {
  content: 'Here is the tested customer data and a verified case study to help you understand and decide together.',
  metrics: { fear: 10, anger: 5, urgency: 15, trust: 80, excitement: 45 },
  firewallSignals: { emotionalActivation: 0.2 },
};

describe('Affective Decoder (L29) depth', () => {
  it('keeps the back-compat fields', () => {
    const a = computeAffect(trustworthy);
    ['dominantAffect', 'valence', 'arousal', 'clusters'].forEach((key) => {
      expect(a[key] !== undefined).toBe(true);
    });
    expect(a.clusters).toHaveLength(4);
  });

  it('maps to a bounded valence-arousal circumplex with a full taxonomy', () => {
    const a = computeAffect(trustworthy);
    expect(a.circumplex.x).toBeGreaterThanOrEqual(-1);
    expect(a.circumplex.x).toBeLessThanOrEqual(1);
    expect(a.circumplex.y).toBeGreaterThanOrEqual(-1);
    expect(a.circumplex.y).toBeLessThanOrEqual(1);
    expect(a.taxonomy).toHaveLength(9);
    a.taxonomy.forEach((affect) => {
      expect(affect.score).toBeGreaterThanOrEqual(0);
      expect(affect.score).toBeLessThanOrEqual(100);
      expect(affect.x).toBeGreaterThanOrEqual(-1);
      expect(affect.y).toBeLessThanOrEqual(1);
    });
  });

  it('separates trustworthy (positive valence) from manipulative (negative, high arousal)', () => {
    const m = computeAffect(manipulative);
    const t = computeAffect(trustworthy);
    expect(t.valence).toBeGreaterThan(m.valence);
    expect(m.arousal).toBeGreaterThan(t.arousal);
    expect(t.circumplex.x).toBeGreaterThan(m.circumplex.x);
  });

  it('sorts taxonomy by score and is deterministic', () => {
    const a = computeAffect(manipulative);
    const b = computeAffect(manipulative);
    expect(JSON.stringify(a.taxonomy)).toBe(JSON.stringify(b.taxonomy));
    for (let i = 1; i < a.taxonomy.length; i += 1) {
      expect(a.taxonomy[i - 1].score).toBeGreaterThanOrEqual(a.taxonomy[i].score);
    }
  });

  it('emits a per-sentence emotion trajectory', () => {
    const a = computeAffect(manipulative);
    expect(a.trajectory.length).toBeGreaterThan(0);
    a.trajectory.forEach((seg) => {
      expect(seg.valence).toBeGreaterThanOrEqual(0);
      expect(seg.arousal).toBeLessThanOrEqual(100);
    });
  });
});
