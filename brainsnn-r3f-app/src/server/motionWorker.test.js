import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from '../test/tinyVitest.js';
import { createMotionWorkerClient, motionFailureStatus, validateMotionRequest } from './motionWorker.js';

// Other suites stub the global fetch; these tests talk to a real local HTTP server.
const nativeFetch = globalThis.fetch;
const key = 'motion-fixture-key-'.padEnd(40, 'k');
const remote = { MOTION_INFERENCE_URL: 'https://motion.example.test', MOTION_INFERENCE_KEY: key, MOTION_INFERENCE_EFFORTS: 'medium,low' };

/** A reachable-looking move: head yaw sweep, small lift, antenna wiggle, 25 Hz. */
function move(frames = 50, { yaw = 0.3, z = 0.01 } = {}) {
  const time = Array.from({ length: frames }, (_, index) => index / 25);
  return {
    description: 'fixture', time,
    set_target_data: time.map((t) => {
      const a = yaw * Math.sin(t * 2), c = Math.cos(a), s = Math.sin(a);
      return { head: [[c, -s, 0, 0.001], [s, c, 0, -0.002], [0, 0, 1, z * Math.sin(t)], [0, 0, 0, 1]],
        antennas: [0.2 * Math.sin(t * 6), -0.2 * Math.sin(t * 6)], body_yaw: 0.1 * Math.sin(t), check_collision: false, extra: 'drop me' };
    }),
  };
}

function answer(request, overrides = {}) {
  return { prompt: request.prompt, effort: request.effort, idea: 'lean in, ears up', recipe: 'go .5 e=0 p=-6 z=10 E=3 | hold .6',
    moves: Array.from({ length: request.n }, () => move()), durations_s: [1.96],
    timing_ms: { planner: 170, generator: 20, reachability: 4, total: 194, gpu: 'leak' }, endpoint: 'https://internal', ...overrides };
}

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk)).on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
  });
}

async function withWorker(handler, run, env = {}, options = {}) {
  const server = await serve(handler);
  try { await run(createMotionWorkerClient({ MOTION_INFERENCE_URL: server.url, ...env }, { fetchImpl: nativeFetch, ...options })); }
  finally { await server.close(); }
}

async function failure(promise) {
  try { await promise; } catch (error) { return error.reason; }
  throw new Error('expected a motion failure');
}

it('motion worker stays off unless a safe address is configured', async () => {
  const off = createMotionWorkerClient({});
  assert.equal(off.snapshot().status, 'not_configured');
  assert.equal(await failure(off.generate({ prompt: 'wave' })), 'not_configured');
  for (const env of [
    { MOTION_INFERENCE_URL: 'http://motion.example.test', MOTION_INFERENCE_KEY: key },
    { MOTION_INFERENCE_URL: 'https://motion.example.test' },
    { ...remote, MOTION_INFERENCE_KEY: 'short' },
    { ...remote, MOTION_INFERENCE_URL: 'https://user:pass@motion.example.test' },
    { ...remote, MOTION_INFERENCE_URL: 'https://motion.example.test/?token=1' },
    { ...remote, MOTION_INFERENCE_EFFORTS: 'turbo' },
    { ...remote, MOTION_INFERENCE_EFFORTS: 'low,low' },
  ]) {
    const client = createMotionWorkerClient(env);
    assert.equal(client.configured, false, JSON.stringify(env));
    assert.equal(client.snapshot().status, 'invalid_configuration');
  }
  const configured = createMotionWorkerClient(remote).snapshot();
  assert.equal(configured.configured, true);
  assert.deepEqual(configured.efforts, [{ effort: 'medium', planner: '4B' }, { effort: 'low', planner: '0.8B' }]);
  assert.doesNotMatch(JSON.stringify(configured), /example\.test|motion-fixture-key/);
  // A loopback worker (local development, an SSH tunnel) may run without a key.
  assert.equal(createMotionWorkerClient({ MOTION_INFERENCE_URL: 'http://127.0.0.1:8000' }).configured, true);
});

it('motion requests are normalised and bounded before reaching the worker', () => {
  assert.deepEqual(validateMotionRequest({ prompt: '  act   excited  ' }, ['medium']), { prompt: 'act excited', n: 1, seed: 0, effort: 'medium' });
  assert.deepEqual(validateMotionRequest({ prompt: 'sneeze', n: 4, seed: 7, effort: 'low' }, ['medium', 'low']),
    { prompt: 'sneeze', n: 4, seed: 7, effort: 'low' });
  for (const body of [null, [], { prompt: '' }, { prompt: '   ' }, { prompt: 'x'.repeat(301) }, { prompt: 'a\u0000b' },
    { prompt: 'wave', n: 5 }, { prompt: 'wave', n: 1.5 }, { prompt: 'wave', seed: -1 }, { prompt: 'wave', seed: '1' },
    { prompt: 'wave', effort: 'turbo' }, { prompt: 42 }]) {
    assert.throws(() => validateMotionRequest(body, ['medium']), (error) => error.reason === 'invalid_input', JSON.stringify(body));
  }
  assert.throws(() => validateMotionRequest({ prompt: 'wave', effort: 'high' }, ['medium']), (error) => error.reason === 'effort_unavailable');
  assert.equal(motionFailureStatus('invalid_input'), 400);
  assert.equal(motionFailureStatus('busy'), 429);
  assert.equal(motionFailureStatus('planner_failed'), 422);
});

