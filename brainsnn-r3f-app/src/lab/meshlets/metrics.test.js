import assert from 'node:assert/strict';
import { it } from '../../test/tinyVitest.js';
import { frameSummary, inspectGlb, receipt } from './metrics.mjs';
function glb(json) {
  const text=JSON.stringify(json),bytes=new TextEncoder().encode(text.padEnd(Math.ceil(text.length/4)*4,' '));
  const buffer=new ArrayBuffer(20+bytes.length),view=new DataView(buffer);
  [0x46546c67,2,buffer.byteLength,bytes.length,0x4e4f534a].forEach((n,i)=>view.setUint32(i*4,n,true));
  new Uint8Array(buffer,20).set(bytes);return buffer;
}
it('meshlets cadence measures intervals and does not invent a GPU benchmark',()=>{
  assert.deepEqual(frameSummary([]),{frames:0,fps:null,medianMs:null,p95Ms:null});
  assert.equal(frameSummary([10,10,30,NaN,-1]).fps,60);
  assert.equal(frameSummary([10,10,30]).p95Ms,30);
  const r=receipt({mode:'webgl',source:{kind:'fixture'},counts:{},samples:[20,30],viewport:{},settings:{}});
  assert.equal(r.cadence.fps,40);assert.deepEqual(r.frameIntervalsMs,[20,30]);
  assert.equal(r.physicalAccuracyValidated,false);assert.match(r.timingScope,/not GPU execution/);
});
it('local GLB preflight blocks remote resources before the loader can fetch',()=>{
  assert.equal(inspectGlb(glb({asset:{version:'2.0'}})).asset.version,'2.0');
  for(const uri of ['https://example.com/a.bin','//example.com/a.png','texture.png','data:text/html;base64,AAA'])
    assert.throws(()=>inspectGlb(glb({images:[{uri}]})),/External/);
  assert.throws(()=>inspectGlb(glb({extensionsRequired:['KHR_draco_mesh_compression']})),/uncompressed/);
  assert.throws(()=>inspectGlb(glb({accessors:[{count:10**9}]})),/accessor/);
  const bad=glb({});new DataView(bad).setUint32(8,100000,true);assert.throws(()=>inspectGlb(bad),/complete GLB/);
});
