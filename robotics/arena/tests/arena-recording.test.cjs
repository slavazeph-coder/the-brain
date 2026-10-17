const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const source = path.resolve(__dirname, '../../../brainsnn-r3f-app/public/arena/arena-recording.js');
const context = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, crypto: webcrypto, btoa, atob, console };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
const R = context.BrainSNNArenaRecording;
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const contextFields = { taskId: 'libero:0', taskRevision: 'task-v1', judgeRevision: 'judge-v1',
  environment: { name: 'fixture', version: '1' }, actionSemantics: 'controller-input-7', stateSemantics: 'joint-state',
  units: { action: 'normalized', time: 'seconds' }, preprocessingRevision: 'resize-v1', initialState: 'state-a' };
async function fixture(options = {}) {
  const raw = Uint8Array.from([10, 20, 30, 40, 50, 60]);
  const manifest = R.createManifest({ recordingId: 'fixture', source: { kind: 'simulator-policy', identityStatus: 'declared', model: 'test-double' },
    context: clone(contextFields), clocks: [{ id: 'sim', kind: 'simulation', unit: 'seconds' }],
    artifacts: [{ id: 'camera', path: 'artifacts/camera.bin', mediaType: 'application/octet-stream', retention: 'included', shape: [1, 2, 3], dtype: 'uint8', endianness: 'not-applicable' }],
    events: [
      { id: 'e1', seq: 1, kind: 'observation', simTime: 0, monotonicNs: '1792195200123456789', refs: [], artifactIds: ['camera'], data: { cameras: [{ id: 'agentview', artifactId: 'camera' }], state: [0, 1] } },
      { id: 'e2', seq: 2, kind: 'inference-result', simTime: 0, refs: ['e1'], artifactIds: [], data: { actions: [[0, 1]], observationId: 'e1', chunkId: 'e2' } },
      { id: 'e3', seq: 3, kind: 'controller-input', simTime: 0, refs: ['e2'], artifactIds: [], data: { vector: [0, 1], chunkIndex: 0 } },
      { id: 'e4', seq: 4, kind: 'state', simTime: 0.05, refs: ['e3'], artifactIds: [], data: { state: [0.1, 1] } },
      { id: 'e5', seq: 5, kind: 'outcome', simTime: 0.05, refs: ['e4'], artifactIds: [], data: { status: 'failed' } }
    ], findings: [{ id: 'f1', origin: 'hypothesis', summary: 'A test hypothesis, not a cause.', refs: ['e1', 'e3'], limitations: ['No physical execution.'] }],
    completion: { status: 'complete', committedSequence: 5, lastObservedSequence: 5, gapCount: 0, unknownTail: false }, outcome: { status: 'failed' }, ...options });
  return R.importBundle(await R.seal(manifest, { 'artifacts/camera.bin': raw }));
}
async function altered(input, mutate) {
  const bundle = clone(input.bundle || input), manifest = JSON.parse(bundle.manifestText);
  mutate(manifest, bundle);
  bundle.manifestText = JSON.stringify(manifest); bundle.manifestSha256 = digest(bundle.manifestText);
  return bundle;
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('portable exact-byte envelope verifies, renders raw payloads and round-trips deterministically', async () => {
  const data = await fixture();
  assert.equal(data.verification.hashesMatch, true); assert.equal(data.verification.complete, true);
  assert.equal(data.verification.execution, 'declared'); assert.equal(data.verification.producerIdentity, 'declared');
  assert.equal(data.manifest.events[0].monotonicNs, '1792195200123456789');
  assert.deepEqual(Array.from(data.payloads['artifacts/camera.bin']), [10, 20, 30, 40, 50, 60]);
  const text = R.exportBundle(data);
  assert.equal(R.exportBundle(await R.importBundle(text)), text);
  assert(Object.isFrozen(data.manifest));
  assert(data.verification.limitations.some(text => text.includes('not truth')));
});

test('Python float spelling, Unicode and nanoseconds retain their authoritative bytes', async () => {
  const data = await fixture();
  const input = { manifest: clone(data.manifest), payloads: clone(data.bundle.payloads) };
  input.manifest.context.unicode = 'π₀.₅ 🧠 café'; input.manifest.context.float = 1;
  const produced = execFileSync('python3', ['-c', [
    'import json,sys,hashlib',
    'x=json.load(sys.stdin)',
    'x["manifest"]["context"]["float"]=1.0',
    'text=json.dumps(x["manifest"],ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(",",":"))',
    'print(json.dumps({"schema":"brainsnn.arena.bundle.v1","manifestText":text,"manifestSha256":hashlib.sha256(text.encode("utf-8")).hexdigest(),"payloads":x["payloads"]},ensure_ascii=False))'
  ].join('\n')], { input: JSON.stringify(input), encoding: 'utf8' });
  const parsed = await R.importBundle(produced);
  assert(parsed.bundle.manifestText.includes('"float":1.0'));
  assert.equal(parsed.manifest.context.unicode, 'π₀.₅ 🧠 café');
  assert.equal(JSON.parse(R.exportBundle(parsed)).manifestText, JSON.parse(produced).manifestText);
  assert.notEqual(parsed.bundle.manifestSha256, digest(JSON.stringify(parsed.manifest)));
});

test('manifest and artifact tampering fail even when a parsed shadow would appear correct', async () => {
  const data = await fixture(), changed = clone(data.bundle);
  changed.manifestText = changed.manifestText.replace('A test hypothesis', 'An invented cause');
  await rejectsCode(R.importBundle(changed), 'hash_mismatch');
  const payload = clone(data.bundle); payload.payloads['artifacts/camera.bin'] = Buffer.from([11, 20, 30, 40, 50, 60]).toString('base64');
  await rejectsCode(R.importBundle(payload), 'hash_mismatch');
  const shadow = clone(data.bundle); shadow.manifest = clone(data.manifest);
  await rejectsCode(R.importBundle(shadow), 'invalid_bundle');
});

test('unsafe numbers, duplicate JSON keys, forbidden prototypes and unpaired Unicode are rejected', async () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}']) assert.throws(() => R.parseJSON(text), e => e.code === 'duplicate_key');
  assert.throws(() => R.parseJSON('{"__proto__":{"admin":true}}'), e => e.code === 'unsafe_key');
  for (const text of ['9007199254740992', '1e400']) assert.throws(() => R.parseJSON(text), e => e.code === 'unsafe_number');
  assert.throws(() => R.parseJSON('"\\ud800"'), e => e.code === 'invalid_unicode');
  assert.throws(() => R.createManifest({ context: { score: NaN } }), e => e.code === 'unsafe_number');
  assert.equal({}.admin, undefined);
  const bundle = (await fixture()).bundle;
  const duplicate = bundle.manifestText.replace('"recordingId":"fixture"', '"recordingId":"fixture","recordingId":"other"');
  await rejectsCode(R.importBundle({ ...bundle, manifestText: duplicate, manifestSha256: digest(duplicate) }), 'duplicate_key');
});

