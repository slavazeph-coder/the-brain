// The developer platform's sandbox must answer like the real World Projects service. The same scripted workflow,
// including its refusals, runs through the real SDK against the production handlers (PGlite) and against the sandbox;
// statuses, error codes and response shapes must match step for step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createProjectsClient, createIdempotencyKey } from '../../brainsnn-r3f-app/public/world/projects-client.mjs';
import { createSandboxApi } from '../../brainsnn-r3f-app/public/platform/platform-sandbox.mjs';
import { startProjectPlatformFixture } from './project-platform-server.mjs';

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
      'approval waits for evidence': 'evidence-unreviewed', 'approve twice refused': 'invalid-transition', 'verification needs a trial id': 'invalid-input',
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
