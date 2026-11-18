import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDrawingPreview,mountDrawingReview,MAX_DRAWING_PREVIEW_BYTES} from '../../brainsnn-r3f-app/public/world/drawing-review-ui.mjs';

const sceneSha='a'.repeat(64),cloudSha='b'.repeat(64),pdf={name:'drawing-set.pdf',sha256:'c'.repeat(64),size:100};
const scene=()=>({units:'m',componentGraph:{revision:3,sourceSha256:cloudSha}});
const args=()=>({scene:scene(),sceneSha,cloudSha,pdf});
const preview=()=>({schema:'brainsnn.drawing-preview.v1',metricVerified:false,physicalDimensionsVerified:false,paper:{width:420,height:297,units:'mm'},
  source:{sceneFileSha256:sceneSha,cloudPointsSha256:cloudSha,revision:3},pdf:{name:pdf.name,sha256:pdf.sha256,bytes:100},scaleSentence:'Scale estimated by the reconstruction model. Not verified.',
  sheets:[{number:'G-001',title:'Cover',scale:null,ops:[]},{number:'A-101',title:'Floor plan',scale:100,ops:[
    ['line',[10,10,100,10],.18,[0,0,0],null],['poly',[[10,10],[30,10],[30,30]],.18,[0,0,0],[1,1,1],[1,2]],
    ['text',[20,20],'<script>not HTML</script>',3,'HB','c',[0,0,0],0]]}]});
test('drawing source, component revision and PDF must all agree',()=>{
  assert.equal(validateDrawingPreview(preview(),args()).sheets.length,2);
  for(const change of [p=>p.source.sceneFileSha256='d'.repeat(64),p=>p.source.cloudPointsSha256='d'.repeat(64),p=>p.source.revision++,p=>p.pdf.sha256='d'.repeat(64),p=>p.pdf.bytes++,p=>p.metricVerified=true,p=>p.physicalDimensionsVerified=true]){
    const value=preview();change(value);assert.throws(()=>validateDrawingPreview(value,args()));
  }
  const source=args();source.scene.componentGraph.sourceSha256='d'.repeat(64);assert.throws(()=>validateDrawingPreview(preview(),source));
});
test('drawing primitives refuse executable tags, nonfinite values and unbounded detail',()=>{
  for(const op of [['image',[]],['text',[0,0],'text',3,'script','l',[0,0,0],0],['line',[0,0,Infinity,0],1,[0,0,0],null],['poly',Array(129).fill([0,0]),1,null,[1,1,1],null],['line',[0,0,1,1],1,[0,0,0],Array(17).fill(1)]]){
    const value=preview();value.sheets[0].ops=[op];assert.throws(()=>validateDrawingPreview(value,args()));
  }
  const large=preview();large.sheets[0].ops=Array(30001).fill(['line',[0,0,1,1],1,[0,0,0],null]);assert.throws(()=>validateDrawingPreview(large,args()),/detail limit/);
  const repeated=preview();repeated.sheets.push(repeated.sheets[0]);assert.throws(()=>validateDrawingPreview(repeated,args()),/sheet/);
});

class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.value='';this.classList={toggle:()=>{}};}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this[key]=value;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).buffer;
function harness(t,transport=async()=>bytes(preview()),artifacts=[pdf,{name:'drawing-preview.json',sha256:'d'.repeat(64),size:2000}]){
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');globalThis.document={createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t)};
  const host=new Element('div'),calls=[],downloads=[],context={scene:scene(),job:'e'.repeat(32),hash:cloudSha,artifacts,dirty:false,sourceClient:{previewArtifact:async(job,index,signal)=>{calls.push({job,index,signal});return transport(job,index,signal);}}};
  let current=true;const dispose=mountDrawingReview({host,context,sceneSha,isCurrent:()=>current,download:(...args)=>downloads.push(args)});
  t.after(()=>{dispose();if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  return {host,context,calls,downloads,dispose,node:id=>descendants(host).find(n=>n.id===id),invalidate:()=>current=false};
}
test('native sheet controls render text safely and download from the exact source job',async t=>{
  const h=harness(t,async(_job,index)=>index===1?bytes(preview()):new Uint8Array(100).buffer);await tick();
  assert.equal(h.node('drawing-review').dataset.state,'ready');assert.equal(h.node('drawing-sheet-select').value,'1');
  assert(descendants(h.node('drawing-sheet-preview')).some(n=>n.tagName==='text'&&n.textContent==='<script>not HTML</script>'));
  assert(!descendants(h.host).some(n=>['script','iframe','object','embed'].includes(n.tagName)));
  h.node('drawing-download-pdf').dispatchEvent(new Event('click'));await tick();
  assert.equal(h.downloads.length,1);assert.equal(h.downloads[0][0],'drawing-set.pdf');assert.equal(h.downloads[0][1].size,100);
  assert.deepEqual(h.calls.map(c=>[c.job.id,c.index]),[['e'.repeat(32),1],['e'.repeat(32),0]]);
  h.node('drawing-sheet-select').value='0';h.node('drawing-sheet-select').dispatchEvent(new Event('change'));
  assert.match(h.node('drawing-sheet-preview')['aria-label'],/G-001/);
});
test('older jobs remain usable without fabricating a drawing or sending requests',async t=>{
  const h=harness(t,()=>assert.fail('No request for missing drawings'),[]);await tick();
  assert.equal(h.node('drawing-review').dataset.state,'unavailable');assert.equal(h.calls.length,0);assert.equal(h.node('drawing-sheet-preview'),undefined);
});
test('preview byte limit is checked before downloading',async t=>{
  const h=harness(t,()=>assert.fail('No oversized download'),[pdf,{name:'drawing-preview.json',size:MAX_DRAWING_PREVIEW_BYTES+1}]);await tick();
  assert.equal(h.node('drawing-review').dataset.state,'refused');assert.equal(h.calls.length,0);
});
test('pending BIM edits immediately withdraw the old drawing view',async t=>{
  const h=harness(t);await tick();h.context.dirty=true;h.dispose.invalidate();
  assert.equal(h.node('drawing-review').dataset.state,'stale');assert.equal(h.node('drawing-sheet-preview'),undefined);assert(h.calls[0].signal.aborted);
});
test('scene replacement aborts pending preview and refuses late rendering',async t=>{
  let resolve;const h=harness(t,()=>new Promise(r=>resolve=r));h.invalidate();h.dispose();resolve(bytes(preview()));await tick();
  assert.equal(h.host.children.length,0);assert(h.calls[0].signal.aborted);
});
test('client replacement cannot silently redirect a retained PDF download',async t=>{
  const h=harness(t);await tick();h.context.sourceClient={previewArtifact:()=>assert.fail('No borrowed client')};h.node('drawing-download-pdf').dispatchEvent(new Event('click'));await tick();
  assert.equal(h.calls.length,1);assert.equal(h.downloads.length,0);
});