test('references must resolve, IDs must be unique, and hypothetical evidence cannot hide in cycles', async () => {
  const data = await fixture();
  for (const mutate of [m => m.events[1].refs.push('absent'), m => m.events[0].artifactIds.push('absent'), m => m.findings[0].refs.push('absent')]) {
    await rejectsCode(R.importBundle(await altered(data, mutate)), 'missing_reference');
  }
  await rejectsCode(R.importBundle(await altered(data, m => m.events[1].id = 'e1')), 'duplicate_id');
  await rejectsCode(R.importBundle(await altered(data, m => m.events[0].refs = ['e2'])), 'reference_cycle');
  await rejectsCode(R.importBundle(await altered(data, m => m.findings[0].refs = ['f1'])), 'reference_cycle');
  await rejectsCode(R.importBundle(await altered(data, m => m.findings[0].refs = [])), 'invalid_reference');
  await rejectsCode(R.importBundle(await altered(data, m => m.events[1].refs = ['e1', 'e1'])), 'invalid_reference');
  await rejectsCode(R.importBundle(await altered(data, m => m.events[0].data.cameras[0].artifactId = 'absent')), 'missing_reference');
  await rejectsCode(R.importBundle(await altered(data, m => m.events[1].data.observationId = 'absent')), 'missing_reference');
});

