/** Bounded appearance geometry. No function here verifies metric scale or collision geometry. */
export const MAX_POINTS = 100000;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const STRIDE = 14; // xyz, display scale xyz, rgba, quaternion xyzw
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const scalar = {
  float: [4, 'getFloat32'], float32: [4, 'getFloat32'], double: [8, 'getFloat64'], float64: [8, 'getFloat64'],
  char: [1, 'getInt8'], int8: [1, 'getInt8'], uchar: [1, 'getUint8'], uint8: [1, 'getUint8'],
  short: [2, 'getInt16'], int16: [2, 'getInt16'], ushort: [2, 'getUint16'], uint16: [2, 'getUint16'],
  int: [4, 'getInt32'], int32: [4, 'getInt32'], uint: [4, 'getUint32'], uint32: [4, 'getUint32'],
};
const gaussianProperties = ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
function bytesOf(buffer) {
  if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) throw Error('Choose a non-empty asset.');
  if (buffer.byteLength > MAX_FILE_BYTES) throw Error('Use an asset no larger than 64 MiB.');
  return new Uint8Array(buffer);
}
function result(points, total, step, kind, skipped = 0) {
  if (!points.length) throw Error('The asset contains no usable finite points.');
  return { points: new Float32Array(points), total, sampled: step > 1, kind, skipped, units: 'unverified', metricVerified: false, collisionGeometry: null };
}
export function bounds(points) {
  if (!(points instanceof Float32Array) || !points.length || points.length % STRIDE || points.length / STRIDE > MAX_POINTS) throw Error('Invalid or oversized visual point buffer.');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += STRIDE) {
    for (let j = 0; j < STRIDE; j++) if (!Number.isFinite(points[i + j])) throw Error('Visual points must be finite.');
    for (let j = 0; j < 3; j++) {
      if (Math.abs(points[i+j]) > 1e7 || points[i+j+3] <= 0 || points[i+j+3] > 1e5) throw Error('Visual positions or display sizes exceed supported bounds.');
      min[j] = Math.min(min[j], points[i+j]); max[j] = Math.max(max[j], points[i+j]);
    }
    if ([6,7,8,9].some(j => points[i+j] < 0 || points[i+j] > 1) || Math.hypot(...points.subarray(i+10,i+14)) < 1e-8) throw Error('Visual colours or rotation parameters are invalid.');
  }
  return { min, max, center: min.map((v, i) => (v + max[i]) / 2), radius: Math.max(.001, Math.hypot(...max.map((v, i) => v - min[i])) / 2) };
}
/** Framing bounds for the camera and display footprint only: per-axis 2nd–98th percentile core.
 * Sparse multi-view reconstructions carry far outliers (points triangulated at near-infinite depth);
 * framing the full extent shrinks the subject to a speck. No point is removed or modified. */
