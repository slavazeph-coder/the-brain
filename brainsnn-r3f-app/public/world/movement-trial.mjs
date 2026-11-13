// Detector settings for reviewing a side-on chair-rise sequence; these thresholds
// define a reproducible candidate event and are not a clinical assessment.
export const SIT_TO_STAND_DEFAULTS = Object.freeze({
  seatedDegrees: 65, standingDegrees: 30, minHoldSeconds: 0.2,
  minRiseSeconds: 0.2, maxGapSeconds: 0.5, minConfidence: 0.5,
});

export function analyzeSitToStand(frames, options = {}) {
  const thresholds = { ...SIT_TO_STAND_DEFAULTS, ...options };
  const {seatedDegrees, standingDegrees, minHoldSeconds, minRiseSeconds, maxGapSeconds, minConfidence} = thresholds;
  if (![seatedDegrees, standingDegrees, minHoldSeconds, minRiseSeconds, maxGapSeconds, minConfidence].every(Number.isFinite) ||
      standingDegrees < 0 || seatedDegrees > 180 || standingDegrees >= seatedDegrees ||
      minHoldSeconds <= 0 || minRiseSeconds <= 0 || maxGapSeconds <= 0 || minConfidence < 0 || minConfidence > 1) {
    throw new Error('Check seated and standing angle thresholds, hold times, confidence and maximum frame gap.');
  }
  if (!Array.isArray(frames)) throw new Error('Supply timestamped knee angles.');
  const repetitions = [];
  let seatedSince = null, lastSeated = null, standingStart = null;
  let previousTime = -Infinity, previousValid = false, validFrames = 0, interruptions = 0;
  for (const frame of frames) {
    const {timeSeconds: time, kneeFlexionDegrees: angle, confidence} = frame;
    if (!Number.isFinite(time) || time < 0 || time <= previousTime) throw new Error('Use strictly increasing video times.');
    if (angle !== null && (!Number.isFinite(angle) || angle < 0 || angle > 180)) {
      throw new Error('Knee angle must be 0 to 180 degrees, or null for a missing frame.');
    }
    if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new Error('Frame confidence must be between 0 and 1.');
    }
    const valid = angle !== null && (confidence === undefined || confidence >= minConfidence);
    // A dropped pose (or a long unobserved interval) breaks the event even if
    // the poses on its two sides look like sitting and standing.
    if (!valid || time - previousTime > maxGapSeconds + 1e-9) {
      if (previousValid) interruptions++;
      seatedSince = null;
      lastSeated = null;
      standingStart = null;
    }
    previousTime = time;
    previousValid = valid;
    if (!valid) continue;
    validFrames++;

    if (angle >= seatedDegrees) {
      seatedSince ??= time;
      standingStart = null;
      // Once qualified, update the last seated sample until the rise begins.
      if (lastSeated || time - seatedSince + 1e-9 >= minHoldSeconds) lastSeated = frame;
      continue;
    }
    seatedSince = null;
    if (!lastSeated || angle > standingDegrees) {
      standingStart = null;
      continue;
    }
    standingStart ??= frame;
    if (time - standingStart.timeSeconds + 1e-9 < minHoldSeconds) continue;
    const duration = standingStart.timeSeconds - lastSeated.timeSeconds;
    if (duration + 1e-9 >= minRiseSeconds) {
      repetitions.push({
        startSeconds: lastSeated.timeSeconds, standSeconds: standingStart.timeSeconds,
        durationSeconds: duration, seatedDegrees: lastSeated.kneeFlexionDegrees,
        standingDegrees: standingStart.kneeFlexionDegrees,
        excursionDegrees: lastSeated.kneeFlexionDegrees - standingStart.kneeFlexionDegrees,
      });
    }
    // A sustained stand always consumes this seated observation; a later rise
    // must start from a fresh seated hold, even if this transition was too fast.
    lastSeated = null;
    standingStart = null;
  }
  return {repetitions, thresholds, validFrames, totalFrames: frames.length, interruptions,
    method: 'Projected knee-angle threshold crossings with sustained seated and standing holds. Duration runs from the last seated-threshold sample to the first sustained standing-threshold sample. Seat contact is unobserved.'};
}

