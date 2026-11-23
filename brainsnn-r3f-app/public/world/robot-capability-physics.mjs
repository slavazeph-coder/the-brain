import {normalizeRobotCapability,robotCapabilityHash} from './robot-capability.mjs';
import {createCapabilityController,advanceCapabilityWaypoint} from './robot-capability-controller.mjs';
import {showroomEpisodeColliders} from './showroom-episode-physics.mjs';

const DT=.005,SAMPLE=.05,STEPS=10;
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),x=>x.toString(16).padStart(2,'0')).join('');

function initialHeading(scene) {
  const first=scene.route[0],next=scene.route.find(p=>Math.hypot(p[0]-first[0],p[1]-first[1])>.2)??scene.route.at(-1);
  return next?Math.atan2(next[1]-first[1],next[0]-first[0]):0;
}
export function capabilityActuatorLimits(input) {
  const p=normalizeRobotCapability(input),m=p.motor,total=p.body.massKg+p.body.payloadKg;
  const maxCurrent=m?Math.min(m.currentLimitA,m.voltageV/(m.resistanceOhm+(m.driverResistanceOhm??0))):null;
  const torque=m?Math.max(0,maxCurrent-(m.noLoadCurrentA??0))*m.torqueConstantNmPerA*m.gearRatio*m.efficiency:
    total*Math.max(p.limits.accelerationMps2,p.limits.brakingMps2)*p.drive.wheelRadiusM*.75;
  if(!(torque>0)&&p.drive.kind==='differential')throw Error('The motor limits leave no usable drive torque.');
  return {wheelTorqueNm:torque,planarForceN:Math.max(.001,2*torque/p.drive.wheelRadiusM),
    basis:m?'Declared motor current and resistive stall-voltage limits':'Assumed torque from mass and acceleration limits',
    speedDependentVoltageEnforced:false,thermalDeratingEnforced:false};
}
function colliderXML(scene) {
  const meshes=[],geoms=[],colors={object:'.28 .49 .49 1',unknown:'.54 .43 .28 1',wall:'.35 .38 .44 1',floor:'.72 .74 .76 1'};
  for(const {name,kind,polygon,bottom,top} of showroomEpisodeColliders(scene)) {
    const xs=polygon.map(p=>p[0]),zs=polygon.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
    const properties=`name="${name}" rgba="${colors[kind]}"`;
    if(polygon.length===4&&polygon.every(([x,z])=>(x===x0||x===x1)&&(z===z0||z===z1))) {
      geoms.push(`<geom ${properties} type="box" pos="${(x1+x0)/2} ${-(z0+z1)/2} ${(top+bottom)/2}" size="${(x1-x0)/2} ${(z1-z0)/2} ${(top-bottom)/2}"/>`);
    } else {
      const cx=(x1+x0)/2,cz=(z0+z1)/2,vertices=[bottom,top].flatMap(y=>polygon.flatMap(([x,z])=>[x-cx,cz-z,y]));
      meshes.push(`<mesh name="shape_${name}" vertex="${vertices.join(' ')}"/>`);
      geoms.push(`<geom ${properties} type="mesh" mesh="shape_${name}" pos="${cx} ${-cz} 0"/>`);
    }
  }
  return {meshes:meshes.join('\n'),geoms:geoms.join('\n')};
}

