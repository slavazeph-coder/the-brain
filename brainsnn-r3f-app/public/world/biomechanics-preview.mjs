import {SHA} from './layer-preview.mjs';
export const BIOMECHANICS_PREVIEW_LIMIT=48*1024*1024;
const finite=(n,limit=1e6)=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=limit;
const vector=(a,n,limit)=>Array.isArray(a)&&a.length===n&&a.every(v=>finite(v,limit));
const same=(a,b)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));};
const falseFlags=['medical_validated','muscle_activations_estimated','ground_reaction_forces_estimated','forward_dynamics_executed'];
const wheelHashes=['4dfb85d175bcdb0bb4a6c567d8cf12f30afcbcec342bd356513a82403089df16','6bb4983097323e60326f6f102ee9f385e470deba6cb3a666219bf27aacbefb6d'];
function names(value,min,max){return Array.isArray(value)&&value.length>=min&&value.length<=max&&new Set(value).size===value.length&&value.every(n=>typeof n==='string'&&/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(n)&&!n.includes('..'));}
function frames(data,count,columns,size){return Array.isArray(data)&&data.length===count&&data.every(frame=>Array.isArray(frame)&&frame.length===columns&&frame.every(v=>vector(v,size)));}
function matrix(data,count,columns,limit){return Array.isArray(data)&&data.length===count&&data.every(frame=>vector(frame,columns,limit));}

/** Accept only bounded native OpenSim model results with explicit source and runtime bindings. */
export function validateBiomechanicsPreview(v,artifacts=null){
  if(v?.schema!=='brainsnn.biomechanics-preview.v1'||!['kinematics','inverse-dynamics'].includes(v.analysis)||v.coordinate_frame!=='right-handed-y-up'||falseFlags.some(k=>v[k]!==false))throw Error('Choose a supported model-based biomechanics preview without clinical or inferred-force claims.');
  if(v.runtime?.version!=='4.6'||typeof v.runtime.native_build!=='string'||!/^version 4\.6-2026-06-22-85aaf64(?:, build date [A-Za-z0-9 :]{1,60})?$/.test(v.runtime.native_build)||!wheelHashes.includes(v.runtime.wheel_sha256))throw Error('The OpenSim runtime is not the qualified version.');
  const binding=v.bindings,keys=['model_sha256','motion_sha256','options_sha256','analysis_model_sha256','runtime_manifest_sha256','loads_sha256'];
  if(!binding||Object.keys(binding).length!==keys.length||keys.slice(0,-1).some(k=>!SHA.test(binding[k]))||!(binding.loads_sha256===null||SHA.test(binding.loads_sha256)))throw Error('The analysis is missing its original-source bindings.');
  const n=v.time_s?.length;
  if(!Number.isInteger(n)||n<2||n>1800||!vector(v.time_s,n,1e8)||v.time_s.at(-1)-v.time_s[0]>60||v.time_s.some((t,i)=>i&&t-v.time_s[i-1]<1e-6))throw Error('Analysis needs 2–1,800 strictly ordered frames over at most 60 seconds.');
  if(!names(v.body_names,1,128)||!names(v.joint_names,1,128)||!names(v.coordinate_names,1,128)||!names(v.muscle_names,0,256)||!names(v.moment_arm_coordinate_names,0,4))throw Error('Invalid or excessive model component names.');
  const b=v.body_names.length,j=v.joint_names.length,c=v.coordinate_names.length,m=v.muscle_names.length,k=v.moment_arm_coordinate_names.length;
  if(b*n>100000||m*n*Math.max(1,k)>500000)throw Error('The preview exceeds the native model and frame budget.');
  if(!Array.isArray(v.body_parents)||v.body_parents.length!==b||v.body_parents.some((p,i)=>!Number.isInteger(p)||p< -1||p>=i)||!Array.isArray(v.joint_parent_bodies)||!Array.isArray(v.joint_child_bodies)||v.joint_parent_bodies.length!==j||v.joint_child_bodies.length!==j||j!==b||new Set(v.joint_child_bodies).size!==b||v.joint_child_bodies.some((child,i)=>!Number.isInteger(child)||child<0||child>=b||v.joint_parent_bodies[i]!==v.body_parents[child]))throw Error('Body and joint connections are inconsistent.');
  if(!frames(v.body_positions_m,n,b,3)||!frames(v.body_com_positions_m,n,b,3)||!frames(v.joint_positions_m,n,j,3)||!matrix(v.com_positions_m,n,3)||!frames(v.body_rotations_xyzw,n,b,4)||v.body_rotations_xyzw.some(frame=>frame.some(q=>Math.abs(q.reduce((s,x)=>s+x*x,0)-1)>1e-3)))throw Error('Invalid body positions, mass centres or rotations.');
  if(!finite(v.mass_kg,10000)||v.mass_kg<=0||!Array.isArray(v.coordinate_units)||v.coordinate_units.length!==c||v.coordinate_units.some(u=>!['rad','m'].includes(u))||!matrix(v.coordinate_values,n,c)||!matrix(v.muscle_lengths_m,n,m)||v.muscle_lengths_m.some(row=>row.some(x=>x<0))||!frames(v.moment_arms_m,n,m,k)||v.moment_arm_coordinate_names.some(name=>!v.coordinate_names.includes(name)||v.coordinate_units[v.coordinate_names.indexOf(name)]!=='rad'))throw Error('Invalid coordinate or muscle geometry channels.');
  if(v.analysis==='kinematics'){
    if(Object.hasOwn(v,'inverse_dynamics')||binding.loads_sha256!==null)throw Error('Kinematics cannot contain inverse-dynamics force claims.');
  }else{
    const d=v.inverse_dynamics;
    if(n<5||!same(d?.coordinate_names,v.coordinate_names)||!same(d?.units,v.coordinate_units.map(u=>u==='rad'?'N m':'N'))||!matrix(d?.generalized_forces,n,c,1e8)||!['supplied','none-declared'].includes(d?.external_loads_mode)||d.differentiation!=='cubic spline, no filtering'||(d.external_loads_mode==='supplied')!==(binding.loads_sha256!==null))throw Error('Inverse dynamics needs matching force channels and explicit load provenance.');
  }
  if(artifacts){
    const expected={'original-model.osim':'model_sha256','original-motion.mot':'motion_sha256','biomechanics-options.json':'options_sha256','analysis-model.osim':'analysis_model_sha256',...(binding.loads_sha256?{'external-loads.json':'loads_sha256'}:{})};
    for(const [name,key] of Object.entries(expected))if(artifacts.find(a=>a.name===name)?.sha256!==binding[key])throw Error('This preview does not match its original job files.');
  }
  return v;
}

