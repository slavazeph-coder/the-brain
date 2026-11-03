import * as T from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshletDrawingPipeline } from 'three/addons/pipelines/MeshletDrawingPipeline.js';
import { frameSummary, inspectGlb, receipt } from './metrics.mjs';

const $ = id => document.getElementById(id);
const stage=$('stage'), status=$('status');
let renderer, scene, camera, controls, pipeline, observer, generation=0, disposed=false;
let activeMode=null, asset=null, source, counts, compileMs=0, running=false, preparing=false;
let frameTimes=[], previousTime=null, lastHud=0, benchmark=null, lastReceipt=null;
const closingRenderers=new WeakSet();
const number = n => Number.isFinite(n) ? n.toLocaleString('en-CA') : 'Unavailable';
const sha = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');
const message = text => { status.textContent=text; };

function busy(value) {
  preparing=value;
  for(const id of ['start','mode','count','quality','lod','debug','occlusion','file','sample']) $(id).disabled=value;
  $('benchmark').disabled=value || !running;
  $('reset').disabled=value || !running;
  if(asset) { $('count').disabled=true; $('quality').disabled=true; }
}
function disposeScene() {
  const resources=new Set();
  scene?.traverse(o=>{
    if(o.geometry) resources.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]) {
      for(const v of Object.values(m)) if(v?.isTexture) resources.add(v);
      resources.add(m);
    }
    if(o.isInstancedMesh) resources.add(o);
  });
  for(const r of resources) r.dispose?.();
  scene=null;
}
async function stop() {
  running=false; previousTime=null;
  const previous=renderer;renderer=null;pipeline=null;
  if(previous)closingRenderers.add(previous);
  observer?.disconnect(); observer=null;
  controls?.dispose(); controls=null;
  disposeScene();
  stage.replaceChildren();
  if(previous) {await previous.setAnimationLoop(null);await previous.dispose();}
}
function resetCamera() {
  if(!camera) return;
  camera.position.set(14,10,18); camera.lookAt(0,1,0);
  controls.target.set(0,1,0); controls.update();
}
function finishBenchmark(interrupted=false) {
  if(!benchmark) return;
  lastReceipt=receipt({mode:activeMode,source,counts:{...counts,
    meshletTriangles:pipeline?.info?.triangles??null,meshletClusters:pipeline?.info?.clusters??null},
    samples:benchmark.samples, viewport:benchmark.viewport,compileMs,
    settings:{lodPixels:Number($('lod').value),occlusion:$('occlusion').checked,
      debugClusters:$('debug').checked,camera:benchmark.camera,warmupSeconds:2,
      requestedSeconds:10,measuredSeconds:benchmark.samples.reduce((a,b)=>a+b,0)/1000},interrupted});
  benchmark=null; controls.enabled=true;controls.enableDamping=true; $('download').disabled=false;
  $('benchmark').textContent='Measure fixed view for 10 seconds'; busy(false);
  message(interrupted?'Measurement interrupted; receipt is labelled incomplete.':
    `Measured ${lastReceipt.cadence.fps?.toFixed(1) || 'no'} FPS frame cadence. Download the device-specific receipt.`);
}
function resize() {
  if(!renderer || !camera) return;
  if(benchmark) finishBenchmark(true);
  const width=Math.max(1,stage.clientWidth),height=Math.max(1,stage.clientHeight);
  camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);
}
function brainGeometry(detail) {
  const geometry=new T.SphereGeometry(1,detail==='high'?256:128,detail==='high'?192:96);
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const fold=1+.055*Math.sin(20*y+3*z)*Math.sin(18*z+2*x)+.025*Math.cos(26*x-4*y);
    p.setXYZ(i,x*1.08*fold,y*.82*fold+.95,z*.91*fold);
  }
  geometry.computeVertexNormals();return geometry;
}
function makeBrains() {
  const fallback=activeMode==='webgl';
  const requested=Number($('count').value),count=fallback?Math.min(requested,100):requested;
  const geometry=fallback?new T.SphereGeometry(1,32,24):brainGeometry($('quality').value);
  if(fallback) geometry.scale(1.08,.82,.91).translate(0,.95,0);
  const Material=activeMode==='webgl'?T.MeshStandardMaterial:T.MeshStandardNodeMaterial;
  const material=new Material({color:0x92b9d8,roughness:.5,metalness:.18});
  const brains=new T.InstancedMesh(geometry,material,count),matrix=new T.Matrix4();
  const q=new T.Quaternion(),pos=new T.Vector3(),scale=new T.Vector3(1,1,1),axis=new T.Vector3(0,1,0);
  const side=Math.ceil(Math.sqrt(count));
  for(let i=0;i<count;i++) {
    pos.set((i%side-(side-1)/2)*3,0,(Math.floor(i/side)-(side-1)/2)*3);
    q.setFromAxisAngle(axis,(i*2.3999632297)%(Math.PI*2));
    brains.setMatrixAt(i,matrix.compose(pos,q,scale));
    brains.setColorAt(i,new T.Color(i%3===0?0x68eaff:i%3===1?0x947cff:0xbedcf7));
  }
  brains.instanceMatrix.needsUpdate=true;
  brains.computeBoundingSphere(); scene.add(brains);
  counts={objects:count,requestedObjects:requested,sourceTriangles:(geometry.index?.count||geometry.attributes.position.count)/3*count,
    uniqueGeometryTriangles:(geometry.index?.count||geometry.attributes.position.count)/3};
  source={kind:'procedural-brain-field',seed:'deterministic-grid-v1',detail:fallback?'webgl-low':$('quality').value,
    originalCapture:false,sharedGeometry:true};
  $('source-label').textContent='PROCEDURAL SAMPLE · NOT A RECONSTRUCTION';
  $('source-detail').textContent=`${count.toLocaleString()} instances share one procedural geometry. This is not ${count.toLocaleString()} unique scans or a cognitive simulation.`;
}
async function makeAsset() {
  const loaded=await new Promise((resolve,reject)=>new GLTFLoader().parse(asset.buffer.slice(0),'',resolve,reject));
  const root=loaded.scene;let triangles=0,meshes=0;const names=[];
  root.traverse(o=>{
    if(o.isMesh) {
      if(o.isSkinnedMesh || Object.keys(o.geometry.morphAttributes).length)
        throw new Error('Animated/skinned meshes are outside this static scan preview.');
      const count=(o.geometry.index?.count||o.geometry.attributes.position?.count||0)/3*(o.isInstancedMesh?o.count:1);
      triangles+=count;meshes++;if(names.length<25)names.push(o.name||'Unnamed mesh');
      if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals();
    }
  });
  if(!meshes || triangles>2_000_000) { root.traverse(o=>o.geometry?.dispose());throw new Error('Use a static GLB with 1 to 2M triangles.'); }
  const bounds=new T.Box3().setFromObject(root),size=bounds.getSize(new T.Vector3()),centre=bounds.getCenter(new T.Vector3());
  if(!Number.isFinite(size.length()) || size.length()===0)throw new Error('Invalid model bounds.');
  const wrapper=new T.Group();wrapper.add(root);wrapper.scale.setScalar(8/Math.max(size.x,size.y,size.z));
  // Centre horizontally and place the observed minimum at display y=0. Units remain source-declared only.
  wrapper.position.set(-centre.x*wrapper.scale.x,-bounds.min.y*wrapper.scale.x,-centre.z*wrapper.scale.x);
  scene.add(wrapper);
  counts={objects:meshes,sourceTriangles:triangles,uniqueGeometryTriangles:null};
  source={kind:'local-glb',name:asset.name,bytes:asset.buffer.byteLength,sha256:asset.hash,
    objectNames:names,sourceBytesUnchanged:true,displayNormalization:'uniform scale and recenter only',metricScaleVerified:false};
  $('source-label').textContent='YOUR GLB · LOCAL DISPLAY · SCALE UNVERIFIED';
  $('source-detail').textContent=`${asset.name} · SHA-256 ${asset.hash}. ${meshes} named/unnamed meshes; sample: ${names.join(', ')}. Materials unsupported by meshlets render through the regular pipeline. Model dimensions and robot safety are unverified.`;
}
async function start() {
  if(preparing || disposed)return;
  if(benchmark)finishBenchmark(true);
  busy(true);
  const current=++generation;
  const started=performance.now();
  try {
    await stop();
    if(disposed || current!==generation)return;
    frameTimes=[];lastReceipt=null;$('download').disabled=true;
    for(const id of ['fps','total','drawn','clusters','compile'])$(id).textContent=id==='fps'?'Not measured':'Unavailable';
    activeMode=$('mode').value;
    if(activeMode!=='webgl') {
      try {
        if(!isSecureContext || !navigator.gpu)throw new Error('WebGPU unavailable');
        renderer=new T.WebGPURenderer({antialias:true});await renderer.init();
        if(!renderer.backend.isWebGPUBackend)throw new Error('No WebGPU adapter');
      } catch {
        if(renderer){closingRenderers.add(renderer);await renderer.dispose();}
        renderer=null;activeMode='webgl';$('mode').value='webgl';
        message('WebGPU was unavailable. Starting the capped WebGL fallback.');
      }
    }
    if(!renderer) {
      const {WebGLRenderer}=await import('three');
      renderer=new WebGLRenderer({antialias:true});
    }
    if(disposed || current!==generation) { await stop();return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(stage.clientWidth,stage.clientHeight);
    renderer.toneMapping=T.ACESFilmicToneMapping;
    stage.append(renderer.domElement);scene=new T.Scene();scene.background=new T.Color(0x070c16);
    scene.fog=new T.FogExp2(0x070c16,.006);
    scene.add(new T.HemisphereLight(0xb2d8ff,0x19112e,2));
    const light=new T.DirectionalLight(0x9ccfff,3);light.position.set(8,15,12);scene.add(light);
    const rim=new T.DirectionalLight(0x947cff,3);rim.position.set(-12,7,-12);scene.add(rim);
    camera=new T.PerspectiveCamera(50,stage.clientWidth/stage.clientHeight,.1,1200);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxDistance=500;controls.minDistance=2;
    controls.maxPolarAngle=Math.PI*.49;controls.autoRotate=$('rotate').checked;controls.autoRotateSpeed=.5;
    if(activeMode==='meshlets') {
      pipeline=new MeshletDrawingPipeline({lodThreshold:Number($('lod').value),debug:$('debug').checked,occlusionCulling:$('occlusion').checked});
      renderer.drawingPipeline=pipeline;
    }
    message('Preparing source geometry and shaders. No performance result yet.');
    if(asset)await makeAsset();else makeBrains();
    resetCamera();observer=new ResizeObserver(resize);observer.observe(stage);
    if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
    compileMs=performance.now()-started;
    if(disposed || current!==generation) { await stop();return; }
    $('compile').textContent=compileMs.toFixed(0)+' ms';$('total').textContent=number(counts.sourceTriangles);
    $('mode-label').textContent=activeMode==='meshlets'?'WEBGPU · MESHLETS':activeMode==='standard'?'WEBGPU · STANDARD':'WEBGL · CAPPED FALLBACK';
    message(activeMode==='webgl'?'WebGL fallback active. Procedural count is capped at 100 with lower detail.':
      'Live view. Use the fixed-view measurement for a downloadable browser receipt.');
    running=true;busy(false);
    renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();fail('Graphics context lost. Start again to retry.');});
    renderer.backend?.device?.addEventListener('uncapturederror',event=>console.error('Meshlets WebGPU validation:',event.error.message));
    const ownedRenderer=renderer;
    renderer.backend?.device?.lost.then(info=>{if(current===generation&&!disposed&&!closingRenderers.has(ownedRenderer)) {
      console.error('Meshlets WebGPU device lost:',info.reason,info.message);
      fail('WebGPU device lost. Choose WebGL fallback or start again.');
    }});
    renderer.setAnimationLoop(animate);
  } catch(error) { if(current===generation&&!disposed)fail(error.message); }
}
async function fail(reason) {
  if(benchmark)finishBenchmark(true);
  ++generation;busy(true);
  try {await stop();} finally {busy(false);message(`Rendering stopped: ${reason}`);}
  $('mode-label').textContent='NOT RUNNING';$('fps').textContent='Not measured';
  $('drawn').textContent=$('clusters').textContent='Unavailable';
}
function animate(time) {
  if(!running||preparing||document.hidden)return;
  try {
    const delta=previousTime===null?null:time-previousTime;previousTime=time;
    controls.update(delta===null?0:delta/1000);renderer.render(scene,camera);
    if(delta>0) {frameTimes.push(delta);if(frameTimes.length>120)frameTimes.shift();}
    if(benchmark) {
      const elapsed=time-benchmark.started;
      if(elapsed>=2000 && delta>0 && benchmark.previous>=benchmark.started+2000)benchmark.samples.push(delta);
      benchmark.previous=time;
      $('benchmark').textContent=elapsed<2000?'Warming up…':`Measuring… ${Math.max(0,Math.ceil((12000-elapsed)/1000))} s`;
      if(elapsed>=12000)finishBenchmark();
    }
    if(time-lastHud>500) {
      const fps=frameSummary(frameTimes).fps;$('fps').textContent=fps?fps.toFixed(1)+' FPS':'Not measured';
      $('drawn').textContent=pipeline?number(pipeline.info.triangles):'Unavailable';
      $('clusters').textContent=pipeline?number(pipeline.info.clusters):'Unavailable';lastHud=time;
    }
  } catch(error) {fail(error.message);}
}
$('start').addEventListener('click',start);
$('reset').addEventListener('click',resetCamera);
$('lod').addEventListener('input',()=>{$('lod-value').value=$('lod').value;});
$('rotate').addEventListener('change',()=>{if(controls&&!benchmark)controls.autoRotate=$('rotate').checked;});
$('file').addEventListener('change',async()=>{
  const file=$('file').files[0];if(!file||preparing)return;
  busy(true);
  try {
    if(file.size>40*1024**2)throw new Error('Choose a GLB smaller than 40 MiB.');
    const buffer=await file.arrayBuffer();inspectGlb(buffer);
    asset={buffer,name:file.name,hash:await sha(buffer)};$('sample').hidden=false;busy(false);await start();
  } catch(error) {busy(false);message(error.message);}
});
$('sample').addEventListener('click',()=>{asset=null;$('file').value='';$('sample').hidden=true;start();});
$('benchmark').addEventListener('click',()=>{
  if(!running||preparing||benchmark)return;
  controls.autoRotate=false;$('rotate').checked=false;controls.enableDamping=false;resetCamera();controls.enabled=false;
  benchmark={started:performance.now(),previous:null,samples:[],viewport:{width:stage.clientWidth,height:stage.clientHeight,
    pixelRatio:renderer.getPixelRatio(),userAgent:navigator.userAgent},
    camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray(),fov:camera.fov}};
  $('download').disabled=true;lastReceipt=null;
  busy(true);preparing=false; // Keep frames running while settings are locked.
  $('reset').disabled=true;$('benchmark').disabled=true;
});
$('download').addEventListener('click',()=>{
  if(!lastReceipt)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(lastReceipt,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='brainsnn-meshlets-benchmark.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
document.addEventListener('visibilitychange',()=>{previousTime=null;if(document.hidden&&benchmark)finishBenchmark(true);});
window.addEventListener('pagehide',()=>{disposed=true;++generation;if(benchmark)finishBenchmark(true);stop();},{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted){disposed=false;message('Graphics were released while away. Start the experiment to resume.');}});
