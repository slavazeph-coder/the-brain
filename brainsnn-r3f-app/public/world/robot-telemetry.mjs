/** Local, bounded telemetry ingestion and comparison. Imported measurements retain
 * their origin and health; timestamps, registration and held-out status are explicit.
 * This module sends no robot commands and does not attest a producer or accuracy. */
import {vector3, normalizeQuaternion, quaternionFromEuler, quaternionFromAxisAngle, quaternionAngle, slerpQuaternion, importPose, normalizePose, transformPoint, multiplyQuaternions, rotateVector} from './robot-frames.mjs';
export const ROBOT_TELEMETRY_SCHEMA = 'brainsnn.robot-telemetry.v1';
export const ROBOT_TELEMETRY_LIMITS = Object.freeze({bytes: 16 * 1024 * 1024, samples: 20000, columns: 64, durationSeconds: 86400});
const I = {x: 0, y: 0, z: 0, w: 1};
const finite = (x, label) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw Error(`${label} must be finite.`); return x; };
const present = v => v !== undefined && v !== null && v !== '';
const num = (v, label) => { if (typeof v === 'string' && !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim())) throw Error(`${label} must be numeric.`); return finite(typeof v === 'string' ? Number(v) : v, label); };
const id = (v, label) => { if (typeof v !== 'string' || !v.trim() || v.length > 256 || /[\u0000-\u001f]/.test(v)) throw Error(`${label} needs a bounded explicit identifier.`); return v; };
function readCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (quoted || cell === '') quoted = !quoted; else throw Error('Malformed CSV quote.'); }
    else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell.trim()); cell = '';
      if (row.length > ROBOT_TELEMETRY_LIMITS.columns) throw Error('Telemetry CSV has too many columns.');
      if (c !== ',') { if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else cell += c;
    if (cell.length > 4096 || rows.length > ROBOT_TELEMETRY_LIMITS.samples + 1) throw Error('Telemetry CSV exceeds its bounded size.');
  }
  if (quoted) throw Error('Unclosed CSV quote.');
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  const headers = rows.shift(); if (!headers || !rows.length || new Set(headers).size !== headers.length || headers.some(h => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(h))) throw Error('Telemetry CSV needs distinct simple headers and data rows.');
  return rows.map((values, i) => { if (values.length !== headers.length) throw Error(`CSV row ${i + 2} has a different column count.`); const r = Object.create(null); headers.forEach((h, j) => { if (present(values[j])) r[h] = values[j]; }); return r; });
}
function angularPair(value, label, factor = 1) {
  if (!Array.isArray(value) || value.length !== 2) throw Error(`${label} needs left and right values.`);
  return value.map(v => { const x = num(v, label) * factor; if (Math.abs(x) > 1e9) throw Error(`${label} exceeds its range.`); return x; });
}
function optionalScalar(row, names, label) { for (const k of names) if (present(row[k])) return num(row[k], label); return null; }
function samplePose(row, cfg) {
  const raw = row.pose ?? row;
  if (present(raw.frameId) && raw.frameId !== cfg.frameId || present(raw.childFrameId) && raw.childFrameId !== cfg.childFrameId) throw Error('A sample cannot silently change the declared pose frame.');
  let position = raw.position ?? (['x', 'y', 'z'].every(k => present(raw[k])) ? [num(raw.x, 'x'), num(raw.y, 'y'), num(raw.z, 'z')] : null);
  if (position === null) return null;
  position = vector3(Array.isArray(position) ? position.map(v => num(v, 'Position')) : {x: num(position.x, 'x'), y: num(position.y, 'y'), z: num(position.z, 'z')});
  position = {x: position.x * cfg.lengthFactor, y: position.y * cfg.lengthFactor, z: position.z * cfg.lengthFactor};
  if (Math.max(...Object.values(position).map(Math.abs)) > 1e6) throw Error('Pose exceeds the local metric range.');
  let quaternion = raw.orientation ?? raw.quaternion ?? null, orientation = null;
  if (quaternion === null && ['qx', 'qy', 'qz', 'qw'].every(k => present(raw[k]))) quaternion = {x: num(raw.qx, 'qx'), y: num(raw.qy, 'qy'), z: num(raw.qz, 'qz'), w: num(raw.qw, 'qw')};
  if (quaternion !== null) orientation = normalizeQuaternion(quaternion, cfg.convention === 'mujoco' ? 'wxyz' : 'xyzw');
  else if (present(raw.yawRad) || present(raw.yaw)) {
    const yaw = present(raw.yawRad) ? num(raw.yawRad, 'Yaw') : num(raw.yaw, 'Yaw') * cfg.angleFactor;
    // Imported yaw is a right-handed rotation around the declared up axis. The
    // legacy room path's heading (positive x toward positive z) is handled separately.
    orientation = cfg.convention === 'world-y-up' ? quaternionFromAxisAngle([0, 1, 0], yaw) : quaternionFromEuler(0, 0, yaw);
  }
  const converted = importPose({frameId: cfg.frameId, childFrameId: cfg.childFrameId, position, orientation: orientation ?? I}, {convention: cfg.convention === 'world-y-up' ? 'world-y-up' : 'ros'});
  return {frameId: cfg.frameId, childFrameId: cfg.childFrameId, position: converted.position, orientation: orientation ? converted.orientation : null};
}
export function parseRobotTelemetry(text, options = {}) {
  if (typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > ROBOT_TELEMETRY_LIMITS.bytes) throw Error('Use a non-empty telemetry file no larger than 16 MiB.');
  text = text.replace(/^\uFEFF/, '');
  const isJSON = options.format === 'json' || options.format !== 'csv' && /^[\s]*[\[{]/.test(text);
  let document, rows;
  if (isJSON) { try { document = JSON.parse(text); } catch { throw Error('Telemetry is not valid JSON.'); } rows = Array.isArray(document) ? document : document?.samples ?? (document?.sample ? [document.sample] : null); }
  else { document = {}; rows = readCSV(text.replace(/^\uFEFF/, '')); }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > ROBOT_TELEMETRY_LIMITS.samples) throw Error('Telemetry needs 1–20000 samples.');
  const native = document?.schema === 'brainsnn.localization-recording.v1' || document?.schema === 'brainsnn.localization-telemetry.v1';
  const sourceId = id(options.sourceId ?? document.sourceId ?? (native && document.binding?.bundleSha256 ? `localization:${document.binding.bundleSha256}` : null), 'Telemetry source');
  const frameId = id(native ? document.binding?.mapFrame : options.frameId ?? document.frameId, 'Pose frame');
  const childFrameId = id(document.childFrameId ?? document.binding?.baseFrame ?? options.childFrameId ?? 'base_link', 'Robot frame');
  if (frameId === childFrameId) throw Error('Telemetry pose needs distinct map and robot frames.');
  const timeUnit = native ? 's' : options.timeUnit ?? document.units?.time ?? 's';
  const lengthUnit = native ? 'm' : options.lengthUnit ?? document.units?.length ?? 'm';
  const angleUnit = native ? 'rad' : options.angleUnit ?? document.units?.angle ?? 'rad';
  if (!['s', 'ms'].includes(timeUnit) || !['m', 'mm'].includes(lengthUnit) || !['rad', 'deg'].includes(angleUnit)) throw Error('Supported telemetry units are s/ms, m/mm and rad/deg.');
  const cfg = {frameId, childFrameId, lengthFactor: lengthUnit === 'mm' ? .001 : 1, angleFactor: angleUnit === 'deg' ? Math.PI / 180 : 1, convention: native ? 'ros' : options.convention ?? document.convention ?? 'ros'};
  if (!['ros', 'mujoco', 'world-y-up'].includes(cfg.convention)) throw Error('Declare a supported coordinate convention.');
  const issue = (code, index, detail, severity = 'warning') => { if (issues.length < 500) issues.push({code, index, detail, severity}); if (severity === 'error') valid = false; };
  const issues = [], samples = []; let valid = true, previous = -Infinity, firstNs = null, lastNs = null;
  const maxGap = options.maxGapSeconds ?? 1; finite(maxGap, 'Gap threshold'); if (maxGap <= 0 || maxGap > 3600) throw Error('Gap threshold is outside its supported range.');
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Each telemetry sample must be an object.');
      let t, timestampNs = null;
      if (present(row.timestampNs)) {
        if (typeof row.timestampNs !== 'string' || !/^[0-9]{1,20}$/.test(row.timestampNs)) throw Error('Nanosecond stamps must be decimal strings to retain precision.');
        const stamp = BigInt(row.timestampNs); if (native && stamp <= 0n) throw Error('Native localization timestamps must be positive.'); if (firstNs === null) firstNs = stamp;
        t = Number(stamp - firstNs) / 1e9; timestampNs = row.timestampNs;
        if (lastNs !== null && stamp <= lastNs) issue('out-of-order', index, 'Nanosecond timestamps are not strictly increasing.', 'error');
        lastNs = stamp;
        if (present(row.t) && Math.abs(num(row.t, 'Relative seconds') - t) > 1e-5) throw Error('Relative seconds disagree with nanosecond stamps.');
      } else {
        if (native) throw Error('Native localization samples require timestampNs.');
        t = num(row.t ?? row.timeSeconds ?? row.time ?? row.timestamp, 'Timestamp') * (timeUnit === 'ms' ? .001 : 1);
      }
      if (t < 0 || t > 1e12) throw Error('Timestamp exceeds its supported range.');
      if (t <= previous) issue('out-of-order', index, 'Samples must be strictly ordered; data was not silently sorted.', 'error');
      if (Number.isFinite(previous) && t - previous > maxGap) issue('sample-gap', index, `Unobserved interval of ${t - previous} seconds.`);
      previous = t;
      const state = row.state ?? document.state ?? 'unknown';
      if (!['tracking', 'weak', 'odometry-only', 'lost', 'stale', 'stopped', 'unknown'].includes(state)) throw Error('Unknown telemetry health state.');
      const pose = samplePose(row, cfg), e = row.encoder ?? {};
      if (native) {
        if (!Array.isArray(row.quaternion) || row.quaternion.length !== 4 || !row.quaternion.every(v => typeof v === 'number' && Number.isFinite(v)) || Math.abs(row.quaternion.reduce((s, v) => s + v * v, 0) - 1) > 1e-3) throw Error('Native localization quaternion must already be normalized.');
        if (!Array.isArray(row.covariance) || row.covariance.length !== 36 || !row.covariance.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6) || [0, 7, 14, 21, 28, 35].some(i => row.covariance[i] < 0)) throw Error('Native localization needs a bounded 6×6 covariance with nonnegative variances.');
      }
      let positions = row.wheelPositionRad ?? e.wheelPositionRad;
      if (positions === undefined && present(e.leftRad ?? row.leftEncoderRad) !== present(e.rightRad ?? row.rightEncoderRad)) throw Error('Encoder position needs both left and right wheel values.');
      if (positions === undefined && present(e.leftRad ?? row.leftEncoderRad) && present(e.rightRad ?? row.rightEncoderRad)) positions = [e.leftRad ?? row.leftEncoderRad, e.rightRad ?? row.rightEncoderRad];
      const velocities = row.wheelVelocityRadS ?? e.wheelVelocityRadS;
      const encoder = positions !== undefined || velocities !== undefined ? {wheelPositionRad: positions === undefined ? null : angularPair(positions, 'Encoder position'), wheelVelocityRadS: velocities === undefined ? null : angularPair(velocities, 'Encoder velocity')} : null;
      const commandRaw = row.command ?? row;
      const speed = optionalScalar(commandRaw, ['speedMps', 'commandSpeedMps', 'cmd_v'], 'Command speed');
      const yawRate = optionalScalar(commandRaw, ['yawRateRps', 'commandYawRateRps', 'cmd_w'], 'Command yaw rate');
      // A right-handed yaw rate follows the declared up axis. The proper Y-up
      // basis rotation maps +Y to +Z without reversing its sign.
      const command = speed !== null || yawRate !== null ? {speedMps: speed, yawRateRps: yawRate, origin: 'commanded, not measured'} : null;
      const currentA = optionalScalar(row, ['currentA', 'motorCurrentA'], 'Measured current'), voltageV = optionalScalar(row, ['voltageV', 'supplyVoltageV'], 'Measured voltage');
      if (currentA !== null && Math.abs(currentA) > 1e5 || voltageV !== null && (voltageV < 0 || voltageV > 1e5)) throw Error('Electrical telemetry is outside supported bounds.');
      if (!pose && !encoder && !command && currentA === null && voltageV === null) throw Error('Sample contains no supported measurement or command.');
      if (native && state === 'tracking' && (!row.diagnostics || row.diagnostics.level !== 0 || row.diagnostics.reinitializationRequested || row.diagnostics.poseSource !== 'pcl_pose')) issue('health-conflict', index, 'Native tracking claim does not agree with its diagnostics.', 'error');
      if (row.diagnostics?.statusTimestampNs && timestampNs && Math.abs(Number(BigInt(row.diagnostics.statusTimestampNs) - BigInt(timestampNs)) / 1e9) > .5) issue('stale-diagnostics', index, 'Localization health belongs to a different time.', 'error');
      if (['lost', 'stale', 'stopped'].includes(state)) issue('unusable-pose', index, `The source reports ${state}; this pose will not enter error metrics.`);
      samples.push({t, timestampNs, pose, encoder, command, currentA, voltageV, state, sourceIndex: index, poseSource: row.diagnostics?.poseSource ?? document.poseSource ?? options.poseSource ?? 'operator-supplied', covariance: native && Array.isArray(row.covariance) ? row.covariance.slice(0, 36) : null});
    } catch (error) { issue('invalid-sample', index, error.message, 'error'); }
  }
  if (!samples.length) valid = false;
  if (samples.length && samples.at(-1).t - samples[0].t > ROBOT_TELEMETRY_LIMITS.durationSeconds) issue('duration-limit', null, 'Telemetry duration exceeds one day.', 'error');
  if (options.nowSeconds !== undefined && samples.length) {
    finite(options.nowSeconds, 'Current time in the log clock'); const age = options.nowSeconds - samples.at(-1).t;
    if (age > (options.staleAfterSeconds ?? 1)) issue('stale-stream', null, `The newest sample is ${age} seconds old in the declared log clock.`);
    if (age < 0) issue('future-timestamp', null, 'The log is ahead of the declared current clock.', 'error');
  }
  return {schema: ROBOT_TELEMETRY_SCHEMA, sourceId, frameId, childFrameId, samples, issues, valid,
    units: {time: 's', length: 'm', angle: 'rad', quaternion: 'xyzw'}, inputUnits: {time: timeUnit, length: lengthUnit, angle: angleUnit},
    inputConvention: cfg.convention, timestampOriginNs: firstNs?.toString() ?? null, datasetRole: document.datasetRole ?? options.datasetRole ?? 'unspecified',
    referenceIndependent: document.referenceIndependent === true && options.referenceIndependent === true,
    binding: native ? document.binding ?? null : document.binding ?? null,
    provenance: {format: native ? document.schema : isJSON ? 'json' : 'csv', producerOrigin: document.runtime?.origin ?? document.origin ?? 'operator-supplied', producerAttested: false, physicalValidated: false,
      note: 'Imported values and producer claims are preserved as source evidence, not independently verified physical accuracy.'}};
}
function recordingSamples(recording) {
  const frames = recording?.frames ?? recording?.samples;
  if (!Array.isArray(frames) || !frames.length || frames.length > 100000) throw Error('Use a bounded simulation or reference recording.');
  const frameId = id(recording.frameId ?? recording.binding?.mapFrame ?? 'map', 'Reference frame'), childFrameId = id(recording.childFrameId ?? 'base_link', 'Reference robot frame');
  if (frameId === childFrameId) throw Error('Reference pose needs distinct map and robot frames.');
  let previous = -Infinity;
  const samples = frames.map(f => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw Error('Each reference sample must be an object.');
    for (const declared of [f, f.pose]) if (declared && (present(declared.frameId) && declared.frameId !== frameId || present(declared.childFrameId) && declared.childFrameId !== childFrameId)) throw Error('A reference sample cannot change the declared pose frame.');
    const t = finite(f.time ?? f.t ?? f.timeSeconds, 'Recording time'); if (t < 0 || t > 1e12 || t <= previous) throw Error('Reference samples need bounded, nonnegative and strictly ordered times.'); previous = t;
    let pose;
    if (f.pose?.position) pose = {...f.pose, frameId, childFrameId};
    else if (Array.isArray(f.positionXYZ) && f.positionXYZ.length === 3) pose = {frameId, childFrameId, position: vector3(f.positionXYZ), orientation: f.quaternionWxyz ? normalizeQuaternion(f.quaternionWxyz, 'wxyz') : null, planar: false};
    else if (Array.isArray(f.position) && f.position.length === 2) {
      const position = {x: finite(f.position[0], 'Room X'), y: -finite(f.position[1], 'Room Z'), z: 0};
      const orientation = f.quaternionWxyz ? normalizeQuaternion(f.quaternionWxyz, 'wxyz') : present(f.headingRad ?? f.yaw) ? quaternionFromEuler(0, 0, -(f.headingRad ?? f.yaw)) : null;
      pose = {frameId, childFrameId, position, orientation, planar: true};
    } else if (Array.isArray(f.position) && f.position.length === 3) pose = {frameId, childFrameId, position: vector3(f.position), orientation: f.quaternion ? normalizeQuaternion(f.quaternion) : null};
    else if (typeof f.x === 'number' && typeof f.z === 'number') pose = {frameId, childFrameId, position: {x: f.x, y: -f.z, z: f.y ?? 0}, orientation: present(f.yaw) ? quaternionFromEuler(0, 0, -f.yaw) : null};
    else throw Error('Reference recording has no supported pose.');
    pose.position = vector3(pose.position); if (pose.orientation) pose.orientation = normalizeQuaternion(pose.orientation);
    return {t, pose};
  });
  if (samples.at(-1).t - samples[0].t > ROBOT_TELEMETRY_LIMITS.durationSeconds) throw Error('Reference recording duration exceeds one day.');
  if (samples.some(s => Boolean(s.pose.planar) !== Boolean(samples[0].pose.planar))) throw Error('Reference pose dimensions cannot change within a recording.');
  return samples;
}
function interpolate(samples, t, maxGap) {
  if (t < samples[0].t || t > samples.at(-1).t) return null;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].t <= t) lo = mid; else hi = mid; }
  if (Math.abs(t - samples[lo].t) < 1e-9) return samples[lo].pose;
  if (Math.abs(t - samples[hi].t) < 1e-9) return samples[hi].pose;
  const a = samples[lo], b = samples[hi], dt = b.t - a.t; if (dt > maxGap || dt <= 0) return null;
  const u = (t - a.t) / dt, x = a.pose.position, y = b.pose.position;
  return {...a.pose, position: {x: x.x + u * (y.x - x.x), y: x.y + u * (y.y - x.y), z: x.z + u * (y.z - x.z)}, orientation: a.pose.orientation && b.pose.orientation ? slerpQuaternion(a.pose.orientation, b.pose.orientation, u) : null};
}
function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), sum = values.reduce((a, b) => a + b, 0);
  return {mean: sum / values.length, rms: Math.sqrt(values.reduce((a, x) => a + x * x, 0) / values.length), max: sorted.at(-1), p95: sorted[Math.min(sorted.length - 1, Math.ceil(.95 * sorted.length) - 1)]};
}
export function compareRobotTelemetry(recording, telemetry, options = {}) {
  if (!telemetry || telemetry.schema !== ROBOT_TELEMETRY_SCHEMA || !Array.isArray(telemetry.samples)) throw Error('Parse the telemetry before comparing it.');
  const predicted = recordingSamples(recording), frameId = predicted[0].pose.frameId;
  const provenance = {telemetrySourceId: telemetry.sourceId, referenceId: recording.id ?? recording.sourceId ?? recording.capabilitySha256 ?? 'provided-recording',
    registration: options.registration ?? null, timeAlignmentConfirmed: options.timeAlignmentConfirmed === true,
    evaluationRole: options.heldOut === true ? 'operator-declared-held-out' : 'exploratory', physicalAccuracyVerified: false, producerAttested: false};
  const base = {schema: 'brainsnn.robot-telemetry-comparison.v1', matchedSamples: 0, coverage: 0, metrics: null, pairs: [], excluded: {}, issues: [], provenance};
  if (!telemetry.valid) return {...base, status: 'invalid-telemetry', issues: telemetry.issues};
  const reg = options.registration;
  if (!reg?.confirmed) return {...base, status: 'needs-registration', issues: ['Confirm a source-bound spatial registration; equal frame names alone are not evidence of alignment.']};
  if (reg.sourceId !== telemetry.sourceId) return {...base, status: 'registration-source-mismatch', issues: ['Bind the registration to this exact telemetry source ID.']};
  if (telemetry.childFrameId !== predicted[0].pose.childFrameId) return {...base, status: 'robot-frame-mismatch', issues: ['The compared pose origins differ; supply telemetry for the same robot body frame.']};
  if (reg.frameId && reg.frameId !== frameId) return {...base, status: 'registration-frame-mismatch', issues: ['The registration belongs to a different reference frame.']};
  let transform = null;
  if (reg.transform) {
    transform = normalizePose(reg.transform);
    if (transform.timestampSeconds !== null) throw Error('Supply a declared static registration; time-varying transforms require synchronized samples.');
    if (transform.frameId !== frameId || transform.childFrameId !== telemetry.frameId) throw Error('Registration must map the telemetry frame into the reference frame.');
  } else if (telemetry.frameId !== frameId) return {...base, status: 'needs-frame-transform', issues: ['Different named frames require an explicit rigid registration transform.']};
  const offset = options.timeOffsetSeconds ?? 0, maxGap = options.maxGapSeconds ?? .5;
  finite(offset, 'Time offset'); finite(maxGap, 'Comparison gap'); if (Math.abs(offset) > 86400 || maxGap <= 0 || maxGap > 60) throw Error('Comparison time bounds are invalid.');
  if (!options.timeAlignmentConfirmed) return {...base, status: 'needs-time-alignment', issues: ['Confirm the task timestamps or supply a reviewed offset; time zero is not automatically the same event.']};
  const errors = [], angular = [], pairs = [], excluded = {noPose: 0, unhealthy: 0, odometryOnly: 0, outsideCoverage: 0}, allPoses = telemetry.samples.filter(s => s.pose).length;
  for (const sample of telemetry.samples) {
    if (!sample.pose) { excluded.noPose++; continue; }
    if (['lost', 'stale', 'stopped'].includes(sample.state)) { excluded.unhealthy++; continue; }
    if (sample.state === 'odometry-only' && options.includeOdometryOnly !== true) { excluded.odometryOnly++; continue; }
    const expected = interpolate(predicted, sample.t + offset, maxGap); if (!expected) { excluded.outsideCoverage++; continue; }
    const position = transform ? transformPoint(transform, sample.pose.position) : sample.pose.position;
    const orientation = sample.pose.orientation && (transform ? multiplyQuaternions(transform.orientation, sample.pose.orientation) : sample.pose.orientation);
    const errorM = Math.hypot(position.x - expected.position.x, position.y - expected.position.y, expected.planar ? 0 : position.z - expected.position.z);
    const angle = orientation && expected.orientation ? quaternionAngle(orientation, expected.orientation) : null;
    errors.push(errorM); if (angle !== null) angular.push(angle);
    pairs.push({t: sample.t, referenceTime: sample.t + offset, errorM, orientationErrorRad: angle, observed: position, predicted: expected.position, state: sample.state, dimensions: expected.planar ? 'planar-xy' : 'xyz'});
  }
  const calibrationSources = options.calibrationSourceIds ?? [];
  if (!Array.isArray(calibrationSources) || calibrationSources.length > 256 || !calibrationSources.every(s => typeof s === 'string' && s.length <= 256)) throw Error('Use a bounded list of calibration source IDs.');
  const overlap = calibrationSources.includes(telemetry.sourceId) || telemetry.datasetRole === 'calibration';
  if (overlap && options.heldOut) { provenance.evaluationRole = 'calibration-data-reused'; base.issues.push('This source was used for calibration and cannot establish held-out accuracy.'); }
  return {...base, status: !pairs.length ? 'no-comparable-samples' : overlap && options.heldOut ? 'calibration-reuse' : 'compared', matchedSamples: pairs.length,
    coverage: allPoses ? pairs.length / allPoses : 0, metrics: pairs.length ? {positionErrorM: stats(errors), orientationErrorRad: stats(angular), orientationSamples: angular.length} : null,
    pairs, excluded, provenance, issues: base.issues.concat(telemetry.issues.filter(i => i.code === 'sample-gap' || i.code === 'stale-stream'))};
}
/** Fit one symmetric wheel-radius scale from straight, independently observed travel.
 * Deliberately does not fit against odometry derived from those same encoders. */
