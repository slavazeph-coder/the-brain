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


test('XIO checkout enforces return destination, product title, and prevents price/token leakage',async()=>{
 const Stripe=require('stripe');const client=new Stripe('sk_test_fake_key_for_local_signature_tests');const wh='whsec_xio_test';let created;
 const fake={webhooks:client.webhooks,checkout:{sessions:{create:async data=>{created=data;return {id:'cs_xio_001',url:'https://checkout.stripe.com/c/pay/cs_xio_001',expires_at:Math.floor(Date.now()/1000)+1800};}}}};
 const f=await fixture({stripe:fake,webhookSecret:wh,paymentsEnabled:true});try{
  const a=(await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID()})).data.reference;await f.call('/admin/login',{password:f.options.adminKey});
  const q=await f.call(`/admin/applications/${a}/quote`,quote);const token=new URLSearchParams(new URL(q.data.invitationUrl).hash.slice(1)).get('token');
  // Reject unsupported returnSite
  assert.equal((await f.call('/checkout',{token,acceptTerms:true,returnSite:'https://evil.example'})).r.status,400);
  // Accept XIO with exact URLs and product title
  assert.equal((await f.call('/checkout',{token,acceptTerms:true,returnSite:'xio'})).r.status,200);
  assert.ok(created.line_items[0].price_data.product_data.name.startsWith('XIO Robot 001 / Chest'));
  assert.equal(created.success_url,'https://www.xioai.ca/robot-sponsorship/checkout/?payment=returned');
  assert.equal(created.cancel_url,'https://www.xioai.ca/robot-sponsorship/checkout/?payment=cancelled');
  assert.equal(created.line_items[0].price_data.unit_amount,quote.subtotalCents);
  // Caller cannot override price via request
  assert.equal((await f.call('/checkout',{token,acceptTerms:true,returnSite:'xio',subtotalCents:1})).r.status,200);
  assert.equal(created.line_items[0].price_data.unit_amount,quote.subtotalCents);
  // No token in metadata
  assert.equal(JSON.stringify(created).includes(token),false);
  // Idempotent retry uses same session
  const resp1=await f.call('/checkout',{token,acceptTerms:true,returnSite:'xio'});const resp2=await f.call('/checkout',{token,acceptTerms:true,returnSite:'xio'});assert.equal(resp1.data.url,resp2.data.url);
  // Invalid tokens rejected
  assert.equal((await f.call('/checkout',{token:'x'.repeat(43),acceptTerms:true,returnSite:'xio'})).r.status,404);
  assert.equal((await f.call('/checkout',{token:'invalid',acceptTerms:true,returnSite:'xio'})).r.status,404);
 }finally{await f.close();}
});

test('pending checkout resumes only its original session and fails closed near expiry',async()=>{
 let creates=0;
 const fake={checkout:{sessions:{create:async()=>{creates++;return{id:'cs_test_resume_only',url:'https://checkout.stripe.com/c/pay/cs_test_resume_only',expires_at:Math.floor(Date.now()/1000)+1800};}}}};
 const f=await fixture({stripe:fake,webhookSecret:'whsec_resume_fixture',paymentsEnabled:true});
 try{
  const id=(await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID()})).data.reference;
  await f.call('/admin/login',{password:f.options.adminKey});
  const approved=await f.call(`/admin/applications/${id}/quote`,quote);
  const token=new URLSearchParams(new URL(approved.data.invitationUrl).hash.slice(1)).get('token');
  assert.equal((await f.call('/quote',{token})).data.canResumeCheckout,false);
  assert.equal((await f.call('/checkout',{token,acceptTerms:true,resumeOnly:true})).r.status,409);
  assert.equal(creates,0,'resumeOnly created a session for an approved order');
  assert.equal((await f.call('/checkout',{token,acceptTerms:true,resumeOnly:'true'})).r.status,400);
  const first=await f.call('/checkout',{token,acceptTerms:true,returnSite:'xio'});
  assert.equal(first.r.status,200);
  assert.equal((await f.call('/quote',{token})).data.canResumeCheckout,true);
  const resumed=await f.call('/checkout',{token,acceptTerms:true,returnSite:'xio',resumeOnly:true});
  assert.equal(resumed.data.url,first.data.url);assert.equal(creates,1);
  const d=f.handler.database();const original=d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id);
  const cases=[
   {checkout_id:original.checkout_id,checkout_url:original.checkout_url,checkout_expires:Math.floor(Date.now()/1000)+30},
   {checkout_id:null,checkout_url:null,checkout_expires:original.checkout_expires},
   {checkout_id:original.checkout_id,checkout_url:'https://checkout.stripe.com.evil.example/c/pay/fixture',checkout_expires:original.checkout_expires},
  ];
  for(const data of cases){
   d.prepare('UPDATE sponsor_applications SET checkout_id=?,checkout_url=?,checkout_expires=? WHERE id=?').run(data.checkout_id,data.checkout_url,data.checkout_expires,id);
   assert.equal((await f.call('/quote',{token})).data.canResumeCheckout,false);
   for(const body of [{},{resumeOnly:true}])assert.equal((await f.call('/checkout',{token,acceptTerms:true,...body})).r.status,409);
  }
  const after=d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id);
  assert.equal(after.status,'checkout_pending');assert.equal(after.reserved_slot,original.reserved_slot);
  assert.equal(after.checkout_attempt,original.checkout_attempt);assert.equal(creates,1);
 }finally{await f.close();}
});

