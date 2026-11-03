// Real production HTTP + browser rendering on authored geometry only.
// CI WebGPU uses software Vulkan. This is not an RTX/GB10 speed benchmark.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { inspectGlb } from '../src/lab/meshlets/metrics.mjs';
const port=Number(process.env.MESHLETS_TEST_PORT||4197),base=`http://127.0.0.1:${port}`;
const out=new URL('../../output/playwright/meshlets/',import.meta.url);await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['dist/server.cjs'],{env:{...process.env,NODE_ENV:'production',PORT:String(port)},stdio:['ignore','pipe','pipe']});
let serverLog='';for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{serverLog=(serverLog+b).slice(-20000);});
const browsers=[];let activePage=null;const consoleLog=[];
// Minimal native control separates a runner/driver failure from our app lifecycle.
await build({stdin:{contents:`
  import * as T from 'three-meshlets/webgpu';
  import {MeshletDrawingPipeline} from 'three-meshlets/addons/pipelines/MeshletDrawingPipeline.js';
  const r=new T.WebGPURenderer({antialias:false});await r.init();r.setSize(400,300);document.body.append(r.domElement);
  const p=new MeshletDrawingPipeline({occlusionCulling:false});r.drawingPipeline=p;
  const s=new T.Scene(),c=new T.PerspectiveCamera(50,4/3,.1,100);c.position.z=4;
  s.add(new T.Mesh(new T.SphereGeometry(1,32,24),new T.MeshBasicNodeMaterial({color:0x68eaff})));
  window.control={pipeline:p,renderer:r,error:null};r.backend.device.lost.then(i=>window.control.error=i.reason+': '+i.message);
  r.backend.device.addEventListener('uncapturederror',e=>window.control.error=e.error.message);
  await r.compileAsync(s,c);r.setAnimationLoop(()=>r.render(s,c));
`,resolveDir:process.cwd(),sourcefile:'authored-meshlet-control.js'},alias:{three:'three-meshlets'},
  outfile:'dist/lab/meshlets/runtime/control.js',bundle:true,format:'esm',target:'es2022',logLevel:'warning'});
