import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateStereoDepth, exportStereoPly, maxStereoDisparity } from '../../brainsnn-r3f-app/public/world/stereo-depth-data.mjs';
import { parsePLY, STRIDE } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const width = 120, height = 54;
const baseline = {fx: 60, fy: 62, cxLeft: 58, cxRight: 58, cy: 25, baselineMeters: 0.2};
const options = {minDisparity: 1, maxDisparity: 40, sampleStep: 3};
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} versus ${expected}`);

function scenePixel(x, y) {
  const bits = Math.imul(x * 8191 + y * 41377 + 1937, 0x45d9f3b);
  const value = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  return [value & 255, value >>> 8 & 255, value >>> 16 & 255];
}

function pair(rawDisparity, color = scenePixel) {
  const left = new Uint8ClampedArray(width * height * 4), right = new Uint8ClampedArray(left.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    left.set([...color(x, y), 255], i);
    right.set([...color(x + rawDisparity, y), 255], i);
  }
  return {left, right, width, height};
}

test('authored rectified correspondence yields analytical depth, camera axes and original left colour', async () => {
  const source = pair(6);
  const progress = [];
  const result = await estimateStereoDepth({...source, calibration: baseline, options, onProgress: event => progress.push(event)});
  assert.ok(result.stats.accepted > 450);
  assert.equal(result.points.length, result.samples.length * STRIDE);
  assert.equal(result.stats.accepted + Object.values(result.stats.rejected).reduce((sum, n) => sum + n), result.stats.tested);
  assert.equal(progress[0].completedRows, 0);
  assert.equal(progress.at(-1).completedRows, progress.at(-1).totalRows);
  for (const [i, sample] of result.samples.entries()) {
    const at = i * STRIDE;
    near(sample.rawDisparity, 6);
    near(sample.depthMeters, 2);
    near(result.points[at], (sample.x - baseline.cxLeft) * 2 / baseline.fx);
    near(result.points[at + 1], -(sample.y - baseline.cy) * 2 / baseline.fy);
    near(result.points[at + 2], -2);
    [...result.points.subarray(at + 6, at + 9)].forEach((value, channel) => {
      assert.equal(Math.round(value * 255), source.left[(sample.y * width + sample.x) * 4 + channel]);
    });
  }
  const exported = exportStereoPly(result);
  assert.match(exported, /scale depends on the supplied calibration/);
  const cloud = parsePLY(new TextEncoder().encode(exported).buffer);
  assert.equal(cloud.kind, 'point-cloud');
  assert.equal(cloud.total, result.stats.accepted);
  near(cloud.points[2], -2);
});

test('principal point difference is removed before depth, including negative raw disparity', async () => {
  const calibration = {...baseline, cxLeft: 51, cxRight: 60};
  const result = await estimateStereoDepth({...pair(-3), calibration, options});
  assert.ok(result.stats.accepted > 450);
  for (const sample of result.samples) {
    near(sample.rawDisparity, -3);
    near(sample.disparity, 6);
    near(sample.depthMeters, 2);
  }
});

test('default search covers close objects above 64 pixels and shares the raster bound', async () => {
  const shift = 78;
  const result = await estimateStereoDepth({...pair(shift), calibration: baseline});
  assert.equal(maxStereoDisparity(width), 111);
  assert.equal(maxStereoDisparity(960), 192);
  assert.ok(result.stats.accepted >= 40);
  for (const sample of result.samples) {
    near(sample.rawDisparity, shift);
    near(sample.depthMeters, 12 / shift);
  }
});

test('featureless and periodic patterns do not produce confident depth', async () => {
  const flat = await estimateStereoDepth({...pair(8, () => [80, 80, 80]), calibration: baseline, options});
  assert.equal(flat.stats.accepted, 0);
  assert.equal(flat.stats.rejected.texture, flat.stats.tested);
  const repeated = await estimateStereoDepth({...pair(8, (x, y) => scenePixel(x % 5, y)), calibration: baseline, options});
  assert.equal(repeated.stats.accepted, 0);
  assert.ok(repeated.stats.rejected.ambiguous > repeated.stats.tested * 0.8);
});

test('reverse match rejects duplicated foreground and alpha holes instead of fabricating depth', async () => {
  const source = pair(8);
  for (let y = 0; y < height; y++) for (let x = 48; x <= 64; x++) {
    const i = (y * width + x) * 4;
    const from = i - 16 * 4;
    source.left.set(source.left.subarray(from, from + 4), i);
  }
  for (let y = 0; y < height; y++) for (let x = 75; x <= 90; x++) source.right[(y * width + x) * 4 + 3] = 0;
  const result = await estimateStereoDepth({...source, calibration: baseline, options: {...options, sampleStep: 2}});
  assert.ok(result.stats.accepted > 500);
  assert.ok(result.stats.rejected.occlusion > 0);
  assert.equal(result.samples.some(({x}) => x === 39 || x === 55 || (x >= 84 && x <= 95)), false);
});

test('cancellation and invalid geometry fail closed', async () => {
  const controller = new AbortController();
  const job = estimateStereoDepth({...pair(6), calibration: baseline, options, signal: controller.signal,
    onProgress({completedRows}) { if (completedRows === 1) controller.abort(); }});
  await assert.rejects(job, {name: 'AbortError'});
  await assert.rejects(estimateStereoDepth({...pair(6), calibration: {...baseline, baselineMeters: 0}}), /positive camera baseline/);
  await assert.rejects(estimateStereoDepth({...pair(6), calibration: baseline, options: {minDisparity: 8, maxDisparity: 9}}), /disparity bounds/);
  await assert.rejects(estimateStereoDepth({...pair(6), calibration: baseline, height: 0}), /rectified image rasters/);
  assert.throws(() => exportStereoPly({points: new Float32Array()}), /before exporting/);
});
