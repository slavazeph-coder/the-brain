import { STRIDE } from './visual-geometry.mjs';

export const MAX_OPEN4DGS_TRIGS_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const HEADER_BYTES = 64;
const KNOWN_EXPORTER = '2026-09-16.runtime-bin-v2';
const BASE_FIELDS = {means: [3], scales: [3], quats: [4], opacities: [], sh0: [1, 3]};
const MOTION_FIELDS = {times: [], log_durations: [], anchors: [3], zeta_base_r: [3], zeta_base_t: [3],
  zeta_c0_r: [3], zeta_c0_t: [3], zeta_c1_r: [3], zeta_c1_t: [3], zeta_c2_r: [3], zeta_c2_t: [3]};
const DTYPE_BYTES = new Map([['float32', 4], ['float16', 2], ['uint8', 1]]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finiteInt = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);

function require(condition, message) {
  if (!condition) throw Error(message);
}

function headerOf(buffer) {
  require(buffer.byteLength >= HEADER_BYTES, 'TRIGSBIN header is truncated.');
  const view = new DataView(buffer);
  require(new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) === 'TRIGSBIN' && view.getUint32(8, true) === 1 &&
    view.getUint32(12, true) === HEADER_BYTES && view.getBigUint64(56, true) === 0n, 'Use an ASU TRIGSBIN v1 file.');
  const fields = ['manifestOffset', 'manifestLength', 'payloadOffset', 'payloadLength', 'alignment'];
  const header = Object.fromEntries(fields.map((field, index) => [field, Number(view.getBigUint64(16 + index * 8, true))]));
  const {manifestOffset, manifestLength, payloadOffset, payloadLength, alignment} = header;
  require(manifestOffset === HEADER_BYTES && finiteInt(manifestLength, 2, MAX_MANIFEST_BYTES) &&
    finiteInt(payloadOffset, HEADER_BYTES + manifestLength, buffer.byteLength) && finiteInt(alignment, 16, 4096) &&
    payloadOffset === Math.ceil((manifestOffset + manifestLength) / alignment) * alignment &&
    payloadLength === buffer.byteLength - payloadOffset && payloadLength > 0, 'TRIGSBIN section sizes or alignment are invalid.');
  return header;
}

function readManifest(buffer, header) {
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(new Uint8Array(buffer, header.manifestOffset, header.manifestLength)));
  } catch { throw Error('TRIGSBIN manifest is not valid UTF-8 JSON.'); }
  const {semantics, container, buffers} = manifest ?? {};
  require(manifest?.format === 'trigs.runtime' && manifest?.version === 1 && manifest.createdByVersion === KNOWN_EXPORTER &&
    manifest.source?.kind === 'single-trainer-checkpoint-auto-split',
  'This preview accepts ASU Core single-checkpoint .trigsbin exports. Export numbered PLY files for other variants.');
  require(container?.magic === 'TRIGSBIN' && container?.formatVersion === 1 && container.headerBytes === HEADER_BYTES &&
    container.byteOrder === 'little' && container.manifestEncoding === 'utf-8-json' &&
    Object.keys(header).every(key => container[key] === header[key]) && Array.isArray(buffers) && buffers.length === 1 &&
    buffers[0]?.index === 0 && buffers[0]?.byteOffset === header.payloadOffset && buffers[0]?.byteLength === header.payloadLength,
  'TRIGSBIN manifest does not match the binary header.');
  require(semantics?.tensorByteOffsets === 'relative_to_payload' && semantics?.quaternionOrder === 'xyzw' &&
    semantics?.dynamicMotionModel === 'trigs.se3_bezier_v1' && semantics?.opacityValueDomain === 'logit' &&
    semantics?.scaleValueDomain === 'log' && semantics?.shChannelOrder === 'rgb' &&
    semantics?.temporalOpacityMode === 'smooth_cull_renormalized' &&
    ['clip-local', 'global'].includes(semantics?.dynamicTimesDomain), 'TRIGSBIN motion parameters are unsupported.');
  return manifest;
}

function groupSpecs(group, isDynamic, columns) {
  require(record(group) && finiteInt(group.count, 0, 10_000_000) && finiteInt(group.shCoeffCount, 0, 48) &&
    record(group.tensors), 'TRIGSBIN has an invalid Gaussian group.');
  const fields = {...BASE_FIELDS, shN: [group.shCoeffCount, 3], ...(isDynamic ? MOTION_FIELDS : {})};
  const names = Object.keys(fields);
  require(Object.keys(group.tensors).length === names.length, 'TRIGSBIN has unexpected Gaussian tensors.');
  for (const name of names) {
    require(Object.hasOwn(group.tensors, name), 'TRIGSBIN is missing a Gaussian tensor.');
    columns.push({key: name, spec: group.tensors[name], shape: [group.count, ...fields[name]], floating: true});
  }
  return group;
}

