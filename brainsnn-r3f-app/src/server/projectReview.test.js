import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from '../test/tinyVitest.js';
import { createProjectReviewService, validateProjectCritique } from './projectReview.js';
import { demoSceneText, defaultReviewRates, prepareProjectReview, localProposal, approveReview, exportReviewJSON } from '../../public/world/project-review.mjs';

// Other suites replace global fetch; this suite exercises the actual local HTTP handler.
const nativeFetch = globalThis.fetch;
const owner = {}, secondOwner = {};
const critique = (extra = {}) => ({ summary: 'Review the listed finish scope and unresolved site conditions.', findings: [], needsRevision: false, recommendedOptionId: null, ...extra });
const rates = () => defaultReviewRates().map((rate, i) => ({ ...rate, low: [10, 20, 30, 40][i], high: [12, 22, 35, 45][i],
  source: 'Authored test rate schedule', asOf: '2026-11-18', reviewed: true }));

async function request(overrides = {}) {
  const raw = { sceneText: demoSceneText(), sourceLabel: 'Authored room for HTTP tests',
    brief: { title: 'Finish review', goal: 'Compare a wall refresh with walls and floor renewal.', constraints: 'Retain the layout.', currency: 'CAD', budget: 3000 },
    rates: rates(), ...overrides };
  const input = await prepareProjectReview(raw);
  return { input, body: { ...raw, consent: true, inputSha256: input.inputSha256 } };
}

