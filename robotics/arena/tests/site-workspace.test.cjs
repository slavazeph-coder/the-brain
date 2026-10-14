'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeEnv } = require('./brainsnn-selection-fixture.cjs');
const base = path.resolve(__dirname, '../dist');
const clone = value => JSON.parse(JSON.stringify(value));
const g1 = { robotId: 'g1', modelId: 'groot', task: 'Supported reach', seed: '42', view: 'site' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function setup(selection = g1) {
  const e = makeEnv();
  // Extend this environment's DOM prototype only. These browser behaviors are
  // needed by the real controller; renderer/WebGL is the sole UI boundary stub.
  const proto = Object.getPrototypeOf(e.document.body);
  proto.contains = function (node) { for (let n = node; n; n = n.parentElement) if (n === this) return true; return false; };
  proto.pause = function () {};
  Object.defineProperty(proto, 'checked', { get() { return this._checked ?? this.hasAttribute('checked'); }, set(value) { this._checked = Boolean(value); } });
  const frames = new Map(), timers = new Map(), renderCalls = [], requests = [], downloadAnchors = [];
  const originalClick = proto.click;
  proto.click = function () { if (this.tagName === 'A' && this.download) downloadAnchors.push({ href: this.href, name: this.download }); return originalClick.call(this); };
  let nextId = 1, clock = 1000, rendererOptions;
  e.ctx.requestAnimationFrame = fn => { const id = nextId++; frames.set(id, fn); return id; };
  e.ctx.cancelAnimationFrame = id => frames.delete(id);
  e.ctx.setTimeout = (fn, delay) => { const id = nextId++; timers.set(id, { fn, delay }); return id; };
  e.ctx.clearTimeout = id => timers.delete(id);
  e.ctx.AbortController = AbortController;
  e.ctx.DOMException = DOMException;
  e.ctx.TextDecoder = TextDecoder; e.ctx.TextEncoder = TextEncoder;
  e.ctx.Uint8Array = Uint8Array; e.ctx.ArrayBuffer = ArrayBuffer;
  e.ctx.File = class File { constructor(parts, name, options = {}) { this.name = name; this.type = options.type || ''; this.content = parts.join(''); this.size = this.content.length; } text() { return Promise.resolve(this.content); } };
  e.ctx.fetch = async (url, options) => { requests.push({ url, options }); throw new Error('Unexpected network request: ' + url); };
  const renderer = {};
  for (const name of ['setScene', 'setRobot', 'setMode', 'setCamera', 'setTrace', 'setAssetTransform', 'clearAsset', 'dispose']) renderer[name] = (...args) => renderCalls.push({ name, args: clone(args) });
  renderer.setPointCloud = cloud => { renderCalls.push({ name: 'setPointCloud', args: [clone(cloud)] }); return { pointCount: cloud.positions.length / 3, visualOnly: true }; };
  renderer.importAsset = async file => ({ name: file.name, visualOnly: true });
  e.ctx.BrainSNNSiteRenderer = { create(_host, options) { rendererOptions = options; return renderer; } };
  for (const name of ['site-core.js', 'site-workspace.js']) vm.runInContext(fs.readFileSync(path.join(base, name), 'utf8'), e.ctx, { filename: name });
  const root = e.document.createElement('div'); root.setAttribute('id', 'test-site-root'); e.document.body.appendChild(root);
  const api = e.ctx.BrainSNNSiteWorkspace;
  api.mount(root, selection);
  return Object.assign(e, {
    root, api, requests, renderCalls, frames, timers, downloadAnchors,
    state: () => clone(api.getState()),
    el(id) { const node = root.querySelector('#' + id); assert(node, 'Missing #' + id); return node; },
    click(selector) { const node = root.querySelector(selector); assert(node, 'Missing ' + selector); node.click(); },
    action(name) { this.click('[data-site-action="' + name + '"]'); },
    step(name) { this.click('[data-site-step="' + name + '"]'); },
    change(id, value) { const node = this.el(id); node.value = value; node.dispatch('change'); },
    file(id, file) { const node = this.el(id); node.files = [file]; node.dispatch('change'); },
    pick(point) { rendererOptions.onPick(point); },
    selectObstacle(id) { rendererOptions.onSelect(id); },
    frame(delta = 100) { clock += delta; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(clock)); },
    async timer(delay) { const entry = [...timers].find(([, timer]) => timer.delay === delay); assert(entry, 'Missing timer ' + delay); timers.delete(entry[0]); await entry[1].fn(); await flush(); },
    jsonFile(value, name = 'site.json') { return new e.ctx.File([JSON.stringify(value)], name, { type: 'application/json' }); },
    respond(handler) { e.ctx.fetch = async (url, options) => { requests.push({ url, options }); return handler(url, options); }; },
    async connect(url = 'https://scan-worker.example', token = 'private-test-token-do-not-export') {
      this.step('capture'); this.el('site-worker-url').value = url; this.el('site-worker-token').value = token;
      this.el('site-worker-form').dispatch('submit'); await flush();
    }
  });
}
function bytesResponse(text, type = 'application/octet-stream', status = 200) {
  const bytes = new TextEncoder().encode(text);
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get(name) { return name.toLowerCase() === 'content-length' ? String(bytes.length) : name.toLowerCase() === 'content-type' ? type : null; } },
    body: { getReader() { let read = false; return { async read() { if (read) return { done: true }; read = true; return { done: false, value: bytes }; }, async cancel() {}, releaseLock() {} }; } },
    json: async () => JSON.parse(text), text: async () => text, arrayBuffer: async () => bytes.buffer,
  };
}
const response = (data, status = 200) => bytesResponse(JSON.stringify(data), 'application/json', status);
const capabilities = { version: 1, available: true, acceptedTypes: ['video/mp4', 'application/zip'], maxUploadBytes: 1024 * 1024 };