export function frameBounds(points) {
  const full = bounds(points), count = points.length / STRIDE;
  if (count < 50) return full;
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const axis = new Float32Array(count);
    for (let i = 0; i < count; i++) axis[i] = points[i * STRIDE + j];
    axis.sort();
    lo[j] = axis[Math.floor(count * .02)]; hi[j] = axis[Math.min(count - 1, Math.ceil(count * .98))];
  }
  const center = lo.map((v, i) => (v + hi[i]) / 2), radius = Math.max(.001, Math.hypot(...hi.map((v, i) => v - lo[i])) / 2);
  // A core that is barely smaller than the full extent means no outliers: keep the exact extent.
  return radius < full.radius * .9 ? { min: lo, max: hi, center, radius, trimmed: true } : full;
}
export function parsePLY(buffer) {
  const bytes = bytesOf(buffer);
  // PLY headers are ASCII: byte offsets must not depend on UTF-8 decoding/re-encoding.
  const headerText = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  if (!/^ply\r?\n/.test(headerText)) throw Error('Not a PLY file.');
  const end = /^end_header\r?$/m.exec(headerText);
  if (!end || bytes[end.index + end[0].length] !== 10) throw Error('Missing or oversized PLY header.');
  const start = end.index + end[0].length + 1, header = headerText.slice(0, end.index);
  if (bytes.subarray(0, start).some(b => b > 127)) throw Error('PLY headers must be ASCII.');
  let format = '', active = false, total = 0, stride = 0, seenVertex = false, seenData = false;
  const props = [], names = new Set();
  for (const line of header.split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'format') {
      if (format || w[2] !== '1.0' || !['ascii', 'binary_little_endian', 'binary_big_endian'].includes(w[1])) throw Error('Unsupported PLY format.');
      format = w[1];
    }
    if (w[0] === 'element') {
      const count = Number(w[2]);
      if (!/^\d+$/.test(w[2] || '') || !Number.isSafeInteger(count) || count > 10000000) throw Error('Invalid PLY element count.');
      active = w[1] === 'vertex';
      if (active) {
        if (seenVertex || seenData) throw Error('PLY vertex data must be the first non-empty element.');
        total = count; seenVertex = true;
      } else if (count) seenData = true;
    }
    if (active && w[0] === 'property') {
      if (w.length !== 3 || !Object.hasOwn(scalar, w[1])) throw Error('Only scalar PLY vertex properties are supported.');
      if (names.has(w[2]) || props.length >= 128) throw Error('Duplicate or excessive PLY vertex properties.');
      names.add(w[2]); const spec = scalar[w[1]];
      props.push({ name: w[2], offset: stride, spec, floating: /^(float|double)/.test(w[1]) }); stride += spec[0];
    }
  }
  if (!format || !total || !stride || !['x', 'y', 'z'].every(n => names.has(n))) throw Error('PLY needs a non-empty vertex element with x, y and z.');
  const isGaussian = gaussianProperties.every(n => names.has(n));
  if (!isGaussian && ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'opacity'].some(n => names.has(n))) throw Error('Incomplete Gaussian PLY properties. Export complete Gaussian parameters or a plain xyz/rgb point cloud.');
  const ascii = format === 'ascii';
  if (ascii && bytes.length > 16 * 1024 * 1024) throw Error('Convert ASCII PLY larger than 16 MiB to binary PLY.');
  if (!ascii && start + total * stride > bytes.length) throw Error('Truncated PLY vertex data.');
  const source = ascii ? new TextDecoder().decode(bytes.subarray(start)) : '', view = new DataView(buffer);
  const step = Math.max(1, Math.ceil(total / MAX_POINTS)), points = [], colorProps = ['red', 'green', 'blue'].map(n => props.find(p => p.name === n));
  let cursor = 0, skipped = 0;
  for (let i = 0; i < total; i++) {
    let values;
    if (ascii) {
      if (cursor >= source.length) throw Error('Truncated PLY vertex data.');
      const next = source.indexOf('\n', cursor), finish = next === -1 ? source.length : next;
      // Check all row widths, even rows omitted by the display sampling limit.
      const row = source.slice(cursor, finish).trim(); cursor = finish + 1;
      values = row.split(/\s+/);
      if (!row || values.length !== props.length) throw Error('Malformed PLY vertex row.');
    }
    if (i % step) continue;
    const row = Object.create(null);
    for (let j = 0; j < props.length; j++) {
      const p = props[j]; row[p.name] = ascii ? Number(values[j]) : view[p.spec[1]](start + i * stride + p.offset, format === 'binary_little_endian');
    }
    const used = isGaussian ? ['x', 'y', 'z', ...gaussianProperties] : ['x', 'y', 'z', ...colorProps.filter(Boolean).map(p => p.name)];
    if (!used.every(n => Number.isFinite(row[n])) || [row.x, row.y, row.z].some(v => Math.abs(v) > 1e7)) { skipped++; continue; }
    const scales = isGaussian ? [0, 1, 2].map(j => Math.exp(clamp(row[`scale_${j}`], -12, 8))) : [.01, .01, .01];
    const rgb = isGaussian ? [0, 1, 2].map(j => clamp(.5 + .28209479177387814 * row[`f_dc_${j}`], 0, 1)) : colorProps.map(p => p ? clamp(row[p.name] / (p.floating ? 1 : 255), 0, 1) : .65);
    const opacity = isGaussian ? 1 / (1 + Math.exp(-clamp(row.opacity, -20, 20))) : 1;
    const q = isGaussian ? [row.rot_1, row.rot_2, row.rot_3, row.rot_0] : [0, 0, 0, 1], norm = Math.hypot(...q);
    points.push(row.x, row.y, row.z, ...scales, ...rgb, opacity, ...(norm > 1e-8 ? q.map(v => v / norm) : [0, 0, 0, 1]));
  }
  const parsed = result(points, total, step, isGaussian ? 'gaussian-splat' : 'point-cloud', skipped);
  if (!isGaussian) {
    // This is a display footprint, never a Gaussian fitted to source imagery.
    // Sparse reconstructions (trimmed framing) get a smaller footprint so gaps read as gaps, not bubbles.
    const frame = frameBounds(parsed.points);
    const size = clamp(frame.radius / Math.sqrt(parsed.points.length / STRIDE) * (frame.trimmed ? .55 : .8), .00001, 1e4);
    for (let i = 0; i < parsed.points.length; i += STRIDE) parsed.points.fill(size, i + 3, i + 6);
  }
  return parsed;
}
export function parseSplat(buffer) {
  const bytes = bytesOf(buffer);
  if (bytes.length % 32) throw Error('Invalid .splat: expected complete 32-byte records.');
  const total = bytes.length / 32, step = Math.max(1, Math.ceil(total / MAX_POINTS)), view = new DataView(buffer), points = [];
  let skipped = 0;
  for (let i = 0; i < total; i += step) {
    const b = i * 32, values = Array.from({length: 6}, (_, j) => view.getFloat32(b + j * 4, true));
    if (!values.every(Number.isFinite) || values.slice(0, 3).some(v => Math.abs(v) > 1e7) || values.slice(3).some(v => v <= 0 || v > 1e5)) { skipped++; continue; }
    const q = [1, 2, 3, 0].map(j => (view.getUint8(b + 28 + j) - 128) / 128), norm = Math.hypot(...q);
    points.push(...values, ...[0, 1, 2, 3].map(j => view.getUint8(b + 24 + j) / 255), ...(norm > 1e-8 ? q.map(v => v / norm) : [0, 0, 0, 1]));
  }
  return result(points, total, step, 'gaussian-splat', skipped);
}
export function parseVisualAsset(buffer, name) {
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'ply') return parsePLY(buffer);
  if (ext === 'splat') return parseSplat(buffer);
  throw Error('Use an uncompressed .ply point cloud, Gaussian .ply or .splat asset.');
}
/** Relative inverse depth: camera faces -Z, +Y up, no metric units or unseen surfaces. */
export function fromDepth(rgba, width, height, depth, dw, dh, fov = 60) {
  if (![width, height, dw, dh].every(n => Number.isSafeInteger(n) && n > 1 && n <= 8192) || width * height > 16777216 || dw * dh > 4194304 || rgba?.length !== width * height * 4 || depth?.length !== dw * dh || !Number.isFinite(fov)) throw Error('Depth and image dimensions do not match or exceed preview limits.');
  const finite = Array.from(depth).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length < depth.length * .8) throw Error('The depth model returned too many invalid pixels.');
  const low = finite[Math.floor(finite.length * .02)], high = finite[Math.floor(finite.length * .98)];
  if (!(high - low > 1e-6)) throw Error('This image has no usable depth variation. Try another viewpoint.');
  let step = Math.max(1, Math.ceil(Math.sqrt(width * height / MAX_POINTS)));
  while (Math.ceil(width / step) * Math.ceil(height / step) > MAX_POINTS) step++;
  const out = [], focal = width / (2 * Math.tan(clamp(fov, 25, 100) * Math.PI / 360));
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const c = (y * width + x) * 4, di = Math.min(dh - 1, Math.floor(y / height * dh)) * dw + Math.min(dw - 1, Math.floor(x / width * dw));
    if (!Number.isFinite(depth[di]) || rgba[c + 3] < 128) continue;
    const z = 1 / (.17 + .83 * clamp((depth[di] - low) / (high - low), 0, 1)), s = z / focal * step * .7;
    out.push((x - width / 2) / focal * z, -(y - height / 2) / focal * z, -z, s, s, s * .3, rgba[c] / 255, rgba[c + 1] / 255, rgba[c + 2] / 255, 1, 0, 0, 0, 1);
  }
  if (!out.length) throw Error('No visible pixels with usable depth were found.');
  return new Float32Array(out);
}
/** Arena sim reference layer: the exact format `BrainSNNSiteRenderer.setPointCloud` accepts (≤50k rows of [x,y,z,r,g,b]).
 * Arena places and frames a cloud by its full bounding box, so far-triangulated outliers would float the subject off the
 * floor; the hand-off keeps the 2nd–98th percentile core and records exactly what was dropped. COLMAP (x right, y down,
 * z forward) is turned Y-up. Visual only, never collision geometry; the World viewer and PLY export keep every point. */
