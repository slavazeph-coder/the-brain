export const NEURAL_PREDICTION_SCHEMA_VERSION = 'brainsnn.neural-prediction.v1';
export const NEURAL_PREDICTION_DISCLAIMER = 'Model-predicted neural response on reference representation; not a measured brain scan or medical assessment.';

const MODALITIES = [
  { id: 'vision', label: 'Vision' },
  { id: 'audio', label: 'Audio' },
  { id: 'language', label: 'Language' },
];

const REFERENCE_SPACES = new Set(['abstract', 'parcel', 'fsaverage', 'mni152']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deviceLabel(device) {
  if (typeof device === 'string') return device.trim();
  if (!isRecord(device)) return '';
  return nonEmptyString(device.name) || nonEmptyString(device.type) || nonEmptyString(device.id);
}

function modalityEntry(source, modality) {
  const raw = isRecord(source) ? source[modality.id] : null;
  if (typeof raw === 'string') {
    return { ...modality, status: raw, detail: '' };
  }
  if (!isRecord(raw)) {
    return { ...modality, status: 'not_reported', detail: '' };
  }
  const extractor = raw.extractor;
  const detail = typeof extractor === 'string'
    ? extractor
    : isRecord(extractor)
      ? nonEmptyString(extractor.implementation) || nonEmptyString(extractor.id) || nonEmptyString(extractor.model)
      : nonEmptyString(raw.implementation) || nonEmptyString(raw.reason);
  return {
    ...modality,
    status: nonEmptyString(raw.status) || 'not_reported',
    detail,
  };
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!isRecord(event)) return [];
    const timestampMs = finiteNumber(event.timestampMs);
    const type = nonEmptyString(event.type);
    if (timestampMs === null || timestampMs < 0 || !type) return [];
    const confidence = finiteNumber(event.confidence);
    return [{
      timestampMs,
      type,
      confidence: confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null,
      description: nonEmptyString(event.description),
    }];
  });
}

function normalizeScanTrace(trace) {
  if (!Array.isArray(trace)) return [];
  return trace.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()];
    if (!isRecord(entry)) return [];
    const stage = nonEmptyString(entry.stage) || nonEmptyString(entry.event);
    const status = nonEmptyString(entry.status);
    if (!stage) return [];
    return [status ? `${stage} · ${status}` : stage];
  });
}

function normalizeComputeTrace(trace) {
  if (!Array.isArray(trace)) return [];
  return trace.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const engine = nonEmptyString(entry.engine) || nonEmptyString(entry.model);
    const status = nonEmptyString(entry.status);
    if (!engine && !status) return [];
    return [{ engine: engine || 'unreported', status: status || 'unreported' }];
  });
}

/**
 * Runtime validation at the rendering boundary. A matching schema with invalid
 * values is an explicit contract error; it is never repaired into a plausible
 * looking prediction.
 */
