// A free rolling pin, two independently actuated friction pads and a fixed baking tray.
const DT = .002, SAMPLE_STEPS = 25, SAMPLE = DT * SAMPLE_STEPS, DURATION = 6;
const HOME_X = -.18, HOME_Z = .15, TRAY_X = .18;
export const KITCHEN_PIN_MJCF = `<mujoco model="rolling_pin_delivery">
  <compiler angle="radian"/>
  <option timestep=".002" gravity="0 0 -9.81" integrator="implicitfast" iterations="60"/>
  <default>
    <geom solref=".006 1" solimp=".92 .98 .002" friction=".9 .015 .001" rgba=".7 .77 .78 1"/>
    <joint damping=".35" armature=".002"/>
  </default>
  <worldbody>
    <light pos="0 -.4 1.2" dir="0 .25 -1"/>
    <camera name="kitchen_side" pos="0 -.8 .5" xyaxes="1 0 0 0 .47 .88"/>
    <geom name="worktop" type="box" pos="0 0 -.02" size=".44 .26 .02" rgba=".32 .35 .4 1"/>
    <body name="baking_tray" pos=".18 0 0">
      <geom name="tray_base" type="box" pos="0 0 .006" size=".111 .165 .006" rgba=".53 .69 .72 1"/>
      <geom name="tray_left" type="box" pos="-.108 0 .015" size=".003 .165 .015"/>
      <geom name="tray_right" type="box" pos=".108 0 .015" size=".003 .165 .015"/>
      <geom name="tray_front" type="box" pos="0 -.162 .015" size=".105 .003 .015"/>
      <geom name="tray_back" type="box" pos="0 .162 .015" size=".105 .003 .015"/>
    </body>
    <body name="rolling_pin" pos="-.18 0 .027">
      <freejoint/>
      <geom name="pin_barrel" type="cylinder" fromto="0 -.082 0 0 .082 0" size=".026" mass=".19" rgba=".86 .57 .29 1"/>
      <geom name="pin_handles" type="capsule" fromto="0 -.123 0 0 .123 0" size=".011" mass=".025" rgba=".62 .38 .17 1"/>
    </body>
    <body name="gripper" pos="-.18 0 .15" gravcomp="1">
      <joint name="carriage" type="slide" axis="1 0 0" range="-.04 .42"/>
      <joint name="elevator" type="slide" axis="0 0 1" range="-.13 .03"/>
      <geom name="jaw_bridge" type="box" pos="0 0 .06" size=".082 .02 .007" mass=".32" rgba=".25 .53 .69 1"/>
      <body name="left_jaw" pos="-.07 0 0" gravcomp="1">
        <joint name="left_slide" type="slide" axis="1 0 0" range="0 .052"/>
        <geom name="left_pad" type="box" size=".009 .044 .02" mass=".05" friction="1.1 .015 .001" rgba=".36 .81 .93 1"/>
      </body>
      <body name="right_jaw" pos=".07 0 0" gravcomp="1">
        <joint name="right_slide" type="slide" axis="-1 0 0" range="0 .052"/>
        <geom name="right_pad" type="box" size=".009 .044 .02" mass=".05" friction="1.1 .015 .001" rgba=".36 .81 .93 1"/>
      </body>
    </body>
  </worldbody>
  <actuator>
    <position name="slide_across" joint="carriage" kp="650" kv="40" ctrlrange="-.04 .42" forcerange="-28 28"/>
    <position name="lift" joint="elevator" kp="700" kv="40" ctrlrange="-.13 .03" forcerange="-28 28"/>
    <position name="close_left" joint="left_slide" kp="650" kv="5" ctrlrange="0 .052" forcerange="-9 9"/>
    <position name="close_right" joint="right_slide" kp="650" kv="5" ctrlrange="0 .052" forcerange="-9 9"/>
  </actuator>
</mujoco>
`;