/** A free chassis with two driven wheel hinges; no sideways position or force command exists. */
export function makeRobotCapabilityMJCF(scene) {
  const p=normalizeRobotCapability(scene.robotCapability),{body:b,drive:d,limits:l}=p;
  const environment=colliderXML(scene),caps=capabilityActuatorLimits(p),[x,z]=scene.route[0],mass=b.massKg+b.payloadKg;
  const heading=initialHeading(scene),wheelMass=Math.min(mass*.03,2),r=d.wheelRadiusM;
  const wheelHalf=Math.min(.008,(b.width-d.wheelSeparationM)/2),casterR=Math.min(.025,r*.35,b.depth*.1);
  const clearance=Math.min(.025,b.height*.12),baseCenter=(b.height+clearance)/2-r;
  const wheelKV=Math.max(.02,Math.min(5,mass*r*r*8));
  const wheelSpeed=(l.speedMps+l.yawRateRps*d.wheelSeparationM/2)/r;
  const wheel=(name,y)=>`<body name="${name}_wheel" pos="0 ${y} 0"><joint name="${name}_axle" type="hinge" axis="0 1 0" damping=".002" armature=".002"/><geom name="${name}_tire" type="cylinder" size="${r} ${wheelHalf}" quat=".7071067811865476 .7071067811865476 0 0" mass="${wheelMass}" friction="1.2 .003 .0001" condim="4" rgba=".11 .14 .16 1"/></body>`;
  const differential=`<body name="capability_base" pos="${x} ${-z} ${r+.002}" quat="${Math.cos(-heading/2)} 0 0 ${Math.sin(-heading/2)}">
    <freejoint name="base_free"/>
    <geom name="robot_body" type="box" pos="0 0 ${baseCenter}" size="${b.depth/2} ${b.width/2} ${(b.height-clearance)/2}" mass="${mass-2*wheelMass}" rgba=".16 .55 .86 1"/>
    ${wheel('left',d.wheelSeparationM/2)}${wheel('right',-d.wheelSeparationM/2)}
    <geom name="front_support" type="sphere" pos="${b.depth*.38} 0 ${casterR-r}" size="${casterR}" mass="0" priority="1" friction=".001 .0001 .00001"/>
    <geom name="rear_support" type="sphere" pos="${-b.depth*.38} 0 ${casterR-r}" size="${casterR}" mass="0" priority="1" friction=".001 .0001 .00001"/>
  </body>`;
  const holonomic=`<body name="capability_base" pos="${x} ${-z} ${b.height/2}"><joint name="cart_x" type="slide" axis="1 0 0" damping=".5"/><joint name="cart_z" type="slide" axis="0 -1 0" damping=".5"/><geom name="robot_body" type="box" size="${b.depth/2} ${b.width/2} ${b.height/2}" mass="${mass}" rgba=".16 .55 .86 1"/></body>`;
  const actuators=d.kind==='differential'?['left','right'].map(name=>`<velocity name="${name}_drive" joint="${name}_axle" kv="${wheelKV}" ctrlrange="${-wheelSpeed} ${wheelSpeed}" forcerange="${-caps.wheelTorqueNm} ${caps.wheelTorqueNm}"/>`).join('\n'):
    ['x','z'].map(name=>`<velocity name="drive_${name}" joint="cart_${name}" kv="${Math.max(5,mass*8)}" ctrlrange="${-l.speedMps} ${l.speedMps}" forcerange="${-caps.planarForceN} ${caps.planarForceN}"/>`).join('\n');
  return `<mujoco model="brainsnn_robot_capability_v2"><compiler angle="radian"/><option timestep="${DT}" gravity="0 0 -9.81" integrator="implicitfast" iterations="60"/>
  <default><geom solref=".008 1" solimp=".95 .99 .001" friction=".8 .005 .0001"/></default>
  <asset>${environment.meshes}</asset><worldbody>${environment.geoms}${d.kind==='differential'?differential:holonomic}</worldbody><actuator>${actuators}</actuator></mujoco>`;
}
function id(model,kind,name){const ref=model[kind](name);try{return ref.id;}finally{ref.delete();}}
function contactsAt(data,robots,colliders) {
  const touched=new Set();if(!data.ncon)return touched;
  const list=data.contact;try{for(let i=0;i<data.ncon;i++){const c=list.get(i);if(!c)continue;try{
    const other=robots.has(c.geom1)?c.geom2:robots.has(c.geom2)?c.geom1:-1;
    if(c.efc_address>=0&&colliders.has(other))touched.add(colliders.get(other));
  }finally{c.delete();}}}finally{list.delete();}return touched;
}
function observe(data,profile,start,heading) {
  if(profile.drive.kind==='holonomic')return {position:[start[0]+data.qpos[0],start[1]+data.qpos[1]],positionXYZ:[start[0]+data.qpos[0],-start[1]-data.qpos[1],profile.body.height/2],heightMeters:profile.body.height/2,velocity:Array.from(data.qvel),headingRad:0,angularVelocityRadS:0,quaternionWxyz:[1,0,0,0],wheelPositionRad:[],wheelVelocityRadS:[],wheelTorqueNm:[]};
  const q=Array.from(data.qpos.subarray(3,7)),[w,x,y,z]=q;
  const yaw=Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z));
  return {position:[data.qpos[0],-data.qpos[1]],positionXYZ:Array.from(data.qpos.subarray(0,3)),heightMeters:data.qpos[2],velocity:[data.qvel[0],-data.qvel[1]],headingRad:-yaw,
    angularVelocityRadS:-data.qvel[5],quaternionWxyz:q,wheelPositionRad:Array.from(data.qpos.subarray(7,9)),
    wheelVelocityRadS:Array.from(data.qvel.subarray(6,8)),wheelTorqueNm:Array.from(data.actuator_force),
    rollPitchUp:1-2*(x*x+y*y),initialHeadingRad:heading};
}

