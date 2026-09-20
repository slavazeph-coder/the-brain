'use strict';
process.env.GT3_SKIP_PRELOAD='true';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {createHandler,validate}=require('../gt3/server.cjs');
const {economics}=require('../gt3/public/model.js');
const fixture=()=>({requestId:crypto.randomUUID(),name:'Test Sponsor',company:'QA only',email:'test@example.test',zone:'driver-door',budgetCents:1200000,brief:'Isolated local sponsorship proposal test.',consent:true});
test('GT3 target preserves the stronger cash-surplus condition',()=>{const p=economics();assert.equal(p.revenue,134400000);assert(p.surplus>=p.car*1.3);assert(p.zones.reduce((s,z)=>s+z.reserve,0)>=p.revenue);assert.equal(economics({surplusFactor:.3}).revenue,82300000);});
test('proposal validation cannot turn car interest into robot reservations',()=>{const p=validate({...fixture(),logo:'not uploaded',status:'paid'});assert.equal(p.campaign,'gt3');assert.equal(p.status,'proposal_only');assert(!Object.hasOwn(p,'logo'));assert.throws(()=>validate({...fixture(),zone:'chest'}));});
for(const [name,change]of Object.entries({consent:{consent:false},email:{email:'bad'},budget:{budgetCents:-1},brief:{brief:'short'},honeypot:{fax:'spam'},identity:{requestId:'x'}}))test('rejects invalid '+name,()=>assert.throws(()=>validate({...fixture(),...change})));
test('GT3 private HTTP service, storage, same-origin CSRF, replay and deletion',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gt3-check-')),key='test-owner-key-'.padEnd(40,'x'),env={SPONSOR_ADMIN_KEY:key,SPONSOR_SESSION_SECRET:'local-signing-key'};
 let handler;const server=http.createServer((q,r)=>handler.matches(q.url)?handler.handle(q,r):(r.writeHead(404),r.end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const config={env,dbPath:path.join(dir,'fixture.sqlite'),origin:base};handler=createHandler(config);
 try{
  const r=await fetch(base+'/sponsor/gt3/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-src https:\/\/sketchfab.com/);assert.match(await r.text(),/Your brand/);
  assert(!handler.matches('/lab'));assert(!handler.matches('/sponsor/'));assert(!handler.matches('/api/sponsors/catalog'));
  const s=await fetch(base+'/api/gt3/session'),session=await s.json(),cookie=s.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^gt3_session=/);assert.match(s.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const post=async(data,headers={})=>{const r=await fetch(base+'/api/gt3/proposals',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrf,...headers},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  await t.test('requires origin and signed cookie-bound CSRF',async()=>{assert.equal((await post(fixture(),{Origin:'https://evil.test'})).status,403);assert.equal((await post(fixture(),{'X-CSRF-Token':'bad'})).status,403);assert.equal((await post(fixture(),{Cookie:''})).status,403);});
  const data=fixture(),first=await post(data);assert.equal(first.status,201);assert.equal(first.data.status,'proposal_only');
  await t.test('retries save once and reject changed content',async()=>{const again=await post(data);assert.equal(again.data.reference,first.data.reference);assert.equal((await post({...data,brief:'Different proposal with same request ID'})).status,409);});
  await t.test('owner key is required and payload is not public',async()=>{assert.equal((await fetch(base+'/api/gt3/admin/proposals')).status,401);const r=await fetch(base+'/api/gt3/admin/proposals',{headers:{Authorization:'Bearer '+key}}),v=await r.json();assert.equal(v.proposals.length,1);assert.equal(v.proposals[0].company,'QA only');});
  await t.test('persists after handler restart and keeps payments disabled',async()=>{handler.close();handler=createHandler(config);assert.equal(handler.database().prepare('SELECT COUNT(*) AS n FROM gt3_proposals').get().n,1);assert.equal((await(await fetch(base+'/api/gt3/status')).json()).payments,'disabled');});
  await t.test('owner deletion requires both owner key and CSRF',async()=>{const r=await fetch(base+'/api/gt3/admin/delete',{method:'POST',headers:{Origin:base,Cookie:cookie,Authorization:'Bearer '+key,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:JSON.stringify({reference:first.data.reference})});assert.equal(r.status,200);assert.equal(handler.database().prepare('SELECT COUNT(*) AS n FROM gt3_proposals').get().n,0);});
  await t.test('does not serve source or permit arbitrary files',async()=>{for(const p of ['server.cjs','%2e%2e/server.cjs','arbitrary.svg','package.json'])assert.equal((await fetch(base+'/sponsor/gt3/'+p)).status,404);});
 }finally{await new Promise(r=>server.close(r));handler.close();fs.rmSync(dir,{recursive:true,force:true});}
});
