import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const host=document.getElementById('scene'),status=document.getElementById('load-status');
const state={ready:false,frames:0,triangles:0,drawCalls:0,modelMeshes:0,camera:[],decals:0,fail:null};
Object.defineProperty(window,'GT3_RENDER_STATUS',{get:()=>({...state,camera:camera?.position.toArray()||[]})});
let renderer,camera,controls,scene,model,raf=0,visible=true,disposed=false;
const vector=new THREE.Vector3(),target=new THREE.Vector3(0,.65,0),home=new THREE.Vector3();
function fail(message){state.ready=false;state.fail=message;document.body.dataset.renderState='error';status.textContent=message;host.setAttribute('aria-busy','false');document.getElementById('retry').hidden=false;}
function schedule(){if(!raf&&visible&&!document.hidden&&!disposed)raf=requestAnimationFrame(frame);}
function frame(){raf=0;if(!renderer||!model||!visible||document.hidden||disposed)return;renderer.render(scene,camera);state.frames++;state.triangles=renderer.info.render.triangles;state.drawCalls=renderer.info.render.calls;if(!state.ready&&state.triangles>1000){state.ready=true;document.getElementById('loader').hidden=true;document.body.dataset.renderState='ready';status.textContent='Drag to rotate · Pinch or scroll to zoom';host.setAttribute('aria-busy','false');}}
function resize(){if(!renderer||!camera)return;const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();schedule();}
function fit(){const distance=Math.max(6.2,2.7/(Math.max(.65,camera.aspect)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))));home.set(1,.30,1.65).normalize().multiplyScalar(distance).add(target);camera.position.copy(home);controls.target.copy(target);controls.update();schedule();}
function mergeCar(root){
 root.updateMatrixWorld(true);const groups=new Map(),result=new THREE.Group();
 root.traverse(o=>{
  if(!o.isMesh)return;if(o.isSkinnedMesh||o.morphTargetInfluences||Array.isArray(o.material))throw Error('Unexpected animated mesh');
  let g=o.geometry.clone();if(g.index){const tmp=g.toNonIndexed();g.dispose();g=tmp;}
  if(o.matrixWorld.determinant()<0){for(const attr of Object.values(g.attributes)){for(let i=0;i<attr.count;i+=3){for(let k=0;k<attr.itemSize;k++){const a=(i+1)*attr.itemSize+k,b=(i+2)*attr.itemSize+k,tmp=attr.array[a];attr.array[a]=attr.array[b];attr.array[b]=tmp;}}}}
  g.applyMatrix4(o.matrixWorld);for(const name of Object.keys(g.attributes))if(!['position','normal','uv'].includes(name))g.deleteAttribute(name);
  if(!g.attributes.normal)g.computeVertexNormals();if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
  o.material.vertexColors=false;const key=o.material.uuid;if(!groups.has(key))groups.set(key,{material:o.material,list:[]});groups.get(key).list.push(g);
 });
 for(const {material,list}of groups.values()){const geometry=mergeGeometries(list,false);if(!geometry)throw Error('Model geometry could not be combined.');geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.name=material.name;result.add(mesh);list.forEach(g=>g.dispose());}return result;
}
async function init(){try{
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'default'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.25));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
 renderer.domElement.setAttribute('aria-label','Interactive Porsche GT3 RS. Drag to orbit; use reset or arrow keys.');renderer.domElement.tabIndex=0;host.prepend(renderer.domElement);
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(raf)cancelAnimationFrame(raf);raf=0;fail('The 3D connection paused. Reload the model to continue.');});
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(32,1,.05,100);controls=new OrbitControls(camera,renderer.domElement);
 // Direct manipulation: one frame per changed view, no hidden inertial loop.
 controls.enableDamping=false;controls.enablePan=false;controls.minDistance=3.8;controls.maxDistance=15;controls.minPolarAngle=.18;controls.maxPolarAngle=Math.PI/2-.015;controls.rotateSpeed=.6;controls.zoomSpeed=.7;controls.addEventListener('change',schedule);
 const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();scene.environmentIntensity=.8;
 scene.add(new THREE.HemisphereLight(0xc5e7ff,0x27304c,.65));for(const [color,intensity,pos]of [[0xd5f3ff,1.4,[2,5,4]],[0x9065ff,1.1,[-3,3,-4]],[0x48d6ff,.8,[1,2,4]]]){const l=new THREE.DirectionalLight(color,intensity);l.position.set(...pos);scene.add(l);}
 resize();status.textContent='Loading Porsche geometry…';const response=await fetch('/sponsor/gt3/car.glb?v=native1',{cache:'force-cache',signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('Model download failed.');const buffer=await response.arrayBuffer();const gltf=await new GLTFLoader().parseAsync(buffer,'');model=mergeCar(gltf.scene);
 let box=new THREE.Box3().setFromObject(model),size=box.getSize(vector).clone();if(size.z>size.x)model.rotation.y=Math.PI/2;box.setFromObject(model);size=box.getSize(vector).clone();model.scale.setScalar(4.6/Math.max(size.x,size.z));box.setFromObject(model);const center=box.getCenter(new THREE.Vector3());model.position.set(-center.x,-box.min.y,-center.z);
 for(const m of model.children)if(m.material.name==='TwiXeR_992_carPaint.003'){m.material.color.setRGB(.095,.12,.15);m.material.metalness=.45;m.material.roughness=.32;}
 state.modelMeshes=model.children.length;scene.add(model);
 const disk=document.createElement('canvas');disk.width=disk.height=128;const cx=disk.getContext('2d'),gradient=cx.createRadialGradient(64,64,8,64,64,64);gradient.addColorStop(0,'rgba(0,0,0,.6)');gradient.addColorStop(1,'rgba(0,0,0,0)');cx.fillStyle=gradient;cx.fillRect(0,0,128,128);const shadow=new THREE.Mesh(new THREE.PlaneGeometry(6,3.4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(disk),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.02;scene.add(shadow);
 fit();schedule();requestAnimationFrame(()=>autoPlace(false));document.getElementById('reset-view').disabled=false;
}catch(e){fail(e.message.includes('WebGL')?'This browser cannot start 3D. Try Safari or Chrome with graphics enabled.':'The model could not load. Retry below; proposals still work.');console.error(e);}}
document.getElementById('reset-view').addEventListener('click',()=>{if(!controls)return;camera.position.copy(home);controls.target.copy(target);controls.update();schedule();});
document.getElementById('retry').addEventListener('click',()=>location.reload());
host.addEventListener('keydown',e=>{if(!camera||!state.ready||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const delta=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(delta);s.theta+=(e.key==='ArrowLeft'?.15:e.key==='ArrowRight'?-.15:0);s.phi=THREE.MathUtils.clamp(s.phi+(e.key==='ArrowUp'?-.1:e.key==='ArrowDown'?.1:0),.2,Math.PI/2-.02);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();schedule();});
new ResizeObserver(resize).observe(host);new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)schedule();},{rootMargin:'80px'}).observe(host);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
window.addEventListener('pagehide',e=>{if(e.persisted)return;disposed=true;if(raf)cancelAnimationFrame(raf);renderer?.dispose();controls?.dispose();});window.addEventListener('pageshow',schedule);

