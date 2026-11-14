/** scene.ifc to Fragments: the real converter on an IFC written by BrainSNN's own exporter, and the card that offers it.
 *  fixtures/authored-scene.ifc is ifc_export.write_ifc(metric_scene()) from tests/scene_compiler/test_ifc_export.py:
 *  an authored floor, wall, chair and one unseen-space volume, not a reconstruction. Not covered here: opening the file in Unreal Engine. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {ifcToFragments,describeFragments} from '../../brainsnn-r3f-app/src/world/fragments-export.js';
import {fragmentsReport,mountFragments} from '../../brainsnn-r3f-app/public/world/fragments-ui.mjs';

const app=new URL('../../brainsnn-r3f-app/',import.meta.url);
const wasm=dirname(createRequire(new URL('package.json',app)).resolve('web-ifc'))+'/';
const ifc=new Uint8Array(readFileSync(new URL('./fixtures/authored-scene.ifc',import.meta.url)));
const REPORT='scene.frag holds 4 elements: 1 floor slab, 1 piece of furniture, 1 wall, 1 volume marking space the scan never saw. All 4 keep their BrainSNN properties.';

test('an IFC from our exporter converts, and every element keeps its geometry and provenance',async()=>{
  const {bytes,summary}=await ifcToFragments(ifc,wasm);
  assert.ok(bytes.length>500&&bytes.length<ifc.length,'a compact binary file');
  assert.deepEqual(summary.byClass,{IFCSLAB:1,IFCWALL:1,IFCFURNITURE:1});
  assert.equal(summary.unknownVolumes,1,'unseen space stays a tagged volume, not an object');
  assert.equal(summary.elements,4);
  assert.equal(summary.withProvenance,4,'Pset_BrainSNN survives on every element');
  assert.deepEqual(summary.provenance,{unknown:1,observed:2,detected:1});
  assert.deepEqual(await describeFragments(bytes),summary,'reading the saved file again gives the same answer');
  assert.equal(fragmentsReport(summary),REPORT);
  await assert.rejects(()=>ifcToFragments(new Uint8Array(),wasm),/No IFC file/);
});

test('the report never claims more than was read back, and an empty file is refused',()=>{
  assert.equal(fragmentsReport({elements:26,byClass:{IFCWALL:8,IFCBUILDINGELEMENTPROXY:17,IFCSLAB:1},withProvenance:26}),
    'scene.frag holds 26 elements: 17 objects, 8 walls, 1 floor slab. All 26 keep their BrainSNN properties.');
  assert.match(fragmentsReport({elements:4,byClass:{IFCWALL:3,IFCROOF:1},withProvenance:3}),/3 walls, 1 roof\. 3 of 4 keep their BrainSNN properties; check the rest against scene\.ifc\.$/);
  assert.equal(fragmentsReport({elements:1,byClass:{IFCWALL:1},withProvenance:1}),'scene.frag holds 1 element: 1 wall. It keeps its BrainSNN properties.');
  for(const empty of [null,{},{elements:0,byClass:{}}])assert.throws(()=>fragmentsReport(empty),/no elements with geometry/);
});

class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};}
  setAttribute(name,value){this[name]=value;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
}
const all=node=>[node,...node.children.flatMap(all)];
function setup(t,{artifacts=[{name:'scene.json'},{name:'scene.ifc'}],load,current=()=>true}={}){
  const originals=Object.fromEntries(['document','URL'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const urls=[],revoked=[];
  globalThis.document={createElement:tag=>new Element(tag)};
  const RealURL=globalThis.URL;
  globalThis.URL=class extends RealURL{static createObjectURL(blob){urls.push(blob);return `blob:test-${urls.length}`;}static revokeObjectURL(url){revoked.push(url);}};
  t.after(()=>{for(const [key,descriptor] of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const host=new Element('div'),asked=[],events=[],statuses=[];
  const client={previewArtifact:async(job,index)=>{asked.push([job.id,index]);return ifc.buffer.slice(ifc.byteOffset,ifc.byteOffset+ifc.byteLength);}};
  const dispose=mountFragments({host,context:{sourceClient:client,job:'job-1',artifacts},isCurrent:current,status:m=>statuses.push(m),event:(name,data)=>events.push([name,data]),
    load:load||(async()=>({ifcToFragments})),wasmPath:wasm});
  const find=text=>all(host).find(n=>n.textContent===text);
  return {host,asked,events,statuses,urls,revoked,dispose,find};
}

test('the card converts this scene\'s own IFC on the device and offers the file only after reading it back',async t=>{
  const ui=setup(t);
  const button=ui.find('Make scene.frag');assert.ok(button,'the card is shown when the scene has an IFC');
  await button.onclick();
  assert.deepEqual(ui.asked,[['job-1',1]],'it fetched scene.ifc, by its place in this job\'s artifacts');
  const link=ui.find('Download scene.frag');
  assert.equal(link.download,'scene.frag');assert.equal(link.href,'blob:test-1');assert.equal(ui.urls[0].size>500,true);
  assert.ok(all(ui.host).some(n=>n.textContent===REPORT));
  assert.equal(ui.events[0][0],'fragments_file_created');assert.equal(ui.events[0][1].elements,4);
  ui.dispose();
  assert.deepEqual(ui.revoked,['blob:test-1']);assert.equal(ui.host.children.length,0,'closing the scene removes the card and frees the file');
});

test('no IFC means no card, and a failed or stale conversion never offers a file',async t=>{
  assert.equal(setup(t,{artifacts:[{name:'scene.json'}]}).host.children.length,0);
  const failing=setup(t,{load:async()=>({ifcToFragments:async()=>({bytes:new Uint8Array([1]),summary:{elements:0,byClass:{}}})})});
  await failing.find('Make scene.frag').onclick();
  assert.equal(failing.find('Download scene.frag'),undefined);
  assert.ok(all(failing.host).some(n=>/^scene\.frag was not made: The converted file has no elements/.test(n.textContent||'')));
  let current=true;const stale=setup(t,{current:()=>current,load:async()=>{current=false;return {ifcToFragments};}});
  await stale.find('Make scene.frag').onclick();
  assert.equal(stale.find('Download scene.frag'),undefined,'another scene was opened while this one converted');
  assert.equal(stale.urls.length,0);
});
