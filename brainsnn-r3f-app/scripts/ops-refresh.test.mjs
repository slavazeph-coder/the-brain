import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Run the unchanged component's rendered handlers with deterministic hooks,
// fetch promises and timers. No browser, sockets, credentials or production DB.
const { code } = transformSync(readFileSync(new URL('../src/features/ops/OperationsWorkspace.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' });
const OWNER = 'synthetic-owner-for-offline-ui-tests';
const status = (readyForReview = 7) => ({
  control: { hardwarePaused: true, gpuQuarantined: true, externalExecution: false, reason: 'synthetic hardware hold' },
  jobs: [], approvals: [], metrics: { readyForReview, failed: 2 },
  workerContacts: [{ workerId: 'synthetic_worker', lastSeenAt: 100000 }],
  // Deliberately positive evidence tests that loss of freshness blocks the labels.
  readiness: { ready: true, checks: [{ id: 'workerContact', state: 'pass', reason: 'authenticated_contact_only' }] },
});
function children(node) { return [node?.props?.children].flat(Infinity).filter(value => value !== undefined && value !== null && value !== false); }
function content(node) { return typeof node === 'object' ? children(node).map(content).join('') : String(node ?? ''); }
function nodes(node) { return typeof node === 'object' && node ? [node, ...children(node).flatMap(nodes)] : []; }

function workspace(t, { ignoreAbort = false } = {}) {
  const slots = [], timers = new Map(), requests = [];
  let cursor = 0, timerId = 0, dirty = true, tree, pendingEffects = [], mounted = true;
  const react = {
    createElement: (type, props, ...values) => ({ type, props: { ...props, children: values } }),
    Fragment: Symbol('Fragment'),
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; }];
    },
    useEffect(effect, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index]))) {
        pendingEffects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports,
    require: name => { if (name === 'react') return react; if (name === './operations.css') return {}; throw new Error(`Unexpected import: ${name}`); },
    crypto: { randomUUID: () => 'synthetic-submission-id' }, document: {}, AbortController,
    setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => {
      assert.ok(url.startsWith('/api/ops/'));
      const request = { url, options, resolve, reject };
      requests.push(request);
      if (!ignoreAbort) options.signal.addEventListener('abort', () => reject(Object.assign(new Error('synthetic abort'), { name: 'AbortError' })), { once: true });
    }),
  });
  function render() {
    if (!mounted || !dirty) return;
    dirty = false; cursor = 0; pendingEffects = [];
    tree = module.exports.OperationsWorkspace();
    for (const effect of pendingEffects) effect();
  }
  async function flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } }
  function find(type, label) {
    const match = nodes(tree).find(node => node.type === type && content(node) === label);
    assert.ok(match, `Missing ${type}: ${label}`); return match;
  }
  function input(label, value) {
    const node = nodes(find('label', label)).find(item => item.type === 'input');
    assert.ok(node, `Missing input: ${label}`); node.props.onChange({ target: { value } }); render();
  }
  function take(path) {
    const request = requests.shift();
    assert.equal(request?.url, `/api/ops${path}`);
    assert.equal(request.options.headers.Authorization, `Bearer ${OWNER}`);
    assert.equal(request.options.credentials, 'omit');
    return request;
  }
  async function respond(request, body, httpStatus = 200) {
    request.resolve({ ok: httpStatus >= 200 && httpStatus < 300, status: httpStatus, json: async () => body }); await flush();
  }
  async function fail(request, name = 'Error') {
    request.reject(Object.assign(new Error('synthetic status failure'), { name })); await flush();
  }
  function fire(ms) {
    const timer = [...timers].find(([, value]) => value.ms === ms);
    assert.ok(timer, `Missing ${ms}ms timer`); timers.delete(timer[0]);
    return timer[1].callback();
  }
  async function login(packet = status()) {
    input('Owner credential', OWNER);
    const form = nodes(tree).find(node => node.type === 'form' && node.props.className?.includes('ops-login'));
    const done = form.props.onSubmit({ preventDefault() {} });
    await respond(take('/status'), packet); await done; await flush();
  }
  async function action() {
    input('Operator reason', 'synthetic owner pause');
    assert.equal(find('button', 'Resume scheduler').props.disabled, true);
    const done = find('button', 'Pause after current job').props.onClick();
    const request = take('/control');
    assert.equal(request.options.method, 'POST');
    assert.equal(JSON.parse(request.options.body).action, 'pause');
    await respond(request, { control: { paused: true } });
    return { request: take('/status'), done };
  }
  function poll() { const done = fire(3000); return { request: take('/status'), done }; }
  function unmount() {
    mounted = false;
    for (const slot of slots) slot?.cleanup?.();
  }
  render(); t.after(unmount);
  return { login, action, poll, respond, fail, fire, flush, input, find, take, unmount,
    text: () => content(tree), alerts: () => nodes(tree).filter(node => node.props.role === 'alert').map(content),
    lock: () => { find('button', 'Lock operations').props.onClick(); render(); },
  };
}