test('a long valid dependency chain uses bounded iterative graph validation', async () => {
  const manifest = R.createManifest({ recordingId: 'chain' });
  manifest.events = Array.from({ length: 10000 }, (_, index) => ({ id: 'e' + (index + 1), seq: index + 1, kind: 'state',
    refs: index ? ['e' + index] : [], artifactIds: [], data: {} }));
  manifest.completion.committedSequence = manifest.completion.lastObservedSequence = 10000;
  assert.equal((await R.importBundle(await R.seal(manifest))).manifest.events.length, 10000);
});

test('local artifact paths reject traversal, URLs, devices, links and case collisions', async () => {
  const data = await fixture();
  for (const bad of ['/etc/passwd', '../secret', 'artifacts/../secret', 'C:/secret', 'a\\b', 'https://example/a', 'a/%2e%2e/b', 'a//b', 'a/.', 'a/CON.txt', 'a/trailing.']) {
    await rejectsCode(R.importBundle(await altered(data, m => m.artifacts[0].path = bad)), 'unsafe_path');
  }
  await rejectsCode(R.importBundle(await altered(data, m => m.artifacts[0].kind = 'symlink')), 'unsafe_artifact');
  await rejectsCode(R.importBundle(await altered(data, m => m.artifacts[0].url = 'https://example/a')), 'unsafe_artifact');
  await rejectsCode(R.importBundle(await altered(data, m => m.artifacts.push({ ...m.artifacts[0], id: 'other', path: 'ARTIFACTS/CAMERA.BIN' }))), 'unsafe_path');
});

test('payload count, lengths, shape, hashes and base64 are independently checked', async () => {
  const data = await fixture();
  await rejectsCode(R.importBundle(await altered(data, m => m.artifacts[0].sha256 = 'z'.repeat(64))), 'invalid_artifact');
  await rejectsCode(R.importBundle(await altered(data, m => m.artifacts[0].shape = [1, 3, 3])), 'invalid_array');
  const missing = clone(data.bundle); delete missing.payloads['artifacts/camera.bin'];
  await rejectsCode(R.importBundle(missing), 'missing_payload');
  const extra = clone(data.bundle); extra.payloads['secret.txt'] = '';
  await rejectsCode(R.importBundle(extra), 'unexpected_payload');
  const malformed = clone(data.bundle); malformed.payloads['artifacts/camera.bin'] = 'a=b=';
  await rejectsCode(R.importBundle(malformed), 'invalid_payload');
  assert.throws(() => R.base64ToBytes('AB=='), e => e.code === 'invalid_payload');
  const length = await altered(data, m => { delete m.artifacts[0].shape; delete m.artifacts[0].dtype; delete m.artifacts[0].endianness; m.artifacts[0].byteLength++; });
  await rejectsCode(R.importBundle(length), 'length_mismatch');
});

test('large omitted originals retain streamed identities without consuming included byte budgets', async () => {
  const data = await fixture();
  const omitted = await altered(data, (m, b) => {
    m.artifacts[0] = { id: 'camera', path: 'source/video.mp4', mediaType: 'video/mp4', retention: 'omitted',
      byteLength: 5 * 1024 * 1024 * 1024, sha256: 'a'.repeat(64), omissionReason: 'Source exceeds portable budget.' };
    b.payloads = {}; m.completion.status = 'partial';
  });
  const result = await R.importBundle(omitted);
  assert.equal(result.verification.sourcesPresent, false); assert.equal(result.verification.complete, false);
  assert.equal(result.manifest.artifacts[0].byteLength, 5368709120);
});

test('no complete badge when coverage, durability tail, or retained sources are missing', async () => {
  const data = await fixture();
  for (const mutate of [m => m.completion.unknownTail = true, m => m.completion.gapCount = 1,
    m => m.completion.lastObservedSequence = 6, m => m.events[2].seq = 2,
    m => { m.events.splice(1, 1); m.events[1].refs = ['e1']; }]) {
    const result = await R.verifyBundle(await altered(data, mutate)); assert.equal(result.ok, false);
  }
  const partial = await R.importBundle(await altered(data, m => {
    m.completion.status = 'partial'; m.completion.lastObservedSequence = 8; m.completion.unknownTail = true;
    m.completion.reason = 'Writer was killed before finalization; tail length is unknown.';
  }));
  assert.equal(partial.verification.complete, false); assert.equal(partial.manifest.completion.gapCount, 0);
  assert(partial.verification.limitations.some(text => text.includes('unknown tail')));
});

