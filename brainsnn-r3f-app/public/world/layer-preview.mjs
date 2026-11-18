export const SHA=/^[a-f0-9]{64}$/;
const finite=(n,limit=100000)=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=limit;
const vector=(a,n,limit)=>Array.isArray(a)&&a.length===n&&a.every(v=>finite(v,limit));
export async function hashBytes(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function jsonBytes(buffer,limit=32*1024*1024){if(!(buffer instanceof ArrayBuffer)||!buffer.byteLength||buffer.byteLength>limit)throw Error('This result exceeds its preview limit.');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}

export function validateMotionPreview(value) {
  if(value?.schema!=='brainsnn.motion-preview.v1'||value.role!=='motion-reference'||value.units!=='m'||value.coordinate_frame!=='right-handed-y-up'||!SHA.test(value.source_sha256)||value.robot_control_enabled!==false||value.physics_executed!==false)throw Error('Choose a supported motion reference preview.');
  if(value.runtime_commit!=='cbdb2b494a2af82137bf9b6f15122d60167281c4'||['model_sha256','configuration_sha256','csv_sha256'].some(k=>!SHA.test(value[k])))throw Error('The motion runtime or source binding is unsupported.');
  const count=value.frame_count,fps=value.fps;
  if(!Number.isInteger(count)||count<2||count>1800||!finite(fps,240)||fps<1||!vector(value.frame_times_seconds,count,61))throw Error('Motion timing is invalid or too long.');
  if(!finite(value.duration_seconds,60)||Math.abs(value.duration_seconds-(count-1)/fps)>1e-5)throw Error('Motion duration does not match its frame rate.');
  for(let i=0;i<count;i++)if(Math.abs(value.frame_times_seconds[i]-i/fps)>1e-5)throw Error('Motion frames must use their recorded timing.');
  for(const track of [value.human,value.robot]) {
    const names=track?.joint_names,parents=track?.parents,frames=track?.positions;
    if(!Array.isArray(names)||!names.length||names.length>200||new Set(names).size!==names.length||names.some(n=>typeof n!=='string'||n.length<1||n.length>160)||!Array.isArray(parents)||parents.length!==names.length||parents.some((p,i)=>!Number.isInteger(p)||p< -1||p>=i)||!Array.isArray(frames)||frames.length!==count)throw Error('Motion skeleton hierarchy is invalid.');
    for(const frame of frames)if(!Array.isArray(frame)||frame.length!==names.length||frame.some(p=>!vector(p,3,1000)))throw Error('Motion joint positions are invalid.');
  }
  if(value.robot.target!=='unitree_g1'||!Array.isArray(value.joint_order)||value.joint_order.length!==29||new Set(value.joint_order).size!==29||value.joint_order.some(n=>typeof n!=='string'||n.length>160)||!Array.isArray(value.joint_angles_rad)||value.joint_angles_rad.length!==count||value.joint_angles_rad.some(row=>!vector(row,29,100)))throw Error('The motion does not match the supported G1 joint profile.');
  return value;
}

const SCENE_TO_MAP=[[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]];
const close=(a,b)=>Math.abs(a-b)<1e-6;
function rigid(m) {
  if(!Array.isArray(m)||m.length!==4||m.some(r=>!vector(r,4))||m[3].some((v,i)=>!close(v,i===3?1:0)))return false;
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(!close(m[i].slice(0,3).reduce((s,v,k)=>s+v*m[j][k],0),i===j?1:0))return false;
  const d=m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);return close(d,1);
}
export function validateLocalizationMap(value) {
  if(value?.schema!=='brainsnn.localization-map.v1'||value.units!=='m'||!SHA.test(value.mapSha256)||!SHA.test(value.revisionSha256)||!SHA.test(value.source?.scanSha256))throw Error('Choose a localization map bundle.');
  const source=value.source;
  if(source.mode==='scan-local') {if(['sceneSha256','cloudPointsSha256','componentRevision'].some(k=>source[k]!==null))throw Error('A scan-local map cannot borrow a building model.');}
  else if(source.mode!=='scene-bound'||!SHA.test(source.sceneSha256)||!SHA.test(source.cloudPointsSha256)||!Number.isInteger(source.componentRevision)||source.componentRevision<0)throw Error('The localization map source is invalid.');
  if(JSON.stringify(value.frames?.sceneToMap)!==JSON.stringify(SCENE_TO_MAP)||value.frames?.mapFrame!=='map'||value.frames?.sceneFrame!=='right-handed-y-up'||!/^[-\w/]{1,120}$/.test(value.frames?.baseFrame||'')||!['right-handed-y-up','right-handed-z-up'].includes(value.frames.sourceFrame))throw Error('Unsupported map coordinate frame.');
  for(const key of ['sourceToScene','sourceToMap'])if(!rigid(value.frames[key]))throw Error('Invalid rigid map transform.');
  for(let i=0;i<4;i++)for(let j=0;j<4;j++)if(!close(value.frames.sourceToMap[i][j],SCENE_TO_MAP[i].reduce((s,v,k)=>s+v*value.frames.sourceToScene[k][j],0)))throw Error('The map transform chain is inconsistent.');
  if(source.mode==='scan-local'){
    const expected=value.frames.sourceFrame==='right-handed-y-up'?[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]:[[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]];
    if(value.frames.sourceToScene.some((r,i)=>r.some((v,j)=>!close(v,expected[i][j]))))throw Error('A scan-local map must retain the scan’s coordinates.');
  }
  if(value.validation?.metricVerified!==false||value.validation?.physicalRobotValidated!==false||value.validation?.localizationValidated!==false)throw Error('Packaging a map cannot certify robot accuracy.');
  for(const name of ['localization-map.pcd','localization-map.ply'])if(!SHA.test(value.artifacts?.[name]?.sha256)||!Number.isSafeInteger(value.artifacts[name].bytes)||value.artifacts[name].bytes<1||value.artifacts[name].bytes>32*1024*1024)throw Error('Invalid localization map artifact.');
  if(value.mapSha256!==value.artifacts['localization-map.pcd'].sha256)throw Error('Map digest does not match the localization map.');
  return value;
}
export function localizationBinding(bundle,bundleSha256) {
  validateLocalizationMap(bundle);if(!SHA.test(bundleSha256))throw Error('The map bundle needs its exact digest.');
  return {bundleSha256,mapSha256:bundle.mapSha256,sourceMode:bundle.source.mode,...Object.fromEntries(['scanSha256','sceneSha256','cloudPointsSha256','componentRevision'].map(k=>[k,bundle.source[k]])),mapFrame:bundle.frames.mapFrame,baseFrame:bundle.frames.baseFrame};
}
export function validateLocalizationSample(sample) {
  if(typeof sample?.timestampNs!=='string'||!/^[1-9][0-9]{0,19}$/.test(sample.timestampNs)||!finite(sample.t,86400)||sample.t<0||!vector(sample.position,3)||!vector(sample.quaternion,4,1.001)||Math.abs(sample.quaternion.reduce((n,x)=>n+x*x,0)-1)>1e-3||!vector(sample.covariance,36,1e6)||[0,7,14,21,28,35].some(i=>sample.covariance[i]<0)||!['tracking','weak','odometry-only','lost'].includes(sample.state))throw Error('Localization pose or tracking state is invalid.');
  const diag=sample.diagnostics,keys=['level','failureCategory','reinitializationRequested','statusTimestampNs','poseSource'];
  if(!diag||Object.keys(diag).length!==keys.length||keys.some(k=>!Object.hasOwn(diag,k))||!Number.isInteger(diag.level)||diag.level<0||diag.level>3||typeof diag.reinitializationRequested!=='boolean'||typeof diag.failureCategory!=='string'||diag.failureCategory.length>80||typeof diag.statusTimestampNs!=='string'||!/^[1-9][0-9]{0,19}$/.test(diag.statusTimestampNs)||!['pcl_pose','odom_bridge_pose'].includes(diag.poseSource))throw Error('Missing or invalid localization diagnostics.');
  const age=BigInt(diag.statusTimestampNs)-BigInt(sample.timestampNs);
  if(age>500000000n||age< -500000000n)throw Error('Localization diagnostics are stale.');
  if(sample.state==='tracking'&&(diag.level!==0||diag.reinitializationRequested||diag.poseSource!=='pcl_pose'||!['','healthy','none'].includes(diag.failureCategory)))throw Error('Tracking claim disagrees with diagnostics.');
  if(diag.poseSource==='odom_bridge_pose'&&sample.state!=='odometry-only')throw Error('Motion prediction must remain separate from localization.');
  return sample;
}
export function validateLocalizationRecording(value,expected) {
  if(value?.schema!=='brainsnn.localization-recording.v1'||!expected||Object.keys(expected).length!==Object.keys(value.binding||{}).length||Object.keys(expected).some(k=>value.binding[k]!==expected[k]))throw Error('This recording belongs to another map or revision.');
  if(value.runtime?.engine!=='lidar_localization_ros2'||value.runtime.upstreamCommit!=='6e21b7ed9e2e5c5ba1452eb63db5c9402862625b'||!['recorded-ros2','authored-ros2-test'].includes(value.runtime.origin)||value.validation?.physicalRobotValidated!==false||value.validation?.accuracyVerified!==false||value.validation?.producerAttested!==false)throw Error('Unsupported localization recording or validation claim.');
  if(!Array.isArray(value.samples)||!value.samples.length||value.samples.length>20000)throw Error('The recording needs 1–20,000 poses.');
  let first=null,last=0n;
  for(const sample of value.samples) {
    validateLocalizationSample(sample);const stamp=BigInt(sample.timestampNs);first??=stamp;
    if(stamp<=last||Math.abs(sample.t-Number(stamp-first)/1e9)>1e-5)throw Error('Recording timestamps are stale or inconsistent.');last=stamp;
  }
  return value;
}

