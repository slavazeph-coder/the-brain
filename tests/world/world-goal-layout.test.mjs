import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../brainsnn-r3f-app/public/world/index.html', import.meta.url), 'utf8');
const scan = readFileSync(new URL('../../brainsnn-r3f-app/src/app/WorldScan.jsx', import.meta.url), 'utf8');
const worldCSS = readFileSync(new URL('../../brainsnn-r3f-app/public/world/world.css', import.meta.url), 'utf8');

test('homepage links to existing scan route for every goal', () => {
  for (const goal of ['play', 'room', 'bim', 'robot']) {
    assert.ok(html.includes('href="/scan?goal=' + goal + '"'), 'missing goal ' + goal);
  }
  assert.match(html, /id="workspace"/);
  assert.match(html, /id="what-to-create"/);
  assert.match(html, /href="#what-to-create"/);
  assert.match(html, /id="hero-capture"/);
  assert.match(worldCSS, /\.goal-entry-grid/);
});

test('goal entry preserves local capture consent and access limitations', () => {
  assert.match(html, /stays local until you approve an upload/);
  assert.match(html, /BIM exports and robot planning require additional evidence/);
  assert.match(scan, /no auto-upload/);
  assert.match(scan, /Public hosted signup is not available/);
  assert.match(scan, /human review/);
});

test('guided entry preserves original upload and worker paths', () => {
  assert.match(scan, /Choose a walkthrough video/);
  assert.match(scan, /Open World Builder/);
  assert.match(scan, /id="capture-card"/);
  assert.match(scan, /aria-pressed=\{goal === item.id\}/);
  assert.match(scan, /Hear the steps/);
  assert.match(scan, /Larger text/);
});
