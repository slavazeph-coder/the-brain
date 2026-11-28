// The developer platform's sandbox must answer like the real World Projects service. The same scripted workflow,
// including its refusals, runs through the real SDK against the production handlers (PGlite) and against the sandbox;
// statuses, error codes and response shapes must match step for step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createProjectsClient, createIdempotencyKey } from '../../brainsnn-r3f-app/public/world/projects-client.mjs';
import { createSandboxApi } from '../../brainsnn-r3f-app/public/platform/platform-sandbox.mjs';
import { startProjectPlatformFixture } from './project-platform-server.mjs';
import { snippets } from '../../brainsnn-r3f-app/public/platform/platform-snippets.mjs';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const sha = text => createHash('sha256').update(text).digest('hex');

/** Key paths of a JSON value: objects by key, arrays by their first element, leaves by JSON type. */
function signature(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) { out.add(`${prefix}[]`); if (value.length) signature(value[0], `${prefix}[0]`, out); return out; }
  if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) signature(v, `${prefix}.${k}`, out); return out; }
  out.add(`${prefix}:${value === null ? 'null' : typeof value}`);
  return out;
}

async function workflow({ baseUrl, fetchImpl, tokens }) {
  const client = role => createProjectsClient({ apiKey: tokens[role], baseUrl, fetchImpl });
  const raw = async (role, path, init = {}) => {
    const response = await (fetchImpl || globalThis.fetch)(baseUrl + path, { ...init, headers: { Authorization: `Bearer ${tokens[role]}`, ...(init.headers || {}) } });
    return { status: response.status, body: await response.json(), replayed: response.headers.get('Idempotency-Replayed') };
  };
  const steps = [];
  const step = async (name, run) => {
    try { const body = await run(); steps.push({ name, status: 'ok', body }); return body; }
    catch (error) { steps.push({ name, status: error.status, code: error.code }); return null; }
  };
  const editor = client('editor'), reviewer = client('reviewer'), admin = client('admin'), reader = client('reader');
  await step('me', () => editor.me());
  const created = await step('create project', () => editor.createProject({ title: 'Warehouse aisle 4', description: 'Contract test fixture.' }, { idempotencyKey: createIdempotencyKey() }));
  let project = created.project;
  const text = 'As-is scan record (contract fixture).\n';
  const source = await step('add source', () => editor.addSource(project.id, { expected_version: project.version, name: 'reconstruction.json', media_type: 'application/json', content_text: text, sha256: sha(text) }));
  project = source.project;
  const asIs = await step('as-is revision', () => editor.createRevision(project.id, { expected_version: project.version, label: 'As-is', kind: 'as_is', source_ids: [source.resource.id],
    robot: { model: 'Cart AMR', width_m: 0.7, margin_m: 0.08 }, task: { kind: 'route', goal: 'Dock to aisle 4.' } }));
  project = asIs.project;
  await step('stale version refused', () => editor.createRevision(project.id, { expected_version: project.version - 1, label: 'Late', kind: 'as_is', source_ids: [source.resource.id],
    robot: { model: 'Cart AMR' }, task: { kind: 'route', goal: 'x' } }));
  const proposed = await step('proposed revision', () => editor.createRevision(project.id, { expected_version: project.version, label: 'Proposed', kind: 'proposed', source_ids: [source.resource.id],
    robot: { model: 'Cart AMR', width_m: 0.7, margin_m: 0.08 }, task: { kind: 'route', goal: 'Dock to aisle 4 around the crate.' }, parent_revision_id: asIs.resource.id }));
  project = proposed.project;
  await step('measured without value refused', () => editor.addEvidence(project.id, { expected_version: project.version, revision_id: asIs.resource.id, source_id: source.resource.id,
    kind: 'measured', claim: 'Aisle width', locator: { note: 'tape' } }));
  const evidence = await step('evidence', () => editor.addEvidence(project.id, { expected_version: project.version, revision_id: asIs.resource.id, source_id: source.resource.id,
    component_id: 'candidate-1', kind: 'observed', claim: 'A crate now stands in aisle 4.', value: 0.6, unit: 'm2', locator: { note: 'world-update.json candidates[0]' }, uncertainty: 0.1 }));
  project = evidence.project;
  const change = await step('change', () => editor.createChange(project.id, { expected_version: project.version, base_revision_id: asIs.resource.id,
    proposed_revision_id: proposed.resource.id, title: 'Route around the crate', reason: 'The walk saw a crate.', evidence_ids: [evidence.resource.id] }));
  project = change.project;
  await step('editor cannot approve', () => editor.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'approve', reason: 'Looks right.' }));
  await step('approval waits for evidence', () => reviewer.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'approve', reason: 'Looks right.' }));
  const confirmed = await step('confirm evidence', () => reviewer.reviewEvidence(project.id, evidence.resource.id, { expected_version: project.version, decision: 'confirmed', reason: 'Seen in frames 2 and 3.' }));
  project = confirmed.project;
  const approved = await step('approve', () => reviewer.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'approve', reason: 'The crate is real.' }));
  project = approved.project;
  await step('approve twice refused', () => reviewer.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'approve', reason: 'Again.' }));
  const implemented = await step('implemented', () => editor.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'implemented', reason: 'Route updated.' }));
  project = implemented.project;
  await step('verification needs a trial id', () => reviewer.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'verified', reason: 'Ran it.' }));
  await step('trial', () => editor.createTrial(project.id, { expected_version: project.version, revision_id: proposed.resource.id, robot_model: 'Cart AMR',
    task: 'Dock to aisle 4 around the crate.', kind: 'simulation', outcome: 'pass', prediction: 'pass', source_ids: [source.resource.id], notes: 'Contract fixture.', occurred_at: new Date().toISOString() }));
  // A physical pass followed by a later physical fail: the earlier pass cannot verify the change.
  project = (await reader.getProject(project.id)).project;
  const measured = await step('measured evidence', () => editor.addEvidence(project.id, { expected_version: project.version, revision_id: proposed.resource.id, source_id: source.resource.id,
    component_id: 'aisle-4', kind: 'measured', claim: 'Clearance past the crate.', value: 0.42, unit: 'm', locator: { note: 'tape at the crate' }, uncertainty: 0.01 }));
  project = measured.project;
  project = (await step('confirm measurement', () => reviewer.reviewEvidence(project.id, measured.resource.id, { expected_version: project.version, decision: 'confirmed', reason: 'Tape photo.' }))).project;
  const trialAt = Date.now() + 1000;
  const physical = (outcome, at) => editor.createTrial(project.id, { expected_version: project.version, revision_id: proposed.resource.id, robot_model: 'Cart AMR',
    task: 'Dock to aisle 4 around the crate.', kind: 'physical', outcome, prediction: 'pass', source_ids: [source.resource.id], measurement_evidence_ids: [measured.resource.id],
    notes: 'Contract fixture.', occurred_at: new Date(at).toISOString() });
  const passed = await step('physical pass', () => physical('pass', trialAt));
  project = passed.project;
  project = (await step('later physical fail', () => physical('fail', trialAt + 1000))).project;
  await step('earlier pass cannot verify', () => reviewer.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'verified', reason: 'Passed once.', trial_id: passed.resource.id }));
  await step('get project', () => reader.getProject(project.id));
  await step('get source', () => reader.getSource(project.id, source.resource.id));
  await step('reader cannot write', () => reader.createProject({ title: 'Nope' }));
  await step('empty title refused', () => editor.createProject({ title: '' }));
  await step('unknown project', () => reader.getProject('proj_000000000000000000000000'));
  await step('usage', () => reader.usage());
  await step('keys need admin', () => editor.listKeys());
  await step('list keys', () => admin.listKeys());
  const issued = await step('create key', () => admin.createKey({ actor_name: 'Contract reviewer', role: 'reviewer' }));
  await step('revoke key', () => admin.revokeKey(issued.key.id, {}));
  await step('revoked key refused', () => createProjectsClient({ apiKey: issued.token, baseUrl, fetchImpl }).me());
  await step('no key', () => createProjectsClient({ apiKey: '', baseUrl, fetchImpl }).listProjects());
  // Idempotency, below the SDK: a replay answers the same; another body under the same key is refused; none at all is refused.
  const key = `contract-${randomUUID()}`;
  const post = body => raw('editor', '/projects', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key } });
  const first = await post({ title: 'Idempotent' }), again = await post({ title: 'Idempotent' }), other = await post({ title: 'Other' });
  steps.push({ name: 'replay', status: again.status, replayed: again.replayed, same: again.body.project?.id === first.body.project?.id });
  steps.push({ name: 'key reuse refused', status: other.status, code: other.body.error?.code });
  const none = await raw('editor', '/projects', { method: 'POST', body: '{"title":"x"}', headers: { 'Content-Type': 'application/json' } });
  steps.push({ name: 'no idempotency key', status: none.status, code: none.body.error?.code });
  const notJson = await raw('editor', '/projects', { method: 'POST', body: 'title=x', headers: { 'Content-Type': 'text/plain', 'Idempotency-Key': `contract-${randomUUID()}` } });
  steps.push({ name: 'json required', status: notJson.status, code: notJson.body.error?.code });
  return steps;
}

