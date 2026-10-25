'use strict';
const form=document.getElementById('owner'),status=document.getElementById('owner-status'),list=document.getElementById('proposals');
let generation=0;
form.addEventListener('submit',async e=>{
 e.preventDefault();const current=++generation;list.replaceChildren();status.textContent='Loading private designs…';
 const input=document.getElementById('key'),key=input.value;input.value='';
 const read=async p=>{const r=await fetch('/api/gt3/admin/'+p,{headers:{Authorization:'Bearer '+key},cache:'no-store',credentials:'same-origin'});if(!r.ok)throw Error('Owner request failed ('+r.status+').');return r;};
 try{
  const [orders,legacy]=await Promise.all([(await read('orders')).json(),(await read('proposals')).json()]);if(current!==generation)return;
  const p=document.createElement('p');p.className='fine';p.textContent=orders.readiness.open?'Checkout readiness checks passed.':'Checkout closed: '+orders.readiness.problems.join('; ');list.append(p);
  for(const o of orders.orders){const card=document.createElement('article'),h=document.createElement('h3'),info=document.createElement('p'),ref=document.createElement('p'),button=document.createElement('button');card.className='admin-card';h.textContent=o.contact.company+' / '+o.zone;info.textContent=o.contact.name+' · '+o.contact.email;ref.textContent=o.status+' · CAD '+(o.amount/100).toLocaleString()+' · '+o.id;ref.className='fine';button.className='secondary';button.type='button';button.textContent='Download private preview';button.addEventListener('click',async()=>{button.disabled=true;try{const r=await read('artwork?id='+encodeURIComponent(o.id));const blob=await r.blob();if(blob.type!=='image/png')throw Error('Invalid artwork response.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='gt3-'+o.id+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(err){status.textContent=err.message;}finally{button.disabled=false;}});card.append(h,info,ref,button);list.append(card);}
  for(const o of legacy.proposals){const card=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');card.className='admin-card';h.textContent=o.company+' / '+o.zone;p.textContent=o.name+' · '+o.email+' · '+o.brief+' · Legacy proposal '+o.id;card.append(h,p);list.append(card);}
  status.textContent=orders.orders.length+' saved designs and '+legacy.proposals.length+' legacy proposals. Close or reload this page to clear the owner key from memory.';
 }catch(err){status.textContent=err.message;}
});
