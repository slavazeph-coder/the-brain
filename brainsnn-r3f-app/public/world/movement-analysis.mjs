// Coordinates in the review file are fractions of the original video frame. Correct
// the aspect ratio before constructing vectors in the two-dimensional image plane.
export function kneeFlexion(landmarks, width, height) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('The video needs a known frame width and height.');
  }
  if (!Array.isArray(landmarks) || landmarks.length !== 3 || !landmarks.every(p =>
    p && [p.x, p.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1))) {
    throw new Error('Mark the hip, knee and ankle inside the frame.');
  }
  const [hip, knee, ankle] = landmarks;
  const thighX = (knee.x - hip.x) * width, thighY = (knee.y - hip.y) * height;
  const shinX = (ankle.x - knee.x) * width, shinY = (ankle.y - knee.y) * height;
  if (Math.hypot(thighX, thighY) < 1 || Math.hypot(shinX, shinY) < 1) {
    throw new Error('Place the three landmarks at distinct joint locations.');
  }
  const cross = thighX * shinY - thighY * shinX, dot = thighX * shinX + thighY * shinY;
  return Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
}

const MAX_SAMPLES = 100000;
function validateTrace({ kind, label, offsetSeconds, samples }) {
  if (!['measured', 'modelled', 'synthetic'].includes(kind)) throw new Error('Choose the force trace origin.');
  if (typeof label !== 'string' || !label.trim() || label.length > 300) throw new Error('Give the trace a source label (up to 300 characters).');
  if (!Number.isFinite(offsetSeconds)) throw new Error('Enter a finite time offset in seconds.');
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > MAX_SAMPLES) {
    throw new Error('A force trace needs 2 to 100,000 samples.');
  }
  let previous = -Infinity;
  for (const {timeSeconds, verticalForceN} of samples) {
    if (!Number.isFinite(timeSeconds) || !Number.isFinite(verticalForceN) || timeSeconds <= previous) {
      throw new Error('Force samples need finite values and strictly increasing times.');
    }
    previous = timeSeconds;
  }
}

// Both imported physical signals use seconds and one explicitly named, unit-bearing column.
export function readSignalCsv(text, valueColumn) {
  if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) throw new Error('Use a CSV under 8 MiB.');
  const lines = text.trim().split(/\r?\n/);
  const header = 'time_s,' + valueColumn;
  if (lines.shift()?.split(',').map(x => x.trim()).join(',') !== header) throw new Error('Use the CSV header ' + header + '.');
  if (lines.length < 2 || lines.length > MAX_SAMPLES) throw new Error('Use 2 to 100,000 samples.');
  const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  let previous = -Infinity;
  return lines.map((line, index) => {
    const fields = line.split(',').map(x => x.trim());
    const [timeSeconds, value] = fields.map(Number);
    if (fields.length !== 2 || !fields.every(x => decimal.test(x)) || !Number.isFinite(timeSeconds) ||
        !Number.isFinite(value) || timeSeconds <= previous) throw new Error(`Check the timestamp and value on CSV line ${index + 2}.`);
    previous = timeSeconds;
    return {timeSeconds, value};
  });
}

export function readForceCsv(text, { kind, label, offsetSeconds = 0 }) {
  const samples = readSignalCsv(text, 'vertical_force_n').map(({timeSeconds, value}) => ({timeSeconds, verticalForceN:value}));
  const trace = { kind, label, offsetSeconds, samples };
  validateTrace(trace);
  return trace;
}

// A source sample at time t is displayed at t + offsetSeconds on the video clock.
export function forceAt(trace, videoSeconds) {
  if (!trace || !Number.isFinite(videoSeconds)) return null;
  const samples = trace.samples, time = videoSeconds - trace.offsetSeconds;
  if (time < samples[0].timeSeconds || time > samples.at(-1).timeSeconds) return null;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (samples[mid].timeSeconds <= time) lo = mid;
    else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const fraction = (time - a.timeSeconds) / (b.timeSeconds - a.timeSeconds);
  return (1 - fraction) * a.verticalForceN + fraction * b.verticalForceN;
}

export function buildMovementReview({ source, observations, forceTrace = null }) {
  if (!source || !['video', 'synthetic'].includes(source.kind) ||
      typeof source.name !== 'string' || !source.name.trim() ||
      !Number.isInteger(source.width) || source.width < 1 || !Number.isInteger(source.height) || source.height < 1 ||
      !Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) throw new Error('Load a movement source first.');
  if (!Array.isArray(observations) || observations.length === 0 || observations.length > 10000) {
    throw new Error('A review needs 1 to 10,000 annotated frames.');
  }
  if (forceTrace) {
    validateTrace(forceTrace);
    if ((source.kind === 'synthetic') !== (forceTrace.kind === 'synthetic')) throw new Error('Keep synthetic examples separate from video evidence.');
  }
  const seenTimes = new Map();
  const frames = observations.map(({timeSeconds, landmarks, side}) => {
    if (side !== undefined && side !== 'left' && side !== 'right') throw new Error('A tagged frame needs a left or right side.');
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > source.durationSeconds) {
      throw new Error('Each annotated time must be inside the source duration.');
    }
    if (!seenTimes.has(side)) seenTimes.set(side, new Set());
    if (seenTimes.get(side).has(timeSeconds)) throw new Error('Save only one annotation per side at each time.');
    seenTimes.get(side).add(timeSeconds);
    const kneeFlexionDegrees = kneeFlexion(landmarks, source.width, source.height);
    return { timeSeconds, ...(side ? {side} : {}), landmarks: landmarks.map(({x,y}) => ({x,y})), kneeFlexionDegrees, verticalForceN: forceAt(forceTrace, timeSeconds) };
  }).sort((a,b) => a.timeSeconds - b.timeSeconds);
  return {
    schema: 'brainsnn.movement-review.v1', source: { ...source }, observations: frames,
    method: { landmarks: ['hip', 'knee', 'ankle'], coordinates: 'normalized image x right, y down',
      angle: 'Unsigned projected knee bend in degrees, with a straight limb at zero.',
      force: 'The supplied vertical force in newtons is linearly interpolated inside the trace. Video time equals trace time plus the declared offset.' },
    forceTrace, limitations: ['A 2D projection depends on viewpoint and landmark placement. It cannot distinguish flexion from hyperextension.',
      'Trace provenance and synchronization are supplied by the reviewer. Muscle forces and internal joint loads are not estimated.']
  };
}
