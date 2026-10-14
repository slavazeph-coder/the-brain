const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const clone = value => JSON.parse(JSON.stringify(value));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => typeof data === 'string' ? data : JSON.stringify(data) });
function fixture(overrides = {}) {
  const calls = [], errors = [], frames = [], states = [];
  const ctx = { URL, AbortController, setTimeout, clearTimeout, console, Date, ...overrides }; ctx.window = ctx;
  vm.createContext(ctx);
  for (const name of ['arena-profiles.js', 'arena-runtime.js']) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../dist', name), 'utf8'), ctx, { filename: name });
  const recipe = ctx.BrainSNNArenaProfiles.find('panda-pi05-libero');
  const profile = { ...clone(recipe), ready: true, checkpointRevision: 'sha256:checked-test-manifest', simulator: { name: 'LIBERO', version: 'pinned-commit' }, commands: ['run', 'pause', 'step', 'reset', 'intervene', 'branch'] };
  let seq = 0, status = 'ready', id = 's1';
  const makeFrame = extra => ({ version: 1, sessionId: id, profileId: profile.id, seq: ++seq, status, simTime: seq / 20,
    policyExecuted: seq > 1, cameras: [{ id: 'spectator', role: 'spectator', url: 'data:image/jpeg;base64,AAAA' }, ...profile.cameras.map(c => ({ id: c.id, role: c.role, url: 'data:image/jpeg;base64,AAAA' }))], bodies: [], metrics: { steps: seq }, events: [], ...extra });
  const caps = () => ({ version: 1, server: { name: 'test-worker', version: '1' }, profiles: [profile] });
  const makeSession = extra => ({ version: 1, sessionId: id, profileId: profile.id, robotId: profile.robotId, modelId: profile.modelId, checkpoint: profile.checkpoint, profile: clone(profile), status, ...extra });
  let hook = null;
  async function fetch(url, options) {
    const call = { url, ...options, json: options.body ? JSON.parse(options.body) : null }; calls.push(call);
    const mocked = hook && await hook(call);
    if (mocked) return mocked;
    if (url.endsWith('/capabilities')) return response(caps());
    if (options.method === 'DELETE') return response({ version: 1, closed: true });
    if (url.endsWith('/sessions')) return response(makeSession());
    if (url.endsWith('/frame')) return response(makeFrame());
    if (url.endsWith('/commands')) {
      status = call.json.type === 'run' ? 'running' : call.json.type === 'pause' ? 'paused' : call.json.type === 'reset' ? 'ready' : status;
      return response({ version: 1, sessionId: id, requestId: call.json.requestId, status, frame: makeFrame() });
    }
    throw Error('Unexpected fetch ' + url);
  }
  const create = options => ctx.BrainSNNRuntime.createClient({ fetch, onState: s => states.push(s), onFrame: f => frames.push(f), onError: e => errors.push(e), pollMs: 100000, timeoutMs: 1000, ...options });
  const selection = { robotId: 'panda', modelId: 'pi05', task: 'libero_spatial:0', seed: '42', protocol: 'practice' };
  return { ctx, calls, errors, frames, states, profile, caps, makeFrame, makeSession, create, selection, hook: fn => hook = fn, setId: value => id = value };
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
const connect = (client, e, changes = {}) => client.connect({ url: 'https://worker.example', token: 'private-test-token', selection: e.selection, ...changes });

test('registry keeps exact recipes and never invents compatibility', async () => {
  const e = fixture();
  assert.equal(e.ctx.BrainSNNArenaProfiles.findForSelection({ robotId: 'g1', modelId: 'pi05' }), null);
  assert.equal(e.ctx.BrainSNNArenaProfiles.findForSelection({ robotId: 'g1', modelId: 'groot' }).checkpoint, null);
  assert.equal(e.ctx.BrainSNNArenaProfiles.findForSelection(e.selection).cameras[0].width, 224);
  const p = e.ctx.BrainSNNArenaProfiles.list(); p[0].robotId = 'wrong';
  assert.equal(e.ctx.BrainSNNArenaProfiles.list()[0].robotId, 'panda');
});

test('connect/create/run/pause/step/disconnect exact contract and no token exposure', async () => {
  const e = fixture(), client = e.create();
  try {
    assert.equal((await connect(client, e)).status, 'connected');
    assert.equal((await client.start(e.selection)).status, 'ready');
    assert.equal((await client.command('run')).status, 'running');
    assert.equal((await client.command('pause')).status, 'paused');
    await client.command('step');
    const body = e.calls.find(c => c.url.endsWith('/sessions')).json;
    assert.equal(body.checkpoint, e.profile.checkpoint); assert.equal(body.seed, 42); assert.equal(body.robotId, 'panda'); assert.equal(body.modelId, 'pi05');
    assert.equal(JSON.stringify(client.getState()).includes('private-test-token'), false);
    assert.equal(e.calls[0].headers.Authorization, 'Bearer private-test-token');
    assert.equal(e.calls[0].credentials, 'omit'); assert.equal(e.calls[0].redirect, 'error');
  } finally { await client.disconnect(); }
  assert.equal(e.calls.at(-1).method, 'DELETE');
});

test('unsupported exact selection fails with reason and remains selected', async () => {
  const e = fixture(), client = e.create();
  try {
    const s = await connect(client, e, { selection: { ...e.selection, robotId: 'g1' } });
    assert.equal(s.error.code, 'unsupported_pair'); assert.equal(s.selection.robotId, 'g1'); assert.equal(s.selection.modelId, 'pi05');
    assert.equal(e.calls.filter(c => c.url.endsWith('/sessions')).length, 0);
  } finally { await client.disconnect(); }
});

test('non-catalog backend profile accepted only with complete exact contract', async () => {
  const e = fixture(); Object.assign(e.profile, { id: 'custom-go2-checkpoint', robotId: 'go2', modelId: 'research-policy', checkpoint: 'org/revision', adapter: 'custom' });
  const selection = { ...e.selection, robotId: 'go2', modelId: 'research-policy' }, client = e.create();
  try { assert.equal((await connect(client, e, { selection })).status, 'connected'); assert.equal((await client.start(selection)).profile.id, 'custom-go2-checkpoint'); }
  finally { await client.disconnect(); }
});

test('remote HTTP, embedded credentials and invalid seeds are rejected before network', async () => {
  for (const url of ['http://remote.example', 'https://name:secret@worker.example', 'https://worker.example/?token=x']) {
    const e = fixture(), client = e.create();
    await connect(client, e, { url }); assert.equal(client.getState().status, 'error'); assert.equal(e.calls.length, 0); await client.disconnect();
  }
  const e = fixture(), client = e.create(); await connect(client, e, { selection: { ...e.selection, seed: '-1' } }); assert.equal(client.getState().error.code, 'invalid_seed'); assert.equal(e.calls.length, 0); await client.disconnect();
});

test('malformed JSON and unsupported API version provide actionable errors', async () => {
  for (const bad of ['<html>Sign in</html>', { version: 2, profiles: [] }]) {
    const e = fixture(), client = e.create(); e.hook(async c => c.url.endsWith('/capabilities') ? response(bad) : null);
    const s = await connect(client, e); assert.equal(s.status, 'error'); assert(['invalid_json', 'protocol_mismatch'].includes(s.error.code)); await client.disconnect();
  }
});

test('timeout is bounded even when a worker ignores abort', async () => {
  const e = fixture(), client = e.create({ timeoutMs: 20 }); e.hook(c => c.url.endsWith('/capabilities') ? new Promise(() => {}) : null);
  const s = await connect(client, e); assert.equal(s.error.code, 'timeout'); await client.disconnect();
});

test('session initialization has a separate bounded startup deadline', async () => {
  const e = fixture(), client = e.create({timeoutMs:15,startupTimeoutMs:80});
  e.hook(async c => { if(c.url.endsWith('/sessions')) await pause(35); });
  try { await connect(client,e); const s = await client.start(e.selection); assert.equal(s.status,'ready'); } finally { await client.disconnect(); }
});

test('registered checkpoint, camera processing and action mismatches reject readiness', async () => {
  for (const mutate of [p => p.checkpoint = 'unrelated/base-model', p => p.cameras[0].rotation = 0, p => p.action.size = 29, p => delete p.checkpointRevision, p => p.timing.controlHz = 100, p => p.timing.actionChunkSteps = 10]) {
    const e = fixture(); mutate(e.profile); const client = e.create(); const s = await connect(client, e);
    assert.equal(s.status, 'error'); assert.equal(e.calls.length, 1); await client.disconnect();
  }
});

test('session identity mismatch triggers cleanup and does not display robot frames', async () => {
  const e = fixture(), client = e.create(); e.hook(async c => c.url.endsWith('/sessions') ? response(e.makeSession({ robotId: 'g1' })) : null);
  await connect(client, e); const s = await client.start(e.selection); assert.equal(s.error.code, 'session_mismatch'); assert.equal(e.frames.length, 0); assert(e.calls.some(c => c.method === 'DELETE')); await client.disconnect();
});

test('changed timing at session creation is rejected and session released', async () => {
  const e = fixture(), client = e.create(); e.hook(async c => { if (c.url.endsWith('/sessions')) { const data = e.makeSession(); data.profile.timing.actionChunkSteps = 10; return response(data); } });
  await connect(client, e); const s = await client.start(e.selection); assert.equal(s.error.code, 'timing_mismatch'); assert.equal(s.sessionId, null); assert(e.calls.some(c => c.method === 'DELETE')); await client.disconnect();
});

test('worker errors cannot echo the access token into public state', async () => {
  const e = fixture(), client = e.create(); e.hook(async c => response({version:1,error:{message:'Rejected private-test-token'}}, 401));
  const s = await connect(client, e); assert.equal(s.error.code, 'unauthorized'); assert(!JSON.stringify(s).includes('private-test-token')); assert(!JSON.stringify(e.errors).includes('private-test-token')); await client.disconnect();
});

test('all commands serialize including observation retrieval', async () => {
  const e = fixture(), client = e.create(); let active = 0, peak = 0;
  e.hook(async c => { if (c.url.endsWith('/commands')) { active++; peak = Math.max(peak, active); await pause(10); active--; } });
  try { await connect(client, e); await client.start(e.selection); await Promise.all([client.command('step'), client.command('step'), client.command('pause')]); assert.equal(peak, 1); assert.equal(e.frames.length, 4); }
  finally { await client.disconnect(); }
});

test('benchmark intervention is blocked before request and preserves mode', async () => {
  const e = fixture(), client = e.create(), selection = { ...e.selection, protocol: 'benchmark' };
  try { await connect(client, e, { selection }); await client.start(selection); const s = await client.command('intervene', { kind: 'camera-occlusion' }); assert.equal(s.error.code, 'benchmark_locked'); assert.equal(s.selection.protocol, 'benchmark'); assert.equal(e.calls.filter(c => c.url.endsWith('/commands')).length, 0); }
  finally { await client.disconnect(); }
});

test('stale and foreign session frames never reach the viewer', async () => {
  const e = fixture(), client = e.create();
  try {
    await connect(client, e); await client.start(e.selection); const before = e.frames.length;
    e.hook(async c => c.url.endsWith('/commands') ? response({ version: 1, sessionId: 's1', requestId: c.json.requestId, status: 'ready', frame: e.makeFrame({ seq: 0 }) }) : null);
    await client.command('step'); assert.equal(e.frames.length, before);
    e.hook(async c => c.url.endsWith('/commands') ? response({ version: 1, sessionId: 's1', requestId: c.json.requestId, status: 'ready', frame: e.makeFrame({ sessionId: 'foreign' }) }) : null);
    assert.equal((await client.command('step')).error.code, 'frame_mismatch'); assert.equal(e.frames.length, before);
  } finally { await client.disconnect(); }
});

test('reset aborts old in-flight frame and never applies its late sequence', async () => {
  const e = fixture(), client = e.create({ pollMs: 20 }); const pending = deferred(); let held = false;
  try {
    await connect(client, e); await client.start(e.selection); await client.command('run');
    e.hook(c => { if (c.url.endsWith('/frame') && !held) { held = true; return pending.promise; } });
    await pause(30); assert(held); const oldSeq = e.frames.at(-1).seq;
    await client.command('reset'); const resetFrame = e.frames.at(-1); assert(resetFrame.seq > oldSeq); assert.equal(client.getState().status, 'ready');
    pending.resolve(response(e.makeFrame({ seq: 999, status: 'running' }))); await pause(5);
    assert.equal(e.frames.at(-1).seq, resetFrame.seq); assert.equal(client.getState().status, 'ready');
  } finally { pending.resolve(response(e.makeFrame())); await client.disconnect(); }
});

test('selection changes abort obsolete capability response', async () => {
  const e = fixture(), client = e.create(), pending = deferred(); let count = 0;
  e.hook(c => c.url.endsWith('/capabilities') && ++count === 1 ? pending.promise : null);
  const old = connect(client, e); await pause(2);
  await connect(client, e, { selection: { ...e.selection, robotId: 'g1' } });
  pending.resolve(response(e.caps())); await old; await pause(2);
  assert.equal(client.getState().selection.robotId, 'g1'); assert.equal(client.getState().error.code, 'unsupported_pair'); await client.disconnect();
});

test('late session creation after disconnect gets cleaned up without becoming active', async () => {
  const e = fixture(), client = e.create(), pending = deferred();
  await connect(client, e); e.hook(c => c.url.endsWith('/sessions') ? pending.promise : null);
  const creating = client.start(e.selection); await pause(2); await client.disconnect(); await creating;
  pending.resolve(response(e.makeSession())); await pause(10);
  assert.equal(client.getState().status, 'disconnected'); assert(e.calls.some(c => c.method === 'DELETE')); assert.equal(e.frames.length, 0);
});

test('changing to invalid selection still deletes old active session', async () => {
  const e = fixture(), client = e.create(); await connect(client, e); await client.start(e.selection);
  await client.start({ ...e.selection, robotId: 'g1' }); assert(e.calls.some(c => c.method === 'DELETE')); await client.disconnect();
});

(async () => { let failed = 0; for (const { name, run } of tests) { try { await run(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error.stack); } } console.log(`${tests.length - failed}/${tests.length} runtime checks passed`); if (failed) process.exitCode = 1; })();
