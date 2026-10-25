'use strict';

const { createHash } = require('node:crypto');
const { inflateSync } = require('node:zlib');

const LIMITS = Object.freeze({ maxObservations: 6, maxImages: 12, maxEvents: 100,
  maxRequestBytes: 8 * 1024 * 1024, maxImageEdge: 512, maxInputTokens: 32000 });
// Gemini 4 high-resolution images have a documented 1120-token maximum. The
// reserve adds headroom; text uses UTF-8 bytes, not the optimistic chars/4 rule.
// https://ai.google.dev/gemini-api/docs/media-resolution (2026-10-17)
const IMAGE_TOKEN_RESERVE = 1280;
const PROMPT_TOKEN_RESERVE = 6144;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}$/;
const HASH = /^[a-f0-9]{64}$/;
const OBSERVATION_KINDS = new Set(['observation', 'dataset-observation', 'frame']);

class EvidenceError extends Error {
  constructor(message, code = 'invalid_evidence') { super(message); this.name = 'EvidenceError'; this.code = code; this.status = 400; }
}
function need(value, message, code) { if (!value) throw new EvidenceError(message, code); }
function object(value, allowed, label) {
  need(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must be an object.`);
  need(Object.keys(value).every(key => allowed.includes(key)), `${label} contains unsupported fields.`);
}
function text(value, max, label, min = 1) {
  need(typeof value === 'string' && value.length >= min && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) && value.isWellFormed(), `${label} is invalid.`);
}
function identifier(value) { need(typeof value === 'string' && ID.test(value), 'Invalid evidence identifier.'); }
function hash(value) { need(typeof value === 'string' && HASH.test(value), 'Expected a lowercase SHA-256 digest.'); }
function list(value, max, label, min = 0) { need(Array.isArray(value) && value.length >= min && value.length <= max, `${label} exceeds its allowed size.`); }
function number(value, label) { need(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER, `${label} must be finite and safely representable.`); }
function ids(value, max, label, min = 0) { list(value, max, label, min); value.forEach(identifier); need(new Set(value).size === value.length, `${label} contains duplicate identifiers.`); }
function strings(value, max, length, label) { list(value, max, label); value.forEach(item => text(item, length, label)); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function evidenceMetadata(evidence) {
  return { ...evidence, images: evidence.images.map(({ dataBase64, ...metadata }) => metadata) };
}
function computeInputDigest(evidence) { return createHash('sha256').update(canonical(evidenceMetadata(evidence))).digest('hex'); }

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function checkPNG(bytes, width, height) {
  need(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Image is not a PNG.');
  let offset = 8, header = false, ended = false, channels, dataEnded = false;
  const data = [];
  while (offset < bytes.length) {
    need(offset + 12 <= bytes.length, 'PNG chunk is truncated.');
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
    need(end <= bytes.length, 'PNG chunk is truncated.');
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    need(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG checksum is invalid.');
    need(header || kind === 'IHDR', 'PNG header is missing.');
    if (kind === 'IHDR') {
      need(!header && size === 13, 'PNG header is invalid.');
      need(bytes.readUInt32BE(offset + 8) === width && bytes.readUInt32BE(offset + 12) === height, 'Declared image dimensions do not match the PNG.');
      const depth = bytes[offset + 16], color = bytes[offset + 17];
      need(depth === 8 && [2, 6].includes(color) && bytes[offset + 18] === 0 && bytes[offset + 19] === 0 && bytes[offset + 20] === 0,
        'Use a non-interlaced RGB/RGBA8 canvas PNG derivative.');
      channels = color === 2 ? 3 : 4; header = true;
    } else if (kind === 'IDAT') {
      need(!dataEnded, 'PNG image data chunks must be contiguous.'); data.push(bytes.subarray(offset + 8, end - 4));
    } else if (kind === 'IEND') {
      need(size === 0 && data.length > 0 && end === bytes.length, 'PNG ending is invalid.'); ended = true;
    } else {
      // No textual metadata, URLs, animation, compressed profiles or hidden files.
      const safeSizes = { sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9 };
      need(Object.hasOwn(safeSizes, kind) && size === safeSizes[kind] && !data.length, 'PNG contains unsupported metadata.');
    }
    if (kind !== 'IDAT' && data.length) dataEnded = true;
    offset = end;
  }
  need(ended, 'PNG ending is missing.');
  const expected = height * (1 + width * channels), compressed = Buffer.concat(data);
  let inflated;
  try { inflated = inflateSync(compressed, { maxOutputLength: expected, info: true }); }
  catch { throw new EvidenceError('PNG pixels cannot be decoded within the image limits.'); }
  need(inflated.buffer.length === expected && inflated.engine.bytesWritten === compressed.length, 'PNG decoded size is invalid.');
  for (let row = 0; row < height; row++) need(inflated.buffer[row * (1 + width * channels)] <= 4, 'PNG row filter is invalid.');
}

function vector(value) { list(value, 64, 'Telemetry vector'); value.forEach(v => number(v, 'Telemetry')); }
function telemetry(value) {
  const vectors = ['state', 'vector', 'action'];
  const numbers = ['reward', 'queuedCount', 'unusedCount', 'chunkIndex', 'step', 'inferenceCount'];
  const booleans = ['success', 'done', 'initialOnly', 'stale', 'missing'];
  const names = ['observationId', 'chunkId', 'controllerInputId', 'status', 'phase'];
  object(value, [...vectors, ...numbers, ...booleans, ...names, 'actions', 'cameras'], 'Telemetry');
  for (const [key, item] of Object.entries(value)) {
    if (vectors.includes(key)) vector(item);
    else if (numbers.includes(key)) number(item, key);
    else if (booleans.includes(key)) need(typeof item === 'boolean', `${key} must be boolean.`);
    else if (names.includes(key)) text(item, 180, key);
    else if (key === 'actions') { list(item, 50, 'Action chunk'); item.forEach(vector); }
    else if (key === 'cameras') {
      list(item, 2, 'Camera metadata');
      for (const camera of item) {
        object(camera, ['id', 'artifactId', 'role', 'consumedByPolicy'], 'Camera metadata');
        identifier(camera.id); if (camera.artifactId !== undefined) identifier(camera.artifactId);
        if (camera.role !== undefined) text(camera.role, 64, 'Camera role');
        if (camera.consumedByPolicy !== undefined) need(typeof camera.consumedByPolicy === 'boolean', 'Camera consumption must be boolean.');
      }
    }
  }
}

function validateEvidence(raw) {
  let serialized;
  try { serialized = JSON.stringify(raw); } catch { throw new EvidenceError('Evidence must be JSON.'); }
  need(typeof serialized === 'string' && Buffer.byteLength(serialized) <= LIMITS.maxRequestBytes, 'Evidence exceeds the 8 MiB request limit.', 'evidence_too_large');
  object(raw, ['schema', 'manifestSha256', 'recordingId', 'sourceKind', 'context', 'selectedEventIds', 'events', 'images', 'includePrompts'], 'Evidence');
  need(raw.schema === 'brainsnn.arena.analysis-input.v1', 'Unsupported analysis evidence schema.');
  hash(raw.manifestSha256); identifier(raw.recordingId); identifier(raw.sourceKind);
  need(raw.includePrompts === false, 'Prompt contents are not supported by this analysis version.');
  object(raw.context, ['task', 'model', 'limitations'], 'Context');
  if (raw.context.task !== undefined) text(raw.context.task, 256, 'Task identifier');
  if (raw.context.model !== undefined) text(raw.context.model, 256, 'Model identifier');
  strings(raw.context.limitations, 20, 400, 'Coverage limitations');
  ids(raw.selectedEventIds, LIMITS.maxObservations, 'Selected observations', 1);
  list(raw.events, LIMITS.maxEvents, 'Events', 1); list(raw.images, LIMITS.maxImages, 'Images', 1);
  const eventIds = new Set(), eventById = new Map(), sequences = new Set();
  for (const event of raw.events) {
    object(event, ['id', 'kind', 'seq', 'simTime', 'clock', 'refs', 'data'], 'Event');
    identifier(event.id); identifier(event.kind);
    need(!eventIds.has(event.id), 'Event identifiers must be unique.'); eventIds.add(event.id); eventById.set(event.id, event);
    need(Number.isSafeInteger(event.seq) && event.seq >= 0 && !sequences.has(event.seq), 'Event sequences must be unique nonnegative safe integers.'); sequences.add(event.seq);
    if (event.simTime !== undefined) { number(event.simTime, 'Simulation time'); need(event.simTime >= 0, 'Simulation time must be nonnegative.'); }
    if (event.clock !== undefined) {
      object(event.clock, ['domain', 'value'], 'Clock'); identifier(event.clock.domain);
      if (typeof event.clock.value === 'string') need(/^[0-9]{1,30}$/.test(event.clock.value), 'Clock value must be integer digits.');
      else number(event.clock.value, 'Clock value');
    }
    ids(event.refs, LIMITS.maxEvents, 'Event references'); telemetry(event.data);
  }
  for (const event of raw.events) for (const ref of event.refs) need(eventIds.has(ref), 'An event reference is absent from the submitted evidence.');
  const visited = new Set(), active = new Set();
  function visit(id) { need(!active.has(id), 'Event reference cycle.'); if (visited.has(id)) return; active.add(id); eventById.get(id).refs.forEach(visit); active.delete(id); visited.add(id); }
  raw.events.forEach(event => visit(event.id));
  const selected = new Set(raw.selectedEventIds);
  for (const id of selected) need(eventIds.has(id) && OBSERVATION_KINDS.has(eventById.get(id).kind), 'Selected observation is absent or has an unsupported kind.');
  const imageIds = new Set(), imagesPerEvent = new Map();
  let imageBytes = 0;
  for (const image of raw.images) {
    object(image, ['id', 'eventId', 'artifactId', 'originalSha256', 'sha256', 'mimeType', 'width', 'height', 'dataBase64'], 'Image');
    identifier(image.id); identifier(image.eventId); identifier(image.artifactId); hash(image.originalSha256); hash(image.sha256);
    need(!imageIds.has(image.id) && !eventIds.has(image.id), 'Image identifiers must be unique across evidence.'); imageIds.add(image.id);
    need(selected.has(image.eventId), 'Every image must link to a selected observation.');
    imagesPerEvent.set(image.eventId, (imagesPerEvent.get(image.eventId) || 0) + 1);
    need(imagesPerEvent.get(image.eventId) <= 2, 'At most two camera images may be submitted per observation.');
    need(image.mimeType === 'image/png', 'Only PNG analysis derivatives are accepted.');
    need([image.width, image.height].every(v => Number.isInteger(v) && v >= 1 && v <= LIMITS.maxImageEdge), 'Image dimensions exceed 512 pixels.');
    need(typeof image.dataBase64 === 'string' && image.dataBase64.length > 0 && image.dataBase64.length <= 2 * 1024 * 1024 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64), 'Image bytes must be canonical base64.');
    const bytes = Buffer.from(image.dataBase64, 'base64');
    need(bytes.toString('base64') === image.dataBase64, 'Image bytes must be canonical base64.');
    need(createHash('sha256').update(bytes).digest('hex') === image.sha256, 'Analysis image SHA-256 does not match its bytes.', 'image_integrity');
    checkPNG(bytes, image.width, image.height); imageBytes += bytes.length;
  }
  // Preserve exactly what the client previewed. Unsupported fields are rejected,
  // never silently sent to the provider or silently stripped from the digest.
  const evidence = JSON.parse(serialized);
  const metadataBytes = Buffer.byteLength(canonical(evidenceMetadata(evidence)));
  const imageLabelBytes = raw.images.reduce((sum, image) => sum + Buffer.byteLength(`Evidence image ID: ${image.id}`), 0);
  const inputTokenUpperBound = metadataBytes + imageLabelBytes + PROMPT_TOKEN_RESERVE + raw.images.length * IMAGE_TOKEN_RESERVE;
  need(inputTokenUpperBound <= LIMITS.maxInputTokens, 'Selected telemetry exceeds the bounded input budget; select fewer events.', 'input_budget');
  return { evidence, inputDigest: computeInputDigest(evidence), stats: {
    imageCount: raw.images.length, eventCount: raw.events.length, observationCount: selected.size,
    imageBytes, metadataBytes, inputTokenUpperBound,
  } };
}

module.exports = { validateEvidence, computeInputDigest, canonical, evidenceMetadata, EvidenceError,
  LIMITS, PROMPT_TOKEN_RESERVE, IMAGE_TOKEN_RESERVE };