test('G1 + GR00T remain selected while the actual path is labelled as a planning proxy', () => {
  const e = setup();
  assert.deepEqual(e.state().selection, { robotId: 'g1', modelId: 'groot', task: 'Supported reach', seed: '42' });
  assert.equal(e.state().policyExecuted, false);
  assert.match(e.el('site-canvas-model').textContent, /no policy execution/);
  assert.match(e.root.textContent, /not executed/);
  assert.equal(e.renderCalls.find(call => call.name === 'setRobot').args[0].kind, 'humanoid');
  e.change('site-proxy', 'cleaner');
  assert.equal(e.state().selection.robotId, 'g1'); assert.equal(e.state().selection.modelId, 'groot');
  assert.equal(e.state().proxy, 'cleaner'); assert.equal(e.state().policyExecuted, false);
});

test('run, pause, scrub, resume and reset operate on the real bounded planner trace', async () => {
  const e = setup(); e.action('run'); await flush();
  const planned = e.state();
  assert.equal(planned.running, true); assert.equal(planned.result.status, 'complete');
  assert(planned.result.trace.length > 1); assert.equal(planned.policyExecuted, false);
  e.frame(); e.frame(); e.frame();
  assert(e.state().cursor > 0); assert.match(e.el('site-run').textContent, /Pause/);
  e.action('run'); const paused = e.state().cursor; assert.equal(e.state().running, false);
  e.frame(); assert.equal(e.state().cursor, paused);
  const target = Math.floor(planned.result.trace.length / 2);
  e.el('site-scrubber').value = String(target); e.el('site-scrubber').dispatch('input');
  assert.equal(e.state().cursor, target); assert.equal(e.state().running, false);
  assert.equal(e.renderCalls.at(-1).name, 'setTrace'); assert.equal(e.renderCalls.at(-1).args[1], target);
  e.action('run'); assert.equal(e.state().running, true);
  e.action('reset'); assert.equal(e.state().running, false); assert.equal(e.state().cursor, 0);
  assert.deepEqual(e.state().result, planned.result);
});

test('moving a real obstacle invalidates the report and clears the rendered route', async () => {
  const e = setup(); e.action('run'); await flush(); e.action('run');
  assert.equal(e.el('site-export-report').disabled, false);
  const id = e.state().scene.obstacles[0].id; e.selectObstacle(id);
  e.change('site-obstacle-x', 4.2);
  assert.equal(e.state().scene.obstacles[0].x, 4.2);
  assert.equal(e.state().result, null); assert.equal(e.state().running, false);
  assert(e.renderCalls.some(call => call.name === 'setTrace' && call.args[0].length === 0));
  e.step('test'); assert.equal(e.el('site-export-report').disabled, true);
  e.action('export-report'); assert.equal(e.downloads.length, 0);
});