function ramp(t, start, end) {
  const v = Math.min(1, Math.max(0, (t-start)/(end-start)));
  return v*v*(3-2*v);
}
function targets(t, grip) {
  const x=(TRAY_X-HOME_X)*ramp(t,2.15,3.45);
  const z=(.027-HOME_Z)*(ramp(t,.05,.8)-ramp(t,1.35,2.05))+
    (.042-HOME_Z)*(ramp(t,3.5,4.2)-ramp(t,4.85,5.55));
  const pinch=grip ? .046*(ramp(t,.82,1.16)-ramp(t,4.3,4.67)) : 0;
  return [x,z,pinch,pinch];
}
function lookup(model, kind, name) {
  const ref = model[kind](name);
  try {return ref.id;} finally {ref.delete();}
}
function activeContacts(data, ids) {
  const current = {left:false,right:false,tray:false};
  if (!data.ncon) return current;
  const list = data.contact;
  try {
    for(let i=0;i<data.ncon;i++) {
      const c=list.get(i);
      if(!c) continue;
      try {
        if(c.efc_address < 0) continue;
        const other=ids.pin.includes(c.geom1) ? c.geom2 : ids.pin.includes(c.geom2) ? c.geom1 : -1;
        if(other===ids.left) current.left=true;
        if(other===ids.right) current.right=true;
        if(other===ids.tray) current.tray=true;
      } finally {c.delete();}
    }
  } finally {list.delete();}
  return current;
}
function pinFitsTray(position,q) {
  // Rotated pin axis is the second column of the quaternion's rotation matrix.
  const [w,x,y,z]=q;
  const axis=[2*(x*y-w*z),1-2*(x*x+z*z)];
  for (let i=0;i<2;i++) {
    const lateral=Math.abs(axis[i]);
    const barrelSupport=.082*lateral+.026*Math.sqrt(Math.max(0,1-lateral*lateral));
    const handleSupport=.123*lateral+.011;
    const half=i===0 ? .105 : .159;
    if (Math.abs(position[i]-(i===0 ? TRAY_X : 0))+Math.max(barrelSupport,handleSupport)>half) return false;
  }
  return true;
}

export function runKitchenPin(mj, controller='grip') {
  if (!['grip','open'].includes(controller)) throw Error('Choose moving or open gripper fingers.');
  const model = mj.MjModel.from_xml_string(KITCHEN_PIN_MJCF);
  let data;
  try {
    data = new mj.MjData(model);
    const bodies=Object.fromEntries(['rolling_pin','left_jaw','right_jaw','gripper'].map(name=>[name,lookup(model,'body',name)]));
    const ids={left:lookup(model,'geom','left_pad'),right:lookup(model,'geom','right_pad'),tray:lookup(model,'geom','tray_base'),
      pin:['pin_barrel','pin_handles'].map(name=>lookup(model,'geom',name))};
    const pose=(name) => Array.from(data.xpos.subarray(3*bodies[name],3*bodies[name]+3));
    const orientation=()=>Array.from(data.xquat.subarray(4*bodies.rolling_pin,4*bodies.rolling_pin+4));
    mj.mj_forward(model,data);
    const frames=[];
    let touched=activeContacts(data,ids), maxHeight=0, grippedLift=false, restSteps=0;
    const initialHeight=pose('rolling_pin')[2];
    for (let step=0;step<=Math.round(DURATION/DT);step++) {
      if(step%SAMPLE_STEPS===0) {
        const time=step*DT, action=step===Math.round(DURATION/DT) ? null : targets(time,controller==='grip');
        const state=Array.from(data.qpos), velocity=Array.from(data.qvel);
        if(![...state,...velocity].every(Number.isFinite) || Math.abs(time-data.time)>1e-8) throw Error('The tabletop model could not complete this run.');
        frames.push({time,pin:pose('rolling_pin'),pinQuaternion:orientation(),gripper:pose('gripper'),left:pose('left_jaw'),right:pose('right_jaw'),
          position:state,velocity,action,contacts:{...touched}});
        if(!action) break;
        data.ctrl.set(action);
      }
      mj.mj_step(model,data);
      touched=activeContacts(data,ids);
      mj.mj_kinematics(model,data);
      const pin=pose('rolling_pin'), rise=pin[2]-initialHeight;
      maxHeight=Math.max(rise,maxHeight);
      if(touched.left && touched.right && rise>.055) grippedLift=true;
      const resting=touched.tray && !touched.left && !touched.right && pinFitsTray(pin,orientation()) &&
        Math.hypot(...data.qvel.subarray(0,3))<.025 && Math.hypot(...data.qvel.subarray(3,6))<.25;
      restSteps=resting ? restSteps+1 : 0;
    }
    const reason=!grippedLift ? 'no-gripped-lift' : restSteps*DT<.3 ? 'pin-not-resting-in-tray' : 'placed';
    return {schema:'brainsnn.kitchen-pin.v1',controller,engine:{name:'MuJoCo',version:mj.mj_versionString()},modelXML:KITCHEN_PIN_MJCF,
      timestepSeconds:DT,sampleIntervalSeconds:SAMPLE,frames,score:{success:reason==='placed',reason,liftMeters:maxHeight,
        heldWhileLifted:grippedLift,settledTraySeconds:restSteps*DT},provenance:{
        scene:'Authored worktop, force-limited Cartesian gripper, free rolling pin and fixed baking tray.',
        action:'Four position targets in metres for slide, lift, left jaw and right jaw. Applied until the following observation.',
        observation:'MuJoCo qpos, qvel and body poses. Pin contacts refer to the most recent physics step.',
        success:'Both fingers contact the lifted pin at least 5.5 cm above its start, followed by 0.3 s settled and released, supported by and inside the tray.'}};
  } finally {data?.delete(); model.delete();}
}
