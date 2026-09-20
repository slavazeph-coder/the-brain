// Post-deploy verification only. Does not submit proposals, artwork or payments.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const base='https://www.brainsnn.com',out=path.resolve('sponsorship/gt3/reports');fs.mkdirSync(out,{recursive:true});
const report={scope:'Live BrainSNN read-only verification',endpoints:[],checks:[],errors:[],published:false};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){const r=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});return {status:r.status,type:r.headers.get('content-type'),url:r.url,text:await r.text()};}
let browser;
try{
 for(let i=0;i<40;i++){
  try{const r=await get(base+'/sponsor/gt3/app.js?verify='+Date.now());if(r.status===200&&r.text.includes('webgl_unavailable')&&r.text.includes('retry-3d')){report.published=true;break;}}
  catch(e){report.lastPollError=e.message;}
  await sleep(10000);
 }
 if(!report.published)throw Error('The expected GT3 release did not become public within the deployment window.');
 for(const route of ['/sponsor/gt3/','/sponsor/gt3/style.css','/sponsor/gt3/engine.js','/sponsor/gt3/side.webp','/api/gt3/status','/healthz','/','/sponsor/']){
  const r=await get(base+route);report.endpoints.push({route,status:r.status,type:r.type,url:r.url});if(r.status!==200)throw Error('Public endpoint failed: '+route+' '+r.status);
  if(route==='/api/gt3/status'){const s=JSON.parse(r.text);if(s.ok!==true||s.payments!=='disabled')throw Error('Unexpected GT3 status.');report.storage=s.storage;}
 }
 try{const r=await get('https://brainsnn.com/sponsor/gt3/');report.apex={status:r.status,url:r.url};}catch(e){report.apex={error:e.message};}
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
 await page.goto(base+'/sponsor/gt3/',{waitUntil:'networkidle'});
 if(await page.locator('.zone').count()!==8)throw Error('Eight placements did not render.');report.checks.push('Eight live placements render');
 if(!await page.locator('#poster').evaluate(e=>e.complete&&e.naturalWidth>0))throw Error('Studio poster did not load.');report.checks.push('Same-site studio poster loaded');
 await page.locator('[data-mode="advanced"]').click();if(!await page.locator('#brand-name').isVisible())throw Error('Advanced controls missing.');
 await page.locator('[data-mode="simple"]').click();report.checks.push('Simple/Advanced mode switch works');
 await page.screenshot({path:path.join(out,'live-desktop.png'),fullPage:true});
 await page.locator('.proposal').first().click();await page.waitForFunction(()=>!document.getElementById('submit').disabled,{},{timeout:20000});report.checks.push('Live CSRF session connects; no form was submitted');
 await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow.');report.checks.push('390px mobile layout has no horizontal overflow');
 await page.screenshot({path:path.join(out,'live-mobile.png'),fullPage:true});
 if(report.errors.length)throw Error('Page JavaScript errors were recorded.');report.checks.push('No top-level JavaScript errors');
}catch(e){report.failure=e.message;process.exitCode=1;}finally{if(browser)await browser.close();fs.writeFileSync(path.join(out,'production-readonly.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
