'use strict';
// TEST FIXTURE ONLY: no real credentials, customers, taxes, or charges.
const crypto=require('node:crypto'),zlib=require('node:zlib');
const PRODUCT='brainsnn_gt3_sponsorship_2026';
function fixture(open=true){
 const sessions=new Map(),idempotency=new Map(),calls=[];
 const env={NODE_ENV:'test',GT3_STRIPE_MODE:'test',GT3_PAYMENTS_ENABLED:open?'true':'false',GT3_STRIPE_WEBHOOK_SECRET:crypto.randomBytes(32).toString('hex'),SPONSOR_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),SPONSOR_ADMIN_KEY:crypto.randomBytes(32).toString('hex'),GT3_CAMPAIGN_JSON:JSON.stringify({approved:true,version:'QA-only',merchant:'Fixture merchant',businessAddress:'Fixture address',starts:new Date(Date.now()+86400000).toISOString(),ends:new Date(Date.now()+86400000*90).toISOString(),deliverables:'Isolated test offer only',refundPolicy:'Fixture refund conditions',fundingPolicy:'Fixture funding conditions'})};
 const stripe={accounts:{retrieve:async()=>({id:'acct_1Sx9KTE2zpmvdOtT',charges_enabled:true})},products:{retrieve:async()=>({id:PRODUCT,active:true,livemode:false,tax_code:'qa-only-tax-classification'})},tax:{settings:{retrieve:async()=>({status:'active',head_office:{address:{country:'CA'}}})},registrations:{list:async()=>({data:[{country:'CA',status:'active'}]})}},checkout:{sessions:{create:async(p,o)=>{
  calls.push({p,o});if(idempotency.has(o.idempotencyKey))return sessions.get(idempotency.get(o.idempotencyKey));const id='cs_test_'+crypto.randomBytes(12).toString('hex'),price=p.line_items[0].price_data;
  const s={id,livemode:false,url:'https://checkout.stripe.com/c/pay/'+id,status:'open',payment_status:'unpaid',mode:'payment',currency:'cad',metadata:p.metadata,amount_subtotal:price.unit_amount,amount_total:Math.round(price.unit_amount*1.13),line_items:{data:[{quantity:1,price}],has_more:false},total_details:{amount_discount:0},automatic_tax:{enabled:true,status:'complete'},payment_intent:null};sessions.set(id,s);idempotency.set(o.idempotencyKey,id);return s;},retrieve:async id=>{if(!sessions.has(id))throw Error('Unknown fixture session');return sessions.get(id);}}}};
 const paid=id=>{const s=sessions.get(id);s.status='complete';s.payment_status='paid';s.customer_details={email:'buyer@example.test',name:'Fixture Buyer'};s.payment_intent={id:'pi_'+id,status:'succeeded',currency:'cad',amount_received:s.amount_total,latest_charge:{id:'ch_'+id,paid:true,refunded:false,disputed:false,amount_refunded:0}};return s;};
 return {env,stripe,sessions,calls,paid};
}
function crc(b){let n=0xffffffff;for(const v of b){n^=v;for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return(n^0xffffffff)>>>0;}
function png(){const chunk=(t,b)=>{const c=Buffer.alloc(b.length+12);c.writeUInt32BE(b.length);c.write(t,4);b.copy(c,8);c.writeUInt32BE(crc(c.subarray(4,8+b.length)),8+b.length);return c;};const h=Buffer.alloc(13);h.writeUInt32BE(512);h.writeUInt32BE(256,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(Buffer.alloc(524544))),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
function design(){return{requestId:crypto.randomUUID(),brand:'TEST BRAND',zone:'driver-door',scale:1,png:png(),consent:true,intent:'pay'};}
module.exports={fixture,design};