// A single private design, projected automatically onto the selected body panel.
// No third-party image calls. A preview is saved only after explicit submission.
const el=id=>document.getElementById(id),artStatus=text=>{el('art-status').textContent=text;};
const artwork={brand:'',image:null,canvas:null,texture:null,decal:null,zone:el('placement').value||'driver-door',scale:1,restored:false};
let uploadVersion=0,editTimer=0;
const anchors={
 'driver-door':{from:[0,.58,3],to:[0,0,-1],size:[.78,.39,.20],camera:[.8,1.8,6]},
 'passenger-door':{from:[0,.58,-3],to:[0,0,1],size:[.78,.39,.20],camera:[.8,1.8,-6]},
 'driver-quarter':{from:[-1.35,.85,3],to:[0,0,-1],size:[.40,.20,.22],camera:[-3.8,2,5]},
 'passenger-quarter':{from:[-1.35,.85,-3],to:[0,0,1],size:[.40,.20,.22],camera:[-3.8,2,-5]},
 'driver-fender':{from:[1.38,.86,3],to:[0,0,-1],size:[.32,.16,.20],camera:[3.4,2.3,5.1]},
 'passenger-fender':{from:[1.38,.86,-3],to:[0,0,1],size:[.32,.16,.20],camera:[3.4,2.3,-5.1]},
 hood:{from:[1.14,3,0],to:[0,-1,0],size:[.70,.35,.22],camera:[4.3,5.8,.4]},
 wing:{from:[-1.91,3,0],to:[0,-1,0],size:[.70,.22,.18],camera:[-4.3,4.5,.6]}
};
function redrawArt(){if(!artwork.canvas){artwork.canvas=document.createElement('canvas');artwork.canvas.width=1024;artwork.canvas.height=512;}
 const x=artwork.canvas.getContext('2d');x.clearRect(0,0,1024,512);
 if(artwork.image&&artwork.restored){x.drawImage(artwork.image,0,0,1024,512);}
 else if(artwork.image){const k=Math.min(960/artwork.image.width,440/artwork.image.height);x.drawImage(artwork.image,(1024-artwork.image.width*k)/2,(512-artwork.image.height*k)/2,artwork.image.width*k,artwork.image.height*k);}
 else if(artwork.brand){x.fillStyle='#eff9ff';let size=126;while(size>24){x.font='700 '+size+'px Arial';if(x.measureText(artwork.brand).width<960)break;size-=3;}x.textBaseline='middle';x.textAlign='center';x.fillText(artwork.brand,512,256);}
 if(!artwork.texture){artwork.texture=new THREE.CanvasTexture(artwork.canvas);artwork.texture.colorSpace=THREE.SRGBColorSpace;}
 artwork.texture.needsUpdate=true;schedule();return artwork.texture;
}
function removeDecal(){if(artwork.decal){scene.remove(artwork.decal);artwork.decal.geometry.dispose();artwork.decal.material.dispose();artwork.decal=null;}state.decals=0;schedule();}
function panelHit(a){model.updateMatrixWorld(true);const meshes=model.children.filter(m=>['wing','hood'].includes(artwork.zone)?/carbon_roof|carPaint/.test(m.name):m.name==='TwiXeR_992_carPaint.003');
 for(const offset of [0,-.05,.05,-.12,.12]){const from=new THREE.Vector3(...a.from);from.x+=offset;const ray=new THREE.Raycaster(from,new THREE.Vector3(...a.to));const hit=ray.intersectObjects(meshes,false).find(h=>h.face);if(hit)return hit;}return null;
}
function focusPanel(){
 if(!camera||!model)return;
 const direction=new THREE.Vector3(...anchors[artwork.zone].camera).normalize();
 const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize();
 const up=new THREE.Vector3().crossVectors(direction,right).normalize();
 const bounds=new THREE.Box3().setFromObject(model),tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
 let distance=controls.minDistance;
 // Fit every corner in the selected camera's actual aspect ratio, including overhead views.
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
  const point=new THREE.Vector3(x,y,z).sub(target),depth=point.dot(direction);
  distance=Math.max(distance,depth+Math.abs(point.dot(right))/(tan*camera.aspect*.88),depth+Math.abs(point.dot(up))/(tan*.88));
 }
 camera.position.copy(direction.multiplyScalar(distance).add(target));controls.target.copy(target);controls.update();schedule();
 if(matchMedia('(max-width:850px)').matches)host.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'center'});
}
function autoPlace(focus=true){if(!model||!renderer||!artwork.image&&!artwork.brand)return;try{
 const a=anchors[artwork.zone],hit=panelHit(a);if(!hit)throw Error('This panel could not be located. Select another placement.');
 const normal=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
 const up=Math.abs(normal.y)>.8?new THREE.Vector3(artwork.zone==='wing'?1:-1,0,0):new THREE.Vector3(0,1,0);
 const right=new THREE.Vector3().crossVectors(up,normal).normalize();up.crossVectors(normal,right).normalize();
 const rotation=new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,normal));
 const surfaces=['hood','wing'].includes(artwork.zone)?model.children.filter(m=>/carbon_roof|carPaint/.test(m.name)):[hit.object];
 const pieces=surfaces.map(m=>new DecalGeometry(m,hit.point,rotation,new THREE.Vector3(...a.size).multiplyScalar(artwork.scale)));
 const good=pieces.filter(g=>g.attributes.position.count>0);if(!good.length){pieces.forEach(g=>g.dispose());throw Error('The selected panel could not hold this preview.');}
 const geometry=mergeGeometries(good,false);pieces.forEach(g=>g.dispose());
 if(!geometry.attributes.position.count){geometry.dispose();throw Error('The selected surface could not be prepared.');}
 removeDecal();artwork.decal=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:redrawArt(),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4}));artwork.decal.renderOrder=3;scene.add(artwork.decal);state.decals=1;state.placement=artwork.zone;el('remove-logo').disabled=false;if(focus)focusPanel();schedule();artStatus('Your logo is on the car. Preview only; final wrap artwork is approved separately.');
 document.dispatchEvent(new CustomEvent('gt3:design',{detail:{placed:true,zone:artwork.zone}}));
 }catch(e){removeDecal();state.placement=null;artStatus(e.message);document.dispatchEvent(new CustomEvent('gt3:design',{detail:{placed:false}}));}}