test('the sandbox answers the scripted workflow exactly like the real service', async () => {
  // A fresh workspace, so the real service starts as empty as the sandbox even on a shared CI database.
  const fixture = await startProjectPlatformFixture({ tenantId: `tenant_platform_contract_${randomUUID().slice(0, 8)}` });
  try {
    const real = await workflow({ baseUrl: `${fixture.url}/api/world/v1`,
      tokens: Object.fromEntries(Object.entries(fixture.credentials).map(([role, value]) => [role, value.token])) });
    const sandbox = createSandboxApi();
    const simulated = await workflow({ baseUrl: '/api/world/v1', fetchImpl: sandbox.fetch, tokens: sandbox.principals });
    assert.deepEqual(simulated.map(s => s.name), real.map(s => s.name));
    for (const [index, expected] of real.entries()) {
      const actual = simulated[index];
      assert.equal(actual.status, expected.status, `${expected.name}: status`);
      assert.equal(actual.code, expected.code, `${expected.name}: error code`);
      if (expected.replayed !== undefined) assert.deepEqual([actual.replayed, actual.same], [expected.replayed, expected.same], expected.name);
      if (expected.body) {
        const want = signature(expected.body), got = signature(actual.body);
        // The service adds media fields to usage that the sandbox does not simulate; everything else must match.
        const ignore = path => expected.name === 'usage' && /^\.(usage|limits)\./.test(path);
        const missing = [...want].filter(p => !got.has(p) && !ignore(p)), extra = [...got].filter(p => !want.has(p) && !ignore(p));
        assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `${expected.name}: response shape`);
      }
    }
    // The scripted refusals really are refusals.
    const codes = Object.fromEntries(real.filter(s => s.code).map(s => [s.name, s.code]));
    assert.deepEqual(codes, {
      'stale version refused': 'stale-version', 'measured without value refused': 'invalid-input', 'editor cannot approve': 'forbidden',
      'approval waits for evidence': 'evidence-unreviewed', 'approve twice refused': 'invalid-transition', 'verification needs a trial id': 'invalid-input', 'earlier pass cannot verify': 'latest-physical-trial-required',
      'reader cannot write': 'forbidden', 'empty title refused': 'invalid-input', 'unknown project': 'not-found', 'keys need admin': 'forbidden',
      'revoked key refused': 'invalid-api-key', 'no key': 'missing_api_key', 'key reuse refused': 'idempotency-conflict',
      'no idempotency key': 'idempotency-key-required', 'json required': 'json-required',
    });
  } finally {
    await fixture.close();
  }
});