test('direct orders never enter legacy session creation, even without resumeOnly',async()=>{
 let creates=0;const fake={checkout:{sessions:{create:async()=>{creates++;throw new Error('Must never create a second direct session');}}}};
 const f=await fixture({stripe:fake,webhookSecret:'whsec_direct_resume_fixture',paymentsEnabled:true});
 try{
  const id=(await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID()})).data.reference;
  await f.call('/admin/login',{password:f.options.adminKey});
  const approved=await f.call(`/admin/applications/${id}/quote`,quote);
  const token=new URLSearchParams(new URL(approved.data.invitationUrl).hash.slice(1)).get('token');
  const d=f.handler.database(),stored=JSON.parse(d.prepare('SELECT quote FROM sponsor_applications WHERE id=?').get(id).quote);
  d.prepare('UPDATE sponsor_applications SET quote=?,status=?,checkout_id=?,checkout_url=?,checkout_expires=? WHERE id=?')
   .run(JSON.stringify({...stored,purchaseType:'direct'}),'checkout_pending','cs_test_direct_resume','https://checkout.stripe.com/c/pay/cs_test_direct_resume',Math.floor(Date.now()/1000)+1800,id);
  assert.equal((await f.call('/quote',{token})).data.canResumeCheckout,true);
  for(const body of [{},{resumeOnly:true}])assert.equal((await f.call('/checkout',{token,acceptTerms:true,...body})).data.url,'https://checkout.stripe.com/c/pay/cs_test_direct_resume');
  d.prepare('UPDATE sponsor_applications SET checkout_expires=? WHERE id=?').run(Math.floor(Date.now()/1000)+30,id);
  for(const body of [{},{resumeOnly:true}])assert.equal((await f.call('/checkout',{token,acceptTerms:true,...body})).r.status,409);
  d.prepare('UPDATE sponsor_applications SET status=?,checkout_id=NULL,checkout_url=NULL WHERE id=?').run('approved',id);
  assert.equal((await f.call('/checkout',{token,acceptTerms:true})).r.status,409);
  assert.equal(creates,0);assert.equal(d.prepare('SELECT reserved_slot FROM sponsor_applications WHERE id=?').get(id).reserved_slot,'001:chest');
 }finally{await f.close();}
});