el('brand-name').addEventListener('input',()=>{artwork.brand=el('brand-name').value.trim().slice(0,28);clearTimeout(editTimer);editTimer=setTimeout(()=>{if(!artwork.image&&!artwork.brand){removeDecal();artStatus('Upload your logo or enter your brand name.');}else if(artwork.decal)redrawArt();else autoPlace();},140);});
el('logo').addEventListener('change',async e=>{const file=e.target.files?.[0],v=++uploadVersion;if(!file)return;let url;try{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152)throw Error('Use PNG, JPG or WebP under 2 MB.');
 url=URL.createObjectURL(file);const image=new Image();image.src=url;await image.decode();if(!image.width||Math.max(image.width,image.height)>4096)throw Error('Use a logo up to 4096 pixels per side.');if(v!==uploadVersion)return;
 const c=document.createElement('canvas'),k=Math.min(1,1024/Math.max(image.width,image.height));c.width=Math.round(image.width*k);c.height=Math.round(image.height*k);c.getContext('2d').drawImage(image,0,0,c.width,c.height);artwork.image=c;artwork.restored=false;el('upload-label').textContent='Change logo';artStatus('Logo prepared. Applying to your selected spot…');autoPlace();
 }catch(err){artStatus(err.message);}finally{if(url)URL.revokeObjectURL(url);e.target.value='';}});
