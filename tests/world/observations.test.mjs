import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OBSERVATION_SCHEMA, OBSERVATION_PROOF_SCHEMA, OBSERVATION_LIMITS,
  importObservations, reviewObservation, exportObservations, exportObservationProof, frameTimeSeconds,
} from '../../brainsnn-r3f-app/public/world/observations.mjs';

// Authored metadata fixtures exercise the wire contract; they are not model runs.
const clone = value => JSON.parse(JSON.stringify(value));
const digest = character => character.repeat(64);
const now = () => '2026-10-19T12:00:00.000Z';
function fixture(kind = 'photo') {
  const sidecar = {
    schema: OBSERVATION_SCHEMA,
    source: { sha256: digest('a'), kind },
    model: { provider: 'local-vllm', id: 'qwen3.8:27b', revision: null, promptVersion: 'world-observer-v1', promptSha256: digest('c') },
    frames: [{ id: 'frame-1', sha256: digest('b'), width: 512, height: 288,
      timestamp: kind === 'photo' ? null : { pts: '6006', timeBase: [1, 30000] } }],
    observations: [{ id: 'observation-1', frameId: 'frame-1', label: 'Chair', uncertainty: 'Partly occluded; label may be wrong.', box: [0.1, 0.2, 0.7, 0.9] }],
  };
  const bindings = [{ ...clone(sidecar.source), frames: clone(sidecar.frames) }];
  return { sidecar, bindings };
}
function changed(mutator, kind) {
  const { sidecar, bindings } = fixture(kind);
  mutator(sidecar);
  return () => importObservations(sidecar, bindings);
}

test('imports only bound evidence and starts every immutable observation pending', () => {
  const { sidecar, bindings } = fixture();
  const session = importObservations(JSON.stringify(sidecar), bindings);
  assert.deepEqual(session.observations, sidecar.observations);
  assert.deepEqual(session.reviews, [{ observationId: 'observation-1', status: 'pending', annotation: null, note: '', reviewedAt: null }]);
  assert.ok(Object.isFrozen(session));
  assert.ok(Object.isFrozen(session.observations[0].box));
  assert.throws(() => { session.reviews[0].status = 'accepted'; }, TypeError);
  sidecar.observations[0].label = 'Changed after import';
  assert.equal(session.observations[0].label, 'Chair');
  assert.equal(frameTimeSeconds(null), null);
});

test('video binds exact decoded PTS and dimensions, not frame index or approximate seconds', () => {
  const { sidecar, bindings } = fixture('video');
  const session = importObservations(sidecar, bindings);
  assert.deepEqual(session.frames[0].timestamp, { pts: '6006', timeBase: [1, 30000] });
  assert.equal(frameTimeSeconds(session.frames[0].timestamp), 0.2002);
  for (const mutate of [
    v => { v.frames[0].timestamp.pts = '6007'; },
    v => { v.frames[0].timestamp.timeBase = [2, 60000]; },
    v => { v.frames[0].sha256 = digest('d'); },
    v => { v.frames[0].width = 511; },
  ]) assert.throws(changed(mutate, 'video'), /unbound or stale/);
});

test('rejects absent, stale, ambiguous or wrong-kind current sources', () => {
  const { sidecar, bindings } = fixture();
  for (const registry of [[], [{ ...bindings[0], sha256: digest('d') }], [bindings[0], bindings[0]]]) {
    assert.throws(() => importObservations(sidecar, registry));
  }
  assert.throws(() => importObservations(sidecar, [{ ...bindings[0], kind: 'video' }]), /kind changed/);
  assert.throws(() => importObservations(sidecar, [{ ...bindings[0], frames: [{ ...bindings[0].frames[0], id: 'unrelated' }] }]), /unbound/);
  const renamed = clone(sidecar); renamed.source.name = 'same-file.jpg';
  assert.throws(() => importObservations(renamed, bindings), /unsupported fields/);
});

