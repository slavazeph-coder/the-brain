import { STRIDE } from './visual-geometry.mjs';

export const MAX_STEREO_WIDTH = 960;
export const MAX_STEREO_HEIGHT = 720;
export const MAX_STEREO_DISPARITY = 192;
const MAX_POINTS = 20_000;
const MAX_DEPTH_METERS = 1000;
const MAX_COMPARISONS = 64_000_000;
const RADIUS = 3;
const PATCH_SIZE = 2 * RADIUS + 1;
const PATCH_PIXELS = PATCH_SIZE ** 2;
const MIN_PATCH_VARIANCE = PATCH_PIXELS * 7 ** 2;
const MIN_CORRELATION = 0.88;
const MIN_UNIQUENESS = 0.065;
const MIN_CURVATURE = 0.025;
const CONSISTENCY_PIXELS = 0.85;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const inRange = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;

export function maxStereoDisparity(width) {
  return Math.min(MAX_STEREO_DISPARITY, width - PATCH_SIZE - 2);
}

function calibrationFor(width, height, source) {
  const {fx, fy, cxLeft, cxRight, cy, baselineMeters} = source ?? {};
  if (!inRange(fx, 1, 100_000) || !inRange(fy, 1, 100_000) || !inRange(cxLeft, -width, 2 * width) ||
      !inRange(cxRight, -width, 2 * width) || !inRange(cy, -height, 2 * height) || !inRange(baselineMeters, 1e-4, 100)) {
    throw Error('Enter calibrated focal lengths, principal points and a positive camera baseline.');
  }
  return Object.freeze({fx, fy, cxLeft, cxRight, cy, baselineMeters});
}

function validateInput(left, right, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 24 ||
      width > MAX_STEREO_WIDTH || height > MAX_STEREO_HEIGHT) {
    throw Error(`Open equal rectified image rasters between 32 × 24 and ${MAX_STEREO_WIDTH} × ${MAX_STEREO_HEIGHT} pixels.`);
  }
  const isRgba = input => (input instanceof Uint8Array || input instanceof Uint8ClampedArray) && input.length === width * height * 4;
  if (!isRgba(left) || !isRgba(right)) throw Error('The left and right views must use the same raster dimensions and RGBA pixels.');
}

function searchFor(width, height, calibration, options) {
  const maxSupported = maxStereoDisparity(width);
  const {minDisparity = 1, maxDisparity = maxSupported, sampleStep = 6} = options ?? {};
  if (!inRange(minDisparity, 0.25, maxSupported) || !inRange(maxDisparity, minDisparity + 3, maxSupported) ||
      !Number.isInteger(sampleStep) || sampleStep < 2 || sampleStep > 32) {
    throw Error(`Use positive disparity bounds with at least 3 pixels between them and a maximum of ${maxSupported}.`);
  }
  const correction = calibration.cxLeft - calibration.cxRight;
  const minRaw = Math.ceil(minDisparity + correction);
  const maxRaw = Math.floor(maxDisparity + correction);
  if (maxRaw < PATCH_SIZE - width || minRaw > width - PATCH_SIZE || maxRaw - minRaw < 2) {
    throw Error('The calibration and disparity range do not overlap the two views.');
  }

  const candidates = maxRaw - minRaw + 1;
  const countSamples = step => Math.ceil((width - 2 * RADIUS) / step) * Math.ceil((height - 2 * RADIUS) / step);
  let step = sampleStep;
  while (countSamples(step) > Math.min(MAX_POINTS, MAX_COMPARISONS / (PATCH_PIXELS * candidates * 2))) step++;
  return {minRaw, maxRaw, minDisparity, maxDisparity, correction, step};
}

