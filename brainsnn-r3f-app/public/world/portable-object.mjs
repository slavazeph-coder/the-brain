import {bounds, MAX_FILE_BYTES, MAX_POINTS, STRIDE} from './visual-geometry.mjs';
import {composeObjectDocument, objectifySha256} from './objectify-core.mjs';

const SCHEMA = 'brainsnn.portable-appearance-object.v1';
const MAGIC = 0x57424f31;
const HEADER_BYTES = 8;
const MAX_MANIFEST_BYTES = 8192;
const RECORD_BYTES = (STRIDE + 1) * 4;
const MAX_OBJECT_POINTS = MAX_POINTS - 1;
const C0 = .28209479177387814;
const KINDS = ['point-cloud', 'gaussian-splat'];
const ORIENTATIONS = ['identity', 'flip-y-z'];
const PACKAGES = new WeakMap();
export const MAX_PORTABLE_BYTES = HEADER_BYTES + MAX_MANIFEST_BYTES + MAX_OBJECT_POINTS * RECORD_BYTES;
const hashPattern = /^[0-9a-f]{64}$/u;
const isHash = value => typeof value === 'string' && hashPattern.test(value);
const numeric = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const whole = (n, min, max) => Number.isSafeInteger(n) && numeric(n, min, max);
const vec3 = (v, limit = 1e7) => Array.isArray(v) && v.length === 3 && v.every(n => numeric(n, -limit, limit));
const nameValid = (s, limit) => typeof s === 'string' && s.trim() && s.length <= limit && !/[\u0000-\u001f\u007f]/u.test(s);

function normalizeSource(value) {
  if (!nameValid(value?.name, 256) || !whole(value.bytes, 1, MAX_FILE_BYTES) || !isHash(value.sha256)) {
    throw Error('The appearance source reference is invalid.');
  }
  const {name, bytes, sha256} = value;
  return {name, bytes, sha256};
}

function packageMetadata(value) {
  if (value?.schema !== SCHEMA || !KINDS.includes(value.kind) || value.frame !== 'local-y-up-base-centre' ||
      !whole(value.count, 1, MAX_OBJECT_POINTS) || !isHash(value.payloadSha256)) {
    throw Error('Choose a current World Builder portable object.');
  }
  const source = normalizeSource(value.source);
  const {orientation, parser, retained, total, sampleSha256, indicesSha256} = value.source;
  if (!ORIENTATIONS.includes(orientation) || parser !== 'visual-geometry-v2' ||
      !whole(total, value.count, 10_000_000) || !whole(retained, value.count, Math.min(MAX_POINTS, total)) ||
      !isHash(sampleSha256) || !isHash(indicesSha256)) {
    throw Error('The source orientation or retained sample reference is invalid.');
  }
  const o = value.object;
  if (!nameValid(o?.name, 120) || typeof o.id !== 'string' || !/^object-[0-9]{6}$/u.test(o.id) ||
      typeof o.instanceId !== 'string' || !/^instance-[0-9]{6}$/u.test(o.instanceId) ||
      !whole(o.revision, 1, 999999) || !vec3(o.sourceAnchor) || !vec3(o.translation, 1e6) ||
      !numeric(o.yawDegrees, -180, 180) || o.boundariesReviewed !== true) {
    throw Error('The portable object needs a valid reviewed selection.');
  }
  return {
    schema:SCHEMA, kind:value.kind, frame:value.frame, count:value.count, payloadSha256:value.payloadSha256,
    source:{...source, orientation, parser, retained, total, sampleSha256, indicesSha256},
    object:{name:o.name, id:o.id, instanceId:o.instanceId, revision:o.revision, sourceAnchor:o.sourceAnchor.slice(),
      translation:o.translation.slice(), yawDegrees:o.yawDegrees, boundariesReviewed:true},
  };
}

function anchorFor(points) {
  const {min, center} = bounds(points);
  return [center[0], min[1], center[2]];
}

