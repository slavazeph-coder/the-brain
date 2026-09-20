import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Deliberately read-only. Confirmation POST behavior is tested in an isolated DB.
const base='https://www.brainsnn.com';
const out=path.resolve('sponsorship/reports/launch-live');
await fs.mkdir(out,{recursive:true});
const evidence={base,productionApplications:0,paymentsCreated:0,checks:[],screenshots:[]};
let browser;
try{
 const get=path=>fetch(base+path,{signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
 const pageResponse=await get('/sponsor/');assert.equal(pageResponse.status,200);const html=await pageResponse.text();assert.match(html,/data-design-version="xio-midnight-v1"/);
 assert.match(html,/\/sponsor\/flow\.js\?v=[a-f0-9]{16}/);
 for(const file of ['launch.js','launch-utils.js']){const response=await get('/sponsor/'+file);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').includes('javascript'));}
 const state=await (await get('/api/sponsors/status')).json();evidence.status=state;assert.equal(state.applications,'accepting');assert.equal(state.storage,'persistent_sqlite');
 assert.equal((await get('/api/sponsors/admin/applications')).status,401);
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/sponsors/**',async route=>{assert.ok(['GET','HEAD'].includes(route.request().method()),'Public test must not write');await route.continue();});
 await page.goto(base+'/',{waitUntil:'networkidle',timeout:120000});
 const homeLink=page.locator('.bh-nav a[href="/sponsor/"]');await homeLink.waitFor({state:'visible'});
 await page.screenshot({path:path.join(out,'homepage-desktop.png')});evidence.screenshots.push('homepage-desktop.png');
 await homeLink.click();await page.waitForURL('**/sponsor/');await page.locator('#share-placement:enabled').waitFor();
 evidence.checks.push('Homepage navigation opens the real Sponsor Studio with launch enhancements.');
 await page.goto(base+'/sponsor/?placement=back#studio',{waitUntil:'networkidle',timeout:120000});
 await page.waitForSelector('#studio-robot[data-ready="true"]',{timeout:120000});
 assert.equal(await page.locator('#placement-name').textContent(),'Back');assert.equal(await page.locator('[data-view=back]').getAttribute('aria-pressed'),'true');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Read-only verification fallback');}}}));
 await page.locator('#share-placement').click();await page.locator('#placement-share-link').waitFor({state:'visible'});
 assert.equal(await page.locator('#placement-share-link').inputValue(),'https://www.brainsnn.com/sponsor/?placement=back#studio');
 await page.locator('.showroom').screenshot({path:path.join(out,'placement-sharing.png')});evidence.screenshots.push('placement-sharing.png');
 await page.locator('#offer-button').click();await page.locator('#application-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#download-application-confirmation').isEnabled(),false);
 await page.keyboard.press('Escape');
 evidence.checks.push('Public placement deep link, actual G1 back view, share fallback and unopened confirmation gate verified. No form submitted.');
 for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await page.goto(base+'/',{waitUntil:'networkidle',timeout:120000});
   const footer=page.locator('.bh-footer a[href="/sponsor/"]');await footer.waitFor();await footer.scrollIntoViewIfNeeded();
   assert.ok(await footer.isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Homepage overflow at '+width);
   const filename='homepage-mobile-'+width+'.png';await page.screenshot({path:path.join(out,filename)});evidence.screenshots.push(filename);
 }
 assert.equal(errors.length,0,errors.join('; '));evidence.browserErrors=errors;evidence.ok=true;
}catch(error){evidence.ok=false;evidence.error=error.stack;process.exitCode=1;}
finally{if(browser)await browser.close();await fs.writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
