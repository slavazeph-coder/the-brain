import test from 'node:test';
import assert from 'node:assert/strict';

import { createVault, memoryBackend } from './vault.js';
import { isoDate, applyTemplate, ensureDailyNote, DEFAULT_TEMPLATE } from './vaultDaily.js';

test('isoDate: pads month + day', () => {
  assert.equal(isoDate(new Date('2026-01-05T12:00:00Z')), '2026-01-05');
});

test('applyTemplate substitutes {{date}} and {{weekday}}', () => {
  const out = applyTemplate('# {{date}} ({{weekday}})', { date: '2026-04-30', weekday: 'Thu' });
  assert.equal(out, '# 2026-04-30 (Thu)');
});

test('ensureDailyNote creates today\'s note on first call', () => {
  const v = createVault({ backend: memoryBackend() });
  const now = new Date('2026-04-30T12:00:00');
  const note = ensureDailyNote(v, { now });
  assert.equal(note.id, '2026-04-30');
  assert.match(note.body, /2026-04-30/);
  assert.ok(note.tags.includes('daily'));
});

test('ensureDailyNote is idempotent across calls on the same day', () => {
  const v = createVault({ backend: memoryBackend() });
  const now = new Date('2026-04-30T08:00:00');
  const a = ensureDailyNote(v, { now });
  const b = ensureDailyNote(v, { now: new Date('2026-04-30T22:00:00') });
  assert.equal(a.id, b.id);
  assert.equal(v.list().length, 1);
});

test('ensureDailyNote uses the default template when none passed', () => {
  const v = createVault({ backend: memoryBackend() });
  const note = ensureDailyNote(v, { now: new Date('2026-04-30T12:00:00') });
  assert.match(note.body, /## Today/);
  assert.match(note.body, /## Notes/);
});

test('DEFAULT_TEMPLATE has both substitution markers', () => {
  assert.match(DEFAULT_TEMPLATE, /\{\{date\}\}/);
  assert.match(DEFAULT_TEMPLATE, /\{\{weekday\}\}/);
});
