import test from 'node:test';
import assert from 'node:assert/strict';
import {createBimWorkbench, createBimMemoryStore, prepareBimSource, bimWorkerCapacity, validateBimCloud, bimProjectSummary} from '../../brainsnn-r3f-app/public/world/bim-workbench.mjs';

const caps = {owner_id: 'test-owner', limits: {concurrent_jobs: 3}, owner_limits: {active_jobs: 3}, engines: [
  {id: 'scene-usd', available: true, input_kinds: ['cloud'], max_inputs: 1, dimension_checks: true, bim_review: true, registered_survey_cloud: true}]};
const output = [{name: 'scene.ifc', size: 24, sha256: 'f'.repeat(64)}];
const cloud = () => ({version: 1, kind: 'survey-scan-point-cloud', units: 'm', sourceFrame: 'survey-scan', coordinateFrame: 'right-handed-y-up',
  points: [[0, 0, 0, 120, 120, 120], [2, 0, 2, 120, 120, 120], [2, 2, 0, 120, 120, 120]],
  scale: {source: 'scan-file', metresPerUnit: 1, distance: null, spanUnits: null, selfReported: true, verified: false}, provenance: {metricVerified: false}});
const source = () => prepareBimSource(new File([JSON.stringify(cloud())], 'area.json'), {registrationConfirmed: true});
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
async function until(fn) {for (let i = 0; i < 1000; i++) {if (fn()) return; await tick();} throw Error('Condition did not arrive.');}
function fixture({capacity = 3, store = createBimMemoryStore(), hook, complete = true} = {}) {
  let serial = 0, maximum = 0; const jobs = new Map(), calls = [], saved = [];
  const id = () => (++serial).toString(16).padStart(32, '0');
  const client = {base: 'https://worker.example', token: 'never-persist-this-token', uploads: new WeakMap(),
    async upload(file, kind, signal, progress) {assert.equal(kind, 'cloud'); if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      const existing = this.uploads.get(file)?.id, uid = existing || id(); this.uploads.set(file, {id: uid}); progress(.5); progress(1); calls.push(['upload', uid]); return uid;},
    async request(path, options = {}) {
      calls.push([path, options]); if (hook) {const value = await hook(path, options, {jobs, calls, id, client}); if (value !== undefined) return value;}
      if (path === '/v1/jobs' && options.method === 'POST') {
        const value = {id: id(), engine: 'scene-usd', status: 'prepared', upload_ids: options.body.upload_ids, artifacts: []}; jobs.set(value.id, value); return {...value};
      }
      if (path === '/v1/jobs') return {jobs: [...jobs.values()].map(j => ({...j}))};
      const jid = path.split('/')[3], value = jobs.get(jid); assert.ok(value, `Unknown job ${path}`);
      if (path.endsWith('/start')) {value.status = 'running'; maximum = Math.max(maximum, [...jobs.values()].filter(j => j.status === 'running').length); return {...value};}
      if (options.method === 'DELETE') {if (!['complete', 'failed'].includes(value.status)) value.status = 'cancelled'; return {...value};}
      if (complete && value.status === 'running') {value.status = 'complete'; value.artifacts = output;}
      return {...value};
    },
    async download(jid, index) {return `https://worker.example/v1/download/${jid}-${index}`;},
  };
  const c = structuredClone(caps); c.limits.concurrent_jobs = capacity;
  const model = createBimWorkbench({store, getConnection: () => ({client, caps: c}), onComplete: (...args) => saved.push(args), pollMs: 1});
  return {model, client, caps: c, store, jobs, calls, saved, maximum: () => maximum};
}
async function add(f, count = 1) {const p = await f.model.addProject('North building'); const result = [];
  for (let i = 0; i < count; i++) result.push(await f.model.addSource(p.id, await source())); return result;}

