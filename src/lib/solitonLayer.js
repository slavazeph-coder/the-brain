export const SOLITON_PRESETS = Object.freeze({
  baseline: {
    name: 'baseline',
    label: 'Organic Baseline',
    carrierHz: 39,
    pressure: 22,
    trust: 68,
    coherence: 0.82,
    bindingIndex: 0.78,
    damping: 0.12,
  },
  'high-pressure': {
    name: 'high-pressure',
    label: 'High Manipulation Pressure',
    carrierHz: 39,
    pressure: 84,
    trust: 24,
    coherence: 0.41,
    bindingIndex: 0.36,
    damping: 0.29,
  },
  trustful: {
    name: 'trustful',
    label: 'High-Trust Analytical',
    carrierHz: 39,
    pressure: 15,
    trust: 88,
    coherence: 0.91,
    bindingIndex: 0.87,
    damping: 0.09,
  },
  mixed: {
    name: 'mixed',
    label: 'Mixed Salience Hook',
    carrierHz: 39,
    pressure: 54,
    trust: 52,
    coherence: 0.64,
    bindingIndex: 0.61,
    damping: 0.18,
  },
});

export function computeSolitonField({ metrics = {}, firewallSignals = null, affectProfile = null } = {}) {
  const fear = Number(metrics.fear ?? 20);
  const anger = Number(metrics.anger ?? 15);
  const urgency = Number(metrics.urgency ?? 25);
  const trust = Number(metrics.trust ?? 55);
  const pressure = firewallSignals?.overallPressure ?? Math.round((fear + anger + urgency) / 3);
  const coherence = Number(Math.max(0.15, Math.min(0.98, (trust / 100) * 0.65 + (1 - pressure / 100) * 0.35)).toFixed(3));
  const bindingIndex = Number(Math.max(0.1, Math.min(0.96, coherence * 0.92)).toFixed(3));

  return {
    layerId: 'L103',
    carrierHz: 39,
    coherence,
    bindingIndex,
    phaseDispersion: Number((1 - coherence).toFixed(3)),
    pressure,
    valence: affectProfile?.valence ?? Number(((trust - pressure) / 100).toFixed(2)),
    regime: coherence >= 0.7 ? 'phase-locked' : coherence >= 0.45 ? 'metastable' : 'decoherent',
  };
}

export function computeSolitonPreset(name = 'baseline') {
  const key = Object.prototype.hasOwnProperty.call(SOLITON_PRESETS, name) ? name : 'baseline';
  const preset = SOLITON_PRESETS[key];
  return {
    ...preset,
    field: computeSolitonField({
      metrics: {
        fear: preset.pressure,
        anger: preset.pressure * 0.8,
        urgency: preset.pressure,
        trust: preset.trust,
      },
    }),
  };
}

export function exploreSolitonField({ axis = 'pressure', steps = 9, base = {}, contentType = 'text' } = {}) {
  const count = Math.max(2, Math.min(25, Number(steps) || 9));
  const series = [];
  for (let i = 0; i < count; i += 1) {
    const value = Math.round((i / (count - 1)) * 100);
    const pressure = axis === 'pressure' ? value : Number(base.pressure ?? 35);
    const trust = axis === 'trust' ? value : Number(base.trust ?? 60);
    series.push({
      step: i,
      value,
      field: computeSolitonField({
        metrics: { fear: pressure, anger: pressure, urgency: pressure, trust },
      }),
    });
  }
  return { axis, steps: count, contentType, series };
}
