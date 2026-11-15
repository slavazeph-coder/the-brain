import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_POINTS, STRIDE, VISUAL_PARSER_VERSION, parsePLY, parseSplat } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';
import { createVisualViewer, selectVisualRectangle } from '../../brainsnn-r3f-app/public/world/visual-viewer.mjs';

const encode = value => new TextEncoder().encode(value);
const sampledTotal = MAX_POINTS + 3;
const sampledInvalid = new Set([2, sampledTotal - 1]);
const expectedSampled = () => Array.from({ length: Math.ceil(sampledTotal / 2) }, (_, i) => i * 2).filter(i => !sampledInvalid.has(i));
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const visualPoints = rows => new Float32Array(rows.flatMap(row => [...row, .02, .02, .02, .4, .5, .6, 1, 0, 0, 0, 1]));

function assertMembership(parsed, expected, format, kind = 'point-cloud', total = sampledTotal, skipped = 2) {
  assert.ok(parsed.sourceIndices instanceof Uint32Array);
  assert.deepEqual([...parsed.sourceIndices], expected, 'retained preview row maps to the exact original record, with no index compaction after invalid rows');
  assert.equal(parsed.sourceIndices.length, parsed.points.length / STRIDE);
  assert.ok(parsed.sourceIndices.length <= MAX_POINTS);
  assert.deepEqual(parsed.parserMetadata, {
    version: VISUAL_PARSER_VERSION, format, kind, total, retained: expected.length,
    sampleStep: Math.ceil(total / MAX_POINTS), sampled: total > MAX_POINTS, skipped,
    retainedIndexSpace: 'source-vertex-index', representation: kind === 'gaussian-splat' ? 'gaussian-dc-preview' : 'point-cloud',
  });
  assert.equal(parsed.total, total);
  assert.equal(parsed.sampled, total > MAX_POINTS);
  assert.equal(parsed.skipped, skipped);
  assert.equal(parsed.metricVerified, false);
  assert.equal(parsed.collisionGeometry, null);
}

test('ASCII PLY retains exact source membership after uniform sampling and invalid sampled rows', () => {
  const rows = Array.from({ length: sampledTotal }, (_, i) => `${sampledInvalid.has(i) || i === 3 ? 'NaN' : i / 1000} 0 0`);
  const bytes = encode(`ply\nformat ascii 1.0\nelement vertex ${sampledTotal}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${rows.join('\n')}\n`);
  const before = bytes.slice();
  const parsed = parsePLY(bytes.buffer);
  assertMembership(parsed, expectedSampled(), 'ply-ascii');
  assert.equal(parsed.sourceIndices.at(-1), sampledTotal - 3);
  assert.equal(parsed.points[STRIDE], Math.fround(4 / 1000));
  assert.deepEqual(bytes, before, 'parser does not rewrite source bytes');
});

for (const little of [true, false]) test(`binary ${little ? 'little' : 'big'} endian PLY membership tracks original sampled records`, () => {
  const format = little ? 'binary_little_endian' : 'binary_big_endian';
  const header = encode(`ply\nformat ${format} 1.0\nelement vertex ${sampledTotal}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`);
  const buffer = new ArrayBuffer(header.length + sampledTotal * 12), bytes = new Uint8Array(buffer), view = new DataView(buffer);
  bytes.set(header);
  for (let i = 0; i < sampledTotal; i++) view.setFloat32(header.length + i * 12, sampledInvalid.has(i) || i === 3 ? NaN : i / 1000, little);
  const before = bytes.slice();
  assertMembership(parsePLY(buffer), expectedSampled(), `ply-${format}`);
  assert.deepEqual(bytes, before);
});

test('SPLAT membership skips invalid positions and sizes without losing original record IDs', () => {
  const buffer = new ArrayBuffer(sampledTotal * 32), bytes = new Uint8Array(buffer), view = new DataView(buffer);
  for (let i = 0; i < sampledTotal; i++) {
    const at = i * 32;
    view.setFloat32(at, i === 2 || i === 3 ? NaN : i / 1000, true);
    for (let j = 3; j < 6; j++) view.setFloat32(at + j * 4, i === sampledTotal - 1 && j === 4 ? -1 : .02, true);
    bytes.set([120, 130, 140, 255, 255, 128, 128, 128], at + 24);
  }
  const before = bytes.slice();
  assertMembership(parseSplat(buffer), expectedSampled(), 'splat-32', 'gaussian-splat');
  assert.deepEqual(bytes, before);
});

test('Gaussian PLY keeps current-file vertex IDs even when an unrelated source_index property exists', () => {
  const props = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  const rows = ['0 0 0 0 0 0 1 0 0 0 0 0 0 0 987', 'NaN 0 0 0 0 0 1 0 0 0 0 0 0 0 456', '2 0 0 0 0 0 1 0 0 0 0 0 0 0 123'];
  const buffer = encode(`ply\nformat ascii 1.0\nelement vertex 3\n${props.map(p => `property float ${p}`).join('\n')}\nproperty uint source_index\nend_header\n${rows.join('\n')}\n`).buffer;
  assertMembership(parsePLY(buffer), [0, 2], 'ply-ascii', 'gaussian-splat', 3, 1);
});

