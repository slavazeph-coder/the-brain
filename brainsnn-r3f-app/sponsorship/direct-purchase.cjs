'use strict';
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const DEST = 'https://www.xioai.ca/robot-sponsorship/checkout/';
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function parseCampaign(raw) {
  let c; try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!c || c.enabled !== true || !/^[a-zA-Z0-9_.-]{3,80}$/.test(c.version || '') || c.durationDays !== 90) return null;
  if (!['hardware','venues','staffing','artwork','tax','terms'].every(k => c.confirmed?.[k] === true)) return null;
  for (const [k, min, max] of [['scope',80,4000],['activationWindow',10,300],['cancellation',30,2000]]) {
    if (typeof c[k] !== 'string' || c[k].trim().length < min || c[k].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(c[k])) return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.sellUntil || '') || !Number.isFinite(Date.parse(c.sellUntil)) || c.sellUntil < new Date().toISOString().slice(0,10)) return null;
  return {version:c.version,durationDays:90,scope:c.scope.trim(),activationWindow:c.activationWindow.trim(),cancellation:c.cancellation.trim(),sellUntil:c.sellUntil};
}
function createDirectPurchase({database, validateApplication, catalog, secret, paymentReady, getStripe, audit, campaignSource}) {
  const inflight = new Map();
  const campaign = () => parseCampaign(campaignSource ? campaignSource() : process.env.SPONSOR_DIRECT_CAMPAIGN_JSON);
  const inviteFor = row => crypto.createHmac('sha256',secret).update('direct-purchase:'+row.id+':'+row.request_id+':'+row.payload_hash).digest('base64url');
  function options() { const c=campaign();return {ok:true,ready:!!(c && paymentReady()),campaign:c,reason:!c?'campaign_setup_pending':!paymentReady()?'payment_setup_pending':null}; }
  async function purchase(input, requestId) {
    // Readiness checks precede a purchase record. No charge or reservation while
    // merchant credentials or standard published campaign terms are missing.
    const c=campaign();
    if (!c || !paymentReady()) fail(503,'Online checkout is not open yet. No payment has been taken and no space has been reserved.');
    if (!input || typeof input !== 'object' || Array.isArray(input) || !uuid(requestId)) fail(400,'A valid checkout request is required.');
    if (input.acceptTerms !== true || input.termsVersion !== c.version || input.privacyConsent !== true || input.logoRights !== true) fail(400,'Review the current campaign terms and confirm your image rights before paying.');
    const zone=catalog.find(z=>z.id===input.zone); if (!zone) fail(400,'Choose an available space.');
    if (!input.logo) fail(400,'Upload your image before continuing to payment.');
    const data=validateApplication({name:input.name || input.company,company:input.company,email:input.email,mode:'fixed',zone:zone.id,budgetCents:zone.fixed,side:input.side,logo:input.logo,logoRights:true,privacyConsent:true,updatesConsent:false,preview:input.preview,campaign:'Direct purchase under published campaign terms '+c.version+'.',fax:input.fax});
    const payload=JSON.stringify(data), payloadHash=hash(payload+':'+c.version);
    const d=database();let row=d.prepare('SELECT * FROM sponsor_applications WHERE request_id=?').get(requestId);
    if (row) {
      if(row.payload_hash!==payloadHash || !row.quote || JSON.parse(row.quote).purchaseType!=='direct') fail(409,'This checkout request was already used for different details.');
      if(row.status==='paid') return {ok:true,reference:row.id,token:inviteFor(row),paid:true};
      if(!['checkout_pending','approved'].includes(row.status)) fail(409,'That checkout has closed. Start a new checkout or contact XIO.');
      if(Date.now()-Date.parse(row.created_at)>23*3600000) fail(409,'This checkout needs a status review before any further payment. Contact XIO.');
      if(row.checkout_url) {
        if(row.checkout_expires <= Math.floor(Date.now()/1000)+5) fail(409,'This payment session has ended. Contact XIO or wait for its confirmed release.');
        return {ok:true,reference:row.id,token:inviteFor(row),url:row.checkout_url};
      }
    } else {
      const id=crypto.randomUUID(),now=new Date().toISOString();
      const quote={purchaseType:'direct',subtotalCents:zone.fixed,currency:'cad',durationDays:90,scope:c.scope+'\n\nChanges and cancellation\n'+c.cancellation,activationWindow:c.activationWindow,agreementReference:c.version,termsVersion:c.version};
      row={id,request_id:requestId,payload_hash:payloadHash};const token=inviteFor(row);
      try {
        d.prepare("INSERT INTO sponsor_applications(id,request_id,payload_hash,created_at,status,payload,quote,invitation_hash,invitation_expires,reserved_slot,accepted_at,checkout_attempt,checkout_expires) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(id,requestId,payloadHash,now,'checkout_pending',payload,JSON.stringify(quote),hash(token),new Date(Date.now()+14*86400000).toISOString(),'001:'+zone.id,now,1,Math.floor(Date.now()/1000)+1800);
      } catch(e) { if(String(e.message).includes('UNIQUE')) fail(409,'This space is already held or purchased. Please choose another space.'); throw e; }
      row=d.prepare('SELECT * FROM sponsor_applications WHERE id=?').get(id);audit(id,'direct_terms_accepted');
    }
    if(inflight.has(row.id)) return inflight.get(row.id);
    const operation=(async()=>{
      try {
        const q=JSON.parse(row.quote),p=JSON.parse(row.payload);
        const session=await getStripe().checkout.sessions.create({mode:'payment',customer_email:p.email,customer_creation:'always',billing_address_collection:'required',automatic_tax:{enabled:true},tax_id_collection:{enabled:true},line_items:[{price_data:{currency:'cad',unit_amount:q.subtotalCents,tax_behavior:'exclusive',product_data:{name:'XIO Robot 001 / '+zone.name,description:'90-day advertising placement under published campaign '+q.termsVersion+'. Not ownership of the robot.'}},quantity:1}],metadata:{sponsor_application:row.id,agreement_reference:q.agreementReference,purchase_kind:'direct'},client_reference_id:row.id,success_url:DEST+'?payment=returned',cancel_url:DEST+'?payment=cancelled',expires_at:row.checkout_expires,integration_identifier:'xio_robot_direct_jkqspmnr'}, {idempotencyKey:'xio-robot-direct-'+row.id});
        const u=new URL(session.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com'||u.username||u.password||u.port) throw new Error('Invalid destination');
        d.prepare('UPDATE sponsor_applications SET checkout_id=?,checkout_url=?,checkout_expires=? WHERE id=? AND status=?').run(session.id,session.url,session.expires_at,row.id,'checkout_pending');audit(row.id,'direct_checkout_created');
        return {ok:true,reference:row.id,token:inviteFor(row),url:session.url};
      } catch {
        // Ambiguous network errors retain the inventory hold. The same request
        // always reuses its Stripe idempotency key, including across restarts.
        fail(503,'Checkout could not be opened. Your request is retained safely. Retry with the same details; do not start a second payment.');
      } finally {inflight.delete(row.id);}
    })();inflight.set(row.id,operation);return operation;
  }
  return {options,purchase};
}
function releaseDirectSession(d, row, eventType, audit) {
  if(!row?.quote || JSON.parse(row.quote).purchaseType!=='direct' || row.status==='paid' || !['checkout.session.expired','checkout.session.async_payment_failed'].includes(eventType)) return false;
  // Invoke only after signature verification. Browser cancellation and timeout
  // are not proof that no asynchronous payment is still outstanding.
  d.prepare("UPDATE sponsor_applications SET status=?,reserved_slot=NULL WHERE id=? AND status='checkout_pending'").run(eventType.endsWith('expired')?'expired':'payment_failed',row.id);
  audit(row.id,'direct_session_closed');return true;
}
module.exports={createDirectPurchase,parseCampaign,releaseDirectSession};
