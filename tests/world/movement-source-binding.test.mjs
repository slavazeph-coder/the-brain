import test from 'node:test';
import assert from 'node:assert/strict';
class Element extends EventTarget {
  constructor(){super();this.value='';this.files=[];this.hidden=false;this.textContent='';}
  get valueAsNumber(){return this.value===''?NaN:Number(this.value);}
  querySelector(selector){return element(selector.slice(1));}
}
const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
class Document extends EventTarget {getElementById(id){return element(id);}querySelector(selector){return element(selector.slice(1));}}
test('a common source reset cancels pending support reads and clears their input provenance',async()=>{
 const previous=globalThis.document,doc=new Document();globalThis.document=doc;
 try {
  await import('../../brainsnn-r3f-app/public/world/movement-model-ui.mjs');
  const support=element('support-model'),traces=[];support.addEventListener('movement-support-trace',e=>traces.push(e.detail));
  let release;element('support-file').files=[{name:'old-recording.csv',size:80,text:()=>new Promise(resolve=>release=resolve)}];
  element('support-mass').value='80';element('support-label').value='Old recording acceleration';element('support-offset').value='0';
  element('support-apply').dispatchEvent(new Event('click'));
  assert.equal(typeof release,'function');
  doc.dispatchEvent(new Event('movement-source-reset'));
  release('time_s,com_az_m_s2\n0,0\n1,2\n');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(traces.length,0,'A previous recording must not publish a force estimate after reset.');
  assert.equal(element('support-mass').value,'');assert.equal(element('support-label').value,'');assert.equal(element('support-status').textContent,'');
  element('support-file').files=[{name:'current.csv',size:80,text:async()=> 'time_s,com_az_m_s2\n0,0\n1,2\n'}];
  element('support-mass').value='70';element('support-label').value='Current recording';
  element('support-apply').dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(traces.length,1);assert.equal(traces[0].model.sourceLabel,'Current recording');
 } finally {globalThis.document=previous;}
});