test('the sandbox is private to the page and says it is a sandbox', async () => {
  const a = createSandboxApi(), b = createSandboxApi();
  const client = createProjectsClient({ apiKey: a.principals.editor, baseUrl: '/api/world/v1', fetchImpl: a.fetch });
  await client.createProject({ title: 'Only in sandbox a' });
  const other = createProjectsClient({ apiKey: b.principals.editor, baseUrl: '/api/world/v1', fetchImpl: b.fetch });
  assert.equal((await other.listProjects()).projects.length, 0);
  await assert.rejects(createProjectsClient({ apiKey: a.principals.editor, baseUrl: '/api/world/v1', fetchImpl: b.fetch }).me(), error => error.code === 'invalid-api-key');
  const status = await client.status();
  assert.equal(status.sandbox, true);
  await assert.rejects(client.processingRequest('/capabilities'), error => error.status === 501 && error.code === 'sandbox-not-simulated');
});

test('the JavaScript snippet runs as copied: Node, with the SDK files saved beside it', async () => {
  const fixture = await startProjectPlatformFixture({ tenantId: `tenant_platform_snippet_${randomUUID().slice(0, 8)}` });
  const dir = await mkdtemp(join(tmpdir(), 'brainsnn-snippet-'));
  try {
    const { javascript } = snippets({ method: 'POST', path: '/projects', body: { title: 'Snippet aisle' }, op: { id: 'createProject' }, origin: fixture.url });
    assert.match(javascript, /curl -sS -O .*projects-client\.mjs -O .*projects-sha256\.mjs/);
    // The same files the curl line in the snippet downloads.
    for (const file of ['projects-client.mjs', 'projects-sha256.mjs']) {
      await copyFile(new URL(`../../brainsnn-r3f-app/public/world/${file}`, import.meta.url), join(dir, file));
    }
    await writeFile(join(dir, 'example.mjs'), javascript);
    const { stdout } = await promisify(execFile)(process.execPath, ['example.mjs'], { cwd: dir, timeout: 30_000,
      env: { ...process.env, BRAINSNN_API_KEY: fixture.credentials.editor.token } });
    assert.match(stdout, /Snippet aisle/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await fixture.close();
  }
});

test('the sandbox retains a large inline source within the 512 KiB limit', async () => {
  const sandbox = createSandboxApi();
  const client = createProjectsClient({ apiKey: sandbox.principals.editor, baseUrl: '/api/world/v1', fetchImpl: sandbox.fetch });
  const { project } = await client.createProject({ title: 'Large source' });
  const content_text = 'a'.repeat(256 * 1024);
  const added = await client.addSource(project.id, { expected_version: project.version, name: 'walk.txt', media_type: 'text/plain', content_text });
  assert.equal(added.resource.bytes, content_text.length);
  assert.equal(added.resource.sha256, sha(content_text));
});

async function checkTrialInvalidation({ baseUrl, fetchImpl, tokens }, unsuccessfulOutcome) {
  const client = role => createProjectsClient({ apiKey: tokens[role], baseUrl, fetchImpl });
  const editor = client('editor'), reviewer = client('reviewer');
  let { project } = await editor.createProject({ title: 'Later outcomes' });
  const text = '{"scan":"as-is"}\n';
  const source = await editor.addSource(project.id, { expected_version: project.version, name: 'scan.json', media_type: 'application/json', content_text: text, sha256: sha(text) });
  project = source.project;
  const robot = { model: 'Cart AMR', width_m: 0.7, margin_m: 0.08 };
  const asIs = await editor.createRevision(project.id, { expected_version: project.version, label: 'As-is', kind: 'as_is', source_ids: [source.resource.id], robot, task: { kind: 'route', goal: 'Dock.' } });
  project = asIs.project;
  const proposed = await editor.createRevision(project.id, { expected_version: project.version, label: 'Proposed', kind: 'proposed', source_ids: [source.resource.id], robot,
    task: { kind: 'route', goal: 'Dock around the crate.' }, parent_revision_id: asIs.resource.id });
  project = proposed.project;
  const evidence = await editor.addEvidence(project.id, { expected_version: project.version, revision_id: asIs.resource.id, source_id: source.resource.id,
    component_id: 'crate', kind: 'observed', claim: 'A crate stands in the aisle.', value: 0.6, unit: 'm2', locator: { note: 'frame 2' }, uncertainty: 0.1 });
  project = evidence.project;
  const change = await editor.createChange(project.id, { expected_version: project.version, base_revision_id: asIs.resource.id, proposed_revision_id: proposed.resource.id,
    title: 'Route around the crate', reason: 'The walk saw a crate.', evidence_ids: [evidence.resource.id] });
  project = change.project;
  project = (await reviewer.reviewEvidence(project.id, evidence.resource.id, { expected_version: project.version, decision: 'confirmed', reason: 'Seen.' })).project;
  project = (await reviewer.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'approve', reason: 'Real.' })).project;
  project = (await editor.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'implemented', reason: 'Route updated.' })).project;
  const measured = await editor.addEvidence(project.id, { expected_version: project.version, revision_id: proposed.resource.id, source_id: source.resource.id,
    component_id: 'aisle', kind: 'measured', claim: 'Clearance past the crate.', value: 0.42, unit: 'm', locator: { note: 'tape' }, uncertainty: 0.01 });
  project = measured.project;
  project = (await reviewer.reviewEvidence(project.id, measured.resource.id, { expected_version: project.version, decision: 'confirmed', reason: 'Tape photo.' })).project;
  const at = Date.now() + 1000;
  const trial = (outcome, when, kind = 'physical', revision = proposed.resource) => editor.createTrial(project.id, {
    expected_version: project.version, revision_id: revision.id, robot_model: revision.robot.model, task: revision.task.goal,
    kind, outcome, prediction: 'pass', source_ids: [source.resource.id], measurement_evidence_ids: revision.id === proposed.resource.id ? [measured.resource.id] : [],
    notes: 'Contract fixture.', occurred_at: new Date(when).toISOString() });
  const passed = await trial('pass', at);
  project = passed.project;
  const verified = await reviewer.decideChange(project.id, change.resource.id, { expected_version: project.version, decision: 'verified', reason: 'Passed on site.', trial_id: passed.resource.id });
  assert.equal(verified.resource.status, 'verified');
  project = verified.project;
  const recordedChange = p => p.changes.find(c => c.id === change.resource.id);
  project = (await trial('fail', at - 1)).project;
  assert.equal(recordedChange(project).status, 'verified', 'backdated physical trial');
  project = (await trial('fail', at + 1000, 'simulation')).project;
  assert.equal(recordedChange(project).status, 'verified', 'later simulation');
  project = (await trial('fail', at + 1000, 'physical', asIs.resource)).project;
  assert.equal(recordedChange(project).status, 'verified', 'later physical trial on another revision');
  // The later record wins on recorded_project_version when occurrence times tie.
  const when = unsuccessfulOutcome === 'inconclusive' ? at : at + 1000;
  const unsuccessful = await trial(unsuccessfulOutcome, when);
  assert.equal(unsuccessful.project.version, project.version + 1);
  const readBack = (await reviewer.getProject(project.id)).project;
  const withdrawn = recordedChange(readBack);
  assert.equal(withdrawn.status, 'stale', `latest physical outcome: ${unsuccessfulOutcome}`);
  assert.equal(withdrawn.stale_reason, 'A later physical trial did not pass. The recorded verification needs a new review.');
  assert.ok(Number.isFinite(Date.parse(withdrawn.stale_at)));
  assert.equal(readBack.readiness.counts.stale_changes, 1);
}

