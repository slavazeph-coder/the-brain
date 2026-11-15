import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {componentRestMatrix} from '../../public/world/operational-twin.mjs';

/** Bounded component proxies. No scan inference, collision detection or dynamics. */
export function create(container,{parts,onSelect=()=>{},onView=()=>{},frame:sharedFrame=null,pointCloud=[]}){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0x080e18);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Component proxy view. Drag to orbit, scroll to zoom. Arrow keys orbit, 0 resets. Select parts in the list or the view.');container.append(canvas);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.01,1000000),controls=new OrbitControls(camera,canvas);
  controls.enableDamping=false;const group=new THREE.Group();scene.add(group);
  scene.add(new THREE.HemisphereLight(0xdcefff,0x25334e,2.6));const light=new THREE.DirectionalLight(0xffffff,3.2);light.position.set(5,12,8);scene.add(light);
  const meshes=new Map(),rest=new Map(),palette=[0x7688aa,0x8c82c4,0x72b4b2,0xb7a982,0x687dab,0xa38cab];
  parts.forEach((p,i)=>{if(!p.centre||!p.size)return;const material=new THREE.MeshStandardMaterial({color:p.floor?0x263645:palette[i%palette.length],roughness:.6,metalness:.18});
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(...p.size),material);mesh.matrix.fromArray(componentRestMatrix(p));mesh.matrixAutoUpdate=false;mesh.matrixWorldNeedsUpdate=true;
    mesh.userData={componentId:p.componentId,floor:p.floor};rest.set(p.componentId,mesh.matrix.clone());meshes.set(p.componentId,mesh);group.add(mesh);
    const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:0xd3e8ff,transparent:true,opacity:.17}));mesh.add(edges);
  });
  const wholeBounds=new THREE.Box3().setFromObject(group),bounds=new THREE.Box3();meshes.forEach(mesh=>{if(!mesh.userData.floor)bounds.expandByObject(mesh);});if(bounds.isEmpty())bounds.copy(wholeBounds);
  const centre=sharedFrame?new THREE.Vector3(...sharedFrame.centre):bounds.isEmpty()?new THREE.Vector3():bounds.getCenter(new THREE.Vector3()),span=sharedFrame?.span??(bounds.isEmpty()?5:Math.max(...bounds.getSize(new THREE.Vector3()).toArray(),1));
  let dots=null;
  if(pointCloud.length){const positions=[],colors=[];for(const p of pointCloud){positions.push(...p.slice(0,3));const c=new THREE.Color((p[3]??150)/255,(p[4]??220)/255,(p[5]??210)/255).convertSRGBToLinear();colors.push(c.r,c.g,c.b);}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));dots=new THREE.Points(geometry,new THREE.PointsMaterial({size:span/400,vertexColors:true}));scene.add(dots);}
  camera.near=Math.max(span/10000,.001);camera.far=span*100;camera.updateProjectionMatrix();
  const grid=new THREE.GridHelper(span*2,20,0x233b4c,0x132838);grid.position.set(centre.x,wholeBounds.isEmpty()?0:wholeBounds.min.y-.02,centre.z);scene.add(grid);
  let disposed=false,frame=0,down=null,applyingView=false;
  function draw(){if(disposed||document.hidden)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!disposed)renderer.render(scene,camera);});}
  function getView(){const offset=camera.position.clone().sub(controls.target),r=Math.max(offset.length(),.000001);return {yaw:Math.atan2(offset.x,offset.z),pitch:Math.asin(Math.max(-1,Math.min(1,offset.y/r))),zoom:span*1.8/r,target:controls.target.toArray()};}
  function setView(v){if(![v.yaw,v.pitch,v.zoom,...(v.target??centre.toArray())].every(Number.isFinite)||v.zoom<=0)return;applyingView=true;try{const r=span*1.8/v.zoom;controls.target.set(...(v.target??centre.toArray()));camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(v.yaw)*Math.cos(v.pitch)*r,Math.sin(v.pitch)*r,Math.cos(v.yaw)*Math.cos(v.pitch)*r));controls.update();draw();}finally{applyingView=false;}}
  function reset(){setView({yaw:.65,pitch:.35,zoom:1,target:centre.toArray()});onView(getView());}
  function changed(){draw();if(!applyingView)onView(getView());}
  function resize(){if(disposed)return;const r=container.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();draw();}
  function pointerDown(e){down=e.button===0?[e.clientX,e.clientY]:null;}
  function pointerUp(e){if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;down=null;const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(2*(e.clientX-r.left)/r.width-1,1-2*(e.clientY-r.top)/r.height),camera);const hit=ray.intersectObjects([...meshes.values()],false)[0];if(hit)onSelect(hit.object.userData.componentId);}
  function key(e){if(e.key==='0'){e.preventDefault();reset();return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const offset=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(offset);if(e.key==='ArrowLeft')s.theta-=.12;if(e.key==='ArrowRight')s.theta+=.12;if(e.key==='ArrowUp')s.phi=Math.max(.1,s.phi-.12);if(e.key==='ArrowDown')s.phi=Math.min(Math.PI-.1,s.phi+.12);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();draw();}
  const observer=new ResizeObserver(resize);observer.observe(container);controls.addEventListener('change',changed);canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('keydown',key);document.addEventListener('visibilitychange',draw);reset();resize();
  return {
    select(id,isolate=false){meshes.forEach((mesh,key)=>{mesh.visible=!isolate||key===id||mesh.userData.floor;mesh.material.emissive.setHex(key===id?0x117b80:0);mesh.material.emissiveIntensity=.65;});draw();},
    pose(matrices){meshes.forEach((mesh,id)=>{mesh.matrix.copy(new THREE.Matrix4().fromArray(matrices[id]||new THREE.Matrix4().elements)).multiply(rest.get(id));mesh.matrixWorldNeedsUpdate=true;});draw();},
    reset,getView,setView,
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.removeEventListener('change',changed);controls.dispose();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',draw);group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});dots?.geometry.dispose();dots?.material.dispose();grid.geometry.dispose();grid.material.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();},
  };
}
window.BrainSNNTwinRenderer={create};
