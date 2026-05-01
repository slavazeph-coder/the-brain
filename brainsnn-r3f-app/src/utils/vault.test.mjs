import test from 'node:test';
import assert from 'node:assert/strict';

import { createVault, memoryBackend, slugify } from './vault.js';

function freshVault(seed = {}) {
  return createVault({ backend: memoryBackend(seed) });
}

test('slugify: basic, special chars, empty', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('  Spaces  Trimmed  '), 'spaces-trimmed');
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify('Mixed_Case-123'), 'mixed-case-123');
});

test('vault is empty on fresh start', () => {
  const v = freshVault();
  assert.equal(v.list().length, 0);
  assert.equal(v.stats().noteCount, 0);
});

test('create + get round-trip', () => {
  const v = freshVault();
  const note = v.create({ title: 'My Note', body: 'Hello [[other]]', tags: ['x'] });
  assert.equal(note.id, 'my-note');
  assert.equal(note.title, 'My Note');
  assert.equal(note.body, 'Hello [[other]]');
  assert.deepEqual(note.tags, ['x']);
  const got = v.get('my-note');
  assert.equal(got.body, 'Hello [[other]]');
});

test('list orders by modifiedAt descending', async () => {
  const v = freshVault();
  v.create({ title: 'A' });
  await new Promise((r) => setTimeout(r, 5));
  v.create({ title: 'B' });
  await new Promise((r) => setTimeout(r, 5));
  v.update('a', { body: 'updated' });
  const ids = v.list().map((e) => e.id);
  // 'a' was last modified, so should come first
  assert.equal(ids[0], 'a');
});

test('duplicate titles produce -2, -3 suffixes', () => {
  const v = freshVault();
  const a = v.create({ title: 'Note' });
  const b = v.create({ title: 'Note' });
  const c = v.create({ title: 'Note' });
  assert.equal(a.id, 'note');
  assert.equal(b.id, 'note-2');
  assert.equal(c.id, 'note-3');
});

test('update patches body but preserves id, title, createdAt', () => {
  const v = freshVault();
  const note = v.create({ title: 'X', body: 'old' });
  const updated = v.update('x', { body: 'new' });
  assert.equal(updated.id, 'x');
  assert.equal(updated.title, 'X');
  assert.equal(updated.body, 'new');
  assert.equal(updated.createdAt, note.createdAt);
  assert.ok(updated.modifiedAt >= note.modifiedAt);
});

test('update returns null for missing id', () => {
  const v = freshVault();
  assert.equal(v.update('missing', { body: 'x' }), null);
});

test('remove deletes the note and the index entry', () => {
  const v = freshVault();
  v.create({ title: 'Doomed' });
  assert.equal(v.remove('doomed'), true);
  assert.equal(v.get('doomed'), null);
  assert.equal(v.list().length, 0);
});

test('remove returns false for missing id', () => {
  const v = freshVault();
  assert.equal(v.remove('ghost'), false);
});

test('getByTitle finds a note by case-insensitive title', () => {
  const v = freshVault();
  v.create({ title: 'My Note' });
  const got = v.getByTitle('my note');
  assert.ok(got);
  assert.equal(got.id, 'my-note');
});

test('getByTitle returns null when no match', () => {
  const v = freshVault();
  v.create({ title: 'A' });
  assert.equal(v.getByTitle('B'), null);
});

test('importBundle creates many notes and returns them', () => {
  const v = freshVault();
  const created = v.importBundle([
    { title: 'A', body: 'a', tags: ['t'] },
    { title: 'B', body: 'b' },
    { title: 'A', body: 'duplicate' },
  ]);
  assert.equal(created.length, 3);
  assert.equal(created[2].id, 'a-2');
  assert.equal(v.list().length, 3);
});

test('importBundle rejects non-arrays', () => {
  const v = freshVault();
  assert.throws(() => v.importBundle({ not: 'array' }));
});

test('exportBundle round-trips through importBundle', () => {
  const v = freshVault();
  v.create({ title: 'A', body: 'a-body' });
  v.create({ title: 'B', body: 'b-body', tags: ['x', 'y'] });
  const exported = v.exportBundle();
  const v2 = freshVault();
  v2.importBundle(exported);
  const re = v2.exportBundle();
  assert.equal(re.length, 2);
  const titles = re.map((n) => n.title).sort();
  assert.deepEqual(titles, ['A', 'B']);
});

test('clear empties the vault', () => {
  const v = freshVault();
  v.create({ title: 'A' });
  v.create({ title: 'B' });
  v.clear();
  assert.equal(v.list().length, 0);
  assert.equal(v.stats().noteCount, 0);
});

test('tags are capped at 16 entries', () => {
  const v = freshVault();
  const tags = Array.from({ length: 30 }, (_, i) => `t${i}`);
  const note = v.create({ title: 'T', tags });
  assert.equal(note.tags.length, 16);
});

test('stats counts notes, bytes, and unique tags', () => {
  const v = freshVault();
  v.create({ title: 'A', body: 'hello', tags: ['x', 'y'] });
  v.create({ title: 'B', body: 'world', tags: ['y', 'z'] });
  const s = v.stats();
  assert.equal(s.noteCount, 2);
  assert.equal(s.tags, 3);
  assert.ok(s.bytes >= 10);
});

test('persistence: creating a vault on the same backend keeps the notes', () => {
  const backend = memoryBackend();
  const a = createVault({ backend });
  a.create({ title: 'Persistent', body: 'body' });
  const b = createVault({ backend });
  const got = b.get('persistent');
  assert.ok(got);
  assert.equal(got.body, 'body');
});

test('persistence: corrupted index returns empty list, not a throw', () => {
  const backend = memoryBackend({ brainsnn_vault_index_v1: 'not json' });
  const v = createVault({ backend });
  assert.equal(v.list().length, 0);
});
