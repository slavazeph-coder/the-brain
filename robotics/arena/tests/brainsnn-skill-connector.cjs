'use strict';
// Execute the real controller and simulation with a small DOM and mocked HTTP
// transport. Pixel rendering is covered separately by the sensor API fixture.
const { makeEnv } = require('./brainsnn-selection-fixture.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = path.resolve(__dirname, '../dist');
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function env({ sensorAvailable = true, responseAction = { skill: 'wait' } } = {}) {
  const e = makeEnv();
  e.document.handlers = {};
  e.document.body.innerHTML = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  e.$('playground').hidden = false;
  e.$('demo-workspace').hidden = false;
  const requests = [], sensorCalls = [], views = [], intervals = new Map();
  let nextInterval = 0;
  e.ctx.setInterval = callback => { const id = ++nextInterval; intervals.set(id, callback); return id; };
  e.ctx.clearInterval = id => intervals.delete(id);
  e.ctx.AbortController = AbortController;
  e.ctx.performance = { now: () => 100 };
  const createElement = e.document.createElement.bind(e.document);
  e.document.createElement = tag => {
    const element = createElement(tag);
    if (tag.toLowerCase() === 'canvas') element.toDataURL = () => 'data:image/jpeg;base64,FIXED_POLICY_CAMERA';
    return element;
  };
  e.$('world').toDataURL = () => 'data:image/jpeg;base64,SPECTATOR_DO_NOT_SEND';
  e.$('world').setPointerCapture = () => {};
  vm.runInContext(fs.readFileSync(path.join(dir, 'arena-3d.js'), 'utf8'), e.ctx, { filename: 'arena-3d.js' });
  e.ctx.BrainArena3D = {
    ...e.ctx.BrainArena3D,
    render(canvas, state, view) { views.push(clone(view)); return { ok: true }; },
    renderSensor(canvas, state, options) {
      sensorCalls.push({ canvas, frame: state.steps, options: clone(options) });
      return sensorAvailable ? { ok: true, camera: {
        id: 'bounded-tabletop-agentview-v1', eye: [2.7, -3.7, 3.8], target: [0, 0, .42],
        fovY: .76, width: options.width, height: options.height, coordinates: 'z-up', source: 'bounded-demo', overlays: false
      } } : { ok: false, reason: 'webgl-unavailable' };
    }
  };
  e.transport = async () => ({ ok: true, status: 200, json: async () => ({ action: responseAction }) });
  e.ctx.fetch = (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return e.transport(url, options);
  };
  vm.runInContext(fs.readFileSync(path.join(dir, 'app-3d.js'), 'utf8'), e.ctx, { filename: 'app-3d.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'experiment.js'), 'utf8'), e.ctx, { filename: 'experiment.js' });
  return Object.assign(e, { requests, sensorCalls, views, intervals,
    connect(url = 'https://policy.example/act', limit = 30) {
      e.ctx.BrainSNN3DClient.showConnector();
      e.$('policy-url').value = url;
      e.$('policy-call-limit').value = limit;
      e.$('save-policy').click();
    },
    key(code, key) {
      const event = { type: 'keydown', code, key, target: e.document.body, preventDefault() { this.prevented = true; } };
      e.document.dispatchEvent(event);
      return event;
    }
  });
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('actual connector posts fixed sensor pixels and XYZ contract then applies a bounded action', async () => {
  const e = env({ responseAction: { skill: 'move_to', position: [.4, .2, .7] } });
  e.connect();
  e.$('step-live').click();
  await flush();
  assert.equal(e.requests.length, 1);
  const request = e.requests[0], payload = request.body;
  assert.equal(request.url, 'https://policy.example/act');
  assert.equal(request.method, 'POST');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(payload.track, 'high-level-skill-agent');
  assert.equal(payload.sceneVersion, 'brainsnn-kinematic-tabletop-v1');
  assert.deepEqual(payload.workspaceBounds, [[-1.35, 1.35], [-.85, .85], [.08, 1.1]]);
  assert.deepEqual(payload.allowedSkills, ['move_to', 'pick', 'place', 'wait', 'request_help']);
  assert.equal(payload.elapsedSeconds, 0);
  assert.equal(payload.frame, 0);
  assert.equal(payload.observation.camera.image, 'data:image/jpeg;base64,FIXED_POLICY_CAMERA');
  assert.equal(payload.observation.camera.overlays, false);
  assert.deepEqual([payload.observation.camera.width, payload.observation.camera.height], [256, 256]);
  assert.notEqual(e.sensorCalls[0].canvas, e.$('world'));
  const state = e.ctx.BrainSNN3DClient.getState();
  assert.deepEqual(clone(state.robot.target), [.4, .2, .7]);
  assert.equal(state.steps, 1);
  assert.equal(state.time, .1);
  assert.equal(e.$('connection-state').textContent, 'Connected');
});

test('orbiting and zooming spectator never changes camera sent by the connector', async () => {
  const e = env();
  e.connect();
  e.$('step-live').click(); await flush();
  const beforeView = clone(e.views.at(-1));
  e.$('world').dispatch('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 });
  e.$('world').dispatch('pointermove', { clientX: 180, clientY: 80 });
  e.$('world').dispatch('pointerup', {});
  e.$('world').dispatch('wheel', { deltaY: 100, preventDefault() {} });
  assert.notDeepEqual(e.views.at(-1), beforeView);
  e.$('step-live').click(); await flush();
  assert.equal(e.requests.length, 2);
  assert.deepEqual(e.requests[1].body.observation.camera, e.requests[0].body.observation.camera);
  assert.equal(e.requests[1].body.frame, 1);
  assert.equal(e.requests[1].body.elapsedSeconds, .1);
});

test('out-of-bounds and joint-action responses do not advance the bounded scene', async () => {
  for (const [action, message] of [
    [{ skill: 'move_to', position: [1.36, 0, .5] }, 'outside the workspace'],
    [{ skill: 'move_to', position: [0, 0] }, 'three finite XYZ coordinates'],
    [{ skill: 'joint_positions', position: [0, 0, 0] }, 'Joint-action policies need a matched physics adapter']
  ]) {
    const e = env({ responseAction: action });
    e.connect(); e.$('step-live').click(); await flush();
    assert.equal(e.ctx.BrainSNN3DClient.getState().steps, 0);
    assert.equal(e.ctx.BrainSNN3DClient.getState().event, 'endpoint-error');
    assert.ok(e.$('run-status').textContent.includes(message), e.$('run-status').textContent);
  }
});

test('missing sensor WebGL reports a meaningful error before any HTTP request', async () => {
  const e = env({ sensorAvailable: false });
  e.connect(); e.$('step-live').click(); await flush();
  assert.equal(e.requests.length, 0);
  assert.equal(e.ctx.BrainSNN3DClient.getState().steps, 0);
  assert.ok(e.$('run-status').textContent.includes('fixed policy camera is unavailable'));
  assert.ok(e.$('model-status').textContent.includes('Enable WebGL'));
  assert.equal(e.$('connection-state').textContent, 'Check endpoint');
});

test('named arena hides demo keyboard shortcuts and visible demo restores them', () => {
  const e = env();
  e.ctx.BrainSNNExperiment.open({ robotId: 'g1', modelId: 'sonic' });
  assert.equal(e.$('demo-workspace').hidden, true);
  const before = clone(e.ctx.BrainSNN3DClient.getState());
  for (const [code, key] of [['Space', ' '], ['KeyR', 'r'], ['KeyT', 't']]) assert.equal(e.key(code, key).prevented, undefined);
  assert.equal(e.intervals.size, 0);
  assert.equal(e.requests.length, 0);
  assert.deepEqual(clone(e.ctx.BrainSNN3DClient.getState()), before);
  e.ctx.BrainSNNExperiment.showDemo({ challenge: 'starter', run: false });
  assert.equal(e.$('demo-workspace').hidden, false);
  assert.equal(e.key('Space', ' ').prevented, true);
  assert.equal(e.intervals.size, 1);
  e.ctx.BrainSNN3DClient.pause();
});

test('showDemo clears a previously connected endpoint and exports scripted evidence', async () => {
  const e = env();
  e.connect(); e.$('step-live').click(); await flush();
  assert.equal(e.requests.length, 1);
  e.ctx.BrainSNNExperiment.open({ robotId: 'g1', modelId: 'sonic' });
  e.ctx.BrainSNNExperiment.showDemo({ challenge: 'clutter', run: false });
  e.$('step-live').click(); await flush();
  assert.equal(e.requests.length, 1, 'returning to demo cannot silently resume the old endpoint');
  assert.equal(e.ctx.BrainSNN3DClient.getState().steps, 1);
  assert.equal(e.$('model-name').textContent, 'Demo controller');
  e.ctx.BrainSNN3DClient.exportEvidence();
  const report = JSON.parse(e.downloads.at(-1));
  assert.equal(report.controllerKind, 'scripted-demo');
  assert.equal(report.modelEndpointHost, null);
  assert.equal(report.metrics.modelCalls, 0);
  assert.equal(report.actions[0].source, 'scripted-demo');
});

test('an old in-flight endpoint reply cannot change a newly reset demo episode', async () => {
  const e = env();
  let resolve;
  e.transport = () => new Promise(done => { resolve = done; });
  e.connect(); e.$('step-live').click();
  assert.equal(e.requests.length, 1);
  e.ctx.BrainSNNExperiment.showDemo({ challenge: 'starter', run: false });
  const before = clone(e.ctx.BrainSNN3DClient.getState());
  assert.equal(e.requests[0].signal.aborted, true);
  resolve({ ok: true, json: async () => ({ action: { skill: 'move_to', position: [1, 0, .4] } }) });
  await flush();
  assert.deepEqual(clone(e.ctx.BrainSNN3DClient.getState()), before);
  assert.equal(e.$('connection-state').textContent, 'Demo');
});

test('episode request budget is enforced and credential-bearing URLs stay unconnected', async () => {
  const e = env();
  e.connect('https://policy.example/act', 2);
  for (let i = 0; i < 3; i++) { e.$('step-live').click(); await flush(); }
  assert.equal(e.requests.length, 2);
  assert.equal(e.ctx.BrainSNN3DClient.getState().event, 'model-call-budget');
  for (const url of ['http://policy.example/act', 'https://user:secret@policy.example/act', 'https://policy.example/act?key=secret', 'https://policy.example/act#token']) {
    const bad = env(); bad.connect(url);
    assert.equal(bad.$('modal').open, true);
    assert.ok(bad.$('connector-message').textContent.includes('HTTPS endpoint without credentials'));
    bad.$('modal').close(); bad.$('step-live').click(); await flush();
    assert.equal(bad.requests.length, 0);
  }
});

(async () => {
  for (const [name, fn] of cases) {
    try { await fn(); console.log('PASS', name); }
    catch (error) { console.error('FAIL', name, error.stack); process.exitCode = 1; }
  }
})();
