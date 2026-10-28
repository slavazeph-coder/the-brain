import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the production controller and navigation module. Only the lazy
// renderer import is replaced: geometry/rendering has its own integration
// tests, while these races must be deterministic without a browser or WebGL.
const sourceRoot = new URL('../../brainsnn-r3f-app/public/world/', import.meta.url);
const sessionSource = fs.readFileSync(new URL('sandbox-session.mjs',sourceRoot),'utf8').replace(/^export /gm,'');
const uiSource = fs.readFileSync(new URL('sandbox-ui.mjs',sourceRoot),'utf8')
  .replace(/^import .* from '\.\/sandbox-session\.mjs';\n/,'')
  .replace(/^export /gm,'')
  .replace("import('./street/workspace.mjs')",'loadStreetModule()');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes,no) => { resolve=yes; reject=no; });
  return {promise,resolve,reject};
}
async function flush() { for(let i=0;i<8;i++) await Promise.resolve(); }

class Element {
  constructor(id='') {
    this.id=id; this.dataset={}; this.hidden=false; this.disabled=false;
    this.value=''; this.textContent=''; this.children=[]; this.attributes={};
    this.listeners=new Map(); this.focused=false; this.selected=false;
  }
  addEventListener(type,fn,options={}) {
    if(options.signal?.aborted)return;
    const callbacks=this.listeners.get(type)||[];
    callbacks.push(fn); this.listeners.set(type,callbacks);
    options.signal?.addEventListener('abort',()=>this.removeEventListener(type,fn),{once:true});
  }
  removeEventListener(type,fn) {
    this.listeners.set(type,(this.listeners.get(type)||[]).filter(value=>value!==fn));
  }
  async emit(type,fields={}) {
    return Promise.all((this.listeners.get(type)||[]).map(fn=>fn({type,target:this,...fields})));
  }
  setAttribute(name,value) { this.attributes[name]=value; }
  getAttribute(name) { return this.attributes[name]; }
  replaceChildren(...nodes) { this.children=nodes; }
  append(...nodes) { this.children.push(...nodes); }
  focus() { this.focused=true; }
  select() { this.selected=true; }
  scrollIntoView() { this.scrolled=true; }
}

function harness({href='https://www.brainsnn.com/world/index.html',holdMount=false,clipboard}={}) {
  const ids=['street-workspace','street-mount','sandbox-loading','map-workspace','capture-progress','workspace',
    'fork','export','sandbox-scene','sandbox-return','sandbox-source-count','sandbox-context','sandbox-share',
    'world-title','provenance','sandbox-scene-state','sandbox-link','hero-street'];
  const elements=new Map(ids.map(id=>[id,new Element(id)]));
  const tabButtons=['capture','world','understand','test','evidence'].map(tab=>{
    const el=new Element('tab-'+tab);el.dataset.tab=tab;return el;
  });
  const document=new Element(); document.hidden=false;
  document.getElementById=id=>{assert.ok(elements.has(id),`Unexpected DOM id ${id}`);return elements.get(id);};
  document.querySelectorAll=selector=>{assert.equal(selector,'[data-tab]');return tabButtons;};
  document.createElement=tag=>new Element(tag);
  const location={href}, routeWrites=[], statuses=[], events=[], mapTabs=[], loads=[];
  let sourceCount=0, pauses=0, mountCalls=0, mountOptions;
  const activeCalls=[], toolCalls=[];
  const sceneState={objectCount:272,editRevision:7};
  const controller={
    disposed:0, active:false,
    setActive(active){this.active=active;activeCalls.push(active);},
    setTool(tool){toolCalls.push(tool);},
    getState(){return {...sceneState};},
    dispose(){this.disposed++;this.active=false;},
  };
  const mountGate=deferred();
  const module={mountStreetWorkspace:async(host,options)=>{
    assert.equal(host,elements.get('street-mount'));mountCalls++;mountOptions=options;
    return holdMount?mountGate.promise:controller;
  }};
  const map={name:'Original map',objects:[{id:'original',x:1}]};
  const worker={token:'private-session-token',client:{opaque:'existing client'}};
  const context=vm.createContext({URL,URLSearchParams,AbortController,document,location,
    history:{state:{},replaceState(state,unused,url){routeWrites.push(url);location.href=url;}},
    navigator:{clipboard:{writeText:clipboard||(()=>Promise.resolve())}},
    loadStreetModule(){const gate=deferred();loads.push(gate);return gate.promise;},
  });
  vm.runInContext(`${sessionSource}\n${uiSource}\nglobalThis.createTestUI=createSandboxUI;`,context);
  let ui;
  ui=context.createTestUI({
    setMapTab(tab){mapTabs.push(tab);ui?.observeMapTab(tab);},
    getMap:()=>map, getSourceCount:()=>sourceCount,
    pauseMap:()=>{pauses++;},
    status:(message,error=false)=>statuses.push({message,error}),
    event:(type,detail)=>events.push({type,detail}),
  });
  return {ui,elements,document,tabButtons,controller,activeCalls,toolCalls,sceneState,loads,mountGate,statuses,events,mapTabs,routeWrites,map,worker,
    resolveLoad(index=0){loads[index].resolve(module);},
    setSourceCount(value){sourceCount=value;},
    get pauses(){return pauses;},get mountCalls(){return mountCalls;},get mountOptions(){return mountOptions;},
  };
}

