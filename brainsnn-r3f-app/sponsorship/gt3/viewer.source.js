import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const host=document.getElementById('scene'),status=document.getElementById('load-status');
const state={ready:false,frames:0,triangles:0,drawCalls:0,modelMeshes:0,camera:[],fail:null};
Object.defineProperty(window,'GT3_RENDER_STATUS',{get:()=>({...state,camera:camera?.position.toArray()||[]})});
let renderer,camera,controls,scene,model,raf=0,visible=true,disposed=false;
const vector=new THREE.Vector3(),target=new THREE.Vector3(0,.65,0),home=new THREE.Vector3();
function fail(message){state.ready=false;state.fail=message;document.body.dataset.renderState='error';status.textContent=message;document.getElementById('retry').hidden=false;}
function schedule(){if(!raf&&visible&&!document.hidden&&!disposed)raf=requestAnimationFrame(frame);}
function frame(){raf=0;if(!renderer||!model||!visible||document.hidden||disposed)return;const moving=controls.update();renderer.render(scene,camera);state.frames++;state.triangles=renderer.info.render.triangles;state.drawCalls=renderer.info.render.calls;if(!state.ready&&state.triangles>1000){state.ready=true;document.body.dataset.renderState='ready';status.textContent='Drag to rotate · Pinch or scroll to zoom';host.setAttribute('aria-busy','false');}if(moving)schedule();}
function resize(){if(!renderer||!camera)return;const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();schedule();}
function fit(){const distance=Math.max(7.6,4.2/(Math.max(.65,camera.aspect)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))));home.set(1,.43,1.3).normalize().multiplyScalar(distance).add(target);camera.position.copy(home);controls.target.copy(target);controls.update();schedule();}
function mergeCar(root){
 root.updateMatrixWorld(true);const groups=new Map(),result=new THREE.Group();
 root.traverse(o=>{if(!o.isMesh)return;if(o.isSkinnedMesh||o.morphTargetInfluences||Array.isArray(o.material))throw Error('Unexpected animated mesh');let g=o.geometry.clone().applyMatrix4(o.matrixWorld);if(g.index){const tmp=g.toNonIndexed();g.dispose();g=tmp;}for(const name of Object.keys(g.attributes))if(!['position','normal','uv'].includes(name))g.deleteAttribute(name);if(!g.attributes.normal)g.computeVertexNormals();if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));const key=o.material.uuid;if(!groups.has(key))groups.set(key,{material:o.material,list:[]});groups.get(key).list.push(g);});
 for(const {material,list}of groups.values()){const geometry=mergeGeometries(list,false);if(!geometry)throw Error('Model geometry could not be combined.');geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.name=material.name;result.add(mesh);list.forEach(g=>g.dispose());}return result;
}
async function init(){try{
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'default'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
 renderer.domElement.setAttribute('aria-label','Interactive Porsche GT3 RS. Drag to orbit; use reset or arrow keys.');renderer.domElement.tabIndex=0;host.prepend(renderer.domElement);
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(raf)cancelAnimationFrame(raf);raf=0;fail('The 3D connection paused. Reload the model to continue.');});
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(32,1,.05,100);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.enablePan=false;controls.minDistance=3.8;controls.maxDistance=15;controls.minPolarAngle=.18;controls.maxPolarAngle=Math.PI/2-.015;controls.rotateSpeed=.6;controls.zoomSpeed=.7;controls.addEventListener('change',schedule);
 const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();scene.environmentIntensity=1.15;
 scene.add(new THREE.HemisphereLight(0xc5e7ff,0x27304c,2));for(const [color,intensity,pos]of [[0xd5f3ff,3,[2,5,4]],[0x9065ff,3,[-3,3,-4]],[0x48d6ff,2,[1,2,4]]]){const l=new THREE.DirectionalLight(color,intensity);l.position.set(...pos);scene.add(l);}
 resize();status.textContent='Loading Porsche geometry…';const response=await fetch('/sponsor/gt3/car.glb?v=native1',{cache:'force-cache',signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('Model download failed.');const buffer=await response.arrayBuffer();const gltf=await new GLTFLoader().parseAsync(buffer,'');model=mergeCar(gltf.scene);
 let box=new THREE.Box3().setFromObject(model),size=box.getSize(vector).clone();if(size.z>size.x)model.rotation.y=Math.PI/2;box.setFromObject(model);size=box.getSize(vector).clone();model.scale.setScalar(4.6/Math.max(size.x,size.z));box.setFromObject(model);const center=box.getCenter(new THREE.Vector3());model.position.set(-center.x,-box.min.y,-center.z);
 state.modelMeshes=model.children.length;scene.add(model);
 const disk=document.createElement('canvas');disk.width=disk.height=128;const cx=disk.getContext('2d'),gradient=cx.createRadialGradient(64,64,8,64,64,64);gradient.addColorStop(0,'rgba(0,0,0,.6)');gradient.addColorStop(1,'rgba(0,0,0,0)');cx.fillStyle=gradient;cx.fillRect(0,0,128,128);const shadow=new THREE.Mesh(new THREE.PlaneGeometry(6,3.4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(disk),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.02;scene.add(shadow);
 fit();schedule();document.getElementById('reset-view').disabled=false;
}catch(e){fail(e.message.includes('WebGL')?'This browser cannot start 3D. Try Safari or Chrome with graphics enabled.':'The model could not load. Retry below; proposals still work.');console.error(e);}}
document.getElementById('reset-view').addEventListener('click',()=>{if(!controls)return;camera.position.copy(home);controls.target.copy(target);controls.update();schedule();});
document.getElementById('retry').addEventListener('click',()=>location.reload());
host.addEventListener('keydown',e=>{if(!camera||!state.ready||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const delta=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(delta);s.theta+=(e.key==='ArrowLeft'?.15:e.key==='ArrowRight'?-.15:0);s.phi=THREE.MathUtils.clamp(s.phi+(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0),.2,Math.PI/2-.02);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();schedule();});
new ResizeObserver(resize).observe(host);new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)schedule();},{rootMargin:'80px'}).observe(host);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
window.addEventListener('pagehide',()=>{disposed=true;if(raf)cancelAnimationFrame(raf);renderer?.dispose();controls?.dispose();},{once:true});
init();
