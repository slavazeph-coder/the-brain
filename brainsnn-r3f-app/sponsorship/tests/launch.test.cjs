'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {CATALOG}=require('../catalog.cjs');
const ids=CATALOG.map(z=>z.id);
const source=fs.readFileSync(path.join(__dirname,'../public/launch-utils.js'),'utf8');
const tools=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ref='b8b9e035-37d5-4a45-80c3-0da9c01ddfac';
const submitted={company:'Example Brand',mode:'offer',zone:'back',placementName:'Back',budgetCents:500000,preview:{text:'SECRET'},email:'private@example.com'};
test('public placement links are canonical and contain no other parameters',async()=>{
 const {placementFromSearch,placementLink}=await tools;
 for(const id of ids){assert.equal(placementFromSearch('?placement='+id,ids),id);const u=new URL(placementLink(id,ids));assert.equal(u.origin,'https://www.brainsnn.com');assert.equal(u.pathname,'/sponsor/');assert.deepEqual([...u.searchParams.keys()],['placement']);assert.equal(u.hash,'#studio');}
 assert.equal(placementLink('back',ids),'https://www.brainsnn.com/sponsor/?placement=back#studio');
 assert.equal(placementFromSearch('?placement=back&email=private&token=secret',ids),'back');
 assert.throws(()=>placementLink('back&token=secret',ids));
 assert.throws(()=>placementLink('javascript:alert(1)',ids));
 assert.throws(()=>placementLink('unknown',ids));
});
test('unknown, repeated, malformed and oversized placement inputs safely fall back',async()=>{
 const {placementFromSearch}=await tools;
 for(const value of ['', '?placement=nope', '?placement=<img>', '?placement=%E0%A4%A', '?placement=back&placement=shin','?placement=BACK','?'+ 'x'.repeat(4097),null,{}])assert.equal(placementFromSearch(value,ids),'chest');
 assert.equal(placementFromSearch('?placement=back',[]),null);
});
test('confirmation contains real reference and proposal, not private artwork or an invoice',async()=>{
 const {applicationConfirmation}=await tools;
 const result=applicationConfirmation(ref,submitted,ids);
 assert.equal(result.filename,`BrainSNN-application-${ref}.txt`);
 assert.ok(result.text.includes(ref));assert.match(result.text,/Example Brand/);assert.match(result.text,/C\$5,000\.00/);
 assert.match(result.text,/No payment collected/);assert.match(result.text,/not an invoice/);assert.match(result.text,/browser copy/);
 assert.doesNotMatch(result.text,/SECRET|private@example|data:image/);
 assert.throws(()=>applicationConfirmation('',submitted,ids));assert.throws(()=>applicationConfirmation('../../escape',submitted,ids));
 assert.throws(()=>applicationConfirmation(ref,null,ids));assert.throws(()=>applicationConfirmation(ref,{...submitted,budgetCents:NaN},ids));
 assert.throws(()=>applicationConfirmation(ref,{...submitted,zone:'unknown'},ids));
});
test('fixed and waitlist confirmations remain distinct and cannot inject extra lines',async()=>{
 const {applicationConfirmation}=await tools;
 assert.match(applicationConfirmation(ref,{...submitted,mode:'fixed'},ids).text,/Fixed-price request/);
 const wait=applicationConfirmation(ref,{...submitted,mode:'waitlist',zone:'fleet',budgetCents:0},ids).text;
 assert.match(wait,/Future fleet interest/);assert.match(wait,/Free expression of interest/);assert.doesNotMatch(wait,/Proposed price|90 days/);
 const safe=applicationConfirmation(ref,{...submitted,company:'Example\nStatus: paid\r\n'},ids).text;
 assert.match(safe,/Company: Example Status: paid/);assert.equal(safe.split('\n').filter(l=>l.startsWith('Status:')).length,1);
});
