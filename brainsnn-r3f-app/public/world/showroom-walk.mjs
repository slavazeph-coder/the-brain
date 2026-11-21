// The showroom stores points as floor X, floor Z, height. Camera axes use room X, height, Z.
const NEAR_METERS = 0.02;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const lerp = (a, b, t) => a + (b - a) * t;
const isVector = (a, length) => Array.isArray(a) && a.length === length && Array.from(a).every(Number.isFinite);
const validSize = n => Number.isInteger(n) && n > 0 && n <= 8192;

/** Optional pixel calibration at the dimensions of the bundled picture. Preserve the room's handedness. */
export function validateWalkPose(raw, width, height) {
  if (!validSize(width) || !validSize(height) || !isVector(raw?.eye, 3) ||
      raw.eye.some(n => Math.abs(n) > 1e6)) throw new Error('Invalid showroom camera position or image size.');
  const {right, down, forward, intrinsics} = raw;
  const axes = [right, down, forward];
  if (!axes.every(axis => isVector(axis, 3) && Math.abs(dot(axis, axis) - 1) < 0.002) ||
      Math.max(Math.abs(dot(right, down)), Math.abs(dot(right, forward)), Math.abs(dot(down, forward))) > 0.001) {
    throw new Error('Showroom camera directions must form perpendicular unit axes.');
  }
  if (!isVector(intrinsics, 4)) throw new Error('Invalid showroom camera intrinsics.');
  const [fx, fy, cx, cy] = intrinsics;
  if (fx < width * 0.0001 || fx > width * 1e4 || fy < height * 0.0001 || fy > height * 1e4 ||
      Math.abs(cx) > 16 * width || Math.abs(cy) > 16 * height) throw new Error('Invalid showroom camera lens.');
  return {eye: [...raw.eye], right: [...right], down: [...down], forward: [...forward], intrinsics: [...intrinsics]};
}

/** The legacy fallback assumes a level, 1.55 m high camera and a 65° horizontal field of view. */
export function framePose(frame) {
  if (!frame || !validSize(frame.width) || !validSize(frame.height)) return null;
  const {width, height} = frame;
  if (frame.pose) return {...validateWalkPose(frame.pose, width, height), width, height, calibrated: true};
  if (!isVector(frame.camera, 2) || !Number.isFinite(frame.heading)) return null;
  const yaw = frame.heading * Math.PI / 180;
  const fx = width / (2 * Math.tan(65 * Math.PI / 360));
  return {eye: [frame.camera[0], 1.55, frame.camera[1]], right: [Math.cos(yaw), 0, -Math.sin(yaw)],
    down: [0, -1, 0], forward: [Math.sin(yaw), 0, Math.cos(yaw)], intrinsics: [fx, fx, width / 2, height / 2],
    width, height, calibrated: false};
}

export function walkFrames(room) {
  return room.frames.flatMap((frame, index) => framePose(frame) ? [index] : []);
}

function parity(pose) {
  return Math.sign(dot(cross(pose.right, pose.down), pose.forward));
}

// Represent the first two camera axes by a proper rotation. The sign of the third axis travels separately.
function orientation({right, down}) {
  const [xx, yx, zx] = right, [xy, yy, zy] = down;
  const [xz, yz, zz] = cross(right, down);
  const trace = xx + yy + zz;
  let q;
  if (trace > 0) {
    const s = 2 * Math.sqrt(1 + trace);
    q = [(zy - yz) / s, (xz - zx) / s, (yx - xy) / s, s / 4];
  } else if (xx >= yy && xx >= zz) {
    const s = 2 * Math.sqrt(1 + xx - yy - zz);
    q = [s / 4, (xy + yx) / s, (xz + zx) / s, (zy - yz) / s];
  } else if (yy >= zz) {
    const s = 2 * Math.sqrt(1 + yy - xx - zz);
    q = [(xy + yx) / s, s / 4, (yz + zy) / s, (xz - zx) / s];
  } else {
    const s = 2 * Math.sqrt(1 + zz - xx - yy);
    q = [(xz + zx) / s, (yz + zy) / s, s / 4, (yx - xy) / s];
  }
  const norm = Math.hypot(...q);
  return q.map(v => v / norm);
}

