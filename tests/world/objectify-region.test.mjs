import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestObjectRegion } from '../../brainsnn-r3f-app/public/world/objectify-region.mjs';
import { STRIDE } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const coral = [.82, .41, .29], blue = [.22, .46, .75];
const sample = (x, y, z, colour = coral, opacity = 1) => [x, y, z, .04, .04, .04, ...colour, opacity, 0, 0, 0, 1];
const pack = records => Float32Array.from(records.flat());

test('a tap grows along nearby surfaces and leaves distant or differently coloured surfaces out', () => {
  const chair = [];
  for (let i = 0; i < 11; i++) for (let j = 0; j < 9; j++) {
    chair.push(sample(i * .075, .75, j * .075));
    if (j) chair.push(sample(i * .075, .75 + j * .075, 0, [.78, .39, .28]));
  }
  const nearWall = Array.from({ length: 11 }, (_, i) => sample(i * .075, .75, -.075, blue));
  const otherChair = chair.map(([x, y, z]) => sample(x + 2, y, z));
  const scene = pack([...chair, ...nearWall, ...otherChair, sample(-2, 0, 0, blue), sample(4, 0, 0, blue)]);
  const result = suggestObjectRegion(scene, 1);
  assert.deepEqual(result.indices, Array.from({ length: chair.length }, (_, index) => index));
  assert.equal(result.limited, false);
});

test('height, existing group ownership and low opacity filter both membership and seeds', () => {
  const scene = pack([
    sample(0, 1, 0), sample(.08, 1, 0), sample(.16, 1, 0),
    sample(0, .93, 0), sample(0, 1, .08, coral, .001), sample(0, 1, .17), sample(2, 0, 1, blue),
  ]);
  const options = { minY: .98, maxY: 1.1, excluded: new Set([2]) };
  assert.deepEqual(suggestObjectRegion(scene, 0, options).indices, [0, 1, 5]);
  for (const seed of [2, 3, 4]) assert.deepEqual(suggestObjectRegion(scene, seed, options).indices, []);
  assert.throws(() => suggestObjectRegion(scene, 0, { minY: 3, maxY: 1 }), /ordered vertical/);
  assert.throws(() => suggestObjectRegion(scene, 7), /Pick a retained sample/);
  assert.throws(() => suggestObjectRegion(new Float32Array(STRIDE + 1), 0), /bounded buffer/);
});

test('a densely overlapping region remains bounded and deterministic', () => {
  const scene = new Float32Array(20_002 * STRIDE);
  scene.set(sample(.05, 0, 0), 20_000 * STRIDE);
  scene.set(sample(1, 0, 0, blue), 20_001 * STRIDE);
  const row = sample(0, 0, 0);
  for (let index = 0; index < 20_000; index++) scene.set(row, index * STRIDE);
  const first = suggestObjectRegion(scene, 0);
  assert.equal(first.indices.length, 12_000);
  assert.equal(first.limited, true);
  assert.equal(new Set(first.indices).size, first.indices.length);
  assert.equal(first.indices[0], 0);
  assert.deepEqual(suggestObjectRegion(scene, 0), first);
});
