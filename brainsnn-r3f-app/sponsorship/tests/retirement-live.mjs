import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
const base='https://www.brainsnn.com';
const xio='https://www.xioai.ca/robot-sponsorship/';
const out=path.resolve(process.env.SPONSOR_RETIREMENT_REPORT_DIR||'sponsorship/reports/live');
await fs.mkdir(out,{recursive:true});
const evidence={checkedAt:new Date().toISOString(),change:'Public robot page retired on BrainSNN; shared service retained',http:[],screenshots:[],productionApplications:0,charges:0,warnings:[]};
const get=url=>fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
let browser;
try{
  let ready=false;
  for(let n=0;n<30;n++){try{const r=await get(base+'/sponsor/');if(r.status===308&&r.headers.get('location')===xio){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,10000));}
  assert.ok(ready,'The BrainSNN public retirement redirect is not deployed.');
  for(const [route,destination] of [['/sponsor',xio],['/sponsor/',xio],['/sponsor/index.html',xio],['/sponsor/?placement=back&unrelated=discarded',xio+'?placement=back'],['/sponsor/checkout/',xio+'checkout/'],['/sponsor/checkout.html?payment=returned',xio+'checkout/?payment=returned'],['/sponsor/privacy.html',xio+'privacy.html']]){
    const r=await get(base+route);assert.equal(r.status,308,route);assert.equal(r.headers.get('location'),destination);assert.equal(await r.text(),'');evidence.http.push({route,status:r.status,location:destination});
  }
  for(const [route,status] of [['/',200],['/healthz',200],['/sponsor/admin/',200],['/sponsor/admin.js',200],['/api/sponsors/status',200],['/api/sponsors/catalog',200],['/api/sponsors/purchase-options',200],['/api/sponsors/admin/applications',401]]){
    const r=await get(base+route);assert.equal(r.status,status,route);evidence.http.push({route,status:r.status});
    if(route==='/api/sponsors/status'){const s=await r.json();assert.equal(s.storage,'persistent_sqlite');assert.equal(s.applications,'accepting');evidence.payments=s.payments;}
    if(route==='/api/sponsors/catalog')assert.equal((await r.json()).zones.length,8);
  }
  const target=await get(xio);assert.equal(target.status,200);assert.match(await target.text(),/data-site="xio-robotics"/);
  const xioApi=await get('https://www.xioai.ca/api/robot-sponsors/catalog');assert.equal(xioApi.status,200);assert.equal((await xioApi.json()).zones.length,8);
  // Existing apex DNS is outside this change; report it independently rather
  // than misrepresenting a non-www routing issue as a removed-page regression.
  try{const r=await get('https://brainsnn.com/sponsor/');evidence.apex={status:r.status,location:r.headers.get('location')};if(![301,302,307,308].includes(r.status))evidence.warnings.push('Bare-domain routing remains independent; canonical www retirement is verified.');}catch(e){evidence.apex={error:e.message};}
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  await page.route('**/api/**',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:90000});await page.locator('.bh-nav').waitFor();
    assert.equal(await page.locator('.bh-nav a[href^="/sponsor"],.bh-footer a[href^="/sponsor"]').count(),0);
    assert.equal(await page.getByRole('link',{name:'Sponsor Robot 001',exact:true}).count(),0);
    assert.ok(await page.locator('.bh-nav a[href="/app"]').count()>0);assert.ok(await page.locator('.bh-footer a[href="/engine#api"]').count()>0);
    const name='brainsnn-home-'+width+'.png';await page.screenshot({path:path.join(out,name),timeout:90000});evidence.screenshots.push(name);
  }
  await page.goto(base+'/sponsor/?placement=back#studio',{waitUntil:'domcontentloaded',timeout:90000});const landing=new URL(page.url());assert.equal(landing.origin,'https://www.xioai.ca');assert.equal(landing.pathname,'/robot-sponsorship/');assert.equal(landing.search,'?placement=back');assert.equal(landing.hash,'#studio');
  evidence.ok=true;
}catch(e){evidence.ok=false;evidence.error=e.stack;process.exitCode=1;}
finally{if(browser)await browser.close();await fs.writeFile(path.join(out,'live-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
