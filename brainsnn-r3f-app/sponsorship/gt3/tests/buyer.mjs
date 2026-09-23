// Advertiser acceptance. Actual car; GET-only live checks. No lead or payment is submitted.
import {chromium} from '@playwright/test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const live=process.argv.includes('--live'),out=path.resolve('sponsorship/gt3/reports');fs.mkdirSync(out,{recursive:true});
const report={scope:live?'Published advertiser experience, actual car, read-only':'Isolated advertiser experience, actual car, read-only',checks:[],errors:[],requests:[]};
const check=(n,v)=>{assert.ok(v,n);report.checks.push(n);console.log('PASS '+n);};
let base='https://www.brainsnn.com',server,handler,dir,browser;
try{
 if(!live){process.env.GT3_SKIP_PRELOAD='true';const {createHandler}=createRequire(import.meta.url)('../server.cjs');dir=fs.mkdtempSync(path.join(os.tmpdir(),'gt3-buyer-'));server=http.createServer((q,r)=>handler.matches(q.url)?void handler.handle(q,r):(r.writeHead(404),r.end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;handler=createHandler({origin:base,dbPath:path.join(dir,'isolated.sqlite'),env:{}});}
 if(live){let found=false;for(let i=0;i<24;i++){try{const r=await fetch(base+'/sponsor/gt3/?buyer-check='+Date.now(),{signal:AbortSignal.timeout(15000)});if(r.ok&&(await r.text()).includes('data-audience="advertiser-v1"')){found=true;break;}}catch{}await new Promise(r=>setTimeout(r,7000));}check('Advertiser release published',found);}
 browser=await chromium.launch({channel:'chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1080}});page.setDefaultTimeout(60000);page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(/^http/.test(r.url()))report.requests.push({url:new URL(r.url()).origin+new URL(r.url()).pathname,method:r.method()});});
 await page.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
 await page.goto(base+'/sponsor/gt3/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.GT3_RENDER_STATUS?.ready||window.GT3_RENDER_STATUS?.fail,{},{timeout:120000});
 report.render=await page.evaluate(()=>window.GT3_RENDER_STATUS);check('Actual Porsche geometry remains interactive',report.render.ready&&report.render.triangles>100000);
 await page.waitForFunction(()=>!document.getElementById('primary-cta').disabled);
 check('Page addresses ad-space buyers',await page.locator('h1').innerText()==='Your ad. On the GT3.');
 check('One streamlined inquiry, not a new popup form',await page.locator('dialog').count()===0&&await page.locator('#name,#company').count()===0);
 check('Eight placements have useful comparison descriptions',await page.locator('.spot-hint').count()===8);
 check('Driver door is explicitly one side only',(await page.locator('#placement-description').textContent()).includes('opposite door is a separate space'));
 check('Indicative price is not presented as a monthly rate',(await page.locator('#price-label').textContent()).includes('INDICATIVE')&&(await page.locator('.price-block p').textContent()).includes('Not a monthly rate'));
 check('Campaign specifics are visible before any inquiry',await page.locator('#buyer-guide').isVisible()&&await page.locator('.booking-facts article').count()===4);
 check('No invented campaign dates',await page.locator('#fact-dates').textContent()==='Not scheduled');
 check('No invented audience proof',(await page.locator('.booking-facts').innerText()).includes('No verified reach published'));
 check('Internal car financing is no longer buyer-facing',await page.locator('#funding-copy').count()===0&&!(await page.locator('body').innerText()).includes('130%'));
 check('Prelaunch action describes an ad-space inquiry',await page.locator('#primary-cta').textContent()==='Request this ad space ↗');
 await page.locator('#try-example').click();await page.waitForFunction(()=>window.GT3_RENDER_STATUS.decals===1);
 check('Sample ad appears on actual model',await page.evaluate(()=>window.GT3_DESIGN.snapshot().brand)==='YOUR AD');
 check('The sample is clearly labelled',(await page.locator('#art-status').textContent()).includes('Sample'));
 await page.locator('#email').fill('qa@example.test');await page.locator('#art-rights').check();await page.locator('#primary-cta').click();
 check('Sample cannot accidentally become a real inquiry',(await page.locator('#art-status').textContent()).includes('Replace the sample'));
 await page.locator('#logo').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});await page.waitForTimeout(300);await page.locator('#primary-cta').click();
 check('An invalid upload cannot unlock submission of the sample',(await page.locator('#art-status').textContent()).includes('Replace the sample'));
 const image=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=512;c.height=256;const x=c.getContext('2d');x.fillStyle='#a9e6ed';x.fillRect(16,83,8,74);x.fillStyle='white';x.textAlign='center';x.font='600 47px Arial';x.fillText('YOUR BRAND',276,135);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await page.locator('#logo').setInputFiles({name:'local-buyer-preview.png',mimeType:'image/png',buffer:image});await page.waitForFunction(()=>window.GT3_RENDER_STATUS.decals===1&&!document.getElementById('art-status').textContent.includes('Sample'));
 check('Customer upload replaces sample without new steps',await page.locator('#logo-thumb').evaluate(e=>!e.hidden&&e.complete&&e.naturalWidth===512));
 await page.locator('#spot-trigger').click();await page.locator('#spot-hood').click();await page.waitForFunction(()=>window.GT3_RENDER_STATUS.placement==='hood');
 check('Selecting a different space changes placement guidance',await page.locator('#placement-fit').textContent()==='Front & elevated views');
 check('Customer artwork follows the selected space',await page.evaluate(()=>window.GT3_DESIGN.snapshot().zone)==='hood');
 await page.locator('#spot-trigger').click();await page.locator('#spot-driver-door').click();await page.waitForFunction(()=>window.GT3_RENDER_STATUS.placement==='driver-door');
 await page.locator('#email').fill('');await page.locator('#art-rights').uncheck();await page.locator('#scene canvas').scrollIntoViewIfNeeded();await page.waitForTimeout(500);
 await page.screenshot({path:path.join(out,live?'buyer-live-desktop.png':'buyer-desktop.png'),fullPage:true,timeout:60000});
 await page.locator('#spot-trigger').click();await page.screenshot({path:path.join(out,live?'buyer-live-menu.png':'buyer-menu.png'),fullPage:true,timeout:60000});await page.keyboard.press('Escape');
 check('Frosted menu retains keyboard dismissal',await page.locator('#spot-options').isHidden()&&await page.locator('#spot-trigger').evaluate(e=>e===document.activeElement));
 await page.locator('#use-cases').scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.case-media img')].every(e=>e.complete&&e.naturalWidth>0));
 check('Four advertiser goals have loaded visuals and measurement examples',await page.locator('.use-card').count()===4&&await page.locator('.case-measure').count()===4);
 check('Examples do not claim included or completed campaigns',(await page.locator('.use-heading').textContent()).includes('Not delivered campaigns or included extras'));
 check('Key scope, production, dimensions and privacy questions are answered',await page.locator('.buyer-faq > details').count()===4);
 await page.locator('.buyer-faq summary').first().click();check('FAQ opens without a blocking overlay',await page.locator('.buyer-faq details').first().evaluate(e=>e.open));
 for(const w of [320,390,768,1024,1440]){await page.setViewportSize({width:w,height:1000});check('No overflow at '+w,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:390,height:844});await page.locator('#scene canvas').scrollIntoViewIfNeeded();await page.waitForTimeout(500);await page.screenshot({path:path.join(out,live?'buyer-live-mobile.png':'buyer-mobile.png'),fullPage:true,timeout:60000});
 check('No production inquiry or payment attempted',report.requests.every(r=>['GET','HEAD'].includes(r.method)));check('All assets remain first-party',report.requests.every(r=>r.url.startsWith(base+'/')));check('No page JavaScript errors',report.errors.length===0);
}catch(e){report.failure=e.stack;process.exitCode=1;}finally{fs.writeFileSync(path.join(out,live?'buyer-live.json':'buyer-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));handler?.close();if(dir)fs.rmSync(dir,{recursive:true,force:true});}
