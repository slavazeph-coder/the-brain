'use strict';
const { makeEnv } = require('./brainsnn-selection-fixture.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../dist/experiment.js'), 'utf8');

function env({ renderer = true } = {}) {
  const e = makeEnv();
  const page = e.document.createElement('section');
  page.innerHTML = '<div id="experiment-root"></div><div id="demo-workspace"></div>';
  e.document.body.appendChild(page);
  e.siteCalls = [];
  e.siteState = null;
  if (renderer) e.ctx.BrainSNNSiteRenderer = {};
  // Stub the public panel boundary only. Geometry and panel behavior have their
  // own tests; these tests exercise the real experiment router and lifecycle.
  e.ctx.BrainSNNSiteWorkspace = {
    mount(host, selection) {
      assert(host?.isConnected);
      e.siteState = { robotId: selection.robotId, modelId: selection.modelId, policyExecuted: false };
      e.siteCalls.push({ type: 'mount', selection: { ...selection } });
    },
    suspend() { e.siteCalls.push({ type: 'suspend' }); },
    updateSelection(selection) { e.siteCalls.push({ type: 'update', selection: { ...selection } }); },
    getState() { return e.siteState; },
  };
  vm.runInContext(source, e.ctx, { filename: 'experiment.js' });
  return e;
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
async function test(name, fn) { await fn(); console.log('PASS', name); }

(async () => {
  await test('original G1 link exposes site entry while retaining exact robot/model/task/seed', async () => {
    const e = env();
    e.ctx.location.hash = '#playground?robot=g1&model=groot&task=Supported+reach&seed=42';
    e.ctx.BrainSNNExperiment.restoreFromURL();
    assert(e.q('[data-experiment-view="site"]'));
    assert.equal(e.siteCalls.filter(x => x.type === 'mount').length, 0);
    e.q('[data-experiment-view="site"]').click();
    await flush();
    const selected = e.ctx.BrainSNNExperiment.getState();
    assert.equal(selected.view, 'site');
    assert.equal(selected.robotId, 'g1');
    assert.equal(selected.modelId, 'groot');
    assert.equal(selected.task, 'Supported reach');
    assert.equal(selected.seed, '42');
    assert.equal(selected.policyExecuted, false);
    assert.equal(selected.runtimeConnected, false);
    assert(e.ctx.location.hash.includes('view=site'));
    assert.equal(e.siteCalls.filter(x => x.type === 'mount').length, 1);
    e.q('[data-experiment-view="arena"]').click();
    assert.equal(e.arenaFixture.selection.robotId, 'g1');
    assert.equal(e.arenaFixture.selection.modelId, 'groot');
  });
  await test('explicit site deep links and field edits retain selection', async () => {
    const e = env();
    e.ctx.location.hash = '#playground?robot=g1&model=groot&seed=91&view=site';
    e.ctx.BrainSNNExperiment.restoreFromURL(); await flush();
    assert.equal(e.ctx.BrainSNNExperiment.getState().view, 'site');
    e.$('experiment-seed').value = '314'; e.$('experiment-seed').dispatch('input');
    const call = e.siteCalls.at(-1);
    assert.equal(call.type, 'update');
    assert.equal(call.selection.seed, '314');
    assert.equal(call.selection.robotId, 'g1');
    assert.equal(call.selection.modelId, 'groot');
    e.ctx.BrainSNNExperiment.suspend();
    assert.equal(e.siteCalls.at(-1).type, 'suspend');
  });
  await test('navigation away during lazy load cannot mount into a stale panel', async () => {
    const e = env({ renderer: false });
    e.ctx.BrainSNNExperiment.open({ robotId: 'g1', modelId: 'groot', view: 'site' });
    const script = e.document.body.querySelector('script'); assert(script);
    assert.equal(script.src, 'site-renderer.js');
    e.ctx.BrainSNNExperiment.open({ robotId: 'panda', modelId: 'pi05', view: 'arena' });
    e.ctx.BrainSNNSiteRenderer = {}; script.onload(); await flush();
    assert.equal(e.siteCalls.filter(x => x.type === 'mount').length, 0);
    assert.equal(e.ctx.BrainSNNExperiment.getState().robotId, 'panda');
  });
  await test('site-only route opens without inventing a selected robot or AI', async () => {
    const e = env(); e.ctx.location.hash = '#playground?view=site';
    e.ctx.BrainSNNExperiment.restoreFromURL(); await flush();
    const s = e.ctx.BrainSNNExperiment.getState();
    assert.equal(s.view, 'site'); assert.equal(s.robotId, null); assert.equal(s.modelId, null);
    assert.equal(s.policyExecuted, false);
  });
  await test('renderer network failure leaves a working retry action', async () => {
    const e = env({ renderer: false });
    e.ctx.BrainSNNExperiment.open({ robotId: 'g1', modelId: 'groot', view: 'site' });
    e.document.body.querySelector('script').onerror(); await flush();
    assert.match(e.$('site-workspace-root').textContent, /could not load/);
    assert(e.q('[data-experiment-action="reload-viewer"]'));
    e.q('[data-experiment-action="reload-viewer"]').click();
    assert(e.document.body.querySelector('script'));
  });
  await test('worker plans the exact submitted scene and rejects malformed geometry', async () => {
    const coreScope = { module: { exports: {} } }; vm.createContext(coreScope);
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../dist/site-core.js'), 'utf8'), coreScope);
    const core = coreScope.module.exports;
    const replies = [];
    const scope = { self: null, importScripts(name) { assert.equal(name, 'site-core.js'); scope.BrainSNNSiteCore = core; }, postMessage(value) { replies.push(value); } };
    scope.self = scope; vm.createContext(scope);
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../dist/site-plan-worker.js'), 'utf8'), scope);
    scope.onmessage({ data: { id: 1, scene: core.sampleScene(), robot: 'g1', options: { mode: 'navigation' } } });
    assert.equal(replies[0].id, 1); assert.equal(replies[0].ok, true);
    assert.equal(replies[0].result.status, 'complete');
    assert.equal(replies[0].result.sceneDigest, core.digest(core.sampleScene()));
    scope.onmessage({ data: { id: 2, scene: { width: Infinity }, robot: 'g1' } });
    assert.equal(replies[1].ok, false); assert.match(replies[1].error, /Floor width/);
  });
  await test('published 3D bundle declares its lazy-load interface without starting WebGL', async () => {
    const scope = { window: {}, console, TextDecoder, TextEncoder, URL, Blob, performance };
    vm.createContext(scope);
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../dist/site-renderer.js'), 'utf8'), scope);
    assert.equal(typeof scope.window.BrainSNNSiteRenderer.create, 'function');
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
