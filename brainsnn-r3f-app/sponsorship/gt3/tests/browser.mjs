// Browser checks use isolated storage. The optional provider check never submits proposals.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '@playwright/test';
process.env.GT3_SKIP_PRELOAD='true';
const require=createRequire(import.meta.url),{createHandler}=require('../server.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gt3-browser-')),reports=path.resolve('sponsorship/gt3/reports');
fs.mkdirSync(reports,{recursive:true});
let handler;const server=http.createServer((q,r)=>handler.matches(q.url)?void handler.handle(q,r):(r.writeHead(404),r.end()));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
handler=createHandler({origin:base,dbPath:path.join(temp,'qa.sqlite'),env:{SPONSOR_ADMIN_KEY:'fixture-owner-key-for-local-only',SPONSOR_SESSION_SECRET:'fixture-session-not-production'}});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={transport:'mocked Sketchfab; actual isolated HTTP/SQLite proposals',checks:[],provider:null};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const sdk=`(()=>{const state=window.__gt3={calls:[],listeners:{},inits:0};class Sketchfab{constructor(version,frame){this.frame=frame;}init(uid,options){state.inits++;this.frame.src='https://sketchfab.com/models/'+uid+'/embed';let started=false,id=0;const done=(name,args,cb,value)=>{state.calls.push({name,args});cb?.(null,value);};const api={addEventListener(name,fn){state.listeners[name]=fn;},start(cb){if(!started){started=true;setTimeout(()=>state.listeners.viewerready?.(),30);}cb?.();},stop(cb){cb?.();},getCameraLookAt(cb){if(window.__cameraFailure)cb(Error('camera fixture'));else cb(null,{position:[3,-6,2],target:[0,0,0]});},setCameraLookAt(...a){done('camera',a.slice(0,-1),a.at(-1));},addTexture(data,cb){done('addTexture',[],cb,'texture'+(++id));},updateTexture(data,uid,cb){done('updateTexture',[],cb,uid);},createMaterial(spec,cb){done('createMaterial',[],cb,{id:++id});},createDecal(spec,cb){done('createDecal',[spec],cb,{id:++id});},destroyDecal(id,options,cb){done('destroyDecal',[],cb);},getScreenShot(w,h,type,cb){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#162335';x.fillRect(0,0,w,h);cb(null,c.toDataURL());}};options.success(api);}}window.Sketchfab=Sketchfab;})();`;
async function mock(page){await page.route('https://static.sketchfab.com/api/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));await page.route('https://sketchfab.com/models/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Mocked provider transport</title>'}));}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await mock(page);
 await page.goto(base+'/sponsor/gt3/');
 check('Eight placements render',await page.locator('.zone').count()===8);
 check('Simple is the initial mode',await page.locator('body').getAttribute('data-mode')==='simple');
 check('Model connection is not claimed before loading',await page.locator('body').getAttribute('data-model-ready')!=='true');
 await page.locator('[data-mode="advanced"]').click();
 check('Advanced tools revealed',await page.locator('#brand-name').isVisible());
 await page.locator('#launch').click();await page.waitForFunction(()=>document.body.dataset.modelReady==='true');
 await page.waitForFunction(()=>!document.getElementById('place').disabled);
 check('Ready acknowledged from provider event',await page.locator('body').getAttribute('data-model-ready')==='true');
 check('Iframe retains nonzero layout',await page.locator('#car').evaluate(e=>e.clientWidth>0&&e.clientHeight>0&&getComputedStyle(e).display!=='none'));
 await page.locator('#brand-name').fill('BRAIN SNN QA');await page.locator('#place').click();
 check('Artwork requires explicit consent',(await page.locator('#viewer-status').textContent()).includes('Approve artwork'));
 await page.locator('#art-consent').check();await page.locator('#place').click();
 await page.evaluate(()=>window.__gt3.listeners.click({position3D:[0,0,0],normal:[0,0,1]}));
 await page.waitForFunction(()=>window.__gt3.calls.some(x=>x.name==='createDecal'));
 const meshes=await page.evaluate(()=>window.__gt3.calls.filter(x=>x.name==='createDecal').length);
 await page.locator('#brand-name').fill('UPDATED');await page.waitForFunction(()=>window.__gt3.calls.some(x=>x.name==='updateTexture'));
 check('Text edits reuse geometry',await page.evaluate(()=>window.__gt3.calls.filter(x=>x.name==='createDecal').length)===meshes);
 await page.locator('[data-mode="simple"]').click();await page.locator('[data-mode="advanced"]').click();
 check('Switching modes preserves one model session',await page.evaluate(()=>window.__gt3.inits)===1);
 await page.locator('button[data-view="photo"]').click();await page.locator('button[data-view="3d"]').click();
 check('Switching views does not reload model',await page.evaluate(()=>window.__gt3.inits)===1);
 const dl=page.waitForEvent('download');await page.locator('#save').click();await(await dl).saveAs(path.join(reports,'export-mocked-viewer.png'));report.checks.push('Credited PNG export produces a download; mocked image not real geometry');
 await page.locator('.proposal').first().click();await page.waitForFunction(()=>!document.getElementById('submit').disabled);
 await page.locator('#name').fill('QA Person');await page.locator('#company').fill('Isolated Test');await page.locator('#email').fill('qa@example.test');await page.locator('#proposed-budget').fill('20000');await page.locator('#brief').fill('Temporary local browser test. Not a real sponsorship application.');await page.locator('input[name="consent"]').check();await page.locator('#submit').click();
 await page.waitForFunction(()=>document.getElementById('form-status').textContent.includes('Proposal saved. Reference'));
 check('Actual temporary database stored one proposal',handler.database().prepare('SELECT COUNT(*) n FROM gt3_proposals').get().n===1);
 check('Duplicate submission remains disabled',await page.locator('#submit').isDisabled());
 await page.keyboard.press('Escape');check('Escape closes modal',!(await page.locator('#proposal').evaluate(e=>e.open)));
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});check('No horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:1440,height:1000});await page.locator('button[data-view="photo"]').click();await page.locator('[data-mode="simple"]').click();await page.screenshot({path:path.join(reports,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(reports,'mobile.png'),fullPage:true});
 const failure=await browser.newPage();await failure.addInitScript(()=>window.__cameraFailure=true);await mock(failure);await failure.goto(base+'/sponsor/gt3/?view=3d');await failure.waitForFunction(()=>document.body.dataset.modelReady==='true');
 check('Camera failure cannot suppress ready model',await failure.locator('#stage').getAttribute('data-phase')==='ready');
 check('Camera failure leaves optional placement control disabled',await failure.locator('#place').isDisabled());
 const bridge=await browser.newPage();await bridge.route('https://static.sketchfab.com/api/**',r=>r.abort());await bridge.route('https://sketchfab.com/models/**',r=>r.fulfill({contentType:'text/html',body:'native fixture'}));await bridge.goto(base+'/sponsor/gt3/?view=3d');await bridge.waitForFunction(()=>document.getElementById('stage').dataset.phase==='native');
 check('SDK failure falls back to direct provider iframe',(await bridge.locator('#car').getAttribute('src')).includes('autostart=1'));
 check('Native iframe load is not misreported as scene ready',await bridge.locator('body').getAttribute('data-model-ready')==='false');
 check('No page JavaScript exceptions',errors.length===0);
 if(process.env.GT3_REAL_MODEL==='true'){
  const real=await browser.newPage({viewport:{width:1280,height:900}});report.provider={mode:'real external Sketchfab network, read-only',ready:false,errors:[]};real.on('pageerror',e=>report.provider.errors.push(e.message));
  try{await real.goto(base+'/sponsor/gt3/?mode=advanced&view=3d',{waitUntil:'domcontentloaded'});await real.waitForFunction(()=>document.body.dataset.modelReady==='true',{},{timeout:120000});report.provider.ready=true;report.provider.controlsAvailable=!(await real.locator('#reset').isDisabled());await real.locator('#stage').screenshot({path:path.join(reports,'real-sketchfab.png')});}
  catch(e){report.provider.failure=e.message;report.provider.status=await real.locator('#viewer-status').textContent().catch(()=>null);await real.screenshot({path:path.join(reports,'provider-failure.png')}).catch(()=>{});}
 }
}finally{fs.writeFileSync(path.join(reports,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));handler.close();fs.rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify(report,null,2));
