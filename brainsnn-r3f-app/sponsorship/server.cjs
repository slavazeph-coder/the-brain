'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { CATALOG, TERMS, publicCatalog } = require('./catalog.cjs');
const API = '/api/sponsors';
const MAX_BODY = 512 * 1024;
const SHA = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const isId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
function equal(a, b) { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); }
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function text(value, name, min, max) { if (typeof value !== 'string') fail(400, `${name} is required.`); const v = value.trim(); if (v.length < min || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) fail(400, `Check ${name.toLowerCase()}.`); return v; }
function raster(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 240000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) fail(400, 'Attach a small PNG logo.');
  const b = Buffer.from(value.split(',')[1], 'base64');
  if (b.length < 33 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || b.subarray(12, 16).toString() !== 'IHDR' || b.readUInt32BE(16) > 2048 || b.readUInt32BE(20) > 2048 || !b.readUInt32BE(16) || !b.readUInt32BE(20)) fail(400, 'That logo is not a supported PNG.');
  return value;
}
function validateApplication(b) {
  if (!b || Array.isArray(b) || typeof b !== 'object') fail(400, 'A valid application is required.');
  if (b.fax) fail(400, 'Application could not be accepted.');
  if (!['offer', 'fixed', 'waitlist'].includes(b.mode)) fail(400, 'Choose an application type.');
  const zone = CATALOG.find(z => z.id === b.zone);
  if (b.mode !== 'waitlist' && !zone) fail(400, 'Choose a placement.');
  const email = text(b.email, 'Email', 5, 254).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail(400, 'Enter a valid email address.');
  let website = '';
  if (b.website) { website = text(b.website, 'Website', 8, 350); try { if (!['https:', 'http:'].includes(new URL(website).protocol)) throw new Error(); } catch { fail(400, 'Use a complete website URL, starting with https://.'); } }
  const budget = b.mode === 'waitlist' ? 0 : Number(b.budgetCents);
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 100000000 || (b.mode === 'offer' && budget < zone.opening) || (b.mode === 'fixed' && budget !== zone.fixed)) fail(400, 'The requested price does not match this placement.');
  if (b.privacyConsent !== true) fail(400, 'Please consent to processing this application.');
  const logo = raster(b.logo);
  if (logo && b.logoRights !== true) fail(400, 'Confirm that you can use this logo.');
  let preferredDate = '';
  if (b.preferredDate) { preferredDate = String(b.preferredDate); const d = new Date(preferredDate + 'T12:00:00Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== preferredDate || preferredDate < new Date().toISOString().slice(0, 10)) fail(400, 'Choose a future preferred date.'); }
  const preview = b.preview || {};
  return {name:text(b.name,'Name',2,100),company:text(b.company,'Company',2,140),email,website,mode:b.mode,zone:zone?.id || 'fleet',side:['left','right'].includes(b.side)?b.side:'left',budgetCents:budget,campaign:text(b.campaign,'Campaign brief',20,3000),preferredDate,logo,logoRights:!!logo,privacyConsent:true,updatesConsent:b.updatesConsent === true,termsVersion:TERMS.version,preview:{text:String(preview.text || '').slice(0,32),color:/^#[a-f0-9]{6}$/i.test(preview.color || '')?preview.color:'#5775ed',scale:Math.max(.55,Math.min(1.3,Number(preview.scale)||1)),rotation:Math.max(-30,Math.min(30,Number(preview.rotation)||0))}};
}
function readBody(req, raw = false) {
  return new Promise((resolve, reject) => {
    let length = 0; const chunks = []; let failed = false;
    req.on('data', chunk => { length += chunk.length; if (length > MAX_BODY) { if (!failed) { failed = true; const e = new Error('Request is too large.'); e.status = 413; reject(e); } return; } chunks.push(chunk); });
    req.on('end', () => { if (failed) return; const data = Buffer.concat(chunks); if (raw) return resolve(data); try { resolve(JSON.parse(data.toString('utf8') || '{}')); } catch { const e = new Error('Invalid JSON.'); e.status = 400; reject(e); } });
    req.on('error', reject);
  });
}
function createHandler(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const publicDir = options.publicDir || path.join(__dirname, 'public');
  const dbPath = options.dbPath || process.env.SPONSOR_DB_PATH || (production ? '/data/brainsnn-sponsor.sqlite' : path.join(__dirname, '.data/sponsors.sqlite'));
  const secret = options.secret || process.env.SPONSOR_SESSION_SECRET || token();
  const adminKey = options.adminKey ?? process.env.SPONSOR_ADMIN_KEY ?? '';
  const origin = (options.origin || process.env.SPONSOR_PUBLIC_ORIGIN || 'https://www.brainsnn.com').replace(/\/$/, '');
  const origins = new Set([origin, 'https://brainsnn.com', 'https://www.brainsnn.com', ...(process.env.SPONSOR_ALLOWED_ORIGINS || '').split(',').filter(Boolean)]);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) origins.add('https://' + process.env.RAILWAY_PUBLIC_DOMAIN);
  const enabled = options.paymentsEnabled ?? (process.env.SPONSOR_PAYMENTS_ENABLED === 'true' && process.env.SPONSOR_TAX_READY === 'true');
  const webhookSecret = options.webhookSecret || process.env.SPONSOR_STRIPE_WEBHOOK_SECRET || '';
  let stripe = options.stripe || null;
  let db;
  const buckets = new Map();
  const hmac = value => crypto.createHmac('sha256', secret).update(value).digest('base64url');
  function getStripe() { if (!stripe && process.env.SPONSOR_STRIPE_SECRET_KEY) { const Stripe = require('stripe'); stripe = new Stripe(process.env.SPONSOR_STRIPE_SECRET_KEY, {apiVersion:'2026-07-29.dahlia', maxNetworkRetries:2}); } return stripe; }
  const paymentReady = () => !!(enabled && webhookSecret && (stripe || process.env.SPONSOR_STRIPE_SECRET_KEY));
  function database() {
    if (db) return db;
    if (production && !fs.existsSync('/data') && !options.dbPath) fail(503, 'Persistent sponsor storage is not configured.');
    fs.mkdirSync(path.dirname(dbPath), {recursive:true,mode:0o700});
    db = new DatabaseSync(dbPath);
    fs.chmodSync(dbPath, 0o600);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sponsor_applications (
        id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL,
        quote TEXT, invitation_hash TEXT UNIQUE, invitation_expires TEXT, reserved_slot TEXT UNIQUE,
        checkout_id TEXT, checkout_url TEXT, checkout_expires INTEGER, checkout_attempt INTEGER NOT NULL DEFAULT 0,
        accepted_at TEXT, paid_at TEXT, amount_paid INTEGER, stripe_event_id TEXT
      );
      CREATE TABLE IF NOT EXISTS sponsor_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sponsor_audit (id INTEGER PRIMARY KEY, application_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sponsor_admin_sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sponsor_created_idx ON sponsor_applications(created_at);
    `);
    return db;
  }
  function audit(id, action) { database().prepare('INSERT INTO sponsor_audit(application_id,action,created_at) VALUES(?,?,?)').run(id, action, new Date().toISOString()); }
  function send(res, code, data) { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); }
  function cookie(req, name) { return String(req.headers.cookie || '').split(';').map(v => v.trim().split('=')).find(v => v[0] === name)?.slice(1).join('=') || ''; }
  function setCookie(res, name, value, maxAge, cookiePath = API) { res.setHeader('Set-Cookie', `${name}=${value}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production?'; Secure':''}`); }
  function session(req, res) {
    let value = cookie(req, 'sponsor_session');
    const [nonce, expires, signature] = value.split('.');
    if (!nonce || !Number.isFinite(Number(expires)) || Number(expires) < Date.now() || !equal(signature,hmac(`${nonce}.${expires}`))) { const body = `${token()}.${Date.now()+3600000}`; value = `${body}.${hmac(body)}`; setCookie(res,'sponsor_session',value,3600); }
    return hmac('csrf:' + value);
  }
  function checkCsrf(req) {
    const value = cookie(req,'sponsor_session'); const [nonce,expires,signature] = value.split('.');
    if (!nonce || Number(expires) < Date.now() || !equal(signature,hmac(`${nonce}.${expires}`)) || !equal(req.headers['x-csrf-token'],hmac('csrf:'+value))) fail(403,'Your form session expired. Refresh the page and try again.');
    if (!origins.has(String(req.headers.origin || ''))) fail(403,'This request origin is not allowed.');
  }
  function limit(req, name, max = 20, window = 900000) {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown'); // Trust proxy is controlled by the host Express app, not this module.
    const key = name + ':' + SHA(ip); const now = Date.now(); const b = buckets.get(key);
    if (b && b.until > now) { if (++b.count > max) fail(429,'Too many attempts. Please try again later.'); return; }
    if (buckets.size > 10000) { for (const [k,v] of buckets) if (v.until < now) buckets.delete(k); if (buckets.size > 10000) fail(429,'Please try again later.'); }
    buckets.set(key,{count:1,until:now+window});
  }
  function admin(req) {
    const raw = cookie(req,'sponsor_admin');
    const found = raw && database().prepare('SELECT expires FROM sponsor_admin_sessions WHERE hash=?').get(SHA(raw));
    if (!found || found.expires < Date.now()) fail(401,'Owner sign-in is required.');
  }
  function rowForInvite(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail(404,'Invitation not found.');
    const row = database().prepare('SELECT * FROM sponsor_applications WHERE invitation_hash=?').get(SHA(value));
    if (!row || !['approved','checkout_pending','paid'].includes(row.status)) fail(404,'Invitation not found.');
    if (row.status !== 'paid' && row.invitation_expires < new Date().toISOString()) fail(410,'This quote has expired. Please request an updated agreement.');
    return row;
  }
  function security(res) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  }
  async function webhook(req, res) {
    if (!webhookSecret || !getStripe()) fail(503,'Payment notifications are not configured.');
    const raw = await readBody(req,true); let event;
    try { event = getStripe().webhooks.constructEvent(raw,req.headers['stripe-signature'],webhookSecret,300); } catch { fail(400,'Invalid payment notification.'); }
    const d = database();
    if (d.prepare('SELECT id FROM sponsor_events WHERE id=?').get(event.id)) return send(res,200,{received:true});
    const obj = event.data?.object;
    const successful = ['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type) && obj?.payment_status === 'paid';
    d.exec('BEGIN IMMEDIATE');
    try {
      const row = obj?.id && d.prepare('SELECT * FROM sponsor_applications WHERE checkout_id=?').get(obj.id);
      if (successful && row && row.accepted_at && obj.currency === 'cad' && obj.metadata?.sponsor_application === row.id) {
        const quote = JSON.parse(row.quote);
        if (obj.amount_subtotal !== quote.subtotalCents || !Number.isSafeInteger(obj.amount_total) || obj.amount_total < quote.subtotalCents) fail(400,'Payment amount does not match the agreement.');
        d.prepare("UPDATE sponsor_applications SET status='paid',paid_at=?,amount_paid=?,stripe_event_id=? WHERE id=? AND status!='paid'").run(new Date().toISOString(),obj.amount_total,event.id,row.id);
        audit(row.id,'stripe_payment_confirmed');
      }
      if (event.type === 'checkout.session.expired' && row && row.status === 'checkout_pending') d.prepare("UPDATE sponsor_applications SET status='approved',checkout_id=NULL,checkout_url=NULL,checkout_expires=NULL WHERE id=?").run(row.id);
      d.prepare('INSERT INTO sponsor_events(id,received_at) VALUES(?,?)').run(event.id,new Date().toISOString());
      d.exec('COMMIT');
    } catch (e) { d.exec('ROLLBACK'); throw e; }
    send(res,200,{received:true});
  }
  async function api(req,res,url) {
    const route = url.pathname.slice(API.length);
    if (route === '/stripe/webhook' && req.method === 'POST') return webhook(req,res);
    if (req.method === 'GET' && route === '/session') return send(res,200,{csrf:session(req,res),termsVersion:TERMS.version});
    if (req.method === 'GET' && route === '/status') { let ready=false; try { database().prepare('SELECT 1').get(); ready=true; } catch {} return send(res,ready?200:503,{ok:ready,applications:ready?'accepting':'unavailable',payments:paymentReady()?'approval_gated':'not_enabled',storage:ready?'persistent_sqlite':'unavailable',version:TERMS.version}); }
    if (req.method === 'GET' && route === '/catalog') { const reserved=database().prepare('SELECT reserved_slot FROM sponsor_applications WHERE reserved_slot IS NOT NULL').all().map(r=>r.reserved_slot.split(':')[1]); return send(res,200,publicCatalog(reserved)); }
    if (req.method !== 'GET') { if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415,'Use JSON for this request.'); checkCsrf(req); }
    if (req.method === 'POST' && route === '/applications') {
      limit(req,'applications',12);
      const raw=await readBody(req); const data=validateApplication(raw); const requestId=req.headers['x-request-id'];
      if (!isId(requestId)) fail(400,'A valid request identifier is required.');
      const payload=JSON.stringify(data); const hash=SHA(payload); const d=database();
      const existing=d.prepare('SELECT id,payload_hash FROM sponsor_applications WHERE request_id=?').get(requestId);
      if (existing) { if(existing.payload_hash!==hash) fail(409,'This request identifier was already used.'); return send(res,200,{ok:true,reference:existing.id,status:'received'}); }
      const id=crypto.randomUUID(); const now=new Date().toISOString();
      d.prepare('INSERT INTO sponsor_applications(id,request_id,payload_hash,created_at,status,payload) VALUES(?,?,?,?,?,?)').run(id,requestId,hash,now,data.mode==='waitlist'?'waitlist':'pending',payload);
      audit(id,'application_received');
      return send(res,201,{ok:true,reference:id,status:'received',message:'Your application has been saved for review. No payment has been taken and no placement has been reserved.'});
    }
    if (route === '/admin/login' && req.method === 'POST') {
      limit(req,'owner-login',5,600000); if (!adminKey || adminKey.length < 24) fail(503,'Owner access is not configured.');
      const b=await readBody(req); if (!equal(b.password,adminKey)) fail(401,'Sign-in failed.');
      const raw=token(); database().prepare('INSERT INTO sponsor_admin_sessions(hash,expires) VALUES(?,?)').run(SHA(raw),Date.now()+1800000); setCookie(res,'sponsor_admin',raw,1800); return send(res,200,{ok:true});
    }
    if (route.startsWith('/admin/')) {
      admin(req);
      if (route === '/admin/logout' && req.method === 'POST') { database().prepare('DELETE FROM sponsor_admin_sessions WHERE hash=?').run(SHA(cookie(req,'sponsor_admin'))); setCookie(res,'sponsor_admin','',0); return send(res,200,{ok:true}); }
      if (route === '/admin/applications' && req.method === 'GET') {
        const rows=database().prepare('SELECT * FROM sponsor_applications ORDER BY created_at DESC LIMIT 100').all();
        return send(res,200,{ok:true,paymentsEnabled:paymentReady(),applications:rows.map(r=>{const p=JSON.parse(r.payload);return {id:r.id,createdAt:r.created_at,status:r.status,...p,logo:undefined,hasLogo:!!p.logo,quote:r.quote?JSON.parse(r.quote):null,amountPaid:r.amount_paid};})});
      }
      const match=route.match(/^\/admin\/applications\/([0-9a-f-]{36})\/(logo|quote|reject|delete)$/);
      if (match) {
        const row=database().prepare('SELECT * FROM sponsor_applications WHERE id=?').get(match[1]); if(!row) fail(404,'Application not found.');
        if (match[2]==='logo' && req.method==='GET') { const image=JSON.parse(row.payload).logo; if(!image) fail(404,'No logo attached.'); res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}); return res.end(Buffer.from(image.split(',')[1],'base64')); }
        if (match[2]==='delete' && req.method==='POST') { const b=await readBody(req); if(b.confirm!==row.id || !['pending','rejected','waitlist'].includes(row.status)) fail(409,'Only uncontracted applications can be deleted here.'); database().prepare('DELETE FROM sponsor_applications WHERE id=?').run(row.id); audit(row.id,'application_deleted'); return send(res,200,{ok:true}); }
        if (match[2]==='reject' && req.method==='POST') { if(!['pending','waitlist'].includes(row.status)) fail(409,'Active agreements require manual reconciliation.'); database().prepare("UPDATE sponsor_applications SET status='rejected' WHERE id=?").run(row.id); audit(row.id,'application_rejected'); return send(res,200,{ok:true}); }
        if (match[2]==='quote' && req.method==='POST') {
          if(row.status!=='pending') fail(409,'Only a pending application can be approved.');
          const b=await readBody(req); const p=JSON.parse(row.payload);
          if(!Number.isSafeInteger(b.subtotalCents) || b.subtotalCents<10000 || b.subtotalCents>100000000) fail(400,'Enter a valid agreed subtotal in cents.');
          if(b.hardwareConfirmed!==true || b.venueConfirmed!==true || b.contractConfirmed!==true || b.taxReviewed!==true) fail(400,'Hardware, venue, written agreement and tax review must all be confirmed.');
          const quote={subtotalCents:b.subtotalCents,currency:'cad',scope:text(b.scope,'Agreed scope',80,6000),activationWindow:text(b.activationWindow,'Activation window',10,200),agreementReference:text(b.agreementReference,'Agreement reference',5,300),durationDays:90,termsVersion:TERMS.version};
          const invite=token(); const expires=new Date(Date.now()+14*86400000).toISOString(); const d=database();
          try { d.prepare("UPDATE sponsor_applications SET status='approved',quote=?,invitation_hash=?,invitation_expires=?,reserved_slot=? WHERE id=? AND status='pending'").run(JSON.stringify(quote),SHA(invite),expires,`001:${p.zone}`,row.id); } catch(e) { if(String(e.message).includes('UNIQUE')) fail(409,'That placement already has an active agreement.'); throw e; }
          audit(row.id,'quote_approved'); return send(res,200,{ok:true,invitationUrl:`${origin}/sponsor/checkout/#token=${invite}`,expires,message:'Share this private link with the approved sponsor. No email or payment has been sent automatically.'});
        }
      }
      fail(404,'Owner route not found.');
    }
    if (route === '/quote' && req.method === 'POST') {
      limit(req,'quote',100); const b=await readBody(req); const row=rowForInvite(b.token); const p=JSON.parse(row.payload);
      return send(res,200,{ok:true,reference:row.id,company:p.company,zone:CATALOG.find(z=>z.id===p.zone)?.name,quote:JSON.parse(row.quote),status:row.status,paymentsEnabled:paymentReady(),paidAt:row.paid_at,amountPaid:row.amount_paid});
    }
    if (route === '/checkout' && req.method === 'POST') {
      limit(req,'checkout',20); const b=await readBody(req); const row=rowForInvite(b.token);
      if(row.status==='paid') fail(409,'This sponsorship has already been paid.');
      if(b.acceptTerms!==true) fail(400,'Accept the written campaign scope before continuing.');
      if(!paymentReady()) fail(503,'Online payment has not been enabled. Contact XIO to arrange payment against the approved agreement.');
      if(row.checkout_url && row.checkout_expires>Date.now()/1000+60) return send(res,200,{url:row.checkout_url});
      const d=database(); const p=JSON.parse(row.payload); const quote=JSON.parse(row.quote);
      // A transaction serializes concurrent creation attempts. Stripe's idempotency key also protects retries.
      d.exec('BEGIN IMMEDIATE'); let attempt;
      try { const current=d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(row.id); if(current.status==='checkout_pending' && !current.checkout_id) fail(409,'Checkout is being prepared. Please retry in a moment.'); attempt=current.checkout_attempt+1; d.prepare("UPDATE sponsor_applications SET status='checkout_pending',accepted_at=?,checkout_attempt=? WHERE id=?").run(new Date().toISOString(),attempt,row.id); d.exec('COMMIT'); } catch(e) { d.exec('ROLLBACK'); throw e; }
      try {
        const s=await getStripe().checkout.sessions.create({mode:'payment',customer_email:p.email,customer_creation:'always',billing_address_collection:'required',automatic_tax:{enabled:true},tax_id_collection:{enabled:true},line_items:[{price_data:{currency:'cad',unit_amount:quote.subtotalCents,tax_behavior:'exclusive',product_data:{name:`BrainSNN Robot 001 / ${CATALOG.find(z=>z.id===p.zone)?.name}`,description:'90-day campaign under the separately approved written agreement.'}},quantity:1}],metadata:{sponsor_application:row.id,agreement_reference:quote.agreementReference},client_reference_id:row.id,success_url:`${origin}/sponsor/checkout/?payment=returned`,cancel_url:`${origin}/sponsor/checkout/?payment=cancelled`,expires_at:Math.floor(Date.now()/1000)+1800,integration_identifier:'brainsnn_sponsor_bkspmxqt'},{idempotencyKey:`brainsnn-sponsor-${row.id}-${attempt}`});
        if(!s.url || !/^https:\/\/checkout\.stripe\.com\//.test(s.url)) throw new Error('Unexpected checkout destination');
        d.prepare('UPDATE sponsor_applications SET checkout_id=?,checkout_url=?,checkout_expires=? WHERE id=? AND checkout_attempt=?').run(s.id,s.url,s.expires_at,row.id,attempt); audit(row.id,'checkout_created'); return send(res,200,{url:s.url});
      } catch(e) { d.prepare("UPDATE sponsor_applications SET status='approved' WHERE id=? AND checkout_attempt=? AND checkout_id IS NULL").run(row.id,attempt); console.error('[sponsor] checkout setup failed'); fail(503,'Checkout could not be prepared. No new charge was made by this request. Please contact XIO.'); }
    }
    fail(404,'Route not found.');
  }
  async function handle(req,res) {
    const url=new URL(req.url,'http://localhost');
    security(res);
    try {
      if(url.pathname===API || url.pathname.startsWith(API+'/')) return await api(req,res,url);
      if(!['GET','HEAD'].includes(req.method)) fail(405,'Method not allowed.');
      if(url.pathname==='/sponsor') {res.writeHead(308,{Location:'/sponsor/'});return res.end();}
      let relative=decodeURIComponent(url.pathname.slice('/sponsor/'.length));
      if(!relative) relative='index.html';
      if(['admin','admin/'].includes(relative)) relative='admin.html';
      if(['checkout','checkout/'].includes(relative)) relative='checkout.html';
      if(!/^(?:[a-zA-Z0-9_-]+\.(?:html|css|js|svg|json|txt)|models\/[a-zA-Z0-9_.-]+\.(?:stl|json|txt))$/i.test(relative)) fail(404,'Page not found.');
      const file=path.join(publicDir,relative); if(!fs.existsSync(file)) fail(404,'Page not found.');
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.stl':'application/octet-stream','.txt':'text/plain; charset=utf-8'};
      if(['admin.html','checkout.html'].includes(relative)) res.setHeader('X-Robots-Tag','noindex, nofollow');
      res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':relative.endsWith('.html')?'no-cache':'public, max-age=3600'});
      if(req.method==='HEAD')return res.end();
      fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    } catch(e) { if(res.headersSent)return res.destroy(); const status=Number(e.status)||503; if(status>=500)console.error('[sponsor] request failed:',e.code||'service_unavailable'); send(res,status,{ok:false,error:status>=500&&!e.status?'Sponsor service is temporarily unavailable. Please try again.':e.message}); }
  }
  function cleanup() { const d=database(); d.prepare('DELETE FROM sponsor_admin_sessions WHERE expires<?').run(Date.now()); const cutoff=new Date(Date.now()-180*86400000).toISOString(); d.prepare("DELETE FROM sponsor_applications WHERE created_at<? AND status IN ('pending','rejected','waitlist')").run(cutoff); }
  return {handle,database,cleanup,close:()=>{if(db)db.close();},matches:req=>/^\/(?:sponsor(?:\/|$)|api\/sponsors(?:\/|$))/.test(req.url.split('?')[0])};
}
function register() {
  // Additive middleware follows the production application's existing preload pattern.
  const original=require('express'); const location=require.resolve('express'); const appApi=createHandler();
  function wrapper(...args) { const app=original(...args); app.use((req,res,next)=>appApi.matches(req)?void appApi.handle(req,res):next()); return app; }
  Object.assign(wrapper,original); require.cache[location].exports=wrapper;
  const timer=setInterval(()=>{try{appApi.cleanup();}catch{console.error('[sponsor] retention cleanup unavailable');}},86400000);timer.unref();
}
module.exports={createHandler,validateApplication,raster,CATALOG,TERMS};
if(require.main===module) { const app=createHandler(); const server=http.createServer((req,res)=>app.matches(req)?void app.handle(req,res):(res.writeHead(404),res.end('Not found'))); server.listen(Number(process.env.PORT)||8091,'0.0.0.0',()=>console.log('Sponsor studio listening')); }
else if(process.env.SPONSOR_SKIP_PRELOAD!=='true')register();