test('registered PLY preserves source hash, declared scale and a composed Z-to-Y frame', async () => {
  const f = new File(['ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n200 0 0\n0 300 400\n'], 'scan.ply');
  const s = await prepareBimSource(f, {upAxis: 'z', metresPerUnit: .01, registrationConfirmed: true});
  const value = JSON.parse(await s.uploadFile.text());
  assert.equal(s.evidence.sha256.length, 64); assert.equal(s.evidence.preparation.method, 'bounded-source-index-sampling-and-floor-alignment');
  assert.equal(value.sourceFrame, 'survey-scan'); assert.equal(value.scale.source, 'scan-file'); assert.equal(value.scale.verified, false);
  assert.deepEqual(value.points.map(p => p.slice(0, 3)), [[0, 0, 0], [2, 0, 0], [0, 4, -3]]);
  assert.deepEqual(value.fromSource, [[.01, 0, 0, 0], [0, 0, .01, 0], [0, -.01, 0, 0]]);
  assert.equal(value.multiView, undefined);
});
test('source preparation rejects unregistered, unsupported and falsely verified sources', async () => {
  await assert.rejects(prepareBimSource(new File(['x'], 'scan.ply')), /already registered/);
  await assert.rejects(prepareBimSource(new File(['x'], 'scan.e57'), {registrationConfirmed: true}), /survey_cloud.py/);
  const value = cloud(); value.scale.verified = true; assert.throws(() => validateBimCloud(value), /verified false/);
  const wide = cloud(); wide.points = [[0, 0, 0, 0, 0, 0], [10000, 0, 10000, 0, 0, 0]];
  assert.throws(() => validateBimCloud(wide), /footprint budget/);
});

test('browser PLY preparation rejects centimetre-quantized UTM coordinates with a precise CLI remedy', async () => {
  const ply = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty double x\nproperty double y\nproperty double z\nend_header\n500000 0 0\n500000.01 0 1\n500001 1 1\n';
  await assert.rejects(prepareBimSource(new File([ply], 'utm-survey.ply'), {upAxis: 'y', metresPerUnit: 1, registrationConfirmed: true}),
    error => /31\.250 mm/.test(error.message) && /limit 1 mm/.test(error.message) && /survey_cloud\.py/.test(error.message));
});

test('PLY numeric precision is evaluated in declared metres, not raw coordinate magnitude', async () => {
  const ply = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty double x\nproperty double y\nproperty double z\nend_header\n1000000 0 0\n1000010 0 1000\n1001000 1000 1000\n';
  const prepared = await prepareBimSource(new File([ply], 'local-mm.ply'), {upAxis: 'y', metresPerUnit: .001, registrationConfirmed: true});
  const value = JSON.parse(await prepared.uploadFile.text());
  assert.equal(value.provenance.float32SpacingMetres, .0000625);
  assert.equal(value.points[0][0], 1000);
  assert.equal(value.scale.verified, false);
});