test('structured JSON has strict depth and input limits before consumers see it', () => {
  assert.throws(() => R.parseJSON('['.repeat(40) + '0' + ']'.repeat(40)), e => e.code === 'limit_exceeded');
  assert.throws(() => R.parseJSON('"too big"', 4), e => e.code === 'limit_exceeded');
  assert.throws(() => R.createManifest({ context: { get dangerous() { throw Error('must not run'); } } }), e => e.code === 'invalid_json');
});

test('scripted legacy snapshots keep actual controller inputs without asserting model execution', async () => {
  const old = { schema: 'brainsnn.arena.evidence.v1', selected: { modelId: 'pi05', robotId: 'panda', seed: '42' },
    execution: { kind: 'scripted-kinematic-demo', policyExecuted: false },
    local: { events: [], snapshots: [{ id: 1, branch: 'main', controllerInput: [0.1, 0.2], state: { time: 0.05, robot: [1, 2] } }] } };
  const data = await R.importBundle(old, { allowLegacy: true });
  assert.equal(data.manifest.source.kind, 'scripted-practice'); assert.equal(data.verification.execution, 'not-recorded');
  assert.equal(data.manifest.events[0].kind, 'controller-input'); assert.deepEqual(clone(data.manifest.events[0].data.vector), [0.1, 0.2]);
  assert.deepEqual(clone(data.manifest.events[1].refs), [data.manifest.events[0].id]);
  assert.equal(data.manifest.artifacts.length, 0); assert.equal(data.manifest.completion.status, 'partial');
  assert.equal(data.manifest.context.selectedModel, 'pi05');
});

test('practice outcome comes from recorded final state and only supplied revisions enable compatibility', async () => {
  const old = { schema: 'brainsnn.arena.evidence.v1', execution: { kind: 'scripted-kinematic-demo' },
    local: { events: [], snapshots: [
      { id: 1, state: { time: 0, opts: { mission: 'table', challenge: 'clutter' }, done: false, success: false } },
      { id: 2, controllerInput: { skill: 'drop' }, state: { time: 0.1, opts: { challenge: 'clutter' }, done: true, success: true } }
    ] } };
  let data = await R.importBundle(old, { allowLegacy: true });
  assert.equal(data.manifest.context.taskId, 'scripted-sort:clutter');
  assert.equal(data.manifest.outcome.status, 'succeeded'); assert.equal(data.manifest.outcome.policyExecuted, false);
  assert.equal(data.manifest.context.judgeRevision, null); assert.equal(data.manifest.completion.status, 'partial');
  assert.equal(data.manifest.events.at(-1).kind, 'outcome');
  assert.equal(R.comparisonCompatibility(data, data).compatible, false);
  old.local.recordingContext = { ...clone(contextFields), initialState: clone(old.local.snapshots[0].state) };
  data = await R.importBundle(old, { allowLegacy: true });
  assert.equal(R.comparisonCompatibility(data, data).compatible, true);
  assert.equal(data.manifest.outcome.judgeRevision, 'judge-v1');
  old.local.snapshots[1].state.success = false; old.local.snapshots[1].state.failureReason = 'step-limit';
  data = await R.importBundle(old, { allowLegacy: true });
  assert.equal(data.manifest.outcome.status, 'failed'); assert.equal(data.manifest.outcome.reason, 'step-limit');
});

test('legacy worker preview metadata never becomes reconstructed camera or action evidence', async () => {
  const old = { schema: 'brainsnn.arena.evidence.v1', execution: { kind: 'worker', policyExecuted: true, task: 'libero:0' },
    worker: { droppedFrames: 4, frames: [{ seq: 12, simTime: 0.6, cameraIds: [{ id: 'agentview' }], policyExecuted: true }] } };
  const data = await R.importBundle(old, { allowLegacy: true });
  assert.equal(data.manifest.source.kind, 'imported'); assert.equal(data.verification.execution, 'not-recorded');
  assert.equal(data.manifest.events[0].kind, 'preview-metadata'); assert.equal(data.manifest.artifacts.length, 0);
  assert.equal(data.manifest.completion.gapCount, 4); assert.equal(data.manifest.completion.unknownTail, true);
});