export function validateLocalizationTelemetry(value,expected) {
  if(value?.schema!=='brainsnn.localization-telemetry.v1'||!expected||Object.keys(expected).length!==Object.keys(value.binding||{}).length||Object.keys(expected).some(k=>value.binding[k]!==expected[k]))throw Error('The live stream belongs to another map or revision.');
  if(value.runtime?.engine!=='lidar_localization_ros2'||value.runtime.upstreamCommit!=='6e21b7ed9e2e5c5ba1452eb63db5c9402862625b'||!['recorded-ros2','authored-ros2-test'].includes(value.runtime.origin)||!['tracking','weak','odometry-only','lost','stale','stopped'].includes(value.state))throw Error('Unsupported localization stream.');
  if(value.sample!==null)validateLocalizationSample(value.sample);
  if(['tracking','weak','odometry-only','lost'].includes(value.state)&&(!value.sample||value.sample.state!==value.state)||['stale','stopped'].includes(value.state)&&value.sample!==null)throw Error('Live pose and tracking status disagree.');
  return value;
}

/** Top-down measured-map review. Display updates never alter routes or send commands. */
export function createLocalizationViewer(canvas,onFrame=()=>{}) {
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('A canvas is required for localization review.');
  let points=null,recording=null,current=null,index=0,frame=0,playing=false,start=0,disposed=false,override=null;
  function draw() {
    const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,r.width*dpr);canvas.height=Math.max(1,r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#070b12';ctx.fillRect(0,0,r.width,r.height);
    if(!points)return;
    const xs=[],ys=[];for(let i=0;i<points.length;i+=14){xs.push(points[i]);ys.push(points[i+1]);}
    const path=recording?.samples||[];for(const s of path){xs.push(s.position[0]);ys.push(s.position[1]);}if(current){xs.push(current.position[0]);ys.push(current.position[1]);}
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const x of xs){minX=Math.min(minX,x);maxX=Math.max(maxX,x);}for(const y of ys){minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const scale=Math.min((r.width-48)/Math.max(1,maxX-minX),(r.height-48)/Math.max(1,maxY-minY));
    const project=p=>[r.width/2+(p[0]-(minX+maxX)/2)*scale,r.height/2-(p[1]-(minY+maxY)/2)*scale];
    ctx.fillStyle='#28686d';const step=Math.max(1,Math.ceil(points.length/14/20000));for(let i=0;i<points.length;i+=14*step){const p=project([points[i],points[i+1]]);ctx.fillRect(p[0],p[1],2,2);}
    if(path.length){ctx.strokeStyle='#91a9c2';ctx.lineWidth=2;ctx.beginPath();path.forEach((s,i)=>{const p=project(s.position);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.stroke();}
    if(current){const state=override||current.state,p=project(current.position),valid=state==='tracking';ctx.strokeStyle=valid?'#61ead2':state==='weak'?'#ffd074':'#b4b8c6';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=3;ctx.beginPath();ctx.arc(...p,8,0,Math.PI*2);if(valid)ctx.fill();else ctx.stroke();
      const [x,y,z,w]=current.quaternion,yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z));ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(p[0]+Math.cos(yaw)*21,p[1]-Math.sin(yaw)*21);ctx.stroke();
      onFrame(index,current.t,state);
    }
    ctx.fillStyle='#cbd5e5';ctx.font='14px system-ui';ctx.textAlign='left';ctx.fillText('Measured map · top view · metres',16,r.height-14);
  }
  function pause(){playing=false;cancelAnimationFrame(frame);}
  function tick(now){if(!playing||disposed)return;const t=(now-start)/1000;while(index+1<recording.samples.length&&recording.samples[index+1].t<=t)index++;current=recording.samples[index];draw();if(index===recording.samples.length-1){playing=false;return;}frame=requestAnimationFrame(tick);}
  const resize=new ResizeObserver(draw);resize.observe(canvas);
  return {setMap(p){pause();points=p;recording=null;current=null;override=null;draw();},setRecording(r){pause();recording=r;index=0;current=r.samples[0];override=null;draw();},seek(i){pause();if(!recording)return;index=Math.max(0,Math.min(recording.samples.length-1,Math.round(i)));current=recording.samples[index];override=null;draw();},play(){pause();if(!recording)return;if(index>=recording.samples.length-1)index=0;playing=true;start=performance.now()-recording.samples[index].t*1000;frame=requestAnimationFrame(tick);},pause,setLive(sample,state){pause();recording=null;current=sample;override=state;draw();},markStale(){pause();override='stale';draw();},clear(){pause();points=null;recording=null;current=null;draw();},dispose(){disposed=true;pause();resize.disconnect();}};
}

