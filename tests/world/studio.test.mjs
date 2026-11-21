import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chapters } from '../../brainsnn-r3f-app/public/world/showcase-features.mjs';
import { CHAPTER_ICONS, CHAPTER_SHORT, accessTone, featurePlace, isWorkbenchPage, searchFeatures } from '../../brainsnn-r3f-app/public/world/studio.mjs';

const directory = new URL('../../brainsnn-r3f-app/public/world/', import.meta.url);
const read = name => readFile(new URL(name, directory), 'utf8');
const features = chapters.flatMap(chapter => chapter.features);

test('every chapter has a picture and a short visible name for the studio bar', () => {
  for (const chapter of chapters) {
    assert.match(CHAPTER_ICONS[chapter.id] || '', /^<svg [^>]*aria-hidden="true"/u, chapter.id);
    assert.ok(CHAPTER_SHORT[chapter.id]?.trim(), chapter.id);
    assert.ok(CHAPTER_SHORT[chapter.id].length <= 14, CHAPTER_SHORT[chapter.id]);
  }
});

test('every separate tool page opens in the workbench; nothing else does', () => {
  const pages = features.filter(({ target }) => target.startsWith('/'));
  assert.ok(pages.length >= 12, 'the showcase lists the separate World Builder pages and the Arena');
  for (const { target } of pages) {
    assert.equal(isWorkbenchPage(target), true, target);
    assert.equal(featurePlace(target), 'workbench', target);
  }
  for (const { target } of features.filter(({ target }) => !target.startsWith('/'))) {
    assert.equal(isWorkbenchPage(target), false, target);
  }
  // The playground itself, other sites and unsafe shapes never load in the workbench.
  for (const target of ['/world/index.html', '/world/index.html#workspace', 'https://example.com/world/a.html', '//evil.test/world/a.html',
    '/world/../server.ts', '/world/a.html?x=1', 'javascript:alert(1)', '/arena/other.html']) {
    assert.equal(isWorkbenchPage(target), false, target);
  }
  assert.equal(featurePlace('#showroom'), 'showroom');
  assert.equal(featurePlace('tab:world'), 'world');
});

test('search finds tools by any word and needs every word to match', () => {
  const total = features.length;
  assert.equal(searchFeatures(chapters, '').length, total);
  assert.equal(searchFeatures(chapters, '   ').length, total);
  const drawing = searchFeatures(chapters, 'drawings');
  assert.ok(drawing.length >= 1 && drawing.every(({ feature, chapter }) =>
    `${feature.label} ${feature.detail} ${feature.access} ${chapter.label} ${chapter.title}`.toLowerCase().includes('drawings')));
  assert.ok(searchFeatures(chapters, 'ROBOT route').length >= 1, 'search ignores case');
  assert.equal(searchFeatures(chapters, 'route zzzznothing').length, 0);
});

test('access notes fall into four plain tones', () => {
  const tones = new Set(features.map(({ access }) => accessTone(access)));
  for (const tone of tones) assert.ok(['example', 'preview', 'needs', 'ready'].includes(tone), tone);
  assert.equal(accessTone('Preview · on this device'), 'preview');
  assert.equal(accessTone('Needs setup'), 'needs');
  assert.equal(accessTone('Has an example'), 'example');
  assert.equal(accessTone('On this device'), 'ready');
});

test('the playground page carries the studio, its workbench and the offline shell', async () => {
  const [page, app, shell, css] = await Promise.all([read('index.html'), read('app.mjs'), read('sw.js'), read('studio.css')]);
  for (const id of ['studio', 'studio-sticky', 'studio-bar', 'studio-home', 'studio-chapters', 'studio-search-open', 'studio-panel',
    'studio-workbench', 'studio-workbench-title', 'studio-workbench-close', 'studio-workbench-tab', 'studio-workbench-frame', 'studio-main']) {
    assert.ok(page.includes(`id="${id}"`), id);
  }
  assert.match(page, /<link rel="stylesheet" href="\.\/studio\.css">/u);
  // The studio wraps the world and everything after it, and the bar comes before the workspace in reading order.
  const order = ['<section class="hero">', 'id="studio-bar"', 'id="studio-workbench"', 'id="showroom"', 'id="workspace"', 'id="showcase"', 'id="systems"', '<section class="closing">'];
  const positions = order.map(marker => page.indexOf(marker));
  assert.ok(positions.every(position => position >= 0), JSON.stringify(positions));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(app, /mountStudioBar\(/u);
  assert.match(app, /openPage:\(feature,chapter,origin\)=>workbench\.show/u);
  for (const name of ['studio.mjs', 'studio.css']) assert.ok(shell.includes(`'./${name}'`), name);
  // No visible studio text below the playground's 13 px floor.
  for (const [, size] of css.matchAll(/font(?:-size)?:[^;}]*?\b(\d+(?:\.\d+)?)px/gu)) assert.ok(Number(size) >= 13, size + 'px');
});