export function validateNeuralPrediction(prediction) {
  const errors = [];
  if (!isRecord(prediction)) return { valid: false, errors: ['Prediction must be an object.'] };
  if (prediction.schemaVersion !== NEURAL_PREDICTION_SCHEMA_VERSION) {
    return { valid: false, errors: [`Unsupported neural prediction schema: ${String(prediction.schemaVersion || 'missing')}.`] };
  }

  if (!isRecord(prediction.model) || !nonEmptyString(prediction.model.id)) errors.push('Model id is missing.');
  if (!isRecord(prediction.model) || !nonEmptyString(prediction.model.version)) errors.push('Model version is missing.');
  if (!isRecord(prediction.model) || !deviceLabel(prediction.model.device)) errors.push('Model device is missing.');
  if (!isRecord(prediction.referenceSpace) || !REFERENCE_SPACES.has(prediction.referenceSpace.type)) {
    errors.push('Reference space is missing or unsupported.');
  }
  if (!isRecord(prediction.summary)) errors.push('Prediction summary is missing.');
  if (!isRecord(prediction.evidence)) errors.push('Prediction evidence is missing.');
  if (isRecord(prediction.evidence) && typeof prediction.evidence.validatedAgainstNeuralData !== 'boolean') {
    errors.push('Neural-data validation status is missing.');
  }
  if (!isRecord(prediction.provenance)) errors.push('Prediction provenance is missing.');
  if (prediction.disclaimer !== NEURAL_PREDICTION_DISCLAIMER) errors.push('Prediction disclaimer is missing or non-canonical.');
  if (isRecord(prediction.provenance) && prediction.provenance.disclaimer !== NEURAL_PREDICTION_DISCLAIMER) {
    errors.push('Machine-readable provenance disclaimer is missing or non-canonical.');
  }

  const parcelCount = finiteNumber(prediction.referenceSpace?.parcelCount);
  if (parcelCount !== null && (!Number.isInteger(parcelCount) || parcelCount <= 0)) {
    errors.push('Parcel count must be a positive integer.');
  }

  if (!Array.isArray(prediction.timeline) || prediction.timeline.length === 0) {
    errors.push('Prediction timeline is empty.');
  } else {
    let previousStart = -1;
    prediction.timeline.forEach((frame, index) => {
      const prefix = `Timeline frame ${index + 1}`;
      if (!isRecord(frame)) {
        errors.push(`${prefix} must be an object.`);
        return;
      }
      const startMs = finiteNumber(frame.startMs);
      const endMs = finiteNumber(frame.endMs);
      const confidence = finiteNumber(frame.confidence);
      if (startMs === null || startMs < 0) errors.push(`${prefix} has an invalid start timestamp.`);
      if (endMs === null || startMs === null || endMs <= startMs) errors.push(`${prefix} has an invalid end timestamp.`);
      if (startMs !== null && startMs < previousStart) errors.push(`${prefix} is out of temporal order.`);
      if (startMs !== null) previousStart = startMs;
      if (confidence === null || confidence < 0 || confidence > 1) errors.push(`${prefix} confidence must be between 0 and 1.`);
      if (!Array.isArray(frame.activations) || frame.activations.length === 0) {
        errors.push(`${prefix} has no activation values.`);
      } else {
        if (frame.activations.some((value) => !Number.isFinite(value))) errors.push(`${prefix} contains a non-finite activation.`);
        if (parcelCount !== null && Number.isInteger(parcelCount) && frame.activations.length !== parcelCount) {
          errors.push(`${prefix} has ${frame.activations.length} values; expected ${parcelCount}.`);
        }
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function formatTimestampMs(value) {
  const milliseconds = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const fraction = milliseconds % 1000;
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
  return hours ? `${String(hours).padStart(2, '0')}:${base}` : base;
}

export function buildCurveCoordinates(points, width = 720, height = 180, padding = 18) {
  if (!Array.isArray(points) || !points.length) return [];
  const values = points.map((point) => point.meanActivation);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  return points.map((point, index) => ({
    x: padding + (points.length === 1 ? usableWidth / 2 : (index / (points.length - 1)) * usableWidth),
    y: padding + (span === 0 ? usableHeight / 2 : (1 - (point.meanActivation - minimum) / span) * usableHeight),
  }));
}

export function createNeuralMirrorViewModel(prediction, context = {}) {
  if (!isRecord(prediction) || prediction.schemaVersion !== NEURAL_PREDICTION_SCHEMA_VERSION) return null;
  const validation = validateNeuralPrediction(prediction);
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      disclaimer: nonEmptyString(prediction.disclaimer),
    };
  }

  const points = prediction.timeline.map((frame, index) => ({
    index,
    startMs: frame.startMs,
    endMs: frame.endMs,
    timeLabel: `${formatTimestampMs(frame.startMs)}–${formatTimestampMs(frame.endMs)}`,
    confidence: frame.confidence,
    meanActivation: mean(frame.activations.map((value) => Math.abs(value))),
    modalityContribution: isRecord(frame.modalityContribution) ? frame.modalityContribution : null,
  }));

  const status = nonEmptyString(prediction.modelStatus)
    || nonEmptyString(prediction.model?.status)
    || nonEmptyString(prediction.provenance?.modelStatus)
    || 'not_reported';

  return {
    valid: true,
    errors: [],
    points,
    model: {
      id: prediction.model.id,
      version: prediction.model.version,
      device: deviceLabel(prediction.model.device),
      status,
    },
    referenceSpace: {
      type: prediction.referenceSpace.type,
      atlas: nonEmptyString(prediction.referenceSpace.atlas),
      parcelCount: finiteNumber(prediction.referenceSpace.parcelCount),
    },
    modalities: MODALITIES.map((modality) => modalityEntry(context.modalityStatus, modality)),
    events: normalizeEvents(context.events),
    scanTrace: normalizeScanTrace(context.scanTrace),
    computeTrace: normalizeComputeTrace(context.computeTrace),
    disclaimer: prediction.disclaimer,
    evidence: isRecord(prediction.evidence) ? prediction.evidence : {},
    summary: isRecord(prediction.summary) ? prediction.summary : {},
  };
}
