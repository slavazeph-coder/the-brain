// Read-only provider diagnostics: no applications, payments or secrets are sent.
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
process.env.GT3_SKIP_PRELOAD='true';
const require=createRequire(import.meta.url),{createHandler}=require('../server.cjs');
const out=path.resolve('sponsorship/gt3/reports'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'gt3-provider-'));
fs.mkdirSync(out,{recursive:true});
const report={scope:'Read-only real provider, separate from mocked UI checks',sdk:[],network:[],errors:[],ready:false,orbitChanged:false};
const uid='e738eae819c34d19a31dd066c45e0f3d';
let handler;const server=http.createServer((req,res)=>handler.matches(req.url)?void handler.handle(req,res):(res.writeHead(404),res.end()));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
handler=createHandler({origin:base,dbPath:path.join(temp,'local.sqlite'),env:{}});
const browser=await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 for(const version of ['1.12.1','1.12.0']){
  const url='https://static.sketchfab.com/api/sketchfab-viewer-'+version+'.js';
  try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});const body=await r.text();report.sdk.push({version,status:r.status,bytes:body.length,contentType:r.headers.get('content-type'),isBridge:body.includes('Sketchfab')});}
  catch(e){report.sdk.push({version,error:e.message});}
 }
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const safeUrl=url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return 'invalid';}};
 page.on('pageerror',e=>report.errors.push(e.message.slice(0,400)));
 page.on('console',m=>{if(m.type()==='error'&&report.errors.length<30)report.errors.push(m.text().slice(0,400));});
 page.on('requestfailed',r=>{if(report.network.length<80)report.network.push({url:safeUrl(r.url()),failure:r.failure()?.errorText});});
 page.on('response',r=>{if(r.url().includes('/api/sketchfab-viewer-')||r.url().includes('/models/'+uid+'/embed'))report.network.push({url:safeUrl(r.url()),status:r.status()});});
 await page.goto(base+'/sponsor/gt3/?mode=advanced&view=3d',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.modelReady==='true'||document.getElementById('stage').dataset.phase==='native',{},{timeout:90000}).catch(e=>report.waitError=e.message);
 report.phase=await page.locator('#stage').getAttribute('data-phase');
 report.status=await page.locator('#viewer-status').textContent();
 report.ready=await page.locator('body').getAttribute('data-model-ready')==='true';
 const frame=page.frames().find(f=>f.url().includes('sketchfab.com/models/'));
 if(frame){
  await frame.waitForSelector('canvas',{timeout:90000}).catch(e=>report.canvasError=e.message);
  await page.waitForTimeout(10000);
  report.canvas=await frame.locator('canvas').evaluateAll(els=>els.map(e=>({width:e.width,height:e.height,display:getComputedStyle(e).display})));
  report.frameTitle=await frame.title();
  const stage=page.locator('#stage');await stage.scrollIntoViewIfNeeded();
  const before=await stage.screenshot({path:path.join(out,'provider-before-orbit.png')});
  const rect=await page.locator('#car').boundingBox();
  if(rect){await page.mouse.move(rect.x+rect.width*.55,rect.y+rect.height*.52);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.30,rect.y+rect.height*.52,{steps:35});await page.mouse.up();await page.waitForTimeout(2000);}
  const after=await stage.screenshot({path:path.join(out,'provider-after-orbit.png')});report.orbitChanged=!before.equals(after);
 }
 await page.screenshot({path:path.join(out,'provider-fullpage.png'),fullPage:true});
}catch(e){report.failure=e.message;}finally{
 fs.writeFileSync(path.join(out,'provider-readonly.json'),JSON.stringify(report,null,2));
 await browser.close();await new Promise(r=>server.close(r));handler.close();fs.rmSync(temp,{recursive:true,force:true});
}
console.log(JSON.stringify(report,null,2));