test('normal map startup is lazy and leaves existing scene and worker references alone', async()=>{
  const h=harness(), map=h.map, worker=h.worker, before=JSON.stringify({map,worker});
  await h.ui.start();
  assert.equal(h.loads.length,0); assert.deepEqual(h.mapTabs,['world']);
  assert.equal(h.ui.getState().workspace,'map');
  assert.equal(h.elements.get('street-workspace').hidden,true);
  assert.equal(h.elements.get('map-workspace').hidden,false);
  assert.equal(h.map,map); assert.equal(h.worker,worker); assert.equal(JSON.stringify({map,worker}),before);
});

test('Street → Capture → Street shares one mount and activates only the latest tool',async()=>{
  const h=harness();
  const first=h.ui.select('street','edit');
  await h.ui.select('capture');
  const latest=h.ui.select('street','simulate');
  assert.equal(h.loads.length,1);
  h.resolveLoad(); await Promise.all([first,latest]);
  assert.equal(h.mountCalls,1); assert.deepEqual(h.toolCalls,['simulate']);
  assert.deepEqual(h.activeCalls,[false,true]);
  assert.equal(h.ui.getState().workspace,'street'); assert.equal(h.ui.getState().tool,'simulate');
  assert.equal(h.elements.get('sandbox-scene-state').textContent,'272 objects · edit 7');
});

test('a street load finishing in Capture stays paused, and returning retains its edits',async()=>{
  const h=harness();const opening=h.ui.select('street','edit');
  await h.ui.handleTab('capture');h.resolveLoad();await opening;
  assert.equal(h.ui.getState().workspace,'capture');assert.equal(h.ui.getState().sceneId,null);
  assert.equal(h.controller.active,false);assert.deepEqual(h.toolCalls,[]);
  assert.equal(h.elements.get('sandbox-return').hidden,false);
  await h.elements.get('sandbox-return').emit('click');await flush();
  assert.equal(h.ui.getState().workspace,'street');assert.equal(h.ui.getState().street.editRevision,7);
  assert.equal(h.mountCalls,1);assert.equal(h.controller.active,true);
});

test('a late mount after disposal is destroyed and cannot update the active UI',async()=>{
  const h=harness({holdMount:true});const opening=h.ui.select('street','edit');
  h.resolveLoad();await flush();assert.equal(h.mountCalls,1);
  h.ui.dispose();assert.equal(h.mountOptions.signal.aborted,true);
  const statuses=h.statuses.length, text=h.elements.get('sandbox-scene-state').textContent;
  h.mountGate.resolve(h.controller);await opening;
  assert.equal(h.controller.disposed,1);assert.equal(h.controller.active,false);
  assert.deepEqual(h.toolCalls,[]);assert.equal(h.statuses.length,statuses);
  assert.equal(h.elements.get('sandbox-scene-state').textContent,text);
});

test('legacy asynchronous map updates cannot steal an active street tool',async()=>{
  const h=harness();const opening=h.ui.select('street','simulate');h.resolveLoad();await opening;
  h.ui.observeMapTab('evidence');h.ui.observeMapTab('capture');
  assert.equal(h.ui.getState().workspace,'street');assert.equal(h.ui.getState().tool,'simulate');
  assert.equal(h.elements.get('street-workspace').hidden,false);
  assert.equal(h.tabButtons.find(b=>b.dataset.tab==='test').getAttribute('aria-selected'),'true');
  assert.equal(h.tabButtons.find(b=>b.dataset.tab==='capture').getAttribute('aria-selected'),'false');
  await h.ui.handleTab('understand');
  assert.equal(h.ui.getState().tool,'evidence');assert.equal(h.toolCalls.at(-1),'evidence');
});