export async function makePortableObject(context, edits, instanceId) {
  const composed = composeObjectDocument(context, edits);
  const selected = composed.objects.find(item => item.id === instanceId);
  if (!selected?.reviewed || selected.hidden) throw Error('Choose a visible object with reviewed boundaries.');
  if (selected.pointCount > MAX_OBJECT_POINTS) throw Error('Keep a smaller object selection to leave room for the destination scan.');
  const anchor = [selected.bounds.center[0], selected.bounds.min[1], selected.bounds.center[2]];
  const payload = new Uint8Array(selected.pointCount * RECORD_BYTES);
  const view = new DataView(payload.buffer);
  let cursor = 0;
  for (let i = 0; i < composed.instanceIds.length; i++) {
    if (composed.instanceIds[i] !== selected.tag) continue;
    const start = i * STRIDE;
    for (let j = 0; j < STRIDE; j++) {
      const sample = composed.points[start + j] - (j < 3 ? anchor[j] : 0);
      view.setFloat32(cursor + j * 4, sample, true);
    }
    view.setUint32(cursor + STRIDE * 4, composed.sourceIndices[i], true);
    cursor += RECORD_BYTES;
  }
  const s = context.source;
  const metadata = packageMetadata({
    schema:SCHEMA, kind:context.kind, frame:'local-y-up-base-centre', count:selected.pointCount,
    payloadSha256:await objectifySha256(payload),
    source:{name:s.name, bytes:s.bytes, sha256:s.sha256, orientation:s.displayTransform, parser:s.parserVersion,
      total:s.total, retained:s.retained, sampleSha256:s.previewSha256, indicesSha256:s.sourceIndicesSha256},
    object:{name:selected.name, id:selected.objectId, instanceId:selected.id, revision:edits.revision,
      sourceAnchor:anchor, translation:selected.translation, yawDegrees:selected.yawDegrees, boundariesReviewed:true},
  });
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const pack = new Uint8Array(HEADER_BYTES + header.length + payload.length);
  new DataView(pack.buffer).setUint32(0, MAGIC);
  new DataView(pack.buffer).setUint32(4, header.length);
  pack.set(header, HEADER_BYTES);
  pack.set(payload, HEADER_BYTES + header.length);
  const stem = metadata.object.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  return {filename:`${stem || 'reviewed-object'}.brainobject`, buffer:pack.buffer};
}

export async function readPortableObject(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES + RECORD_BYTES + 1 ||
      buffer.byteLength > MAX_PORTABLE_BYTES) throw Error('Choose a bounded .brainobject package.');
  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  const length = view.getUint32(4);
  if (view.getUint32(0) !== MAGIC || !whole(length, 1, MAX_MANIFEST_BYTES) ||
      HEADER_BYTES + length + RECORD_BYTES > bytes.length) throw Error('The portable object header is invalid.');
  let declared;
  try {
    declared = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + length)));
  } catch {
    throw Error('The portable object manifest is unreadable.');
  }
  const meta = packageMetadata(declared);
  const start = HEADER_BYTES + length;
  if (start + meta.count * RECORD_BYTES !== bytes.length ||
      await objectifySha256(bytes.subarray(start)) !== meta.payloadSha256) {
    throw Error('The portable object samples do not match their manifest.');
  }
  const points = new Float32Array(meta.count * STRIDE);
  const indices = new Uint32Array(meta.count);
  for (let i = 0; i < meta.count; i++) {
    const at = start + i * RECORD_BYTES;
    for (let j = 0; j < STRIDE; j++) points[i * STRIDE + j] = view.getFloat32(at + j * 4, true);
    const index = view.getUint32(at + STRIDE * 4, true);
    if (index >= meta.source.total || (i && indices[i-1] >= index)) throw Error('The portable source vertex IDs are invalid.');
    indices[i] = index;
    if (Math.abs(Math.hypot(...points.subarray(i * STRIDE + 10, i * STRIDE + 14)) - 1) > 1e-4) {
      throw Error('The portable object has invalid sample rotations.');
    }
  }
  const at = anchorFor(points);
  if (at.some(n => Math.abs(n) > 1e-5)) throw Error('The portable object is not centred on its local base.');
  const sha256 = await objectifySha256(bytes);
  const object = Object.freeze({name:meta.object.name, kind:meta.kind, count:meta.count,
    sourceName:meta.source.name, sourceSha256:meta.source.sha256, sha256});
  PACKAGES.set(object, {meta, points, indices});
  return object;
}

function placementFor(value) {
  if (!vec3(value?.anchor) || !numeric(value.scale, .001, 1000) || !numeric(value.yawDegrees, -360, 360)) {
    throw Error('Enter a finite position, a scale between 0.001 and 1,000, and a turn within 360°.');
  }
  return {anchor:value.anchor.slice(), scale:value.scale, yawDegrees:value.yawDegrees};
}

function applyPlacement(points, {anchor, scale, yawDegrees}, gaussian) {
  const values = points.slice();
  const a = yawDegrees * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a), ch = Math.cos(a / 2), sh = Math.sin(a / 2);
  for (let at = 0; at < values.length; at += STRIDE) {
    const [x, y, z] = points.subarray(at, at + 3);
    values.set([anchor[0] + scale * (c*x + s*z), anchor[1] + scale*y, anchor[2] + scale * (-s*x + c*z)], at);
    if (gaussian) {
      for (let j = 3; j < 6; j++) values[at+j] *= scale;
      const [qx, qy, qz, qw] = points.subarray(at + 10, at + 14);
      values.set([ch*qx + sh*qz, ch*qy + sh*qw, ch*qz - sh*qx, ch*qw - sh*qy], at + 10);
    }
  }
  return values;
}