/** Summed areas reject featureless or transparent patches before matching. */
function prepare(image, width, height) {
  const pixels = new Float32Array(width * height);
  const pitch = width + 1;
  const size = pitch * (height + 1);
  const sums = new Float64Array(size), squares = new Float64Array(size), valid = new Uint32Array(size);
  for (let y = 0; y < height; y++) {
    let rowSum = 0, rowSquares = 0, rowValid = 0;
    for (let x = 0; x < width; x++) {
      const at = (x + y * width) * 4;
      const intensity = Math.fround(image[at] * 0.2126 + image[at + 1] * 0.7152 + image[at + 2] * 0.0722);
      pixels[at / 4] = intensity;
      rowSum += intensity;
      rowSquares += intensity ** 2;
      rowValid += Number(image[at + 3] === 255);
      const integralAt = (y + 1) * pitch + (x + 1);
      sums[integralAt] = sums[integralAt - pitch] + rowSum;
      squares[integralAt] = squares[integralAt - pitch] + rowSquares;
      valid[integralAt] = valid[integralAt - pitch] + rowValid;
    }
  }

  function patch(x, y) {
    const lower = (y + RADIUS + 1) * pitch, upper = (y - RADIUS) * pitch;
    const left = x - RADIUS, right = x + RADIUS + 1;
    const total = array => array[lower + right] - array[lower + left] - array[upper + right] + array[upper + left];
    if (total(valid) !== PATCH_PIXELS) return null;
    const sum = total(sums);
    const variance = total(squares) - sum * sum / PATCH_PIXELS;
    return variance >= MIN_PATCH_VARIANCE ? {sum, variance} : null;
  }

  return {pixels, patch};
}

function patchDot(a, b, aX, bX, y, width) {
  let sum = 0;
  const start = (y - RADIUS) * width - RADIUS;
  for (let row = start; row < start + PATCH_SIZE * width; row += width) {
    const ai = row + aX, bi = row + bX;
    for (let offset = 0; offset < PATCH_SIZE; offset++) sum += a[ai + offset] * b[bi + offset];
  }
  return sum;
}

function findMatch(reference, target, x, y, width, direction, search, scores) {
  const stats = reference.patch(x, y);
  if (!stats) return {reason: 'texture'};
  scores.fill(-Infinity);
  let best = -Infinity, bestIndex = -1;
  for (let index = 0; index < scores.length; index++) {
    const targetX = x + direction * (search.minRaw + index);
    if (targetX < RADIUS || targetX >= width - RADIUS) continue;
    const other = target.patch(targetX, y);
    if (!other) continue;
    const covariance = patchDot(reference.pixels, target.pixels, x, targetX, y, width) - stats.sum * other.sum / PATCH_PIXELS;
    const score = clamp(covariance / Math.sqrt(stats.variance * other.variance), -1, 1);
    scores[index] = score;
    if (score > best) { best = score; bestIndex = index; }
  }
  if (best < MIN_CORRELATION) return {reason: 'weak'};

  // A broad peak may have highly similar immediate neighbors, so compare its
  // distinct alternatives and also require a well-defined local maximum.
  for (let i = 0; i < scores.length; i++) {
    if (Math.abs(i - bestIndex) > 1 && best - scores[i] < MIN_UNIQUENESS) return {reason: 'ambiguous'};
  }
  const before = scores[bestIndex - 1], after = scores[bestIndex + 1];
  if (!Number.isFinite(before) || !Number.isFinite(after)) return {reason: 'boundary'};
  const curvature = 2 * best - before - after;
  if (curvature < MIN_CURVATURE) return {reason: 'ambiguous'};
  // An exact patch match should not move due to neighbours' asymmetrical noise.
  const offset = best > 0.999999 ? 0 : clamp((after - before) / (2 * curvature), -0.5, 0.5);
  const integerDisparity = search.minRaw + bestIndex;
  return {score: best, rawDisparity: integerDisparity + offset, targetX: x + direction * integerDisparity};
}

