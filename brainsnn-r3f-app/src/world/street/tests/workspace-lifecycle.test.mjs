import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWorld,createSimulation} from '../../../../public/world/street/sim-core.mjs';

const moduleURL=new URL('../../../../public/world/street/workspace.mjs',import.meta.url);
const scene=JSON.parse(fs.readFileSync(new URL('../../../../public/world/street/assets/scene.json',import.meta.url),'utf8'));
const source=fs.readFileSync(moduleURL,'utf8').replace(/^import .*;\n/gm,'').replace('export async function mountStreetWorkspace','async function mountStreetWorkspace').replaceAll('import.meta.url',JSON.stringify(moduleURL.href));

function fixture({failOnce=false,holdScene=false}={}){
  const frames=new Map(),timers=new Map(),views=[],messages=[],changes=[],toolChanges=[],fetches=[],storage=new Map();
  let serial=0,releaseScene;
  class Element extends EventTarget{
    constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.hidden=false;this.open=false;this.children=[];this.dataset={};this.style={};this.value='';this.textContent='';this.innerHTML='';this.files=[];this.attrs={};const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),toggle:(v,on)=>on?classes.add(v):classes.delete(v)};}
    setAttribute(k,v){this.attrs[k]=v;}
    showModal(){this.open=true;}
    close(){if(!this.open)return;this.open=false;queueMicrotask(()=>this.dispatchEvent(new Event('close')));}
    focus(){root.activeElement=this;}
    click(){}
    remove(){}
    scrollIntoView(){}
    closest(){return null;}
    getBoundingClientRect(){return {left:0,top:0,right:1100,bottom:700,width:1100,height:700};}
  }
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};
  const root={childElementCount:0,activeElement:new Element(),querySelector:node,querySelectorAll:()=>[],replaceChildren(...v){this.childElementCount=v.length;}};
  class Host extends Element{attachShadow(){this.shadowRoot=root;root.host=this;return root;}}
  const container=new Host();
  class View{
    constructor(){views.push(this);this.renderMode='software';this.active=true;this.disposed=false;this.updates=[];}
    updateObject(id,patch){this.updates.push({id,patch:structuredClone(patch)});}
    setActive(v){this.active=v;}
    setColliders(){} setPlayerPose(){} setRobotPose(){} setPath(){} setCameraMode(){} resetCamera(){} select(){} focusObject(){} setLayerVisible(){} setShowColliders(){} setSourceView(){} resize(){}
    dispose(){this.disposed=true;this.active=false;}
  }
  const document=new EventTarget();document.hidden=false;document.createElement=tag=>tag==='template'?{content:{cloneNode(){return {};}},innerHTML:''}:new Element(tag);
  const window=new EventTarget();
  const context={SceneView:View,createWorld,createSimulation,structuredClone,console,Map,Set,Math,Number,JSON,Date,URL,Blob,HTMLElement:Host,AbortController,document,window,CSS:{escape:s=>s},matchMedia:()=>({matches:false}),localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout:(fn)=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),fetch:async(url,options)=>{
    fetches.push(String(url));options?.signal?.throwIfAborted();
    if(failOnce){failOnce=false;return {ok:false,text:async()=>''};}
    if(String(url).endsWith('/scene.json'))return {ok:true,json:async()=>{if(holdScene)await new Promise(resolve=>{releaseScene=resolve;});return structuredClone(scene);}};
    return {ok:true,text:async()=>''};
  }};
  vm.createContext(context);new vm.Script(source+'\nglobalThis.mount=mountStreetWorkspace;',{filename:'actual-native-workspace.mjs'}).runInContext(context);
  const options={onStatus:(...a)=>messages.push(a),onChange:s=>changes.push(s),onToolChange:tool=>toolChanges.push(tool)};
  return {container,root,node,nodes,views,frames,timers,storage,document,window,fetches,messages,changes,toolChanges,
    mount:opts=>context.mount(container,{...options,...opts}),release:()=>releaseScene?.(),
    fireKey(key,{inside=true,input=false}={}){root.activeElement=input?Object.assign(new Element(),{tagName:'INPUT'}):new Element('canvas');const e=new Event('keydown',{cancelable:true});Object.defineProperty(e,'key',{value:key});e.composedPath=()=>inside?[container]:[];window.dispatchEvent(e);return e.defaultPrevented;},
    tick(time){const queue=[...frames.values()];frames.clear();queue.forEach(fn=>fn(time));},
  };
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('mount owns a native root, module-relative assets and one paused/resumable frame loop',async()=>{
  const f=fixture(),w=await f.mount();
  assert.equal(w.getState().sceneId,'green-gardens');assert.equal(w.getState().objectCount,272);
  assert.equal(f.views.length,1);assert.equal(f.frames.size,1);
  assert(f.fetches.every(url=>url.startsWith(new URL('./',moduleURL).href)));
  w.setTool('export');assert(f.node('#export-dialog').open);
  w.setActive(false);assert.equal(f.frames.size,0);assert.equal(f.views[0].active,false);assert.equal(f.node('#export-dialog').open,false);
  w.setTool('export');assert.equal(f.node('#export-dialog').open,false);
  w.setActive(true);w.setActive(true);assert.equal(f.frames.size,1);assert.equal(f.views[0].active,true);
  w.dispose();assert.equal(f.frames.size,0);assert.equal(f.views[0].disposed,true);assert.equal(f.root.childElementCount,0);
  w.dispose();assert.equal(f.frames.size,0);
});

