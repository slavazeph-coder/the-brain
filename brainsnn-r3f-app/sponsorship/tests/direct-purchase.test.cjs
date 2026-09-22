'use strict';
process.env.SPONSOR_SKIP_PRELOAD='true';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createHandler,validateApplication,CATALOG}=require('../server.cjs');
const {createDirectPurchase,parseCampaign,releaseDirectSession}=require('../direct-purchase.cjs');
const terms={enabled:true,version:'QA-ONLY-1',durationDays:90,scope:'An isolated, fictional test campaign scope with fixed dates, supervised appearances, content deliverables and image usage rights. This is not a real offer.',activationWindow:'Example dates for automated testing only',cancellation:'Example cancellation and refund terms for automated tests only; not a merchant commitment.',sellUntil:'2099-01-01',confirmed:Object.fromEntries(['hardware','venues','staffing','artwork','tax','terms'].map(k=>[k,true]))};
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=';
const valid=()=>({company:'Example Brand',email:'robot@example.com',zone:'chest',logo:PNG,logoRights:true,privacyConsent:true,acceptTerms:true,termsVersion:terms.version,subtotalCents:1});
function fixture(extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'direct-qa-'));const h=createHandler({dbPath:path.join(dir,'test.sqlite'),production:false});const calls=[];
 const fake={checkout:{sessions:{create:async(p,o)=>{calls.push({p,o});await new Promise(r=>setTimeout(r,5));return{id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture',expires_at:Math.floor(Date.now()/1000)+1800};}}}};
 const d=h.database();const direct=createDirectPurchase({database:()=>d,validateApplication,catalog:CATALOG,secret:'local-secret-not-production',paymentReady:()=>true,getStripe:()=>fake,audit:()=>{},campaignSource:()=>terms,...extra});
 return{h,d,direct,calls,close(){h.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('self-service requires complete merchant-published terms',()=>{
 assert.equal(parseCampaign(null),null);assert.equal(parseCampaign('{}'),null);assert.equal(parseCampaign({...terms,confirmed:{}}),null);assert.equal(parseCampaign({...terms,sellUntil:'2020-01-01'}),null);assert.equal(parseCampaign({...terms,cancellation:'TBD'}),null);assert.equal(parseCampaign(terms).version,terms.version);
});
test('disabled checkout creates no purchase record or inventory hold',async()=>{
 for(const extra of [{paymentReady:()=>false},{campaignSource:()=>null}]){const f=fixture(extra);try{assert.equal(f.direct.options().ready,false);await assert.rejects(f.direct.purchase(valid(),crypto.randomUUID()),/not open yet/);assert.equal(f.d.prepare('SELECT COUNT(*) AS n FROM sponsor_applications').get().n,0);assert.equal(f.calls.length,0);}finally{f.close();}}
});
test('direct checkout stores the uploaded logo and authoritative fixed price',async()=>{
 const f=fixture();try{
  const result=await f.direct.purchase(valid(),crypto.randomUUID());assert.equal(result.url,'https://checkout.stripe.com/c/pay/cs_test_fixture');assert.match(result.token,/^[A-Za-z0-9_-]{43}$/);
  const row=f.d.prepare('SELECT * FROM sponsor_applications').get();const payload=JSON.parse(row.payload);assert.equal(payload.logo,PNG);assert.equal(payload.budgetCents,1000000);assert.equal(row.status,'checkout_pending');assert.equal(row.reserved_slot,'001:chest');assert.notEqual(row.invitation_hash,result.token);
  const p=f.calls[0].p;assert.equal(p.line_items[0].price_data.unit_amount,1000000);assert.equal(p.payment_method_types,undefined);assert.equal(p.success_url,'https://www.xioai.ca/robot-sponsorship/checkout/?payment=returned');assert.equal(JSON.stringify(p).includes(result.token),false);assert.equal(JSON.stringify(p).includes(PNG),false);
 }finally{f.close();}
});
test('simultaneous clicks and retries reuse one order and Stripe session',async()=>{
 const f=fixture();try{const key=crypto.randomUUID();const [a,b]=await Promise.all([f.direct.purchase(valid(),key),f.direct.purchase(valid(),key)]);assert.equal(a.reference,b.reference);assert.equal(a.token,b.token);assert.equal(f.calls.length,1);assert.equal((await f.direct.purchase(valid(),key)).url,a.url);assert.equal(f.calls.length,1);await assert.rejects(f.direct.purchase({...valid(),company:'Other'},key),/different details/);assert.equal(f.d.prepare('SELECT COUNT(*) AS n FROM sponsor_applications').get().n,1);}finally{f.close();}
});
test('two customers cannot buy the same placement',async()=>{
 const f=fixture();try{await f.direct.purchase(valid(),crypto.randomUUID());await assert.rejects(f.direct.purchase({...valid(),email:'other@example.com'},crypto.randomUUID()),/already held/);assert.equal(f.calls.length,1);}finally{f.close();}
});
test('image, consent, current terms and request identifier are mandatory',async()=>{
 const f=fixture();try{for(const changes of [{acceptTerms:false},{termsVersion:'old'},{privacyConsent:false},{logoRights:false},{logo:null},{logo:'data:image/svg+xml;base64,AAAA'},{email:'invalid'},{zone:'made-up'}])await assert.rejects(f.direct.purchase({...valid(),...changes},crypto.randomUUID()));await assert.rejects(f.direct.purchase(valid(),'bad'));assert.equal(f.calls.length,0);assert.equal(f.d.prepare('SELECT COUNT(*) AS n FROM sponsor_applications').get().n,0);}finally{f.close();}
});
test('only verified terminal events release an unpaid direct hold',async()=>{
 const f=fixture();try{await f.direct.purchase(valid(),crypto.randomUUID());let row=f.d.prepare('SELECT * FROM sponsor_applications').get();assert.equal(releaseDirectSession(f.d,row,'browser_cancel',()=>{}),false);assert.equal(releaseDirectSession(f.d,row,'checkout.session.expired',()=>{}),true);row=f.d.prepare('SELECT * FROM sponsor_applications').get();assert.equal(row.reserved_slot,null);assert.equal(row.status,'expired');assert.equal(releaseDirectSession(f.d,{...row,status:'paid'},'checkout.session.async_payment_failed',()=>{}),false);}finally{f.close();}
});
test('ambiguous payment-service failure retains its hold and idempotency key',async()=>{
 let keys=[],params=[],bad=true;const fake={checkout:{sessions:{create:async(p,o)=>{keys.push(o.idempotencyKey);params.push(JSON.stringify(p));if(bad)throw new Error('timeout');return{id:'cs_test_retry',url:'https://checkout.stripe.com/c/pay/cs_test_retry',expires_at:Math.floor(Date.now()/1000)+1800};}}}};
 const f=fixture({getStripe:()=>fake});try{const id=crypto.randomUUID();await assert.rejects(f.direct.purchase(valid(),id),/retained safely/);assert.equal(f.d.prepare('SELECT reserved_slot FROM sponsor_applications').get().reserved_slot,'001:chest');bad=false;await new Promise(r=>setTimeout(r,1100));await f.direct.purchase(valid(),id);assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(params[0],params[1],'Stripe retry parameters changed after an ambiguous response');}finally{f.close();}
});