function sampleGeometry(x, y, left, width, search, calibration, match, points, samples) {
  const disparity = match.rawDisparity - search.correction;
  if (disparity < search.minDisparity || disparity > search.maxDisparity) return false;
  const z = calibration.fx * calibration.baselineMeters / disparity;
  if (!inRange(z, 1e-6, MAX_DEPTH_METERS)) return false;
  const spatialX = (x - calibration.cxLeft) * z / calibration.fx;
  const spatialY = (y - calibration.cy) * z / calibration.fy;
  if (Math.max(Math.abs(spatialX), Math.abs(spatialY)) > 1e7) return false;
  const size = clamp(z * search.step * 0.25 / Math.max(calibration.fx, calibration.fy), 1e-5, 10);
  const pixel = (y * width + x) * 4;

  // Rotate OpenCV x-right, y-down, z-forward into the playground's Y-up frame.
  points.push(spatialX, -spatialY, -z, size, size, size, left[pixel] / 255, left[pixel + 1] / 255,
    left[pixel + 2] / 255, 1, 0, 0, 0, 1);
  samples.push({x, y, rawDisparity: match.rawDisparity, disparity, depthMeters: z, score: match.score});
  return true;
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Stereo matching was cancelled.', 'AbortError');
}

/** Sparse rectified stereo correspondences. Coordinates are integer-centred and use one shared fx, fy and cy. */
export async function estimateStereoDepth({left, right, width, height, calibration: values, options, signal, onProgress = () => {}}) {
  checkAbort(signal);
  validateInput(left, right, width, height);
  const calibration = calibrationFor(width, height, values);
  const search = searchFor(width, height, calibration, options);
  const totalRows = Math.ceil((height - 2 * RADIUS) / search.step);
  const a = prepare(left, width, height), b = prepare(right, width, height);
  const scores = new Float64Array(search.maxRaw - search.minRaw + 1);
  const points = [], samples = [];
  const rejected = {texture: 0, weak: 0, ambiguous: 0, occlusion: 0, boundary: 0, depth: 0};
  let tested = 0, completedRows = 0, lastYield = performance.now();
  onProgress({completedRows, totalRows});
  for (let y = RADIUS; y < height - RADIUS; y += search.step) {
    for (let x = RADIUS; x < width - RADIUS; x += search.step) {
      if (performance.now() - lastYield > 9) {
        await new Promise(resolve => setTimeout(resolve, 0));
        checkAbort(signal);
        lastYield = performance.now();
      }
      tested++;
      const match = findMatch(a, b, x, y, width, -1, search, scores);
      if (match.reason) { rejected[match.reason]++; continue; }
      const reverse = findMatch(b, a, match.targetX, y, width, 1, search, scores);
      if (reverse.reason || reverse.targetX !== x || Math.abs(match.rawDisparity - reverse.rawDisparity) > CONSISTENCY_PIXELS) {
        rejected.occlusion++;
        continue;
      }
      if (!sampleGeometry(x, y, left, width, search, calibration, match, points, samples)) rejected.depth++;
    }
    completedRows++;
    onProgress({completedRows, totalRows});
    checkAbort(signal);
  }
  return {width, height, calibration, sampleStep: search.step, points: new Float32Array(points), samples,
    stats: {tested, accepted: samples.length, rejected}};
}

export function exportStereoPly(result) {
  const points = result?.points;
  if (!(points instanceof Float32Array) || !points.length || points.length % STRIDE || points.length / STRIDE > MAX_POINTS) {
    throw Error('Match a stereo pair with points before exporting.');
  }
  const rows = ['ply', 'format ascii 1.0', 'comment Rectified stereo correspondence estimates in metres',
    'comment Raw left camera origin, Y up, Z backward; scale depends on the supplied calibration',
    `element vertex ${points.length / STRIDE}`, 'property float x', 'property float y', 'property float z',
    'property uchar red', 'property uchar green', 'property uchar blue', 'end_header'];
  for (let at = 0; at < points.length; at += STRIDE) {
    const xyz = points.subarray(at, at + 3), rgb = points.subarray(at + 6, at + 9);
    if (!xyz.every(Number.isFinite) || !rgb.every(value => inRange(value, 0, 1))) throw Error('The stereo point data is invalid.');
    rows.push(`${Array.from(xyz, value => value.toPrecision(8)).join(' ')} ${Array.from(rgb, value => Math.round(value * 255)).join(' ')}`);
  }
  return rows.join('\n') + '\n';
}