// Work in video time on both traces. Keeping shifted knot values (rather than
// subtracting the offset back out) preserves exact overlap endpoints.
function alignedSamples(trace, kind) {
  if (!trace || trace.kind !== kind || typeof trace.label !== 'string' || !trace.label.trim() ||
      !Number.isFinite(trace.offsetSeconds) || !Array.isArray(trace.samples) || trace.samples.length < 2) {
    throw new Error('Provide separate labelled force traces with declared origins and synchronization offsets.');
  }
  let previous = -Infinity;
  return trace.samples.map(({timeSeconds, verticalForceN}) => {
    const time = timeSeconds + trace.offsetSeconds;
    if (!Number.isFinite(timeSeconds) || !Number.isFinite(time) || time <= previous || !Number.isFinite(verticalForceN)) {
      throw new Error('Force traces require finite values and strictly increasing synchronized times.');
    }
    previous = time;
    return {time, force: verticalForceN};
  });
}

function interpolate(a, b, t) {
  const fraction = (t - a.time) / (b.time - a.time);
  return (1 - fraction) * a.force + fraction * b.force;
}

/** Integrate model-minus-reference over the intersection of the piecewise-linear
 * traces and the requested video window. No new samples are counted as evidence. */
export function compareVerticalForce(modelled, measured, {startSeconds = 0, endSeconds, synthetic = false} = {}) {
  if (!Number.isFinite(startSeconds) || startSeconds < 0 ||
      (endSeconds !== undefined && (!Number.isFinite(endSeconds) || endSeconds <= startSeconds))) {
    throw new Error('Select a positive-duration interval on the video clock.');
  }
  const model = alignedSamples(modelled, synthetic ? 'synthetic' : 'modelled');
  const reference = alignedSamples(measured, synthetic ? 'synthetic' : 'measured');
  const start = Math.max(model[0].time, reference[0].time, startSeconds);
  const end = Math.min(model.at(-1).time, reference.at(-1).time, endSeconds ?? Infinity);
  const metadata = {synthetic, modelLabel:modelled.label, referenceLabel:measured.label,
    modelOffsetSeconds:modelled.offsetSeconds, referenceOffsetSeconds:measured.offsetSeconds,
    requestedStartSeconds:startSeconds, requestedEndSeconds:endSeconds ?? null,
    method:'Time-weighted model minus reference across overlapping piecewise-linear samples. Check that both traces represent the same contacts, vertical axis, and force units.'};
  if (start >= end) return {...metadata, status:'no-overlap', startSeconds:null, endSeconds:null,
    durationSeconds:0, biasN:null, maeN:null, rmseN:null};

  let i = 0, j = 0, time = start, signedArea = 0, absoluteArea = 0, squaredArea = 0;
  while (time < end) {
    while (model[i + 1].time <= time) i++;
    while (reference[j + 1].time <= time) j++;
    const next = Math.min(end, model[i + 1].time, reference[j + 1].time);
    const dt = next - time;
    const first = interpolate(model[i], model[i + 1], time) - interpolate(reference[j], reference[j + 1], time);
    const last = interpolate(model[i], model[i + 1], next) - interpolate(reference[j], reference[j + 1], next);
    signedArea += dt * (first + last) / 2;
    squaredArea += dt * (first * first + first * last + last * last) / 3;
    // |error| has an extra knot when the signed linear residual crosses zero.
    const a = Math.abs(first), b = Math.abs(last);
    if ((first < 0 && last > 0) || (first > 0 && last < 0)) absoluteArea += dt * (a*a + b*b) / (2*(a+b));
    else absoluteArea += dt * (a+b) / 2;
    time = next;
  }
  const durationSeconds = end - start;
  const biasN = signedArea / durationSeconds, maeN = absoluteArea / durationSeconds, rmseN = Math.sqrt(squaredArea / durationSeconds);
  if (![biasN, maeN, rmseN].every(Number.isFinite)) throw new Error('Force values or times exceed the supported numeric range.');
  return {...metadata, status:'compared', startSeconds:start, endSeconds:end, durationSeconds, biasN, maeN, rmseN};
}
