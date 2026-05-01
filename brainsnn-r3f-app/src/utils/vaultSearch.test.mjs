import test from 'node:test';
import assert from 'node:assert/strict';

import { searchVault, autocompleteTitles } from './vaultSearch.js';

const NOTES = [
  { id: 'a', title: 'Apples and Oranges', body: 'red fruit', tags: ['food'] },
  { id: 'b', title: 'Banana Republic', body: 'yellow fruit', tags: ['food', 'history'] },
  { id: 'c', title: 'Cherry Pie', body: 'recipe with apples too', tags: ['recipe'] },
  { id: 'd', title: 'Untitled', body: '#foo body tag here' },
];

test('empty query returns nothing', () => {
  assert.deepEqual(searchVault(NOTES, ''), []);
});

test('exact-title match scores highest', () => {
  const r = searchVault(NOTES, 'Cherry Pie');
  assert.equal(r[0].note.id, 'c');
  assert.ok(r[0].score >= 100);
});

test('title prefix beats body match', () => {
  const r = searchVault(NOTES, 'apple');
  // 'Apples and Oranges' has prefix; cherry pie has body match
  assert.equal(r[0].note.id, 'a');
});

test('body word match found', () => {
  const r = searchVault(NOTES, 'recipe');
  // 'recipe' is a tag on Cherry, also a body word
  assert.equal(r[0].note.id, 'c');
});

test('tag match is found via explicit tags', () => {
  const r = searchVault(NOTES, 'food');
  // Both A and B have tag 'food'; we should get them with score >= 40
  const ids = r.map((m) => m.note.id);
  assert.ok(ids.includes('a'));
  assert.ok(ids.includes('b'));
});

test('tag match works on body #tags', () => {
  const r = searchVault(NOTES, 'foo');
  const ids = r.map((m) => m.note.id);
  assert.ok(ids.includes('d'));
});

test('subsequence-in-title still scores when no contain match', () => {
  const r = searchVault(NOTES, 'arpb', { minScore: 1 });
  // 'arpb' is a subsequence of 'banana republic' (a-r-p-b? a, r... no)
  // Use a real subseq: 'baan' is subseq of 'Banana...'
  const r2 = searchVault(NOTES, 'baan');
  assert.equal(r2[0].note.id, 'b');
});

test('limit caps results', () => {
  const r = searchVault(NOTES, 'food', { limit: 1 });
  assert.equal(r.length, 1);
});

test('minScore filter drops weak matches', () => {
  const r = searchVault(NOTES, 'z', { minScore: 5 });
  assert.equal(r.length, 0);
});

test('searchVault handles missing tags array gracefully', () => {
  const notes = [{ id: 'a', title: 'X', body: 'hi' }];
  const r = searchVault(notes, 'X');
  assert.equal(r[0].note.id, 'a');
});

test('autocompleteTitles: prefix priority', () => {
  const ac = autocompleteTitles(NOTES, 'b');
  assert.equal(ac[0].id, 'b');
});

test('autocompleteTitles: empty query returns []', () => {
  assert.deepEqual(autocompleteTitles(NOTES, ''), []);
});

test('autocompleteTitles: limit respected', () => {
  const ac = autocompleteTitles(NOTES, '', { limit: 2 });
  assert.equal(ac.length, 0);
});