async function checkConcurrentSources({ baseUrl, fetchImpl = fetch, tokens }) {
  const editor = createProjectsClient({ apiKey: tokens.editor, baseUrl, fetchImpl });
  const { project: before } = await editor.createProject({ title: 'Concurrent source requests' });
  const responses = [];
  const sendingEditor = createProjectsClient({ apiKey: tokens.editor, baseUrl, fetchImpl: async (...args) => {
    const response = await fetchImpl(...args);
    responses.push({ status: response.status, replay: response.headers.get('Idempotency-Replayed') });
    return response;
  } });
  const text2 = '{"walk":"later"}\n';
  const body = { expected_version: before.version, name: 'later.json', media_type: 'application/json', content_text: text2, sha256: sha(text2) };
  const prepared = sendingEditor.prepareMutation('addSource', [before.id, body]);
  const [first, second] = await Promise.all([prepared.run(), prepared.run()]);
  assert.deepEqual(responses.map(r => r.status), [201, 201]);
  assert.deepEqual(responses.map(r => r.replay).sort(), [null, 'true']);
  assert.deepEqual(first, second);
  assert.equal(first.applied_version, before.version + 1);
  const after = (await editor.getProject(before.id)).project;
  assert.equal(after.version, first.applied_version);
  assert.equal(after.sources.length, before.sources.length + 1);
  assert.deepEqual(after.sources.filter(s => s.name === body.name).map(s => s.id), [first.resource.id]);
  assert.equal(after.events.length, before.events.length + 1);
  assert.equal(after.events.at(-1).resource_id, first.resource.id);
  assert.equal(after.events.at(-1).type, 'source.retained');

  const next = { ...body, expected_version: after.version, name: 'next.json' };
  const conflictKey = { idempotencyKey: createIdempotencyKey() };
  const results = await Promise.allSettled([editor.addSource(before.id, next, conflictKey),
    editor.addSource(before.id, { ...next, name: 'other.json' }, conflictKey)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  const success = results.find(r => r.status === 'fulfilled');
  const conflict = results.find(r => r.status === 'rejected');
  assert.equal(conflict.reason.status, 409);
  assert.equal(conflict.reason.code, 'idempotency-conflict');
  const retry = { ...next, expected_version: success.value.applied_version };
  const retryKey = { idempotencyKey: createIdempotencyKey() };
  await assert.rejects(editor.addSource(before.id, { ...retry, sha256: '0'.repeat(64) }, retryKey),
    { status: 422, code: 'source-hash-mismatch' });
  const corrected = await editor.addSource(before.id, retry, retryKey);
  const final = (await editor.getProject(before.id)).project;
  assert.equal(final.version, after.version + 2);
  assert.equal(final.sources.length, after.sources.length + 2);
  assert.ok(final.sources.some(s => s.id === corrected.resource.id));
}

test('sandbox and production mutation contracts', async t => {
  const fixture = await startProjectPlatformFixture({ tenantId: `tenant_platform_later_${randomUUID().slice(0, 8)}` });
  try {
    const tokens = Object.fromEntries(Object.entries(fixture.credentials).map(([role, value]) => [role, value.token]));
    const sandbox = createSandboxApi();
    for (const [name, api] of [
      ['production', { baseUrl: `${fixture.url}/api/world/v1`, tokens }],
      ['sandbox', { baseUrl: '/api/world/v1', fetchImpl: sandbox.fetch, tokens: sandbox.principals }],
    ]) {
      for (const outcome of ['fail', 'inconclusive']) {
        await t.test(`${name}: latest physical ${outcome} withdraws verification`, () => checkTrialInvalidation(api, outcome));
      }
      await t.test(`${name}: concurrent source requests apply once and replay once`, () => checkConcurrentSources(api));
    }
  } finally {
    await fixture.close();
  }
});