it('motion worker results are authenticated, validated and rebuilt without provider extras', async () => {
  let seen;
  await withWorker(async (req, res) => {
    seen = { method: req.method, url: req.url, auth: req.headers.authorization, body: await readBody(req) };
    json(res, 200, answer(seen.body));
  }, async (client) => {
    const result = await client.generate({ prompt: 'Greet a visitor with excitement', n: 2, seed: 3, effort: 'medium' });
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/generate-dense');
    assert.equal(seen.auth, `Bearer ${key}`);
    assert.deepEqual(seen.body, { prompt: 'Greet a visitor with excitement', n: 2, seed: 3, effort: 'medium', retries: 2 });
    assert.deepEqual(Object.keys(result).sort(), ['durations_s', 'effort', 'idea', 'moves', 'planner', 'prompt', 'recipe', 'seed', 'timing_ms']);
    assert.equal(result.planner, '4B');
    assert.equal(result.moves.length, 2);
    assert.deepEqual(result.timing_ms, { planner: 170, generator: 20, reachability: 4, total: 194 });
    assert.deepEqual(result.durations_s, [1.96, 1.96]);
    const frame = result.moves[0].set_target_data[10];
    assert.deepEqual(Object.keys(frame), ['head', 'antennas', 'body_yaw', 'check_collision']);
    assert.equal(result.moves[0].description, 'Greet a visitor with excitement');
    assert.doesNotMatch(JSON.stringify(result), /internal|leak|drop me/);
    assert.equal(client.snapshot().status, 'online');
    assert.ok(client.snapshot().lastSuccessAt);
  }, { MOTION_INFERENCE_KEY: key, MOTION_INFERENCE_EFFORTS: 'medium' });
});

it('motion worker rejects malformed or physically implausible trajectories', async () => {
  const skew = move(); skew.set_target_data[5].head[0][0] = 2;
  const scaled = move(); scaled.set_target_data[5].head = [[1.1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const far = move(); far.set_target_data[5].head[2][3] = 0.5;
  const backwards = move(); backwards.time[5] = backwards.time[4];
  const late = move(); late.time = late.time.map((t) => t + 1);
  const long = move(722);
  const nan = move(); nan.set_target_data[3].antennas = [null, 0];
  const mismatch = move(); mismatch.set_target_data.pop();
  for (const [label, body] of [
    ['count', (request) => answer(request, { moves: [] })],
    ['skew', (request) => answer(request, { moves: [skew] })],
    ['scaled', (request) => answer(request, { moves: [scaled] })],
    ['far', (request) => answer(request, { moves: [far] })],
    ['backwards', (request) => answer(request, { moves: [backwards] })],
    ['late', (request) => answer(request, { moves: [late] })],
    ['long', (request) => answer(request, { moves: [long] })],
    ['nan', (request) => answer(request, { moves: [nan] })],
    ['mismatch', (request) => answer(request, { moves: [mismatch] })],
    ['effort', (request) => answer(request, { effort: 'high' })],
    ['recipe', (request) => answer(request, { recipe: '' })],
  ]) {
    await withWorker(async (req, res) => json(res, 200, body(await readBody(req))), async (client) => {
      assert.equal(await failure(client.generate({ prompt: 'wave' })), 'invalid_output', label);
      assert.equal(client.snapshot().status, 'degraded');
      assert.equal(client.snapshot().lastFailure.reason, 'invalid_output');
    });
  }
});

it('motion worker maps upstream failures without retrying or leaking details', async () => {
  await withWorker((_req, res) => json(res, 422, { detail: 'planner did not produce a valid recipe' }), async (client) => {
    assert.equal(await failure(client.generate({ prompt: 'wave' })), 'planner_failed');
    // A model that could not answer is not an outage.
    assert.equal(client.snapshot().status, 'unverified');
  });
  await withWorker((_req, res) => json(res, 401, { detail: 'unauthorized' }), async (client) => {
    assert.equal(await failure(client.generate({ prompt: 'wave' })), 'authentication_failed');
  });
  await withWorker((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); }, async (client) => {
    assert.equal(await failure(client.generate({ prompt: 'wave' })), 'invalid_output');
  });
  await withWorker((_req, res) => json(res, 200, { padding: 'x'.repeat(4096) }), async (client) => {
    assert.equal(await failure(client.generate({ prompt: 'wave' })), 'response_too_large');
  }, {}, { maxResponseBytes: 1024 });
  await withWorker(() => {}, async (client) => {
    const started = Date.now();
    assert.equal(await failure(client.generate({ prompt: 'wave' })), 'timeout');
    assert.ok(Date.now() - started < 2000);
  }, {}, { timeoutMs: 100 });
});

it('motion worker refuses concurrent requests beyond its capacity', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await withWorker(async (req, res) => {
    const body = await readBody(req);
    await gate;
    json(res, 200, answer(body));
  }, async (client) => {
    const first = client.generate({ prompt: 'wave' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(client.snapshot().inFlight, 1);
    assert.equal(await failure(client.generate({ prompt: 'nod' })), 'busy');
    release();
    assert.equal((await first).moves.length, 1);
    assert.equal(client.snapshot().inFlight, 0);
  });
});
