import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {componentRestMatrix} from '../../public/world/operational-twin.mjs';
import {renderFrame,rebasePoint,sourcePoint,rebaseRestMatrix,rebaseWorldTransform,checkedClip,insideClip} from '../../public/world/render-frame.mjs';

/** Bounded component proxies and retained source points. No scan inference or dynamics. */
export function create(container,{parts,onSelect=()=>{},onView=()=>{},frame:sharedFrame=null,pointCloud=[]}){
  const {origin,span}=renderFrame(parts,pointCloud,sharedFrame);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0x080e18);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.localClippingEnabled=true;
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Component proxy and source point view. Drag to orbit, scroll to zoom. Arrow keys orbit, 0 resets. Select parts in the list or the view.');container.append(canvas);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.01,1000000),controls=new OrbitControls(camera,canvas);
  controls.enableDamping=false;const group=new THREE.Group();scene.add(group);
  scene.add(new THREE.HemisphereLight(0xdcefff,0x25334e,2.6));const light=new THREE.DirectionalLight(0xffffff,3.2);light.position.set(5,12,8);scene.add(light);
  const meshes=new Map(),rest=new Map(),ids=new Set(parts.map(p=>p.componentId)),materials=[],palette=[0x7688aa,0x8c82c4,0x72b4b2,0xb7a982,0x687dab,0xa38cab];
  parts.forEach((p,i)=>{if(!p.centre||!p.size)return;const material=new THREE.MeshStandardMaterial({color:p.floor?0x263645:palette[i%palette.length],roughness:.6,metalness:.18});
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(...p.size),material);mesh.matrix.fromArray(rebaseRestMatrix(componentRestMatrix(p),origin));mesh.matrixAutoUpdate=false;mesh.matrixWorldNeedsUpdate=true;
    mesh.userData={componentId:p.componentId,floor:p.floor};rest.set(p.componentId,mesh.matrix.clone());meshes.set(p.componentId,mesh);group.add(mesh);materials.push(material);
    const edgeMaterial=new THREE.LineBasicMaterial({color:0xd3e8ff,transparent:true,opacity:.17});materials.push(edgeMaterial);
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),edgeMaterial);mesh.add(edges);
  });
  const wholeBounds=new THREE.Box3().setFromObject(group),centre=new THREE.Vector3();
  let dots=null;
  if(pointCloud.length){const positions=[],colors=[];for(const p of pointCloud){positions.push(...rebasePoint(p,origin));const c=new THREE.Color((p[3]??150)/255,(p[4]??220)/255,(p[5]??210)/255).convertSRGBToLinear();colors.push(c.r,c.g,c.b);}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));const material=new THREE.PointsMaterial({size:span/400,vertexColors:true});materials.push(material);dots=new THREE.Points(geometry,material);scene.add(dots);}
  camera.near=Math.max(span/10000,.001);camera.far=span*100;camera.updateProjectionMatrix();
  const grid=new THREE.GridHelper(span*2,20,0x233b4c,0x132838);grid.position.set(0,wholeBounds.isEmpty()?-origin[1]:wholeBounds.min.y-.02,0);scene.add(grid);
  let disposed=false,frame=0,down=null,applyingView=false,selected=null,isolate=false,localClip=null;
  let presentation={mode:'overlay',opacity:1,visibleIds:null,clip:null};
  function draw(){if(disposed||document.hidden)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!disposed)renderer.render(scene,camera);});}
  // Three's attenuated point size is scaled by half the viewport height / depth.
  // Keep retained samples about 2.2 CSS pixels at the current focus distance,
  // rather than turning facility-scale samples into metre-wide equipment blobs.
  function updatePointSize(){if(dots)dots.material.size=4.4*Math.max(camera.position.distanceTo(controls.target),.000001)/Math.max(container.clientHeight,1);}
  function getView(){const offset=camera.position.clone().sub(controls.target),r=Math.max(offset.length(),.000001);return {yaw:Math.atan2(offset.x,offset.z),pitch:Math.asin(Math.max(-1,Math.min(1,offset.y/r))),zoom:span*1.8/r,target:sourcePoint(controls.target.toArray(),origin)};}
  function setView(v){if(![v.yaw,v.pitch,v.zoom,...(v.target??origin)].every(Number.isFinite)||v.zoom<=0)return;applyingView=true;try{const r=span*1.8/v.zoom;controls.target.set(...rebasePoint(v.target??origin,origin));camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(v.yaw)*Math.cos(v.pitch)*r,Math.sin(v.pitch)*r,Math.cos(v.yaw)*Math.cos(v.pitch)*r));camera.near=Math.max(r/10000,.00001);camera.far=Math.max(span*100,r*100);camera.updateProjectionMatrix();controls.update();updatePointSize();draw();}finally{applyingView=false;}}
  function reset(){setView({yaw:.65,pitch:.35,zoom:1,target:sourcePoint(centre.toArray(),origin)});onView(getView());}
  function changed(){updatePointSize();draw();if(!applyingView)onView(getView());}
  function resize(){if(disposed)return;const r=container.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();updatePointSize();draw();}
  function updatePresentation(){
    const visible=presentation.visibleIds===null?null:new Set(presentation.visibleIds);
    meshes.forEach((mesh,id)=>{mesh.visible=presentation.mode!=='scan'&&(presentation.mode!=='overlay'||presentation.opacity>0)&&(!visible||visible.has(id))&&(!isolate||id===selected||mesh.userData.floor);mesh.material.emissive.setHex(id===selected?0x117b80:0);mesh.material.emissiveIntensity=.65;const opacity=presentation.mode==='overlay'?presentation.opacity:1;mesh.material.opacity=opacity;mesh.material.transparent=opacity<1;mesh.material.depthWrite=opacity===1;mesh.material.needsUpdate=true;});
    if(dots)dots.visible=presentation.mode!=='model';draw();
  }
  function setPresentation(value={}){
    const next={...presentation,...value};
    if(!['scan','model','overlay'].includes(next.mode)||!Number.isFinite(next.opacity)||next.opacity<0||next.opacity>1)throw Error('Use scan, model or overlay with opacity from 0 to 1.');
    if(next.visibleIds!==null&&(!Array.isArray(next.visibleIds)||next.visibleIds.length>1024||next.visibleIds.some(id=>!ids.has(id))))throw Error('Use known component IDs for visibility.');
    next.visibleIds=next.visibleIds===null?null:[...next.visibleIds];next.clip=checkedClip(next.clip);
    localClip=next.clip?{min:rebasePoint(next.clip.min,origin),max:rebasePoint(next.clip.max,origin)}:null;
    const planes=localClip?[new THREE.Plane(new THREE.Vector3(1,0,0),-localClip.min[0]),new THREE.Plane(new THREE.Vector3(-1,0,0),localClip.max[0]),new THREE.Plane(new THREE.Vector3(0,1,0),-localClip.min[1]),new THREE.Plane(new THREE.Vector3(0,-1,0),localClip.max[1]),new THREE.Plane(new THREE.Vector3(0,0,1),-localClip.min[2]),new THREE.Plane(new THREE.Vector3(0,0,-1),localClip.max[2])]:null;
    materials.forEach(material=>{material.clippingPlanes=planes;material.needsUpdate=true;});presentation=next;updatePresentation();
  }
  function focus(id){
    const mesh=meshes.get(id);if(!mesh||disposed)return false;
    const box=new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(mesh.matrix);
    if(localClip)box.intersect(new THREE.Box3(new THREE.Vector3(...localClip.min),new THREE.Vector3(...localClip.max)));
    if(box.isEmpty())return false;
    const target=box.getCenter(new THREE.Vector3()),radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,.01),halfFov=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect)),distance=radius/Math.sin(halfFov)*1.2;
    const current=getView();camera.near=Math.max(distance/10000,.00001);camera.far=Math.max(span*100,distance*100);camera.updateProjectionMatrix();setView({...current,target:sourcePoint(target.toArray(),origin),zoom:span*1.8/distance});onView(getView());return true;
  }
  function pointerDown(e){down=e.button===0?[e.clientX,e.clientY]:null;}
  function pointerUp(e){if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;down=null;const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(2*(e.clientX-r.left)/r.width-1,1-2*(e.clientY-r.top)/r.height),camera);scene.updateMatrixWorld(true);const hit=ray.intersectObjects([...meshes.values()].filter(mesh=>mesh.visible),false).find(hit=>insideClip(hit.point.toArray(),localClip));if(hit)onSelect(hit.object.userData.componentId);}
  function key(e){if(e.key==='0'){e.preventDefault();reset();return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const offset=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(offset);if(e.key==='ArrowLeft')s.theta-=.12;if(e.key==='ArrowRight')s.theta+=.12;if(e.key==='ArrowUp')s.phi=Math.max(.1,s.phi-.12);if(e.key==='ArrowDown')s.phi=Math.min(Math.PI-.1,s.phi+.12);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();draw();}
  const observer=new ResizeObserver(resize);observer.observe(container);controls.addEventListener('change',changed);canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('keydown',key);document.addEventListener('visibilitychange',draw);reset();resize();
  return {
    select(id,only=false){selected=id;isolate=only;updatePresentation();},
    pose(matrices){meshes.forEach((mesh,id)=>{const transform=matrices[id]||new THREE.Matrix4().elements;mesh.matrix.copy(new THREE.Matrix4().fromArray(rebaseWorldTransform(transform,origin))).multiply(rest.get(id));mesh.matrixWorldNeedsUpdate=true;});draw();},
    setPresentation,focus,reset,getView,setView,
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.removeEventListener('change',changed);controls.dispose();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',draw);group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});dots?.geometry.dispose();dots?.material.dispose();grid.geometry.dispose();grid.material.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();},
  };
}
window.BrainSNNTwinRenderer={create};