test('compatibility refuses unknown/different semantics and does not confuse checkpoint changes with task incompatibility', async () => {
  const left = await fixture(), right = clone(left.manifest);
  right.context.checkpoint = 'new-policy';
  let result = R.comparisonCompatibility(left, right); assert.equal(result.compatible, true); assert.equal(result.differences.length, 1);
  delete right.context.judgeRevision;
  result = R.comparisonCompatibility(left, right); assert.equal(result.compatible, false); assert.equal(result.issues[0].reason, 'unknown');
  right.context.judgeRevision = 'other'; assert.equal(R.comparisonCompatibility(left, right).issues[0].reason, 'incompatible');
});

test('comparison requires the same known policy-start state; two missing states are not compatible', async () => {
  const left = clone((await fixture()).manifest), right = clone(left);
  right.context.initialState = 'state-b';
  assert.equal(R.comparisonCompatibility(left, right).compatible, false);
  delete left.context.initialState; delete right.context.initialState;
  const result = R.comparisonCompatibility(left, right);
  assert.equal(result.compatible, false); assert.equal(result.issues[0].field, 'initialState'); assert.equal(result.issues[0].reason, 'unknown');
  assert.equal(R.compareRecordings(left, right, { alignment: { kind: 'simTime' } }).firstDivergence, null);
  left.context.initialState = {}; right.context.initialState = {};
  assert.equal(R.comparisonCompatibility(left, right).compatible, false);
});

test('comparison aligns explicit events and identifies observed controller-input difference, not a cause', async () => {
  const baseline = await fixture(), candidate = clone(baseline.manifest);
  candidate.events.forEach(e => e.simTime += 5); candidate.events[2].data.vector = [0.5, 1];
  let result = R.compareRecordings(baseline, candidate);
  assert.equal(result.firstDivergence, null); assert(result.limitations.some(t => t.includes('Declare')));
  result = R.compareRecordings(baseline, candidate, { alignment: { kind: 'event', baselineEventId: 'e1', candidateEventId: 'e1' } });
  assert.equal(result.alignment.candidateOffset, -5); assert.equal(result.firstDivergence.kind, 'controller-input');
  assert.equal(result.firstDivergence.baselineEventId, 'e3'); assert(result.limitations[0].includes('does not establish a cause'));
});

test('comparison ignores unrelated source shard bytes and withholds missing camera comparisons', async () => {
  const data = await fixture(), other = clone(data.manifest);
  other.artifacts.push({ id: 'source-shard', path: 'sources/table.parquet', sha256: 'c'.repeat(64), byteLength: 200,
    mediaType: 'application/vnd.apache.parquet', retention: 'omitted' });
  other.events[0].artifactIds.push('source-shard'); other.completion.status = 'partial';
  assert.equal(R.compareRecordings(data, other, { alignment: { kind: 'simTime' } }).firstDivergence, null);
  other.artifacts[0].retention = 'omitted'; other.artifacts[0].sha256 = 'd'.repeat(64);
  const result = R.compareRecordings(data, other, { alignment: { kind: 'simTime' } });
  assert.equal(result.firstDivergence, null); assert(result.limitations.some(t => t.includes('retained events')));
});

test('imported dataset-action labels do not become execution evidence', async () => {
  const data = await fixture();
  const imported = await R.importBundle(await altered(data, m => {
    m.source.kind = 'imported'; m.events[2].kind = 'dataset-action'; m.events[2].data.execution = 'unknown';
  }));
  assert.equal(imported.verification.execution, 'not-recorded');
  assert.equal(R.comparisonCompatibility(data, imported).compatible, false);
});

