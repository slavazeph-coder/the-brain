/* BrainSNN direct checkout: upload -> one consent -> hosted payment. No duplicate review form. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),q=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const {zones,economics,money}=globalThis.GT3,model=economics();
const state={selected:'driver-door',catalog:null,csrf:null,busy:false,preview:false,order:null,dirty:false,restoring:false,sample:false};
let connecting=null,requestId=crypto.randomUUID(),fingerprint='',refreshPreviewTimer,samplePng=null;
const placementInfo={
 'driver-door':{fit:'Side-profile placement',description:'Your artwork on one driver-side door. The opposite door is a separate space.',short:'One side · Side-profile imagery'},
 'passenger-door':{fit:'Side-profile placement',description:'Your artwork on one passenger-side door. The opposite door is a separate space.',short:'One side · Side-profile imagery'},
 hood:{fit:'Front & elevated views',description:'A front-facing panel for your campaign creative. Confirm the printable area before production.',short:'Front panel · Reveal imagery'},
 wing:{fit:'Rear & elevated views',description:'Artwork on the proposed rear-wing surface, not the entire rear of the vehicle.',short:'Rear wing · Signature detail'},
 'driver-quarter':{fit:'Rear three-quarter views',description:'A rear-side placement on the driver side. The opposite quarter is a separate space.',short:'One rear side · Angled imagery'},
 'passenger-quarter':{fit:'Rear three-quarter views',description:'A rear-side placement on the passenger side. The opposite quarter is a separate space.',short:'One rear side · Angled imagery'},
 'driver-fender':{fit:'Front-side detail',description:'A compact placement at the driver-side front fender. Preview a simple, readable mark.',short:'One front side · Detail imagery'},
 'passenger-fender':{fit:'Front-side detail',description:'A compact placement at the passenger-side front fender. Preview a simple, readable mark.',short:'One front side · Detail imagery'}
};
function buyerFacts(){
 const active=state.catalog?.open===true,t=state.catalog?.terms;
 $('buyer-intro').textContent=active?'Preview your artwork on the car. Check the campaign offer, then book your space securely.':'See your creative on the car. Compare spaces. Get the campaign details before you commit.';
 $('buyer-guide-note').textContent=active?'Review the approved offer below. Check the media plan and production scope before you pay.':'Previewing is open. Booking is not. Here is what still needs to be confirmed.';
 $('fact-dates').textContent=active&&t?.starts&&t?.ends?formatDate(t.starts)+' to '+formatDate(t.ends):'Not scheduled';
 $('fact-dates-note').textContent=active?'The dates above come from the approved campaign offer.':'The campaign window and term are not confirmed.';
 $('fact-production').textContent=active?'See the approved offer':'Inclusions to be agreed';
 $('buyer-next-copy').textContent=active?'Read the approved dates, scope and cancellation conditions before paying.':'Request the campaign offer before committing your budget.';
 $('price-context').textContent=active?'Review the included deliverables, campaign term and any additional charges in the offer.':'Dates, locations and inclusions still need to be agreed. This is not a final quote.';
}
function formatDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'See offer':date.toLocaleDateString('en-CA',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});}

const say=(id,text,bad=false)=>{const e=$(id);e.textContent=text;e.classList.toggle('error',bad);};
const storage={get(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}},set(key,value){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}}};
const savedKey='gt3-design-order';
const menu=$('spot-options'),trigger=$('spot-trigger'),form=$('checkout-form');
function offer(){return state.catalog?.zones?.find(z=>z.id===state.selected)||{...model.zones.find(z=>z.id===state.selected),amount:model.zones.find(z=>z.id===state.selected).reserve,state:'available'};}
function own(){return state.order&&!state.dirty&&state.order.zone===state.selected;}
function onHold(){return offer().state==='unavailable'&&!own();}
function completed(){return own()&&['paid','processing','review'].includes(state.order.status);}
function menuOpen(open,focus=true){menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(open&&focus)(menu.querySelector('[aria-selected=true]')||menu.firstElementChild)?.focus({preventScroll:true});}
function select(id,notify=true){state.selected=zones.some(z=>z.id===id)?id:'driver-door';$('placement').value=state.selected;paint();if(notify)document.dispatchEvent(new CustomEvent('gt3:placement',{detail:state.selected}));}
for(const [i,z]of zones.entries()){
 const o=document.createElement('option');o.value=z.id;o.textContent=z.name;$('placement').append(o);
 const b=document.createElement('button');b.type='button';b.role='option';b.id='spot-'+z.id;b.dataset.zone=z.id;b.tabIndex=-1;b.setAttribute('aria-selected','false');
 const index=document.createElement('span'),label=document.createElement('span'),price=document.createElement('small');index.className='spot-index';index.textContent=String(i+1).padStart(2,'0');label.className='spot-description';const name=document.createElement('span'),hint=document.createElement('span');name.textContent=z.name;hint.className='spot-hint';hint.textContent=placementInfo[z.id].short;label.append(name,hint);price.dataset.price=z.id;b.append(index,label,price);
 b.addEventListener('click',()=>{state.dirty=true;select(z.id);menuOpen(false);trigger.focus({preventScroll:true});});menu.append(b);
}
trigger.addEventListener('click',()=>menuOpen(menu.hidden));trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();menuOpen(true);}});
menu.addEventListener('keydown',e=>{const buttons=[...menu.children],i=buttons.indexOf(document.activeElement);let n=i;if(e.key==='ArrowDown')n=(i+1)%buttons.length;else if(e.key==='ArrowUp')n=(i+buttons.length-1)%buttons.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=buttons.length-1;else if(e.key==='Escape'){e.preventDefault();menuOpen(false);trigger.focus();return;}else return;e.preventDefault();buttons[n].focus();});
document.addEventListener('pointerdown',e=>{if(!$('spot-picker').contains(e.target))menuOpen(false,false);if(!e.target.closest('.nav-more'))q('.nav-more')?.removeAttribute('open');});
$('spot-picker').addEventListener('focusout',e=>{if(e.relatedTarget&&$('spot-picker').contains(e.relatedTarget))return;setTimeout(()=>{if(!$('spot-picker').contains(document.activeElement))menuOpen(false,false);},0);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){q('.nav-more')?.removeAttribute('open');if(!menu.hidden){menuOpen(false);trigger.focus();}}});
// Mirrors are kept for the existing native 3D renderer, not as a second visible menu.
$('placement').addEventListener('change',()=>{state.dirty=true;select($('placement').value);});
function paint(){
 const z=offer(),open=state.catalog?.open===true;
 $('spot-name').textContent=z.name;$('price').textContent=money(z.amount);$('placement-fit').textContent=placementInfo[z.id].fit;$('placement-description').textContent=placementInfo[z.id].description;
 for(const b of menu.children){const item=state.catalog?.zones?.find(o=>o.id===b.dataset.zone)||model.zones.find(o=>o.id===b.dataset.zone);b.setAttribute('aria-selected',String(b.dataset.zone===state.selected));b.lastElementChild.textContent=item.state==='unavailable'?'On hold':money(item.amount||item.reserve);}
 $('space-state').textContent=onHold()?'On hold':own()&&state.order.status==='paid'?'Reserved':open?'Available':'Preview';
 let label=open?'Book this ad space ↗':'Request this ad space ↗';
 if(state.busy)label=open?'Opening checkout…':'Sending your request…';
 else if(completed())label=state.order.status==='paid'?'Payment confirmed ✓':state.order.status==='processing'?'Payment processing':'Payment needs review';
 else if(onHold())label='Space currently on hold';
 else if(!state.catalog)label='Connecting…';
 $('primary-cta').textContent=label;$('primary-cta').disabled=state.busy||state.restoring||!state.csrf||onHold()||completed();
 $('primary-cta').setAttribute('aria-busy',String(state.busy));
}
function displayTerms(){
 const root=$('offer-terms');root.replaceChildren();
 const labels={merchant:'Merchant',businessAddress:'Business address',starts:'Starts',ends:'Ends',deliverables:'Included',refundPolicy:'Refund policy',fundingPolicy:'Funding conditions',version:'Terms version'};
 if(!state.catalog?.open||!state.catalog.terms){root.textContent='Payments are not open. A saved design is a non-binding request, not a reserved space.';return;}
 for(const [key,title]of Object.entries(labels)){if(!state.catalog.terms[key])continue;const p=document.createElement('p'),b=document.createElement('strong');b.textContent=title+': ';p.append(b,document.createTextNode(state.catalog.terms[key]));root.append(p);}
}
function setMode(){const open=state.catalog?.open===true;document.body.dataset.checkoutMode=open?'pay':'request';$('campaign-badge').textContent=open?'BOOKING OPEN':'CAMPAIGN PLANNING';$('price-label').textContent=open?'ONE-TIME CAMPAIGN PRICE':'INDICATIVE CAMPAIGN PRICE';
 $('request-contact').hidden=open;$('email').disabled=open;$('email').required=!open;
 q('.steps').lastElementChild.innerHTML=open?'<b>03</b> Pay':'<b>03</b> Request';
 const consent=$('consent-copy');consent.replaceChildren();consent.append(document.createTextNode(open?'I can use this artwork, agree to save my design and accept the ':'I can use this artwork and agree to share my preview and email for a private ad-space inquiry. '));
 const link=document.createElement('a');link.href='#campaign-details';link.textContent=open?'campaign terms.':'Details & privacy.';consent.append(link);
 $('checkout-note').textContent=open?'Contact and payment details are entered once, securely on Stripe. Tax is shown before payment.':'Ask about dates, locations and inclusions. One email. No charge or reservation.';
 $('campaign-copy').textContent=open?'The approved campaign offer is shown below. Read the deliverables and funding/refund conditions before paying for this space.':'The campaign is still being planned. Your request identifies the ad space you are interested in; it does not reserve inventory or charge you. Vehicle access and delivery remain unconfirmed.';
 displayTerms();buyerFacts();paint();
}
async function request(path,body,key){const c=new AbortController(),t=setTimeout(()=>c.abort(),20000);try{const r=await fetch('/api/gt3/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json','X-CSRF-Token':state.csrf||''}:{}),...(key?{Authorization:'Bearer '+key}:{})},credentials:'same-origin',cache:'no-store',signal:c.signal,body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok)throw Error(v.error||'Could not connect. Please try again.');return v;}finally{clearTimeout(t);}}
function connect(){if(connecting)return connecting;connecting=(async()=>{try{
 if(globalThis.GT3_OFFLINE||!/^https?:$/.test(location.protocol))throw Error('Offline preview.');
 const [s,c]=await Promise.all([request('session'),request('catalog')]);if(typeof s.csrf!=='string'||!Array.isArray(c.zones))throw Error('Connection unconfirmed.');
 if(state.catalog&&(state.catalog.termsHash!==c.termsHash||state.catalog.open!==c.open))$('art-rights').checked=false;
 state.csrf=s.csrf;state.catalog=c;setMode();$('refresh-session').hidden=true;
 }catch(e){state.csrf=null;say('form-status','Connection unavailable. Your preview still works. Reconnect to continue.',true);$('refresh-session').hidden=false;paint();}finally{connecting=null;}})();return connecting;}
function preview(){try{const d=window.GT3_DESIGN?.snapshot();if(!d)throw Error('Not ready');if(state.sample){if(samplePng===null)samplePng=d.png;else if(d.png!==samplePng)state.sample=false;}$('logo-thumb').src='data:image/png;base64,'+d.png;$('logo-thumb').hidden=false;q('.upload-icon').hidden=true;state.preview=true;}catch{$('logo-thumb').hidden=true;q('.upload-icon').hidden=false;state.preview=false;}if(state.sample&&state.preview)say('art-status','Sample ad only. Upload your own artwork or type your brand before requesting this space.');$('try-example').hidden=state.preview;$('upload-label').textContent=state.preview?'Replace your artwork':'Upload your artwork';paint();}
document.addEventListener('gt3:design',e=>{if(e.detail?.pending){state.preview=false;return;}preview();});
for(const id of ['logo','brand-name','logo-size','email'])$(id).addEventListener(id==='logo'?'change':'input',()=>{state.dirty=true;clearTimeout(refreshPreviewTimer);if(id!=='email')refreshPreviewTimer=setTimeout(preview,220);paint();});
$('remove-logo').addEventListener('click',()=>{state.dirty=true;state.sample=false;samplePng=null;queueMicrotask(preview);});
$('try-example').addEventListener('click',()=>{
 if(state.preview||state.restoring||state.busy)return;
 if(!window.GT3_DESIGN){say('art-status','The car is preparing. Try the sample when it has loaded.');return;}
 state.dirty=true;samplePng=null;$('brand-name').value='YOUR AD';$('brand-name').dispatchEvent(new Event('input',{bubbles:true}));state.sample=true;
 say('art-status','Sample artwork only. Replace it with your own image before requesting a placement.');
});
function message(status){return status==='paid'?'Payment confirmed by Stripe. Your space is reserved, subject to the accepted campaign terms and final artwork approval.':status==='processing'?'Your payment is processing. Please do not pay again.':status==='review'?'This payment needs review. Contact XIO before paying again.':status==='expired'?'Your earlier checkout expired. The design is saved; availability is checked before another checkout.':status==='checkout'?'Your design is saved. Continue to your existing Stripe checkout, without starting another payment.':'Design saved privately. No payment or reservation has been made.';}
function fingerprintFor(b){return JSON.stringify([b.zone,b.brand,b.scale,b.png,b.intent,b.email||'']);}
form.addEventListener('submit',async e=>{
 e.preventDefault();if(state.busy||state.restoring||!state.csrf||completed()||onHold())return;
 if(state.sample){say('art-status','Replace the sample with your own artwork or brand name before sending an inquiry.',true);$('logo').focus();return;}
 let design;try{design=window.GT3_DESIGN?.snapshot();if(!design||design.zone!==state.selected)throw Error('Upload your logo or type a brand name first.');}catch(err){say('art-status',err.message,true);$('logo').focus();return;}
 if(!$('art-rights').checked)return $('art-rights').focus();
 const open=state.catalog.open===true,b={...design,intent:open?'pay':'request',email:open?'':$('email').value.trim(),consent:true,fax:new FormData(form).get('fax')||'',termsHash:state.catalog.termsHash};
 const next=fingerprintFor(b);if(fingerprint&&next!==fingerprint)requestId=crypto.randomUUID();fingerprint=next;
 // Do not put image data in sessionStorage. Retain only the idempotency key in memory.
 state.busy=true;paint();say('form-status',open?'Preparing secure checkout…':'Saving your design…');
 try{
  const previous=storage.get(savedKey),reuse=own()&&previous?.id===state.order.id&&(open||state.order.contact.email===b.email);
  const saved=reuse?{order:state.order,token:previous.key}:await request('designs',{...b,requestId});
  if(!saved.order?.id||typeof saved.token!=='string')throw Error('Your design was not confirmed as saved.');
  state.order=saved.order;state.dirty=false;storage.set(savedKey,{id:saved.order.id,key:saved.token});
  if(open){const checkout=await request('checkout',{id:saved.order.id,token:saved.token,termsHash:state.catalog.termsHash});
   if(checkout.url){const u=new URL(checkout.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com'||u.username||u.password)throw Error('Unexpected payment destination.');location.assign(u.href);return;}
   if(checkout.status)state.order.status=checkout.status;say('form-status',message(checkout.status));
  }else say('form-status','Design saved. Your ad-space inquiry is recorded. Reference '+saved.order.id+'. No payment or reservation.');
  $('order-status').hidden=false;say('order-status',message(state.order.status));
 }catch(err){say('form-status',err.name==='AbortError'?'Connection timed out. Retry safely; your saved design and payment will not be duplicated.':err.message,true);}
 finally{state.busy=false;paint();}
});
$('refresh-session').addEventListener('click',connect);
async function resume(){
 const fragment=new URLSearchParams(location.hash.slice(1));let saved=storage.get(savedKey);
 if(fragment.has('order')||fragment.has('key')){saved={id:fragment.get('order'),key:fragment.get('key')};if(/^[0-9a-f-]{36}$/.test(saved.id||'')&&/^[0-9a-f]{64}$/.test(saved.key||''))storage.set(savedKey,saved);else saved=null;history.replaceState(null,'',location.pathname+location.search);}
 if(!saved)return;state.restoring=true;paint();
 try{const {order}=await request('order?id='+encodeURIComponent(saved.id),null,saved.key);state.order=order;select(order.zone,false);if(order.contact?.email)$('email').value=order.contact.email;
  for(let i=0;i<120&&!window.GT3_DESIGN;i++)await new Promise(r=>setTimeout(r,100));if(!window.GT3_DESIGN)throw Error('Viewer still loading');await window.GT3_DESIGN.restore(order.design);state.dirty=false;
  $('order-status').hidden=false;say('order-status',message(order.status));
 }catch{$('order-status').hidden=false;say('order-status','Your saved design could not be restored. Reconnect before attempting another payment.',true);}
 finally{state.restoring=false;paint();}
}
for(const a of $$('a[href="#campaign-details"]'))a.addEventListener('click',()=>{$('campaign-details').open=true;});
document.addEventListener('click',e=>{if(e.target.closest('a[href="#campaign-details"]'))$('campaign-details').open=true;});
for(const b of $$('[data-case-zone]'))b.addEventListener('click',()=>{state.dirty=true;select(b.dataset.caseZone);$('studio').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});trigger.focus({preventScroll:true});});

select(new URLSearchParams(location.search).get('zone')||'driver-door');connect();resume();
})();