function blendOrientation(a, b, t) {
  const start = orientation(a), end = orientation(b);
  let cosine = start.reduce((sum, v, i) => sum + v * end[i], 0);
  if (cosine < 0) {
    for (let i = 0; i < 4; i++) end[i] *= -1;
    cosine *= -1;
  }
  let first = 1 - t, last = t;
  if (cosine < 0.9995) {
    const angle = Math.acos(clamp(cosine, 0, 1));
    first = Math.sin((1 - t) * angle) / Math.sin(angle);
    last = Math.sin(t * angle) / Math.sin(angle);
  }
  const q = start.map((v, i) => first * v + last * end[i]);
  const length = Math.hypot(...q);
  const [x, y, z, w] = q.map(v => v / length);
  const right = [1 - 2 * (y*y + z*z), 2 * (x*y + w*z), 2 * (x*z - w*y)];
  const down = [2 * (x*y - w*z), 1 - 2 * (x*x + z*z), 2 * (y*z + w*x)];
  const sign = parity(a);
  return {right, down, forward: cross(right, down).map(v => sign * v)};
}

/** Straight-line camera move and shortest rotation between two chosen frames. No intermediate photo is consulted. */
export function walkPose(room, startIndex, endIndex, fraction) {
  if (!Number.isFinite(fraction)) return null;
  const start = framePose(room.frames[startIndex]), end = framePose(room.frames[endIndex]);
  if (!start || !end || parity(start) !== parity(end)) return null;
  const t = clamp(fraction, 0, 1);
  if (t === 0) return start;
  if (t === 1) return end;
  const width = Math.round(lerp(start.width, end.width, t)), height = Math.round(lerp(start.height, end.height, t));
  const intrinsics = start.intrinsics.map((v, i) => {
    const dim = i % 2 ? 'height' : 'width';
    return lerp(v / start[dim], end.intrinsics[i] / end[dim], t) * (dim === 'width' ? width : height);
  });
  return {...blendOrientation(start, end, t), eye: start.eye.map((v, i) => lerp(v, end.eye[i], t)),
    intrinsics, width, height, calibrated: start.calibrated && end.calibrated};
}

/** Return a normalized image position and camera-forward depth, excluding points outside the picture or near plane. */
export function projectWalkPoint(pose, point) {
  const dx = point[0] - pose.eye[0], dy = point[2] - pose.eye[1], dz = point[1] - pose.eye[2];
  const {right, down, forward, intrinsics: [fx, fy, cx, cy]} = pose;
  const depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
  if (!(depth > NEAR_METERS)) return null;
  const x = ((dx * right[0] + dy * right[1] + dz * right[2]) * fx / depth + cx) / pose.width;
  const y = ((dx * down[0] + dy * down[1] + dz * down[2]) * fy / depth + cy) / pose.height;
  return x >= 0 && x < 1 && y >= 0 && y < 1 ? {x, y, depth} : null;
}

function distinctPhoto(room, index, excluded) {
  if (index === excluded) return false;
  const image = room.frames[excluded]?.image;
  return !image || room.frames[index].image !== image;
}

/** The nearest-picture baseline minimizes the distance between camera centers. Direction breaks ties. */
export function nearestWalkFrame(room, query, excludeIndex = -1) {
  if (!query) return null;
  let best = null;
  for (const [index, frame] of room.frames.entries()) {
    if (!distinctPhoto(room, index, excludeIndex)) continue;
    const pose = framePose(frame);
    if (!pose) continue;
    const distanceMeters = Math.hypot(...pose.eye.map((v, i) => v - query.eye[i]));
    const angleDegrees = Math.acos(clamp(dot(pose.forward, query.forward), -1, 1)) * 180 / Math.PI;
    if (!best || distanceMeters < best.distanceMeters || distanceMeters === best.distanceMeters && angleDegrees < best.angleDegrees) {
      best = {index, distanceMeters, angleDegrees};
    }
  }
  return best;
}