test('prepared JSON preserves high precision survey coordinates without a float32 PLY round-trip', async () => {
  const value = cloud(); value.points = [[500000, 0, 0, 0, 0, 0], [500000.01, 0, 1, 0, 0, 0], [500001, 1, 1, 0, 0, 0]];
  const prepared = await prepareBimSource(new File([JSON.stringify(value)], 'utm-arena-cloud.json'), {registrationConfirmed: true});
  assert.equal(JSON.parse(await prepared.uploadFile.text()).points[1][0], 500000.01);
});
test('worker capacity honors both worker and owner grants and requires explicit scan support', () => {
  assert.equal(bimWorkerCapacity(caps, 8), 3);
  assert.equal(bimWorkerCapacity({...caps, limits: {concurrent_jobs: 1}}, 3), 1);
  assert.equal(bimWorkerCapacity({...caps, owner_limits: {active_jobs: 2}}, 3), 2);
  const older = structuredClone(caps); delete older.engines[0].registered_survey_cloud;
  assert.throws(() => bimWorkerCapacity(older), /registered survey-cloud/);
});
test('batch scheduler reaches but never exceeds advertised concurrency and publishes actual outputs', async () => {
  const f = fixture({capacity: 2}); await add(f, 5); await f.model.resume({consent: true, concurrency: 3}); await f.model.idle();
  assert.equal(f.maximum(), 2); assert.equal(f.model.report().capacity, 2); assert.equal(f.saved.length, 5);
  assert.ok(f.model.report().jobs.every(j => j.status === 'complete' && j.artifacts[0].name === 'scene.ifc'));
  assert.equal(f.calls.filter(c => c[0] === '/v1/jobs' && c[1]?.method === 'POST').length, 5);
  const manifest = await f.model.manifest(); assert.ok(!JSON.stringify(manifest).includes(f.client.token));
  await f.model.dispose();
});
test('queue consent is required and a paused queue makes no uploads', async () => {
  const f = fixture(); await add(f, 2); await tick(); assert.equal(f.calls.length, 0);
  await assert.rejects(f.model.resume(), /Agree to send/); assert.equal(f.calls.length, 0); await f.model.dispose();
});
test('cancellation uses the real remote job and leaves the next scan paused', async () => {
  const f = fixture({capacity: 1, complete: false}); const [job] = await add(f, 2);
  await f.model.resume({consent: true}); await until(() => f.model.report().jobs[0].status === 'running'); f.model.pause();
  await f.model.cancel(job.id); await f.model.idle();
  assert.equal(f.model.report().jobs[0].status, 'cancelled'); assert.equal(f.model.report().jobs[1].status, 'ready');
  assert.equal(f.saved.length, 0); assert.ok(f.calls.some(c => c[1]?.method === 'DELETE')); await f.model.dispose();
});
test('cancelling while creation is in flight waits for its reply and cancels the returned job', async () => {
  let release, creating = false; const wait = new Promise(resolve => {release = resolve;});
  const f = fixture({hook: async (path, options) => {if (path === '/v1/jobs' && options.method === 'POST') {creating = true; assert.equal(options.signal, undefined); await wait;}}});
  const [job] = await add(f); await f.model.resume({consent: true}); await until(() => creating);
  const stopping = f.model.cancel(job.id); release(); await stopping; await f.model.idle();
  assert.equal(f.model.report().jobs[0].status, 'cancelled'); assert.equal(f.saved.length, 0);
  assert.ok(!f.calls.some(c => c[0].endsWith('/start'))); await f.model.dispose();
});
test('a failed job can retry without blocking other scans and gets an unambiguous new upload', async () => {
  let failed = false;
  const f = fixture({capacity: 1, hook: async (path, options, {jobs}) => {
    if (!path.endsWith('/start') && path.startsWith('/v1/jobs/') && options.method !== 'DELETE') {
      const value = jobs.get(path.split('/')[3]); if (value?.status === 'running' && !failed) {failed = true; value.status = 'failed'; value.error = 'Malformed floor coverage'; return {...value};}
    }
  }});
  const [job] = await add(f, 2); await f.model.resume({consent: true}); await f.model.idle();
  assert.equal(f.model.report().jobs[0].status, 'failed'); assert.equal(f.model.report().jobs[1].status, 'complete');
  await f.model.retry(job.id); await f.model.idle(); const result = f.model.report().jobs[0];
  assert.equal(result.status, 'complete'); assert.equal(result.attempt, 2); assert.equal(result.history[0].status, 'failed');
  assert.equal(new Set(f.calls.filter(c => c[0] === 'upload').map(c => c[1])).size, 3); await f.model.dispose();
});
test('reload recovery requires explicit resume and observes the original job without resubmitting', async () => {
  const f = fixture({complete: false}); await add(f); await f.model.resume({consent: true});
  await until(() => f.model.report().jobs[0].status === 'running'); await f.model.dispose();
  const callsBefore = f.calls.length, remote = [...f.jobs.values()][0]; remote.status = 'complete'; remote.artifacts = output;
  const recovered = createBimWorkbench({store: f.store, getConnection: () => ({client: f.client, caps}), pollMs: 1}); await recovered.ready;
  assert.equal(recovered.report().paused, true); assert.equal(recovered.report().jobs[0].status, 'interrupted'); assert.equal(f.calls.length, callsBefore);
  await recovered.resume({consent: true}); await recovered.idle(); assert.equal(recovered.report().jobs[0].status, 'complete');
  assert.equal(f.calls.filter(c => c[0] === '/v1/jobs' && c[1]?.method === 'POST').length, 1); await recovered.dispose();
});
test('lost create reply is reconciled by upload identity and never blindly resubmitted', async () => {
  let lost = false;
  const f = fixture({hook: async (path, options, {jobs, id}) => {
    if (!lost && path === '/v1/jobs' && options.method === 'POST') {lost = true; const value = {id: id(), engine: 'scene-usd', status: 'prepared', upload_ids: options.body.upload_ids, artifacts: []};
      jobs.set(value.id, value); throw Error('Response lost');}
  }});
  const [job] = await add(f); await f.model.resume({consent: true}); await f.model.idle();
  assert.equal(f.model.report().jobs[0].status, 'attention'); await assert.rejects(f.model.retry(job.id), /confirmed failed/);
  await f.model.check(job.id); assert.equal(f.model.report().jobs[0].status, 'interrupted');
  await f.model.resume({consent: true}); await f.model.idle(); assert.equal(f.model.report().jobs[0].status, 'complete');
  assert.equal(f.calls.filter(c => c[0] === '/v1/jobs' && c[1]?.method === 'POST').length, 1); await f.model.dispose();
});
test('unconfirmed cancellation retains its remote identity for later reconciliation', async () => {
  let refuse = true; const f = fixture({complete: false, hook: async (_path, options) => {if (options.method === 'DELETE' && refuse) throw Error('Worker unreachable');}});
  const [job] = await add(f); await f.model.resume({consent: true}); await until(() => f.model.report().jobs[0].status === 'running');
  await f.model.cancel(job.id); assert.equal(f.model.report().jobs[0].status, 'interrupted'); assert.equal(f.model.report().jobs[0].cancelRequested, true);
  await assert.rejects(f.model.clear(), /Worker unreachable/); refuse = false; await f.model.cancel(job.id);
  assert.equal(f.model.report().jobs[0].status, 'cancelled'); await f.model.clear(); assert.equal(f.model.report().jobs.length, 0); await f.model.dispose();
});
test('review is source and artifact bound and resets for a new attempt', async () => {
  const f = fixture(); const [job] = await add(f); await assert.rejects(f.model.review(job.id, {}), /completed worker/);
  await f.model.resume({consent: true}); await f.model.idle();
  let review = await f.model.review(job.id, {reviewer: 'Alex', checks: {scale: true}, notes: 'Door opening needs correction.'});
  assert.equal(review.status, 'pending');
  review = await f.model.review(job.id, {reviewer: 'Alex', checks: {scale: true, coverage: true, classification: true, exports: true}});
  assert.equal(review.status, 'reviewed'); assert.equal(review.binding.sourceSha256, f.model.report().jobs[0].source.sha256);
  assert.equal(review.binding.artifacts[0].sha256, output[0].sha256);
  const remote = [...f.jobs.values()][0]; remote.artifacts = [{...output[0], sha256: 'a'.repeat(64)}]; await f.model.check(job.id);
  assert.equal(f.model.report().jobs[0].review.status, 'pending'); await f.model.dispose();
});
test('recovery refuses another worker owner before sending any request', async () => {
  const f = fixture({complete: false}); await add(f); await f.model.resume({consent: true}); await until(() => f.model.report().jobs[0].status === 'running'); await f.model.dispose();
  let contacted = false; const model = createBimWorkbench({store: f.store, getConnection: () => ({client: {...f.client, async request() {contacted = true;}}, caps: {...caps, owner_id: 'other-owner'}})});
  await model.ready; await assert.rejects(model.resume({consent: true}), /original worker and account/); assert.equal(contacted, false); await model.dispose();
});