export function validateBiomechanicsReport(report,preview,previewSha){
  if(report?.schema!=='brainsnn.biomechanics-report.v1'||!same(report.bindings,preview.bindings)||!same(report.runtime,preview.runtime)||report.preview_sha256!==previewSha||!SHA.test(previewSha)||report.analysis!==preview.analysis||report.frame_count!==preview.time_s.length||report.body_count!==preview.body_names.length||report.coordinate_count!==preview.coordinate_names.length||report.muscle_count!==preview.muscle_names.length||report.mass_kg!==preview.mass_kg||!finite(report.duration_s,60)||Math.abs(report.duration_s-(preview.time_s.at(-1)-preview.time_s[0]))>1e-8||!vector(report.gravity_m_s2,3,100)||Math.abs(report.gravity_m_s2[0])>1e-10||Math.abs(report.gravity_m_s2[2])>1e-10||report.gravity_m_s2[1]>0||[...falseFlags,'external_loads_physically_verified','subject_anatomy_verified','source_is_video','markerless_capture_executed','enable_executed'].some(k=>report[k]!==false))throw Error('The analysis receipt does not match this model preview.');
  const dynamics=preview.analysis==='inverse-dynamics';
  if(report.inverse_dynamics_executed!==dynamics||report.external_loads_mode!==(dynamics?preview.inverse_dynamics.external_loads_mode:null))throw Error('The analysis receipt changes the force assumptions.');
  if(report.external_loads_mode==='none-declared'&&(typeof report.external_loads_reason!=='string'||report.external_loads_reason.trim().length<20||report.external_loads_reason.length>500))throw Error('The no-contact declaration is missing.');
  return report;
}