function validateClip(manifest, validPlayback) {
  const {clips, timeline, semantics} = manifest;
  const fps = timeline?.frameRate, count = timeline?.totalFrames;
  const threshold = semantics.temporalCullThreshold;
  require(validPlayback(fps, count) && timeline.timeUnit === 'seconds' && timeline.frameIndexing === 'zero_based_end_exclusive' &&
    Math.abs(timeline.durationSeconds - count / fps) < 1e-6 && Number.isFinite(threshold) && threshold >= 0 && threshold < 1,
  'TRIGSBIN timing or opacity threshold exceeds the preview limits.');
  require(Array.isArray(clips) && clips.length === 1, 'This .trigsbin has multiple clips. Export one clip or numbered PLY files.');
  const clip = clips[0];
  require(clip?.index === 0 && clip?.global?.coreFrameStart === 0 && clip?.global?.coreFrameEndExclusive === count &&
    clip?.global?.activeFrameStart === 0 && clip?.global?.activeFrameEndExclusive === count &&
    clip?.training?.globalFrameStart === 0 && clip?.training?.globalFrameEndExclusive === count &&
    clip?.local?.coreFrameStart === 0 && clip?.local?.coreFrameEndExclusive === count &&
    clip?.render?.frameCount === count && clip?.render?.transitionMode === 'hard_cut' &&
    clip?.render?.fadeInFrames === 0 && clip?.render?.fadeOutFrames === 0,
  'TRIGSBIN clip schedule is unsupported. Use a single clip with no transition.');
  require(clip.static?.storage === 'global' && record(manifest.static) && clip.static.sourceStaticId === manifest.static.id &&
    clip.static.count === manifest.static.count && manifest.static.global?.frameStart === 0 &&
    manifest.static.global?.frameEndExclusive === count &&
    clip.model?.count === manifest.static.count + clip.dynamic?.count && clip.model?.motionModel === 'trigs.se3_bezier_v1',
  'TRIGSBIN static and dynamic groups do not match the clip.');
  return {clip, fps, count, threshold};
}