test('measured robot speed invalidates the estimate and changes the next route timing', async () => {
  const e = setup(); e.action('run'); await flush(); e.action('run'); const initial = e.state().result;
  const initialSpeed = Number(e.el('site-body-speed').value);
  e.change('site-body-speed', initialSpeed / 2);
  assert.equal(e.state().result, null); assert.equal(e.state().selection.robotId, 'g1');
  e.action('run'); await flush(); const next = e.state().result;
  assert.equal(next.metrics.distance, initial.metrics.distance);
  assert.equal(next.metrics.durationSeconds, initial.metrics.durationSeconds * 2);
  assert.equal(e.state().policyExecuted, false);
});

test('resizing requires measured-scale confirmation and blocks execution until reviewed', async () => {
  const e = setup(); e.action('run'); await flush(); e.step('review'); e.change('site-width', 18);
  assert.equal(e.state().scene.width, 18); assert.equal(e.state().scene.scaleConfirmed, false);
  assert.equal(e.state().result, null); assert.equal(e.el('site-run').disabled, true);
  e.action('run'); assert.equal(e.state().result, null);
  e.el('site-scale-confirmed').checked = true; e.el('site-scale-confirmed').dispatch('change');
  assert.equal(e.el('site-run').disabled, false); e.action('run'); await flush();
  assert.equal(e.state().result.status, 'complete');
});

test('new map and blocker placement update actual geometry without changing Arena selection', () => {
  const e = setup(); e.step('capture'); e.action('new-map');
  assert.equal(e.state().scene.source.kind, 'manual'); assert.equal(e.state().scene.scaleConfirmed, false);
  e.click('[data-site-place="obstacle"]'); e.pick([3, 4]);
  assert.equal(e.state().scene.obstacles.length, 1);
  assert.equal(e.state().scene.obstacles[0].x, 3); assert.equal(e.state().scene.obstacles[0].z, 4);
  assert.equal(e.state().placement, ''); assert.equal(e.state().selection.modelId, 'groot');
});

test('floor-map JSON imports real geometry, strips unknown fields and always clears scale confirmation', async () => {
  const e = setup(); const incoming = e.state().scene;
  incoming.name = 'Measured customer floor'; incoming.obstacles = []; incoming.secretToken = 'must-not-survive';
  e.step('capture'); e.file('site-map-input', e.jsonFile({ scene: incoming })); await flush();
  assert.equal(e.state().scene.name, 'Measured customer floor'); assert.equal(e.state().scene.obstacles.length, 0);
  assert.equal(e.state().scene.scaleConfirmed, false); assert.equal(e.state().scene.secretToken, undefined);
  assert.equal(e.state().step, 'review'); assert.equal(e.el('site-run').disabled, true);
});

test('invalid and oversized JSON imports preserve the previous usable map', async () => {
  const e = setup(); const original = e.state().scene; e.step('capture');
  e.file('site-map-input', new e.ctx.File(['{invalid'], 'bad.json')); await flush();
  assert.deepEqual(e.state().scene, original); assert.match(e.el('site-status').textContent, /Map import:/);
  e.file('site-map-input', { size: 2 * 1024 * 1024 + 1, text() { throw Error('Oversize map must not be read'); } }); await flush();
  assert.deepEqual(e.state().scene, original); assert.match(e.el('site-status').textContent, /2 MB/);
  e.file('site-map-input', e.jsonFile({ scene: { ...original, width: -2 } })); await flush();
  assert.deepEqual(e.state().scene, original); assert.match(e.el('site-status').textContent, /width/);
});

test('an import finishing after leaving and remounting cannot replace the current map', async () => {
  const e = setup(), pending = deferred(), original = e.state().scene; e.step('capture');
  e.file('site-map-input', { size: 100, text: () => pending.promise });
  e.api.suspend(); e.api.mount(e.root, g1);
  pending.resolve(JSON.stringify({ ...original, name: 'Stale old upload' })); await flush();
  assert.deepEqual(e.state().scene, original);
});

test('a slow earlier JSON upload cannot overwrite a newer successful upload', async () => {
  const e = setup(), pending = deferred(), initial = e.state().scene; e.step('capture');
  e.file('site-map-input', { size: 100, text: () => pending.promise });
  e.file('site-map-input', e.jsonFile({ ...initial, name: 'Newest map' })); await flush();
  pending.resolve(JSON.stringify({ ...initial, name: 'Old slow map' })); await flush();
  assert.equal(e.state().scene.name, 'Newest map');
});

