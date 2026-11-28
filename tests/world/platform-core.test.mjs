// Developer platform logic: the explorer's catalogue and prefilled bodies, copy-ready snippets, and the planner toy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createProjectsClient } from '../../brainsnn-r3f-app/public/world/projects-client.mjs';
import { createSandboxApi } from '../../brainsnn-r3f-app/public/platform/platform-sandbox.mjs';
import { operations, exampleBody, fillPath, pathDefaults, learn, GROUPS } from '../../brainsnn-r3f-app/public/platform/platform-catalog.mjs';
import { snippets } from '../../brainsnn-r3f-app/public/platform/platform-snippets.mjs';
import * as planner from '../../brainsnn-r3f-app/public/platform/platform-planner.mjs';

const openapi = JSON.parse(await readFile(new URL('../../brainsnn-r3f-app/public/world/projects-api.openapi.json', import.meta.url), 'utf8'));
const ops = operations(openapi);
const byId = Object.fromEntries(ops.map(op => [op.id, op]));

test('every documented operation is in the catalogue, in a named group', () => {
  const documented = Object.values(openapi.paths).flatMap(item => ['get', 'post', 'put', 'delete', 'head'].filter(m => item[m]));
  assert.equal(ops.length, documented.length);
  const groups = new Set(GROUPS.map(g => g.id));
  for (const op of ops) assert.ok(groups.has(op.group), `${op.method} ${op.path} has no group`);
  assert.equal(byId.getStatus.public, true);
  assert.equal(byId.createProject.idempotent, true);
  assert.deepEqual(byId.reviewEvidence.pathParams, ['project_id', 'evidence_id']);
});