test('validates exact clock representation and bounded image dimensions', () => {
  assert.throws(changed(v => { v.frames[0].timestamp = 0; }), /Photo timestamps/);
  for (const clock of [null, 0.2, { pts: 6006, timeBase: [1, 30000] }, { pts: '-1', timeBase: [1, 30] },
    { pts: '01', timeBase: [1, 30] }, { pts: '1', timeBase: [1, 0] }, { pts: '1', timeBase: [0.5, 30] },
    { pts: '86401', timeBase: [1, 1] }, { pts: '6006', timeBase: [1, 30000], seconds: 0.2002 }]) {
    assert.throws(changed(v => { v.frames[0].timestamp = clock; }, 'video'));
  }
  for (const width of [0, 513, 2.5, '512', Infinity]) assert.throws(changed(v => { v.frames[0].width = width; }));
  assert.equal(frameTimeSeconds({ pts: '86400000000000', timeBase: [1, 1000000000] }), 86400);
});

test('enforces unique identities, real frame references, and all SHA fields', () => {
  assert.throws(changed(v => { v.observations[0].frameId = 'missing'; }), /unknown frame/);
  assert.throws(changed(v => { v.observations.push(clone(v.observations[0])); }), /unique/);
  assert.throws(changed(v => { v.frames.push(clone(v.frames[0])); }), /unique/);
  for (const invalid of ['', 'frame/1', '__proto__', 'a'.repeat(65)]) {
    assert.throws(changed(v => { v.observations[0].id = invalid; }));
  }
  for (const invalid of ['a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), null]) {
    for (const mutate of [v => { v.source.sha256 = invalid; }, v => { v.frames[0].sha256 = invalid; }, v => { v.model.promptSha256 = invalid; }]) {
      assert.throws(changed(mutate), /SHA-256/);
    }
  }
});

test('accepts abstention and omitted boxes without manufacturing confidence or geometry', () => {
  const { sidecar, bindings } = fixture();
  delete sidecar.observations[0].box;
  const session = importObservations(sidecar, bindings);
  assert.equal('box' in session.observations[0], false);
  sidecar.observations = [];
  assert.deepEqual(importObservations(sidecar, bindings).reviews, []);
  for (const field of ['x', 'y', 'z', 'position', 'scale', 'confidence', 'worldObjectId', 'review', 'accepted']) {
    assert.throws(changed(v => { v.observations[0][field] = 1; }), /unsupported fields/);
  }
  for (const field of ['world', 'objects', 'scaleReviewed', 'mapReviewed']) {
    assert.throws(changed(v => { v[field] = true; }), /unsupported fields/);
  }
});

test('2D boxes require normalized finite ordered corners', () => {
  for (const box of [null, [0, 0, 1], [0, 0, 1, 1, 1], [-0.1, 0, 1, 1], [0, 0, 1.01, 1],
    [0.8, 0, 0.2, 1], [0, 0.8, 1, 0.2], [0, 0, 0, 1], [0, 0, NaN, 1], ['0', 0, 1, 1]]) {
    assert.throws(changed(v => { v.observations[0].box = box; }));
  }
});

test('bounded schema rejects oversized arrays, text, JSON, hidden fields and accessors', () => {
  assert.throws(changed(v => { v.frames = Array.from({ length: 7 }, (_, i) => ({ ...v.frames[0], id: 'frame-' + i })); }), /bounds/);
  assert.throws(changed(v => { v.observations = Array.from({ length: 101 }, (_, i) => ({ ...v.observations[0], id: 'observation-' + i })); }), /bounds/);
  assert.throws(changed(v => { v.observations[0].label = 'a'.repeat(121); }), /too long/);
  for (const uncertainty of ['', ' '.repeat(3), 'x'.repeat(601), ['unknown'], '\u0000hidden', '\ud800']) {
    assert.throws(changed(v => { v.observations[0].uncertainty = uncertainty; }));
  }
  const { sidecar, bindings } = fixture();
  assert.throws(() => importObservations(' '.repeat(OBSERVATION_LIMITS.bytes + 1), bindings), /256 KiB/);
  assert.throws(() => importObservations('é'.repeat(OBSERVATION_LIMITS.bytes / 2 + 1), bindings), /256 KiB/);
  assert.throws(() => importObservations('{bad json', bindings), /valid JSON/);
  const hidden = clone(sidecar); Object.defineProperty(hidden.source, 'sha256', { value: digest('a'), enumerable: false });
  assert.throws(() => importObservations(hidden, bindings), /ordinary JSON/);
  let getterCalled = false;
  const accessor = { ...sidecar, get schema() { getterCalled = true; return OBSERVATION_SCHEMA; } };
  assert.throws(() => importObservations(accessor, bindings), /ordinary JSON/);
  assert.equal(getterCalled, false);
  const polluted = JSON.parse(JSON.stringify(sidecar).replace('"source":{', '"source":{"__proto__":{},'));
  assert.throws(() => importObservations(polluted, bindings), /unsupported fields/);
});

test('model provenance requires an explicit revision or honest null and a prompt identity', () => {
  for (const field of ['provider', 'id', 'revision', 'promptVersion', 'promptSha256']) {
    assert.throws(changed(v => { delete v.model[field]; }), /missing/);
  }
  assert.throws(changed(v => { v.model.revision = ''; }), /invalid/);
  const { sidecar, bindings } = fixture();
  sidecar.model.revision = digest('d');
  assert.equal(importObservations(sidecar, bindings).model.revision, digest('d'));
});

test('accept, edit and reject preserve model originals and require explicit pending transitions', () => {
  const { sidecar, bindings } = fixture();
  const session = importObservations(sidecar, bindings);
  const accepted = reviewObservation(session, 'observation-1', { action: 'accept', note: 'Compared with the original photo.' }, bindings, { now });
  assert.equal(accepted.reviews[0].status, 'accepted');
  assert.deepEqual(accepted.reviews[0].annotation, { label: 'Chair', uncertainty: sidecar.observations[0].uncertainty, box: sidecar.observations[0].box });
  assert.equal(session.reviews[0].status, 'pending');
  const edited = reviewObservation(session, 'observation-1', { action: 'edit', annotation: { label: 'Stool', uncertainty: 'Human correction; obscured legs.' } }, bindings, { now });
  assert.equal(edited.reviews[0].status, 'edited');
  assert.equal(edited.reviews[0].annotation.label, 'Stool');
  assert.equal(edited.observations[0].label, 'Chair');
  const rejected = reviewObservation(session, 'observation-1', { action: 'reject', note: 'Not supported by this image.' }, bindings, { now });
  assert.equal(rejected.reviews[0].status, 'rejected');
  assert.equal(rejected.reviews[0].annotation, null);
  for (const reviewed of [accepted, edited, rejected]) {
    assert.throws(() => reviewObservation(reviewed, 'observation-1', { action: 'accept' }, bindings), /Only pending/);
    assert.equal(reviewed.reviews[0].reviewedAt, now());
  }
});

test('rejects forged sessions, unsupported review actions and edits containing geometry', () => {
  const { sidecar, bindings } = fixture();
  const session = importObservations(sidecar, bindings);
  for (const value of [sidecar, clone(session), { ...session }]) {
    assert.throws(() => reviewObservation(value, 'observation-1', { action: 'accept' }, bindings), /returned by this module/);
    assert.throws(() => exportObservationProof(value, bindings), /returned by this module/);
  }
  for (const decision of [{ action: 'approve' }, { action: 'edit' }, { action: 'accept', annotation: {} },
    { action: 'reject', confidence: 1 }, { action: 'edit', annotation: { label: 'Chair', uncertainty: 'unknown', x: 1 } }]) {
    assert.throws(() => reviewObservation(session, 'observation-1', decision, bindings));
  }
  assert.throws(() => reviewObservation(session, 'missing', { action: 'accept' }, bindings), /does not exist/);
  assert.throws(() => reviewObservation(session, 'observation-1', { action: 'accept' }, bindings, { now: () => 'not-a-time' }), /UTC timestamp/);
});

test('ordinary export removes every review; explicit proof preserves it without granting import authority', () => {
  const { sidecar, bindings } = fixture();
  const session = reviewObservation(importObservations(sidecar, bindings), 'observation-1', {
    action: 'edit', annotation: { label: 'Stool', uncertainty: 'Reviewed but partly obscured.' }, note: 'Local user correction.',
  }, bindings, { now });
  assert.deepEqual(exportObservations(session, bindings), sidecar);
  const proof = exportObservationProof(session, bindings, { now });
  assert.equal(proof.schema, OBSERVATION_PROOF_SCHEMA);
  assert.equal(proof.reviewAuthority, 'local-user-unverified');
  assert.equal(proof.reviews[0].annotation.label, 'Stool');
  assert.ok(Object.isFrozen(proof.reviews[0].annotation));
  const imported = importObservations(JSON.stringify(proof), bindings);
  assert.equal(imported.reviews[0].status, 'pending');
  assert.equal(imported.observations[0].label, 'Chair');
  assert.equal(imported.reviews[0].annotation, null);
  assert.equal(imported.reviews[0].note, '');
  const generatedWithReview = { ...sidecar, reviews: clone(proof.reviews) };
  assert.throws(() => importObservations(generatedWithReview, bindings), /unsupported fields/);
});

test('proof import validates discarded review content rather than hiding malformed data', () => {
  const { sidecar, bindings } = fixture();
  const accepted = reviewObservation(importObservations(sidecar, bindings), 'observation-1', { action: 'accept' }, bindings, { now });
  const proof = exportObservationProof(accepted, bindings, { now });
  for (const mutate of [
    p => { p.reviews[0].annotation.label = 'Forged unchanged acceptance'; },
    p => { p.reviews[0].observationId = 'missing'; },
    p => { p.reviews[0].note = 'x'.repeat(601); },
    p => { p.reviews[0].reviewedAt = '2026-02-30T12:00:00.000Z'; },
    p => { p.reviewAuthority = 'certified'; },
    p => { p.sidecar.observations[0].worldX = 4; },
  ]) {
    const malformed = clone(proof); mutate(malformed);
    assert.throws(() => importObservations(malformed, bindings));
  }
});

test('every review and export rechecks live source/frame binding', () => {
  const { sidecar, bindings } = fixture();
  const session = importObservations(sidecar, bindings);
  bindings[0].frames[0].sha256 = digest('e');
  for (const act of [() => reviewObservation(session, 'observation-1', { action: 'accept' }, bindings),
    () => exportObservations(session, bindings), () => exportObservationProof(session, bindings)]) {
    assert.throws(act, /unbound or stale/);
  }
  assert.equal(session.reviews[0].status, 'pending');
});

test('maximum bounded sidecar remains usable without expanding observations into a world map', () => {
  const { sidecar } = fixture('video');
  sidecar.frames = Array.from({ length: 6 }, (_, i) => ({ ...clone(sidecar.frames[0]), id: 'frame-' + i,
    timestamp: { pts: String(i * 30000), timeBase: [1, 30000] } }));
  sidecar.observations = Array.from({ length: 100 }, (_, i) => ({ ...clone(sidecar.observations[0]), id: 'observation-' + i,
    frameId: 'frame-' + i % 6, label: 'L'.repeat(120), uncertainty: 'U'.repeat(600) }));
  const bindings = [{ ...sidecar.source, frames: clone(sidecar.frames) }];
  const session = importObservations(sidecar, bindings);
  assert.equal(session.observations.length, 100);
  assert.deepEqual(exportObservations(session, bindings), sidecar);
  assert.equal('world' in session, false);
  assert.equal('objects' in session, false);
  assert.equal('scaleReviewed' in session, false);
});

test('large human edits fail before creating an unexportable review state', () => {
  const { sidecar, bindings } = fixture();
  sidecar.observations = Array.from({ length: 100 }, (_, i) => ({ ...sidecar.observations[0], id: 'observation-' + i,
    label: '界'.repeat(120), uncertainty: '界'.repeat(600) }));
  let session = importObservations(sidecar, bindings), stopped = false;
  for (const observation of sidecar.observations) {
    try { session = reviewObservation(session, observation.id, { action: 'accept', note: '界'.repeat(600) }, bindings, { now }); }
    catch (error) {
      assert.match(error.message, /256 KiB/);
      assert.equal(session.reviews.find(item => item.observationId === observation.id).status, 'pending');
      stopped = true;
      break;
    }
  }
  assert.equal(stopped, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(exportObservationProof(session, bindings, { now }))).byteLength <= OBSERVATION_LIMITS.bytes);
});