export const ARENA_MAX_POINTS = 50_000;
export function toArenaCloud(points, { coordinateFrame = 'right-handed-y-up', source = 'World Builder reconstruction', metresPerUnit = null, measurement = null } = {}, budget = ARENA_MAX_POINTS) {
  const { min, max, trimmed } = frameBounds(points), flip = coordinateFrame === 'colmap' ? -1 : 1, count = points.length / STRIDE, core = [];
  // A user-measured distance (two picked points + real metres) turns arbitrary units into metres; still self-reported, never verified.
  const k = Number.isFinite(metresPerUnit) && metresPerUnit > 0 ? metresPerUnit : 1, metric = k !== 1;
  for (let i = 0; i < count; i++) {
    const at = i * STRIDE;
    if ([0, 1, 2].every(j => points[at + j] >= min[j] && points[at + j] <= max[j]))
      core.push([k * points[at], k * flip * points[at + 1], k * flip * points[at + 2], ...[6, 7, 8].map(j => Math.round(points[at + j] * 255))]);
  }
  const step = Math.max(1, Math.ceil(core.length / budget));
  // Gravity-align only on a confident floor (>=10% inliers); weaker planes are walls or noise and must not rotate the cloud.
  const plane = fitFloorPlane(core), upright = plane && plane.inlierFraction >= .1 ? alignToFloor(core, plane) : null;
  // Then square the heading: rotate about Y so the floor band's long axis runs along Z, so the footprint box fits the walkable strip.
  const yaw = upright ? floorYaw(upright, plane.tolerance) : 0, aligned = upright ? rotateY(upright, -yaw) : core;
  const rows = aligned.filter((_, i) => i % step === 0), units = metric ? 'm' : 'arbitrary', floor = estimateFloor(aligned);
  return { version: 1, kind: 'colmap-sparse-point-cloud', units, coordinateFrame: 'right-handed-y-up', sourceFrame: coordinateFrame,
    source, points: rows, floorEstimate: floor && { ...floor, units },
    scale: metric ? { source: 'user-measured', metresPerUnit: k, distance: measurement?.distance ?? null, spanUnits: measurement?.span ?? null, selfReported: true, verified: false } : null,
    provenance: { totalPoints: count, keptPoints: rows.length, outliersDropped: trimmed ? count - core.length : 0, thinned: step > 1,
      floorAligned: aligned !== core, floorTiltDegrees: plane ? +(Math.acos(Math.min(1, Math.abs(plane.normal[1]))) * 180 / Math.PI).toFixed(1) : null, floorYawDegrees: +(yaw * 180 / Math.PI).toFixed(1), floorInlierFraction: plane ? +plane.inlierFraction.toFixed(3) : null, metricVerified: false } };
}
/** Heading of the floor band's principal axis (PCA on x,z of points within `tol` of y=0), in radians from +Z. */
export function floorYaw(rows, tol) {
  const band = rows.filter(r => Math.abs(r[1]) <= tol); if (band.length < 20) return 0;
  const mx = band.reduce((s, r) => s + r[0], 0) / band.length, mz = band.reduce((s, r) => s + r[2], 0) / band.length;
  let sxx = 0, sxz = 0, szz = 0; for (const r of band) { const x = r[0] - mx, z = r[2] - mz; sxx += x * x; sxz += x * z; szz += z * z; }
  return Math.atan2(2 * sxz, szz - sxx) / 2; // angle of the major axis measured from +Z toward +X
}
/** Rotates rows about +Y by `angle` radians (x,z only). */
export const rotateY = (rows, angle) => { const c = Math.cos(angle), s = Math.sin(angle); return rows.map(r => [r[0] * c + r[2] * s, r[1], -r[0] * s + r[2] * c, r[3], r[4], r[5]]); };
/** RANSAC plane through the floor-like points of a roughly Y-up cloud. Candidate normals must be within 45° of ±Y so
 * walls never win; the plane with most inliers (1.5% of frame radius) is returned with its normal pointing toward the
 * cloud's bulk. Deterministic (LCG seed) so the same cloud always aligns the same way. */
