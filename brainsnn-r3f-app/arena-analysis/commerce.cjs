'use strict';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const id=value=>typeof value==='string'?value:value?.id;
const {paymentMode}=require('./config.cjs');
function createCommerce({store,stripe,config,now=Date.now}) {
  const mode=paymentMode(config.stripeKey);
  function sameMode(value) {
    if(!mode || (config.production && mode!=='live'))fail(503,'payment_mode','Payment environment is not configured for this service.');
    if(value?.livemode!==(mode==='live'))fail(409,'payment_mode','The payment environment does not match this service.');
  }
  async function checkout(workspaceId,requestId) {
    sameMode({livemode:mode==='live'});
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId||'')) fail(400,'request_id','A stable checkout request ID is required.');
    const workspace=store.getWorkspace(workspaceId);
    if(workspace.wallet.frozen)fail(409,'workspace_frozen','This balance needs payment reconciliation.');
    if(config.taxMode==='registered') {
      const registrations=await stripe.tax.registrations.list({status:'active',limit:1});
      if(!registrations.data?.length)fail(503,'tax_registration','Tax collection has no active registration.');
    }
    const row=store.beginCheckout({workspaceId,requestId});
    if(row.sessionId) {
      const session=await stripe.checkout.sessions.retrieve(row.sessionId);
      sameMode(session);
      if(session.status!=='open'||!session.url)fail(409,'checkout_finished','This checkout is no longer open. Refresh the balance before starting another.');
      return {url:safeCheckoutUrl(session.url)};
    }
    // Stripe idempotency requires identical parameters after a lost response or
    // crash. Anchor expiry to the durable row, not the time of each retry. Keep
    // at least Stripe's 30-minute minimum window for an unbound create request.
    if(now()>=row.createdAt+30*60*1000)fail(409,'checkout_expired','This checkout attempt expired. Refresh the balance before starting another.');
    const expiresAt=Math.floor(row.createdAt/1000)+60*60;
    const metadata={product:'brainsnn_analysis_v1',workspaceId,checkoutId:row.id};
    const session=await stripe.checkout.sessions.create({
      mode:'payment',client_reference_id:row.id,metadata,
      payment_intent_data:{metadata},billing_address_collection:'required',
      ...(config.taxMode==='registered'?{automatic_tax:{enabled:true}}:{}),
      line_items:[{quantity:1,price_data:{currency:'cad',unit_amount:5000,tax_behavior:'exclusive',product_data:{name:'BrainSNN analysis — C$50 prepaid balance',description:'Self-service recorded-episode analysis. Each analysis has a separate fixed quote; no guaranteed analysis count.',...(config.taxCode?{tax_code:config.taxCode}:{})}}}],
      success_url:config.origin+'/arena/?analysis=payment-returned',cancel_url:config.origin+'/arena/?analysis=payment-cancelled',
      expires_at:expiresAt,
      integration_identifier:'brainsnn_analysis_qmztkrav',
    },{idempotencyKey:'analysis-checkout-'+row.id});
    sameMode(session);
    const url=safeCheckoutUrl(session.url);
    store.bindCheckout({checkoutId:row.id,sessionId:session.id,url});
    return {url};
  }
  function safeCheckoutUrl(value) {
    try { const u=new URL(value);if(u.protocol==='https:'&&u.hostname==='checkout.stripe.com'&&!u.username&&!u.password&&!u.port)return u.href; }catch{}
    fail(502,'checkout_url','Payment checkout could not be confirmed.');
  }
  async function payment(event) {
    sameMode(event);
    const obj=event.data?.object;
    if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
      if(obj?.metadata?.product!=='brainsnn_analysis_v1')return;
      const session=await stripe.checkout.sessions.retrieve(obj.id,{expand:['line_items.data.price.product','payment_intent.latest_charge.balance_transaction']});
      sameMode(session);
      if(session.payment_status!=='paid')return;
      const row=store.getCheckoutById(session.metadata?.checkoutId);
      if(!row || row.workspaceId!==session.metadata?.workspaceId || session.client_reference_id!==row.id)fail(409,'checkout_binding','The payment does not match a recorded checkout.');
      const items=session.line_items?.data||[];
      const tax=session.total_details?.amount_tax;
      if(session.metadata.product!=='brainsnn_analysis_v1'||session.mode!=='payment'||session.currency!=='cad'||session.amount_subtotal!==5000||!Number.isSafeInteger(tax)||tax<0||session.amount_total!==5000+tax||session.total_details?.amount_discount!==0||session.total_details?.amount_shipping!==0||session.line_items?.has_more!==false||items.length!==1||items[0].quantity!==1||items[0].price?.unit_amount!==5000||items[0].price?.currency!=='cad'||items[0].price?.tax_behavior!=='exclusive')fail(409,'payment_mismatch','The paid amount does not match the package.');
      if(config.taxMode==='registered' && session.automatic_tax?.status!=='complete')fail(409,'tax_incomplete','The payment requires tax reconciliation.');
      const intent=session.payment_intent, paymentId=id(intent);
      if(!paymentId||typeof intent!=='object')fail(503,'payment_pending','The payment details are awaiting reconciliation.');
      sameMode(intent);
      if(intent.status!=='succeeded'||intent.currency!=='cad'||intent.amount!==session.amount_total||intent.amount_received!==session.amount_total||intent.metadata?.product!=='brainsnn_analysis_v1'||intent.metadata?.workspaceId!==row.workspaceId||intent.metadata?.checkoutId!==row.id)fail(409,'payment_binding','The completed payment does not match this checkout.');
      if(row.sessionId&&row.sessionId!==session.id)fail(409,'checkout_binding','The checkout identity changed.');
      store.bindCheckout({checkoutId:row.id,sessionId:session.id,url:row.url||'https://checkout.stripe.com/'});
      const charge=typeof intent==='object'?intent.latest_charge:null;
      if(!charge||typeof charge!=='object')fail(503,'payment_pending','The charge details are awaiting reconciliation.');
      sameMode(charge);
      if(id(charge.payment_intent)!==paymentId||charge.currency!=='cad'||charge.amount!==session.amount_total||charge.amount_captured!==session.amount_total||charge.captured!==true||charge.paid!==true)fail(409,'charge_binding','The captured charge does not match this checkout.');
      const balance=charge&&typeof charge==='object'?charge.balance_transaction:null;
      if(!balance||typeof balance!=='object'||balance.currency!=='cad'||!Number.isSafeInteger(balance.fee)||balance.fee<0||id(balance.source)!==charge.id)fail(503,'payment_fee_pending','Payment fees are awaiting reconciliation; credit has not been granted.');
      const fee=balance.fee;
      // Retrieval is current-state, so a replay of one event can reveal a newer
      // fee/refund. Snapshot-specific keys + payment uniqueness remain idempotent.
      store.creditFunding({eventId:event.id+':fund:'+fee,paymentId,workspaceId:row.workspaceId,amountCents:5000,currency:'cad',paymentFeeCents:fee});
      store.updateFundingFee({eventId:event.id+':fee:'+fee,paymentId,paymentFeeCents:fee});
      if(charge.amount_refunded>0) reverseCharge(event.id+':refund',charge);
      return;
    }
    if(event.type==='charge.refunded') { const charge=await stripe.charges.retrieve(obj.id); if(await isOurCharge(charge))reverseCharge(event.id,charge); return; }
    if(event.type==='charge.dispute.created'||event.type==='charge.dispute.updated'||event.type==='charge.dispute.closed') {
      const charge=await stripe.charges.retrieve(id(obj.charge));
      if(!await isOurCharge(charge))return;
      // A dispute requires owner reconciliation even when Stripe later reports won.
      store.reverseFunding({eventId:event.id+':freeze',paymentId:id(charge.payment_intent),reversedCents:5000,disputed:true,reason:'payment_dispute'});
      // Stripe returns dispute.balance_transactions as objects already; the
      // field itself is not an expandable relationship.
      const dispute=await stripe.disputes.retrieve(obj.id); sameMode(dispute);
      if(id(dispute.charge)!==charge.id)fail(409,'dispute_binding','The dispute does not match the charge.');
      const reversals=dispute.balance_transactions;
      if(!Array.isArray(reversals)||reversals.some(t=>!t||typeof t!=='object'||t.currency!=='cad'||!Number.isSafeInteger(t.fee)))fail(503,'dispute_fee_pending','Dispute fees are awaiting reconciliation.');
      const disputeFee=reversals.reduce((sum,t)=>sum+Math.max(0,t.fee),0);
      store.reverseFunding({eventId:event.id+':fee:'+disputeFee,paymentId:id(charge.payment_intent),reversedCents:5000,disputed:true,reason:'payment_dispute',additionalFeeCents:disputeFee});
      return;
    }
    if(event.type==='charge.updated') {
      const charge=await stripe.charges.retrieve(obj.id,{expand:['balance_transaction']});
      if(!await isOurCharge(charge))return;
      const balance=charge.balance_transaction;
      if(balance&&typeof balance==='object'&&balance.currency==='cad'&&Number.isSafeInteger(balance.fee)&&balance.fee>=0&&id(balance.source)===charge.id)store.updateFundingFee({eventId:event.id+':fee:'+balance.fee,paymentId:id(charge.payment_intent),paymentFeeCents:balance.fee});
      else fail(503,'payment_fee_pending','Payment fees are awaiting reconciliation.');
    }
  }
  async function isOurCharge(charge) {
    sameMode(charge);
    if(!id(charge?.payment_intent))return false;
    const intent=await stripe.paymentIntents.retrieve(id(charge.payment_intent));
    sameMode(intent);
    if(intent.metadata?.product!=='brainsnn_analysis_v1')return false;
    const row=store.getCheckoutById(intent.metadata?.checkoutId);
    if(!row||row.workspaceId!==intent.metadata?.workspaceId||id(charge.payment_intent)!==intent.id||charge.currency!=='cad'||intent.currency!=='cad')fail(409,'payment_binding','Payment reconciliation does not match a recorded checkout.');
    return true;
  }
  function reverseCharge(eventId,charge) {
    const paymentId=id(charge?.payment_intent);
    if(!paymentId||!Number.isSafeInteger(charge.amount)||charge.amount<=0||!Number.isSafeInteger(charge.amount_refunded)||charge.amount_refunded<0)return;
    // Refunds do not identify service versus tax principal. Conservatively remove
    // gross refunded cents; never assume a proportional tax refund grants credit.
    const reversedCents=Math.min(5000,charge.amount_refunded);
    if(reversedCents)store.reverseFunding({eventId:eventId+':'+reversedCents,paymentId,reversedCents,reason:'payment_refund'});
  }
  function verify(raw,signature) {
    let event;
    try { event=stripe.webhooks.constructEvent(raw,signature,config.webhookSecret,300); }
    catch {fail(400,'webhook_signature','Invalid payment notification.');}
    sameMode(event); return event;
  }
  return {checkout,payment,verify};
}
module.exports={createCommerce};