test('a definite quota refusal remains retryable without claiming an uncertain worker job', async () => {
  let refused = false; const f = fixture({hook: async (path, options) => {
    if (!refused && path === '/v1/jobs' && options.method === 'POST') {refused = true; throw Object.assign(Error('Active job quota reached.'), {status: 429});}
  }});
  const [job] = await add(f); await f.model.resume({consent: true}); await f.model.idle();
  assert.equal(f.model.report().jobs[0].status, 'failed'); assert.equal(f.model.report().jobs[0].creationPending, false);
  await f.model.retry(job.id); await f.model.idle(); assert.equal(f.model.report().jobs[0].status, 'complete'); await f.model.dispose();
});

test('an interrupted resumable upload keeps its identity across board reload', async () => {
  const f = fixture(), originalUpload = f.client.upload;
  f.client.upload = async function(file, _kind, signal, progress) {
    this.uploads.set(file, {id: 'b'.repeat(32)}); progress(.5);
    await new Promise((resolve, reject) => {if (signal.aborted) reject(new DOMException('cancelled', 'AbortError'));
      else signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {once: true});});
  };
  await add(f); await f.model.resume({consent: true}); await until(() => f.model.report().jobs[0].uploadId === 'b'.repeat(32)); await f.model.dispose();
  f.client.upload = originalUpload;
  const restored = createBimWorkbench({store: f.store, getConnection: () => ({client: f.client, caps}), pollMs: 1});
  await restored.ready; await restored.resume({consent: true}); await restored.idle();
  assert.equal(restored.report().jobs[0].status, 'complete'); assert.equal(f.calls.find(c => c[0] === 'upload')[1], 'b'.repeat(32));
  assert.equal(f.calls.filter(c => c[0] === '/v1/jobs' && c[1]?.method === 'POST').length, 1); await restored.dispose();
});

