import { createRobotViewer } from '/sponsor/viewer.js';

const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(cents/100).replace(/^\$/,'C$');
const state={catalog:null,zone:'chest',mode:'offer',online:false,csrf:null,viewer:null,hero:null,requestId:null,submitting:false};
const brands=new Map();
const form=$('sponsor-form');const dialog=$('application-dialog');
function defaultBrand(){return {text:'YOUR BRAND',color:'#3c4caa',scale:1,rotation:0,side:'left',image:null,data:null,fileName:null};}
function brand(){if(!brands.has(state.zone))brands.set(state.zone,defaultBrand());return brands.get(state.zone);}
function selected(){return state.catalog?.zones.find(z=>z.id===state.zone);}
function say(id,message){$(id).textContent=message;}
function paint(){const b=brand();state.viewer?.setBrand(state.zone,b);if(state.zone==='chest')state.hero?.setBrand('chest',b);}
function selectZone(id){
  if(!state.catalog?.zones.some(z=>z.id===id))return;
  state.zone=id;const z=selected(),b=brand();
  document.querySelectorAll('.zone-button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.zone===id)));
  say('placement-name',z.name);say('placement-tagline',z.label);say('placement-description',z.description);say('opening-price',money(z.opening));say('fixed-button',`Request fixed price · ${money(z.fixed)}`);
  const available=z.status==='open';say('placement-status',available?'Open for review':'Under agreement');$('offer-button').disabled=!state.online||!available;$('fixed-button').disabled=!state.online||!available;
  $('brand-text').value=b.text;$('brand-color').value=b.color;$('logo-scale').value=Math.round(b.scale*100);$('logo-rotation').value=b.rotation;$('panel-side').value=b.side;
  say('scale-value',Math.round(b.scale*100)+'%');say('rotation-value',b.rotation+'°');say('upload-label',b.fileName||'Try your logo');say('upload-error','');$('side-row').hidden=!['arm','thigh','shin'].includes(id);
  state.viewer?.setZone(id);paint();
  const view=z.face==='back'?'back':'front';document.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.view===view)));
}
async function catalog(){
  try{const r=await fetch('/api/sponsors/catalog',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error();state.catalog=await r.json();state.online=true;}
  catch{const r=await fetch('/sponsor/catalog.json');if(!r.ok)throw new Error('Sponsorship pricing is temporarily unavailable. Please contact info@xioai.ca.');state.catalog=await r.json();say('service-status','Preview mode: applications are temporarily unavailable. Contact info@xioai.ca.');}
  const picker=$('zone-picker');picker.replaceChildren();
  state.catalog.zones.forEach(z=>{const b=document.createElement('button');b.type='button';b.className='zone-button';b.dataset.zone=z.id;b.textContent=z.name;b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>selectZone(z.id));picker.append(b);});
  selectZone(state.zone);$('waitlist-button').disabled=!state.online;
}
async function prepareViewer(id,options){
  try{const v=await createRobotViewer($(id),{...options,dark:document.body.dataset.theme==='midnight'});if(id==='hero-robot'){state.hero=v;}else{state.viewer=v;v.setZone(state.zone);paint();}return v;}
  catch(e){const el=$(id).querySelector('.model-loading');if(el){el.replaceChildren();const text=document.createElement('span');text.textContent='3D preview unavailable on this device.';el.append(text);}if(id==='studio-robot'){$('model-warning').hidden=false;say('model-warning','You can still explore every placement and submit your application. A compatible WebGL browser is needed for the 3D preview.');$('save-preview').disabled=true;$('orbit-button').disabled=true;}}
}
$('year').textContent=new Date().getFullYear();
$('offer-button').disabled=true;$('fixed-button').disabled=true;$('waitlist-button').disabled=true;
catalog().catch(e=>{say('service-status',e.message);say('zone-picker','Please contact XIO for placement availability.');});
prepareViewer('hero-robot',{hero:true});
const lazyStudio=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){lazyStudio.disconnect();prepareViewer('studio-robot',{onSelect:selectZone});}},{rootMargin:'500px'});lazyStudio.observe($('studio-robot'));
$('brand-text').addEventListener('input',()=>{const b=brand();b.text=$('brand-text').value;b.image=null;b.data=null;b.fileName=null;say('upload-label','Try your logo');paint();});
$('brand-color').addEventListener('input',()=>{brand().color=$('brand-color').value;paint();});
$('logo-scale').addEventListener('input',()=>{brand().scale=Number($('logo-scale').value)/100;say('scale-value',$('logo-scale').value+'%');paint();});
$('logo-rotation').addEventListener('input',()=>{brand().rotation=Number($('logo-rotation').value);say('rotation-value',$('logo-rotation').value+'°');paint();});
$('panel-side').addEventListener('change',()=>{brand().side=$('panel-side').value;paint();});
$('clear-logo').addEventListener('click',()=>{brands.set(state.zone,defaultBrand());$('logo-upload').value='';selectZone(state.zone);});
let uploadEpoch=0;
$('logo-upload').addEventListener('change',async()=>{
  const file=$('logo-upload').files?.[0];if(!file)return;const epoch=++uploadEpoch;const zoneAtUpload=state.zone;
  say('upload-error','');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){say('upload-error','Choose a PNG, JPG or WebP under 2 MB.');$('logo-upload').value='';return;}
  const url=URL.createObjectURL(file);
  try{const image=new Image();image.src=url;await image.decode();if(image.naturalWidth>8192||image.naturalHeight>8192||image.naturalWidth*image.naturalHeight>24000000)throw new Error('Use a smaller image, up to 8,192 pixels per side.');
    const canvas=document.createElement('canvas');let width=600;let data;
    do{const ratio=Math.min(width/image.naturalWidth,width/image.naturalHeight,1);canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/png');width=Math.round(width*.7);}while(data.length>230000&&width>90);
    if(data.length>230000)throw new Error('This logo is too detailed. Try a smaller, simpler PNG.');
    const normalized=new Image();normalized.src=data;await normalized.decode();if(epoch!==uploadEpoch)return;
    if(!brands.has(zoneAtUpload))brands.set(zoneAtUpload,defaultBrand());Object.assign(brands.get(zoneAtUpload),{image:normalized,data,fileName:file.name.slice(0,100)});
    if(state.zone===zoneAtUpload){say('upload-label',file.name);paint();}
  }catch(e){say('upload-error',e.message||'We could not read that image. Try a PNG.');}finally{URL.revokeObjectURL(url);$('logo-upload').value='';}
});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{state.viewer?.view(button.dataset.view);document.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));}));
$('save-preview').addEventListener('click',()=>state.viewer?.snapshot());
$('orbit-button').addEventListener('click',async()=>{const button=$('orbit-button');button.disabled=true;try{await state.viewer?.orbit();}finally{button.disabled=false;}});
async function csrf(){if(state.csrf)return state.csrf;const r=await fetch('/api/sponsors/session',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error('The application service is unavailable. Please try again.');const result=await r.json();state.csrf=result.csrf;return state.csrf;}
function openApplication(mode){
  if(!state.online)return;state.mode=mode;state.requestId=crypto.randomUUID();state.submitting=false;
  form.reset();$('application-fields').hidden=false;$('application-success').hidden=true;$('form-error').hidden=true;$('submit-application').disabled=false;say('submit-application',mode==='waitlist'?'Join the future fleet list ↗':'Submit application ↗');
  const wait=mode==='waitlist',z=selected();say('application-title',wait?'Meet what comes next.':'Your brand. Robot 001.');
  say('application-context',wait?'Tell us about your interest in future robots. This is a free expression of interest, not a reservation.':`${z.name} · ${mode==='fixed'?'Fixed-price request':'Private sponsorship offer'} · Proposed 90-day campaign. Availability and scope require written approval.`);
  $('amount-field').hidden=wait;form.elements.amount.required=!wait;form.elements.amount.readOnly=mode==='fixed';form.elements.amount.min=wait?'0':String((mode==='fixed'?z.fixed:z.opening)/100);form.elements.amount.value=wait?'':String((mode==='fixed'?z.fixed:z.opening)/100);
  say('amount-label',mode==='fixed'?'Requested fixed price, CAD':'Your offer, CAD');
  form.elements.preferredDate.min=new Date().toISOString().slice(0,10);$('attach-logo-option').hidden=wait||!brand().data;$('logo-rights-check').hidden=true;form.elements.logoRights.required=false;
  dialog.showModal();document.body.style.overflow='hidden';csrf().catch(e=>{showError(e.message);});
}
function closeDialog(){if(state.submitting)return;dialog.close();document.body.style.overflow='';}
$('offer-button').addEventListener('click',()=>openApplication('offer'));$('fixed-button').addEventListener('click',()=>openApplication('fixed'));$('waitlist-button').addEventListener('click',()=>openApplication('waitlist'));
$('close-dialog').addEventListener('click',closeDialog);$('done-dialog').addEventListener('click',closeDialog);
dialog.addEventListener('cancel',e=>{if(state.submitting)e.preventDefault();else document.body.style.overflow='';});dialog.addEventListener('close',()=>document.body.style.overflow='');
form.elements.attachLogo.addEventListener('change',()=>{const checked=form.elements.attachLogo.checked;$('logo-rights-check').hidden=!checked;form.elements.logoRights.required=checked;if(!checked)form.elements.logoRights.checked=false;});
function showError(message){$('form-error').hidden=false;say('form-error',message);}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(state.submitting||!form.reportValidity())return;state.submitting=true;$('submit-application').disabled=true;say('submit-application','Saving your application…');$('form-error').hidden=true;
  const values=new FormData(form);const b=brand();const payload={name:values.get('name'),company:values.get('company'),email:values.get('email'),website:values.get('website'),preferredDate:values.get('preferredDate'),mode:state.mode,zone:state.mode==='waitlist'?'fleet':state.zone,side:b.side,budgetCents:state.mode==='waitlist'?0:Math.round(Number(values.get('amount'))*100),campaign:values.get('campaign'),privacyConsent:values.get('privacyConsent')==='on',updatesConsent:values.get('updatesConsent')==='on',fax:values.get('fax'),logo:values.get('attachLogo')==='on'?b.data:null,logoRights:values.get('logoRights')==='on',preview:{text:b.text,color:b.color,scale:b.scale,rotation:b.rotation}};
  try{const c=await csrf();const response=await fetch('/api/sponsors/applications',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':c,'X-Request-ID':state.requestId},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok){if(response.status===403)state.csrf=null;if(response.status===409)state.requestId=crypto.randomUUID();throw new Error(result.error||'Your request could not be saved.');}
    if(!result.ok||!result.reference)throw new Error('The server did not confirm your application. Please retry.');$('application-fields').hidden=true;$('application-success').hidden=false;$('application-reference').value=result.reference;$('done-dialog').focus();
  }catch(e){showError(e.message||'Connection interrupted. Your information is still here. Please retry.');}finally{state.submitting=false;$('submit-application').disabled=false;say('submit-application',state.mode==='waitlist'?'Join the future fleet list ↗':'Submit application ↗');}
});
