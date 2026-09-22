'use strict';
// Isolated GT3 intake and guarded Checkout. Never changes robot reservations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {zones,economics}=require('./public/model.js');
const ROOT='/sponsor/gt3',API='/api/gt3',VERSION='gt3-2026-09-final';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y);};
function validate(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||b.fax)fail(400,'Check your proposal.');
 const text=(k,min,max)=>{const v=typeof b[k]==='string'?b[k].trim():'';if(v.length<min||v.length>max||/[\x00-\x1f]/.test(v.replace(/[\r\n\t]/g,'')))fail(400,'Check '+k+'.');return v;};
 const requestId=text('requestId',36,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))fail(400,'Refresh the proposal form.');
 const name=text('name',2,100),company=text('company',2,140),email=text('email',5,254).toLowerCase(),brief=text('brief',20,2000);
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))fail(400,'Enter a valid email.');
 if(!zones.some(z=>z.id===b.zone))fail(400,'Choose a placement.');
 if(!Number.isSafeInteger(b.budgetCents)||b.budgetCents<0||b.budgetCents>500000000)fail(400,'Enter a valid CAD budget.');
 if(b.consent!==true)fail(400,'Please accept the non-binding proposal terms.');
 return {requestId,name,company,email,brief,zone:b.zone,budgetCents:b.budgetCents,consent:true,termsVersion:VERSION,campaign:'gt3',status:'proposal_only'};
}
function createHandler(options={}){
 const env=options.env||process.env,production=env.NODE_ENV==='production';
 const publicDir=options.publicDir||path.join(__dirname,'public');
 const dbPath=options.dbPath||env.GT3_DB_PATH||(env.SPONSOR_DB_PATH?env.SPONSOR_DB_PATH+'.gt3':production?'/data/brainsnn-gt3.sqlite':path.join(__dirname,'.data/gt3.sqlite'));
 const secret=env.SPONSOR_SESSION_SECRET||crypto.randomBytes(32).toString('hex');
 const owner=env.SPONSOR_ADMIN_KEY||'';
 const origin=options.origin||'https://www.brainsnn.com';
 const origins=new Set([origin,'https://brainsnn.com','https://www.brainsnn.com']);
 const buckets=new Map();let db,lastPurge=0;
 function database(){
  if(!db){fs.mkdirSync(path.dirname(dbPath),{recursive:true,mode:0o700});db=new DatabaseSync(dbPath);fs.chmodSync(dbPath,0o600);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS gt3_proposals (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL)');}
  if(Date.now()-lastPurge>3600000){db.prepare('DELETE FROM gt3_proposals WHERE created_at < ?').run(Date.now()-180*86400000);lastPurge=Date.now();}return db;
 }
 const mac=s=>crypto.createHmac('sha256',secret).update(s).digest('hex');
 const cookie=req=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('gt3_session='))?.slice(12)||'';
 const valid=s=>{const [n,t,h]=s.split('.');return /^[a-f0-9]{32}$/.test(n||'')&&/^\d{13}$/.test(t||'')&&Number(t)>Date.now()&&equal(h,mac(n+'.'+t));};
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 function rate(req,name,max=20){const now=Date.now();for(const[k,v]of buckets)if(v.until<now)buckets.delete(k);if(buckets.size>10000)fail(429,'Too many attempts. Please try again later.');const key=name+sha(String(req.ip||req.socket?.remoteAddress||'unknown')),b=buckets.get(key)||{n:0,until:now+900000};b.n++;buckets.set(key,b);if(b.n>max)fail(429,'Too many attempts. Please try again later.');}
 function csrf(req){const s=cookie(req);if(!origins.has(req.headers.origin)||!valid(s)||!equal(req.headers['x-csrf-token'],mac('csrf:'+s)))fail(403,'The form session expired. Refresh it before submitting.');}
 function admin(req){rate(req,'owner',30);if(owner.length<24||!equal(req.headers.authorization,'Bearer '+owner))fail(401,'Owner authorization required.');}
 async function body(req,maxBytes=16384){if(!String(req.headers['content-type']).includes('application/json'))fail(415,'JSON required.');let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>maxBytes)fail(413,'Proposal is too large.');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail(400,'Invalid JSON.');}}
 const commerce=require('./commerce.cjs').createCommerce({database,env,origin,secret,csrf,admin,rate,json,readBody:body,stripe:options.stripe});
 async function handle(req,res){
  try{
   const u=new URL(req.url,'http://localhost'),p=u.pathname;
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
   if(await commerce.handle(req,res,p))return;
   if(p===API+'/session'&&req.method==='GET'){
    rate(req,'session',60);database();let value=cookie(req);if(!valid(value)){const plain=crypto.randomBytes(16).toString('hex')+'.'+(Date.now()+3600000);value=plain+'.'+mac(plain);res.setHeader('Set-Cookie',`gt3_session=${value}; Path=${API}; HttpOnly; SameSite=Strict; Max-Age=3600${production?'; Secure':''}`);}
    return json(res,200,{csrf:mac('csrf:'+value),applications:'accepting',payments:(await commerce.readiness()).open?'enabled':'disabled',terms:VERSION});
   }
   if(p===API+'/status'&&req.method==='GET'){database();return json(res,200,{ok:true,storage:'persistent_sqlite',applications:'accepting',payments:(await commerce.readiness()).open?'enabled':'disabled',version:VERSION});}
   if(p===API+'/proposals'&&req.method==='POST'){
    rate(req,'proposals',12);csrf(req);const data=validate(await body(req)),d=database(),payload=JSON.stringify(data),digest=sha(payload),old=d.prepare('SELECT id,digest FROM gt3_proposals WHERE request_id=?').get(data.requestId);
    if(old){if(old.digest!==digest)fail(409,'This submission key was used for another proposal. Reopen the form.');return json(res,200,{received:true,reference:old.id,status:'proposal_only'});}
    const id=crypto.randomUUID();d.prepare('INSERT INTO gt3_proposals VALUES(?,?,?,?,?)').run(id,data.requestId,digest,Date.now(),payload);return json(res,201,{received:true,reference:id,status:'proposal_only'});
   }
   if(p===API+'/admin/proposals'&&req.method==='GET'){admin(req);return json(res,200,{proposals:database().prepare('SELECT id,created_at,payload FROM gt3_proposals ORDER BY created_at DESC LIMIT 300').all().map(r=>({id:r.id,createdAt:r.created_at,...JSON.parse(r.payload)}))});}
   if(p===API+'/admin/delete'&&req.method==='POST'){admin(req);csrf(req);const b=await body(req);if(!/^[0-9a-f-]{36}$/.test(b.reference||''))fail(400,'Valid reference required.');database().prepare('DELETE FROM gt3_proposals WHERE id=?').run(b.reference);return json(res,200,{deleted:true});}
   if(p.startsWith(API))fail(404,'GT3 route not found.');
   if(!['GET','HEAD'].includes(req.method))fail(405,'Method not allowed.');
   if(p===ROOT){res.writeHead(308,{Location:ROOT+'/'+u.search});return res.end();}
   const name=p.slice((ROOT+'/').length)||'index.html';
   const allowed=new Set(['index.html','app.js','style.css','direct.js','direct.css','model.js','engine.js','rear.webp','side.webp','use-launch.svg','use-demo.svg','use-content.svg','admin.html','admin.js','viewer.js','car.glb','asset-manifest.json','LICENSE-model.txt']);
   if(!allowed.has(name))fail(404,'Page not found.');
   res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; frame-src 'none'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
   if(name==='admin.html')res.setHeader('X-Robots-Tag','noindex, nofollow');
   const file=path.join(publicDir,name),compressed=['car.glb','viewer.js'].includes(name)&&/\bgzip\b/.test(req.headers['accept-encoding']||'')&&fs.existsSync(file+'.gz');
   const data=fs.readFileSync(compressed?file+'.gz':file),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml','.glb':'model/gltf-binary','.json':'application/json','.txt':'text/plain; charset=utf-8'};
   if(compressed)res.setHeader('Content-Encoding','gzip');res.setHeader('Vary','Accept-Encoding');
   res.writeHead(200,{'Content-Type':mime[path.extname(name)],'Cache-Control':name.endsWith('.html')?'no-cache':'public, max-age=3600','Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){if(res.headersSent)return res.destroy();json(res,e.status||503,{error:e.status?e.message:'GT3 service unavailable. Please contact XIO.'});}
 }
 return {handle,database,commerce,close(){db?.close();db=undefined;},matches:p=>/^\/(?:sponsor\/gt3(?:\/|$)|api\/gt3(?:\/|$))/.test(p.split('?')[0])};
}
function register(){
 const location=require.resolve('express'),original=require(location),handler=createHandler();
 function wrapper(...args){const app=original(...args);app.use((req,res,next)=>handler.matches(req.url)?void handler.handle(req,res):next());return app;}
 Object.assign(wrapper,original);require.cache[location].exports=wrapper;
}
module.exports={createHandler,validate,ROOT,API};
if(require.main===module){const h=createHandler();require('node:http').createServer((q,r)=>h.matches(q.url)?void h.handle(q,r):(r.writeHead(404),r.end())).listen(Number(process.env.PORT)||8095,'127.0.0.1');}
else if(process.env.GT3_SKIP_PRELOAD!=='true')register();
