'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { validateEvidence, computeInputDigest, canonical, LIMITS } = require('../evidence.cjs');

function crc(bytes) { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n & 1) ? (n >>> 1) ^ 0xedb88320 : n >>> 1; } return (n ^ 0xffffffff) >>> 0; }
function chunk(kind, body) { const raw = Buffer.alloc(body.length + 12); raw.writeUInt32BE(body.length); raw.write(kind, 4); body.copy(raw, 8); raw.writeUInt32BE(crc(raw.subarray(4, -4)), raw.length - 4); return raw; }
function png({ width = 1, height = 1, compressed, extra = [] } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...extra,
    chunk('IDAT', compressed || deflateSync(Buffer.alloc(height * (1 + width * 4)))), chunk('IEND', Buffer.alloc(0))]);
}
function fixture(bytes = png()) {
  return { schema: 'brainsnn.arena.analysis-input.v1', manifestSha256: 'a'.repeat(64), recordingId: 'run-1', sourceKind: 'simulator-policy',
    context: { task: 'pick-task', model: 'pi05', limitations: ['Single selected observation.'] }, selectedEventIds: ['obs-1'], includePrompts: false,
    events: [{ id: 'obs-1', kind: 'observation', seq: 1, simTime: 0.5, refs: [], data: { state: [0, 0.5], cameras: [{ id: 'wrist', artifactId: 'raw-1', role: 'policy-input', consumedByPolicy: true }] } },
      { id: 'action-1', kind: 'controller-input', seq: 2, refs: ['obs-1'], data: { vector: [0.1, 0], success: false } }],
    images: [{ id: 'image-1', eventId: 'obs-1', artifactId: 'raw-1', originalSha256: 'b'.repeat(64),
      sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', width: 1, height: 1, dataBase64: bytes.toString('base64') }] };
}
test('accepts checked PNG and telemetry; preserves exact preview and independently computes costs', () => {
  const input = fixture(), before = structuredClone(input), valid = validateEvidence(input);
  assert.deepEqual(valid.evidence, before); assert.deepEqual(input, before);
  assert.equal(valid.inputDigest, computeInputDigest(input)); assert.equal(valid.stats.imageCount, 1);
  assert.ok(valid.stats.inputTokenUpperBound > 7000 && valid.stats.inputTokenUpperBound < LIMITS.maxInputTokens);
  input.context.task = 'changed'; assert.equal(valid.evidence.context.task, 'pick-task');
});
test('digest is canonical across object key ordering but binds telemetry, original identity and pixel digest', () => {
  const first = fixture(), reordered = Object.fromEntries(Object.entries(first).reverse());
  assert.equal(validateEvidence(first).inputDigest, validateEvidence(reordered).inputDigest);
  assert.equal(canonical({ z: 2, a: [1, { c: 'yes', b: false }] }), '{"a":[1,{"b":false,"c":"yes"}],"z":2}');
  for (const change of [x => x.events[1].data.vector[0] = 0.2, x => x.images[0].originalSha256 = 'c'.repeat(64), x => x.selectedEventIds = ['obs-1', 'other']]) {
    const other = structuredClone(first); change(other); assert.notEqual(computeInputDigest(other), computeInputDigest(first));
  }
});
test('rejects tampered images, fake dimensions, corrupt PNG and unsupported hidden metadata', () => {
  const altered = fixture(); altered.images[0].sha256 = 'f'.repeat(64); assert.throws(() => validateEvidence(altered), { code: 'image_integrity' });
  const wrongDimensions = fixture(); wrongDimensions.images[0].width = 2; assert.throws(() => validateEvidence(wrongDimensions), /dimensions/);
  const corrupt = png(); corrupt[corrupt.length - 5] ^= 1; assert.throws(() => validateEvidence(fixture(corrupt)), /checksum/);
  assert.throws(() => validateEvidence(fixture(png({ extra: [chunk('tEXt', Buffer.from('hidden secret'))] }))), /metadata/);
  assert.throws(() => validateEvidence(fixture(Buffer.from('not a png'))), /PNG/);
});
test('bounds decompression and rejects invalid pixel stream or trailing image data', () => {
  const bomb = png({ compressed: deflateSync(Buffer.alloc(1024 * 1024)) });
  assert.throws(() => validateEvidence(fixture(bomb)), /decode/);
  assert.throws(() => validateEvidence(fixture(png({ compressed: deflateSync(Buffer.from([5, 0, 0, 0, 0])) }))), /filter/);
  assert.throws(() => validateEvidence(fixture(Buffer.concat([png(), Buffer.from('trailing')]))), /ending/);
});
test('rejects prompts, URLs, unknown data fields, unsafe numbers and oversized payloads', () => {
  const changes = [x => x.includePrompts = true, x => x.prompt = 'secret', x => x.images[0].url = 'https://example.test/image',
    x => x.events[0].data.prompt = 'secret', x => x.events[0].data.state[0] = Infinity, x => x.events[0].seq = Number.MAX_SAFE_INTEGER + 1,
    x => x.context.limitations = ['x'.repeat(401)], x => x.images[0].width = 513, x => x.images[0].dataBase64 += '\n'];
  for (const change of changes) { const input = fixture(); change(input); assert.throws(() => validateEvidence(input)); }
  const input = fixture(); input.context.task = 'x'.repeat(LIMITS.maxRequestBytes); assert.throws(() => validateEvidence(input), { code: 'evidence_too_large' });
});
test('rejects invented, duplicate and cyclic references and unselected images', () => {
  for (const change of [x => x.events[1].refs = ['absent'], x => x.events[0].refs = ['action-1'], x => x.images[0].eventId = 'action-1',
    x => x.events[1].id = 'obs-1', x => x.selectedEventIds = ['action-1'], x => x.images[0].id = 'obs-1', x => x.images = []]) {
    const input = fixture(); change(input); assert.throws(() => validateEvidence(input));
  }
});
test('rejects oversized selected text before any provider operation and ignores no caller-supplied cost field', () => {
  const input = fixture(); input.events = Array.from({ length: 100 }, (_, i) => ({ id: i ? 'event-' + i : 'obs-1', kind: i ? 'state' : 'observation', seq: i, refs: [],
    data: { state: Array.from({ length: 64 }, () => 0.123456789012345) } }));
  assert.throws(() => validateEvidence(input), { code: 'input_budget' });
  const forged = fixture(); forged.stats = { inputTokenUpperBound: 0 }; assert.throws(() => validateEvidence(forged), /unsupported/);
});
