import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve('sponsorship');const out=path.join(root,'reports');await fs.mkdir(out,{recursive:true});
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'sponsor-browser-'));const base='http://127.0.0.1:8091';
const child=spawn(process.execPath,[path.join(root,'server.cjs')],{env:{...process.env,NODE_ENV:'test',PORT:'8091',SPONSOR_DB_PATH:path.join(temp,'browser.sqlite'),SPONSOR_PUBLIC_ORIGIN:base,SPONSOR_SESSION_SECRET:'browser-test-only-secret',SPONSOR_ADMIN_KEY:'browser-test-only-owner-key-at-least-32',SPONSOR_PAYMENTS_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
let browser;const errors=[];const evidence={base,isolatedDatabase:true,paymentMode:'disabled',checks:[],screenshots:[]};
try{
 for(let n=0;n<80;n++){try{const r=await fetch(base+'/api/sponsors/status');if(r.ok)break;}catch{}if(n===79)throw new Error('Test server did not start: '+logs);await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/sponsor/',{waitUntil:'networkidle',timeout:120000});
 await page.waitForSelector('#hero-robot[data-ready="true"]',{timeout:120000});
 assert.equal(await page.locator('.zone-button').count(),8);evidence.checks.push('Eight placement options loaded from real API.');
 await page.screenshot({path:path.join(out,'desktop-hero.png')});evidence.screenshots.push('desktop-hero.png');
 await page.locator('#studio').scrollIntoViewIfNeeded();await page.waitForSelector('#studio-robot[data-ready="true"]',{timeout:120000});
 await page.locator('#brand-text').fill('NORTHSTAR');await page.waitForTimeout(1600);
 const decals=Number(await page.locator('#studio-robot').getAttribute('data-decals'));assert.ok(decals>0,'Expected genuine surface decals on G1 geometry.');evidence.checks.push('Sponsor branding projected onto robot surfaces; '+decals+' decals rendered.');
 const logo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='#2850c4';ctx.font='bold 76px Arial';ctx.textAlign='center';ctx.fillText('NORTHSTAR',250,120);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#logo-upload').setInputFiles({name:'example-brand-logo.png',mimeType:'image/png',buffer:Buffer.from(logo,'base64')});await page.waitForTimeout(1800);
 await page.locator('.studio-grid').screenshot({path:path.join(out,'desktop-studio-logo.png')});evidence.screenshots.push('desktop-studio-logo.png');
 await page.locator('.zone-button[data-zone="back"]').click();await page.waitForTimeout(2000);assert.equal(await page.locator('#placement-name').textContent(),'Back');
 await page.locator('.showroom').screenshot({path:path.join(out,'robot-back-preview.png')});evidence.screenshots.push('robot-back-preview.png');
 await page.locator('.zone-button[data-zone="chest"]').click();await page.locator('#offer-button').click();
 await page.locator('[name="name"]').fill('Automated QA');await page.locator('[name="company"]').fill('Isolated Example Test');await page.locator('[name="email"]').fill('qa@example.com');await page.locator('[name="campaign"]').fill('This is an isolated browser test of the sponsorship application and must never be used as a real sales lead.');await page.locator('[name="privacyConsent"]').check();
 await page.locator('#application-dialog').screenshot({path:path.join(out,'application-desktop.png')});evidence.screenshots.push('application-desktop.png');
 await page.locator('#submit-application').click();await page.waitForSelector('#application-success:not([hidden])');const reference=await page.locator('#application-reference').inputValue();assert.match(reference,/^[a-f0-9-]{36}$/);evidence.checks.push('Real POST application saved to isolated persistent database and returned reference '+reference+'.');
 await page.locator('#done-dialog').click();
 await page.screenshot({path:path.join(out,'desktop-full-page.png'),fullPage:true});evidence.screenshots.push('desktop-full-page.png');
 const axe=await new AxeBuilder({page}).analyze();await fs.writeFile(path.join(out,'accessibility.json'),JSON.stringify(axe.violations,null,2));evidence.accessibility=axe.violations.map(v=>({id:v.id,impact:v.impact,count:v.nodes.length}));assert.equal(axe.violations.filter(v=>v.impact==='critical').length,0,'Critical accessibility issue.');
 const owner=await browser.newPage({viewport:{width:1200,height:900}});await owner.goto(base+'/sponsor/admin/');await owner.locator('#owner-login:not([hidden])').waitFor();await owner.locator('[name=password]').fill('browser-test-only-owner-key-at-least-32');await owner.locator('#owner-login button').click();await owner.locator('#owner-workspace:not([hidden])').waitFor();await owner.getByRole('heading',{name:'Isolated Example Test'}).waitFor();evidence.checks.push('Owner authenticated and reviewed the actual saved application.');await owner.screenshot({path:path.join(out,'owner-dashboard.png'),fullPage:true});evidence.screenshots.push('owner-dashboard.png');await owner.close();
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.goto(base+'/sponsor/',{waitUntil:'networkidle'});await page.waitForSelector('#hero-robot[data-ready="true"]',{timeout:120000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow at '+width+'px');await page.screenshot({path:path.join(out,`mobile-${width}-hero.png`)});evidence.screenshots.push(`mobile-${width}-hero.png`);await page.locator('#studio').scrollIntoViewIfNeeded();await page.waitForSelector('#studio-robot[data-ready="true"]',{timeout:120000});await page.locator('#fixed-button').click();assert.equal(await page.locator('[name=amount]').getAttribute('readonly'),'');await page.screenshot({path:path.join(out,`mobile-${width}-application.png`)});evidence.screenshots.push(`mobile-${width}-application.png`);await page.keyboard.press('Escape');assert.equal(await page.locator('#application-dialog').isVisible(),false);evidence.checks.push('Responsive '+width+'px layout, fixed-price form and Escape close verified.');}
 assert.equal(errors.length,0,'Browser errors: '+errors.join('; '));evidence.browserErrors=errors;evidence.ok=true;
}catch(e){evidence.ok=false;evidence.error=e.stack;throw e;}finally{await fs.writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));await fs.writeFile(path.join(out,'server.log'),logs);if(browser)await browser.close();child.kill('SIGTERM');await fs.rm(temp,{recursive:true,force:true});}
