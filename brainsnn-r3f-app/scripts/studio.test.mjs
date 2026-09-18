import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, getModel, assertCatalog, availability, resolveWorkflows } from '../src/generation/catalog/index.js';
import { parseSettings } from '../src/generation/catalog/types.js';
import { STATUS_MAP, submitGeneration, readRequest } from '../src/server/studio-contract.js';

const FULL = { WAN22_WORKFLOW_ID: 'wf-wan22-i2v', WAN22_DECODE_WORKFLOW_ID: 'wf-wan22-decode' };

test('the catalog is internally consistent and every entry is real', () => {
  assert.equal(assertCatalog(), MODELS.length);
  assert.equal(MODELS.length, 3);
  assert.equal(MODELS.filter(m => m.id.startsWith('wan')).length, 2);
  assert.throws(() => assertCatalog([...MODELS, MODELS[0]]), /Duplicate model id/);
});

test('an unknown model is refused, not silently defaulted', () => {
  assert.throws(() => getModel('kling-3'), /Unknown model: kling-3/);
  assert.equal(submitGeneration('sora', { prompt: 'x' }, {}).status, 400);
});

test('an unknown setting key is rejected rather than ignored', () => {
  assert.throws(() => parseSettings(getModel('wan-2.2-i2v-14b-fp8'), { quality: 'high' }), /Unknown setting: quality/);
});

test('settings validate against the declared schema and never leak extra keys', () => {
  const model = getModel('wan-2.2-i2v-14b-fp8');
  assert.throws(() => parseSettings(model, { aspectRatio: '4:3' }), /Invalid aspectRatio/);
  assert.throws(() => parseSettings(model, { cfgScale: 99 }), /Invalid cfgScale/);
  assert.throws(() => parseSettings(model, { steps: '8' }), /Invalid steps/);
  const parsed = parseSettings(model, { aspectRatio: '9:16' });
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(model.settings).sort());
  assert.equal(parsed.aspectRatio, '9:16');
  assert.equal(parsed.seed, 0);
  assert.equal(parsed.steps, '4');
});

test('a non-numeric value falls back to the declared default instead of being coerced', () => {
  const parsed = parseSettings(getModel('wan-2.2-i2v-14b-fp8'), { seed: '9999', cfgScale: null });
  assert.equal(parsed.seed, 0);
  assert.equal(parsed.cfgScale, 1);
});

test('a model with no pinned workflow is unavailable, and refusal names the missing key', () => {
  const res = submitGeneration('wan-2.2-i2v-14b-fp8', { prompt: 'a lighthouse' }, { env: {} });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'workflow_unconfigured');
  assert.deepEqual(res.body.missing, ['WAN22_WORKFLOW_ID']);
});

test('a half-configured two-stage model is refused, not guessed', () => {
  const only = { WAN22_WORKFLOW_ID: 'wf-a' };
  const res = submitGeneration('wan-2.2-i2v-14b-fp8-cpu-vae', { prompt: 'p' }, { env: only });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body.missing, ['WAN22_DECODE_WORKFLOW_ID']);
});

test('a configured model submits to our plane with parsed settings and pinned bindings', () => {
  const calls = [];
  const res = submitGeneration('wan-2.2-i2v-14b-fp8', { prompt: 'a lighthouse at dusk', settings: { segments: 3 } }, { env: FULL, submit: v => { calls.push(v); return { job: { id: 'j1', status: 'queued' } }; } });
  assert.equal(res.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'video');
  assert.equal(calls[0].payload.prompt, 'a lighthouse at dusk');
  assert.equal(calls[0].payload.settings.segments, 3);
  assert.equal(calls[0].payload.bindings.WAN22_WORKFLOW_ID, 'wf-wan22-i2v');
});

test('a duplicate submission is reported as 200, not a second render', () => {
  const res = submitGeneration('wan-2.2-i2v-14b-fp8', { prompt: 'p' }, { env: FULL, submit: () => ({ duplicate: true }) });
  assert.equal(res.status, 200);
});

test('a missing prompt is refused before it becomes a job', () => {
  const res = submitGeneration('wan-2.2-i2v-14b-fp8', { prompt: '   ' }, { env: FULL, submit: () => { throw new Error('must not submit'); } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /prompt is required/);
});

test('the local assembler needs no workflow and does not claim GPU capability', () => {
  const entry = getModel('reel-assemble');
  assert.deepEqual(entry.workflowEnv, []);
  assert.equal(resolveWorkflows(entry, {}).available, true);
  assert.equal(availability({}).find(m => m.id === 'reel-assemble').available, true);
  assert.equal(availability({ WAN22_WORKFLOW_ID: 'x' }).find(m => m.id.endsWith('cpu-vae')).available, false);
});

test('availability is derived from the environment, not asserted', () => {
  assert.equal(availability({}).filter(m => m.available).length, 1);
  assert.equal(availability(FULL).filter(m => m.available).length, 3);
});

test('every queue state maps to a status a client can render', () => {
  for (const [ours, theirs] of Object.entries(STATUS_MAP)) {
    const res = readRequest('j1', { find: () => ({ id: 'j1', model: 'wan-2.2-i2v-14b-fp8', status: ours, artifacts: [] }) });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, theirs);
    assert.equal(res.body.rawStatus, ours);
    assert.ok(['queued', 'running', 'succeeded', 'failed'].includes(theirs), `${ours} -> ${theirs} is unrenderable`);
  }
});

test('an unknown request id is a 404, not an empty success', () => {
  const res = readRequest('nope', { find: () => null });
  assert.equal(res.status, 404);
  assert.equal(readRequest('j', {}).status, 404);
});