test('malformed policy outputs remain inspectable with an explicit unavailable artifact and sourced error', async () => {
  const data = await fixture();
  const result = await R.importBundle(await altered(data, m => {
    m.events[1].data.actions = null; m.events[1].data.actionsArtifactId = null;
    m.events[1].data.artifactLimitation = 'Non-numeric output has no numeric artifact.';
    m.events[2].kind = 'runtime-error'; m.events[2].data = { code: 'invalid_actions' };
    m.outcome.status = 'interrupted';
  }));
  assert.equal(result.manifest.events[1].data.actionsArtifactId, null);
  assert(R.deriveFindings(result).some(f => f.refs[0] === 'e3' && f.summary.includes('error')));
});

test('rule findings cite events, avoid duplicate materialization, and reviews become stale', async () => {
  const data = await fixture(), findings = R.deriveFindings(data);
  assert.equal(findings.length, 1); assert.deepEqual(clone(findings[0].refs), ['e5']);
  const m = clone(data.manifest); m.findings.push(...clone(findings)); assert.equal(R.deriveFindings(m).length, 0);
  const review = R.createReview(data, { findingId: 'f1', decision: 'reject', reviewerLabel: 'Developer', createdAt: '2026-10-17T00:00:00Z' });
  assert.equal(review.reviewer.authenticated, false); assert.equal(R.reviewStatus(review, data).current, true);
  const changed = await R.importBundle(await altered(data, m => m.findings[0].summary += ' Changed.'));
  assert.equal(R.reviewStatus(review, changed).current, false);
  assert.throws(() => R.createReview(data, { findingId: 'absent', decision: 'accept' }), e => e.code === 'invalid_review');
});

test('redaction produces a distinct identity, explicit exclusions and stale reviews', async () => {
  const data = await fixture(), review = R.createReview(data, { decision: 'needs-evidence' });
  const selected = await R.importBundle(await R.redactBundle(data, { omitImages: true }));
  assert.notEqual(selected.bundle.manifestSha256, data.bundle.manifestSha256);
  assert.equal(selected.manifest.artifacts[0].retention, 'omitted'); assert.equal(Object.keys(selected.payloads).length, 0);
  assert.equal(selected.manifest.source.derivation.manifestSha256, data.bundle.manifestSha256);
  assert.equal(selected.verification.complete, false); assert.equal(R.reviewStatus(review, selected).current, false);
  assert.equal(data.manifest.artifacts[0].retention, 'included');
});

test('prompt redaction removes bytes while retaining a resolvable omitted-artifact locator', async () => {
  const data = await fixture(), manifest = clone(data.manifest);
  manifest.context.prompt = 'Private instruction';
  manifest.artifacts.push({ id: 'prompt', path: 'artifacts/prompt.txt', kind: 'prompt', mediaType: 'text/plain', retention: 'included' });
  manifest.events[0].data.promptArtifactId = 'prompt'; manifest.events[0].artifactIds.push('prompt');
  const input = await R.importBundle(await R.seal(manifest, { ...data.payloads, 'artifacts/prompt.txt': 'Private instruction' }));
  const result = await R.importBundle(await R.redactBundle(input, { omitPrompts: true }));
  assert.equal(result.manifest.events[0].data.promptArtifactId, 'prompt');
  assert.equal(result.manifest.artifacts[1].retention, 'omitted');
  assert.equal(result.manifest.context.prompt, '[redacted]');
  assert.equal(R.exportBundle(result).includes('Private instruction'), false);
});

test('resealing changed bytes cannot silently reuse a previous artifact identity', async () => {
  const data = await fixture();
  await rejectsCode(R.seal(data.manifest, { 'artifacts/camera.bin': Uint8Array.from([11, 20, 30, 40, 50, 60]) }), 'hash_mismatch');
});

test('published schemas are valid JSON and explicitly distinguish identities from authenticity', () => {
  for (const name of ['run-manifest.v1.json', 'recording-event.v1.json', 'evidence-reference.v1.json', 'recording-bundle.v1.json', 'recording-review.v1.json']) {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../schemas', name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema'); assert(schema.$id.endsWith(name));
  }
  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../schemas/run-manifest.v1.json'), 'utf8'));
  assert.equal(schema.properties.source.properties.identityStatus.const, 'declared');
});