test('a stale failed import cannot replace the status of a newer map', async () => {
  const e = setup(), pending = deferred(), initial = e.state().scene; e.step('capture');
  e.file('site-map-input', { size: 100, text: () => pending.promise });
  e.file('site-map-input', e.jsonFile({ ...initial, name: 'Reviewed new map' })); await flush();
  const status = e.el('site-status').textContent;
  pending.reject(new Error('Old file is unreadable')); await flush();
  assert.equal(e.el('site-status').textContent, status); assert.equal(e.state().scene.name, 'Reviewed new map');
});

test('selection changes invalidate evidence but retain reviewed geometry and stop playback', async () => {
  const e = setup(); e.action('run'); await flush(); const previous = e.state().scene;
  e.api.updateSelection({ ...g1, seed: '900', task: 'New task' });
  assert.deepEqual(e.state().scene, previous); assert.equal(e.state().result, null);
  assert.equal(e.state().running, false); assert.equal(e.state().selection.seed, '900');
  assert.equal(e.state().policyExecuted, false);
});

test('suspending pauses playback, aborts owned requests and disposes the renderer', async () => {
  const e = setup(); e.action('run'); await flush(); e.frame();
  const pending = deferred(); e.respond((_url, options) => { options.signal.addEventListener('abort', () => pending.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); return pending.promise; });
  e.step('capture'); e.el('site-worker-url').value = 'https://scan-worker.example'; e.el('site-worker-token').value = 'token'; e.el('site-worker-form').dispatch('submit');
  e.api.suspend(); await flush();
  assert.equal(e.state().running, false); assert.equal(e.frames.size, 0);
  assert.equal(e.requests[0].options.signal.aborted, true);
  assert.equal(e.renderCalls.at(-1).name, 'dispose');
});

test('worker credentials stay out of route reports, scenario exports, public state and persisted maps', async () => {
  const e = setup(); const url = 'https://private-worker.example', token = 'super-private-token-123';
  e.respond(() => response(capabilities)); await e.connect(url, token);
  assert.equal(e.state().workerConnected, true);
  e.step('test'); e.action('run'); await flush(); e.action('run'); e.action('export-report'); e.action('export-scene');
  assert.equal(e.downloads.length, 2);
  const report = JSON.parse(e.downloads[0]);
  assert.equal(report.execution.policyExecuted, false); assert.equal(report.execution.physicsValidated, false);
  assert.equal(report.selected.robotId, 'g1'); assert.equal(report.selected.modelId, 'groot'); assert.equal(report.selected.seed, '42');
  for (const output of [...e.downloads, JSON.stringify(e.state()), ...e.storageRecords.values()]) {
    assert(!output.includes(url)); assert(!output.includes(token));
  }
});

test('unsafe worker URLs and incompatible protocols make no upload possible', async () => {
  const e = setup(); e.respond(() => response(capabilities));
  for (const url of ['http://remote-worker.example', 'https://user:pass@worker.example', 'https://worker.example?token=abc', 'https://worker.example/#secret']) {
    await e.connect(url); assert.equal(e.state().workerConnected, false);
  }
  assert.equal(e.requests.length, 0);
  e.respond(() => response({ version: 9, available: true })); await e.connect();
  assert.equal(e.state().workerConnected, false); assert.match(e.el('site-worker-status').textContent, /protocol/);
});

test('local capture references cause no network request and do not become collision geometry', () => {
  const e = setup(); const original = e.state().scene; e.step('capture');
  e.file('site-reference-input', new e.ctx.File(['video'], 'walkthrough.mp4', { type: 'video/mp4' }));
  assert.equal(e.state().referenceCount, 1); assert.deepEqual(e.state().scene, original);
  assert.equal(e.requests.length, 0); assert.match(e.root.textContent, /do not automatically generate geometry/);
});