test('signed early webhook retries until its session is attached, then applies exactly once',async t=>{
 const Stripe=require('stripe');const client=new Stripe('sk_test_fake_key_for_local_signature_tests');
 for(const eventType of ['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','checkout.session.async_payment_failed'])await t.test(eventType,async()=>{
  const secret='whsec_early_event_fixture';const f=await fixture({stripe:{webhooks:client.webhooks},webhookSecret:secret,paymentsEnabled:true});
  try{
   const id=(await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID()})).data.reference;
   await f.call('/admin/login',{password:f.options.adminKey});
   await f.call(`/admin/applications/${id}/quote`,quote);
   const d=f.handler.database(),stored=JSON.parse(d.prepare('SELECT quote FROM sponsor_applications WHERE id=?').get(id).quote);
   d.prepare('UPDATE sponsor_applications SET status=?,accepted_at=?,quote=? WHERE id=?').run('checkout_pending',new Date().toISOString(),JSON.stringify({...stored,purchaseType:'direct'}),id);
   const event={id:'evt_test_early_fixture',object:'event',type:eventType,data:{object:{id:'cs_test_early_fixture',payment_status:'paid',currency:'cad',amount_subtotal:quote.subtotalCents,amount_total:932250,metadata:{sponsor_application:id}}}};
   const notify=async(value,signature)=>{const payload=JSON.stringify(value);return fetch(f.url+'/api/sponsors/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature||signedHeader(payload,secret)},body:payload});};
   assert.equal((await notify(event,'invalid')).status,400);
   assert.equal((await notify(event)).status,503);
   assert.equal(d.prepare('SELECT COUNT(*) AS n FROM sponsor_events').get().n,0);
   let row=d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id);
   assert.equal(row.status,'checkout_pending');assert.equal(row.checkout_id,null);assert.equal(row.reserved_slot,'001:chest');assert.equal(row.paid_at,null);
   d.prepare('UPDATE sponsor_applications SET checkout_id=? WHERE id=?').run('cs_test_early_fixture',id);
   if(eventType.endsWith('completed')||eventType.endsWith('succeeded')){
    const wrongAmount=structuredClone(event);wrongAmount.data.object.amount_subtotal=1;
    assert.equal((await notify(wrongAmount)).status,400);assert.equal(d.prepare('SELECT COUNT(*) AS n FROM sponsor_events').get().n,0);
   }
   assert.equal((await notify(event)).status,200);assert.equal((await notify(event)).status,200);
   assert.equal(d.prepare('SELECT COUNT(*) AS n FROM sponsor_events').get().n,1);
   row=d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id);
   const paid=eventType.endsWith('completed')||eventType.endsWith('succeeded');
   assert.equal(row.status,paid?'paid':eventType.endsWith('expired')?'expired':'payment_failed');
   assert.equal(row.reserved_slot,paid?'001:chest':null);
   assert.equal(d.prepare('SELECT COUNT(*) AS n FROM sponsor_audit WHERE application_id=? AND action=?').get(id,paid?'stripe_payment_confirmed':'direct_session_closed').n,1);
  }finally{await f.close();}
 });
});