function encodePly(points, indices, kind, nBase, destinationHash, packageHash) {
  const gaussian = kind === 'gaussian-splat';
  const vertexFields = gaussian
    ? 'x y z f_dc_0 f_dc_1 f_dc_2 opacity scale_0 scale_1 scale_2 rot_0 rot_1 rot_2 rot_3'.split(' ')
    : 'x y z red green blue'.split(' ');
  const header = new TextEncoder().encode([
    'ply', 'format binary_little_endian 1.0', 'comment BrainSNN authored appearance composite; destination-local units',
    `comment brainsnn_destination_sha256 ${destinationHash}`, `comment brainsnn_portable_sha256 ${packageHash}`,
    `element vertex ${indices.length}`, ...vertexFields.map(n => `property float ${n}`),
    'property uchar source_scan', 'property uint source_index', 'end_header', '',
  ].join('\n'));
  const rowBytes = vertexFields.length * 4 + 5;
  const buffer = new ArrayBuffer(header.byteLength + indices.length * rowBytes);
  new Uint8Array(buffer).set(header);
  const view = new DataView(buffer);
  const minScale = Math.fround(Math.exp(-12)), maxScale = Math.fround(Math.exp(8));
  for (let i = 0; i < indices.length; i++) {
    const row = points.subarray(i * STRIDE, (i + 1) * STRIDE);
    const at = header.length + i * rowBytes;
    const fields = [...row.subarray(0, 3)];
    if (gaussian) {
      const opacity = Math.min(1 - 1e-9, Math.max(1e-9, row[9]));
      const sizes = row.subarray(3, 6);
      if (sizes.some(n => !numeric(n,minScale,maxScale))) throw Error('A Gaussian size falls outside the viewer range. Try a different object scale.');
      const [x,y,z,w] = row.subarray(10, 14);
      fields.push(...Array.from(row.subarray(6,9), n => (n-.5)/C0), Math.log(opacity/(1-opacity)),
        ...Array.from(sizes, Math.log), w,x,y,z);
    } else {
      fields.push(...row.subarray(6,9));
    }
    fields.forEach((n,j) => view.setFloat32(at + j*4, n, true));
    view.setUint8(at + vertexFields.length*4, Number(i >= nBase));
    view.setUint32(at + vertexFields.length*4 + 1, indices[i], true);
  }
  return buffer;
}

export async function composePortableObject(destination, object, placement) {
  const pack = PACKAGES.get(object);
  if (!pack) throw Error('Open a portable object package first.');
  const source = normalizeSource(destination?.source);
  if (source.sha256 === pack.meta.source.sha256) throw Error('Open a second scan for this object.');
  const {parsed, points:base, displayTransform} = destination;
  if (!ORIENTATIONS.includes(displayTransform) || parsed?.kind !== object.kind) {
    throw Error('Use a destination with the same appearance type as the portable object.');
  }
  bounds(base);
  const baseCount = base.length / STRIDE;
  if (!(parsed.sourceIndices instanceof Uint32Array) || parsed.sourceIndices.length !== baseCount ||
      !whole(parsed.total, baseCount, 10_000_000) || parsed.parserMetadata?.version !== 'visual-geometry-v2') {
    throw Error('The retained destination scan reference is invalid.');
  }
  for (let i = 0; i < baseCount; i++) {
    if (parsed.sourceIndices[i] >= parsed.total || i && parsed.sourceIndices[i - 1] >= parsed.sourceIndices[i]) {
      throw Error('The destination source vertex IDs are invalid.');
    }
  }
  const place = placementFor(placement);
  const inset = applyPlacement(pack.points, place, object.kind === 'gaussian-splat');
  const insertedBounds = bounds(inset);
  const retained = Math.min(baseCount, MAX_POINTS - object.count);
  const indices = new Uint32Array(retained + object.count);
  const points = new Float32Array(indices.length * STRIDE);
  for (let i = 0; i < retained; i++) {
    const src = Math.floor(i * baseCount / retained);
    points.set(base.subarray(src * STRIDE, (src + 1) * STRIDE), i * STRIDE);
    indices[i] = parsed.sourceIndices[src];
  }
  points.set(inset, retained * STRIDE);
  indices.set(pack.indices, retained);
  const buffer = encodePly(points, indices, object.kind, retained, source.sha256, object.sha256);
  const artifact = {name:'authored-scan-composite.ply', bytes:buffer.byteLength, sha256:await objectifySha256(buffer),
    kind:object.kind, count:indices.length};
  const receipt = {
    schema:'brainsnn.appearance-composite.v1', provenance:'authored-composite',
    units:'destination-local-unverified', coordinateFrame:'right-handed-y-up', placement:place,
    destination:{...source, displayTransform, parser:parsed.parserMetadata.version, total:parsed.total,
      retainedPreview:baseCount, used:retained, sampling:retained < baseCount ? 'evenly-spaced-retained-indices' : 'all-retained'},
    portableObject:{sha256:object.sha256, manifest:structuredClone(pack.meta)}, artifact,
    insertedBounds:{min:insertedBounds.min, max:insertedBounds.max},
    sourceFilesPreserved:true, realWorldScaleVerified:false, collisionChecked:false, higherOrderShPreserved:false,
    originalSurfaceCompletion:'unknown',
  };
  return {buffer, receipt, name:artifact.name};
}