test('worker capability, explicit raw upload, status and authenticated artifact download follow the protocol', async () => {
  const e = setup(); let checks = 0;
  e.respond((url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-test-token-do-not-export');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    if (url.endsWith('/capabilities')) return response(capabilities);
    if (options.method === 'POST') return response({ version: 1, id: 'scan_123', status: 'queued', artifacts: [] }, 202);
    if (url.endsWith('/artifacts/scene.ply')) return bytesResponse('ply\nformat ascii 1.0\n');
    checks++;
    return response({ version: 1, id: 'scan_123', status: 'complete', stage: 'reconstruction-complete', progress: 1, artifacts: [{ name: 'scene.ply', url: 'https://untrusted.example/collect', sizeBytes: 21, sha256: 'a'.repeat(64) }] });
  });
  await e.connect(); const upload = new e.ctx.File(['test-video-bytes'], 'site walkthrough.mp4', { type: 'video/mp4' });
  e.file('site-worker-file', upload); assert.equal(e.requests.length, 1);
  e.action('reconstruct'); await flush();
  assert.equal(e.state().reconstruction.id, 'scan_123');
  const post = e.requests.find(r => r.options.method === 'POST'); assert(post); assert.equal(post.options.body, upload);
  assert.equal(post.options.headers['Content-Type'], 'video/mp4'); assert.equal(post.options.headers['X-Filename'], 'site%20walkthrough.mp4');
  await e.timer(2000); assert.equal(checks, 1); assert.equal(e.state().reconstruction.status, 'complete');
  assert.match(e.el('site-worker-status').textContent, /finished/);
  assert.equal([...e.timers.values()].filter(timer => timer.delay === 2000).length, 0);
  e.click('[data-site-artifact="0"]'); await flush();
  assert(e.requests.at(-1).url.endsWith('/v1/site-scans/scan_123/artifacts/scene.ply'));
  assert.equal(e.downloadAnchors.length, 1); assert.equal(e.downloadAnchors[0].name, 'scene.ply');
  assert(!e.requests.some(r => r.url.startsWith('https://untrusted.example')));
  assert.equal(e.state().scene.source.kind, 'sample'); assert.equal(e.state().policyExecuted, false);
});

test('worker failed jobs render actionable error.message and stop polling', async () => {
  const e = setup();
  e.respond((url, options) => {
    if (url.endsWith('/capabilities')) return response(capabilities);
    if (options.method === 'POST') return response({ version: 1, id: 'failed_scan', status: 'queued' }, 202);
    return response({ version: 1, id: 'failed_scan', status: 'failed', error: { message: 'Need more overlapping images.' }, artifacts: [] });
  });
  await e.connect(); e.file('site-worker-file', new e.ctx.File(['zip'], 'photos.zip', { type: 'application/zip' }));
  e.action('reconstruct'); await flush(); await e.timer(2000);
  assert.match(e.root.textContent, /Need more overlapping images/); assert(!e.root.textContent.includes('[object Object]'));
  assert.equal([...e.timers.values()].filter(timer => timer.delay === 2000).length, 0);
});

test('worker availability and upload limits prevent accidental reconstruction requests', async () => {
  const e = setup(); e.respond(() => response({ ...capabilities, available: false, missing: ['COLMAP'] })); await e.connect();
  e.file('site-worker-file', new e.ctx.File(['video'], 'capture.mp4', { type: 'video/mp4' }));
  assert.equal(e.root.querySelector('[data-site-action="reconstruct"]').disabled, true);
  e.action('reconstruct'); await flush(); assert.equal(e.requests.length, 1);
  e.respond(() => response({ ...capabilities, maxUploadBytes: 3 })); await e.connect();
  e.action('reconstruct'); await flush();
  assert.equal(e.requests.filter(request => request.options.method === 'POST').length, 0);
  assert.match(e.el('site-worker-status').textContent, /upload limit/);
});

test('late capability failures from a disconnected worker cannot disconnect its replacement', async () => {
  const e = setup(), oldRequest = deferred();
  e.respond(url => url.startsWith('https://old-worker.example') ? oldRequest.promise : response(capabilities));
  await e.connect('https://old-worker.example'); e.action('disconnect-worker');
  await e.connect('https://new-worker.example'); assert.equal(e.state().workerConnected, true);
  oldRequest.reject(new Error('Old worker unavailable')); await flush();
  assert.equal(e.state().workerConnected, true); assert.equal(e.el('site-worker-url').value, 'https://new-worker.example');
  assert.match(e.el('site-worker-status').textContent, /ready/);
});

test('a late upload response cannot install an old job on a replacement worker', async () => {
  const e = setup(), upload = deferred();
  e.respond((_url, options) => options.method === 'POST' ? upload.promise : response(capabilities)); await e.connect();
  e.file('site-worker-file', new e.ctx.File(['video'], 'capture.mp4', { type: 'video/mp4' }));
  e.action('reconstruct'); await flush(); e.action('disconnect-worker'); await e.connect('https://new-worker.example');
  upload.resolve(response({ version: 1, id: 'stale_job', status: 'queued' }, 202)); await flush();
  assert.equal(e.state().reconstruction, null); assert.equal(e.el('site-worker-url').value, 'https://new-worker.example');
  assert.equal([...e.timers.values()].filter(timer => timer.delay === 2000).length, 0);
});

