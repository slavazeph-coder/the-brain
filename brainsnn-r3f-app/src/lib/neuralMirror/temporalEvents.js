import { createNeuralPrediction } from './schema.js';

function clamp(value) {
  return Number(Math.max(0, Math.min(1, Number(value) || 0)).toFixed(6));
}

function scalar(frame) {
  return frame.activations.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, frame.activations.length);
}

function event(frame, type, confidence, description, extra = {}) {
  return {
    timestampMs: frame.startMs,
    endMs: frame.endMs,
    type,
    confidence: clamp(confidence),
    description,
    ...extra,
  };
}

export function detectNeuralTemporalEvents(value, options = {}) {
  const prediction = createNeuralPrediction(value);
  const timeline = prediction.timeline;
  if (!timeline.length) return [];
  const values = timeline.map(scalar);
  const changes = values.map((value, index) => index ? Math.abs(value - values[index - 1]) : 0);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const maxValue = Math.max(...values);
  const maxChange = Math.max(...changes);
  const events = [];

  const peakIndex = values.indexOf(maxValue);
  events.push(event(timeline[peakIndex], 'response_peak', timeline[peakIndex].confidence,
    'Highest model-predicted response magnitude in this timeline.', { magnitude: Number(maxValue.toFixed(6)) }));

  if (timeline.length > 1) {
    const changeIndex = changes.indexOf(maxChange);
    events.push(event(timeline[changeIndex], 'rapid_change', Math.min(1, timeline[changeIndex].confidence * 0.7 + maxChange * 0.3),
      'Largest predicted response change between adjacent windows.', { changeMagnitude: Number(maxChange.toFixed(6)) }));
  }

  timeline.forEach((frame, index) => {
    const contributions = Object.values(frame.modalityContribution || {}).map(Number).filter((value) => value > 0);
    if (contributions.length >= 2) {
      const spread = Math.max(...contributions) - Math.min(...contributions);
      if (spread <= 0.18) events.push(event(frame, 'multimodal_convergence', frame.confidence * (1 - spread),
        'Available modality contribution estimates converge in this window.'));
      if (spread >= 0.55) events.push(event(frame, 'modality_disagreement', frame.confidence * spread,
        'Model contribution estimates differ substantially across available modalities.'));
    }
    if (frame.confidence < 0.3) events.push(event(frame, 'uncertainty_spike', 1 - frame.confidence,
      'Model confidence is lowest in this window.'));
    if (values[index] <= Math.max(0.02, mean * 0.35)) events.push(event(frame, 'low_information_region', 1 - Math.min(1, values[index] / Math.max(0.01, mean)),
      'Predicted response magnitude is low relative to this timeline.'));
    if (index > 0 && changes[index] > Math.max(0.08, mean * 0.45)) events.push(event(frame, 'response_transition', Math.min(1, changes[index] / Math.max(0.01, maxValue)),
      'Predicted response transitions between adjacent temporal windows.'));
  });

  const priority = { response_peak: 0, rapid_change: 1, multimodal_convergence: 2, uncertainty_spike: 3, modality_disagreement: 4, low_information_region: 5, response_transition: 6 };
  return events
    .sort((a, b) => a.timestampMs - b.timestampMs || priority[a.type] - priority[b.type])
    .filter((item, index, array) => index === array.findIndex((other) => other.timestampMs === item.timestampMs && other.type === item.type))
    .slice(0, Math.max(1, Number(options.maxEvents) || 16));
}
