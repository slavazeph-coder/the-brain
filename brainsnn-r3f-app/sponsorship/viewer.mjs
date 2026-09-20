import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

const cache = new Map();
async function asset(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error('The robot model could not load.'); return r.json(); }));
  return cache.get(url);
}
const vec = a => new THREE.Vector3(...a);
const rpy = a => new THREE.Quaternion().setFromEuler(new THREE.Euler(a[0], a[1], a[2], 'ZYX'));
const config = {
  chest:{parts:['torso_link'],face:1,width:.16,height:.065,y:.56},
  back:{parts:['torso_link'],face:-1,width:.16,height:.085,y:.53},
  shoulders:{parts:['left_shoulder_roll_link','right_shoulder_roll_link'],face:1,width:.062,height:.042,y:.58},
  arm:{parts:['left_elbow_link'],face:1,width:.045,height:.065,y:.45},
  thigh:{parts:['left_hip_yaw_link'],face:1,width:.065,height:.095,y:.47},
  shin:{parts:['left_knee_link'],face:1,width:.060,height:.11,y:.45},
  qr:{parts:['torso_link'],face:-1,width:.060,height:.060,y:.30},
  naming:{parts:['torso_link'],face:1,width:.12,height:.032,y:.34}
};

export async function createRobotViewer(element, options = {}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'}); }
  catch { throw new Error('3D needs WebGL. You can still choose a placement and submit an application below.'); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.65));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=.9;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label','Interactive Unitree G1 reference model. Drag to rotate. Use the placement buttons for keyboard access.');
  renderer.domElement.setAttribute('role','img');
  element.appendChild(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(31,1,.01,30);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=.08;
  controls.enablePan=false; controls.enableZoom=false;
  controls.minPolarAngle=Math.PI*.23; controls.maxPolarAngle=Math.PI*.56;
  const pmrem=new THREE.PMREMGenerator(renderer);
  const room=new RoomEnvironment();
  const environment=pmrem.fromScene(room,.04);
  scene.environment=environment.texture;
  room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe7edff,0x657083,1.4));
  const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(2,4,4);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-2;key.shadow.camera.right=2;key.shadow.camera.top=2;key.shadow.camera.bottom=-2;key.shadow.bias=-.0005;scene.add(key);
  const rim=new THREE.DirectionalLight(0x9aacff,1.8);rim.position.set(-3,2,-2);scene.add(rim);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(1.6,64),new THREE.ShadowMaterial({color:0x081020,opacity:.15}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.position.y=-.018;scene.add(floor);
  const pedestal=new THREE.Mesh(new THREE.CylinderGeometry(.33,.35,.018,80),new THREE.MeshStandardMaterial({color:options.dark?0x20242d:0xe5e7eb,roughness:.25,metalness:.45}));pedestal.position.y=-.011;pedestal.receiveShadow=true;scene.add(pedestal);
  const manifest=await asset('/sponsor/models/manifest.json');
  const nodes=new Map();const meshes=new Map();
  const model=new THREE.Group();
  const reference=new THREE.Group();
  // Proper right-handed basis: old X forward -> new Z, old Y left -> new X,
  // old Z up -> new Y. A negative determinant would be a reflection, not a rotation.
  const basis=new THREE.Matrix4().set(0,1,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,1);
  if(Math.abs(basis.determinant()-1)>1e-6)throw new Error('Invalid reference model basis.');
  reference.setRotationFromMatrix(basis);
  model.add(reference);scene.add(model);
  const node=name=>{if(!nodes.has(name)){const g=new THREE.Group();g.name=name;nodes.set(name,g);}return nodes.get(name);};
  await Promise.all(manifest.links.map(async link=>{
    const json=await asset('/sponsor/models/'+link.file);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(json.positions,3));geometry.setIndex(json.indices);geometry.computeVertexNormals();geometry.computeBoundingBox();
    const dark=/dark|black/i.test(link.material);
    const material=new THREE.MeshStandardMaterial({color:dark?0x242831:0xc8cbd2,metalness:dark?.22:.48,roughness:dark?.46:.30});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=link.name;mesh.position.copy(vec(link.xyz));mesh.quaternion.copy(rpy(link.rpy));mesh.scale.copy(vec(link.scale));mesh.castShadow=true;mesh.receiveShadow=true;node(link.name).add(mesh);meshes.set(link.name,mesh);
  }));
  const children=new Set();
  for(const joint of manifest.joints){const c=node(joint.child);c.position.copy(vec(joint.xyz));c.quaternion.copy(rpy(joint.rpy));node(joint.parent).add(c);children.add(joint.child);}
  for(const [name,g] of nodes)if(!children.has(name))reference.add(g);
  model.updateMatrixWorld(true);
  let bounds=new THREE.Box3().setFromObject(model);const center=bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x,-bounds.min.y,-center.z);model.updateMatrixWorld(true);
  bounds=new THREE.Box3().setFromObject(model);const height=bounds.max.y;
  const dimensions=bounds.getSize(new THREE.Vector3());
  if(height<.9||height>1.8||dimensions.x>height*.8)throw new Error('Unexpected reference-model proportions.');
  element.dataset.robotHeight=height.toFixed(3);element.dataset.robotWidth=dimensions.x.toFixed(3);
  controls.target.set(0,height*.52,0);
  camera.position.set(options.hero?.50:.05,height*.58,height*2.48);
  controls.update();
  const decals=new Map();const brands=new Map();let disposed=false,visible=true,dirty=true;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let settleUntil=performance.now()+2000;let cameraTarget=null;
  const ray=new THREE.Raycaster();
  function texture(brand) {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,1024,512);
    if(brand.image){const ratio=Math.min(900/brand.image.width,350/brand.image.height);const w=brand.image.width*ratio,h=brand.image.height*ratio;ctx.drawImage(brand.image,(1024-w)/2,(512-h)/2,w,h);}
    else{ctx.fillStyle=brand.color||'#3345a8';ctx.font='700 125px -apple-system, BlinkMacSystemFont, Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const label=brand.text||'YOUR BRAND';const size=Math.min(125,125*900/Math.max(ctx.measureText(label).width,1));ctx.font=`700 ${size}px Arial, sans-serif`;ctx.fillText(label,512,256);}
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;
  }
  function clearZone(id){for(const d of decals.get(id)||[]){scene.remove(d);d.geometry.dispose();d.material.map?.dispose();d.material.dispose();}decals.delete(id);}
  function apply(id,brand) {
    clearZone(id);const setting=config[id];if(!setting)return;
    model.updateMatrixWorld(true);
    const items=[];
    for(let part of setting.parts){if(['arm','thigh','shin'].includes(id)&&brand.side==='right')part=part.replace('left_','right_');const mesh=meshes.get(part);if(!mesh)continue;
      const box=new THREE.Box3().setFromObject(mesh);const size=box.getSize(new THREE.Vector3());const point=box.getCenter(new THREE.Vector3());point.y=box.min.y+size.y*setting.y;
      const direction=new THREE.Vector3(0,0,-setting.face);const start=point.clone();start.z=setting.face>0?box.max.z+.5:box.min.z-.5;ray.set(start,direction);
      const hit=ray.intersectObject(mesh,false)[0];if(!hit)continue;
      const normal=hit.face.normal.clone().transformDirection(mesh.matrixWorld);const orient=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal));orient.z+=(brand.rotation||0)*Math.PI/180;
      const s=brand.scale||1;const geometry=new DecalGeometry(mesh,hit.point.clone().addScaledVector(normal,.0012),orient,new THREE.Vector3(setting.width*s,setting.height*s,.075));
      const material=new THREE.MeshStandardMaterial({map:texture(brand),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,roughness:.56,metalness:0,side:THREE.DoubleSide});
      const d=new THREE.Mesh(geometry,material);d.renderOrder=5;scene.add(d);items.push(d);
    }
    decals.set(id,items);dirty=true;settleUntil=performance.now()+500;
    element.dataset.decals=String([...decals.values()].reduce((n,a)=>n+a.length,0));
  }
  function setBrand(id,brand){brands.set(id,{...brand});apply(id,brand);}
  function view(which){const angle=which==='back'?Math.PI:which==='side'?Math.PI/2:0;cameraTarget=new THREE.Vector3(Math.sin(angle)*height*2.48,height*.58,Math.cos(angle)*height*2.48);if(reduced){camera.position.copy(cameraTarget);cameraTarget=null;}settleUntil=performance.now()+1800;dirty=true;}
  function select(id){view(config[id]?.face===-1?'back':'front');}
  let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};cameraTarget=null;});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>7)return;
    const rect=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
    const hit=ray.intersectObjects([...meshes.values()],false)[0];if(!hit)return;
    let id=Object.keys(config).find(k=>config[k].parts.includes(hit.object.name));if(hit.object.name==='torso_link')id=camera.position.z<0?'back':'chest';if(id)options.onSelect?.(id);
  });
  controls.addEventListener('change',()=>{dirty=true;settleUntil=performance.now()+800;});
  function resize(){const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();dirty=true;}
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const intersection=new IntersectionObserver(e=>{visible=e[0].isIntersecting;dirty=true;});intersection.observe(element);
  function tick(now){if(disposed)return;requestAnimationFrame(tick);if(!visible||document.hidden)return;if(cameraTarget){camera.position.lerp(cameraTarget,.12);if(camera.position.distanceTo(cameraTarget)<.001)cameraTarget=null;dirty=true;}controls.update();if(dirty||now<settleUntil){renderer.render(scene,camera);dirty=false;}}
  requestAnimationFrame(tick);
  setBrand('chest',{text:options.hero?'BrainSNN':'YOUR BRAND',color:'#3c4caa',scale:1});
  setBrand('naming',{text:'by XIO',color:'#3d424a',scale:.8});
  renderer.render(scene,camera);element.dataset.ready='true';
  return {
    setBrand,setZone:select,view,
    reset(){for(const id of [...decals.keys()])clearZone(id);brands.clear();setBrand('chest',{text:'YOUR BRAND',color:'#3c4caa',scale:1});select('chest');},
    snapshot(){renderer.render(scene,camera);const c=document.createElement('canvas');c.width=renderer.domElement.width;c.height=renderer.domElement.height;const ctx=c.getContext('2d');ctx.fillStyle=options.dark?'#111318':'#f0f1f4';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(renderer.domElement,0,0);ctx.fillStyle=options.dark?'#aeb4c2':'#58606d';ctx.font='14px Arial';ctx.fillText('BrainSNN / Robot 001 / Concept preview, not an approved installation',20,c.height-20);const a=document.createElement('a');a.download='brainsnn-robot-001-concept.png';a.href=c.toDataURL('image/png');a.click();},
    async orbit(){const original=camera.position.clone();if(reduced)return;for(let i=0;i<90;i++){const a=i/90*Math.PI*2;camera.position.set(Math.sin(a)*height*2.48,height*.58,Math.cos(a)*height*2.48);controls.update();dirty=true;await new Promise(r=>setTimeout(r,16));}camera.position.copy(original);dirty=true;},
    dispose(){disposed=true;observer.disconnect();intersection.disconnect();controls.dispose();for(const id of decals.keys())clearZone(id);for(const m of meshes.values()){m.geometry.dispose();m.material.dispose();}environment.dispose();renderer.dispose();renderer.domElement.remove();}
  };
}
