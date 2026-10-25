import { describe, expect, it } from '../test/tinyVitest.js';
import {
  computeSolitonField,
  computeSolitonPreset,
  exploreSolitonField,
  SOLITON_PRESETS,
  GAMMA_BASE_HZ,
} from './solitonLayer.js';

const trustful = {
  content: 'Here is the tested customer data and a verified case study; review the evidence and decide whether it fits.',
  firewallSignals: { manipulationPressure: 0.113, cognitiveSuppression: 0.175, emotionalActivation: 0.2, trustErosion: 0 },
  affectProfile: { valence: 85, arousal: 55 },
  metrics: { firingRate: 60, plasticity: 55 },
};
const manipulative = {
  content: 'Last chance! Act now before this rigged scam destroys everything — guaranteed disaster, they don\'t want you to know!',
  firewallSignals: { manipulationPressure: 0.593, cognitiveSuppression: 0.613, emotionalActivation: 0.8, trustErosion: 0.752 },
  affectProfile: { valence: 50, arousal: 85 },
  metrics: { firingRate: 90, plasticity: 40 },
};

describe('39 Hz soliton field — deep model', () => {
  it('emits fixed-length time-series traces spanning the settling window', () => {
    const f = computeSolitonField(trustful);
    expect(f.coherenceTrace).toHaveLength(30);
    expect(f.frequencyTraceHz).toHaveLength(30);
    expect(f.sampleTimesMs).toHaveLength(30);
    expect(f.sampleTimesMs[0]).toBe(0);
    expect(f.sampleTimesMs[f.sampleTimesMs.length - 1]).toBeGreaterThanOrEqual(560);
    f.solitons.forEach((s) => {
      expect(s.track).toHaveLength(30);
      expect(s.width).toBeGreaterThan(0);
    });
  });

  it('is deterministic across runs (traces, spectrum, collisions, hash inputs)', () => {
    const a = computeSolitonField(manipulative);
    const b = computeSolitonField(manipulative);
    expect(JSON.stringify(a.coherenceTrace)).toBe(JSON.stringify(b.coherenceTrace));
    expect(JSON.stringify(a.spectralPeaks)).toBe(JSON.stringify(b.spectralPeaks));
    expect(a.collisions.length).toBe(b.collisions.length);
    expect(a.gammaCoherence).toBe(b.gammaCoherence);
    expect(a.thetaGammaPAC).toBe(b.thetaGammaPAC);
  });

  it('separates trustworthy (bound) from manipulative content', () => {
    const t = computeSolitonField(trustful);
    const m = computeSolitonField(manipulative);
    expect(t.gammaCoherence).toBeGreaterThan(m.gammaCoherence);
    expect(t.synchrony).toBe('bound');
  });

  it('reconciles collisions with leapfrogEvents and carries KdV phase shifts', () => {
    const f = computeSolitonField(manipulative);
    expect(f.collisions.length).toBe(f.leapfrogEvents);
    f.collisions.forEach((c) => {
      expect(c.tMs).toBeGreaterThanOrEqual(0);
      expect(c.tMs).toBeLessThanOrEqual(600);
      expect(c.phaseShift).toBeGreaterThanOrEqual(0);
    });
    expect(f.solitonEnergy).toBeGreaterThan(0);
    expect(f.energyConserved).toBe(true);
  });

  it('keeps PAC, bands and the lattice frequency in range', () => {
    const f = computeSolitonField(trustful);
    expect(f.thetaGammaPAC).toBeGreaterThanOrEqual(0);
    expect(f.thetaGammaPAC).toBeLessThanOrEqual(1);
    expect(f.effectiveFrequencyHz).toBeGreaterThanOrEqual(30);
    expect(f.effectiveFrequencyHz).toBeLessThanOrEqual(100);
    ['delta', 'theta', 'alpha', 'beta', 'gamma'].forEach((band) => {
      expect(f.oscillationBands[band]).toBeGreaterThanOrEqual(0);
      expect(f.oscillationBands[band]).toBeLessThanOrEqual(1);
    });
  });

  it('orders spectral peaks by descending power', () => {
    const f = computeSolitonField(manipulative);
    for (let i = 1; i < f.spectralPeaks.length; i += 1) {
      expect(f.spectralPeaks[i - 1].power).toBeGreaterThanOrEqual(f.spectralPeaks[i].power);
    }
  });

  it('shifts the context base frequency by content type, keeping 39 Hz canonical', () => {
    const text = computeSolitonField({ ...trustful, contentType: 'text' });
    const code = computeSolitonField({ ...trustful, contentType: 'code' });
    expect(text.baseFrequencyHz).toBe(GAMMA_BASE_HZ);
    expect(text.contextualBaseHz).toBe(39);
    expect(code.contextualBaseHz).toBeLessThanOrEqual(38);
  });

  it('shows coherence falling as pressure rises across the explore sweep', () => {
    const sweep = exploreSolitonField({ axis: 'pressure', steps: 9, base: 'mixed' });
    expect(sweep.curve).toHaveLength(9);
    const first = sweep.curve[0].gammaCoherence;
    const last = sweep.curve[sweep.curve.length - 1].gammaCoherence;
    expect(first).toBeGreaterThan(last);
    const third = Math.floor(sweep.curve.length / 3);
    const mean = (rows) => rows.reduce((acc, row) => acc + row.gammaCoherence, 0) / rows.length;
    expect(mean(sweep.curve.slice(0, third))).toBeGreaterThan(mean(sweep.curve.slice(-third)));
    // Deterministic sweep.
    const again = exploreSolitonField({ axis: 'pressure', steps: 9, base: 'mixed' });
    expect(JSON.stringify(again.curve)).toBe(JSON.stringify(sweep.curve));
  });

  it('resolves named presets to fields and rejects unknown names', () => {
    expect(computeSolitonPreset('high-pressure').solitonField.synchrony).toBe('desynchronized');
    expect(computeSolitonPreset('trustful').solitonField.synchrony).toBe('bound');
    expect(computeSolitonPreset('does-not-exist')).toBe(null);
    expect(Object.keys(SOLITON_PRESETS).length).toBeGreaterThanOrEqual(4);
  });
});
