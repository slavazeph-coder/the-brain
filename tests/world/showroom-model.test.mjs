import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createShowroomExample, parseShowroomBundle } from '../../brainsnn-r3f-app/public/world/showroom-model.mjs';

const example = createShowroomExample();

test('one practice room links each view, point set and obstacle to stable IDs', () => {
  assert.equal(example.frames.length, 3);
  assert.ok(example.unknown.length);
  for (const frame of example.frames) {
    assert.ok(frame.camera);
    assert.equal(frame.observations.length, 3);
    for (const observation of frame.observations) {
      assert.ok(example.objects.some(o => o.id === observation.objectId));
      assert.ok(example.points.some(p => p[3] === observation.objectId));
    }
  }
  const result = parseShowroomBundle(JSON.stringify(example));
  result.frames[0].observations[0].box[0] = 99;
  assert.notEqual(createShowroomExample().frames[0].observations[0].box[0], 99);
});

const inside = ([x, z], polygon) =>
  x > polygon[0][0] && x < polygon[2][0] && z > polygon[0][1] && z < polygon[2][1];

test('removing the cart shortens the computed trip to the same destination and preserves unseen floor', () => {
  const { before, after } = example.routes;
  assert.ok(before.meters > after.meters + 2);
  const cart = example.objects.find(o => o.id === example.routes.objectId);
  assert.ok(after.points.some(p => inside(p, cart.polygon)));
  assert.ok(before.points.every(p => !inside(p, cart.polygon)));
  assert.deepEqual(before.points[0], after.points[0]);
  assert.deepEqual(before.points.at(-1), after.points.at(-1));
  for (const path of [before, after]) {
    assert.ok(path.points.every(p => example.unknown.every(u => !inside(p, u))));
    assert.ok(example.points.filter(p => !p[3]).every(p => example.unknown.every(u => !inside(p, u))));
  }
});

test('embedded real images must match their declared dimensions; imports stay local', async () => {
  const bytes = await readFile(new URL('../../brainsnn-r3f-app/public/world/assets/showroom-camera-1.jpg', import.meta.url));
  const bundle = structuredClone(example), frame = bundle.frames[0];
  frame.image = 'data:image/jpeg;base64,' + bytes.toString('base64');
  assert.equal(parseShowroomBundle(bundle).frames[0].image, frame.image);
  frame.width++;
  assert.throws(() => parseShowroomBundle(bundle), /dimensions/i);
  frame.width--;
  for (const image of [
    'https://outside.example/room.jpg', '//outside.example/room.jpg', '/world/assets/../secret.jpg',
    '/world/assets/%2e%2e/secret.jpg', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,' + bytes.toString('base64'),
  ]) {
    frame.image = image;
    assert.throws(() => parseShowroomBundle(bundle), /image|frame/i);
  }
});

test('source movie time survives only with an exact SHA-256 digest and usable timeline', () => {
  const bundle = structuredClone(example);
  bundle.sourceVideo = { sha256: 'ac'.repeat(32), url: 'https://outside.example/video' };
  const parsed = parseShowroomBundle(bundle);
  assert.deepEqual(parsed.sourceVideo, { sha256: 'ac'.repeat(32) });
  bundle.frames[0].timeSeconds = null;
  assert.equal(parseShowroomBundle(bundle).frames[0].timeSeconds, null);
  bundle.frames[2].timeSeconds = bundle.frames[1].timeSeconds;
  assert.throws(() => parseShowroomBundle(bundle), /chronological/i);
  for (const f of bundle.frames) f.timeSeconds = null;
  assert.throws(() => parseShowroomBundle(bundle), /timed frames/i);
  delete bundle.sourceVideo;
  assert.ok(parseShowroomBundle(bundle));
  bundle.frames[0].timeSeconds = 1;
  bundle.sourceVideo = { sha256: 'bad' };
  assert.throws(() => parseShowroomBundle(bundle), /digest/i);
});

test('rejects dangling references, invalid geometry, unsupported units, implausible routes and excess samples', () => {
  const edits = [
    [b => { b.objects[1].id = b.objects[0].id; }, /ID/],
    [b => { b.frames[1].id = b.frames[0].id; }, /ID/],
    [b => { b.frames[0].observations[0].objectId = 'lost'; }, /unknown object/],
    [b => { b.frames[0].observations[0].box = [.9, 0, .1, 1]; }, /box/],
    [b => { b.frames[0].camera = [NaN, 0]; }, /coordinate/],
    [b => { b.points[0][3] = 'lost'; }, /unknown object/],
    [b => { b.objects[0].polygon = [[1, 1], [2, 2], [3, 3]]; }, /area/],
    [b => { b.units = 'ft'; }, /metres/],
    [b => { b.unknown[0][0] = [-10, 0]; }, /floor X/],
    [b => { b.routes.before.meters = 900; }, /disagrees/],
    [b => { b.routes.after.points.reverse(); }, /start and destination/],
    [b => { b.points = new Array(40_001); }, /cloud points/],
  ];
  for (const [edit, error] of edits) {
    const bundle = structuredClone(example);
    edit(bundle);
    assert.throws(() => parseShowroomBundle(bundle), error);
  }
});

test('secondary object comparisons are independently bounded, labeled and validated', () => {
  const bundle = structuredClone(example);
  bundle.routes.label = 'First rehearsal';
  bundle.comparisons = [{ ...bundle.routes, objectId: 'shelf', label: 'Second rehearsal' }];
  assert.equal(parseShowroomBundle(bundle).comparisons[0].label, 'Second rehearsal');
  bundle.comparisons.push(bundle.routes);
  assert.throws(() => parseShowroomBundle(bundle), /different object/);
  bundle.comparisons.pop();
  bundle.comparisons[0].after = { meters: 100, points: [[1, 1], [2, 1]] };
  assert.throws(() => parseShowroomBundle(bundle), /disagrees/);
});
