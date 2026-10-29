import test from 'node:test';
import assert from 'node:assert/strict';
import {createSandboxSession, routeSelection, sandboxURL} from '../../brainsnn-r3f-app/public/world/sandbox-session.mjs';

test('capture retains the return scene and tool without claiming media registration', () => {
  const session = createSandboxSession();
  session.select('street','simulate');
  const capture = session.select('capture');
  assert.equal(session.isCurrent(capture),true);
  assert.equal(session.getState().sceneId,null);
  assert.equal(session.snapshot().returnWorkspace,'street');
  session.returnToScene();
  assert.deepEqual({...session.getState(),revision:0},{workspace:'street',tool:'simulate',sceneId:'green-gardens',revision:0,disposed:false});
});

test('map and street keep independent tools and scene identities', () => {
  const session = createSandboxSession();
  session.select('map','evidence'); session.select('street','export'); session.select('map');
  assert.equal(session.getState().tool,'evidence');
  assert.equal(session.getState().sceneId,'planning-map');
  session.select('street');
  assert.equal(session.getState().tool,'export');
  assert.equal(session.getState().sceneId,'green-gardens');
});

test('a slow lazy mount cannot win after changing mode or tool', async () => {
  const session = createSandboxSession();
  let release;
  const load = new Promise(resolve => { release = resolve; });
  const streetToken = session.select('street');
  const commit = load.then(() => session.isCurrent(streetToken));
  session.select('capture'); release();
  assert.equal(await commit,false);
  const next = session.select('street','edit'); session.select('street','evidence');
  assert.equal(session.isCurrent(next),false);
});

test('token identity rejects forged objects and survives no async operation after disposal', () => {
  const session = createSandboxSession(); const token = session.select('street');
  assert.equal(session.isCurrent({...token}),false);
  assert.equal(session.isCurrent(token),true);
  session.cancelPending(); assert.equal(session.isCurrent(token),false);
  const next = session.select('map'); session.dispose();
  assert.equal(session.isCurrent(next),false);
  assert.throws(() => session.select('street'),/disposed/);
});

test('snapshots are detached, serializable navigation with no media or credential slots', () => {
  const session = createSandboxSession(); session.select('street','simulate'); session.select('capture');
  const snap = session.snapshot(); snap.lastTools.street = 'export';
  assert.equal(session.snapshot().lastTools.street,'simulate');
  const restored = createSandboxSession(); restored.restore(JSON.parse(JSON.stringify(session.snapshot())));
  restored.returnToScene(); assert.equal(restored.getState().workspace,'street'); assert.equal(restored.getState().tool,'simulate');
  for (const secret of ['token','sources','world','edits','workerToken']) {
    assert.throws(() => restored.restore({...session.snapshot(),[secret]:'private'}),/descriptor/);
  }
});

test('source mismatch, malformed and polluted descriptors fail without losing prior state', () => {
  const session = createSandboxSession(); const token = session.select('street','simulate');
  const before = session.snapshot();
  const invalid = [
    {...before,sceneId:'planning-map'},
    {...before,returnWorkspace:'map'},
    {...before,lastTools:{map:'edit',street:'evidence'}},
    {...before,lastTools:{map:'edit',street:'simulate',__extra:'yes'}},
    JSON.parse('{"schema":"brainsnn.sandbox-session.v1","__proto__":{"polluted":true}}'),
    Object.create({workspace:'street',tool:'edit'}),
  ];
  for (const value of invalid) {
    assert.throws(() => session.restore(value));
    assert.deepEqual(session.snapshot(),before);
    assert.equal(session.isCurrent(token),true);
  }
  assert.equal({}.polluted,undefined);
});

test('initial state rejects scene mismatch and never accepts a full scene as navigation', () => {
  assert.throws(() => createSandboxSession({initial:{workspace:'street',sceneId:'planning-map'}}),/does not belong/);
  assert.throws(() => createSandboxSession({initial:{workspace:'street',objects:[]}}),/geometry/);
  assert.throws(() => createSandboxSession({initial:{workspace:'https://evil.test'}}),/Unknown/);
});

test('restoring navigation invalidates pending requests rather than reusing an old revision', () => {
  const session = createSandboxSession(); const token = session.select('street','edit');
  const snapshot = session.snapshot(); session.select('capture'); const restored = session.restore(snapshot);
  assert.equal(session.isCurrent(token),false);
  assert.equal(session.isCurrent(restored),true);
  assert.ok(restored.revision>token.revision);
});

test('share routes resolve only known scene and workspace combinations', () => {
  for (const route of ['?sandbox=street','?scene=green-gardens','?sandbox=street&scene=green-gardens']) {
    assert.equal(routeSelection(route).workspace,'street');
  }
  assert.deepEqual(routeSelection('?sandbox=capture&tool=evidence'),{workspace:'capture',tool:'evidence',sceneId:null});
  for (const route of ['?sandbox=street&scene=planning-map','?sandbox=capture&scene=green-gardens','?scene=https://evil.test/model.json','?sandbox=__proto__','?sandbox=street&sandbox=map','?tool=edit&tool=export']) {
    assert.equal(routeSelection(route).workspace,'map');
  }
});

test('share links keep safe shell options but exclude credentials, media, edits and old routes', () => {
  const original = 'https://user:password@www.brainsnn.com/world/?nosw=1&install=1&lang=en-CA&theme=dark&token=secret&key=secret&source=private.mp4&edits=%7B%7D&sandbox=map&scene=planning-map#old';
  const link = sandboxURL(original,{workspace:'street',tool:'simulate'}), url = new URL(link);
  assert.equal(url.origin,'https://www.brainsnn.com'); assert.equal(url.pathname,'/world/');
  assert.equal(url.username,''); assert.equal(url.password,'');
  for (const name of ['token','key','source','edits']) assert.equal(url.searchParams.has(name),false);
  assert.equal(url.searchParams.get('nosw'),'1'); assert.equal(url.searchParams.get('install'),'1');
  assert.equal(url.searchParams.get('lang'),'en-CA'); assert.equal(url.searchParams.get('theme'),'dark');
  assert.equal(url.hash,'#workspace');
  assert.deepEqual(routeSelection(link),{workspace:'street',tool:'simulate',sceneId:'green-gardens'});
  const session = createSandboxSession({initial:routeSelection(link)});
  assert.equal(sandboxURL(original,session.getState()),link);
  assert.throws(() => sandboxURL('javascript:alert(1)',{workspace:'street'}),/HTTP/);
});
