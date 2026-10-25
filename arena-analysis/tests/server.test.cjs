'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {deflateSync} = require('node:zlib');
const express = require('express');
const {createStore} = require('../store.cjs');
const {createPaidAnalysisRouter} = require('../server.cjs');
const {settings} = require('../config.cjs');

function evidence() {
  const chunk = (kind, body) => {
    const b = Buffer.alloc(body.length+12); b.writeUInt32BE(body.length); b.write(kind,4); body.copy(b,8);
    let crc = 0xffffffff; for (const byte of b.subarray(4,-4)) { crc ^= byte; for (let j=0;j<8;j++) crc = crc&1 ? (crc>>>1)^0xedb88320 : crc>>>1; }
    b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4); return b;
  };
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0])),chunk('IDAT',deflateSync(Buffer.alloc(5))),chunk('IEND',Buffer.alloc(0))]);
  return {schema:'brainsnn.arena.analysis-input.v1',manifestSha256:'a'.repeat(64),recordingId:'recording-1',sourceKind:'imported',context:{limitations:[]},selectedEventIds:['obs-1'],includePrompts:false,
    events:[{id:'obs-1',kind:'observation',seq:1,refs:[],data:{}}],images:[{id:'image-1',eventId:'obs-1',artifactId:'raw-1',originalSha256:'b'.repeat(64),sha256:createHash('sha256').update(png).digest('hex'),mimeType:'image/png',width:1,height:1,dataBase64:png.toString('base64')}]};
}
const usage = {complete:true,inputTokens:100,billedOutputTokens:70};
async function fixture(t, overrides = {}) {
  const store = createStore({dbPath:':memory:',failureReserveCents:10000,maxOutstandingCostCents:10000,...overrides.storeOptions});
  const config = {...settings({}),production:false,origin:'https://www.brainsnn.com',enabled:true,purchasesEnabled:true,apiKey:'fixture-only',stripeKey:'sk_test_fixture',webhookSecret:'whsec_fixture',providerVerified:true,paymentVerified:true,singleReplica:true,storageConfirmed:true,dbPath:'/fixture/ledger.sqlite',failureReserveCents:10000,maxOutstandingCostCents:10000,taxMode:'not_required',
    pricing:{version:'fixture',validUntil:Date.now()+86400000,fxValidUntil:Date.now()+86400000,usdToCad:1.6,inputUsdPerMillion:4,outputUsdPerMillion:20,infraCents:10,supportCents:20,paymentFeeBps:860},...overrides.config};
  let calls = 0;
  const provider = overrides.provider || {analyze:async validated => {calls++; return {schema:'brainsnn.arena.analysis.v1',inputDigest:validated.inputDigest,usage};}};
  const router = createPaidAnalysisRouter({config,store,provider,stripe:overrides.stripe||{},log:()=>{}});
  const app = express(); app.use('/api/arena/analysis',router); app.use(express.json({limit:'1kb'}));
  const server = await new Promise(resolve => {const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  t.after(async () => {router.close();await new Promise(resolve=>server.close(resolve));store.close();});
  const base = 'http://127.0.0.1:'+server.address().port+'/api/arena/analysis';
  async function request(route, {body,identity,headers={},method=body===undefined?'GET':'POST'} = {}) {
    const response = await fetch(base+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:config.origin}),...(identity?{Cookie:identity.cookie,'X-Analysis-CSRF':identity.csrfToken}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,headers:response.headers,data:await response.json()};
  }
  async function owner() {const result = await request('/workspaces',{body:{}});assert.equal(result.status,201);return {...result.data,cookie:result.headers.get('set-cookie').split(';')[0]};}
  function fund(person) {store.creditFunding({eventId:'evt_'+person.workspaceId,paymentId:'pi_'+person.workspaceId,workspaceId:person.workspaceId,amountCents:5000,currency:'cad',paymentFeeCents:175});}
  async function finished(person,id) {for(let n=0;n<30;n++){const result=await request('/jobs/'+id,{identity:person});if(result.data.job.status!=='running')return result.data.job;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('job did not finish');}
  return {store,config,request,owner,fund,finished,get calls(){return calls;}};
}
test('disabled release is honest and never creates ephemeral customer balances',async t=>{
  const app=express(),router=createPaidAnalysisRouter({config:settings({}),log:()=>{}});app.use(router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(async()=>{router.close();await new Promise(resolve=>server.close(resolve));});
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/capabilities');const cap=await response.json();
  assert.equal(cap.purchaseEnabled,false);assert.equal(cap.analysisEnabled,false);assert.equal(cap.build,'paid-analysis-2026-10-17-v1');assert.equal(response.headers.get('cache-control'),'no-store');
});
test('workspace origin, CSRF, HttpOnly cookie, cross-tenant isolation and recovery rotation',async t=>{
  const f=await fixture(t),a=await f.owner(),b=await f.owner();
  assert.equal((await f.request('/workspaces',{body:{},headers:{Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await f.request('/quotes',{body:{evidence:evidence()},identity:a,headers:{'X-Analysis-CSRF':'wrong'}})).status,403);
  assert.equal((await f.request('/quotes',{body:{evidence:evidence()},identity:a,headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const q=await f.request('/quotes',{body:{evidence:evidence()},identity:a});assert.equal(q.status,201);
  assert.equal((await f.request('/jobs',{body:{quoteId:q.data.quote.id,evidence:evidence()},identity:b})).status,404);
  const recovered=await f.request('/recover',{body:{recoveryCode:a.recoveryCode}});assert.equal(recovered.status,200);
  assert.match(recovered.headers.get('set-cookie'),/HttpOnly/);assert.match(recovered.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await f.request('/workspace',{identity:a})).status,401);
  assert.equal(recovered.data.sessionToken,undefined);
});
test('rejects unauthenticated evidence before parsing and detects changed evidence before spending',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/quotes',{body:{evidence:'x'.repeat(9*1024*1024)}})).status,401);
  const a=await f.owner();f.fund(a);const e=evidence();const q=(await f.request('/quotes',{body:{evidence:e},identity:a})).data.quote;
  e.context.task='changed';const changed=await f.request('/jobs',{body:{quoteId:q.id,evidence:e},identity:a});
  assert.equal(changed.status,400);assert.equal(changed.data.code,'EVIDENCE_CHANGED');assert.equal(f.calls,0);assert.equal(f.store.getWorkspace(a.workspaceId).wallet.availableCents,5000);
});
test('a fixed accepted quote is charged once and stores metadata without image payloads',async t=>{
  const f=await fixture(t),a=await f.owner();f.fund(a);const e=evidence();
  const q=(await f.request('/quotes',{body:{evidence:e},identity:a})).data.quote;
  assert.ok(q.amountCents>=200);assert.equal(q.pricing,undefined);
  const responses=await Promise.all([1,2].map(()=>f.request('/jobs',{body:{quoteId:q.id,evidence:e},identity:a})));
  assert.deepEqual(responses.map(x=>x.status).sort(),[200,202]);assert.equal(responses[0].data.job.id,responses[1].data.job.id);
  const job=await f.finished(a,responses[0].data.job.id);assert.equal(job.status,'succeeded');assert.equal(f.calls,1);
  assert.equal(job.result.inputDigest,q.inputDigest);assert.equal(job.evidenceSummary.images[0].dataBase64,undefined);
  assert.equal(f.store.getWorkspace(a.workspaceId).wallet.balanceCents,5000-q.amountCents);
  const b=await f.owner();assert.equal((await f.request('/jobs/'+job.id,{identity:b})).status,404);
});
test('known technical failures charge no customer credit and consume the internal reserve',async t=>{
  const f=await fixture(t,{provider:{analyze:async()=>{throw Object.assign(new Error('private provider detail'),{providerAttempted:true,usage});}}});
  const a=await f.owner();f.fund(a);const e=evidence(),q=(await f.request('/quotes',{body:{evidence:e},identity:a})).data.quote;
  const run=await f.request('/jobs',{body:{quoteId:q.id,evidence:e},identity:a}),job=await f.finished(a,run.data.job.id);
  assert.equal(job.status,'failed');assert.doesNotMatch(job.error,/private/);assert.equal(f.store.getWorkspace(a.workspaceId).wallet.availableCents,5000);assert.ok(f.store.getBudget().failureSpentCents>0);
});
test('unknown provider usage retains a worst-case expense hold without debiting the customer',async t=>{
  const f=await fixture(t,{provider:{analyze:async()=>({usage:{complete:false}})}}),a=await f.owner();f.fund(a);
  const e=evidence(),q=(await f.request('/quotes',{body:{evidence:e},identity:a})).data.quote;
  const run=await f.request('/jobs',{body:{quoteId:q.id,evidence:e},identity:a}),job=await f.finished(a,run.data.job.id);
  assert.equal(job.status,'uncertain');assert.equal(f.store.getWorkspace(a.workspaceId).wallet.balanceCents,5000);assert.equal(f.store.getWorkspace(a.workspaceId).wallet.frozen,true);assert.ok(f.store.getBudget().outstandingCostCents>0);
});
test('raw webhook signature receives original bytes even when new purchases are disabled',async t=>{
  let seen;
  const f=await fixture(t,{config:{purchasesEnabled:false},stripe:{webhooks:{constructEvent(raw,signature){seen={raw,signature};return {id:'evt_ignored',type:'unrelated',livemode:false,data:{object:{}}};}}}});
  const result=await f.request('/webhook',{body:{test:'fixture'},headers:{'Stripe-Signature':'fixture-signature'}});
  assert.equal(result.status,200);assert.equal(seen.raw.toString(),'{"test":"fixture"}');assert.equal(seen.signature,'fixture-signature');
});

test('purchase readiness requires enough reserve and outstanding capacity for a legal maximum-size analysis', async t => {
  for (const storeOptions of [{failureReserveCents:1}, {maxOutstandingCostCents:1}]) {
    const f = await fixture(t, {storeOptions}), a = await f.owner();
    const cap = (await f.request('/capabilities')).data;
    assert.equal(cap.purchaseEnabled, false);
    const purchase = await f.request('/checkout', {identity:a,body:{requestId:'checkout_request_123456'}});
    assert.equal(purchase.status, 503); assert.equal(purchase.data.code, 'purchases_unavailable');
    assert.equal(f.store.getWorkspace(a.workspaceId).wallet.balanceCents, 0);
  }
});

test('accepted quote retries recover their job even during maintenance and after price configuration changes', async t => {
  let finish;
  const f = await fixture(t, {provider:{analyze:() => new Promise(resolve => {finish = resolve;})}});
  const a = await f.owner(); f.fund(a); const e = evidence();
  const q = (await f.request('/quotes', {identity:a,body:{evidence:e}})).data.quote;
  const initial = await f.request('/jobs', {identity:a,body:{quoteId:q.id,evidence:e}});
  assert.equal(initial.status, 202);
  f.config.enabled = false;
  f.config.pricing.version = 'renewed-rates';
  const duplicate = await f.request('/jobs', {identity:a,body:{quoteId:q.id,evidence:e}});
  assert.equal(duplicate.status, 200); assert.equal(duplicate.data.job.id, initial.data.job.id);
  finish({usage});
  const done = await f.finished(a, initial.data.job.id); assert.equal(done.status, 'succeeded');
  const replay = await f.request('/jobs', {identity:a,body:{quoteId:q.id,evidence:e}});
  assert.equal(replay.status, 200); assert.equal(replay.data.job.status, 'succeeded');
  e.context.task = 'different evidence';
  assert.equal((await f.request('/jobs', {identity:a,body:{quoteId:q.id,evidence:e}})).data.code, 'EVIDENCE_CHANGED');
});

test('new execution refuses stale quote price, FX, and expiry assumptions without consuming credit', async t => {
  const patches = [{version:'updated'}, {outputUsdPerMillion:40}, {usdToCad:2}, {validUntil:Date.now()+2*86400000}];
  for (const patch of patches) {
    const f = await fixture(t), a = await f.owner(); f.fund(a); const e = evidence();
    const q = (await f.request('/quotes', {identity:a,body:{evidence:e}})).data.quote;
    Object.assign(f.config.pricing, patch);
    const declined = await f.request('/jobs', {identity:a,body:{quoteId:q.id,evidence:e}});
    assert.equal(declined.status, 409); assert.equal(declined.data.code, 'PRICING_CHANGED');
    assert.equal(f.calls, 0); assert.equal(f.store.getWorkspace(a.workspaceId).wallet.reservedCents, 0);
  }
});

test('unpriceable purportedly complete provider usage settles uncertain instead of blocking as running forever', async t => {
  const f = await fixture(t, {provider:{analyze:async () => ({usage:{complete:true,inputTokens:100000001,billedOutputTokens:0}})}});
  const a = await f.owner(); f.fund(a); const e = evidence();
  const q = (await f.request('/quotes', {identity:a,body:{evidence:e}})).data.quote;
  const run = await f.request('/jobs', {identity:a,body:{quoteId:q.id,evidence:e}});
  const job = await f.finished(a, run.data.job.id);
  assert.equal(job.status, 'uncertain'); assert.equal(f.store.getWorkspace(a.workspaceId).wallet.balanceCents, 5000);
  assert.ok(f.store.getBudget().outstandingCostCents > 0);
});

test('partial-refund fee density that prevents a workable quote blocks further top-ups', async t => {
  const f = await fixture(t), a = await f.owner(); f.fund(a);
  f.store.reverseFunding({eventId:'refund-partial',paymentId:'pi_'+a.workspaceId,reversedCents:4800});
  assert.equal(f.store.getWorkspace(a.workspaceId).wallet.maxPaymentFeeBps, 8750);
  const purchase = await f.request('/checkout', {identity:a,body:{requestId:'checkout_request_123456'}});
  assert.equal(purchase.status, 503); assert.equal(purchase.data.code, 'funding_cost_review');
  assert.equal(f.store.getWorkspace(a.workspaceId).wallet.balanceCents, 200);
});