export function biomechanicsSeries(value){
  const groups=[{id:'coordinates',label:'Joint coordinates',channels:value.coordinate_names.map((name,k)=>({name,unit:value.coordinate_units[k],at:i=>value.coordinate_values[i][k]}))},{id:'com',label:'Centre of mass',channels:['X','Y','Z'].map((name,k)=>({name,unit:'m',at:i=>value.com_positions_m[i][k]}))}];
  if(value.muscle_names.length)groups.push({id:'lengths',label:'Muscle path length',channels:value.muscle_names.map((name,k)=>({name,unit:'m',at:i=>value.muscle_lengths_m[i][k]}))});
  if(value.muscle_names.length&&value.moment_arm_coordinate_names.length)groups.push({id:'arms',label:'Muscle moment arm',channels:value.muscle_names.flatMap((name,m)=>value.moment_arm_coordinate_names.map((coordinate,k)=>({name:`${name} / ${coordinate}`,unit:'m',at:i=>value.moment_arms_m[i][m][k]})))});
  if(value.inverse_dynamics)groups.push({id:'forces',label:'Net joint force / moment',channels:value.inverse_dynamics.coordinate_names.map((name,k)=>({name,unit:value.inverse_dynamics.units[k],at:i=>value.inverse_dynamics.generalized_forces[i][k]}))});
  return groups;
}