export function fitFloorPlane(rows, iterations = 300) {
  if (rows.length < 50) return null;
  const radius = Math.hypot(...[0, 1, 2].map(j => rows.reduce((m, r) => Math.max(m, r[j]), -Infinity) - rows.reduce((m, r) => Math.min(m, r[j]), Infinity))) / 2;
  const tol = Math.max(1e-6, radius * .015), ys = rows.map(r => r[1]).sort((a, b) => a - b), lowY = ys[Math.floor(ys.length * .5)];
  const low = rows.filter(r => r[1] <= lowY); let seed = 7, best = null;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let k = 0; k < iterations; k++) {
    const [a, b, c] = [0, 0, 0].map(() => low[Math.floor(rand() * low.length)]);
    let n = cross(sub(b, a), sub(c, a)); const len = Math.hypot(...n); if (len < 1e-9) continue;
    n = n.map(v => v / len); if (Math.abs(n[1]) < Math.SQRT1_2) continue;
    const d = -(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]);
    let inliers = 0, above = 0;
    for (const r of rows) { const s = n[0] * r[0] + n[1] * r[1] + n[2] * r[2] + d; if (Math.abs(s) <= tol) inliers++; else if (s > 0) above++; }
    const up = Math.max(above, rows.length - inliers - above); // bulk on the normal's side once it is flipped toward the room
    if (!best || inliers > best.inliers || (inliers === best.inliers && up > best.up)) best = { normal: n, inliers, above, up };
  }
  if (!best) return null;
  // The floor's normal points toward the room, i.e. toward the majority of off-plane points.
  const flip = best.above < (rows.length - best.inliers) / 2 ? -1 : 1, n = best.normal.map(v => v * flip);
  // Refine: along the up-vector the floor is the lowest dense layer, not merely the densest (tables and beds carry points too).
  const heights = rows.map(r => n[0] * r[0] + n[1] * r[1] + n[2] * r[2]), lo = Math.min(...heights), width = 2 * tol;
  const counts = []; for (const h of heights) { const b = Math.floor((h - lo) / width); counts[b] = (counts[b] || 0) + 1; }
  const peak = Math.max(...counts.map(c => c || 0)), bin = counts.findIndex(c => c >= peak * .8);
  const d = -(lo + (bin + .5) * width), inliers = heights.filter(h => Math.abs(h + d) <= tol).length;
  return { normal: n, d, inlierFraction: inliers / rows.length, tolerance: tol };
}
/** Rotates rows so `plane.normal` becomes +Y and the plane passes through y=0. Returns new rows (colours untouched). */
export function alignToFloor(rows, plane) {
  const n = plane.normal, c = n[1], s = Math.hypot(n[0], n[2]);
  if (s < 1e-9) return rows.map(r => [r[0], r[1] + plane.d * Math.sign(c), r[2], r[3], r[4], r[5]]);
  const [ax, , az] = [-n[2] / s, 0, n[0] / s], t = 1 - c; // axis = n × Y, angle = acos(n·Y)
  const R = [[c + ax * ax * t, -az * s, ax * az * t], [az * s, c, -ax * s], [ax * az * t, ax * s, c + az * az * t]];
  return rows.map(r => { const y = R[1][0] * r[0] + R[1][1] * r[1] + R[1][2] * r[2];
    return [R[0][0] * r[0] + R[0][1] * r[1] + R[0][2] * r[2], y + plane.d, R[2][0] * r[0] + R[2][1] * r[1] + R[2][2] * r[2], r[3], r[4], r[5]]; });
}
/** Dominant low horizontal band of a Y-up cloud: a floor suggestion in cloud units, never a measurement.
 * `support` is the fraction of points in the band; below ~5% there is no usable floor (e.g. a facade-only scan). */