/** Lightweight articulated reference viewer. It displays joints; it never commands a robot. */
export function createMotionViewer(canvas,onFrame=()=>{}) {
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('A canvas is required for motion review.');
  let motion=null,index=0,playing=false,frame=0,start=0,disposed=false,yaw=.35,drag=null;
  const draw=()=>{
    const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,r.width*dpr);canvas.height=Math.max(1,r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#070b12';ctx.fillRect(0,0,r.width,r.height);
    if(!motion)return;
    const tracks=[motion.human,motion.robot],colors=['#55e8e8','#c194ff'];
    tracks.forEach((track,k)=>{
      const positions=track.positions[index],root=positions[0],height=Math.max(1.8,...positions.map(p=>p[1]-root[1]+1)),scale=Math.min(r.height/(height+1),r.width/6.5),cx=r.width*(k?.72:.28),cy=r.height*.76;
      const project=p=>{const x=p[0]-root[0],z=p[2]-root[2];return [cx+(x*Math.cos(yaw)+z*Math.sin(yaw))*scale,cy-(p[1]-root[1]+.9)*scale+(z*Math.cos(yaw)-x*Math.sin(yaw))*scale*.12];};
      ctx.strokeStyle=colors[k];ctx.fillStyle=colors[k];ctx.lineWidth=3;
      positions.forEach((p,j)=>{const q=project(p),parent=track.parents[j];if(parent>=0){const a=project(positions[parent]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...q);ctx.stroke();}ctx.beginPath();ctx.arc(...q,3,0,Math.PI*2);ctx.fill();});
      ctx.font='15px system-ui';ctx.textAlign='center';ctx.fillText(k?'Robot reference':'Human motion',cx,r.height-18);
    });
    onFrame(index,motion.frame_times_seconds[index]);
  };
  const tick=now=>{if(!playing||disposed)return;index=Math.min(motion.frame_count-1,Math.floor((now-start)/1000*motion.fps));draw();if(index===motion.frame_count-1){playing=false;return;}frame=requestAnimationFrame(tick);};
  const stop=()=>{playing=false;cancelAnimationFrame(frame);};
  const controller=new AbortController(),signal=controller.signal;
  canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,yaw};canvas.setPointerCapture(e.pointerId);},{signal});
  canvas.addEventListener('pointermove',e=>{if(drag){yaw=drag.yaw+(e.clientX-drag.x)*.01;draw();}},{signal});
  canvas.addEventListener('pointerup',()=>{drag=null;},{signal});canvas.addEventListener('pointercancel',()=>{drag=null;},{signal});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();yaw=e.key==='Home'?.35:yaw+(e.key==='ArrowLeft'?-.15:.15);draw();},{signal});
  const resize=new ResizeObserver(draw);resize.observe(canvas);
  return {set(value){stop();motion=validateMotionPreview(value);index=0;draw();},seek(i){stop();index=Math.max(0,Math.min(motion?.frame_count-1||0,Math.round(i)));draw();},play(){stop();if(!motion)return;if(index>=motion.frame_count-1)index=0;playing=true;start=performance.now()-index/motion.fps*1000;frame=requestAnimationFrame(tick);},pause:stop,clear(){stop();motion=null;index=0;draw();},dispose(){disposed=true;stop();controller.abort();resize.disconnect();}};
}