/** Actual body origins, native mass centres and numeric channels, with no inferred anatomy. */
export function createBiomechanicsViewer({canvas,chart,metric,channel,value:readout,onFrame=()=>{}}){
  const ctx=canvas.getContext('2d'),plot=chart.getContext('2d');if(!ctx||!plot)throw Error('A canvas is required for movement analysis.');
  let data=null,groups=[],index=0,frame=0,playing=false,start=0,yaw=.35,drag=null,disposed=false,bounds=null;
  const controller=new AbortController(),signal=controller.signal;
  function size(element,context){const r=element.getBoundingClientRect(),dpr=Math.min(globalThis.devicePixelRatio||1,2);element.width=Math.max(1,Math.round(r.width*dpr));element.height=Math.max(1,Math.round(r.height*dpr));context.setTransform(dpr,0,0,dpr,0,0);context.fillStyle='#070b12';context.fillRect(0,0,r.width,r.height);return r;}
  function drawPlot(){
    const r=size(chart,plot);if(!data||r.width<10||r.height<10)return;
    const g=groups.find(g=>g.id===metric.value),ch=g?.channels[Number(channel.value)];if(!ch)return;
    const values=data.time_s.map((_,i)=>ch.at(i));let low=Math.min(...values),high=Math.max(...values);const padding=Math.max(1e-6,(high-low)*.12,Math.abs(high)*.02);low-=padding;high+=padding;
    const left=Math.min(75,r.width*.24),right=r.width-16,top=22,bottom=r.height-40,first=data.time_s[0],duration=data.time_s.at(-1)-first;
    const x=i=>left+(data.time_s[i]-first)/duration*(right-left),y=v=>bottom-(v-low)/(high-low)*(bottom-top);
    plot.strokeStyle='#34445b';plot.lineWidth=1;plot.beginPath();plot.moveTo(left,top);plot.lineTo(left,bottom);plot.lineTo(right,bottom);plot.stroke();
    plot.font='12px system-ui';plot.fillStyle='#aebcd0';plot.textAlign='right';plot.fillText(high.toPrecision(4),left-7,top+5);plot.fillText(low.toPrecision(4),left-7,bottom);plot.textAlign='left';plot.fillText(`${first.toFixed(2)} s`,left,r.height-13);plot.textAlign='right';plot.fillText(`${data.time_s.at(-1).toFixed(2)} s`,right,r.height-13);plot.fillText(ch.unit,right,15);
    plot.strokeStyle='#6ce9df';plot.lineWidth=2;plot.beginPath();values.forEach((v,i)=>i?plot.lineTo(x(i),y(v)):plot.moveTo(x(i),y(v)));plot.stroke();plot.strokeStyle='#c59bff';plot.beginPath();plot.moveTo(x(index),top);plot.lineTo(x(index),bottom);plot.stroke();plot.fillStyle='#ffe08a';plot.beginPath();plot.arc(x(index),y(values[index]),4,0,Math.PI*2);plot.fill();
    readout.textContent=`${ch.name}: ${values[index].toPrecision(6)} ${ch.unit} at ${data.time_s[index].toFixed(3)} s`;
  }
  function draw(){
    const r=size(canvas,ctx);if(!data||r.width<10||r.height<10)return;
    const scale=Math.min((r.width-70)/(bounds.span*1.45),(r.height-70)/(bounds.span*1.2)),project=p=>{const x=p[0]-bounds.center[0],y=p[1]-bounds.center[1],z=p[2]-bounds.center[2];return [r.width/2+(x*Math.cos(yaw)+z*Math.sin(yaw))*scale,r.height/2-y*scale+(z*Math.cos(yaw)-x*Math.sin(yaw))*scale*.14];};
    const line=(a,b,color,width=3)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(...project(a));ctx.lineTo(...project(b));ctx.stroke();};
    const dot=(p,color,radius)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(...project(p),radius,0,Math.PI*2);ctx.fill();};
    const origins=data.body_positions_m[index],centres=data.body_com_positions_m[index],joints=data.joint_positions_m[index];
    joints.forEach((p,j)=>{const parent=data.joint_parent_bodies[j],child=data.joint_child_bodies[j];if(parent>=0)line(centres[parent],p,'#44a5b5');line(p,centres[child],'#63e6df');dot(p,'#c196ff',5);});
    origins.forEach((p,i)=>{line(p,centres[i],'#70b9bf',1);dot(p,'#78e5e5',3);dot(centres[i],'#78e5e5',5);});dot(data.com_positions_m[index],'#ffe08a',7);
    ctx.fillStyle='#cbd5e5';ctx.font='13px system-ui';ctx.textAlign='left';ctx.fillText('OpenSim model · metres · Y up',14,r.height-15);drawPlot();onFrame(index,data.time_s[index]);
  }
  function pause(){playing=false;cancelAnimationFrame(frame);}
  function tick(now){if(!playing||disposed||!data)return;const t=(now-start)/1000;while(index+1<data.time_s.length&&data.time_s[index+1]-data.time_s[0]<=t)index++;draw();if(index===data.time_s.length-1){playing=false;return;}frame=requestAnimationFrame(tick);}
  function chooseChannels(){const group=groups.find(g=>g.id===metric.value);channel.replaceChildren(...(group?.channels||[]).map((c,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${c.name} · ${c.unit}`;return option;}));drawPlot();}
  metric.addEventListener('change',chooseChannels,{signal});channel.addEventListener('change',drawPlot,{signal});
  canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,yaw};canvas.setPointerCapture(e.pointerId);},{signal});canvas.addEventListener('pointermove',e=>{if(drag){yaw=drag.yaw+(e.clientX-drag.x)*.01;draw();}},{signal});for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>{drag=null;},{signal});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();yaw=e.key==='Home'?.35:yaw+(e.key==='ArrowLeft'?-.15:.15);draw();},{signal});
  const observer=new ResizeObserver(draw);observer.observe(canvas);observer.observe(chart);
  return {set(v){pause();data=validateBiomechanicsPreview(v);index=0;groups=biomechanicsSeries(data);const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<data.time_s.length;i++)for(const p of [...data.body_com_positions_m[i],...data.body_positions_m[i],...data.joint_positions_m[i],data.com_positions_m[i]])for(let d=0;d<3;d++){min[d]=Math.min(min[d],p[d]);max[d]=Math.max(max[d],p[d]);}bounds={center:min.map((v,i)=>(v+max[i])/2),span:Math.max(.1,...min.map((v,i)=>max[i]-v))};metric.replaceChildren(...groups.map(g=>{const option=document.createElement('option');option.value=g.id;option.textContent=g.label;return option;}));chooseChannels();draw();},play(){pause();if(!data)return;if(index===data.time_s.length-1)index=0;playing=true;start=performance.now()-(data.time_s[index]-data.time_s[0])*1000;frame=requestAnimationFrame(tick);},pause,seek(i){pause();if(!data)return;index=Math.max(0,Math.min(data.time_s.length-1,Math.round(i)));draw();},clear(){pause();data=null;groups=[];metric.replaceChildren();channel.replaceChildren();readout.textContent='';size(canvas,ctx);size(chart,plot);},dispose(){disposed=true;pause();observer.disconnect();controller.abort();}};
}
