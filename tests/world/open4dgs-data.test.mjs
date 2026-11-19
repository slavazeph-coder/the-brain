import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpen4DGSSequence, openOpen4DGSTrigs, parseOpen4DGSMetadata,
} from '../../brainsnn-r3f-app/public/world/open4dgs-data.mjs';
import { STRIDE } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const authoredMeta = {fps: 30000 / 1001, start_frame: 11, n_frames: 2, per_frame_counts: [1, 1], source_checkpoint: '/local/trigs.pt'};
const gaussianProps = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} differs from ${expected}`);

function ply(frame, x, gaussian = true) {
  const properties = gaussian ? gaussianProps : gaussianProps.slice(0, 3);
  const header = ['ply', 'format binary_little_endian 1.0', 'element vertex 1',
    ...properties.map(name => `property float ${name}`), 'end_header', ''].join('\n');
  const values = [x, 0, 0, 0.8, 0, 0, 0, -1, -2, -3, 0.5, 0.5, 0.5, 0.5];
  const binary = new DataView(new ArrayBuffer(properties.length * 4));
  values.slice(0, properties.length).forEach((value, i) => binary.setFloat32(4 * i, value, true));
  return new File([header, binary.buffer], `frame_${String(frame).padStart(6, '0')}.ply`);
}

test('official export metadata orders PLY files by their original number and preserves source time and Gaussian appearance', async () => {
  const metadata = parseOpen4DGSMetadata(JSON.stringify(authoredMeta));
  assert.equal(metadata.source_checkpoint, undefined);
  const sequence = createOpen4DGSSequence([ply(12, 5), ply(11, 2)], metadata);
  const [first, second] = await Promise.all([sequence.loadFrame(0), sequence.loadFrame(1)]);
  assert.deepEqual([first.frameNumber, second.frameNumber], [11, 12]);
  assert.deepEqual([first.points[0], second.points[0]], [2, 5]);
  assert.equal(first.timeSeconds, 11 / authoredMeta.fps);
  assert.equal(first.visible, 1);
  near(first.points[3], Math.exp(-1));
  near(first.points[6], 0.5 + 0.28209479177387814 * 0.8);
  assert.deepEqual([...first.points.slice(9)], [0.5, 0.5, 0.5, 0.5, 0.5]);
});

test('rejects missing, duplicate, point-only, and mismatched PLY frames', async () => {
  assert.throws(() => createOpen4DGSSequence([ply(11, 0), ply(11, 0)], authoredMeta), /unique/);
  assert.throws(() => createOpen4DGSSequence([ply(11, 0), ply(13, 0)], authoredMeta), /missing/);
  const bad = createOpen4DGSSequence([ply(11, 0, false), ply(12, 0)], authoredMeta);
  await assert.rejects(bad.loadFrame(0), /full Gaussian/);
  const mismatch = createOpen4DGSSequence([ply(11, 0), ply(12, 0)], {...authoredMeta, per_frame_counts: [2, 1]});
  await assert.rejects(mismatch.loadFrame(0), /different Gaussian count/);
  await assert.rejects(mismatch.loadFrame(2), /outside/);
  assert.throws(() => parseOpen4DGSMetadata(JSON.stringify({...authoredMeta, fps: 0})), /timing/);
});

function nativeFixture(change = () => {}) {
  const alignment = 16, align = n => Math.ceil(n / alignment) * alignment;
  let payloadLength = 0;
  const entries = [], tensorIndex = [];
  function tensor(name, folder, shape, values, dtype = 'float32') {
    const bytes = dtype === 'float32' ? 4 : dtype === 'float16' ? 2 : 1;
    const data = new DataView(new ArrayBuffer(values.length * bytes));
    values.forEach((value, i) => {
      if (dtype === 'float32') data.setFloat32(i * 4, value, true);
      else if (dtype === 'float16') data.setUint16(i * 2, value, true);
      else data.setUint8(i, value);
    });
    const path = `${folder}/${name}.${dtype}`, byteOffset = align(payloadLength), byteLength = data.byteLength;
    const spec = {buffer: 0, path, byteOffset, byteLength, dtype, shape, alignment, storage: 'raw', layout: 'C'};
    entries.push([byteOffset, data.buffer]);
    tensorIndex.push({index: tensorIndex.length, path, byteOffset, byteLength, dtype, shape});
    payloadLength = byteOffset + byteLength;
    return spec;
  }
  function common(folder, centre) {
    return {means: tensor('means', folder, [1, 3], centre), scales: tensor('scales', folder, [1, 3], [0, 0, 0], 'float16'),
      quats: tensor('quats', folder, [1, 4], [1, 0, 0, 0]), opacities: tensor('opacities', folder, [1], [0]),
      sh0: tensor('sh0', folder, [1, 1, 3], [0, 0x3c00, 0], 'float16'), shN: tensor('shN', folder, [1, 0, 3], [])};
  }
  const stationary = {id: 'static_0000', count: 1, shCoeffCount: 0, global: {frameStart: 0, frameEndExclusive: 3},
    tensors: common('static/static_0000', [0, -1, 0])};
  const folder = 'clips/clip_0000/dynamic', vectors = {anchors: [1, 0, 0], zeta_base_r: [0, 0, Math.PI / 2], zeta_base_t: [0, 0, 2]};
  for (const i of [0, 1, 2]) for (const suffix of ['r', 't']) vectors[`zeta_c${i}_${suffix}`] = [0, 0, 0];
  const dynamic = {count: 1, shCoeffCount: 0, tensors: {...common(folder, [2, 0, 0]),
    times: tensor('times', folder, [1], [0]), log_durations: tensor('log_durations', folder, [1], [0]),
    ...Object.fromEntries(Object.entries(vectors).map(([name, values]) => [name, tensor(name, folder, [1, 3], values)]))}};
  const flags = {count: 1, tensors: Object.fromEntries(['is_static', 'dynamic_protect'].map(name =>
    [name, tensor(name, 'clips/clip_0000/flags', [1], [0], 'uint8')]))};
  const frames = {coreFrameStart: 0, coreFrameEndExclusive: 3, activeFrameStart: 0, activeFrameEndExclusive: 3};
  const manifest = {format: 'trigs.runtime', version: 1, createdByVersion: '2026-09-16.runtime-bin-v2',
    source: {kind: 'single-trainer-checkpoint-auto-split'},
    timeline: {frameRate: 2, totalFrames: 3, durationSeconds: 1.5, timeUnit: 'seconds', frameIndexing: 'zero_based_end_exclusive'},
    semantics: {tensorByteOffsets: 'relative_to_payload', quaternionOrder: 'xyzw', dynamicMotionModel: 'trigs.se3_bezier_v1',
      opacityValueDomain: 'logit', scaleValueDomain: 'log', shChannelOrder: 'rgb', dynamicTimesDomain: 'clip-local',
      temporalOpacityMode: 'smooth_cull_renormalized', temporalCullThreshold: 0.05},
    static: stationary, tensorIndex, clips: [{index: 0, global: frames, local: frames,
      training: {globalFrameStart: 0, globalFrameEndExclusive: 3}, render: {frameCount: 3, transitionMode: 'hard_cut', fadeInFrames: 0, fadeOutFrames: 0},
      model: {count: 2, motionModel: 'trigs.se3_bezier_v1'}, dynamic, flags,
      static: {count: 1, storage: 'global', sourceStaticId: stationary.id}}]};
  change(manifest);
  let payloadOffset = 64, manifestLength = 0, encoded;
  for (let i = 0; i < 8; i++) {
    manifest.container = {magic: 'TRIGSBIN', formatVersion: 1, headerBytes: 64, byteOrder: 'little', manifestEncoding: 'utf-8-json',
      alignment, manifestOffset: 64, manifestLength, payloadOffset, payloadLength};
    manifest.buffers = [{index: 0, byteOffset: payloadOffset, byteLength: payloadLength}];
    encoded = new TextEncoder().encode(JSON.stringify(manifest));
    if (encoded.length === manifestLength && payloadOffset === align(64 + manifestLength)) break;
    manifestLength = encoded.length;
    payloadOffset = align(64 + manifestLength);
  }
  const file = new Uint8Array(payloadOffset + payloadLength);
  file.set(new TextEncoder().encode('TRIGSBIN'));
  const view = new DataView(file.buffer);
  view.setUint32(8, 1, true);
  view.setUint32(12, 64, true);
  [64, manifestLength, payloadOffset, payloadLength, alignment].forEach((n, i) => view.setBigUint64(16 + i * 8, BigInt(n), true));
  file.set(encoded, 64);
  for (const [offset, data] of entries) file.set(new Uint8Array(data), payloadOffset + offset);
  return new File([file], 'scene.trigsbin');
}

test('native runtime evaluates anchored SE(3), temporal opacity, quaternion order, and global static rows', async () => {
  const scene = await openOpen4DGSTrigs(nativeFixture());
  assert.equal(scene.formatVersion, 1);
  assert.equal(scene.frameCount, 3);
  const first = await scene.loadFrame(0), last = await scene.loadFrame(2);
  assert.equal(last.timeSeconds, 1);
  assert.equal(last.visible, 2);
  assert.deepEqual([...first.points.subarray(0, STRIDE)], [...last.points.subarray(0, STRIDE)]);
  assert.deepEqual([...first.points.subarray(STRIDE, STRIDE + 3)], [2, 0, 0]);
  const turned = last.points.subarray(STRIDE);
  [1, 1, 2].forEach((value, i) => near(turned[i], value));
  near(turned[7], 0.5 + 0.28209479177387814);
  near(turned[9], 0.5 * (Math.exp(-0.5) - 0.05) / 0.95);
  near(turned[12], Math.SQRT1_2);
  near(turned[13], Math.SQRT1_2);
});

test('native runtime refuses unsupported clips, inconsistent byte ranges, and wrong tensor checksums', async () => {
  await assert.rejects(openOpen4DGSTrigs(nativeFixture(m => m.clips.push(m.clips[0]))), /multiple clips/);
  await assert.rejects(openOpen4DGSTrigs(nativeFixture(m => m.clips[0].dynamic.tensors.means.byteOffset = 0)), /overlap/);
  await assert.rejects(openOpen4DGSTrigs(nativeFixture(m => m.tensorIndex[0].byteLength++)), /index disagrees/);
  await assert.rejects(openOpen4DGSTrigs(nativeFixture(m => m.clips[0].dynamic.tensors.means.sha256 = '0'.repeat(64))), /checksum/);
  const valid = nativeFixture();
  await assert.rejects(openOpen4DGSTrigs(new File([valid.slice(0, valid.size - 1)], valid.name)), /section sizes/);
});
