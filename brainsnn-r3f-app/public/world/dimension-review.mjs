/** Browser-side evidence contracts. Numeric references stay separate from scale and review decisions. */
import {frameBounds, STRIDE, ARENA_MAX_POINTS} from './visual-geometry.mjs';

export const DIMENSION_SCHEMA = 'brainsnn.dimension-checks.v1';
export const DIMENSION_REPORT_SCHEMA = 'brainsnn.scene-measurements.v1';
const MAX_CHECKS = 64, MAX_BYTES = 64 * 1024, SHA = /^[a-f0-9]{64}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };
const exact = (value, keys, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail(`Invalid ${name} fields.`);
};
const number = (value, low, high, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`${name} must be finite and between ${low} and ${high}.`);
  return value;
};
const text = (value, limit, name, empty=false) => {
  if (typeof value !== 'string' || [...value].length > limit || (!empty && !value.trim()) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail(`Invalid ${name}.`);
  return value;
};
function cloudPoints(cloud) {
  if (!cloud || cloud.units !== 'm' || cloud.coordinateFrame !== 'right-handed-y-up' || !Array.isArray(cloud.points) || cloud.points.length < 1 || cloud.points.length > ARENA_MAX_POINTS) fail('Use a metric point cloud with 1 to 50,000 ordered points.');
  for (const row of cloud.points) {
    if (!Array.isArray(row) || row.length !== 6) fail('Each point needs XYZ and RGB.');
    row.forEach((v, i) => number(v, i < 3 ? -1e7 : 0, i < 3 ? 1e7 : 255, 'Point value'));
  }
  return cloud.points;
}
/** Exact wire format shared with robotics/world_worker/measurement_check.py. */
export async function pointsSHA256(cloud) {
  const points = cloudPoints(cloud), prefix = new TextEncoder().encode('brainsnn.dimension-points.v1\0right-handed-y-up\0m\0');
  const bytes = new Uint8Array(prefix.length + points.length * 48), data = new DataView(bytes.buffer);
  bytes.set(prefix); let at = prefix.length;
  for (const row of points) for (const value of row) { data.setFloat64(at, value, true); at += 8; }
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
/** Maps a viewer's original point indices to the default Arena handoff order. Dropped points have no entry.
 * The saved transform and colours must agree; an unrelated or rescaled cloud cannot borrow viewer picks. */
export function retainedSourceIndices(visualPoints, cloud) {
  cloudPoints(cloud);
  const box = frameBounds(visualPoints), kept = [];
  for (let i = 0; i < visualPoints.length / STRIDE; i++) {
    const at = i * STRIDE;
    if ([0, 1, 2].every(j => visualPoints[at + j] >= box.min[j] && visualPoints[at + j] <= box.max[j])) kept.push(i);
  }
  const step = Math.max(1, Math.ceil(kept.length / ARENA_MAX_POINTS)), selected = kept.filter((_, i) => i % step === 0), M = cloud.fromSource;
  if (!Array.isArray(M) || M.length !== 3 || M.some(r => !Array.isArray(r) || r.length !== 4 || r.some(x => !Number.isFinite(x)))) fail('The metric cloud has no valid source transform.');
  if (selected.length !== cloud.points.length || cloud.provenance?.totalPoints !== visualPoints.length / STRIDE || cloud.provenance?.keptPoints !== selected.length || cloud.provenance?.outliersDropped !== (box.trimmed ? visualPoints.length / STRIDE - kept.length : 0) || cloud.provenance?.thinned !== (step > 1)) fail('This cloud no longer matches the visible reconstruction. Pick references again.');
  const result = new Map();
  for (let n = 0; n < selected.length; n++) {
    const source = selected[n], at = source * STRIDE, row = cloud.points[n];
    for (let j = 0; j < 3; j++) {
      const expected = M[j][0] * visualPoints[at] + M[j][1] * visualPoints[at + 1] + M[j][2] * visualPoints[at + 2] + M[j][3];
      if (Math.abs(row[j] - expected) > 1e-5 || row[j + 3] !== Math.round(visualPoints[at + 6 + j] * 255)) fail('Metric point coordinates changed. Pick references again.');
    }
    result.set(source, n);
  }
  return result;
}
function toleranceValue(value) {
  exact(value, ['absoluteMeters', 'relative'], 'requested tolerance');
  number(value.absoluteMeters, 0, 10, 'Absolute tolerance'); number(value.relative, 0, 1, 'Relative tolerance');
  return clone(value);
}
function checkedReadings(readings, points) {
  if (!Array.isArray(readings) || readings.length < 1 || readings.length > MAX_CHECKS) fail('Add 1 to 64 physical reference readings.');
  const ids = new Set(), pairs = new Set();
  for (const reading of readings) {
    exact(reading, ['id', 'label', 'role', 'pointIndices', 'distanceMeters', 'uncertaintyMeters', 'method', 'instrument', 'measuredOn', 'note'], 'reference reading');
    if (typeof reading.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(reading.id) || ids.has(reading.id)) fail('Each reading needs a unique bounded ID.');
    ids.add(reading.id); text(reading.label, 120, 'reference label');
    if (!['calibration', 'held-out'].includes(reading.role)) fail('Choose calibration or held-out.');
    const indices = reading.pointIndices;
    if (!Array.isArray(indices) || indices.length !== 2 || indices.some(i => !Number.isInteger(i) || i < 0 || i >= points.length) || indices[0] === indices[1]) fail('Choose two different points from the current cloud.');
    const pair = [...indices].sort((a, b) => a - b).join(',');
    if (pairs.has(pair)) fail('The same point pair cannot be used twice, including for calibration and a held-out check.');
    pairs.add(pair);
    if (Math.hypot(...points[indices[0]].slice(0, 3).map((v, j) => v - points[indices[1]][j])) <= 1e-6) fail('Reference endpoints must have distinct 3D positions.');
    number(reading.distanceMeters, .001, 200, 'Physical reference distance'); number(reading.uncertaintyMeters, 0, 10, 'Reading uncertainty');
    if (!['tape', 'laser', 'manual-reference'].includes(reading.method)) fail('Use a tape, laser or dimensioned reference; model estimates are not measurements.');
    text(reading.instrument, 120, 'instrument'); text(reading.note, 600, 'reference note', true);
    if (typeof reading.measuredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reading.measuredOn) || !Number.isFinite(Date.parse(reading.measuredOn + 'T00:00:00Z')) || new Date(reading.measuredOn + 'T00:00:00Z').toISOString().slice(0, 10) !== reading.measuredOn) fail('Enter a valid measurement date.');
  }
  return clone(readings);
}
export async function measurementContract(cloud, readings, tolerance={absoluteMeters:.05, relative:.02}) {
  const points = cloudPoints(cloud), checks = checkedReadings(readings, points);
  const result = {schema:DIMENSION_SCHEMA, cloudPointsSha256:await pointsSHA256(cloud), coordinateFrame:'right-handed-y-up', units:'m', tolerance:toleranceValue(tolerance), checks};
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BYTES) fail('Reference evidence exceeds 64 KiB.');
  return result;
}
export function reportStatusText(report) {
  const labels = {'no-held-out':'No independent check yet', 'within-requested-tolerance':'Held-out spans meet your tolerance', 'outside-requested-tolerance':'A held-out span needs attention'};
  return labels[report?.status] || 'Dimensional evidence unavailable';
}
/** Validate before displaying worker evidence. A passing result never promotes a physical accuracy flag. */
export async function validateMeasurementReport(report, cloud=null, sceneArtifactSha256=null) {
  if (!report || report.schema !== DIMENSION_REPORT_SCHEMA || report.units !== 'm' || report.coordinateFrame !== 'right-handed-y-up' || report.metric_verified !== false || report.certified !== false || !['no-held-out','within-requested-tolerance','outside-requested-tolerance'].includes(report.status) || report.statusScope !== 'held-out-point-pairs-only') fail('This is not an unverified dimensional report.');
  if (!report.source || !SHA.test(report.source.cloudPointsSha256) || !SHA.test(report.source.sceneCanonicalSha256)) fail('Dimensional report source hashes are missing.');
  if (cloud && await pointsSHA256(cloud) !== report.source.cloudPointsSha256) fail('This dimensional report belongs to another point cloud.');
  if (sceneArtifactSha256 !== null) {
    if (typeof sceneArtifactSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sceneArtifactSha256) || typeof report.sourceFiles?.scene?.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(report.sourceFiles.scene.sha256) || report.sourceFiles.scene.sha256.toLowerCase() !== sceneArtifactSha256.toLowerCase()) fail('This dimensional report belongs to another scene artifact.');
  }
  if (!Array.isArray(report.checks) || report.checks.length > MAX_CHECKS || !Array.isArray(report.dimensions) || report.dimensions.length > 1024) fail('Dimensional report exceeds supported limits.');
  if (report.checks.length && !report.tolerance) fail('Dimensional report has no tolerance policy.');
  const policy = report.tolerance === null ? null : toleranceValue(report.tolerance);
  let passing = 0, heldOut = 0, calibration = 0;
  const ids = new Set();
  for (const row of report.checks) {
    text(row.id, 64, 'check ID'); text(row.label, 120, 'check label');
    if (ids.has(row.id)) fail('Dimensional report has duplicate readings.'); ids.add(row.id);
    if (!['calibration','held-out'].includes(row.role) || typeof row.withinRequestedTolerance !== 'boolean') fail('Invalid dimensional check result.');
    number(row.distanceMeters, .001, 200, 'Reference distance'); number(row.cloudDistanceMeters, 0, 4e7, 'Cloud distance');
    for (const key of ['absoluteErrorMeters', 'relativeError', 'requestedToleranceMeters', 'uncertaintyMeters']) number(row[key], 0, 4e10, key);
    number(row.signedErrorMeters, -4e7, 4e7, 'Signed error');
    if (Math.abs(row.signedErrorMeters - (row.cloudDistanceMeters - row.distanceMeters)) > 1e-8 || Math.abs(row.absoluteErrorMeters - Math.abs(row.cloudDistanceMeters - row.distanceMeters)) > 1e-8 || Math.abs(row.relativeError - row.absoluteErrorMeters / row.distanceMeters) > 1e-8 || Math.abs(row.requestedToleranceMeters - Math.max(policy.absoluteMeters, policy.relative * row.distanceMeters)) > 1e-8) fail('Dimensional check arithmetic is inconsistent.');
    const within = row.absoluteErrorMeters <= row.requestedToleranceMeters || Math.abs(row.absoluteErrorMeters-row.requestedToleranceMeters) <= Math.max(1e-12,1e-12*Math.max(row.absoluteErrorMeters,row.requestedToleranceMeters));
    if (within !== row.withinRequestedTolerance) fail('Dimensional check result disagrees with its tolerance.');
    if (cloud) {
      if (!Array.isArray(row.pointIndices) || row.pointIndices.length !== 2 || row.pointIndices.some(i => !Number.isInteger(i) || i < 0 || i >= cloud.points.length)) fail('Dimensional report point references are missing.');
      const actual = Math.hypot(...cloud.points[row.pointIndices[0]].slice(0,3).map((v,j)=>v-cloud.points[row.pointIndices[1]][j]));
      if (Math.abs(actual-row.cloudDistanceMeters)>1e-8) fail('Dimensional report distances do not match the cloud.');
    }
    if (row.role === 'held-out') { heldOut++; if (within) passing++; } else calibration++;
  }
  const expected = !heldOut ? 'no-held-out' : passing === heldOut ? 'within-requested-tolerance' : 'outside-requested-tolerance';
  if (report.status !== expected || report.summary?.heldOutCount !== heldOut || report.summary?.heldOutWithinTolerance !== passing || report.summary?.calibrationCount !== calibration) fail('Dimensional report summary is inconsistent.');
  for (const item of report.dimensions) {
    text(item.name,160,'element name'); if (item.label !== undefined && item.label !== null) text(item.label,160,'element label',true);
    if (item.independentlyChecked !== false || item.basis !== 'compiled-geometry' || !item.dimensionsMeters) fail('Element dimensions must remain independently unchecked.');
    for (const key of ['length','height','width']) number(item.dimensionsMeters[key],.000001,1e7,'Element dimension');
  }
  if (new TextEncoder().encode(JSON.stringify(report)).length > 4*1024*1024) fail('Dimensional report is too large.');
  return clone(report);
}
export function measurementRows(report) {
  return (report?.checks || []).map(row => ({id:row.id,label:row.label,role:row.role,
    reference:`${row.distanceMeters.toFixed(3)} m`,reconstructed:`${row.cloudDistanceMeters.toFixed(3)} m`,
    error:`${(row.absoluteErrorMeters*100).toFixed(1)} cm`,within:row.withinRequestedTolerance}));
}