test('geometry edits cancel background planning and ignore late results for the obsolete map', async () => {
  const e = setup(), workers = [];
  e.ctx.Worker = class {
    constructor(url) { assert.equal(url, 'site-plan-worker.js'); workers.push(this); }
    postMessage(value) { this.input = value; }
    terminate() { this.terminated = true; }
    finish() { this.onmessage({ data: { id: this.input.id, ok: true, result: e.ctx.BrainSNNSiteCore.plan(this.input.scene, this.input.robot, this.input.options) } }); }
  };
  e.action('run'); assert.equal(e.state().planning, true); assert.equal(e.state().result, null);
  e.selectObstacle(e.state().scene.obstacles[0].id); e.change('site-obstacle-x', 4.2);
  assert.equal(workers[0].terminated, true); assert.equal(e.state().planning, false);
  workers[0].finish(); await flush(); assert.equal(e.state().result, null); assert.equal(e.state().running, false);
  e.action('run'); assert.equal(workers.length, 2); workers[1].finish(); await flush();
  assert.equal(e.state().result.status, 'complete'); assert.equal(e.state().running, true);
  assert.equal(e.state().result.sceneDigest, e.ctx.BrainSNNSiteCore.digest(e.state().scene));
});

test('opening reconstructed appearance creates an empty unscaled review map and preserves the selected policy', async () => {
  const e = setup(), cloud = { positions: [0, 0, 0, 1, 0, 1], colors: [1, 0, 0, 0, 1, 0] };
  e.respond((url, options) => {
    if (url.endsWith('/capabilities')) return response(capabilities);
    if (options.method === 'POST') return response({ version: 1, id: 'cloud_scan', status: 'queued' }, 202);
    if (url.endsWith('/artifacts/point-cloud.json')) return response(cloud);
    return response({ version: 1, id: 'cloud_scan', status: 'complete', artifacts: [{ name: 'point-cloud.json' }] });
  });
  e.action('run'); await flush(); e.action('run');
  await e.connect(); e.file('site-worker-file', new e.ctx.File(['video'], 'capture.mp4', { type: 'video/mp4' }));
  e.action('reconstruct'); await flush(); await e.timer(2000);
  e.action('open-reconstruction'); await flush();
  assert.equal(e.state().step, 'review'); assert.equal(e.state().view, 'reality');
  assert.equal(e.state().scene.source.kind, 'reconstruction-reference'); assert.equal(e.state().scene.scaleConfirmed, false);
  assert.equal(e.state().scene.obstacles.length, 0); assert.equal(e.state().result, null);
  assert.equal(e.el('site-run').disabled, true); assert.equal(e.state().selection.modelId, 'groot');
  assert.equal(e.state().policyExecuted, false); assert(e.renderCalls.some(call => call.name === 'setPointCloud'));
});

test('editable scenario roundtrip preserves the reviewed planning body without replacing Arena selection', async () => {
  const e = setup();
  e.change('site-proxy', 'cleaner'); e.change('site-test-mode', 'coverage');
  e.change('site-body-width', 0.72); e.change('site-body-speed', 0.25); e.change('site-body-operationWidth', 0.6);
  e.action('export-scene'); const saved = JSON.parse(e.downloads.at(-1));
  assert.equal(saved.schema, 'brainsnn.site.scenario.v1');
  e.change('site-proxy', 'selected'); assert.equal(e.state().proxy, 'selected');
  e.step('capture'); e.file('site-map-input', e.jsonFile(saved)); await flush(); e.step('test');
  assert.equal(e.state().proxy, 'cleaner'); assert.equal(e.state().mode, 'coverage');
  assert.equal(Number(e.el('site-body-width').value), 0.72); assert.equal(Number(e.el('site-body-speed').value), 0.25);
  assert.equal(Number(e.el('site-body-operationWidth').value), 0.6);
  assert.equal(e.state().scene.scaleConfirmed, false);
  assert.equal(e.state().selection.robotId, 'g1'); assert.equal(e.state().selection.modelId, 'groot');
});
