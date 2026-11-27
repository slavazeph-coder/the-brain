import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWorldProjectService } from '../../brainsnn-r3f-app/src/server/worldProjectService.js';
import { createProjectsClient } from '../../brainsnn-r3f-app/public/world/projects-client.mjs';
import { applyWorldUpdatePlan, checkWorldUpdatePlan } from '../../brainsnn-r3f-app/public/world/world-update-plan.mjs';
import { createProjectTestPool } from './helpers/project-test-pool.mjs';

// The plan world_update.py writes for an authored update (test_world_update.py keeps this copy in step).
const plan = JSON.parse(await readFile(new URL('./fixtures/world-update-plan.json', import.meta.url), 'utf8'));

const AS_IS_SCAN = 'As-is scan record (authored fixture).\n';  // test_world_update.py names this scan in the plan

async function site({ asIsScan = AS_IS_SCAN } = {}) {
  const pool = await createProjectTestPool();
  const service = createWorldProjectService({ pool, env: {}, now: () => Date.parse('2026-11-25T12:00:00Z') });
  await service.initialize();
  const tenant = await service.provisionTenant({ name: `World update ${randomUUID()}` });
  const editor = await service.provisionKey({ tenant_id: tenant.id, actor_name: 'Robot A operator', role: 'editor' });
  const reviewer = await service.provisionKey({ tenant_id: tenant.id, actor_name: 'Site reviewer', role: 'reviewer' });
  const server = createServer((req, res) => service.handle(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/world/v1`;
  const operator = createProjectsClient({ apiKey: editor.token, baseUrl });
  const review = createProjectsClient({ apiKey: reviewer.token, baseUrl });
  // The site already has its as-is scan recorded: a source and the as-is revision.
  let { project } = await operator.createProject({ title: 'Rendered room', description: 'Authored software fixture; no physical run.' });
  const source = await operator.addSource(project.id, { expected_version: project.version, name: 'reconstruction.json', media_type: 'text/plain',
    content_text: asIsScan, sha256: createHash('sha256').update(asIsScan).digest('hex') });
  const asIs = await operator.createRevision(project.id, { expected_version: source.project.version, label: 'As-is scan', kind: 'as_is',
    source_ids: [source.resource.id], robot: { model: 'Phone camera standing in for robot A' }, task: { kind: 'survey', goal: 'Scan the room.' } });
  return { operator, review, project: asIs.project, asIsId: asIs.resource.id,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await service.close(); await pool.end(); } };
}

test('a world-update plan is recorded for review against the current as-is revision, and only another person can approve it', async () => {
  const f = await site();
  try {
    const seen = [];
    const { project, ids } = await applyWorldUpdatePlan(f.operator, f.project.id, plan, { onStep: step => seen.push(step.ref) });
    assert.deepEqual(seen, plan.steps.map(step => step.ref));
    assert.equal(project.current_as_is_revision_id, f.asIsId, 'Proposing never replaces the as-is state.');

    const retained = await f.operator.getSource(project.id, ids.source);
    assert.equal(retained.source.sha256, plan.source_sha256);
    assert.equal(Buffer.from(retained.data_base64, 'base64').toString('utf8'), plan.steps[0].body.content_text);

    const site = (await f.operator.getProject(project.id)).project;
    const records = kind => site[kind];
    const evidence = records('evidence').find(item => item.id === ids['evidence-candidate-1']);
    assert.equal(evidence.revision_id, f.asIsId);
    assert.equal(evidence.kind, 'observed');
    assert.equal(evidence.status, 'unreviewed');
    for (const robot of ['robot-a', 'robot-b']) {
      const revision = records('revisions').find(item => item.id === ids[`revision-${robot}`]);
      assert.equal(revision.kind, 'proposed');
      assert.equal(revision.parent_revision_id, f.asIsId);
      const change = records('changes').find(item => item.id === ids[`change-${robot}`]);
      assert.equal(change.status, 'pending');
      assert.deepEqual(change.evidence_ids, [ids['evidence-candidate-1']]);
    }

    // The operator who proposed cannot approve; the reviewer must confirm the evidence first, then may approve.
    let current = project;
    const decide = (client, decision) => client.decideChange(current.id, ids['change-robot-b'],
      { expected_version: current.version, decision, reason: 'Checked the plan view and the walk frames.' });
    await assert.rejects(decide(f.operator, 'approve'), error => error.status === 403 || error.code === 'independent-review-required');
    await assert.rejects(decide(f.review, 'approve'), error => error.status === 409);
    const confirmed = await f.review.reviewEvidence(current.id, ids['evidence-candidate-1'],
      { expected_version: current.version, decision: 'confirmed', reason: 'The crate is in the walk frames.' });
    current = confirmed.project;
    const approved = await decide(f.review, 'approve');
    assert.equal(approved.resource.status, 'approved');
  } finally {
    await f.close();
  }
});

test('a plan is refused against a different scan or when it is already recorded, unless the operator says otherwise', async () => {
  const other = await site({ asIsScan: 'A later scan of the same room.\n' });
  try {
    await assert.rejects(applyWorldUpdatePlan(other.operator, other.project.id, plan), /not a source of the project's current as-is revision/);
    const { ids } = await applyWorldUpdatePlan(other.operator, other.project.id, plan, { baseline: 'any' });
    assert.ok(ids['change-robot-b']);
  } finally {
    await other.close();
  }
  const f = await site();
  try {
    await applyWorldUpdatePlan(f.operator, f.project.id, plan);
    const before = (await f.operator.getProject(f.project.id)).project.version;
    await assert.rejects(applyWorldUpdatePlan(f.operator, f.project.id, plan), /already recorded/);
    assert.equal((await f.operator.getProject(f.project.id)).project.version, before, 'Nothing was recorded twice.');
    const unnamed = structuredClone(plan);
    delete unnamed.as_is_scan;
    unnamed.source_sha256 = 'f'.repeat(64);
    await assert.rejects(applyWorldUpdatePlan(f.operator, f.project.id, unnamed), /does not name the scan/);
  } finally {
    await f.close();
  }
});

test('plans are checked before any request: references must exist and versions are read when each step runs', async () => {
  assert.doesNotThrow(() => checkWorldUpdatePlan(plan));
  const broken = structuredClone(plan);
  broken.steps[1].body.source_id = '$later';
  assert.throws(() => checkWorldUpdatePlan(broken), /before it exists/);
  const versioned = structuredClone(plan);
  versioned.steps[0].body.expected_version = 1;
  assert.throws(() => checkWorldUpdatePlan(versioned), /expected_version/);
  const unknown = structuredClone(plan);
  unknown.steps[0].action = 'decideChange';
  assert.throws(() => checkWorldUpdatePlan(unknown), /known action/);
  assert.throws(() => checkWorldUpdatePlan({ schema: 'other', steps: [] }), /project-request-plan/);
});

test('a plan cannot be proposed against a site without an as-is revision', async () => {
  const client = { getProject: async () => ({ project: { id: 'prj_x', version: 1, current_as_is_revision_id: null } }) };
  await assert.rejects(applyWorldUpdatePlan(client, 'prj_x', plan), /as-is revision first/);
});