async function serve({ generate, ...settings } = {}) {
  const service = createProjectReviewService({ authorize: req => req.headers.authorization === 'Bearer owner' ? owner
    : req.headers.authorization === 'Bearer owner-two' ? secondOwner : null,
  generate, model: 'test-fixture-model', ...settings });
  const server = createServer((req, res) => service.handle(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (body, { token = 'owner', method = body === undefined ? 'GET' : 'POST', path = '/', raw, headers = {}, signal } = {}) => {
    const response = await nativeFetch(url + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : raw ?? JSON.stringify(body), signal });
    return { status: response.status, data: await response.json() };
  };
  return { service, call, url, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

function provider(input, { revise = false, failAt = null } = {}) {
  const seen = [];
  const generate = async args => {
    const payload = JSON.parse(args.prompt);
    seen.push({ role: args.role, payload, signal: args.signal, maxOutputTokens: args.maxOutputTokens });
    assert.equal(payload.project.inputSha256, input.inputSha256);
    assert.equal(payload.project.sceneText, undefined, 'provider receives a normalized summary, never original source bytes');
    assert.ok(args.system.includes('never invent or modify quantities'));
    if (args.role === failAt) throw new Error('secret-api-key and private-upstream-url must never reach the client');
    if (args.role === 'scope-planner') {
      const proposal = localProposal(input);
      if (payload.previousProposal) proposal.options[0].summary = 'Revised finish scope with unresolved preparation kept as a question.';
      return { text: JSON.stringify(proposal), model: 'provider-declared-model' };
    }
    if (args.role === 'estimator') return JSON.stringify(critique({ needsRevision: revise }));
    return JSON.stringify(critique({ summary: payload.revisionApplied ? 'The revised alternatives retain the outstanding site checks.' : 'Both alternatives require human scope and measurement review.' }));
  };
  return { generate, seen };
}

it('project review: status exposes configuration only, and missing/visitor sessions never call a model', async () => {
  const { input, body } = await request(), fake = provider(input), web = await serve(fake);
  try {
    const status = await web.call(undefined, { token: null });
    assert.equal(status.status, 200); assert.equal(status.data.available, true); assert.equal(status.data.requiresOwner, true);
    assert.equal(status.data.limits.maxCalls, 4);
    assert.equal((await web.call(body, { token: null })).status, 401);
    assert.equal((await web.call(body, { token: 'visitor' })).status, 401);
    assert.equal(fake.seen.length, 0);
  } finally { await web.close(); }
  const off = await serve({ generate: fake.generate, enabled: false });
  try {
    assert.equal((await off.call()).data.model, null);
    assert.equal((await off.call(body)).status, 503);
    assert.equal(fake.seen.length, 0);
  } finally { await off.close(); }
});

it('project review: three authored provider invocations keep arithmetic in code and bind the exported review', async () => {
  const { input, body } = await request(), fake = provider(input), web = await serve(fake);
  try {
    const answer = await web.call(body);
    assert.equal(answer.status, 200, JSON.stringify(answer.data));
    const { report } = answer.data;
    assert.deepEqual(fake.seen.map(call => call.role), ['scope-planner', 'estimator', 'reviewer']);
    assert.equal(report.inputSha256, input.inputSha256);
    // Authored room: wall area is 2*(6+4.8)*2.7 - 0.9*2.1 = 56.43 m².
    // Local option A uses 10–12 per m². B uses 20–22 plus floor 6*4.8 at 40–45.
    assert.deepEqual(report.options[0].subtotal, { low: 564.3, high: 677.16 });
    assert.deepEqual(report.options[1].subtotal, { low: 2280.6, high: 2537.46 });
    assert.equal(report.execution.mode, 'ai-team'); assert.equal(report.execution.callCount, 3);
    assert.equal(report.execution.identityStatus, 'configured-provider-declaration');
    assert.equal(report.execution.model, 'test-fixture-model');
    assert.ok(Object.values(report.validation).every(value => value === false));
    assert.ok(report.transcript.every(step => step.status === 'completed' && step.inputSha256 === input.inputSha256));
    assert.equal(report.transcript.at(-1).role, 'reviewer');
    const approval = await approveReview(input, report, { optionId: 'option-a', reviewer: 'Fixture reviewer', note: '', acknowledged: true });
    const exported = JSON.parse(await exportReviewJSON(input, report, approval));
    assert.ok(JSON.stringify(exported).includes('Both alternatives require human scope'));
  } finally { await web.close(); }
});

it('project review: one estimator-requested revision is repriced before the final reviewer, with at most four calls', async () => {
  const { input, body } = await request(), fake = provider(input, { revise: true }), web = await serve(fake);
  try {
    const answer = await web.call(body);
    assert.equal(answer.status, 200, JSON.stringify(answer.data));
    const { report } = answer.data;
    assert.deepEqual(fake.seen.map(call => call.role), ['scope-planner', 'estimator', 'scope-planner', 'reviewer']);
    assert.equal(report.execution.callCount, 4); assert.equal(report.execution.revisionApplied, true);
    assert.equal(fake.seen.at(-1).payload.proposal.options[0].summary, report.options[0].summary);
    assert.equal(report.transcript.at(-1).proposalSha256, report.transcript[2].proposalSha256);
    assert.notEqual(report.transcript[0].proposalSha256, report.transcript[2].proposalSha256);
    assert.deepEqual(report.options[0].subtotal, { low: 564.3, high: 677.16 });
    const approval = await approveReview(input, report, { optionId: 'option-a', reviewer: 'Revision reviewer', note: 'Preliminary scope only.', acknowledged: true });
    assert.ok(JSON.parse(await exportReviewJSON(input, report, approval)));
  } finally { await web.close(); }
});

it('project review: original source and current revision are revalidated before any paid call', async () => {
  const { input, body } = await request(), fake = provider(input), web = await serve(fake);
  try {
    assert.equal((await web.call({ ...body, consent: false })).status, 400);
    assert.equal((await web.call({ ...body, inputSha256: 'a'.repeat(64) })).status, 409);
    assert.equal((await web.call({ ...body, sceneText: body.sceneText + ' ' })).status, 409, 'even equivalent source bytes invalidate the prior request digest');
    assert.equal((await web.call({ ...body, brief: { ...body.brief, goal: 'Changed goal' } })).status, 409);
    assert.equal((await web.call({ ...body, totals: { low: 1, high: 2 } })).status, 422);
    assert.equal((await web.call({ ...body, sceneText: '{}' })).status, 422);
    assert.equal(fake.seen.length, 0);
  } finally { await web.close(); }
});

it('project review: hallucinated references, quantities and approval fields are rejected instead of repricing them', async () => {
  const { input, body } = await request();
  for (const change of [proposal => { proposal.options[0].items[0].componentId = 'not-in-this-scene'; },
    proposal => { proposal.options[0].items[0].quantity = 999; },
    proposal => { proposal.approved = true; }]) {
    let count = 0;
    const web = await serve({ generate: async () => { count++; const proposal = localProposal(input); change(proposal); return JSON.stringify(proposal); } });
    try { const answer = await web.call(body); assert.equal(answer.status, 502); assert.equal(answer.data.code, 'invalid-model-output'); assert.equal(count, 1); assert.equal(answer.data.report, undefined); }
    finally { await web.close(); }
  }
});

it('project review: critiques accept only known references and cannot add certification or override findings', async () => {
  const { input } = await request();
  const bad = critique({ findings: [{ severity: 'warning', message: 'Issue', componentIds: ['invented'], optionIds: ['option-a'] }] });
  assert.throws(() => validateProjectCritique(input, bad));
  assert.throws(() => validateProjectCritique(input, { ...critique(), metricVerified: true }));
  assert.throws(() => validateProjectCritique(input, critique({ recommendedOptionId: 'hidden-third-option' })));
  const good = validateProjectCritique(input, critique({ findings: [{ severity: 'blocker', message: 'Missing scope evidence.', componentIds: [], optionIds: [] }] }));
  assert.equal(good.needsRevision, true, 'a blocker cannot be labelled as needing no revision');
});

it('project review: malformed Unicode critiques stop the team before approval or export can diverge', async () => {
  const { input, body } = await request();
  const malformed = [critique({ summary: 'Unpaired high surrogate \uD800' }),
    critique({ findings: [{ severity: 'warning', message: 'Unpaired low surrogate \uDC00', componentIds: [], optionIds: [] }] })];
  for (const bad of malformed) {
    assert.throws(() => validateProjectCritique(input, bad));
    const fake = provider(input);
    const web = await serve({ generate: async args => {
      const result = await fake.generate(args);
      return args.role === 'estimator' ? JSON.stringify(bad) : result;
    } });
    try {
      const answer = await web.call(body);
      assert.equal(answer.status, 502); assert.equal(answer.data.code, 'invalid-model-output');
      assert.equal(answer.data.report, undefined);
      assert.deepEqual(fake.seen.map(call => call.role), ['scope-planner', 'estimator']);
    } finally { await web.close(); }
  }
  const valid = critique({ summary: 'Check the finish scope \uD83D\uDCCB',
    findings: [{ severity: 'info', message: 'Keep the site review visible \uD83D\uDCCB', componentIds: [], optionIds: [] }] });
  assert.deepEqual(validateProjectCritique(input, valid), valid, 'valid paired astral characters remain supported');
});

it('project review: provider failure and oversized responses stop the team without leaking raw SDK data', async () => {
  const { input, body } = await request(), fake = provider(input, { failAt: 'estimator' }), web = await serve(fake);
  try {
    const answer = await web.call(body);
    assert.equal(answer.status, 502); assert.equal(answer.data.code, 'provider-failed');
    assert.equal(fake.seen.length, 2); assert.ok(!JSON.stringify(answer.data).includes('secret-api-key'));
  } finally { await web.close(); }
  const huge = await serve({ generate: async () => ' '.repeat(33 * 1024) });
  try { assert.equal((await huge.call(body)).data.code, 'invalid-model-output'); }
  finally { await huge.close(); }
});

it('project review: request bodies and encodings are bounded before model execution', async () => {
  const { input, body } = await request(), fake = provider(input), web = await serve(fake);
  try {
    assert.equal((await web.call(body, { raw: '{broken' })).status, 400);
    assert.equal((await web.call(body, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await web.call(body, { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
    assert.equal((await web.call(body, { raw: 'x'.repeat(385 * 1024) })).status, 413);
    assert.equal(fake.seen.length, 0);
  } finally { await web.close(); }
});

it('project review: per-session and process-wide hourly reservations include failed or cancelled runs', async () => {
  const { input, body } = await request(), fake = provider(input);
  let time = Date.UTC(2026, 10, 18, 12);
  const web = await serve({ ...fake, now: () => time, perSessionRuns: 1, hourlyRuns: 2 });
  try {
    assert.equal((await web.call(body)).status, 200);
    assert.equal((await web.call(body)).data.code, 'review-limit');
    assert.equal((await web.call(body, { token: 'owner-two' })).status, 200);
    assert.equal((await web.call(body, { token: 'owner-two' })).data.code, 'review-limit');
    assert.equal(fake.seen.length, 6);
    time += 3600_000;
    assert.equal((await web.call(body)).status, 200);
    assert.equal(fake.seen.length, 9);
  } finally { await web.close(); }
  const failedProvider = provider(input, { failAt: 'scope-planner' });
  const failed = await serve({ ...failedProvider, perSessionRuns: 1 });
  try {
    assert.equal((await failed.call(body)).data.code, 'provider-failed');
    assert.equal((await failed.call(body)).data.code, 'review-limit', 'a potentially paid failed call is not refunded');
    assert.equal(failedProvider.seen.length, 1);
  } finally { await failed.close(); }
});

it('project review: deadline aborts the run and retains an uncooperative provider slot until it settles', async () => {
  const { input, body } = await request(), normal = provider(input);
  let release, stalledSignal, started;
  const begun = new Promise(resolve => { started = resolve; });
  let first = true;
  const web = await serve({ timeoutMs: 80, maxConcurrent: 1, generate: args => {
    if (!first) return normal.generate(args);
    first = false; stalledSignal = args.signal; started();
    return new Promise(resolve => { release = () => resolve(JSON.stringify(localProposal(input))); });
  } });
  try {
    const running = web.call(body);
    await begun;
    assert.equal((await web.call(body, { token: 'owner-two' })).data.code, 'review-busy');
    const timeout = await running;
    assert.equal(timeout.status, 504); assert.equal(stalledSignal.aborted, true);
    assert.equal((await web.call(body)).data.code, 'review-busy', 'ignored provider cancellation does not release compute capacity');
    assert.equal(normal.seen.length, 0, 'no subsequent model role executes after abort');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal((await web.call(body)).status, 200);
  } finally { release?.(); await web.close(); }
});

it('project review: closing the client aborts the provider and never starts the next specialist', async () => {
  const { body } = await request();
  let begin, observedAbort, calls = 0;
  const started = new Promise(resolve => { begin = resolve; });
  const cancelled = new Promise(resolve => { observedAbort = resolve; });
  const web = await serve({ perSessionRuns: 1, generate: ({ signal }) => {
    calls++; begin();
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { observedAbort(); reject(new Error('private transport cancellation detail')); }, { once: true });
    });
  } });
  const controller = new AbortController();
  try {
    const running = web.call(body, { signal: controller.signal });
    await started; controller.abort();
    await assert.rejects(running, /abort/i);
    await cancelled;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal((await web.call(body)).data.code, 'review-limit', 'cancelled work consumes its reserved run');
  } finally { controller.abort(); await web.close(); }
});
