'use strict';
// Mocked WebGL checks the sensor observation contract, not GPU visual fidelity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { console, devicePixelRatio: 3 };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/arena-3d.js'), 'utf8'), context);
const arena = context.BrainArena3D;
const plain = value => JSON.parse(JSON.stringify(value));

function canvasFixture() {
  const draws = [];
  const uniforms = {};
  const gl = new Proxy({
    draws, uniforms,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_, name) => name,
    getAttribLocation: (_, name) => name,
    createProgram: () => ({}), createShader: () => ({}), createBuffer: () => ({}),
    uniform3fv: (name, value) => { uniforms[name] = Array.from(value); },
    uniform4fv: (name, value) => { uniforms[name] = Array.from(value); },
    uniform1f: (name, value) => { uniforms[name] = value; },
    uniformMatrix3fv: (name, _, value) => { uniforms[name] = Array.from(value); },
    uniformMatrix4fv: (name, _, value) => { uniforms[name] = Array.from(value); },
    drawArrays: () => { draws.push(plain(uniforms)); },
  }, { get(target, key) {
    if (key in target) return target[key];
    return /^[A-Z_]+$/.test(key) ? key : () => {};
  } });
  const canvas = { width: 800, height: 500, clientWidth: 1111, clientHeight: 777,
    getContext: type => type === 'webgl' ? gl : null };
  return { canvas, gl, draws, clear: () => { draws.length = 0; } };
}

const sensor = canvasFixture(), spectator = canvasFixture();
const scene = arena.create(42, { challenge: 'clutter' });
const initial = JSON.stringify(scene);
const result = arena.renderSensor(sensor.canvas, scene);
assert.equal(result.ok, true);
assert.deepEqual([sensor.canvas.width, sensor.canvas.height], [256, 256], 'sensor pixels ignore CSS and DPR');
assert.equal(result.camera.id, 'bounded-tabletop-agentview-v1');
assert.equal(result.camera.overlays, false);
assert.equal(result.camera.source, 'bounded-demo');
const originalDraws = plain(sensor.draws);
assert.ok(originalDraws.length > 50, 'rendered scene reaches the draw contract');

arena.render(spectator.canvas, scene, { yaw: 2.1, pitch: 1.2, distance: 2.4, showTrail: true, renderTime: 30 });
assert.equal(spectator.canvas.width, 2222, 'spectator retains responsive pixel sizing');
sensor.clear();
arena.renderSensor(sensor.canvas, scene, { yaw: -3, pitch: .1, distance: 9, showTrail: true, renderTime: 90 });
assert.deepEqual(sensor.draws, originalDraws, 'orbit, trail and wall clock cannot change policy observations');
assert.equal(JSON.stringify(scene), initial, 'rendering must not mutate the scene');

scene.robot.target = [1.25, -.7, .9];
scene.trace.push({ time: 1, position: [1, 1, 1], event: 'spectator-only' });
sensor.clear();
arena.renderSensor(sensor.canvas, scene);
assert.deepEqual(sensor.draws, originalDraws, 'command target and spectator path are absent from the sensor image');

result.camera.eye[0] = -100;
result.camera.target[2] = 100;
const repeated = arena.renderSensor(sensor.canvas, scene, { width: 320, height: 240 });
assert.deepEqual(plain(repeated.camera.eye), [2.7, -3.7, 3.8], 'returned metadata cannot mutate camera calibration');
assert.deepEqual(plain(repeated.camera.target), [0, 0, .42]);
assert.deepEqual([sensor.canvas.width, sensor.canvas.height], [320, 240]);

for (const options of [{ width: 0 }, { height: Infinity }, { width: '256' }, { width: 256.5 }, { height: 2049 }]) {
  assert.equal(arena.renderSensor(sensor.canvas, scene, options).reason, 'invalid-sensor-size');
}
assert.equal(arena.renderSensor({ getContext: () => null }, scene).reason, 'webgl-unavailable');
assert.equal(arena.renderSensor({ getContext: () => { throw new Error('Context lost'); } }, scene).reason, 'webgl-error');
console.log('PASS sensor contract: fixed pixels/camera, observer isolation, no scene mutation, no overlays, immutable metadata, validation and fallback');
