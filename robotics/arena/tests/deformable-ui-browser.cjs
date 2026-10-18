/* Real UI, WebWorker and MuJoCo WASM; no substituted physics or paid services. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const nodePath=require('node:path');
const http=require('node:http');
const fsSync=require('node:fs');
const {createRequire}=require('node:module');
const app=nodePath.resolve(__dirname,'../../../brainsnn-r3f-app');
const {chromium}=createRequire(nodePath.join(app,'package.json'))('@playwright/test');
const publicRoot=nodePath.join(app,'public');
const artifacts=nodePath.resolve(__dirname,'../../../output/playwright');
const server=http.createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 const file=nodePath.resolve(publicRoot,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
 if(!file.startsWith(publicRoot+nodePath.sep)||!fsSync.existsSync(file)||!fsSync.statSync(file).isFile())return response.writeHead(404).end();
 response.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'})[nodePath.extname(file)]||'application/octet-stream');
 fsSync.createReadStream(file).pipe(response);
});
(async()=>{
 let b;
 try {
 await fs.mkdir(artifacts,{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const target=process.env.BRAINSNN_DEFORMABLE_URL||base+'/arena/deformable/';
 const origin=new URL(target).origin;
 b=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}:process.platform==='darwin'?{channel:'chrome'}:{})}); const p=await b.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}); const errors=[],requests=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));
 const state=()=>p.evaluate(()=>JSON.parse(render_game_to_text()));
 const ready=()=>p.waitForFunction(()=>BrainSNNDeformableApp.getState().phase==='ready',null,{timeout:120000});
 await p.goto(target);await ready();
 let s=await state();assert.equal(s.playing,false);assert.equal(s.frames,0);assert.equal(s.policyExecuted,false);assert(s.rope.length===21);assert.equal(await p.locator('.source-details').getAttribute('open'),null);
 await p.screenshot({path:nodePath.join(artifacts,'deformable-desktop.png'),fullPage:true});
 await p.locator('#amplitude').fill('100');await p.locator('#run-strike').click();assert.equal((await state()).phase,'ready');assert.equal((await state()).frames,0);assert.equal(await p.locator('#amplitude').evaluate(e=>e.validity.rangeOverflow),true);
 await p.locator('#amplitude').fill('45'); await p.locator('#run-strike').click();await p.waitForFunction(()=>BrainSNNDeformableApp.getState().frames>2,null,{timeout:120000});
 await p.evaluate(()=>BrainSNNDeformableApp.pause());s=await state();const paused=s.time;await p.evaluate(()=>advanceTime(500));assert.equal((await state()).time,paused);
 await p.locator('#run-strike').click();await p.evaluate(()=>advanceTime(500));assert((await state()).time>paused);await p.evaluate(()=>BrainSNNDeformableApp.pause());
 const oldFrames=(await state()).frames;await p.locator('#target-y').fill('0.12');assert.equal((await state()).draftChanged,true);await p.locator('#run-strike').click();await ready();await p.evaluate(()=>BrainSNNDeformableApp.pause());s=await state();assert.equal(s.config.target[1],.12);assert.equal(s.draftChanged,false);assert.equal(s.frames,oldFrames);
 await p.locator('#timeline').fill(String(s.frames-1));s=await state();assert.equal(s.playing,false);assert.equal(s.cursor,s.frames-1);
 for(const camera of ['top','front','orbit']){await p.locator(`[data-camera=${camera}]`).click();assert.equal(await p.locator(`[data-camera=${camera}]`).getAttribute('aria-pressed'),'true');}
 await p.screenshot({path:nodePath.join(artifacts,'deformable-strike.png'),fullPage:true});
 let downloadPromise=p.waitForEvent('download');await p.locator('#export-episode').click();let download=await downloadPromise;let path=await download.path();let episode=JSON.parse(await fs.readFile(path,'utf8'));assert.equal(episode.config.target[1],.12);assert.equal(episode.searchReport,undefined);assert(episode.frames.length>2);assert.equal(episode.provenance.policyExecuted,false);
 await p.locator('#find-swing').click();await ready();assert.equal(await p.locator('#export-search').isVisible(),true);await p.evaluate(()=>BrainSNNDeformableApp.pause());
 downloadPromise=p.waitForEvent('download');await p.locator('#export-search').click();download=await downloadPromise;path=await download.path();let archive=JSON.parse(await fs.readFile(path,'utf8'));assert.equal(archive.report.schema,'brainsnn.deformable.search.v1');assert.equal(archive.report.status,'complete');assert.equal(archive.report.cases.length,13);assert.equal(archive.episodes.length,13);assert(archive.episodes.every(e=>e.frames.length>2));assert(archive.report.cases.every(c=>c.config.target[1]===.12));assert.equal(archive.report.selectedMotionVerified,true);
 await ready();
 await p.evaluate(async evidenceId=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('brainsnn.deformable.v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{await new Promise((resolve,reject)=>{const transaction=db.transaction('episodes','readwrite');transaction.objectStore('episodes').delete(evidenceId);transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}
 },archive.episodes[0].evidenceId);
 downloadPromise=p.waitForEvent('download');await p.locator('#export-search').click();download=await downloadPromise;
 const incomplete=JSON.parse(await fs.readFile(await download.path(),'utf8'));
 assert.equal(incomplete.schema,'brainsnn.deformable.incomplete-export.v1');assert.equal(incomplete.completeRecordingsIncluded,false);assert.equal(incomplete.report.cases.length,13);assert.match(incomplete.recordingError,/missing/);assert.equal(incomplete.episodes,undefined);
 await ready();await p.locator('[data-batch-count="100"]').click();await p.locator('#run-batch').click();await p.locator('#cancel-batch').click();await ready();s=await state();assert.equal(s.localBatch.status,'cancelled');assert(s.localBatch.completed<100);
 downloadPromise=p.waitForEvent('download');await p.locator('#export-batch').click();download=await downloadPromise;archive=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(archive.report.status,'cancelled');assert.equal(archive.episodes.length,archive.report.completed);
 await ready();await p.locator('#run-batch').click();assert.equal(await p.locator('#cancel-batch').isEnabled(),true);await p.locator('#cancel-batch').click();await ready();
 await p.locator('#reset-strike').click();await ready();assert.equal((await state()).frames,0);assert.equal(await p.locator('#export-search').isVisible(),false);
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:nodePath.join(artifacts,'deformable-mobile.png'),fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await p.locator('#amplitude').evaluate(e=>getComputedStyle(e).fontSize),'16px');
 await p.setViewportSize({width:320,height:800});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:nodePath.join(artifacts,'deformable-mobile320.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert(requests.every(u=>u.startsWith(origin+'/')||u.startsWith('blob:')));console.log('UI_CHECK_OK: paused physical world, invalid numeric rejection, run/pause/resume, deterministic advance, dirty draft new run, timeline, cameras, correct single export, 13-recording search archive fixed target, cancel/re-cancel and partial archive, reset, 390/320 responsive layout, no errors/external requests.');
 } finally { await b?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e.stack);process.exit(1)})
