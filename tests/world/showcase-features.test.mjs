import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chapters } from '../../brainsnn-r3f-app/public/world/showcase-features.mjs';

const directory = new URL('../../brainsnn-r3f-app/public/world/', import.meta.url);
const read = name => readFile(new URL(name, directory), 'utf8');
const features = chapters.flatMap(chapter => chapter.features);

test('the showcase has six ordered chapters and unique, readable feature entries', () => {
  assert.deepEqual(chapters.map(({ id }) => id), ['robot', 'capture', 'scan', 'building', 'motion', 'share']);
  for (const chapter of chapters) {
    assert.ok(chapter.label && chapter.title && chapter.description, chapter.id);
    assert.ok(chapter.features.length, chapter.id);
  }
  assert.equal(new Set(features.map(({ label }) => label)).size, features.length);
  for (const { label, detail, access, target, focus } of features) {
    assert.ok(label && detail && access && target);
    assert.ok(access.length <= 28, access);
    if (['layer:scanedit', 'layer:stereo', 'layer:robottask'].includes(target)) assert.match(access, /^Preview · /u);
    if (focus !== undefined) {
      assert.equal(typeof focus, 'string', label);
      assert.ok(focus.trim() && !target.startsWith('/'), label);
    }
  }
});

test('every showcase destination connects to an existing control or an implemented local page', async () => {
  const [page, app, layerTools] = await Promise.all([read('index.html'), read('app.mjs'), read('world-layer-tools.mjs')]);
  const tabs = new Set(Array.from(page.matchAll(/data-tab="([a-z]+)"/g), match => match[1]));
  const layers = new Set(Array.from(/const titles = \{([^}]+)\};/u.exec(layerTools)[1].matchAll(/^\s*([a-z0-9]+): \[/gm), match => match[1]));
  const destinations = new Set(features.map(({ target }) => target));
  for (const layer of layers) assert.ok(destinations.has('layer:' + layer), layer);
  for (const tab of tabs) assert.ok(destinations.has('tab:' + tab), tab);

  for (const target of destinations) {
    if (target === '/arena/index.html') {
      assert.match(await read('../arena/index.html'), /aria-label="Interactive 3D robot arm/u);
      continue;
    }
    if (target.startsWith('#')) {
      assert.ok(page.includes('id="' + target.slice(1) + '"'), target);
      continue;
    }
    const local = /^\/world\/([a-z-]+\.html)(?:#([a-z0-9-]+))?$/u.exec(target);
    if (local) {
      const [, filename, fragment] = local;
      const linked = await read(filename);
      assert.match(linked, /<main[\s>]/i);
      if (fragment) assert.ok(linked.includes(`id="${fragment}"`), target);
      continue;
    }
    const [type, id, extra] = target.split(':');
    assert.match(id || '', /^[a-z0-9-]+$/u);
    assert.equal(extra, undefined);
    if (type === 'tab') assert.ok(tabs.has(id), target);
    else if (type === 'layer') assert.ok(layers.has(id), target);
    else if (type === 'section') assert.ok(page.includes(`id="${id}"`), target);
    else if (target === 'project:review') assert.match(page, /<dialog id="project-review-dialog"/);
    else if (target === 'studio:processing') {
      assert.match(app, /class="processing-options"/u);
      assert.match(app, /\bshowProcessing\s*:/u);
    }
    else assert.fail('Unknown showcase destination ' + target);
  }
});

test('the tour offers the showroom, simulated senses, robot task and saved projects once in their chapters', () => {
  const places = new Map([
    ['#showroom', 'capture'],
    ['/world/sense-trial.html', 'robot'],
    ['/world/projects.html', 'share'],
  ]);
  for (const [target, expected] of places) {
    const entries = chapters.flatMap(chapter => chapter.features.filter(f => f.target === target).map(() => chapter.id));
    assert.deepEqual(entries, [expected], target);
  }
  const robotActivities = chapters.flatMap(chapter => chapter.features
    .filter(f => f.target === 'layer:robottask')
    .map(f => [chapter.id, f.label, f.focus]));
  assert.deepEqual(robotActivities, [
    ['robot', 'Make a robot task', '[data-robot-task-run]'],
    ['robot', 'Cook a pancake', '[data-pancake-station]'],
  ]);
});

test('each film cue has the same time in the transcript and exactly one playable tool', async () => {
  const [markup, vtt, shell] = await Promise.all([read('index.html'), read('media/showcase-captions.vtt'), read('sw.js')]);
  const controls = [...markup.matchAll(/data-showcase-seek="([\d.]+)" data-film-cue="(\d+)"/g)];
  const cues = [...vtt.matchAll(/^(\d+)\r?\n(\d+):(\d+):([\d.]+) -->/gm)];
  const bindings = features.flatMap(feature => feature.filmCues || []).sort((a,b) => a-b);
  assert.equal(controls.length, cues.length);
  assert.deepEqual(bindings, cues.map(cue => Number(cue[1])));
  for (const [i,cue] of cues.entries()) {
    assert.equal(Number(controls[i][1]), Number(cue[2])*3600 + Number(cue[3])*60 + Number(cue[4]));
    assert.equal(controls[i][2],cue[1]);
  }
  for (const path of ['showcase.mjs','showcase-features.mjs','showcase.css','media/showcase-captions.vtt','media/showcase-poster.jpg']) {
    assert.ok(shell.includes("'./" + path + "'"), path);
  }
});
