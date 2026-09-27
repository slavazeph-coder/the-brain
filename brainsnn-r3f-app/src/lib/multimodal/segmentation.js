import { MULTIMODAL_SCHEMA_VERSION, normalizeMultimodalInput } from './schema.js';

export const DEFAULT_SEGMENT_DURATION_MS = 1500;
export const MAX_TEMPORAL_SEGMENTS = 5000;

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function splitTranscript(text = '') {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return (normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized]).map((item) => item.trim()).filter(Boolean);
}

function distributeUntimedTranscript(transcript, windows) {
  const sentences = splitTranscript(transcript);
  if (!sentences.length) return windows.map(() => '');
  if (windows.length === 1) return [sentences.join(' ')];
  const buckets = windows.map(() => []);
  sentences.forEach((sentence, index) => {
    const bucket = Math.min(windows.length - 1, Math.floor(index * windows.length / sentences.length));
    buckets[bucket].push(sentence);
  });
  return buckets.map((bucket) => bucket.join(' '));
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : undefined;
}

function aggregateFeatures(sourceSegments) {
  const features = {};
  for (const key of ['sceneChange', 'audioEnergy', 'visualChange', 'luminance', 'motion', 'red', 'green', 'blue', 'spectralCentroid', 'zeroCrossingRate']) {
    const value = mean(sourceSegments.map((segment) => Number(segment.features?.[key])));
    if (value !== undefined) features[key] = Number(value.toFixed(6));
  }
  if (sourceSegments.some((segment) => segment.features?.speechPresent !== undefined)) {
    features.speechPresent = sourceSegments.some((segment) => Boolean(segment.features?.speechPresent));
  }
  return features;
}

function associateSignals(signals, startMs, endMs) {
  return (signals || []).filter((signal) => signal.timestampMs >= startMs && (signal.timestampMs < endMs || signal.timestampMs === startMs));
}

function signalFeatures(visionSignals, audioSignals) {
  const features = aggregateFeatures([
    ...visionSignals.map((item) => ({ features: item })),
    ...audioSignals.map((item) => ({ features: item })),
  ]);
  if (audioSignals.some((item) => item.speechPresent !== undefined)) {
    features.speechPresent = audioSignals.some((item) => Boolean(item.speechPresent));
  }
  return features;
}

export function segmentMultimodalInput(value, options = {}) {
  const input = value?.schemaVersion === MULTIMODAL_SCHEMA_VERSION ? value : normalizeMultimodalInput(value, options);
  const durationMs = Math.max(1, Number(input.temporal?.endMs) - Number(input.temporal?.startMs));
  const segmentDurationMs = Number(options.segmentDurationMs ?? DEFAULT_SEGMENT_DURATION_MS);
  const overlapMs = Number(options.overlapMs ?? 0);
  if (!Number.isFinite(segmentDurationMs) || segmentDurationMs < 100 || segmentDurationMs > 60_000) {
    throw new Error('segmentDurationMs must be between 100 and 60000.');
  }
  if (!Number.isFinite(overlapMs) || overlapMs < 0 || overlapMs >= segmentDurationMs) {
    throw new Error('overlapMs must be non-negative and smaller than segmentDurationMs.');
  }
  const stepMs = segmentDurationMs - overlapMs;
  const windows = [];
  const timelineStart = Number(input.temporal.startMs) || 0;
  const timelineEnd = timelineStart + durationMs;
  for (let startMs = timelineStart; startMs < timelineEnd && windows.length < MAX_TEMPORAL_SEGMENTS; startMs += stepMs) {
    windows.push({ startMs, endMs: Math.min(timelineEnd, startMs + segmentDurationMs) });
  }
  if (!windows.length) windows.push({ startMs: timelineStart, endMs: timelineEnd });
  if (windows.length >= MAX_TEMPORAL_SEGMENTS && windows.at(-1).endMs < timelineEnd) {
    throw new Error(`Segmentation would exceed ${MAX_TEMPORAL_SEGMENTS} windows.`);
  }

  const sourceSegments = input.temporal.segments || [];
  const untimed = sourceSegments.some((segment) => segment.text)
    ? windows.map(() => '')
    : distributeUntimedTranscript(input.text?.transcript || '', windows);

  return windows.map((window, index) => {
    const associated = sourceSegments.filter((segment) => overlaps(window.startMs, window.endMs, segment.startMs, segment.endMs));
    const text = associated.map((segment) => segment.text).filter(Boolean).join(' ').trim() || untimed[index] || undefined;
    const visionSignals = associateSignals(input.signals?.vision, window.startMs, window.endMs);
    const audioSignals = associateSignals(input.signals?.audio, window.startMs, window.endMs);
    const features = {
      ...aggregateFeatures(associated),
      ...signalFeatures(visionSignals, audioSignals),
    };
    return {
      id: `${input.id}-segment-${String(index).padStart(4, '0')}`,
      index,
      startMs: window.startMs,
      endMs: window.endMs,
      ...(text ? { text } : {}),
      features,
      observations: {
        vision: visionSignals,
        audio: audioSignals,
      },
    };
  });
}

export const segmentTimeline = segmentMultimodalInput;