export async function runRobotCapabilityEpisode(mj,input,{controller='waypoint',seed=7,maxSeconds=180}={}) {
  const robotCapability=normalizeRobotCapability(input.robotCapability);
  if(!['waypoint','mppi'].includes(controller))throw Error('Capability runs support waypoint or MPPI control.');
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isFinite(maxSeconds)||maxSeconds<.1||maxSeconds>180)throw Error('Invalid run seed or duration.');
  const scene=structuredClone({...input,robotCapability}),serialized=JSON.stringify(scene);
  if(serialized.length>2*1024**2)throw Error('Capability scene exceeds 2 MiB.');
  const modelXML=makeRobotCapabilityMJCF(scene),model=mj.MjModel.from_xml_string(modelXML);
  const capabilitySha256=await robotCapabilityHash(robotCapability),sceneSha256=await hash(scene);
  let data;
  try {
    data=new mj.MjData(model);
    const diff=robotCapability.drive.kind==='differential',heading=initialHeading(scene),start=scene.route[0],goal=scene.route.at(-1);
    const bodyNames=diff?['robot_body','left_tire','right_tire','front_support','rear_support']:['robot_body'];
    const robotGeoms=new Set(bodyNames.map(name=>id(model,'geom',name)));
    const obstacles=new Map(showroomEpisodeColliders(scene).filter(o=>o.kind!=='floor').map(o=>[id(model,'geom',o.name),o.name]));
    const control=createCapabilityController(robotCapability,scene,{mode:controller,seed});
    const frames=[],contactNames=new Set(),delaySamples=Math.ceil(robotCapability.limits.latencySeconds/SAMPLE),delayed=[];
    const goalRadius=.045,maxSamples=Math.floor(maxSeconds/SAMPLE);
    let waypoint=1,distanceMeters=0,reason='timeout',last=[...start],intervalContacts=new Set();
    mj.mj_forward(model,data);
    intervalContacts=contactsAt(data,robotGeoms,obstacles);
    for(let sample=0;sample<=maxSamples;sample++) {
      const state=observe(data,robotCapability,start,heading);
      if(![...state.position,...state.velocity,state.headingRad].every(Number.isFinite)||Math.abs(data.time-sample*SAMPLE)>1e-6)throw Error('Robot physics produced an invalid state.');
      waypoint=advanceCapabilityWaypoint(scene.route,{x:state.position[0],z:state.position[1]},waypoint);
      const target=[...scene.route[waypoint]],frame={time:sample*SAMPLE,...state,frameId:'map',childFrameId:'base_link',target,action:null,command:null,contacts:[...intervalContacts].sort()};
      frames.push(frame);for(const name of intervalContacts)contactNames.add(name);
      if(intervalContacts.size){reason='contact';break;}
      if(diff&&state.rollPitchUp<.6){reason='unstable';break;}
      const error=Math.hypot(goal[0]-state.position[0],goal[1]-state.position[1]);
      if(waypoint===scene.route.length-1&&error<=goalRadius&&Math.hypot(...state.velocity)<.08){reason='goal-reached';break;}
      if(sample===maxSamples)break;
      const proposed=control.command({x:state.position[0],z:state.position[1],heading:state.headingRad},waypoint,SAMPLE);
      delayed.push(proposed);const command=delayed.length>delaySamples?delayed.shift():[0,0];
      frame.command=command;
      const {wheelRadiusM:r,wheelSeparationM:separation}=robotCapability.drive;
      frame.action=diff?[(command[0]+command[1]*separation/2)/r,(command[0]-command[1]*separation/2)/r]:[...command];
      data.ctrl.set(frame.action);intervalContacts=new Set();
      for(let k=0;k<STEPS;k++) {
        mj.mj_step(model,data);
        for(const name of contactsAt(data,robotGeoms,obstacles))intervalContacts.add(name);
        const now=observe(data,robotCapability,start,heading).position;
        distanceMeters+=Math.hypot(now[0]-last[0],now[1]-last[1]);last=now;
      }
    }
    const lastFrame=frames.at(-1),limits=capabilityActuatorLimits(robotCapability);
    return {schema:'brainsnn.robot-capability-episode.v2',scene,sceneSha256,robotCapability,capabilitySha256,
      engine:{name:'MuJoCo',version:mj.mj_versionString()},modelXML,sampleIntervalSeconds:SAMPLE,timestepSeconds:DT,frames,
      frameId:'map',childFrameId:'base_link',frameConvention:{world:'right-handed-y-up',physics:'right-handed-z-up',roomToPhysics:'[x,-z,y]',quaternionOrder:'wxyz',heading:'room X toward room Z',position:'room [x,z] metres',positionXYZ:'right-handed-z-up [x,-roomZ,height] metres'},
      actuatorLimits:limits,controller:control.metadata,
      score:{success:reason==='goal-reached',reason,distanceMeters,finalErrorMeters:Math.hypot(lastFrame.position[0]-goal[0],lastFrame.position[1]-goal[1]),contactNames:[...contactNames].sort()},
      provenance:{physicsExecuted:true,learnedPolicyExecuted:false,physicalValidated:false,controllerKind:controller,
        controller:controller==='mppi'?'Sampled predictive control with an approximate profile-bound rollout':'Profile-bound waypoint feedback',
        geometry:'Reviewed floor proxies; convex footprint prisms, unknown areas blocked. Raw visual surfaces are not colliders.',
        cart:diff?'Free rigid chassis, two driven hinge wheels, assumed tire friction and passive low-friction supports.':'Planar holonomic force-limited box surrogate; not a mecanum hardware model.',
        coordinates:'Room X/Z maps to MuJoCo X/-Y. Quaternions are MuJoCo WXYZ in Z-up coordinates.',
        action:diff?'Two wheel velocity targets in rad/s, held until the next frame.':'Two planar velocity targets in m/s, held until the next frame.',
        wheelTorque:diff?'wheel torque in N m, simulated; native actuator_force at the latest integration step':'unavailable for planar force actuators',
        timing:'Sampled state precedes the next action. wheelTorqueNm describes the most recent physics step. Terminal action is null.',
        limits:['Parameters retain their declared sources; no independent hardware validation.','Predictive model omits wheel slip and actuator dynamics; MuJoCo evaluates contact dynamics.',
          'Motor saturation uses a constant current/stall-voltage torque cap. Back-EMF, thermal and battery feasibility require the separate drive analysis.',
          'Planar floor; no slope, stair, gait, suspension or trained policy qualification.'],
      }};
  }finally{data?.delete();model.delete();}
}