export function calibrateWheelScale(telemetry, {wheelRadiusM, referenceIndependent = false, minimumTravelM = .5} = {}) {
  finite(wheelRadiusM, 'Wheel radius'); if (wheelRadiusM <= 0 || wheelRadiusM > 2) throw Error('Wheel radius is out of range.');
  finite(minimumTravelM, 'Minimum calibration travel'); if (minimumTravelM <= 0 || minimumTravelM > 1000) throw Error('Minimum calibration travel is out of range.');
  if (!telemetry?.valid || !referenceIndependent || telemetry.referenceIndependent !== true) return {status: 'independent-reference-required', applied: false, reasons: ['Wheel calibration requires a separately measured reference and explicit provenance, not wheel odometry.']};
  let numerator = 0, denominator = 0, travel = 0, used = 0;
  for (let i = 1; i < telemetry.samples.length; i++) {
    const a = telemetry.samples[i - 1], b = telemetry.samples[i];
    if (!a.pose?.orientation || !b.pose?.orientation || !a.encoder?.wheelPositionRad || !b.encoder?.wheelPositionRad || a.poseSource !== 'independent-reference' || b.poseSource !== 'independent-reference') continue;
    if (['lost', 'stale', 'stopped', 'odometry-only'].includes(a.state) || ['lost', 'stale', 'stopped', 'odometry-only'].includes(b.state) || b.t - a.t > 1 || b.t <= a.t) continue;
    if (quaternionAngle(a.pose.orientation, b.pose.orientation) > .02) continue;
    const dl = b.encoder.wheelPositionRad[0] - a.encoder.wheelPositionRad[0], dr = b.encoder.wheelPositionRad[1] - a.encoder.wheelPositionRad[1];
    if (Math.abs(dl - dr) > .02 * Math.max(.01, Math.abs(dl), Math.abs(dr))) continue;
    const predicted = .5 * (dl + dr) * wheelRadiusM, d = {x: b.pose.position.x - a.pose.position.x, y: b.pose.position.y - a.pose.position.y, z: b.pose.position.z - a.pose.position.z};
    const forward = rotateVector(a.pose.orientation, [1, 0, 0]), observed = d.x * forward.x + d.y * forward.y + d.z * forward.z;
    const lateral = Math.sqrt(Math.max(0, d.x * d.x + d.y * d.y + d.z * d.z - observed * observed));
    if (Math.abs(predicted) < 1e-4 || lateral > .02 || predicted * observed <= 0) continue;
    numerator += predicted * observed; denominator += predicted * predicted; travel += Math.abs(observed); used++;
  }
  if (used < 3 || travel < minimumTravelM || denominator < 1e-9) return {status: 'insufficient-independent-straight-travel', applied: false, usedIntervals: used, observedTravelM: travel};
  const scale = numerator / denominator;
  if (scale < .5 || scale > 2) return {status: 'implausible-scale', applied: false, wheelRadiusScale: scale, reasons: ['Check units, wheel identity, timestamps, slip and registration before accepting this fit.']};
  return {status: 'calibration-proposal', applied: false, sourceId: telemetry.sourceId, wheelRadiusScale: scale, proposedWheelRadiusM: wheelRadiusM * scale, usedIntervals: used, observedTravelM: travel,
    validation: 'Fitted to this calibration source. Test on a different held-out source before promotion; slip and reference errors can bias the fit.'};
}