async function validateTensors(columns, manifest, buffer, header) {
  const paths = new Map();
  const ranges = [];
  const index = manifest.tensorIndex;
  require(Array.isArray(index) && index.length === columns.length, 'TRIGSBIN tensor index has an unexpected length.');
  for (const {spec, shape, floating} of columns) {
    const bytes = DTYPE_BYTES.get(spec?.dtype);
    const length = bytes * shape.reduce((product, n) => product * n, 1);
    require(bytes && (floating ? spec.dtype !== 'uint8' : spec.dtype === 'uint8') && spec.buffer === 0 &&
      spec.storage === 'raw' && spec.layout === 'C' && spec.alignment === header.alignment &&
      Array.isArray(spec.shape) && spec.shape.length === shape.length && shape.every((n, i) => spec.shape[i] === n) &&
      spec.byteLength === length && finiteInt(spec.byteOffset, 0, header.payloadLength - length) &&
      spec.byteOffset % header.alignment === 0 && typeof spec.path === 'string' && spec.path.length <= 160 && !paths.has(spec.path),
    'TRIGSBIN tensor layout or byte bounds are invalid.');
    paths.set(spec.path, spec);
    if (length) ranges.push([spec.byteOffset, spec.byteOffset + length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  require(ranges.every((range, i) => !i || ranges[i - 1][1] <= range[0]), 'TRIGSBIN tensor ranges overlap.');
  for (const [i, item] of index.entries()) {
    const spec = paths.get(item?.path);
    require(spec && item.index === i && item.byteOffset === spec.byteOffset && item.byteLength === spec.byteLength &&
      item.dtype === spec.dtype && Array.isArray(item.shape) && item.shape.length === spec.shape.length &&
      item.shape.every((n, axis) => n === spec.shape[axis]), 'TRIGSBIN tensor index disagrees with its payload.');
    paths.delete(item.path);
    if (spec.sha256 !== undefined) {
      require(typeof spec.sha256 === 'string' && /^[a-f0-9]{64}$/.test(spec.sha256), 'TRIGSBIN tensor checksum is invalid.');
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer, header.payloadOffset + spec.byteOffset, spec.byteLength));
      const hash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
      require(spec.sha256 === hash, 'TRIGSBIN tensor bytes do not match their checksum.');
    }
  }
}

function half(unsigned) {
  const sign = unsigned & 0x8000 ? -1 : 1;
  const exponent = unsigned >>> 10 & 31, fraction = unsigned & 1023;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return exponent ? sign * (1 + fraction / 1024) * 2 ** (exponent - 15) : sign * fraction * 2 ** -24;
}

function reader(view, spec) {
  const width = spec.shape.slice(1).reduce((product, n) => product * n, 1);
  const bytes = DTYPE_BYTES.get(spec.dtype);
  const scalar = spec.dtype === 'float32' ? offset => view.getFloat32(offset, true) :
    spec.dtype === 'float16' ? offset => half(view.getUint16(offset, true)) : offset => view.getUint8(offset);
  return (row, out) => {
    const offset = spec.byteOffset + row * width * bytes;
    if (width === 1) return scalar(offset);
    for (let i = 0; i < width; i++) out[i] = scalar(offset + i * bytes);
    return out;
  };
}

function groupRows(view, group, sampledCount, isDynamic, flagRead) {
  const readers = Object.fromEntries(Object.entries(group.tensors).filter(([name]) => name !== 'shN')
    .map(([name, spec]) => [name, reader(view, spec)]));
  const result = [];
  for (let i = 0; i < sampledCount; i++) {
    const source = Math.floor(i * group.count / sampledCount);
    const row = {};
    for (const [name, read] of Object.entries(readers)) row[name] = read(source, []);
    const fixed = !isDynamic || flagRead?.(source) === 1;
    if (!Object.values(row).flat().every(v => Number.isFinite(v) && Math.abs(v) <= 1e7)) continue;
    const norm = Math.hypot(...row.quats);
    if (norm < 1e-8 || (isDynamic && Math.abs(row.log_durations) > 80)) continue;
    // The supported pinned converter stamps xyzw but copies checkpoint bytes
    // directly. The pinned trainer stores and multiplies canonical wxyz.
    const [w, x, y, z] = row.quats.map(v => v / norm);
    const base = [...row.means, ...row.scales.map(v => Math.exp(clamp(v, -12, 8))),
      ...row.sh0.map(v => clamp(0.5 + 0.28209479177387814 * v, 0, 1)), 1 / (1 + Math.exp(-clamp(row.opacities, -80, 80))), x, y, z, w];
    result.push({fixed, base, row});
  }
  return result;
}

function cross([x, y, z], [a, b, c]) {
  return [y * c - z * b, z * a - x * c, x * b - y * a];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function twist(rotation, linear) {
  const theta = Math.hypot(...rotation), square = theta * theta, small = square < 1e-8;
  const sinc = small ? 0.5 - square / 48 : Math.sin(theta / 2) / theta;
  const beta = small ? 0.5 - square / 24 : (1 - Math.cos(theta)) / square;
  const gamma = small ? 1 / 6 - square / 120 : (theta - Math.sin(theta)) / (theta * square);
  const vector = rotation.map(v => v * sinc), scalar = small ? 1 - square / 8 : Math.cos(theta / 2);
  const once = cross(rotation, linear), twice = cross(rotation, once);
  return {vector, scalar, translation: linear.map((v, i) => v + beta * once[i] + gamma * twice[i])};
}

function deform({fixed, row, base}, seconds, threshold, output, at) {
  if (fixed) { output.set(base, at); return true; }
  const dt = seconds - row.times;
  const sigma = Math.exp(row.log_durations);
  const raw = Math.exp(-0.5 * (dt / Math.max(1e-6, sigma)) ** 2);
  const opacity = base[9] * Math.max(0, (raw - threshold) / (1 - threshold));
  if (opacity < 0.004) return false;

  const t = clamp(0.5 + dt / (4 * sigma), 0, 1);
  const weights = [(1 - t) ** 2, 2 * (1 - t) * t, t * t];
  const blend = suffix => row[`zeta_base_${suffix}`].map((v, axis) => v + weights[0] * row[`zeta_c0_${suffix}`][axis] +
    weights[1] * row[`zeta_c1_${suffix}`][axis] + weights[2] * row[`zeta_c2_${suffix}`][axis]);
  const omega = blend('r'), nu = blend('t'), omega2 = dot(omega, omega);
  const anchor = omega2 < 1e-8 ? row.anchors : row.anchors.map((v, i) => v - dot(row.anchors, omega) / omega2 * omega[i]);
  const velocity = omega2 < 1e-8 ? nu : omega.map(v => dot(nu, omega) / omega2 * v);
  const {vector, scalar, translation} = twist(omega.map(v => clamp(v * dt, -1e4, 1e4)), velocity.map(v => clamp(v * dt, -1e4, 1e4)));

  const relative = row.means.map((v, i) => v - anchor[i]);
  const once = cross(vector, relative), twice = cross(vector, once);
  const position = relative.map((v, i) => v + 2 * (scalar * once[i] + twice[i]) + anchor[i] + translation[i]);
  if (position.some(v => !Number.isFinite(v) || Math.abs(v) > 1e7)) return false;
  const canonical = base.slice(10, 13), turned = cross(vector, canonical);
  const q = canonical.map((v, i) => scalar * v + base[13] * vector[i] + turned[i]);
  q.push(scalar * base[13] - dot(vector, canonical));
  const norm = Math.hypot(...q);
  output.set(position, at);
  output.set(base.slice(3, 9), at + 3);
  output[at + 9] = opacity;
  output.set(q.map(v => v / norm), at + 10);
  return true;
}

/** Supported ASU Core single checkpoint timeline. All input is local and bounded. */
export async function readOpen4DGSTrigs(file, {validPlayback, frameIndex, maxPoints}) {
  require(typeof file?.name === 'string' && file.name.toLowerCase().endsWith('.trigsbin') && typeof file.arrayBuffer === 'function' &&
    finiteInt(file.size, HEADER_BYTES + 1, MAX_OPEN4DGS_TRIGS_BYTES), 'Use an ASU .trigsbin file up to 128 MiB.');
  const buffer = await file.arrayBuffer();
  require(buffer instanceof ArrayBuffer && buffer.byteLength === file.size, 'Could not read the selected .trigsbin file.');
  const header = headerOf(buffer);
  const manifest = readManifest(buffer, header);
  const {clip, fps, count: frameCount, threshold} = validateClip(manifest, validPlayback);
  const columns = [];
  const staticGroup = groupSpecs(manifest.static, false, columns);
  const dynamicGroup = groupSpecs(clip.dynamic, true, columns);
  const flags = clip.flags;
  require(flags?.count === dynamicGroup.count && record(flags.tensors) &&
    Object.keys(flags.tensors).length === 2 && Object.hasOwn(flags.tensors, 'is_static') && Object.hasOwn(flags.tensors, 'dynamic_protect'),
  'TRIGSBIN has invalid row flags.');
  for (const [key, spec] of Object.entries(flags.tensors)) columns.push({key, spec, shape: [flags.count], floating: false});

  await validateTensors(columns, manifest, buffer, header);
  const view = new DataView(buffer, header.payloadOffset, header.payloadLength);
  const total = staticGroup.count + dynamicGroup.count;
  require(total > 0, 'TRIGSBIN has no Gaussian rows.');
  const budget = Math.min(maxPoints, total);
  const low = staticGroup.count && dynamicGroup.count ? Math.max(1, budget - dynamicGroup.count) : budget - dynamicGroup.count;
  const high = Math.min(staticGroup.count, dynamicGroup.count ? budget - 1 : budget);
  const fixedCount = clamp(Math.round(budget * staticGroup.count / total), Math.max(0, low), high);
  const rows = [...groupRows(view, staticGroup, fixedCount, false),
    ...groupRows(view, dynamicGroup, budget - fixedCount, true, reader(view, flags.tensors.is_static))];
  require(rows.length > 0, 'TRIGSBIN has no usable preview rows.');
  const sampled = budget < total, skipped = budget - rows.length;

  return Object.freeze({kind: 'trigsbin', formatVersion: 1, fps, startFrame: 0, frameCount, bytes: file.size, durationSeconds: frameCount / fps,
    async loadFrame(index) {
      frameIndex(index, frameCount);
      const timeSeconds = index / fps;
      const output = new Float32Array(rows.length * STRIDE);
      let visible = 0;
      for (const row of rows) if (deform(row, timeSeconds, threshold, output, visible * STRIDE)) visible++;
      return {index, frameNumber: index, timeSeconds, points: output.subarray(0, visible * STRIDE), total, visible, sampled, skipped};
    },
  });
}
