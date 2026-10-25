import { describe, expect, it } from '../test/tinyVitest.js';
import { computeFirewall, detectTactics } from './firewallLayer.js';

const manipulative = {
  content: 'Last chance! Act now before this rigged scam destroys everything. Guaranteed disaster — they do not want you to know the hidden truth, so click immediately.',
  metrics: { fear: 70, anger: 60, urgency: 80, trust: 20, excitement: 40 },
  isFallback: true,
};
const trustworthy = {
  content: 'Here is the tested customer data and a verified case study. Review the evidence and decide whether it fits your team.',
  metrics: { fear: 10, anger: 5, urgency: 15, trust: 80, excitement: 40 },
  isFallback: true,
};

describe('Cognitive Firewall (L4) depth', () => {
  it('keeps the back-compat core signal fields', () => {
    const f = computeFirewall(manipulative);
    ['emotionalActivation', 'cognitiveSuppression', 'manipulationPressure', 'trustErosion', 'density', 'evidence', 'templates', 'source'].forEach((key) => {
      expect(f[key] !== undefined).toBe(true);
    });
    expect(f.manipulationPressure).toBeGreaterThanOrEqual(0);
    expect(f.manipulationPressure).toBeLessThanOrEqual(1);
  });

  it('grades manipulative content worse than trustworthy content', () => {
    const m = computeFirewall(manipulative);
    const t = computeFirewall(trustworthy);
    expect(m.manipulationPressure).toBeGreaterThan(t.manipulationPressure);
    expect('ABCDEF'.indexOf(m.grade)).toBeGreaterThanOrEqual('ABCDEF'.indexOf(t.grade));
    expect(['Low', 'Medium', 'High', 'Critical']).toContain(m.tier);
  });

  it('breaks pressure down by category and by sentence', () => {
    const f = computeFirewall(manipulative);
    expect(f.categories).toHaveLength(5);
    f.categories.forEach((cat) => {
      expect(cat.score).toBeGreaterThanOrEqual(0);
      expect(cat.score).toBeLessThanOrEqual(100);
    });
    expect(f.heatmap.length).toBeGreaterThan(0);
    f.heatmap.forEach((seg) => {
      expect(seg.pressure).toBeGreaterThanOrEqual(0);
      expect(seg.pressure).toBeLessThanOrEqual(100);
    });
  });

  it('ranks tactics by confidence, deterministically', () => {
    const a = computeFirewall(manipulative);
    const b = computeFirewall(manipulative);
    expect(JSON.stringify(a.tactics)).toBe(JSON.stringify(b.tactics));
    for (let i = 1; i < a.tactics.length; i += 1) {
      expect(a.tactics[i - 1].confidence).toBeGreaterThanOrEqual(a.tactics[i].confidence);
    }
  });

  it('flags forced urgency when pressure precedes proof', () => {
    const tactics = detectTactics('Act now! Limited time, urgent, before the deadline.');
    expect(tactics.some((tactic) => tactic.id === 'forced-urgency')).toBe(true);
  });
});
