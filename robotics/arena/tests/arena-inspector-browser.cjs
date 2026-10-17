/* Real Chromium flows for the inert recording inspector and practice integration.
 * No GPU worker or model execution is claimed by these synthetic fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const app = path.resolve(__dirname, '../../../brainsnn-r3f-app');
const { chromium } = createRequire(path.join(app, 'package.json'))('@playwright/test');
const assets = path.resolve(__dirname, '../dist');
const fixtureHTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/arena-workspace.css"><link rel="stylesheet" href="/arena-inspector.css"></head><body><div id="experiment-root"></div>${['arena-3d.js','arena-profiles.js','arena-recording.js','arena-inspector.js','arena-workspace.js'].map(file => `<script src="/${file}"></script>`).join('')}</body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/test.html') { res.setHeader('Content-Type', 'text/html'); res.end(fixtureHTML); return; }
  const name = req.url.slice(1); if (!/^[a-z0-9-]+\.(js|css)$/.test(name) || !fs.existsSync(path.join(assets, name))) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(assets, name)));
});
function upload(bundle) { return { name: 'recording.json', mimeType: 'application/json', buffer: Buffer.from(typeof bundle === 'string' ? bundle : JSON.stringify(bundle)) }; }
async function fixture(api, action = .2, changes = {}) {
  const artifact = id => ({ id, path: id + '.rgb', mediaType: 'application/octet-stream', retention: 'included', dtype: 'uint8', shape: [2, 2, 3], endianness: 'not-applicable' });
  const event = (id, seq, kind, data, refs = [], artifactIds = []) => ({ id, seq, kind, simTime: seq / 10, refs, artifactIds, data });
  const manifest = api.createManifest({ recordingId: 'test-recording', source: { kind: 'simulator-policy', identityStatus: 'declared', producer: 'Synthetic UI test fixture' },
    context: { taskId: 'test-task', taskRevision: 'v1', judgeRevision: 'v1', environment: 'test-only', actionSemantics: 'test input', stateSemantics: 'test state', units: 'unitless', preprocessingRevision: 'v1', initialState: { fixtureState: [0, 1] } },
    artifacts: [artifact('camera-a'), artifact('camera-b')],
    events: [event('episode',1,'episode-start',{}), event('observation',2,'observation',{ cameras: [{id:'agentview',artifactId:'camera-a'},{id:'wrist',artifactId:'camera-b'}], state:[0,1]},['episode'],['camera-a','camera-b']),
      event('request',3,'inference-start',{observationId:'observation'},['observation']), event('chunk',4,'inference-result',{observationId:'observation',chunkId:'chunk',actions:[[action,0],[.8,1]],queuedCount:1,unusedCount:1},['request','observation']),
      event('chosen',5,'controller-input',{vector:[action,0],chunkId:'chunk',chunkIndex:0,observationId:'observation'},['chunk','observation']), event('state',6,'state',{state:[1,2],controllerInputId:'chosen'},['chosen']),
      event('outcome',7,'outcome',{status:'failed',judge:'fixture'},['state'])], findings: [{id:'finding',origin:'rule',producer:'test rule',summary:'A fixture input is available to inspect.',refs:['chosen']}],
    completion:{status:'complete',committedSequence:7,lastObservedSequence:7,gapCount:0,unknownTail:false}, outcome:{status:'failed'}, ...changes });
  return api.seal(manifest, { 'camera-a.rgb': new Uint8Array([255,0,0,0,255,0,0,0,255,255,255,255]), 'camera-b.rgb': new Uint8Array(12).fill(80) });
}
(async () => {
  let browser;
  try {
    await import(pathToFileURL(path.join(assets, 'arena-recording.js')).href); const api = globalThis.BrainSNNArenaRecording;
    const candidate = await fixture(api), baseline = await fixture(api, .1), altered = await fixture(api, .3);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) }); const page = await browser.newPage({ viewport: {width:1280,height:900} }); page.setDefaultTimeout(12000);
    const errors = [], requests = []; page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push({url:request.url(),method:request.method()}));
    await page.addInitScript(() => { window.__ticks = new Map(); let id=0; window.setInterval=fn=>{window.__ticks.set(++id,fn);return id;};window.clearInterval=id=>window.__ticks.delete(id); });
    await page.goto(base + '/test.html'); await page.evaluate(() => BrainSNNArena.mount(document.querySelector('#experiment-root'), {}));
    assert.equal(await page.locator('#experiment-root button:visible').count(), 1, 'one initial Run button');
    await page.locator('.arena-recording-tools summary').click(); await page.getByText('Open a recording',{exact:true}).click();
    await page.locator('#ai-file').setInputFiles(upload(candidate)); await page.getByText('Schema valid · hashes match',{exact:true}).waitFor().catch(async error=>{throw new Error(error.message+'\n'+await page.locator('dialog').innerText()+'\n'+errors.join('\n'));});
    await page.locator('#ai-event-id').fill('state'); await page.getByRole('button',{name:'Go to event',exact:true}).click();
    assert.match(await page.locator('#ai-selected-event').innerText(), /state · state/);
    assert.equal(await page.locator('#ai-selection .ai-image canvas').count(), 2, 'both cameras follow exact recorded reference chain');
    assert.deepEqual(await page.locator('#ai-image-candidate-0 canvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0,0,1,1).data)), [255,0,0,255], 'raw RGB shown losslessly');
    assert.match(await page.locator('#ai-selection').innerText(), /Predicted chunk · chunk/);
    await page.locator('#ai-selection [data-event="chosen"]').first().click();
    assert.match(await page.locator('#ai-selected-event').innerText(), /controller-input · chosen/);
    assert.match(await page.locator('#ai-selection').innerText(), /not measured motor output/);
    await page.locator('#ai-position').focus(); await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('#ai-selected-event').innerText(), /state · state/);
    assert.equal(await page.locator('#ai-position').evaluate(element=>element===document.activeElement), true, 'keyboard focus preserved while scrubbing');
    await page.locator('[data-review="finding"]').click(); await page.locator('#ai-reviewer').fill('Fixture reviewer'); await page.getByRole('button',{name:'Save local review',exact:true}).click();
    assert.match(await page.locator('#ai-reviews').innerText(), /Current/);
    await page.locator('#ai-file').setInputFiles(upload(altered)); await page.waitForFunction(()=>document.querySelector('#ai-reviews')?.textContent.includes('Stale'));
    assert.match(await page.locator('#ai-reviews').innerText(), /Recording identity changed/);
    await page.locator('#ai-file').setInputFiles(upload(candidate)); await page.waitForFunction(()=>document.querySelector('#ai-reviews')?.textContent.includes('Current'));
    await page.locator('#ai-baseline').setInputFiles(upload(baseline)); await page.getByRole('button',{name:'Compare aligned evidence',exact:true}).waitFor();
    await page.getByRole('button',{name:'Compare aligned evidence',exact:true}).click();
    assert.match(await page.locator('.ai-comparison').innerText(), /First supported difference/);
    assert.match(await page.locator('.ai-comparison').innerText(), /inference-result values differ/);
    assert.equal(await page.locator('#ai-baseline-detail .ai-image canvas').count(), 2);
    const baselineOriginals=await api.importBundle(baseline), baselineCameraManifest=JSON.parse(baseline.manifestText), baselineCameraBytes=new Uint8Array(12).fill(33);
    delete baselineCameraManifest.artifacts[0].sha256;delete baselineCameraManifest.artifacts[0].byteLength;
    await page.locator('#ai-baseline').setInputFiles(upload(await api.seal(baselineCameraManifest,{...baselineOriginals.payloads,'camera-a.rgb':baselineCameraBytes})));
    await page.getByRole('button',{name:'Compare aligned evidence',exact:true}).click();
    const baselineOriginalDownload=page.waitForEvent('download');await page.locator('#ai-baseline-detail [data-baseline-artifact="camera-a"]').first().click();
    assert.deepEqual(fs.readFileSync(await(await baselineOriginalDownload).path()),Buffer.from(baselineCameraBytes),'baseline artifact link resolves baseline bytes despite colliding candidate artifact ID');
    const candidateOriginalDownload=page.waitForEvent('download');await page.locator('#ai-selection [data-artifact="camera-a"]').first().click();
    assert.deepEqual(fs.readFileSync(await(await candidateOriginalDownload).path()),Buffer.from((await api.importBundle(candidate)).payloads['camera-a.rgb']),'candidate artifact link still resolves candidate original');
    await page.locator('#ai-alignment').selectOption('event'); await page.locator('#ai-baseline-event').fill('missing'); await page.locator('#ai-candidate-event').fill('state'); await page.getByRole('button',{name:'Compare aligned evidence',exact:true}).click();
    assert.match(await page.locator('#ai-error').innerText(), /exact recorded event IDs/);
    const incompatible = await fixture(api,.1,{context:{taskId:'other'}}); await page.locator('#ai-baseline').setInputFiles(upload(incompatible)); await page.getByText('Comparison blocked · incompatible or unknown context',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Compare aligned evidence',exact:true}).isDisabled(),true);
    const corrupt = {...candidate,manifestSha256:'0'.repeat(64)}; await page.locator('#ai-file').setInputFiles(upload(corrupt)); await page.waitForFunction(()=>document.querySelector('#ai-error').textContent.includes('SHA256'));
    assert.match(await page.locator('.ai-summary').innerText(),/test-recording/,'bad import preserves checked evidence');
    const downloadOriginal = page.waitForEvent('download'); await page.getByRole('button',{name:'Export original bundle',exact:true}).click();
    const original = fs.readFileSync(await (await downloadOriginal).path(),'utf8'); assert.equal((await api.importBundle(original)).bundle.manifestSha256,candidate.manifestSha256);
    await page.locator('#ai-omit-images').check(); const downloadSelected = page.waitForEvent('download'); await page.getByRole('button',{name:'Export selected bundle',exact:true}).click();
    const redacted = await api.importBundle(fs.readFileSync(await (await downloadSelected).path(),'utf8')); assert.notEqual(redacted.bundle.manifestSha256,candidate.manifestSha256); assert(redacted.manifest.artifacts.every(item=>item.retention==='omitted')); assert.equal(redacted.manifest.completion.status,'partial');
    const originals = await api.importBundle(candidate), datasetManifest = JSON.parse(candidate.manifestText); datasetManifest.source.kind='imported';
    datasetManifest.events.find(item=>item.id==='observation').data.cameras.forEach(camera=>Object.assign(camera,{role:'dataset-camera',pts:'20',timeBase:[1,100],sourceTime:.2,offsetSeconds:0,errorSeconds:0,consumedByPolicy:false}));
    Object.assign(datasetManifest.events.find(item=>item.id==='chosen'),{kind:'dataset-action',data:{action:[.2,0],semantics:'dataset label; execution unverified'}});
    await page.locator('#ai-file').setInputFiles(upload(await api.seal(datasetManifest,originals.payloads))); await page.waitForFunction(()=>document.querySelector('.ai-summary')?.textContent.includes('imported'));
    await page.locator('#ai-event-id').fill('chosen'); await page.getByRole('button',{name:'Go to event',exact:true}).click();
    assert.match(await page.locator('#ai-selection').innerText(),/Dataset camera frames/); assert.match(await page.locator('#ai-selection').innerText(),/execution unverified/); assert.equal(await page.locator('#ai-selection .ai-image canvas').count(),2);
    await page.locator('#ai-selection details').first().locator('summary').click(); assert.match(await page.locator('#ai-selection').innerText(),/"pts": "20"/);
    const oversizedManifest=JSON.parse(candidate.manifestText), png=new Uint8Array(24); png.set([137,80,78,71,13,10,26,10],0);png.set([73,72,68,82],12);new DataView(png.buffer).setUint32(16,100000);new DataView(png.buffer).setUint32(20,100000);
    const largeArtifact=oversizedManifest.artifacts[0];Object.assign(largeArtifact,{mediaType:'image/png'});for(const key of ['dtype','shape','endianness','sha256','byteLength'])delete largeArtifact[key];
    await page.locator('#ai-file').setInputFiles(upload(await api.seal(oversizedManifest,{...originals.payloads,'camera-a.rgb':png}))); await page.waitForFunction(()=>document.querySelector('.ai-summary')?.textContent.includes('simulator-policy'));
    await page.locator('#ai-event-id').fill('observation'); await page.getByRole('button',{name:'Go to event',exact:true}).click();assert.match(await page.locator('#ai-image-candidate-0').innerText(),/exceed the display limit/);assert.equal(await page.locator('#ai-image-candidate-0 img').count(),0,'oversized PNG is rejected before assigning image src');
    const plotManifest=api.createManifest({recordingId:'plot-edge-fixture',events:[[Number.MAX_SAFE_INTEGER,2],[-Number.MAX_SAFE_INTEGER],[]].map((state,index)=>({id:'plot-'+index,seq:index+1,kind:'state',simTime:index,refs:[],artifactIds:[],data:{state}})),completion:{status:'complete',committedSequence:3,lastObservedSequence:3,gapCount:0,unknownTail:false}});
    await page.locator('#ai-file').setInputFiles(upload(await api.seal(plotManifest,{})));await page.waitForFunction(()=>document.querySelector('.ai-summary')?.textContent.includes('plot-edge-fixture'));
    assert.equal(await page.locator('.ai-chart svg').count(),2,'ragged and empty vectors do not create empty dimensions');
    assert.equal(await page.locator('.ai-chart circle').evaluateAll(points=>points.every(point=>Number.isFinite(Number(point.getAttribute('cx')))&&Number.isFinite(Number(point.getAttribute('cy'))))),true,'large supported values have finite plot coordinates');
    assert.equal(requests.filter(item=>item.method!=='GET'||(!item.url.startsWith(base)&&!item.url.startsWith('blob:'))).length,0,'imports and inspection never issue worker requests');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').count(),0); assert.equal(await page.locator('[data-arena-action="open-recording"]').evaluate(element=>element===document.activeElement),true);
    await page.locator('#arena-run').click(); await page.evaluate(()=>{for(let i=0;i<500&&!BrainSNNArena.getState().currentSnapshot.state.done;i++)for(const tick of [...window.__ticks.values()])tick();});
    await page.getByRole('button',{name:'Inspect run',exact:true}).click(); await page.getByText('Scripted local practice. No named model ran; this is not a model score.',{exact:true}).waitFor();
    assert.match(await page.locator('.ai-summary').innerText(),/partial evidence/); assert.equal(await page.locator('#ai-practice-candidate').count(),1); assert.match(await page.locator('#ai-content').innerText(),/unknown tail/);
    await page.getByRole('button',{name:'Save local review',exact:true}).click(); await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Inspect run',exact:true}).click(); await page.waitForFunction(()=>document.querySelector('#ai-reviews')?.textContent.includes('Current'));
    assert.match(await page.locator('#ai-reviews').innerText(),/Current/,'closing and reopening an unchanged practice preserves exact review identity');
    await page.setViewportSize({width:390,height:844});
    assert(await page.locator('.ai-shell').evaluate(element=>element.scrollWidth<=element.clientWidth+1),'mobile inspector has no horizontal overflow');
    await page.screenshot({path:'/tmp/arena-inspector-mobile.png'});
    await page.keyboard.press('Escape');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('ARENA_INSPECTOR_BROWSER_OK: raw cameras, reference links, keyboard, comparison, stale review, exports, malformed import, no worker commands, practice completion and mobile layout.');
  } finally { server.closeAllConnections(); await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