test('Saved projects summary includes only the selected project metadata and is bounded', async () => {
  const f = fixture(); const [job] = await add(f); const other = await f.model.addProject('Separate project'); await f.model.addSource(other.id, await source());
  const summary = bimProjectSummary(f.model.report(), job.projectId), value = JSON.parse(summary.content_text);
  assert.equal(summary.name, 'brainsnn-bim-project-summary.json'); assert.equal(value.jobs.length, 1);
  assert.equal(value.jobs[0].source.sha256, job.source.sha256); assert.equal(value.jobs[0].source.prepared.sha256, job.source.cloudSha256);
  assert.ok(!summary.content_text.includes(f.client.token)); assert.ok(!summary.content_text.includes('Separate project'));
  const big = f.model.report(); big.jobs[0].review.notes = 'x'.repeat(600 * 1024);
  assert.throws(() => bimProjectSummary(big, job.projectId), /512 KiB/); await f.model.dispose();
});

test('lost observation reserves remote capacity by pausing new submissions', async () => {
  const f = fixture({capacity: 1, complete: false, hook: async (path, options, {jobs}) => {
    if (path.startsWith('/v1/jobs/') && !path.endsWith('/start') && !options.method && jobs.get(path.split('/')[3])?.status === 'running') throw Error('Network disconnected');
  }});
  await add(f, 2); await f.model.resume({consent: true}); await f.model.idle();
  const report = f.model.report(); assert.equal(report.paused, true); assert.equal(report.jobs[0].status, 'interrupted'); assert.equal(report.jobs[1].status, 'ready');
  assert.equal(f.calls.filter(c => c[0] === '/v1/jobs' && c[1]?.method === 'POST').length, 1);
  await f.model.dispose();
});