test('native tool changes synchronize the shell without echoing a second tool command',async()=>{
  const h=harness();const opening=h.ui.select('street','edit');h.resolveLoad();await opening;
  const commands=h.toolCalls.length;
  h.mountOptions.onToolChange('export');
  assert.equal(h.ui.getState().tool,'export');assert.equal(h.toolCalls.length,commands);
  assert.equal(h.tabButtons.find(b=>b.dataset.tab==='evidence').getAttribute('aria-selected'),'true');
  assert.equal(new URL(h.routeWrites.at(-1)).searchParams.get('tool'),'export');
  await h.ui.select('capture');const statusCount=h.statuses.length;
  h.mountOptions.onToolChange('simulate');h.mountOptions.onStatus('Late scene message');
  assert.equal(h.ui.getState().workspace,'capture');assert.equal(h.statuses.length,statusCount);
  h.ui.suspend();h.mountOptions.onToolChange('edit');assert.equal(h.ui.getState().workspace,'capture');
});

test('sharing disables immediately during the lazy load and recovers after a failed load',async()=>{
  const h=harness();const opening=h.ui.select('street');
  assert.equal(h.elements.get('sandbox-share').disabled,true);
  h.loads[0].reject(new Error('Offline'));await opening;
  assert.equal(h.elements.get('sandbox-share').disabled,false);
});

test('source count updates across modes without registering captures or changing street edits',async()=>{
  const h=harness();const opening=h.ui.select('street','edit');h.resolveLoad();await opening;
  assert.equal(h.elements.get('sandbox-source-count').hidden,true);
  h.setSourceCount(1);h.ui.sync();assert.equal(h.elements.get('sandbox-source-count').textContent,'1 local source');
  assert.equal(h.elements.get('sandbox-source-count').hidden,false);
  await h.ui.select('capture');h.setSourceCount(3);h.ui.sync();
  assert.equal(h.elements.get('sandbox-source-count').textContent,'3 local sources');
  assert.equal(h.ui.getState().sceneId,null);assert.equal(h.ui.getState().street.editRevision,7);
  assert.match(h.elements.get('sandbox-context').textContent,/street edits are kept/);
});

test('a failed module load can retry without duplicating a successful workspace',async()=>{
  const h=harness();const first=h.ui.select('street');h.loads[0].reject(new Error('Offline'));await first;
  assert.equal(h.mountCalls,0);assert.equal(h.elements.get('sandbox-loading').hidden,false);
  assert.equal(h.elements.get('sandbox-loading').children[1].textContent,'Retry street scene');
  const retry=h.ui.select('street');assert.equal(h.loads.length,2);h.resolveLoad(1);await retry;
  assert.equal(h.mountCalls,1);assert.equal(h.controller.active,true);
  await h.ui.select('map');await h.ui.select('street');assert.equal(h.mountCalls,1);
});

test('suspending keeps street inactive through visibility events until an explicit resume',async()=>{
  const h=harness();const opening=h.ui.select('street');h.resolveLoad();await opening;
  h.ui.suspend();assert.equal(h.controller.active,false);
  h.document.hidden=true;await h.document.emit('visibilitychange');
  h.document.hidden=false;await h.document.emit('visibilitychange');
  assert.equal(h.controller.active,false);
  h.ui.resume();await flush();assert.equal(h.controller.active,true);
  assert.equal(h.ui.getState().workspace,'street');
});

for(const failed of [false,true])test(`clipboard ${failed?'failure':'success'} after disposal cannot mutate status or reveal a stale link`,async()=>{
  const copy=deferred(),h=harness({clipboard:()=>copy.promise});await h.ui.start();
  h.elements.get('sandbox-link').hidden=true;
  const copying=h.elements.get('sandbox-share').emit('click');h.ui.dispose();
  const statusCount=h.statuses.length;
  if(failed)copy.reject(new Error('Permission dismissed'));else copy.resolve();
  await copying;
  assert.equal(h.statuses.length,statusCount);assert.equal(h.elements.get('sandbox-link').hidden,true);
});

test('disposed controls no longer select scenes, resume mounts or write route state',async()=>{
  const h=harness();await h.ui.start();h.ui.dispose();const writes=h.routeWrites.length;
  await h.elements.get('hero-street').emit('click');
  h.elements.get('sandbox-scene').value='street';await h.elements.get('sandbox-scene').emit('change');
  await h.ui.select('street');
  assert.equal(h.loads.length,0);assert.equal(h.routeWrites.length,writes);
});
