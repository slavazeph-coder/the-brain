import test from 'node:test';
import assert from 'node:assert/strict';
import {createBimWorkflow} from '../../brainsnn-r3f-app/public/world/bim-workflow-ui.mjs';
import {pointsSHA256} from '../../brainsnn-r3f-app/public/world/dimension-review.mjs';
import {STRIDE} from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

// The workflow only reads field values and writes escaped HTML. A tiny document
// keeps these contract checks independent of a browser or a WebGL renderer.
class Element {
  value=''; checked=false; focused=false; #html=''; #text='';
  set innerHTML(value){this.#html=value;this.#text='';}
  get innerHTML(){return this.#html;}
  set textContent(value){this.#text=value;this.#html='';}
  get textContent(){return this.#text;}
  replaceChildren(){this.#html='';this.#text='';}
  focus(){this.focused=true;}
}
function fixture({thinned=false}={}) {
  const count=thinned?50001:4, points=new Float32Array(count*STRIDE), rows=[];
  for(let i=0;i<count;i++) {
    const xyz=thinned?[i%250/1000,0,Math.floor(i/250)/1000]:[[0,0,0],[4,0,0],[0,0,3],[4,0,3]][i];
    points.set([...xyz,.01,.01,.01,0,0,0,1,0,0,0,1],i*STRIDE);
    if(!thinned||i%2===0)rows.push([...xyz.map((_,j)=>points[i*STRIDE+j]),0,0,0]);
  }
  return {
    source:{visual:{points}},
    cloud:{source:'reference-capture.ply',units:'m',coordinateFrame:'right-handed-y-up',points:rows,
      scale:{source:'user-measured',metresPerUnit:1,selfReported:true,verified:false},
      fromSource:[[1,0,0,0],[0,1,0,0],[0,0,1,0]],
      provenance:{totalPoints:count,keptPoints:rows.length,outliersDropped:0,thinned}},
    scale:{metresPerUnit:1,distance:4,span:4},
    calibration:{picks:thinned?[0,4]:[0,1]},
  };
}
function harness(t,options={}) {
  const data=fixture(options), elements=new Map(), oldDocument=globalThis.document;
  globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;});
  const field=id=>globalThis.document.getElementById(id), calls={status:[],event:[],markers:[],recompile:[]};
  let activeCloud=data.cloud;
  const context={source:data.source,scale:data.scale,calibration:data.calibration,entry:{dimension_checks:true,bim_review:true}};
  const workflow=createBimWorkflow({status:(...args)=>calls.status.push(args),event:(...args)=>calls.event.push(args),
    onRender(){},onMarkers:p=>calls.markers.push([...p]),makeCloud:()=>structuredClone(activeCloud),getContext:()=>context,
    onRecompile:async(...args)=>calls.recompile.push(args),download(){}});
  function fillReading(label='Independent clear span') {
    for(const [id,value] of Object.entries({'dimension-label':label,'dimension-distance':'3','dimension-uncertainty':'.005','dimension-method':'tape','dimension-instrument':'Reference tape','dimension-date':'2026-10-24'}))field(id).value=value;
  }
  const scene={units:'m',walls:[{name:'Wall_A',centre:[2,1.5,0],size:[4,3,.2],yaw_degrees:0}]};
  async function show(patch={}) {await workflow.showScene({scene,cloud:data.cloud,job:'previous-metric-job',artifacts:[],sourceClient:{},sceneSha:'a'.repeat(64),...patch});}
  return {workflow,context,data,calls,field,fillReading,scene,show,setCloud:c=>{activeCloud=c;}};
}
async function reportFor(cloud,{label='Visible span',instrument='Reference tape'}={}) {
  const distance=Math.hypot(...cloud.points[0].slice(0,3).map((v,j)=>v-cloud.points[1][j]));
  return {schema:'brainsnn.scene-measurements.v1',units:'m',coordinateFrame:'right-handed-y-up',metric_verified:false,certified:false,
    status:'within-requested-tolerance',statusScope:'held-out-point-pairs-only',
    source:{cloudPointsSha256:await pointsSHA256(cloud),sceneCanonicalSha256:'c'.repeat(64)},sourceFiles:{scene:{sha256:'a'.repeat(64)}},
    tolerance:{absoluteMeters:.05,relative:.02},checks:[{id:'held-one',label,role:'held-out',pointIndices:[0,1],distanceMeters:distance,
      cloudDistanceMeters:distance,signedErrorMeters:0,absoluteErrorMeters:0,relativeError:0,requestedToleranceMeters:Math.max(.05,.02*distance),
      withinRequestedTolerance:true,uncertaintyMeters:.005,method:'tape',instrument,measuredOn:'2026-10-24'}],
    summary:{calibrationCount:0,heldOutCount:1,heldOutWithinTolerance:1},dimensions:[]};
}

test('the calibration pair cannot be relabelled as an independent check',async t=>{
  const h=harness(t);h.workflow.startPicking();h.workflow.pick(1);h.workflow.pick(0);h.fillReading();
  await assert.rejects(h.workflow.addReading(),/pair set the scale/);
  assert.equal(h.workflow.readingCount,0);
  assert.equal((await h.workflow.attach(structuredClone(h.data.cloud))).measurementChecks,undefined);
});

test('independent viewer picks retain cloud indices after point thinning',async t=>{
  const h=harness(t,{thinned:true});h.workflow.startPicking();h.workflow.pick(2);h.workflow.pick(6);h.fillReading();
  h.field('dimension-distance').value='.004';await h.workflow.addReading();
  const result=await h.workflow.attach(structuredClone(h.data.cloud));
  assert.equal(result.measurementChecks.schema,'brainsnn.dimension-checks.v1');
  assert.equal(result.measurementChecks.cloudPointsSha256,await pointsSHA256(result));
  assert.deepEqual(result.measurementChecks.checks[0].pointIndices,[1,3]);
  assert.equal(result.measurementChecks.checks[0].role,'held-out');
  assert.equal(result.measurementChecks.checks[0].distanceMeters,.004);
  assert.equal(h.workflow.readingCount,1);assert.deepEqual(h.calls.markers.at(-1),[]);
  h.workflow.startPicking();h.workflow.pick(6);h.workflow.pick(2);h.fillReading();
  await assert.rejects(h.workflow.addReading(),/same point pair/);
});

test('dimensional reports require the exact scene artifact and escape worker strings',async t=>{
  const h=harness(t),unsafe='<img src=x onerror=alert(1)> & "reference"';
  const report=await reportFor(h.data.cloud,{label:unsafe,instrument:unsafe});
  h.scene.walls[0].name='<script>wall</script>';
  await h.show({report,artifacts:[{name:'<img src=x>.ifc'}]});
  const html=h.field('scene-measurement-report').innerHTML;
  assert.match(html,/Held-out spans meet your tolerance/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;reference&quot;/);
  assert.ok(!html.includes(unsafe));assert.ok(!html.includes('<img'));
  assert.match(h.field('scene-bim-review').innerHTML,/&lt;script&gt;wall&lt;\/script&gt;/);
  assert.match(h.field('scene-bim-files').innerHTML,/&lt;img src=x&gt;\.ifc/);
  await h.show({report,sceneSha:'b'.repeat(64)});
  assert.match(h.field('scene-measurement-report').textContent,/another scene artifact/);
  assert.equal(h.field('scene-measurement-report').innerHTML,'');
});

test('reviewed recompilation rejects unrelated geometry, source labels and scale metadata',async t=>{
  const h=harness(t);
  for(const mutate of [c=>c.points[0][0]+=.1,c=>c.source='other-capture.ply',c=>c.scale.metresPerUnit=2]) {
    await h.show();h.field('bim-recompile-consent').checked=true;
    const unrelated=structuredClone(h.data.cloud);mutate(unrelated);h.setCloud(unrelated);
    await assert.rejects(h.workflow.recompile(),/active reconstruction or scale differs/);
  }
  assert.equal(h.calls.recompile.length,0);
});

test('building downloads expose actual destination files and retain their manifest indices',async t=>{
  const h=harness(t);
  await h.show({artifacts:[{name:'camera-frames.json'},{name:'scene.ifc'},
    {name:'xactimate-underlay.png'},{name:'building-schedule.csv'},
    {name:'building-handoff.json'},{name:'BUILDING-IMPORT.txt'},{name:'unrelated.png'}]});
  const html=h.field('scene-bim-files').innerHTML;
  for(const index of [1,2,3,4,5])assert.match(html,new RegExp(`data-scene-download="${index}"`));
  assert.ok(!html.includes('data-scene-download="0"')&&!html.includes('data-scene-download="6"'));
  assert.match(html,/linking keeps the source model read-only/);
  assert.match(html,/Import Underlay Image/);
  assert.match(html,/then trace and review the rooms/);
  assert.ok(!/native RVT|ESX download|direct Xactimate import/i.test(html));
  await h.show({artifacts:[{name:'scene.glb'}]});
  assert.ok(!h.field('scene-bim-files').innerHTML.includes('Open xactimate-underlay.png'));
});

test('opening review is explicit, recompilation retains the previous job, and removal clears original review',async t=>{
  const h=harness(t);
  h.data.cloud.bimReview={schema:'brainsnn.bim-review.v1',cloudPointsSha256:await pointsSHA256(h.data.cloud),openings:[{
    id:'existing-opening',hostWall:'Wall_A',offsetMeters:.1,widthMeters:.9,heightMeters:2,sillMeters:0,kind:'opening',reviewed:true,
    host:{centre:[2,1.5,0],size:[4,3,.2],yaw_degrees:0}}]};
  await h.show();
  for(const [id,value] of Object.entries({'bim-host-wall':'0','bim-offset':'1.2','bim-width':'.9','bim-height':'2','bim-sill':'0','bim-kind':'door'}))h.field(id).value=value;
  assert.throws(()=>h.workflow.addOpening(),/Confirm the opening/);
  h.field('bim-reviewed').checked=true;h.workflow.addOpening();
  await assert.rejects(h.workflow.recompile(),/Approve uploading/);
  h.field('bim-recompile-consent').checked=true;await h.workflow.recompile();
  const [cloud,source,entry,previousJob]=h.calls.recompile[0];
  assert.equal(previousJob,'previous-metric-job');assert.equal(source,h.context.source);assert.equal(entry,h.context.entry);
  assert.equal(cloud.bimReview.openings.length,2);assert.equal(cloud.bimReview.openings[1].reviewed,true);
  assert.deepEqual(cloud.bimReview.openings[1].host,{centre:[2,1.5,0],size:[4,3,.2],yaw_degrees:0});
  assert.equal(cloud.bimReview.openings[1].kind,'door');
  assert.equal(h.data.cloud.bimReview.openings.length,1,'local edits do not mutate the original worker cloud');
  h.workflow.removeOpening(0);h.workflow.removeOpening(0);h.field('bim-recompile-consent').checked=true;
  await h.workflow.recompile();
  assert.equal(h.calls.recompile[1][3],'previous-metric-job');
  assert.equal(Object.hasOwn(h.calls.recompile[1][0],'bimReview'),false);
});
