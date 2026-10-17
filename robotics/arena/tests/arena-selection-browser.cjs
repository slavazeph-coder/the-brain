/* Real Chromium startup and selection flows using the deployed Arena assets.
 * Worker HTTP responses below are synthetic contract fixtures. No named model,
 * simulator, external viewer, or paid service is executed by this test. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createRequire} = require('node:module');
const app = path.resolve(__dirname, '../../../brainsnn-r3f-app');
const {chromium} = createRequire(path.join(app, 'package.json'))('@playwright/test');
const assets = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local.test').pathname;
  const relative = pathname.replace(/^\/arena\//, '') || 'index.html';
  const file = path.resolve(assets, relative);
  if (!pathname.startsWith('/arena/') || !file.startsWith(assets + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404); res.end(); return;}
  const type = {'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}[path.extname(file)] || 'application/octet-stream';
  res.setHeader('Content-Type', type); res.end(fs.readFileSync(file));
});

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH} : {})});
    for (const viewport of [{width:1280,height:900}, {width:390,height:844}]) {
      const page = await browser.newPage({viewport}); page.setDefaultTimeout(12000);
      const errors = [], requests = []; let profile, seq = 0, workerStatus = 'ready';
      page.on('pageerror', error => errors.push(error.message));
      const frame = () => ({version:1,sessionId:'selection-fixture-session',profileId:profile.id,seq:++seq,simTime:0,status:workerStatus,policyExecuted:false,cameras:[],bodies:[],metrics:{steps:0},events:[]});
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base) return route.continue();
        if (url.origin !== 'https://worker.example.test') return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>External asset omitted in offline UI test</title>'});
        const method = request.method(), body = request.postData() ? JSON.parse(request.postData()) : null;
        requests.push({path:url.pathname,method,body,authorized:request.headers().authorization === 'Bearer browser-fixture-only'});
        let result;
        if (method === 'OPTIONS') result = {};
        else if (url.pathname === '/v1/capabilities') result = {version:1,profiles:[profile]};
        else if (url.pathname === '/v1/sessions' && method === 'POST') result = {version:1,sessionId:'selection-fixture-session',profileId:profile.id,robotId:profile.robotId,modelId:profile.modelId,checkpoint:profile.checkpoint,profile,status:'ready',frame:frame()};
        else if (url.pathname.endsWith('/commands')) {
          workerStatus = body.type === 'run' ? 'running' : body.type === 'pause' ? 'paused' : 'ready';
          result = {version:1,sessionId:'selection-fixture-session',requestId:body.requestId,status:workerStatus,frame:frame()};
        } else if (url.pathname.endsWith('/frame')) result = frame();
        else if (method === 'DELETE') result = {version:1,closed:true};
        else throw new Error('Unexpected synthetic worker request: ' + method + ' ' + url.pathname);
        return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS'},body:JSON.stringify(result)});
      });
      await page.goto(base + '/arena/', {waitUntil:'domcontentloaded'});
      await page.locator('#experiment-robot').waitFor({state:'visible'});
      assert.deepEqual(await page.locator('.app-nav button').allTextContents(), ['Arcade', 'Pricing']);
      await page.screenshot({path:`/tmp/arena-selection-startup-${viewport.width}.png`,fullPage:true});
      assert.equal(await page.locator('.arena-overflow a[href="/office"]').isVisible(), false, 'Review stays in the public overflow');
      assert.equal(await page.locator('.arena-overflow').getAttribute('open'), null);
      assert.equal(await page.locator('.arena-overflow [data-page="catalog"]').isVisible(), false);
      assert.equal(await page.locator('.experiment-more-tools').getAttribute('open'), null);
      assert.equal(await page.locator('[data-experiment-action="demo"]').isVisible(), false, 'Classic connector stays behind More tools');
      await page.locator('.arena-overflow > summary').click();
      assert.equal(await page.locator('.arena-overflow [data-page="catalog"]').isVisible(), true);
      assert.equal(await page.locator('.arena-overflow a[href="/arena/tasks"]').isVisible(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.arena-overflow').getAttribute('open'), null);
      assert.equal(await page.locator('.arena-overflow > summary').evaluate(element => element === document.activeElement), true);
      await page.locator('.arena-overflow > summary').click();
      await page.locator('.arena-overflow [data-page="catalog"]').click();
      assert.equal(await page.locator('#catalog').isVisible(), true);
      assert.equal(await page.locator('.arena-overflow').getAttribute('open'), null, 'choosing a tool closes the menu');
      await page.locator('.app-nav [data-page="playground"]').click();
      for (const id of ['experiment-model','experiment-task','experiment-seed']) assert.equal(await page.locator('#'+id).isVisible(), true, id+' is available before running');
      assert.equal(await page.locator('[data-arena-profile]:visible').count(), 4);
      assert.equal(await page.locator('#arena-run-top').isVisible(), true, 'Run is available above the arena stage');
      assert.equal(await page.locator('#arena-run-top').innerText(), await page.locator('#arena-run').innerText());
      let state = await page.evaluate(() => BrainSNNArena.getState());
      assert.equal(state.mode, 'practice'); assert.equal(state.running, false); assert.equal(state.currentSnapshot.state.steps, 0);
      assert.equal(await page.locator('#arena-scrubber').isVisible(), false);
      assert.equal(requests.length, 0, 'startup never contacts a worker');
      await page.locator('.app-nav [data-page="campaigns"]').click();
      await page.getByRole('heading', { name: 'Test packs & pricing', level: 1 }).waitFor();
      await page.locator('[data-campaign-tools]').waitFor({state:'visible'});
      await page.getByRole('button', { name: 'Try the arcade', exact: false }).click();
      await page.locator('[data-arena-challenge="clutter"]').click();
      await page.locator('#arena-run-top').click();
      await page.waitForFunction(() => BrainSNNArena.getState().currentSnapshot.state.steps > 0);
      assert.equal(await page.evaluate(() => BrainSNNArena.getState().running), true, 'pack CTA restores working arcade controls');
      await page.locator('#arena-run-top').click();
      assert.equal(await page.evaluate(() => BrainSNNArena.getState().running), false);
      await page.locator('[data-arena-challenge="starter"]').click();
      assert.equal(requests.length, 0, 'returning from packs and running practice never contacts a worker');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Arena has no horizontal viewport overflow at '+viewport.width+'px');
      profile = await page.evaluate(() => ({...BrainSNNArenaProfiles.find('panda-pi05-libero'),ready:true,checkpointRevision:'synthetic-browser-contract',simulator:{name:'fixture-only',version:'1'},commands:['run','pause','step','reset']}));

      await page.locator('#experiment-robot').selectOption('g1');
      await page.locator('#experiment-model').selectOption('sonic');
      await page.locator('#experiment-task').fill('push-recovery'); await page.locator('#experiment-seed').fill('73');
      state = await page.evaluate(() => BrainSNNArena.getState());
      assert.equal(state.mode, 'named'); assert.equal(state.selection.robotId, 'g1'); assert.equal(state.selection.modelId, 'sonic'); assert.equal(state.policyExecuted, false);
      assert.equal(await page.locator('#arena-canvas').count(), 0, 'choosing a named pair does not keep rendering the generic script');
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.BrainSNNArena?.getState().selection.modelId === 'sonic');
      assert.equal(await page.locator('#experiment-robot').inputValue(), 'g1'); assert.equal(await page.locator('#experiment-model').inputValue(), 'sonic');
      assert.equal(await page.locator('#experiment-task').inputValue(), 'push-recovery'); assert.equal(await page.locator('#experiment-seed').inputValue(), '73');
      await page.locator('.experiment-more-tools > summary').click();
      await page.locator('[data-experiment-view="setup"]').click();
      assert.equal(await page.evaluate(() => BrainSNNExperiment.getState().view), 'setup');
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.BrainSNNExperiment?.getState().view === 'setup');
      assert.equal(await page.locator('.experiment-more-tools').getAttribute('open'), '', 'secondary-view deep links keep their navigation available');
      assert.equal(await page.locator('[data-experiment-view="setup"]').getAttribute('aria-pressed'), 'true');
      await page.locator('.experiment-tabs [data-experiment-view="arena"]').click();
      assert.equal(await page.locator('.experiment-more-tools').getAttribute('open'), null);
      assert.equal(await page.locator('#experiment-robot').inputValue(), 'g1');
      assert.equal(await page.locator('#experiment-model').inputValue(), 'sonic');
      await page.locator('#arena-run').click();
      assert.equal(await page.locator('#arena-connect-panel').isVisible(), true);
      assert.equal(requests.length, 0, 'Run requests an explicit connection instead of silently starting a different model');
      async function connect() {
        await page.locator('#arena-worker-url').fill('https://worker.example.test');
        await page.locator('#arena-worker-token').fill('browser-fixture-only');
        await page.locator('#arena-connect-submit').click();
      }
      await connect();
      await page.waitForFunction(() => document.querySelector('#arena-connect-message').textContent.includes('no exact g1 + sonic'));
      assert.equal(requests.filter(r => r.path === '/v1/sessions' && r.method === 'POST').length, 0);
      state = await page.evaluate(() => BrainSNNArena.getState()); assert.equal(state.mode, 'named'); assert.equal(state.selection.modelId, 'sonic');

      await page.locator('#experiment-model').selectOption('pi05');
      assert.equal(await page.locator('#experiment-robot').inputValue(), 'g1', 'incompatible model choice never silently replaces the robot');
      const beforeIncompatible = requests.length;
      await page.locator('#arena-run').click(); await connect();
      await page.waitForFunction(() => document.querySelector('#arena-connect-message').textContent.includes('no listed integration route'));
      assert.equal(requests.length, beforeIncompatible, 'a catalog-incompatible pair fails before any worker request');
      state = await page.evaluate(() => BrainSNNArena.getState());
      assert.equal(state.mode, 'named'); assert.equal(state.selection.robotId, 'g1'); assert.equal(state.selection.modelId, 'pi05');
      assert.equal(state.policyExecuted, false); assert.equal((await page.evaluate(() => BrainSNNArena.exportEvidence())).local, null);
      assert.equal(requests.filter(r => r.path === '/v1/sessions' && r.method === 'POST').length, 0);

      await page.locator('#experiment-robot').selectOption('panda');
      assert.equal(await page.locator('#experiment-model').inputValue(), 'pi05');
      await page.locator('#experiment-task').fill('libero_spatial:0'); await page.locator('#experiment-seed').fill('91');
      await page.locator('#arena-run').click(); await connect();
      await page.waitForFunction(() => document.querySelector('#arena-worker-task-panel')?.hidden === false);
      await page.locator('#arena-worker-task').selectOption('libero_spatial:0');
      await page.locator('#arena-create-session').click();
      await page.waitForFunction(() => BrainSNNArena.getState().runtimeConnected);
      const creation = requests.find(r => r.path === '/v1/sessions' && r.method === 'POST');
      assert.deepEqual(creation.body, {version:1,profileId:'panda-pi05-libero',robotId:'panda',modelId:'pi05',checkpoint:profile.checkpoint,task:'libero_spatial:0',seed:91,protocol:'practice'});
      assert.equal(creation.authorized, true);
      await page.locator('#arena-run').click();
      await page.waitForFunction(() => BrainSNNArena.getState().connection.status === 'running');
      assert.equal(requests.filter(r => r.path.endsWith('/commands') && r.body.type === 'run').length, 1);
      let recorded = await page.evaluate(() => BrainSNNArena.exportEvidence());
      assert.equal(recorded.selected.robotId, 'panda'); assert.equal(recorded.selected.modelId, 'pi05'); assert.equal(recorded.execution.kind, 'worker'); assert.equal(recorded.local, null);
      assert.equal(recorded.execution.policyExecuted, false, 'synthetic worker must not be represented as a real model run');
      assert.ok(!JSON.stringify(recorded).includes('browser-fixture-only'));
      assert.ok(!await page.evaluate(() => Object.values(localStorage).join('').includes('browser-fixture-only')));
      await page.locator('#arena-run').click();
      await page.waitForFunction(() => BrainSNNArena.getState().connection.status === 'paused');
      await page.locator('#experiment-robot').selectOption('g1');
      await page.waitForFunction(() => !BrainSNNArena.getState().runtimeConnected);
      assert.equal(await page.evaluate(() => BrainSNNArena.getState().selection.modelId), 'pi05');
      await page.locator('.arena-mode-switch [data-arena-action="practice"]').click();
      await page.locator('[data-arena-challenge="clutter"]').click();
      state = await page.evaluate(() => BrainSNNArena.getState());
      assert.equal(state.mode, 'practice'); assert.equal(state.running, false); assert.equal(state.currentSnapshot.state.steps, 0); assert.equal(state.currentSnapshot.state.opts.challenge, 'clutter');
      assert.equal(state.selection.robotId, 'g1'); assert.equal(state.selection.modelId, 'pi05');
      await page.locator('#arena-run-top').click();
      await page.waitForFunction(() => BrainSNNArena.getState().currentSnapshot.state.steps > 0);
      assert.equal(await page.evaluate(() => BrainSNNArena.getState().running), true);
      assert.match(await page.locator('#arena-run-top').innerText(), /Pause/);
      assert.equal(await page.locator('#arena-run-top').innerText(), await page.locator('#arena-run').innerText(), 'both controls show the running state');
      await page.locator('#arena-run-top').click();
      assert.equal(await page.evaluate(() => BrainSNNArena.getState().running), false);
      assert.match(await page.locator('#arena-run-top').innerText(), /Run/);
      assert.equal(await page.locator('#arena-run-top').innerText(), await page.locator('#arena-run').innerText(), 'both controls return to the paused state');
      recorded = await page.evaluate(() => BrainSNNArena.exportEvidence());
      assert.equal(recorded.execution.robot, 'generic-demo-arm'); assert.equal(recorded.execution.policyExecuted, false); assert.equal(recorded.execution.benchmarkResult, null);
      assert.equal(errors.length, 0, errors.join('\n'));
      await page.close();
    }
    console.log('ARENA_SELECTION_BROWSER_OK: desktop/mobile upfront selection, exact pair persistence, unsupported-pair refusal, explicit worker HTTP contract, and clearly labeled local practice.');
  } finally {
    server.closeAllConnections(); await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