await writeFile('dist/lab/meshlets/runtime/control.html','<!doctype html><title>Authored WebGPU control</title><script type="module" src="./control.js"></script>');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const glb=()=>{
  const bin=new Float32Array([-1,0,0,1,0,0,0,2,0,0,0,1,0,0,1,0,0,1]);
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'evidence_wall_01',mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1}}]}],buffers:[{byteLength:bin.byteLength}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,2,0]},
      {bufferView:1,componentType:5126,count:3,type:'VEC3'}]};
  let text=JSON.stringify(json);text=text.padEnd(Math.ceil(text.length/4)*4,' ');
  const bytes=new TextEncoder().encode(text),buffer=Buffer.alloc(28+bytes.length+bin.byteLength);
  [0x46546c67,2,buffer.length,bytes.length,0x4e4f534a].forEach((v,i)=>buffer.writeUInt32LE(v,i*4));
  Buffer.from(bytes).copy(buffer,20);buffer.writeUInt32LE(bin.byteLength,20+bytes.length);buffer.writeUInt32LE(0x004e4942,24+bytes.length);
  Buffer.from(bin.buffer).copy(buffer,28+bytes.length);return buffer;
};
async function measurement(page,name) {
  await page.getByRole('button',{name:'Measure fixed view for 10 seconds'}).click();
  await page.getByRole('button',{name:'Download benchmark receipt'}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.getElementById('download').disabled,null,{timeout:60000});
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download benchmark receipt'}).click()]);
  const path=new URL(name+'.json',out);await download.saveAs(path.pathname);
  const receipt=JSON.parse(await readFile(path,'utf8'));
  assert.equal(receipt.interrupted,false);assert(receipt.cadence.frames>0);assert(receipt.cadence.fps>0);
  assert.equal(receipt.physicalAccuracyValidated,false);return receipt;
}
try {
  for(let i=0;i<60;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await delay(500);}
  assert.equal((await fetch(base+'/healthz')).status,200);
  assert.equal((await fetch(base+'/lab',{redirect:'manual'})).status,200,'Existing Lab URL must not acquire a directory redirect.');
  const bare=await fetch(base+'/lab/meshlets?receipt=1',{redirect:'manual'});
  assert.equal(bare.status,308);assert.equal(bare.headers.get('location'),'/lab/meshlets/?receipt=1');
  const missing=await fetch(base+'/lab/meshlets/missing.js');assert.equal(missing.status,404);
  assert.equal(await missing.text(),'Meshlets lab asset not found.');
  const manifest=await(await fetch(base+'/lab/meshlets/runtime/manifest.json')).json();
  assert.equal(manifest.three,'0.187.0');assert.equal(manifest.meshletTriangles,64);
  for(const file of manifest.assets){const r=await fetch(base+'/lab/meshlets/runtime/'+file.path);assert.equal(r.status,200);const b=Buffer.from(await r.arrayBuffer());assert.equal(b.length,file.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),file.sha256);}
  const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader']});
  browsers.push(browser);
  for(const [width,height] of [[1440,1000],[390,844]]) {
    const page=await browser.newPage({viewport:{width,height},acceptDownloads:true});const errors=[],external=[];
    activePage=page;
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});
    await page.goto(base+'/lab/meshlets/');await page.selectOption('#mode','webgl');await page.selectOption('#count','25');
    await page.click('#start');await page.waitForFunction(()=>document.getElementById('mode-label').textContent==='WEBGL · CAPPED FALLBACK'&&!document.getElementById('benchmark').disabled,null,{timeout:60000});
    assert.equal(await page.locator('canvas').count(),1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:new URL(`webgl-${width}.png`,out).pathname,fullPage:true});
    if(width===1440) {
      const r=await measurement(page,'webgl-procedural');assert.equal(r.mode,'webgl');assert.equal(r.counts.objects,25);
      const bytes=glb();inspectGlb(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      await page.setInputFiles('#file',{name:'authored-wall.glb',mimeType:'model/gltf-binary',buffer:bytes});
      await page.waitForFunction(()=>document.getElementById('source-label').textContent.startsWith('YOUR GLB')&&!document.getElementById('benchmark').disabled,null,{timeout:60000});
      const own=await measurement(page,'webgl-authored-glb');assert.equal(own.source.sha256,createHash('sha256').update(bytes).digest('hex'));
      assert(own.source.objectNames.includes('evidence_wall_01'));assert.equal(own.counts.sourceTriangles,1);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();
    console.log(`WebGL ${width}: actual canvas, responsive controls, no external requests passed`);
  }
  const fallback=await browser.newPage();await fallback.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined}));
  await fallback.goto(base+'/lab/meshlets/');await fallback.selectOption('#count','25');await fallback.click('#start');
  await fallback.waitForFunction(()=>document.getElementById('mode-label').textContent==='WEBGL · CAPPED FALLBACK',null,{timeout:60000});
  await fallback.close();await browser.close();
  const gpu=await chromium.launch({channel:'chromium',args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--enable-features=Vulkan','--use-angle=vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface']});
  browsers.push(gpu);
  const control=await gpu.newPage();activePage=control;
  control.on('console',event=>console.log('GPU_CONTROL '+event.type()+': '+event.text()));
  control.on('pageerror',error=>console.log('GPU_CONTROL_ERROR '+error.message));
  await control.goto(base+'/lab/meshlets/runtime/control.html');
  await control.waitForFunction(()=>window.control?.error||window.control?.pipeline.info.clusters>0,null,{timeout:30000});
  const controlResult=await control.evaluate(()=>({error:window.control.error,clusters:window.control.pipeline.info.clusters,triangles:window.control.pipeline.info.triangles}));
  console.log('GPU_CONTROL_RESULT '+JSON.stringify(controlResult));assert.equal(controlResult.error,null);
  assert(controlResult.clusters>0);await control.close();
  const page=await gpu.newPage({viewport:{width:1100,height:950},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',event=>{const line=event.type()+': '+event.text();consoleLog.push(line);console.log('GPU_BROWSER '+line);});
  await page.addInitScript(()=>{
    if(!globalThis.GPUDevice)return;
    const destroy=GPUDevice.prototype.destroy;
    GPUDevice.prototype.destroy=function(...args){console.log('DEVICE_DESTROY_CALL '+new Error().stack);return destroy.apply(this,args);};
  });
  activePage=page;
  await page.goto(base+'/lab/meshlets/');await page.selectOption('#count','25');await page.click('#start');
  await page.waitForFunction(()=>document.getElementById('mode-label').textContent==='NOT RUNNING'||(document.getElementById('mode-label').textContent==='WEBGPU · MESHLETS'&&!document.getElementById('benchmark').disabled),null,{timeout:120000});
  assert.equal(await page.locator('#mode-label').textContent(),'WEBGPU · MESHLETS',await page.locator('#status').textContent());
  await page.waitForFunction(()=>document.getElementById('mode-label').textContent==='NOT RUNNING'||Number(document.getElementById('clusters').textContent.replaceAll(',',''))>0,null,{timeout:120000});
  assert.equal(await page.locator('#mode-label').textContent(),'WEBGPU · MESHLETS',await page.locator('#status').textContent());
  const meshlets=await measurement(page,'webgpu-meshlets-software-vulkan');assert(meshlets.counts.meshletClusters>0);
  await page.check('#debug');await page.click('#start');await page.waitForFunction(()=>!document.getElementById('benchmark').disabled,null,{timeout:120000});
  await page.screenshot({path:new URL('webgpu-clusters.png',out).pathname,fullPage:true});
  await page.uncheck('#debug');await page.selectOption('#mode','standard');await page.click('#start');
  await page.waitForFunction(()=>document.getElementById('mode-label').textContent==='WEBGPU · STANDARD'&&!document.getElementById('benchmark').disabled,null,{timeout:120000});
  const standard=await measurement(page,'webgpu-standard-software-vulkan');assert.equal(standard.counts.sourceTriangles,meshlets.counts.sourceTriangles);
  assert.deepEqual(standard.source,meshlets.source);assert.deepEqual(standard.settings.camera,meshlets.settings.camera);
  assert.deepEqual(errors,[]);await page.close();await gpu.close();
  console.log('Actual WebGPU meshlets, cluster debug and matched-load standard run passed on software Vulkan; no hardware FPS claim.');
} catch(error) {
  if(activePage&&!activePage.isClosed()) {
    await activePage.screenshot({path:new URL('failure.png',out).pathname,fullPage:true}).catch(()=>{});
    await writeFile(new URL('failure.txt',out),String(error)+'\n'+await activePage.locator('body').innerText().catch(()=>''));
  }
  throw error;
} finally {
  await Promise.allSettled(browsers.map(browser=>browser.close()));
  await writeFile(new URL('browser-console.log',out),consoleLog.join('\n'));
  server.kill('SIGTERM');await writeFile(new URL('server.log',out),serverLog);
}