test('walking shortcuts only act inside the focused active scene and ignore text inputs',async()=>{
  const f=fixture(),w=await f.mount();f.node('#camera-walk').onclick();
  assert.equal(f.fireKey('W',{inside:false}),false);assert.equal(f.fireKey('W',{input:true}),false);
  assert.equal(f.fireKey('W'),true);f.tick(1000);const before=w.getState().simulation.player.position;f.tick(1100);const after=w.getState().simulation.player.position;
  assert(Math.hypot(after.x-before.x,after.z-before.z)>.24);
  w.setActive(false);assert.equal(f.fireKey('W'),false);w.dispose();assert.equal(f.fireKey('W'),false);
});

test('document hiding pauses simulation and rendering without dropping edits',async()=>{
  const f=fixture(),w=await f.mount();f.node('#robot-toggle').onclick();assert(w.getState().simulation.running);
  f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.frames.size,0);assert.equal(f.views[0].active,false);assert.equal(w.getState().simulation.running,false);
  f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.frames.size,1);assert.equal(w.getState().simulation.running,false);
  w.dispose();
});

test('failed mount cleans the root and can retry in the same container',async()=>{
  const f=fixture({failOnce:true});await assert.rejects(f.mount(),/could not load/);assert.equal(f.root.childElementCount,0);assert.equal(f.frames.size,0);
  const w=await f.mount();assert.equal(w.getState().objectCount,272);await assert.rejects(f.mount(),/already mounted/);w.dispose();
});

test('abort during data loading creates no late renderer and leaves a reusable container',async()=>{
  const f=fixture({holdScene:true}),abort=new AbortController(),pending=f.mount({signal:abort.signal});
  await new Promise(resolve=>setImmediate(resolve));abort.abort();f.release();await assert.rejects(pending);
  assert.equal(f.views.length,0);assert.equal(f.frames.size,0);assert.equal(f.root.childElementCount,0);
});

test('external abort disposes an already mounted component and cancels subscriptions',async()=>{
  const f=fixture(),abort=new AbortController(),w=await f.mount({signal:abort.signal});abort.abort();
  assert.equal(f.views[0].disposed,true);assert.equal(f.frames.size,0);assert.equal(f.root.childElementCount,0);assert.equal(f.fireKey('/'),false);w.dispose();
});

test('late imports cannot edit disposed scenes, and newer imports supersede older reads',async()=>{
  const f=fixture(),w=await f.mount(),input=f.node('#import-scene'),item=scene.objects.find(o=>o.editableProperties?.includes('material.color'));
  const payload=color=>JSON.stringify({schemaVersion:scene.schemaVersion,version:scene.version,edits:{[item.id]:{material:{color}}}});
  const slow=deferred();input.files=[{size:100,text:()=>slow.promise}];const first=input.onchange({target:input});
  input.files=[{size:100,text:async()=>payload([.1,.2,.3])}];await input.onchange({target:input});
  slow.resolve(payload([.9,.9,.9]));await first;
  assert.deepEqual(Array.from(w.getManifest().objects.find(o=>o.id===item.id).material.color),[.1,.2,.3]);
  const stale=deferred();input.files=[{size:100,text:()=>stale.promise}];const late=input.onchange({target:input}),count=f.views[0].updates.length;w.dispose();stale.resolve(payload([.5,.5,.5]));await late;
  assert.equal(f.views[0].updates.length,count);assert.equal(f.frames.size,0);
});


test('internal tools notify once without resetting playback; parent setTool is silent',async()=>{
  const f=fixture(),w=await f.mount();
  f.node('#tab-evidence').onclick();assert.deepEqual(f.toolChanges,['evidence']);assert.equal(w.getState().tool,'evidence');
  f.node('#tab-objects').onclick();assert.deepEqual(f.toolChanges,['evidence','edit']);
  w.setTool('simulate');assert.deepEqual(f.toolChanges,['evidence','edit']);
  f.node('#robot-toggle').onclick();assert(w.getState().simulation.running);
  const frames=[...f.frames.keys()];
  f.node('#tab-evidence').onclick();assert(w.getState().simulation.running);assert.deepEqual([...f.frames.keys()],frames);
  f.node('#export-open').onclick();assert.equal(w.getState().tool,'export');assert.equal(f.toolChanges.at(-1),'export');
  f.node('#export-close').onclick();await Promise.resolve();assert.equal(w.getState().tool,'evidence');assert.equal(f.toolChanges.at(-1),'evidence');assert(w.getState().simulation.running);
  const count=f.toolChanges.length;
  w.setTool('edit');w.setTool('export');w.setTool('simulate');await Promise.resolve();assert.equal(f.toolChanges.length,count);assert.equal(w.getState().tool,'simulate');
  w.dispose();
});

test('export close restores each previous tool and inactive closing cannot reactivate parent',async()=>{
  const f=fixture(),w=await f.mount();
  for(const tool of ['edit','evidence','simulate']){
    w.setTool(tool);w.setTool('export');f.node('#export-dialog').close();await Promise.resolve();
    assert.equal(w.getState().tool,tool);assert.equal(f.toolChanges.at(-1),tool);
  }
  w.setTool('export');const count=f.toolChanges.length;w.setActive(false);await Promise.resolve();
  assert.equal(f.toolChanges.length,count);assert.equal(w.getState().tool,'simulate');assert.equal(f.frames.size,0);
  w.dispose();
});