export function walkComparison(room, targetIndex) {
  const target = room.frames[targetIndex];
  const pose = framePose(target);
  if (!pose) return null;
  const candidates = walkFrames(room).filter(i => distinctPhoto(room, i, targetIndex));
  let beforeIndex = candidates.findLast(i => i < targetIndex);
  let afterIndex = candidates.find(i => i > targetIndex && distinctPhoto(room, i, beforeIndex));
  // A repeated photo can bracket the target. Use an earlier distinct source if all later ones are repeats.
  if (beforeIndex != null && afterIndex == null) {
    afterIndex = candidates.find(i => i > targetIndex);
    beforeIndex = candidates.findLast(i => i < targetIndex && distinctPhoto(room, i, afterIndex));
  }
  if (beforeIndex == null || afterIndex == null) return null;
  const first = room.frames[beforeIndex], last = room.frames[afterIndex];
  let t = (targetIndex - beforeIndex) / (afterIndex - beforeIndex);
  if ([first, target, last].every(f => Number.isFinite(f.timeSeconds)) && last.timeSeconds > first.timeSeconds) {
    t = (target.timeSeconds - first.timeSeconds) / (last.timeSeconds - first.timeSeconds);
  }
  const interpolated = walkPose(room, beforeIndex, afterIndex, t);
  if (!interpolated) return null;
  const nearest = nearestWalkFrame(room, pose, targetIndex);
  return {targetIndex, beforeIndex, afterIndex, nearestIndex: nearest.index, distanceMeters: nearest.distanceMeters,
    angleDegrees: nearest.angleDegrees, t, calibrated: pose.calibrated && interpolated.calibrated};
}

// False color denotes object identity. Unclassified points remain a single neutral tone.
const COLORS = [[120, 232, 201], [237, 176, 100], [139, 182, 249], [223, 159, 206], [189, 210, 145]];
const OTHER = [139, 158, 169];
const COLUMNS = 24, ROWS = 14;
// Reuse the palette at all distances rather than formatting up to 40,000 CSS colors per frame.
function tones(rgb) {
  return Array.from({length: 16}, (_, i) =>
    'rgb(' + rgb.map(channel => Math.round(channel * (0.62 + 0.38 * i / 15))).join(',') + ')');
}
const OBJECT_TONES = COLORS.map(tones), OTHER_TONES = tones(OTHER);

/** Project the retained points using depth-tested dots; untouched pixels are unknown background. */
export function drawWalkFrame(canvas, room, pose) {
  const {width, height} = canvas;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width * height > 2_097_152) throw new RangeError('Choose a preview of at most two megapixels.');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('A 2D preview canvas is unavailable.');
  ctx.fillStyle = '#102028';
  ctx.fillRect(0, 0, width, height);
  if (!pose) return {visiblePoints: 0, coverage: 0};
  const colors = new Map(room.objects.map((obj, i) => [obj.id, OBJECT_TONES[i % OBJECT_TONES.length]]));
  const cells = new Set(), projected = [];
  for (const p of room.points) {
    const pixel = projectWalkPoint(pose, p);
    if (!pixel) continue;
    cells.add(Math.floor(pixel.y * ROWS) * COLUMNS + Math.floor(pixel.x * COLUMNS));
    projected.push({x: Math.floor(pixel.x * width), y: Math.floor(pixel.y * height),
      depth: pixel.depth, tones: colors.get(p[3]) || OTHER_TONES});
  }
  // Paint far to near. Each dot represents a sample, without connecting across gaps in the scan.
  projected.sort((a, b) => b.depth - a.depth);
  const focal = pose.intrinsics[0] / pose.width * width;
  for (const p of projected) {
    const radius = clamp(Math.round(0.022 * focal / p.depth), 1, 4);
    ctx.fillStyle = p.tones[Math.round(15 / (1 + 0.09 * p.depth))];
    ctx.fillRect(p.x - radius, p.y - radius, 2 * radius + 1, 2 * radius + 1);
  }
  return {visiblePoints: projected.length, coverage: cells.size / (COLUMNS * ROWS)};
}
