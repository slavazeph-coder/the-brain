import test from 'node:test';
import assert from 'node:assert/strict';
import {demoRequest,mountDemoReplay} from '../../brainsnn-r3f-app/public/world/demo-replay-ui.mjs';

const options=()=>({artifacts:[{name:'reconstruction.json',sha256:'a'.repeat(64)}],title:'A real run',credit:'Owner-provided footage',captureKind:'unknown',ending:'reconstruction',reviewed:true});
test('request binds the exact source and preserves unverified capture type',()=>{
  const value=demoRequest(options());assert.equal(value.source_sha256,'a'.repeat(64));assert.equal(value.capture_kind,'unknown');assert.equal(value.reviewed,true);
  assert.equal(Object.keys(value).length,8);
});
for(const [name,change] of Object.entries({unreviewed:o=>o.reviewed=false,credit:o=>o.credit='',control:o=>o.title='bad\ncaption',hash:o=>o.artifacts[0].sha256='wrong',ending:o=>o.ending='bim',kind:o=>o.captureKind='survey'})){
  test(`refuses ${name}`,()=>{const o=options();change(o);assert.throws(()=>demoRequest(o));});
}
class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.dataset={};this.value='';}
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children.forEach(n=>n.parent=null);this.children=[];this.append(...nodes);}
  setAttribute(k,v){this[k]=v;}
  closest(tag){return this.tagName===tag?this:this.parent?.closest(tag)??null;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
}
const descendants=n=>[n,...n.children.flatMap(descendants)];
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(check){for(let i=0;i<30;i++){if(check())return;await tick();}assert.fail('Expected request not observed');}
function harness(t,transport,{visitor=false}={}){
  const originals=Object.fromEntries(['window','document','Option'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const win=new EventTarget(),dialog=new Element('dialog'),host=new Element('div');dialog.append(host);
  globalThis.window=win;globalThis.document={createElement:t=>new Element(t),body:new Element('body')};
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  let cleanup=()=>{};
  t.after(()=>{cleanup();for(const [k,d] of Object.entries(originals)){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}});
  const calls=[],events=[],errors=[];
  const client={caps:{owner_id:visitor?'site-visitors':'operator',engines:[{id:'demo-replay',available:true}]},upload:async(f,k)=>{calls.push({kind:k,file:JSON.parse(await f.text())});return 'upload';},request:async(p,o)=>{calls.push({path:p,...o});return transport(p,o);}};
  let current=true;const dispose=mountDemoReplay({host,context:{sourceClient:client,job:'a'.repeat(32),artifacts:options().artifacts},isCurrent:()=>current,status:s=>errors.push(s),event:(...a)=>events.push(a)});
  cleanup=dispose;
  const nodes=descendants(host),inputs=nodes.filter(n=>n.type==='text');if(inputs.length){inputs[1].value='Authored test footage';nodes.find(n=>n.type==='checkbox').checked=true;nodes.find(n=>n.tagName==='select').value='unknown';const selects=nodes.filter(n=>n.tagName==='select');selects[1].value='reconstruction';}
  return {host,dialog,win,calls,events,errors,dispose,build:nodes.find(n=>n.textContent==='Create demo videos'),invalidate:()=>current=false};
}
test('visitor credentials do not expose a private video export',t=>{
  const h=harness(t,()=>assert.fail('No visitor network'),{visitor:true});assert.equal(h.host.children.length,0);
});
test('closing during creation retains the returned id and cancels without start',async t=>{
  const created=deferred();
  const h=harness(t,async(p,o)=>{if(p==='/v1/jobs')return created.promise;if(o.method==='DELETE')return {status:'cancelled'};assert.fail('Unexpected request');});
  const running=h.build.onclick();await until(()=>h.calls.some(c=>c.path==='/v1/jobs'));
  h.dialog.dispatchEvent(new Event('close'));created.resolve({id:'b'.repeat(32),status:'prepared'});await running;
  assert.deepEqual(h.calls.filter(c=>c.method==='DELETE').map(c=>c.path),['/v1/jobs/'+'b'.repeat(32)]);
  assert.equal(h.calls.some(c=>c.path?.endsWith('/start')),false);assert.equal(h.events.length,0);
});
test('pagehide cancels an active renderer once',async t=>{
  const h=harness(t,async(p,o)=>{if(p==='/v1/jobs')return {id:'c'.repeat(32),status:'prepared'};if(p.endsWith('/start'))return new Promise((r,j)=>o.signal.addEventListener('abort',()=>j(o.signal.reason),{once:true}));if(o.method==='DELETE')return {};assert.fail('Unexpected request');});
  const running=h.build.onclick();await until(()=>h.calls.some(c=>c.path?.endsWith('/start')));h.win.dispatchEvent(new Event('pagehide'));h.dispose();await running;assert.equal(h.calls.filter(c=>c.method==='DELETE').length,1);
});
test('unreviewed export sends no upload',async t=>{
  const h=harness(t,()=>assert.fail('No network'));descendants(h.host).find(n=>n.type==='checkbox').checked=false;
  await h.build.onclick();assert.equal(h.calls.length,0);assert.match(h.errors[0],/approve/);
});
