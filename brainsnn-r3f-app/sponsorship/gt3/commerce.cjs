'use strict';
// GT3 only. Hosted Checkout, private saved designs, conservative exclusive inventory.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {economics} = require('./public/model.js');
const ACCOUNT = 'acct_1Sx9KTE2zpmvdOtT';
const PRODUCT = 'brainsnn_gt3_sponsorship_2026';
const API_VERSION = '2026-07-29.dahlia';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const error = (status, message) => { throw Object.assign(new Error(message), {status}); };
const same = (a,b) => { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||'')); return x.length===y.length && x.length>0 && crypto.timingSafeEqual(x,y); };
const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v||'');
const crcTable = Array.from({length:256},(_,n)=>{ for(let k=0;k<8;k++) n=n&1?0xedb88320^(n>>>1):n>>>1; return n>>>0; });
function crc(b){let n=0xffffffff;for(const v of b)n=crcTable[(n^v)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function png(encoded){
 if(typeof encoded!=='string'||encoded.length>800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))error(400,'Use a valid logo preview.');
 const b=Buffer.from(encoded,'base64');if(b.length>600000||b.length<45||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')error(400,'PNG preview required.');
 let pos=8,header=false,ended=false;const chunks=[b.subarray(0,8)],data=[];
 while(pos<b.length){if(pos+12>b.length)error(400,'Incomplete preview.');const size=b.readUInt32BE(pos),end=pos+size+12;if(end>b.length)error(400,'Invalid preview.');const type=b.toString('ascii',pos+4,pos+8),part=b.subarray(pos+8,pos+8+size);if(crc(b.subarray(pos+4,pos+8+size))!==b.readUInt32BE(pos+8+size))error(400,'Corrupt preview.');
  if(type==='IHDR'){if(header||pos!==8||size!==13||part.readUInt32BE(0)!==512||part.readUInt32BE(4)!==256||part[8]!==8||part[9]!==6||part[10]||part[11]||part[12])error(400,'Use the studio-generated preview.');header=true;chunks.push(b.subarray(pos,end));}
  else if(type==='IDAT'){if(!header||ended)error(400,'Invalid preview data.');data.push(part);chunks.push(b.subarray(pos,end));}
  else if(type==='IEND'){if(size||end!==b.length||!data.length)error(400,'Invalid preview ending.');ended=true;chunks.push(b.subarray(pos,end));}
  else if(!/^[a-z]/.test(type))error(400,'Unsupported PNG preview.');
  pos=end;
 }
 if(!header||!ended)error(400,'Incomplete preview.');let raw;try{raw=zlib.inflateSync(Buffer.concat(data),{maxOutputLength:524544});}catch{error(400,'Invalid preview compression.');}
 if(raw.length!==524544)error(400,'Invalid preview dimensions.');for(let i=0;i<256;i++)if(raw[i*2049]>4)error(400,'Invalid preview filter.');return Buffer.concat(chunks);
}
function validateOrder(b, contactMode='legacy'){
 if(!b||Array.isArray(b)||!uuid(b.requestId)||b.fax||b.consent!==true)error(400,'Confirm your details and artwork permission.');
 const text=(k,min,max)=>{const s=typeof b[k]==='string'?b[k].trim():'';if(s.length<min||s.length>max||/[\x00-\x1f]/.test(s))error(400,'Check '+k+'.');return s;};
 // Only the guarded direct-design endpoint can request Stripe-collected contact.
 const direct=contactMode==='stripe',compact=contactMode==='email';
 const name=direct||compact?'':text('name',2,100),company=direct||compact?'':text('company',2,140);
 const email=direct?'':text('email',5,254).toLowerCase(),brand=text('brand',0,28);
 if(!direct&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))error(400,'Enter a valid email.');
 const zone=economics().zones.find(z=>z.id===b.zone);if(!zone)error(400,'Choose a placement.');
 if(!Number.isFinite(b.scale)||b.scale<.6||b.scale>1.4)error(400,'Check the preview size.');
 const image=png(b.png);return {requestId:b.requestId,contact:{name,company,email},design:{zone:zone.id,brand,scale:b.scale},image,artworkSha:sha(image),amount:zone.reserve};
}
function createCommerce({database,env,origin,secret,csrf,admin,rate,json,readBody,stripe:injected}){
 let client=injected,gateCache=null,gateUntil=0;
 const live=env.NODE_ENV==='production'||env.GT3_STRIPE_MODE!=='test';
 function stripe(){if(!client){if(!env.GT3_STRIPE_KEY)error(503,'Secure checkout is not configured yet.');const Stripe=require('stripe');client=new Stripe(env.GT3_STRIPE_KEY,{apiVersion:API_VERSION,timeout:12000,maxNetworkRetries:1});}return client;}
 function db(){const d=database();d.exec(`CREATE TABLE IF NOT EXISTS gt3_orders (
 id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 status TEXT NOT NULL,zone TEXT NOT NULL,amount INTEGER NOT NULL,artwork_sha TEXT NOT NULL,artwork BLOB NOT NULL,design TEXT NOT NULL,contact TEXT NOT NULL,
 terms TEXT,terms_hash TEXT,session_id TEXT UNIQUE,payment_intent TEXT,attempt INTEGER NOT NULL DEFAULT 0,create_params TEXT);
 CREATE TABLE IF NOT EXISTS gt3_inventory (zone TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS gt3_retired_sessions (id TEXT PRIMARY KEY,order_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS gt3_payment_events (id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
 `);d.prepare("DELETE FROM gt3_orders WHERE status='draft' AND created_at<? AND id NOT IN (SELECT order_id FROM gt3_inventory)").run(Date.now()-180*86400000);return d;}
 function transaction(fn){const d=db();d.exec('BEGIN IMMEDIATE');try{const result=fn(d);d.exec('COMMIT');return result;}catch(e){d.exec('ROLLBACK');throw e;}}
 function terms(){try{const c=JSON.parse(env.GT3_CAMPAIGN_JSON||'{}');const fields=['version','merchant','businessAddress','starts','ends','deliverables','refundPolicy','fundingPolicy'];if(c.approved!==true||fields.some(k=>typeof c[k]!=='string'||c[k].trim().length<2||c[k].length>2500)||!Number.isFinite(Date.parse(c.starts))||!Number.isFinite(Date.parse(c.ends))||Date.parse(c.ends)<=Date.parse(c.starts)||Date.parse(c.ends)<=Date.now())return null;const out={};for(const k of fields)out[k]=c[k].trim();return out;}catch{return null;}}
 async function readiness(force=false){
  const t=terms(),problems=[];if(env.GT3_PAYMENTS_ENABLED!=='true')problems.push('Payments not activated');if(!t)problems.push('Approved campaign terms required');if(!env.GT3_STRIPE_KEY&&!injected)problems.push('Runtime Stripe key missing');if(!env.GT3_STRIPE_WEBHOOK_SECRET)problems.push('Dedicated webhook secret missing');
  if(problems.length)return {open:false,problems,terms:t,termsHash:t?sha(JSON.stringify(t)):null};
  if(!force&&gateCache&&Date.now()<gateUntil)return gateCache;
  try{const s=stripe();const [a,p,tax,regs]=await Promise.all([s.accounts.retrieve(),s.products.retrieve(PRODUCT),s.tax.settings.retrieve(),s.tax.registrations.list({status:'active',limit:100})]);
   if(a.id!==ACCOUNT||a.charges_enabled!==true)problems.push('XIO account is not charge-enabled');
   if(p.id!==PRODUCT||p.active!==true||p.livemode!==live||!p.tax_code||p.tax_code==='txcd_00000000')problems.push('Active sponsorship product and reviewed tax code required');
   if(tax.status!=='active'||!tax.head_office)problems.push('Stripe Tax head-office setup incomplete');
   if(!regs.data?.some(r=>r.country==='CA'&&r.status==='active'))problems.push('Reviewed Canadian tax registration missing');
  }catch{problems.push('Stripe readiness check failed');}
  gateCache={open:!problems.length,problems,terms:t,termsHash:t?sha(JSON.stringify(t)):null};gateUntil=Date.now()+30000;return gateCache;
 }
 const token=r=>crypto.createHmac('sha256',secret).update('gt3-order:'+r.id+':'+r.digest).digest('hex');
 function get(id){if(!uuid(id))error(404,'Design not found.');const r=db().prepare('SELECT * FROM gt3_orders WHERE id=?').get(id);if(!r)error(404,'Design not found.');return r;}
 function authorize(id,key){const r=get(id);if(!same(key,token(r)))error(404,'Design not found.');return r;}
 const brief=r=>({id:r.id,status:r.status,zone:r.zone,amount:r.amount,currency:'cad',design:{...JSON.parse(r.design),png:Buffer.from(r.artwork).toString('base64')},contact:JSON.parse(r.contact)});
 function record(b,contactMode='legacy'){const v=validateOrder(b,contactMode),digest=sha(JSON.stringify({contact:v.contact,design:v.design,amount:v.amount,artworkSha:v.artworkSha}));return transaction(d=>{
  const old=d.prepare('SELECT * FROM gt3_orders WHERE request_id=?').get(v.requestId);if(old){if(old.digest!==digest)error(409,'This request was already used for another design. Review again.');return {order:brief(old),token:token(old),duplicate:true};}
  if(d.prepare("SELECT COUNT(*) AS n FROM gt3_orders WHERE status='draft'").get().n>=200)error(429,'Design inbox is full. Please contact XIO.');
  const id=crypto.randomUUID(),now=Date.now();d.prepare('INSERT INTO gt3_orders (id,request_id,digest,created_at,updated_at,status,zone,amount,artwork_sha,artwork,design,contact) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,v.requestId,digest,now,now,'draft',v.design.zone,v.amount,v.artworkSha,v.image,JSON.stringify(v.design),JSON.stringify(v.contact));const r=d.prepare('SELECT * FROM gt3_orders WHERE id=?').get(id);return {order:brief(r),token:token(r),duplicate:false};});}
 const validSessionUrl=url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='checkout.stripe.com'&&!u.username&&!u.password;}catch{return false;}};
 async function reconcile(id){
  const r=get(id);if(!r.session_id)return r;
  const c=await stripe().checkout.sessions.retrieve(r.session_id,{expand:['line_items.data.price','payment_intent.latest_charge']});
  const line=c.line_items?.data,pi=c.payment_intent;
  if(c.id!==r.session_id||c.metadata?.campaign!=='brainsnn_gt3'||c.metadata?.order_id!==r.id||c.metadata?.artwork_sha!==r.artwork_sha||c.metadata?.terms_hash!==r.terms_hash||c.mode!=='payment'||c.currency!=='cad'||c.livemode!==live||c.amount_subtotal!==r.amount||line?.length!==1||c.line_items.has_more||line[0].quantity!==1||line[0].price?.unit_amount!==r.amount||line[0].price?.currency!=='cad'||line[0].price?.product!==PRODUCT||c.total_details?.amount_discount)error(409,'Payment could not be reconciled. Contact XIO.');
  let status=r.status;const charge=pi&&typeof pi==='object'?pi.latest_charge:null;
  if(charge&&(charge.disputed||charge.refunded||charge.amount_refunded>0))status='review';
  else if(['paid','review'].includes(r.status))status=r.status;
  else if(c.payment_status==='paid'&&c.status==='complete'){
   if(!pi||typeof pi!=='object'||pi.status!=='succeeded'||pi.currency!=='cad'||pi.amount_received!==c.amount_total||!charge||typeof charge!=='object'||charge.paid!==true||c.automatic_tax?.enabled!==true||c.automatic_tax?.status!=='complete'||!Number.isSafeInteger(c.amount_total)||c.amount_total<r.amount)error(409,'Payment is not fully verified.');status='paid';
  }else if(c.status==='expired'&&c.payment_status==='unpaid')status='expired';
  else if(c.status==='complete')status='processing';else status='checkout';
  // Customer details come from this exact verified Stripe session, never redirect fields.
  const contact={...JSON.parse(r.contact)};
  if(c.status==='complete'&&c.customer_details){
   const details=c.customer_details,clean=(v,max)=>typeof v==='string'?v.replace(/[\x00-\x1f]/g,'').trim().slice(0,max):'';
   const email=clean(details.email,254).toLowerCase();
   if(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))contact.email=email;
   const name=clean(details.name,100);if(name)contact.name=name;
  }
  transaction(d=>{const current=d.prepare('SELECT status FROM gt3_orders WHERE id=?').get(id);if(current.status==='review')status='review';if(current.status==='paid'&&status!=='review')status='paid';
   d.prepare('UPDATE gt3_orders SET status=?,payment_intent=?,contact=?,updated_at=? WHERE id=?').run(status,(typeof pi==='object'?pi?.id:pi)||null,JSON.stringify(contact),Date.now(),id);
   if(status==='expired')d.prepare('DELETE FROM gt3_inventory WHERE order_id=?').run(id);
  });return get(id);
 }
 async function checkout(id,key,acceptedHash){
  let r=authorize(id,key);const ready=await readiness();if(!ready.open)error(503,'Checkout is not open yet. Your design is saved; no payment was taken.');
  if(acceptedHash!==ready.termsHash)error(409,'Review the current campaign terms before paying.');
  if(r.terms_hash&&r.terms_hash!==ready.termsHash&&r.status!=='expired')error(409,'Campaign terms changed. Contact XIO to reconcile the earlier checkout before paying.');
  if(r.amount!==economics().zones.find(z=>z.id===r.zone).reserve)error(409,'The planning price changed. Request an updated offer.');
  if(r.session_id){r=await reconcile(id);if(['paid','review','processing'].includes(r.status))return {status:r.status};if(r.status==='checkout'){const s=await stripe().checkout.sessions.retrieve(r.session_id);if(!validSessionUrl(s.url))error(503,'Checkout link unavailable.');return {url:s.url,status:'checkout'};}}
  const held=db().prepare('SELECT order_id FROM gt3_inventory WHERE zone=?').get(r.zone);if(held&&held.order_id!==id){const other=get(held.order_id);if(other.session_id)await reconcile(other.id);}
  r=transaction(d=>{let current=d.prepare('SELECT * FROM gt3_orders WHERE id=?').get(id);const held=d.prepare('SELECT order_id FROM gt3_inventory WHERE zone=?').get(current.zone);if(held&&held.order_id!==id)error(409,'That placement is in another checkout or already reserved. Choose a different spot.');
   if(current.status==='creating'){if(Date.now()-current.updated_at>3500000)error(409,'An earlier checkout needs payment reconciliation. Contact XIO before retrying.');return current;}
   if(!['draft','expired'].includes(current.status))error(409,'This order cannot start another payment.');
   if(current.status==='expired'&&current.session_id)d.prepare('INSERT OR IGNORE INTO gt3_retired_sessions VALUES(?,?)').run(current.session_id,current.id);
   const attempt=current.attempt+1,metadata={campaign:'brainsnn_gt3',order_id:id,artwork_sha:current.artwork_sha,terms_hash:ready.termsHash};
   const fragment='#order='+id+'&key='+token(current);
   const suffix=Array.from(crypto.randomBytes(8),v=>String.fromCharCode(97+v%26)).join('');
   const params={mode:'payment',line_items:[{price_data:{currency:'cad',product:PRODUCT,unit_amount:current.amount,tax_behavior:'exclusive'},quantity:1}],client_reference_id:id,metadata,...(JSON.parse(current.contact).email?{customer_email:JSON.parse(current.contact).email}:{}),success_url:origin+'/sponsor/gt3/?payment=return'+fragment,cancel_url:origin+'/sponsor/gt3/?payment=cancelled'+fragment,expires_at:Math.floor(Date.now()/1000)+3600,automatic_tax:{enabled:true},tax_id_collection:{enabled:true},payment_intent_data:{metadata},integration_identifier:'brainsnn_gt3_'+suffix,branding_settings:{display_name:'BrainSNN by XIO',background_color:'#080c12',button_color:'#7967dd'},custom_text:{submit:{message:'Your selected GT3 placement. Delivery, cancellation and funding conditions are governed by the campaign terms you accepted.'}}};
   d.prepare('INSERT OR IGNORE INTO gt3_inventory VALUES(?,?,?)').run(current.zone,id,Date.now());
   d.prepare("UPDATE gt3_orders SET status='creating',attempt=?,terms=?,terms_hash=?,create_params=?,session_id=NULL,updated_at=? WHERE id=?").run(attempt,JSON.stringify(ready.terms),ready.termsHash,JSON.stringify(params),Date.now(),id);return d.prepare('SELECT * FROM gt3_orders WHERE id=?').get(id);
  });
  // Params and idempotency key are durable. A timeout never releases uncertain inventory.
  const c=await stripe().checkout.sessions.create(JSON.parse(r.create_params),{idempotencyKey:'gt3:'+id+':'+r.attempt});
  if(!validSessionUrl(c.url)||!/^cs_/.test(c.id)||c.livemode!==live)error(503,'Checkout creation was not confirmed. Contact XIO.');
  db().prepare("UPDATE gt3_orders SET session_id=?,status='checkout',updated_at=? WHERE id=? AND status='creating'").run(c.id,Date.now(),id);return {url:c.url,status:'checkout'};
 }
 async function webhook(req){
  if(!env.GT3_STRIPE_WEBHOOK_SECRET)error(503,'Webhook is not configured.');const chunks=[];let n=0;for await(const b of req){n+=b.length;if(n>1048576)error(413,'Event too large.');chunks.push(b);}const raw=Buffer.concat(chunks);
  // Verify the unmodified raw body, including a strict timestamp tolerance.
  const header=String(req.headers['stripe-signature']||''),parts=header.split(',').map(v=>v.split('=')),ts=parts.find(v=>v[0]==='t')?.[1];
  if(!/^\d+$/.test(ts||'')||Math.abs(Date.now()/1000-Number(ts))>300)error(400,'Invalid signature.');const expected=crypto.createHmac('sha256',env.GT3_STRIPE_WEBHOOK_SECRET).update(ts+'.').update(raw).digest('hex');if(!parts.some(v=>v[0]==='v1'&&same(v[1],expected)))error(400,'Invalid signature.');
  let event;try{event=JSON.parse(raw);}catch{error(400,'Invalid event.');}if(!/^evt_/.test(event.id||'')||event.livemode!==live)error(400,'Incorrect event mode.');if(db().prepare('SELECT id FROM gt3_payment_events WHERE id=?').get(event.id))return;
  const o=event.data?.object;let id=o?.metadata?.campaign==='brainsnn_gt3'?o.metadata.order_id:null;
  if(!id&&o?.payment_intent){const pi=typeof o.payment_intent==='string'?o.payment_intent:o.payment_intent.id;id=db().prepare('SELECT id FROM gt3_orders WHERE payment_intent=?').get(pi)?.id;}
  if(id&&uuid(id)){
   const row=db().prepare('SELECT * FROM gt3_orders WHERE id=?').get(id);
   if(row){if(event.type.startsWith('checkout.session.')){if(row.session_id!==o.id){const retired=db().prepare('SELECT order_id FROM gt3_retired_sessions WHERE id=?').get(o.id);if(!retired||retired.order_id!==id)error(409,'Session not recorded yet.');const previous=await stripe().checkout.sessions.retrieve(o.id);if(previous.status!=='expired'||previous.payment_status!=='unpaid')db().prepare("UPDATE gt3_orders SET status='review' WHERE id=?").run(id);}else await reconcile(id);}
    else if(['charge.refunded','charge.dispute.created','charge.dispute.closed'].includes(event.type)){await reconcile(id);if(event.type.startsWith('charge.dispute'))db().prepare("UPDATE gt3_orders SET status='review',updated_at=? WHERE id=?").run(Date.now(),id);}
   }
  }
  db().prepare('INSERT OR IGNORE INTO gt3_payment_events VALUES(?,?)').run(event.id,Date.now());
 }
 async function handle(req,res,p){
  if(p==='/api/gt3/catalog'&&req.method==='GET'){rate(req,'catalog',120);const ready=await readiness(),held=db().prepare('SELECT zone FROM gt3_inventory').all();json(res,200,{open:ready.open,terms:ready.terms,termsHash:ready.termsHash,zones:economics().zones.map(z=>({id:z.id,name:z.name,amount:z.reserve,state:held.some(h=>h.zone===z.id)?'unavailable':'available'}))});return true;}
  if(p==='/api/gt3/designs'&&req.method==='POST'){
   rate(req,'design-order',10);csrf(req);const b=await readBody(req,900000);
   if(!b||!['pay','request'].includes(b.intent))error(400,'Choose a valid checkout action.');
   if(b.intent==='pay'){
    const ready=await readiness();
    if(!ready.open)error(503,'Payments are not open yet. No payment was taken.');
    if(b.termsHash!==ready.termsHash)error(409,'Campaign terms changed. Please read and accept the current terms.');
   }
   const result=record(b,b.intent==='pay'?'stripe':'email');
   json(res,result.duplicate?200:201,result);return true;
  }
  if(p==='/api/gt3/orders'&&req.method==='POST'){rate(req,'design-order',10);csrf(req);const result=record(await readBody(req,900000));json(res,result.duplicate?200:201,result);return true;}
  if(p==='/api/gt3/order'&&req.method==='GET'){rate(req,'order-read',60);const u=new URL(req.url,origin),id=u.searchParams.get('id');let r=authorize(id,String(req.headers.authorization||'').replace(/^Bearer /,''));if(r.session_id&&(env.GT3_STRIPE_KEY||injected))r=await reconcile(r.id);json(res,200,{order:brief(r)});return true;}
  if(p==='/api/gt3/checkout'&&req.method==='POST'){rate(req,'checkout',12);csrf(req);const b=await readBody(req);json(res,200,await checkout(b.id,b.token,b.termsHash));return true;}
  if(p==='/api/gt3/stripe/webhook'&&req.method==='POST'){await webhook(req);json(res,200,{received:true});return true;}
  if(p==='/api/gt3/admin/orders'&&req.method==='GET'){admin(req);const rows=db().prepare('SELECT id,status,zone,amount,created_at,contact,artwork_sha,session_id FROM gt3_orders ORDER BY created_at DESC LIMIT 300').all();json(res,200,{readiness:await readiness(true),orders:rows.map(r=>({...r,contact:JSON.parse(r.contact)}))});return true;}
  if(p==='/api/gt3/admin/artwork'&&req.method==='GET'){admin(req);const r=get(new URL(req.url,origin).searchParams.get('id'));res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','Content-Disposition':'attachment; filename="gt3-'+r.id+'.png"'});res.end(Buffer.from(r.artwork));return true;}
  if(p==='/api/gt3/admin/reconcile'&&req.method==='POST'){admin(req);csrf(req);const b=await readBody(req);const r=await reconcile(b.id);json(res,200,{id:r.id,status:r.status});return true;}
  if(p==='/api/gt3/admin/order-delete'&&req.method==='POST'){admin(req);csrf(req);const b=await readBody(req);const r=get(b.id);if(r.status!=='draft')error(409,'Transaction-linked records require manual retention review.');db().prepare('DELETE FROM gt3_orders WHERE id=?').run(r.id);json(res,200,{deleted:true});return true;}
  return false;
 }
 return {handle,readiness,record,checkout,reconcile,authorize,db,token};
}
module.exports={createCommerce,validateOrder,png};
