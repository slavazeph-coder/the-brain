// Real provider verification. Uses only isolated local storage and read-only model access.
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
const report={scope:'Read-only real provider; no mock model and no production submissions',sdk:[],cases:[]};
const uid='e738eae819c34d19a31dd066c45e0f3d';
let handler;const server=http.createServer((req,res)=>handler.matches(req.url)?void handler.handle(req,res):(res.writeHead(404),res.end()));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
handler=createHandler({origin:base,dbPath:path.join(temp,'local.sqlite'),env:{}});
const browser=await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const safeUrl=url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return 'invalid';}};
try{
 for(const version of ['1.12.1','1.12.0']){try{const r=await fetch('https://static.sketchfab.com/api/sketchfab-viewer-'+version+'.js',{signal:AbortSignal.timeout(15000)});const body=await r.text();report.sdk.push({version,status:r.status,bytes:body.length,isBridge:body.includes('Sketchfab')});}catch(e){report.sdk.push({version,error:e.message});}}
 for(const version of ['1.12.1','1.12.0']){
  const item={version,ready:false,network:[],errors:[],frames:[]};report.cases.push(item);
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>item.errors.push(e.message.slice(0,400)));
  page.on('console',m=>{if(m.type()==='error'&&item.errors.length<25)item.errors.push(m.text().slice(0,400));});
  page.on('requestfailed',r=>{if(item.network.length<50)item.network.push({url:safeUrl(r.url()),failure:r.failure()?.errorText});});
  page.on('response',r=>{if(r.url().includes('/api/sketchfab-viewer-')||r.url().includes('/models/'+uid+'/embed'))item.network.push({url:safeUrl(r.url()),status:r.status()});});
  await page.addInitScript(()=>{window.__providerMessages=[];window.addEventListener('message',e=>{if(e.origin!=='https://sketchfab.com'||!e.data||!['api.ready','api.initialize.result','api.event'].includes(e.data.type)||window.__providerMessages.length>=20)return;const d=e.data;window.__providerMessages.push({type:d.type,error:typeof d.error==='string'?d.error:typeof d.error==='number'?d.error:null,event:d.type==='api.event'?String(d.results?.[0]):null});});});
  try{
   await page.goto(base+'/sponsor/gt3/?mode=advanced&view=3d&skfb_api_version='+version,{waitUntil:'domcontentloaded'});
   item.webgl=await page.evaluate(()=>{const c=document.createElement('canvas'),g=c.getContext('webgl2');if(!g)return false;const answer={version:g.getParameter(g.VERSION),maxTexture:g.getParameter(g.MAX_TEXTURE_SIZE)};g.getExtension('WEBGL_lose_context')?.loseContext();return answer;});
   await page.waitForFunction(()=>document.body.dataset.modelReady==='true'||document.getElementById('stage').dataset.phase==='native',{},{timeout:90000}).catch(e=>item.waitError=e.message);
   await page.waitForTimeout(15000);
   item.ready=await page.locator('body').getAttribute('data-model-ready')==='true';item.phase=await page.locator('#stage').getAttribute('data-phase');item.status=await page.locator('#viewer-status').textContent();item.messages=await page.evaluate(()=>window.__providerMessages);
   for(const f of page.frames())if(f!==page.mainFrame())item.frames.push({url:safeUrl(f.url()),canvases:await f.locator('canvas').evaluateAll(els=>els.map(e=>({id:e.id,className:e.className,width:e.width,height:e.height,visible:e.getBoundingClientRect().height>0}))).catch(()=>[]),text:(await f.locator('body').innerText().catch(()=>'' )).slice(0,1800)});
   const stage=page.locator('#stage');await stage.scrollIntoViewIfNeeded();const before=await stage.screenshot({path:path.join(out,'provider-'+version+'-before.png')});const rect=await page.locator('#car').boundingBox();if(rect){await page.mouse.move(rect.x+rect.width*.58,rect.y+rect.height*.55);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.32,rect.y+rect.height*.53,{steps:35});await page.mouse.up();await page.waitForTimeout(2000);}const after=await stage.screenshot({path:path.join(out,'provider-'+version+'-after.png')});item.imageChangedAfterDrag=!before.equals(after);
  }catch(e){item.failure=e.message;}
  await page.close();if(item.ready)break;
 }
}finally{fs.writeFileSync(path.join(out,'provider-readonly.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));handler.close();fs.rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify(report,null,2));
