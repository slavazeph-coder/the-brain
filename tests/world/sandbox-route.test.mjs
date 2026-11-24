import test from 'node:test';
import assert from 'node:assert/strict';
import {appRoute, worldDocumentSource} from '../../brainsnn-r3f-app/src/world/worldRoute.js';
import {routeSelection} from '../../brainsnn-r3f-app/public/world/sandbox-session.mjs';

test('the home/world wrapper forwards the requested street scene and tool', () => {
  const path = worldDocumentSource('?sandbox=street&scene=green-gardens&tool=simulate');
  assert.deepEqual(routeSelection(path), {workspace:'street', sceneId:'green-gardens', tool:'simulate'});
  assert.equal(worldDocumentSource(''), '/world/index.html');
});
test('public scene routes never forward worker credentials or source URLs', () => {
  const path = worldDocumentSource('?sandbox=street&token=secret&passcode=secret&source=https%3A%2F%2Fprivate.example%2Ffile&install=1');
  assert.equal(path, '/world/index.html?sandbox=street&install=1');
  assert.equal(worldDocumentSource('?sandbox=street&sandbox=map&tool=delete&scene=https://evil.example'), '/world/index.html');
});

test('the public wrapper opens named playground activities without forwarding private fragments', () => {
  for (const hash of ['#workspace', '#world-examples', '#showroom', '#showroom-run', '#showroom-walk', '#rolling-pin',
    '#pancake-lab', '#showcase-motion', '#layer-tab-robottask']) {
    assert.equal(worldDocumentSource('?nosw=1&token=private', hash), '/world/index.html?nosw=1' + hash);
  }
  for (const hash of ['#handoff=secret', '#token=private', '#https://example.org', '#showroom?token=secret',
    '#showcase-unknown', '#layer-tab-unknown', '#pancake-lab%3Fpasscode%3Dsecret']) {
    assert.equal(worldDocumentSource('?token=private', hash), '/world/index.html');
  }
});
test('the root is the three-door homepage, and old World Builder links still open World Builder', () => {
  assert.equal(appRoute('/', ''), 'home');
  assert.equal(appRoute('', ''), 'home');
  assert.equal(appRoute('/', '?utm_source=linkedin'), 'home');
  assert.equal(appRoute('/world', ''), 'world');
  assert.equal(appRoute('/world/', '?sandbox=street'), 'world');
  // Links shared while World Builder was the homepage.
  assert.equal(appRoute('/', '?sandbox=street&scene=green-gardens'), 'world');
  assert.equal(appRoute('/', '?tool=simulate'), 'world');
  assert.equal(appRoute('/', '?install=1'), 'world');
  assert.equal(appRoute('/', '', '#showcase'), 'world');
  // A fragment World Builder does not publish is not a reason to leave the homepage.
  assert.equal(appRoute('/', '', '#handoff=abc'), 'home');
  assert.equal(appRoute('/', '?classic=1'), 'shell');
  assert.equal(appRoute('/', '?classic=1&sandbox=street'), 'shell');
  for (const path of ['/lab', '/office', '/scan', '/arena/tasks/x', '/worlds']) assert.equal(appRoute(path, ''), 'shell');
});
