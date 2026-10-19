/** BrainSNN Worlds. Geometry is appearance, never an automatically trusted collision map. */
export const MAX_POINTS = 100000;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MODEL = 'onnx-community/depth-anything-v2-small';
export const STRIDE = 14; // position(3), scale(3), rgba(4), quaternion xyzw(4)
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export function validateFile(file, mode = 'photo') {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw Error('Choose a non-empty file.');
  if (file.size > MAX_FILE_BYTES) throw Error('This browser preview accepts files up to 64 MiB. Split a longer capture before importing.');
  const name = String(file.name || '').toLowerCase();
  const ok = mode === 'splat' ? /\.(ply|splat)$/.test(name) : mode === 'video' ? /\.(mp4|mov|webm|m4v)$/.test(name) || /^video\//.test(file.type) : /\.(jpe?g|png|webp)$/.test(name) || /^image\/(jpeg|png|webp)$/.test(file.type);
  if (!ok) throw Error(mode === 'photo' ? 'Use a JPG, PNG or WebP. Export HEIC as JPEG first.' : mode === 'splat' ? 'Use an uncompressed Gaussian .ply or .splat file.' : 'Use an MP4, MOV or WebM video.');
  return true;
}
export function manifest(source, engine, extra = {}) {
  return { schema: 'brainsnn.world.v1', createdAt: new Date().toISOString(), source: { ...source }, engine, units: 'unverified', geometryVerified: false, robotReady: false, collisionGeometry: null, provenance: engine === 'authored-demo' ? 'authored-example' : engine.startsWith('lyra') ? 'generated' : 'inferred', limitations: ['Unseen surfaces are unknown or generated, not observed.', 'Appearance does not establish scale, clearance, friction or robot safety.'], ...extra, geometryVerified: false, robotReady: false, collisionGeometry: null };
}
export function fromDepth(rgba, width, height, depth, dw, dh, fov = 60) {
  if (!(width > 0 && height > 0 && dw > 1 && dh > 1) || rgba.length !== width * height * 4 || depth.length !== dw * dh) throw Error('Depth and image dimensions do not match.');
  const finite = Array.from(depth).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length < depth.length * .8) throw Error('The depth model returned too many invalid pixels.');
  const low = finite[Math.floor(finite.length * .02)], high = finite[Math.floor(finite.length * .98)];
  if (!(high - low > 1e-6)) throw Error('This image has no usable depth variation. Try another viewpoint.');
  const step = Math.max(1, Math.ceil(Math.sqrt(width * height / MAX_POINTS))), out = [];
  const focal = width / (2 * Math.tan(clamp(fov, 25, 100) * Math.PI / 360));
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const c = (y * width + x) * 4, di = Math.min(dh - 1, Math.floor(y / height * dh)) * dw + Math.min(dw - 1, Math.floor(x / width * dw));
    if (!Number.isFinite(depth[di]) || rgba[c + 3] < 128) continue;
    // Relative inverse depth. This is NOT a conversion to metres.
    const z = 1 / (.17 + .83 * clamp((depth[di] - low) / (high - low), 0, 1));
    const s = z / focal * step * .7;
    out.push((x - width / 2) / focal * z, -(y - height / 2) / focal * z, -z, s, s, s * .3, rgba[c] / 255, rgba[c + 1] / 255, rgba[c + 2] / 255, .9, 0, 0, 0, 1);
  }
  return new Float32Array(out);
}
export function toSplat(points) {
  if (!points.length || points.length % STRIDE) throw Error('No valid splat to export.');
  const count = points.length / STRIDE, buffer = new ArrayBuffer(count * 32), view = new DataView(buffer);
  for (let i = 0; i < count; i++) {
    const p = i * STRIDE, b = i * 32;
    for (let j = 0; j < 6; j++) view.setFloat32(b + j * 4, points[p + j], true);
    for (let j = 0; j < 4; j++) view.setUint8(b + 24 + j, Math.round(clamp(points[p + 6 + j], 0, 1) * 255));
    // Standard .splat quaternion order is w,x,y,z, signed values encoded around 128.
    [points[p + 13], points[p + 10], points[p + 11], points[p + 12]].forEach((v, j) => view.setUint8(b + 28 + j, clamp(Math.round(v * 128 + 128), 0, 255)));
  }
  return buffer;
}
export function parseSplat(buffer) {
  if (!buffer.byteLength || buffer.byteLength % 32) throw Error('Invalid .splat: expected 32-byte records.');
  const total = buffer.byteLength / 32, step = Math.max(1, Math.ceil(total / MAX_POINTS)), view = new DataView(buffer), out = [];
  for (let i = 0; i < total; i += step) {
    const b = i * 32, row = [];
    for (let j = 0; j < 6; j++) row.push(view.getFloat32(b + j * 4, true));
    if (!row.every(Number.isFinite) || row.slice(3).some(v => v <= 0 || v > 1e5) || row.slice(0, 3).some(v => Math.abs(v) > 1e7)) continue;
    for (let j = 0; j < 4; j++) row.push(view.getUint8(b + 24 + j) / 255);
    const q = [1, 2, 3, 0].map(j => (view.getUint8(b + 28 + j) - 128) / 128), n = Math.hypot(...q) || 1;
    out.push(...row, ...(Math.hypot(...q) > 1e-8 ? q.map(v => v / n) : [0, 0, 0, 1]));
  }
  if (!out.length) throw Error('The file contains no finite Gaussian points.');
  return { points: new Float32Array(out), total, sampled: step > 1 };
}
const scalar = { float: [4, 'getFloat32'], float32: [4, 'getFloat32'], double: [8, 'getFloat64'], float64: [8, 'getFloat64'], uchar: [1, 'getUint8'], uint8: [1, 'getUint8'], char: [1, 'getInt8'], int8: [1, 'getInt8'], short: [2, 'getInt16'], ushort: [2, 'getUint16'], int: [4, 'getInt32'], uint: [4, 'getUint32'] };
export function parsePLY(buffer) {
  const bytes = new Uint8Array(buffer), text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const match = /end_header\r?\n/.exec(text);
  if (!text.startsWith('ply\n') && !text.startsWith('ply\r\n')) throw Error('Not a PLY file.');
  if (!match) throw Error('Missing or oversized PLY header.');
  const header = text.slice(0, match.index), start = new TextEncoder().encode(text.slice(0, match.index + match[0].length)).length;
  const format = /format (\S+) 1\.0/.exec(header)?.[1];
  if (!['ascii', 'binary_little_endian'].includes(format)) throw Error('Use ASCII or little-endian uncompressed PLY.');
  let active = false, total = 0, offset = 0, seenOther = false; const props = [];
  for (const line of header.split(/\r?\n/)) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'element') { active = words[1] === 'vertex'; if (active) { if (seenOther) throw Error('PLY vertex data must be the first element.'); total = Number(words[2]); } else seenOther = true; }
    if (active && words[0] === 'property') {
      const spec = scalar[words[1]]; if (!spec) throw Error('Unsupported PLY vertex property type.');
      props.push({ name: words[2], offset, spec }); offset += spec[0];
    }
  }
  if (!Number.isInteger(total) || total <= 0 || total > 10000000 || !offset) throw Error('Invalid PLY vertex count.');
  if (!['x', 'y', 'z'].every(k => props.some(p => p.name === k))) throw Error('PLY needs x, y and z.');
  if (format !== 'ascii' && start + offset * total > bytes.length) throw Error('Truncated PLY vertex data.');
  if (format === 'ascii' && buffer.byteLength > 16 * 1024 * 1024) throw Error('Convert ASCII PLY larger than 16 MiB to binary PLY for a memory-safe preview.');
  const lines = format === 'ascii' ? new TextDecoder().decode(bytes.subarray(start)).trim().split(/\r?\n/) : null;
  if (lines && lines.length < total) throw Error('Truncated PLY vertex data.');
  const view = new DataView(buffer), out = [], step = Math.max(1, Math.ceil(total / MAX_POINTS));
  for (let i = 0; i < total; i += step) {
    const row = {}, values = lines ? lines[i].trim().split(/\s+/).map(Number) : null;
    props.forEach((p, j) => { row[p.name] = values ? values[j] : view[p.spec[1]](start + i * offset + p.offset, true); });
    if (![row.x, row.y, row.z].every(v => Number.isFinite(v) && Math.abs(v) < 1e7)) continue;
    const scales = [0, 1, 2].map(j => row['scale_' + j] === undefined ? .015 : Math.exp(clamp(row['scale_' + j], -12, 8)));
    const rgb = ['red', 'green', 'blue'].map((k, j) => clamp(row[k] !== undefined ? row[k] / 255 : .5 + .28209479177387814 * (row['f_dc_' + j] || 0), 0, 1));
    const opacity = row.opacity === undefined ? .95 : 1 / (1 + Math.exp(-clamp(row.opacity, -20, 20)));
    const q = [row.rot_1 || 0, row.rot_2 || 0, row.rot_3 || 0, row.rot_0 ?? 1], n = Math.hypot(...q) || 1;
    const valuesOut = [row.x, row.y, row.z, ...scales, ...rgb, opacity, ...(Math.hypot(...q) > 1e-8 ? q.map(v => v / n) : [0, 0, 0, 1])];
    if (valuesOut.every(Number.isFinite)) out.push(...valuesOut);
  }
  if (!out.length) throw Error('The PLY contains no usable points.');
  return { points: new Float32Array(out), total, sampled: step > 1 };
}
export function bounds(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += STRIDE) for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], points[i + j]); max[j] = Math.max(max[j], points[i + j]); }
  return { center: min.map((v, i) => (v + max[i]) / 2), radius: Math.max(.5, Math.hypot(...max.map((v, i) => v - min[i])) / 2) };
}
export function demoScene() {
  const out = []; let seed = 42;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const add = (x, y, z, c, s = .038) => { const k = .85 + random() * .2; out.push(x, y, z, s, s, s, c[0] * k, c[1] * k, c[2] * k, .96, 0, 0, 0, 1); };
  const plane = (origin, u, v, nu, nv, color, size = .04) => { for (let a = 0; a <= nu; a++) for (let b = 0; b <= nv; b++) add(...origin.map((n, i) => n + u[i] * a / nu + v[i] * b / nv), color, size); };
  const box = (x, y, z, w, h, d, c) => { const nx = Math.max(2, Math.ceil(w / .08)), ny = Math.max(2, Math.ceil(h / .08)), nz = Math.max(2, Math.ceil(d / .08)); plane([x, y + h, z], [w, 0, 0], [0, 0, d], nx, nz, c); plane([x, y, z], [w, 0, 0], [0, h, 0], nx, ny, c.map(v => v * .65)); plane([x + w, y, z], [0, 0, d], [0, h, 0], nz, ny, c.map(v => v * .85)); };
  // An authored gallery/gym, not a reconstruction or a customer case study.
  for (let x = -4; x <= 4; x += .08) for (let z = -3.5; z <= 3.5; z += .08) {
    const tile = (Math.floor((x + 4) * 2) + Math.floor((z + 3.5) * 2)) % 2;
    add(x, 0, z, tile ? [.20, .26, .31] : [.14, .19, .24], .042);
  }
  plane([-4, 0, -3.5], [8, 0, 0], [0, 3.1, 0], 100, 39, [.24, .32, .39]);
  plane([-4, 0, -3.5], [0, 0, 7], [0, 3.1, 0], 88, 39, [.17, .24, .32]);
  for (let x = -3.6; x < 4; x += 1.2) { plane([x, .6, -3.47], [.8, 0, 0], [0, 2.25, 0], 12, 30, [.25, .57, .67], .035); box(x - .05, 2.95, -3.3, .04, .04, 5.8, [.40, .75, .88]); }
  for (let i = 0; i < 3; i++) { const x = -2.7 + i * 1.8; box(x, .08, -1.85, 1, .18, 1.8, [.19, .22, .31]); box(x + .06, .26, -1.3, .88, .05, 1.15, [.10, .13, .17]); box(x, .26, -1.8, .08, 1.1, .08, [.64, .69, .72]); box(x + .92, .26, -1.8, .08, 1.1, .08, [.64, .69, .72]); box(x + .1, 1.2, -1.82, .8, .36, .1, [.30, .45, .53]); }
  box(-2.8, .22, 1.5, 2.3, .2, .6, [.54, .42, .29]); box(-2.7, .02, 1.62, .13, .2, .34, [.24, .27, .34]); box(-.75, .02, 1.62, .13, .2, .34, [.24, .27, .34]);
  plane([.8, .025, 1.1], [1.1, 0, 0], [0, 0, 1.9], 17, 28, [.32, .25, .55]);
  box(2.6, .03, -2.7, .45, .6, .45, [.62, .59, .53]);
  for (let i = 0; i < 1300; i++) { const angle = random() * Math.PI * 2, r = Math.sqrt(random()) * .45, y = .6 + random() * 1.6; add(2.83 + Math.cos(angle) * r * Math.sin((y - .6) * 2), y, -2.48 + Math.sin(angle) * r, [.12, .38 + random() * .17, .27], .027); }
  return new Float32Array(out);
}
