/** Lifecycle regressions using an explicit DOM/transport fixture, not a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountOmniverse} from '../../brainsnn-r3f-app/public/world/omniverse-ui.mjs';

class Element extends EventTarget {
  constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.value='';}
  setAttribute(name,value){this[name]=value;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children.forEach(n=>n.parent=null);this.children=[];this.append(...nodes);}
  closest(tag){return this.tagName===tag?this:this.parent?.closest(tag)||null;}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const descendants=node=>[node,...node.children.flatMap(descendants)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<30;i++){if(predicate())return;await tick();}assert.fail('Expected transport stage was not reached.');}
function setup(t,transport){
  const originals=Object.fromEntries(['document','window','Option'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const win=new EventTarget(),dialog=new Element('dialog'),host=new Element('div');dialog.append(host);
  globalThis.window=win;globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  t.after(()=>{for(const [key,descriptor] of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const calls=[],errors=[],events=[];
  const client={caps:{engines:[{id:'omniverse-pack',available:true}]},upload:async()=> 'fixture-upload',request:async(path,options)=>{calls.push({path,...options});return transport(path,options);}};
  const dispose=mountOmniverse({host,context:{sourceClient:client,job:'source-job',cloud:{points:[]},artifacts:[{name:'arena-cloud.json',sha256:'b'.repeat(64)}]},sceneSha:'a'.repeat(64),isCurrent:()=>true,status:message=>errors.push(message),event:(...args)=>events.push(args)});
  t.after(dispose);
  const nodes=descendants(host),checks=nodes.filter(n=>n.type==='checkbox');checks.at(-1).checked=true;
  const build=nodes.find(n=>n.textContent==='Build Omniverse pack');
  return {host,dialog,win,build,calls,dispose,errors,events};
}
const abortable=signal=>new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});

test('dialog close cancels the exact active package once and removes the panel',async t=>{
  const h=setup(t,async(path,options)=>{
    if(path==='/v1/jobs')return {id:'pack-1',status:'queued'};
    if(path.endsWith('/start'))return abortable(options.signal);
    if(options.method==='DELETE')return {id:'pack-1',status:'cancelled'};
    throw Error('Unexpected fixture request');
  });
  const running=h.build.onclick();await until(()=>h.calls.some(c=>c.path.endsWith('/start')));
  h.dialog.dispatchEvent(new Event('close'));h.dispose();h.win.dispatchEvent(new Event('pagehide'));
  await running;await tick();
  assert.equal(h.host.children.length,0);
  assert.deepEqual(h.calls.filter(c=>c.method==='DELETE').map(c=>c.path),['/v1/jobs/pack-1']);
  assert.equal(h.events.length,0);
});

test('close during job creation retains its response and cancels without starting it',async t=>{
  const created=deferred();
  const h=setup(t,async(path,options)=>{
    if(path==='/v1/jobs'){assert.equal(options.signal,undefined);return created.promise;}
    if(options.method==='DELETE')return {id:'late-pack',status:'cancelled'};
    throw Error('A disposed panel must not start a job');
  });
  const running=h.build.onclick();await until(()=>h.calls.some(c=>c.path==='/v1/jobs'));
  h.dialog.dispatchEvent(new Event('close'));created.resolve({id:'late-pack',status:'queued'});
  await running;await tick();
  assert.deepEqual(h.calls.filter(c=>c.method==='DELETE').map(c=>c.path),['/v1/jobs/late-pack']);
  assert.equal(h.calls.some(c=>c.path.endsWith('/start')),false);
});

test('pagehide uses the same idempotent active-job cleanup',async t=>{
  const h=setup(t,async(path,options)=>{
    if(path==='/v1/jobs')return {id:'page-pack',status:'queued'};
    if(path.endsWith('/start'))return abortable(options.signal);
    if(options.method==='DELETE')return {status:'cancelled'};
    throw Error('Unexpected fixture request');
  });
  const running=h.build.onclick();await until(()=>h.calls.some(c=>c.path.endsWith('/start')));
  h.win.dispatchEvent(new Event('pagehide'));h.dialog.dispatchEvent(new Event('close'));
  await running;await tick();assert.equal(h.calls.filter(c=>c.method==='DELETE').length,1);
});

test('closing an unused panel creates no job and sends no cancellation',async t=>{
  const h=setup(t,()=>{throw Error('No network should occur');});
  h.dialog.dispatchEvent(new Event('close'));h.dispose();await tick();
  assert.equal(h.calls.length,0);assert.equal(h.host.children.length,0);
});

test('failed cancellation is surfaced instead of claimed as confirmed',async t=>{
  const h=setup(t,async(path,options)=>{
    if(path==='/v1/jobs')return {id:'failed-cancel',status:'queued'};
    if(path.endsWith('/start'))return abortable(options.signal);
    if(options.method==='DELETE')throw Error('fixture unavailable');
    throw Error('Unexpected fixture request');
  });
  const running=h.build.onclick();await until(()=>h.calls.some(c=>c.path.endsWith('/start')));
  h.dialog.dispatchEvent(new Event('close'));await running;await tick();
  assert.ok(h.errors.some(s=>s.includes('cancellation could not be confirmed')));
});