test('the prefilled bodies carry a first-time developer through the whole review workflow', async () => {
  const sandbox = createSandboxApi();
  let context = {};
  const send = async (id, role = 'editor') => {
    const op = byId[id];
    const body = exampleBody(openapi, op, context);
    const path = fillPath(op.path, pathDefaults(context));
    assert.ok(!/\{/.test(path), `${id}: unfilled ${path}`);
    const response = await sandbox.fetch(`/api/world/v1${path}`, { method: op.method,
      headers: { Authorization: `Bearer ${sandbox.principals[role]}`, 'Content-Type': 'application/json', 'Idempotency-Key': `platform-test-${randomUUID()}` },
      body: body ? JSON.stringify(body) : undefined });
    const json = await response.json();
    assert.ok(response.ok, `${id}: ${response.status} ${JSON.stringify(json.error)} for ${JSON.stringify(body)}`);
    context = learn(context, op, json);
    return json;
  };
  await send('createProject');
  await send('addSource');
  await send('createRevision');
  assert.ok(context.as_is_revision_id);
  await send('createRevision');
  assert.ok(context.proposed_revision_id);
  await send('addEvidence');
  await send('createChange');
  await send('reviewEvidence', 'reviewer');
  const approved = await send('decideChange', 'reviewer');
  assert.equal(approved.resource.status, 'approved');
  assert.equal(context.version, approved.project.version);
  // A second site starts clean: its first revision is its own as-is baseline, not a proposal on the first site's.
  const first = context.project_id;
  await send('createProject');
  assert.notEqual(context.project_id, first);
  for (const key of ['source_id', 'as_is_revision_id', 'proposed_revision_id', 'evidence_id', 'change_id']) assert.equal(context[key], undefined, key);
  await send('addSource');
  const baseline = await send('createRevision');
  assert.equal(baseline.resource.kind, 'as_is');
  assert.equal(baseline.resource.parent_revision_id ?? null, null);
});

test('snippets are copy-ready and never contain the key', () => {
  const op = byId.createProject;
  const out = snippets({ method: 'POST', path: '/projects', body: { title: "Bob's aisle" }, op, origin: 'https://www.brainsnn.com' });
  assert.match(out.curl, /-X POST "https:\/\/www\.brainsnn\.com\/api\/world\/v1\/projects"/);
  assert.match(out.curl, /Idempotency-Key: \$\(uuidgen\)/);
  assert.ok(out.curl.includes(`'{"title":"Bob'\\''s aisle"}'`), out.curl);  // shell-safe single quotes
  assert.match(out.javascript, /client\.createProject\(\{/);
  assert.match(out.python, /requests\.request\("POST", "https:\/\/www\.brainsnn\.com\/api\/world\/v1\/projects"/);
  assert.match(out.python, /"title": "Bob's aisle"/);
  for (const text of Object.values(out)) assert.ok(!/bsk_/.test(text));
  const review = snippets({ method: 'POST', path: '/projects/proj_1/evidence/ev_2/review', body: { decision: 'confirmed' }, op: byId.reviewEvidence });
  assert.match(review.javascript, /client\.reviewEvidence\("proj_1", "ev_2", \{/);
  const status = snippets({ method: 'GET', path: '/status', op: byId.getStatus });
  assert.ok(!status.curl.includes('Authorization') && status.javascript.includes('client.status()'));
  const jobs = snippets({ method: 'GET', path: '/processing/jobs', op: { id: 'listProcessingJobs' } });
  assert.match(jobs.javascript, /processingRequest\("\/jobs", \{ method: "GET" \}\)/);
});

test('the planner toy keeps the world-update outcomes: a box reroutes a robot, a wall of boxes blocks a big one', () => {
  const before = planner.grid(40, 24), after = planner.grid(40, 24);
  planner.setBox(after, 18, 6, 4, 12);  // a crate across the middle of the aisle
  const start = [8, 12], goal = [31, 12];  // clear of the inflated outer walls for both footprints
  const small = planner.plan(before, after, 1.5, start, goal);
  assert.equal(small.outcome, 'rerouted');
  assert.ok(planner.length(small.after) > planner.length(small.before));
  const big = planner.plan(before, after, 4.5, start, goal);
  assert.equal(big.outcome, 'blocked');
  assert.equal(planner.plan(before, before, 1.5, start, goal).outcome, 'unchanged');
  const cluttered = planner.grid(40, 24);
  planner.setBox(cluttered, 18, 6, 4, 12);
  assert.equal(planner.plan(cluttered, before, 1.5, start, goal).outcome, 'shortened');
  const walled = planner.grid(40, 24);
  planner.setBox(walled, 18, 0, 2, 24);
  assert.equal(planner.plan(walled, before, 1.5, start, goal).outcome, 'opened');
  // A box beside a diagonal step leaves every old cell free, but the step now cuts its corner.
  const open = planner.grid(5, 5), corner = planner.grid(5, 5);
  planner.setBox(corner, 2, 1, 1, 1);
  const diag = planner.plan(open, corner, 0, [1, 1], [3, 3]);
  assert.equal(diag.outcome, 'rerouted');
  assert.ok(planner.pathFree(corner, planner.astar(corner, [1, 1], [3, 3])) && !planner.pathFree(corner, [[1, 1], [2, 2], [3, 3]]));
  assert.ok(!planner.lineFree(corner, [1, 1], [3, 3]), 'a shortcut may not slip between blocked cells');
  assert.notDeepEqual(diag.after, [[1, 1], [3, 3]]);
  // The cell route can stay clear while its old straight shortcut now crosses the new box: the after route is drawn on the new map.
  const wide = planner.grid(10, 10), boxed = planner.grid(10, 10);
  planner.setBox(boxed, 2, 2, 1, 1);
  const kept = planner.plan(wide, boxed, 0, [1, 1], [8, 5]);
  assert.equal(kept.outcome, 'unchanged');
  for (let k = 1; k < kept.after.length; k++) assert.ok(planner.lineFree(boxed, kept.after[k - 1], kept.after[k]), JSON.stringify(kept.after));
  for (const path of [small.after, small.before]) {
    for (let k = 1; k < path.length; k++) assert.ok(planner.lineFree(planner.inflate(after, 1.5), path[k - 1], path[k]) || path === small.before);
  }
});
