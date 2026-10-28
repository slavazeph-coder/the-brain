import test from 'node:test';
import assert from 'node:assert/strict';
import { stageLocalCapture, readLocalCapture, clearLocalCapture, validateCaptureFiles, parseHandoffHash, HANDOFF_TTL_MS, HANDOFF_MAX_BYTES } from '../../brainsnn-r3f-app/public/world/capture-handoff.mjs';

const ID = '11111111-2222-4333-8444-555555555555';
function fakeFile(name, size, type) { return { name, size, type }; }
function memoryStore() {
  const records = new Map();
  return {
    records,
    put: async value => { records.set(value.id, value); },
    get: async id => records.get(id) || null,
    delete: async id => { records.delete(id); },
    prune: async now => { for (const [id, record] of records) if (record.expiresAt <= now) records.delete(id); },
  };
}

test('consented handoff loads once and can be cleared, without worker calls', async () => {
  const store = memoryStore(), file = fakeFile('walkthrough.mp4', 87_527_102, 'video/mp4');
  const id = await stageLocalCapture([file], { goal: 'room', store, now: 1000, makeId: () => ID });
  assert.equal(id, ID);
  assert.equal((await readLocalCapture(id, { store, now: 1001 })).files[0], file);
  await clearLocalCapture(id, { store });
  assert.equal(await readLocalCapture(id, { store }), null);
});

test('expired records are rejected and removed', async () => {
  const store = memoryStore();
  await stageLocalCapture([fakeFile('room.jpg', 9000, 'image/jpeg')], { store, now: 2, makeId: () => ID });
  assert.equal(await readLocalCapture(ID, { store, now: HANDOFF_TTL_MS + 3 }), null);
  assert.equal(store.records.size, 0);
});

test('invalid media and unsupported goals are rejected', async () => {
  assert.throws(() => validateCaptureFiles([]), /Choose one video/);
  assert.throws(() => validateCaptureFiles([fakeFile('bad.pdf', 100, 'application/pdf')]), /MP4/);
  assert.throws(() => validateCaptureFiles([fakeFile('one.mp4', 100, 'video/mp4'), fakeFile('two.jpg', 100, 'image/jpeg')]), /one video/);
  assert.throws(() => validateCaptureFiles([fakeFile('big.mp4', 2 * 1024 ** 3 + 1, 'video/mp4')]), /2 GiB/);
  assert.throws(() => validateCaptureFiles([fakeFile('empty.jpg', 0, 'image/jpeg')]), /non-empty/);
  await assert.rejects(stageLocalCapture([fakeFile('test.jpg', 100, 'image/jpeg')], { goal: 'invalid', store: memoryStore(), makeId: () => ID }), /supported activity/);
});

test('handoff identifier stays in URL fragment, never query or media URL', () => {
  assert.equal(parseHandoffHash('#handoff=' + ID), ID);
  assert.equal(parseHandoffHash('#workspace'), null);
  assert.equal(parseHandoffHash('#handoff=../bad'), null);
  assert.equal(parseHandoffHash('#handoff=' + ID + '&other=1'), null);
});

test('bounded private handoff gives an honest large-video fallback', async () => {
  await assert.rejects(stageLocalCapture(
    [fakeFile('oversize.mp4', HANDOFF_MAX_BYTES + 1, 'video/mp4')],
    { goal: 'room', store: memoryStore(), makeId: () => ID },
  ), /128 MiB/);
});

test('portable ArrayBuffer record restores original bytes, name and type', async () => {
  const store = memoryStore();
  const bytes = new Uint8Array([11, 20, 64, 255]).buffer;
  store.records.set(ID, {
    id: ID, goal: 'room', version: 2, expiresAt: HANDOFF_TTL_MS + 100,
    files: [{ name: 'sample.png', type: 'image/png', size: 4, lastModified: 123, bytes }],
  });
  const record = await readLocalCapture(ID, { store, now: 100 });
  assert.equal(record.files[0].name, 'sample.png');
  assert.equal(record.files[0].type, 'image/png');
  assert.deepEqual(Array.from(new Uint8Array(await record.files[0].arrayBuffer())), [11, 20, 64, 255]);
});