test('screen rectangle selects clipped sample centres through all depths in setPoints row order', () => {
  const points = visualPoints([[0, 0, .8], [0, 0, -.8], [.8, .8, 0], [0, 0, 1.1], [0, 0, -1.1], [1.1, 0, 0], [0, -1.1, 0]]), before = points.slice();
  const viewport = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(selectVisualRectangle(points, identity(), identity(), { left: 100, top: 60, right: 120, bottom: 80 }, viewport), [0, 1]);
  assert.deepEqual(selectVisualRectangle(points, identity(), identity(), { left: 120, top: 80, right: 100, bottom: 60 }, viewport), [0, 1], 'reverse pointer drag is equivalent');
  assert.deepEqual(selectVisualRectangle(points, identity(), identity(), { left: -100, top: -100, right: 500, bottom: 500 }, viewport), [0, 1, 2], 'screen clipping excludes centres beyond the clip volume');
  assert.deepEqual(selectVisualRectangle(points, identity(), identity(), { left: 300, top: 300, right: 400, bottom: 400 }, viewport), []);
  assert.deepEqual(selectVisualRectangle(points, identity(), identity(), { left: 0, top: 0, right: 500, bottom: 500 }, viewport, { minY: .5, maxY: 1 }), [2]);
  assert.deepEqual(points, before, 'selection does not transform source positions, colours or covariance');
});

test('rectangle projection composes camera matrices and rejects centres behind the camera', () => {
  const view = identity(); view[12] = -1;
  const projection = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0]);
  const points = visualPoints([[1, 0, -2], [1, 0, 2], [2, 0, -2]]);
  assert.deepEqual(selectVisualRectangle(points, view, projection, { left: 45, top: 45, right: 55, bottom: 55 }, { left: 0, top: 0, width: 100, height: 100 }), [0]);
  assert.throws(() => selectVisualRectangle(points, view, projection, { left: NaN, top: 0, right: 10, bottom: 10 }, { left: 0, top: 0, width: 100, height: 100 }), /finite selection/);
  assert.throws(() => selectVisualRectangle(points, view, projection, { left: 0, top: 0, right: 10, bottom: 10 }, { left: 0, top: 0, width: 100, height: 100 }, { minY: 2, maxY: 1 }), /ordered vertical/);
});

function mockViewer(t) {
  const saved = new Map(), callbacks = new Map(), uploads = new Map(); let next = 0, bound = null;
  const define = (key, value) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  let viewer;
  t.after(() => { viewer?.destroy(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  define('document', new EventTarget());
  define('devicePixelRatio', 1);
  define('matchMedia', () => ({ matches: true }));
  define('requestAnimationFrame', callback => { callbacks.set(++next, callback); return next; });
  define('cancelAnimationFrame', id => callbacks.delete(id));
  define('ResizeObserver', class { observe() {} disconnect() {} });
  define('IntersectionObserver', class { observe() {} disconnect() {} });
  const gl = Object.fromEntries(['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'bindVertexArray', 'enableVertexAttribArray', 'vertexAttribPointer', 'vertexAttribDivisor', 'viewport', 'clearColor', 'clear', 'disable', 'enable', 'blendFunc', 'useProgram', 'uniformMatrix4fv', 'uniform2f', 'uniform1f', 'uniform1i', 'drawArraysInstanced', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram'].map(key => [key, () => {}]));
  Object.assign(gl, { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({ id: ++next }), createVertexArray: () => ({}), getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}), bindBuffer: (_target, buffer) => { bound = buffer; }, bufferData: (_target, data) => { uploads.set(bound.id, typeof data === 'number' ? data : data.slice()); } });
  const canvas = Object.assign(new EventTarget(), { style: { touchAction: '' }, width: 200, height: 100, clientHeight: 100, getContext: () => gl, getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }), focus() {}, setPointerCapture() {} });
  viewer = createVisualViewer(canvas);
  return { viewer, canvas, uploads, flush: () => { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(performance.now()); } };
}

test('renderer selection follows original row IDs through depth sorting and clears on replacement', t => {
  const { viewer, uploads, flush } = mockViewer(t), points = visualPoints([[0, 0, 1], [0, 0, -1], [.5, 0, 0]]), before = points.slice();
  viewer.setPoints(points);
  viewer.setSelection(new Uint32Array([0]));
  viewer.setView({ eye: [0, 0, 5], target: [0, 0, 0], fov: 60 });
  const selectedUpload = () => [...uploads.values()].find(value => value instanceof Float32Array && value.length === 3);
  assert.deepEqual([...selectedUpload()], [0, 0, 1], 'selection attribute follows the far-to-near draw order [1, 2, 0]');
  viewer.setView({ eye: [0, 0, -5], target: [0, 0, 0], fov: 60 });
  assert.deepEqual([...selectedUpload()], [1, 0, 0], 'opposite camera reverses depth order but still highlights source row zero');
  assert.deepEqual(viewer.selectRectangle({ left: 108, top: 68, right: 112, bottom: 72 }), [0, 1], 'rectangle membership stays in setPoints order, independent of draw sorting');
  assert.deepEqual(viewer.getBounds().min, [0, 0, -1]);
  assert.deepEqual(points, before);
  assert.throws(() => viewer.setSelection([3]), /outside/);
  viewer.setPoints(points); flush();
  assert.deepEqual([...selectedUpload()], [0, 0, 0]);
  viewer.clear(); flush(); assert.equal(viewer.getBounds(), null);
});