el('remove-logo').addEventListener('click',()=>{uploadVersion++;removeDecal();artwork.image=null;artwork.brand='';artwork.texture?.dispose();artwork.texture=null;el('brand-name').value='';el('remove-logo').disabled=true;el('upload-label').textContent='Upload your logo';artStatus('Preview cleared. Choose another logo or type your brand.');document.dispatchEvent(new CustomEvent('gt3:design',{detail:{placed:false}}));});
document.addEventListener('gt3:placement',e=>{artwork.zone=anchors[e.detail]?e.detail:'driver-door';autoPlace();});
el('logo-size').addEventListener('input',()=>{artwork.scale=Number(el('logo-size').value)/100;clearTimeout(editTimer);editTimer=setTimeout(()=>autoPlace(false),80);});
window.GT3_DESIGN={snapshot(){if(!state.ready||!artwork.decal||state.placement!==artwork.zone||!artwork.image&&!artwork.brand)throw Error('Upload a logo or enter a brand name, then wait for its preview.');redrawArt();const c=document.createElement('canvas');c.width=512;c.height=256;c.getContext('2d').drawImage(artwork.canvas,0,0,512,256);return {zone:artwork.zone,brand:artwork.brand,scale:artwork.scale,png:c.toDataURL('image/png').split(',')[1]};},async restore(d){if(!d||!anchors[d.zone]||typeof d.png!=='string')return;const image=new Image();image.src='data:image/png;base64,'+d.png;await image.decode();artwork.zone=d.zone;artwork.brand=String(d.brand||'').slice(0,28);artwork.image=image;artwork.restored=true;artwork.scale=Math.min(1.4,Math.max(.6,Number(d.scale)||1));el('placement').value=d.zone;el('placement').dispatchEvent(new Event('change'));el('brand-name').value=artwork.brand;el('logo-size').value=artwork.scale*100;autoPlace();}};
init();
