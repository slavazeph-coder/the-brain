'use strict';
process.env.SPONSOR_SKIP_PRELOAD='true';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const crypto=require('node:crypto');
const {createHandler,validateApplication,raster}=require('../server.cjs');
const valid=(extra={})=>({name:'Example Sponsor',company:'Example Brand',email:'sponsor@example.com',website:'https://example.com',mode:'offer',zone:'chest',budgetCents:750000,campaign:'An isolated automated test of a proposed supervised brand activation.',privacyConsent:true,updatesConsent:false,...extra});
function signedHeader(payload,secret){const t=Math.floor(Date.now()/1000);return `t=${t},v1=${crypto.createHmac('sha256',secret).update(`${t}.${payload}`).digest('hex')}`;}
async function fixture(extra={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sponsor-test-'));const dbPath=path.join(directory,'test.sqlite');let url;const options={dbPath,production:false,secret:'unit-test-session-secret-not-production',adminKey:'unit-test-owner-password-at-least-32-chars',...extra};
 const server=http.createServer((req,res)=>handler.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;const handler=createHandler({...options,origin:url});
 const cookies=new Map();let csrf;
 async function call(route,body,headers={},method){const h={...headers};if(cookies.size)h.Cookie=[...cookies].map(([k,v])=>`${k}=${v}`).join('; ');if(body!==undefined){h['Content-Type']='application/json';h.Origin=url;h['X-CSRF-Token']=csrf;Object.assign(h,headers);}const r=await fetch(url+'/api/sponsors'+route,{method:method||(body===undefined?'GET':'POST'),headers:h,body:body===undefined?undefined:JSON.stringify(body)});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0];const i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}const data=await r.json();return {r,data};}
 const session=await call('/session');csrf=session.data.csrf;
 return {url,handler,dbPath,options,call,cookies,async close(){await new Promise(r=>server.close(r));handler.close();fs.rmSync(directory,{recursive:true,force:true});}};
}
test('validates required consent, prices, email, payload and safe raster logo',()=>{
 assert.equal(validateApplication(valid()).budgetCents,750000);
 assert.throws(()=>validateApplication(valid({privacyConsent:false})),/consent/i);
 assert.throws(()=>validateApplication(valid({email:'not-an-email'})),/email/i);
 assert.throws(()=>validateApplication(valid({mode:'fixed',budgetCents:1})),/price/i);
 assert.throws(()=>validateApplication(valid({budgetCents:NaN})),/price/i);
 assert.throws(()=>validateApplication(valid({website:'javascript:alert(1)'})),/website/i);
 assert.throws(()=>validateApplication(valid({campaign:'a'})),/campaign/i);
 assert.throws(()=>validateApplication(valid({fax:'bot'})),/accepted/i);
 assert.throws(()=>raster('data:image/svg+xml;base64,PHN2Zy8+'),/PNG/i);
 assert.equal(validateApplication(valid({mode:'waitlist',zone:'fleet',budgetCents:0})).zone,'fleet');
});
test('real submission is durable and idempotent; records remain private',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/status')).data.storage,'persistent_sqlite');
  assert.equal((await f.call('/admin/applications')).r.status,401);
  const id=crypto.randomUUID();const one=await f.call('/applications',valid(),{'X-Request-ID':id});assert.equal(one.r.status,201);assert.ok(one.data.reference);
  const two=await f.call('/applications',valid(),{'X-Request-ID':id});assert.equal(two.r.status,200);assert.equal(two.data.reference,one.data.reference);
  assert.equal((await f.call('/applications',valid({company:'Other Company'}),{'X-Request-ID':id})).r.status,409);
  assert.equal(f.handler.database().prepare('SELECT COUNT(*) AS n FROM sponsor_applications').get().n,1);
  const reopen=createHandler({...f.options,origin:f.url});assert.equal(reopen.database().prepare('SELECT id FROM sponsor_applications').get().id,one.data.reference);reopen.close();
  assert.equal((await f.call('/admin/login',{password:f.options.adminKey})).r.status,200);
  const privateRows=await f.call('/admin/applications');assert.equal(privateRows.data.applications.length,1);assert.equal(privateRows.data.applications[0].email,'sponsor@example.com');
  assert.equal((await f.call('/catalog')).data.zones.some(z=>z.email),false);
  assert.equal((await f.call('/admin/applications/'+one.data.reference+'/delete',{confirm:one.data.reference})).r.status,200);
  assert.equal(f.handler.database().prepare('SELECT COUNT(*) AS n FROM sponsor_applications').get().n,0);
 }finally{await f.close();}
});
test('rejects cross-origin, missing-CSRF, malformed and unapproved checkout requests',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID(),Origin:'https://evil.example'})).r.status,403);
  assert.equal((await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID(),'X-CSRF-Token':'wrong'})).r.status,403);
  assert.equal((await f.call('/applications',valid(),{'X-Request-ID':'bad'})).r.status,400);
  assert.equal((await f.call('/checkout',{token:'x'.repeat(43),acceptTerms:true})).r.status,404);
  assert.equal((await f.call('/admin/login',{password:'incorrect-password'})).r.status,401);
  assert.equal((await fetch(f.url+'/sponsor/server.cjs')).status,404);
  assert.equal((await fetch(f.url+'/sponsor/')).headers.get('content-security-policy').includes("frame-ancestors 'none'"),true);
 }finally{await f.close();}
});
const quote={subtotalCents:825000,scope:'Four supervised approved activation sessions, agreed photo and short-form video deliverables, and aggregate campaign reporting. Cancellation and refunds follow signed agreement EXAMPLE-001.',activationWindow:'Agreed dates in January 2027',agreementReference:'EXAMPLE-001',hardwareConfirmed:true,venueConfirmed:true,contractConfirmed:true,taxReviewed:true};
test('quotes require owner confirmation and cannot sell one placement twice; payments fail closed',async()=>{
 const f=await fixture();try{
  const a=(await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID()})).data.reference;
  const b=(await f.call('/applications',valid({email:'other@example.com'}),{'X-Request-ID':crypto.randomUUID()})).data.reference;
  await f.call('/admin/login',{password:f.options.adminKey});
  assert.equal((await f.call(`/admin/applications/${a}/quote`,{...quote,hardwareConfirmed:false})).r.status,400);
  const accepted=await f.call(`/admin/applications/${a}/quote`,quote);assert.equal(accepted.r.status,200);
  const token=new URLSearchParams(new URL(accepted.data.invitationUrl).hash.slice(1)).get('token');
  assert.equal((await f.call(`/admin/applications/${b}/quote`,quote)).r.status,409);
  assert.equal((await f.call('/quote',{token})).data.paymentsEnabled,false);
  assert.equal((await f.call('/checkout',{token,acceptTerms:true})).r.status,503);
  assert.equal((await f.call('/catalog')).data.zones.find(z=>z.id==='chest').status,'under_agreement');
  const dbRow=f.handler.database().prepare('SELECT * FROM sponsor_applications WHERE id=?').get(a);assert.notEqual(dbRow.invitation_hash,token);assert.equal(dbRow.paid_at,null);
 }finally{await f.close();}
});
test('approved checkout uses server price and verified idempotent Stripe webhooks',async()=>{
 const Stripe=require('stripe');const client=new Stripe('sk_test_fake_key_for_local_signature_tests');const wh='whsec_unit_test_only';let calls=0,created;
 const fake={webhooks:client.webhooks,checkout:{sessions:{create:async data=>{calls++;created=data;return {id:'cs_test_isolated_001',url:'https://checkout.stripe.com/c/pay/cs_test_isolated_001',expires_at:Math.floor(Date.now()/1000)+1800};}}}};
 const f=await fixture({stripe:fake,webhookSecret:wh,paymentsEnabled:true});try{
  const a=(await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID()})).data.reference;await f.call('/admin/login',{password:f.options.adminKey});
  const q=await f.call(`/admin/applications/${a}/quote`,quote);const token=new URLSearchParams(new URL(q.data.invitationUrl).hash.slice(1)).get('token');
  assert.equal((await f.call('/checkout',{token,acceptTerms:false})).r.status,400);
  assert.equal((await f.call('/checkout',{token,acceptTerms:true,subtotalCents:1})).r.status,200);
  assert.equal(created.line_items[0].price_data.unit_amount,825000);assert.equal(created.payment_method_types,undefined);assert.equal(created.automatic_tax.enabled,true);
  await f.call('/checkout',{token,acceptTerms:true});assert.equal(calls,1);
  assert.equal(f.handler.database().prepare('SELECT status FROM sponsor_applications WHERE id=?').get(a).status,'checkout_pending');
  const event={id:'evt_test_paid_001',object:'event',type:'checkout.session.completed',data:{object:{id:'cs_test_isolated_001',payment_status:'paid',currency:'cad',amount_subtotal:825000,amount_total:932250,metadata:{sponsor_application:a}}}};
  const payload=JSON.stringify(event);
  const bad=await fetch(f.url+'/api/sponsors/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':'invalid'},body:payload});assert.equal(bad.status,400);
  for(let n=0;n<2;n++){const r=await fetch(f.url+'/api/sponsors/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signedHeader(payload,wh)},body:payload});assert.equal(r.status,200);}
  const paid=await f.call('/quote',{token});assert.equal(paid.data.status,'paid');assert.equal(paid.data.amountPaid,932250);assert.equal(f.handler.database().prepare('SELECT COUNT(*) AS n FROM sponsor_events').get().n,1);
  assert.equal((await f.call('/checkout',{token,acceptTerms:true})).r.status,409);
 }finally{await f.close();}
});