test('unrelated signed webhook remains acknowledged without creating sponsorship records',async()=>{
 const Stripe=require('stripe');const client=new Stripe('sk_test_fake_key_for_local_signature_tests');const secret='whsec_unrelated_fixture';
 const f=await fixture({stripe:{webhooks:client.webhooks},webhookSecret:secret,paymentsEnabled:true});
 try{
  const event={id:'evt_test_unrelated',type:'checkout.session.expired',data:{object:{id:'cs_test_unrelated',metadata:{sponsor_application:crypto.randomUUID()}}}};
  const payload=JSON.stringify(event);const response=await fetch(f.url+'/api/sponsors/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signedHeader(payload,secret)},body:payload});
  assert.equal(response.status,200);assert.equal(f.handler.database().prepare('SELECT COUNT(*) AS n FROM sponsor_events').get().n,1);
  assert.equal(f.handler.database().prepare('SELECT COUNT(*) AS n FROM sponsor_applications').get().n,0);
 }finally{await f.close();}
});

test('checkout revalidates under its write lock when another connection changes the order',async t=>{
 const {DatabaseSync}=require('node:sqlite');
 const cases=[
  {name:'another worker attached a pending checkout',status:409,change:(d,id)=>d.prepare('UPDATE sponsor_applications SET status=?,checkout_id=?,checkout_url=?,checkout_attempt=? WHERE id=?').run('checkout_pending','cs_test_other_worker','https://checkout.stripe.com/c/pay/cs_test_other_worker',7,id)},
  {name:'another worker confirmed payment',status:409,change:(d,id)=>d.prepare('UPDATE sponsor_applications SET status=?,paid_at=?,amount_paid=? WHERE id=?').run('paid',new Date().toISOString(),932250,id)},
  {name:'agreement became a direct purchase',status:409,change:(d,id)=>{const q=JSON.parse(d.prepare('SELECT quote FROM sponsor_applications WHERE id=?').get(id).quote);d.prepare('UPDATE sponsor_applications SET quote=? WHERE id=?').run(JSON.stringify({...q,purchaseType:'direct'}),id);}},
  {name:'invitation expired',status:410,change:(d,id)=>d.prepare('UPDATE sponsor_applications SET invitation_expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z',id)},
  {name:'invitation was revoked',status:404,change:(d,id)=>d.prepare('UPDATE sponsor_applications SET invitation_hash=? WHERE id=?').run('replaced-by-other-worker',id)},
  {name:'agreement price changed',status:409,change:(d,id)=>{const q=JSON.parse(d.prepare('SELECT quote FROM sponsor_applications WHERE id=?').get(id).quote);d.prepare('UPDATE sponsor_applications SET quote=? WHERE id=?').run(JSON.stringify({...q,subtotalCents:q.subtotalCents+100}),id);}},
 ];
 for(const scenario of cases)await t.test(scenario.name,async()=>{
  let creates=0;const fake={checkout:{sessions:{create:async()=>{creates++;throw new Error('Stale order must not create a session');}}}};
  const f=await fixture({stripe:fake,webhookSecret:'whsec_interleaving_fixture',paymentsEnabled:true});
  let competitor;
  try{
   const id=(await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID()})).data.reference;
   await f.call('/admin/login',{password:f.options.adminKey});
   const approved=await f.call(`/admin/applications/${id}/quote`,quote);
   const token=new URLSearchParams(new URL(approved.data.invitationUrl).hash.slice(1)).get('token');
   const d=f.handler.database(),exec=d.exec.bind(d);competitor=new DatabaseSync(f.dbPath);
   let interleaved=false,committedRow;
   d.exec=function(sql){
    if(sql==='BEGIN IMMEDIATE'&&!interleaved){
     interleaved=true;
     // Deterministically commit through a separate real SQLite connection after
     // the route's first read, immediately before it acquires its write lock.
     scenario.change(competitor,id);
     committedRow=competitor.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id);
    }
    return exec(sql);
   };
   const result=await f.call('/checkout',{token,acceptTerms:true});
   assert.equal(interleaved,true);assert.equal(result.r.status,scenario.status);assert.equal(creates,0);
   assert.deepEqual(d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id),committedRow,'stale request overwrote the concurrent committed state');
  }finally{competitor?.close();await f.close();}
 });
});

test('ambiguous legacy session creation retains its attempt and defers early webhooks',async()=>{
 const Stripe=require('stripe'),client=new Stripe('sk_test_fake_key_for_local_signature_tests');
 const secret='whsec_ambiguous_fixture';let creates=0;
 const fake={webhooks:client.webhooks,checkout:{sessions:{create:async()=>{creates++;throw new Error('Response lost after possible session creation');}}}};
 const f=await fixture({stripe:fake,webhookSecret:secret,paymentsEnabled:true});
 try{
  const id=(await f.call('/applications',valid(),{'X-Request-ID':crypto.randomUUID()})).data.reference;
  await f.call('/admin/login',{password:f.options.adminKey});
  const approved=await f.call(`/admin/applications/${id}/quote`,quote);
  const token=new URLSearchParams(new URL(approved.data.invitationUrl).hash.slice(1)).get('token');
  const first=await f.call('/checkout',{token,acceptTerms:true});assert.equal(first.r.status,503);assert.match(first.data.error,/could not be confirmed/);
  const d=f.handler.database(),retained=d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id);
  assert.equal(retained.status,'checkout_pending');assert.equal(retained.checkout_attempt,1);assert.equal(retained.checkout_id,null);assert.equal(retained.reserved_slot,'001:chest');
  for(const body of [{},{resumeOnly:true}])assert.equal((await f.call('/checkout',{token,acceptTerms:true,...body})).r.status,409);
  assert.equal(creates,1);assert.deepEqual(d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id),retained);
  const event={id:'evt_test_after_ambiguous_create',type:'checkout.session.expired',data:{object:{id:'cs_test_lost_response',metadata:{sponsor_application:id}}}};
  const payload=JSON.stringify(event),response=await fetch(f.url+'/api/sponsors/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signedHeader(payload,secret)},body:payload});
  assert.equal(response.status,503);assert.equal(d.prepare('SELECT COUNT(*) AS n FROM sponsor_events').get().n,0);
  assert.deepEqual(d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id),retained);
 }finally{await f.close();}
});