function assertFresh(h, count = 7) {
  assert.match(h.text(), /Control plane: online/);
  assert.match(h.text(), /Worker contact: recent \(within 60 seconds\); contact only/);
  assert.match(h.text(), /Deployment readiness: assertions satisfied/);
  assert.match(h.text(), new RegExp(`Ready for review: ${count} · Failed: 2`));
  assert.doesNotMatch(h.text(), /Showing the last received snapshot/);
  assert.deepEqual(h.alerts(), []);
}
function assertStale(h, message) {
  assert.match(h.text(), /Control plane: unverified — refresh failed/);
  assert.match(h.text(), /Worker contact: unverified/);
  assert.match(h.text(), /GPU worker readiness: unverified/);
  assert.match(h.text(), /Deployment readiness: blocked/);
  assert.match(h.text(), /Ready for review: 7 · Failed: 2/);
  assert.match(h.text(), /Showing the last received snapshot/);
  assert.doesNotMatch(h.text(), /Control plane: online|Worker contact: recent/);
  assert.deepEqual(h.alerts(), [message]);
  assert.equal(h.find('button', 'Resume scheduler').props.disabled, true);
  assert.match(h.text(), /synthetic hardware hold/);
}

for (const source of ['action', 'poll']) for (const failure of ['Error', 'timeout']) {
  test(`OPS-002 ${source} refresh ${failure} marks retained evidence stale and recovers`, async t => {
    const h = workspace(t); await h.login(); assertFresh(h);
    h.input('Operator reason', 'synthetic owner reason');
    const pending = await h[source]();
    if (failure === 'timeout') { h.fire(10000); await h.flush(); }
    else await h.fail(pending.request);
    await pending.done; await h.flush();
    assertStale(h, failure === 'timeout' ? 'Status refresh timed out.' : 'synthetic status failure');
    if (source === 'action') assert.match(h.text(), /Recorded\./);
    const recovery = h.poll(); await h.respond(recovery.request, status(9)); await recovery.done;
    assertFresh(h, 9);
  });
}

for (const source of ['action', 'poll']) for (const failure of ['Error', 'AbortError']) {
  test(`OPS-002 older ${source} ${failure} cannot overwrite a newer refresh success`, async t => {
    const h = workspace(t); await h.login();
    const older = await h[source]();
    const newer = await h[source === 'action' ? 'poll' : 'action']();
    await h.respond(newer.request, status(9)); await newer.done;
    await h.fail(older.request, failure); await older.done; await h.flush();
    assertFresh(h, 9);
  });
}

test('OPS-002 older poll success cannot clear a newer action refresh failure', async t => {
  const h = workspace(t); await h.login();
  const older = h.poll(), newer = await h.action();
  await h.fail(newer.request); await newer.done;
  await h.respond(older.request, status(99)); await older.done;
  assertStale(h, 'synthetic status failure');
});

for (const source of ['action', 'poll']) for (const outcome of ['Error', 'AbortError', 'success']) {
  test(`OPS-002 ${source} ${outcome} from a locked session cannot alter the next session`, async t => {
    const h = workspace(t, { ignoreAbort: true }); await h.login();
    const old = await h[source]();
    h.lock(); assert.equal(old.request.options.signal.aborted, true);
    assert.match(h.text(), /Owner sign in/);
    await h.login(status(11));
    if (outcome === 'success') await h.respond(old.request, status(99));
    else await h.fail(old.request, outcome);
    await old.done; await h.flush();
    assertFresh(h, 11);
  });
}

for (const httpStatus of [401, 403]) for (const source of ['action', 'poll']) {
  test(`OPS-002 current ${source} refresh HTTP ${httpStatus} still locks owner access`, async t => {
    const h = workspace(t); await h.login();
    const pending = await h[source]();
    await h.respond(pending.request, {}, httpStatus); await pending.done;
    assert.match(h.text(), /Owner sign in/);
    assert.doesNotMatch(h.text(), /Control plane: online|Ready for review: 7|Stop all work/);
  });
}