export function estimateFloor(rows, bins = 40) {
  if (rows.length < 50) return null;
  const ys = rows.map(r => r[1]).sort((a, b) => a - b), lo = ys[0], hi = ys[ys.length - 1], span = (hi - lo) || 1, counts = new Array(bins).fill(0);
  for (const y of ys) counts[Math.min(bins - 1, Math.floor((y - lo) / span * bins))]++;
  // Floor = densest bin in the lower third, generous by one neighbour on each side.
  const limit = Math.ceil(bins / 3), bin = counts.slice(0, limit).reduce((best, c, i) => c > counts[best] ? i : best, 0);
  const y0 = lo + (bin - 1) * span / bins, y1 = lo + (bin + 2) * span / bins, band = rows.filter(r => r[1] >= y0 && r[1] <= y1);
  const xs = band.map(r => r[0]).sort((a, b) => a - b), zs = band.map(r => r[2]).sort((a, b) => a - b), q = (v, f) => v[Math.min(v.length - 1, Math.floor(v.length * f))];
  return { y: lo + (bin + .5) * span / bins, origin: [q(xs, .02), q(zs, .02)], width: q(xs, .98) - q(xs, .02), depth: q(zs, .98) - q(zs, .02),
    support: band.length / rows.length, units: 'arbitrary' };
}
/** Exports a plain colored cloud, never adds trained Gaussian or metric provenance. */
export function toPLY(points) {
  bounds(points);
  const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment BrainSNN visual point cloud; scale unverified; no collision geometry\nelement vertex ${points.length / STRIDE}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`);
  const buffer = new ArrayBuffer(header.length + points.length / STRIDE * 15), view = new DataView(buffer);
  new Uint8Array(buffer).set(header);
  for (let i = 0; i < points.length / STRIDE; i++) {
    const at = header.length + i * 15;
    for (let j = 0; j < 3; j++) { view.setFloat32(at + j * 4, points[i * STRIDE + j], true); view.setUint8(at + 12 + j, Math.round(clamp(points[i * STRIDE + 6 + j], 0, 1) * 255)); }
  }
  return buffer;
}
