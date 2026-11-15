import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraPose, capturePath, viewAt, orbitAngles, pathLength} from '../../brainsnn-r3f-app/public/world/capture-path.mjs';

const pose = (x, y, z, yawDeg = 0) => {
  const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // camera_to_world_y_up with local -z forward; a yaw about y turns the forward in the x–z plane
  return [[c, 0, s, x], [0, 1, 0, y], [-s, 0, c, z], [0, 0, 0, 1]];
};

test('cameraPose: eye from the translation, forward from local -z, rigid rows only', () => {
  const p = cameraPose(pose(1, 1.4, 2));
  assert.deepEqual(p.eye, [1, 1.4, 2]);
  assert.ok(Math.abs(p.forward[2] + 1) < 1e-9 && Math.abs(p.forward[0]) < 1e-9);
  const turned = cameraPose(pose(0, 0, 0, 90));
  assert.ok(Math.abs(turned.forward[0] + 1) < 1e-9, JSON.stringify(turned.forward));  // 90° about y: -z becomes -x
  assert.equal(cameraPose([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 2]]), null);
  assert.equal(cameraPose([[1, 0, 0, NaN], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]), null);
  assert.equal(cameraPose('nope'), null);
});

test('capturePath and viewAt interpolate between cameras; pathLength sums the walk', () => {
  const path = capturePath({cameras: [{camera_to_world_y_up: pose(0, 1.4, 0)}, {view: 1}, {camera_to_world_y_up: pose(2, 1.4, 0, 90)}]});
  assert.equal(path.length, 2);
  const mid = viewAt(path, 0.5);
  assert.deepEqual(mid.eye, [1, 1.4, 0]);
  assert.ok(Math.abs(Math.hypot(...mid.forward) - 1) < 1e-9 && mid.forward[0] < 0 && mid.forward[2] < 0);
  assert.equal(viewAt(path, 99).index, 1);
  assert.equal(viewAt([], 0), null);
  assert.equal(pathLength(path), 2);
});

test('orbitAngles reproduce the forward direction in the viewer convention', () => {
  for (const f of [[0, 0, -1], [1, 0, 0], [0.3, -0.4, 0.5]]) {
    const n = Math.hypot(...f), u = f.map(v => v / n), {yaw, pitch} = orbitAngles(u);
    const back = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    back.forEach((v, i) => assert.ok(Math.abs(v + u[i]) < 1e-9, `${f}`));
  }
});
