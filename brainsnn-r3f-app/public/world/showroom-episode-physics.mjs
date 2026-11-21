// A fixed planar cart follows one of the saved showroom routes. Room X/Z maps to MuJoCo X/-Y.
const DT = .005, SAMPLE_STEPS = 10, SAMPLE = DT * SAMPLE_STEPS;
const RADIUS = .175, HEIGHT = .24, SPEED = .65;
const MAX_OBSTACLES = 2304, MAX_VERTICES = 24000, MAX_ROUTE = 180;
const GOAL_RADIUS = .035;

function check(ok, message) {
  if (!ok) throw Error(message);
}
function areaTurn(a, b, c) {
  return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
}
// MuJoCo mesh collisions use convex hulls. Expose the hull in the exported scene as well.
function hull(points) {
  const sorted = points.map(p => [...p]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  function chain(seq) {
    const out = [];
    for (const p of seq) {
      while (out.length >= 2 && areaTurn(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  }
  return [...chain(sorted), ...chain(sorted.reverse())];
}
function lengthOf(route) {
  let sum = 0;
  for (let i = 1; i < route.length; i++) sum += Math.hypot(route[i][0]-route[i-1][0],route[i][1]-route[i-1][1]);
  return sum;
}
function checkScene(scene) {
  const bounds = scene?.bounds;
  check(Array.isArray(bounds) && bounds.length === 4 && bounds.every(v => Number.isFinite(v) && Math.abs(v)<=1e6) &&
    bounds[2]>bounds[0] && bounds[3]>bounds[1], 'This room needs valid floor bounds.');
  check(Math.max(bounds[2]-bounds[0],bounds[3]-bounds[1]) <= 1000,
    'This room exceeds the one-kilometre floor limit for a cart run.');
  const point = p => Array.isArray(p) && p.length === 2 && p.every((v,i) => Number.isFinite(v) &&
    v >= bounds[i]-1e-6 && v <= bounds[i+2]+1e-6);
  check(scene.cartRadius===RADIUS && scene.cartHeight===HEIGHT && ['before','after'].includes(scene.variant),
    'Choose a saved room layout for the practice cart.');
  check(typeof scene.title === 'string' && scene.title.length<=160 && typeof scene.provenance === 'string' &&
    scene.provenance.length<=3000 && ((typeof scene.objectId==='string' && scene.objectId.length<=96) ||
    (scene.objectId===null && scene.variant==='before')),
    'The room is missing its source information.');
  check(Array.isArray(scene.route) && scene.route.length>=2 && scene.route.length<=8192 && scene.route.every(point),
    'The route needs valid floor positions.');
  check(lengthOf(scene.route)<=MAX_ROUTE, 'Choose a route up to 180 metres long for a local run.');
  check(Array.isArray(scene.obstacles) && scene.obstacles.length <= MAX_OBSTACLES, 'This room has too many collision footprints.');
  const names = new Set();
  let count = 0;
  for (const ob of scene.obstacles) {
    check(ob && ['object','unknown'].includes(ob.kind) && typeof ob.name==='string' &&
      /^(?:object|unknown)_[0-9]{1,4}$/.test(ob.name) && ob.name.startsWith(ob.kind+'_') && !names.has(ob.name),
      'Invalid collision footprint name.');
    names.add(ob.name);
    const p = ob.polygon;
    check(Array.isArray(p) && p.length>=3 && p.length<=128 && p.every(point), 'Invalid collision footprint.');
    count += p.length;
    check(count<=MAX_VERTICES, 'This room exceeds the collision vertex budget. Simplify its footprints.');
    // Reconstructing the canonical hull rejects concavities, reversals and self-intersections in imported episodes.
    const canonical = hull(p);
    check(canonical.length===p.length && canonical.every((v,i) => v[0]===p[i][0] && v[1]===p[i][1]),
      'A collision footprint must be a convex, ordered polygon.');
  }
}

export function buildShowroomEpisodeScene(room, {objectId=room.routes.objectId, variant='before'}={}) {
  const comparison = [room.routes,...(room.comparisons??[])].find(c=>c.objectId===objectId);
  check(comparison && ['before','after'].includes(variant), 'Choose an object with two saved routes.');
  const obstacles = [];
  function add(kind, index, polygon, id, label) {
    const corners = hull(polygon);
    const obstacle = {kind,name:kind+'_'+index,id,label,polygon:corners};
    if (corners.length!==polygon.length) obstacle.originalFootprint=polygon.map(p=>[...p]);
    obstacles.push(obstacle);
  }
  room.objects.forEach((o,i) => {
    if (variant==='before' || o.id!==objectId) add('object',i,o.polygon,o.id,o.label);
  });
  room.unknown.forEach((p,i)=>add('unknown',i,p,null,'Unseen area '+(i+1)));
  const scene = {title:room.title,provenance:room.provenance??room.description,objectId,variant,
    bounds:[...room.bounds],cartRadius:RADIUS,cartHeight:HEIGHT,
    route:comparison[variant].points.map(p=>[...p]),obstacles};
  if(room.sourceVideo?.sha256) scene.sourceVideoSha256=room.sourceVideo.sha256;
  checkScene(scene);
  return scene;
}
function rect(x0,z0,x1,z1) {
  return [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
}

/** Canonical convex prisms in room X/Z with positive height from the floor, in metres. */
export function showroomEpisodeColliders(scene) {
  checkScene(scene);
  const [a,b,c,d] = scene.bounds, wall = .06;
  const box = (name,kind,polygon,bottom,top) => ({name,kind,polygon,bottom,top});
  return [
    box('floor','floor',rect(a,b,c,d),-.08,0),
    box('wall_west','wall',rect(a-wall,b-wall,a,d+wall),0,.5),
    box('wall_east','wall',rect(c,b-wall,c+wall,d+wall),0,.5),
    box('wall_north','wall',rect(a,b-wall,c,b),0,.5),
    box('wall_south','wall',rect(a,d,c,d+wall),0,.5),
    ...scene.obstacles.map(o=>box(o.name,o.kind,o.polygon,0,.5)),
  ];
}

export function makeShowroomEpisodeMJCF(scene) {
  const colliders = showroomEpisodeColliders(scene);
  const meshes = [], geoms = [];
  const colors = {object:'.28 .49 .49 1',unknown:'.54 .43 .28 1',wall:'.35 .38 .44 1',floor:'.72 .74 .76 1'};
  for (const {name,kind,polygon,bottom,top} of colliders) {
    const xs=polygon.map(p=>p[0]), zs=polygon.map(p=>p[1]);
    const x0=Math.min(...xs), x1=Math.max(...xs), z0=Math.min(...zs), z1=Math.max(...zs);
    // Use analytic boxes for axis-aligned rectangles and a convex mesh for other footprints.
    const properties = 'name="'+name+'" rgba="'+colors[kind]+'"';
    if (polygon.length===4 && polygon.every(([x,z])=>(x===x0||x===x1)&&(z===z0||z===z1))) {
      geoms.push('<geom '+properties+' type="box" pos="'+[(x1+x0)/2,-(z0+z1)/2,(top+bottom)/2].join(' ')+
        '" size="'+[(x1-x0)/2,(z1-z0)/2,(top-bottom)/2].join(' ')+'"/>');
    } else {
      // Centre the vertex coordinates before the engine converts mesh vertices to single precision.
      const cx=(x1+x0)/2, cz=(z0+z1)/2;
      const vertices=[bottom,top].flatMap(y=>polygon.flatMap(([x,z])=>[x-cx,cz-z,y]));
      meshes.push('<mesh name="shape_'+name+'" vertex="'+vertices.join(' ')+'"/>');
      geoms.push('<geom '+properties+' type="mesh" mesh="shape_'+name+'" pos="'+[cx,-cz,0].join(' ')+'"/>');
    }
  }
  const [a,b,c,d]=scene.bounds, [x,z]=scene.route[0];
  const view=[(a+c)/2,-(b+d)/2,1+1.36*Math.max(c-a,d-b)].join(' ');
  return `<mujoco model="showroom_delivery">
  <compiler angle="radian"/>
  <option timestep="${DT}" integrator="implicitfast" iterations="40"/>
  <visual><map zfar="12"/></visual>
  <asset>${meshes.join('\n    ')}</asset>
  <worldbody>
    <light pos="${view}" dir="0 0 -1" directional="true"/>
    <camera name="episode_overhead" pos="${view}" xyaxes="1 0 0 0 1 0" fovy="50"/>
    ${geoms.join('\n    ')}
    <body name="delivery_cart" pos="${x} ${-z} ${HEIGHT/2}">
      <joint name="cart_x" type="slide" axis="1 0 0" damping="0.5"/>
      <joint name="cart_z" type="slide" axis="0 -1 0" damping="0.5"/>
      <geom name="cart_body" type="cylinder" size="${RADIUS} ${HEIGHT/2}" mass="5" rgba=".16 .55 .86 1"/>
    </body>
  </worldbody>
  <actuator>
    <velocity name="drive_x" joint="cart_x" kv="45" ctrlrange="-${SPEED} ${SPEED}" forcerange="-18 18"/>
    <velocity name="drive_z" joint="cart_z" kv="45" ctrlrange="-${SPEED} ${SPEED}" forcerange="-18 18"/>
  </actuator>
</mujoco>
`;
}

function lookup(model, name) {
  const item=model.geom(name);
  try {return item.id;} finally {item.delete();}
}
function observeContacts(data, cart, colliders, touched) {
  if (!data.ncon) return;
  const list=data.contact;
  try {
    for (let i=0;i<data.ncon;i++) {
      const contact=list.get(i);
      if (!contact) continue;
      try {
        const other=contact.geom1===cart ? contact.geom2 : contact.geom2===cart ? contact.geom1 : -1;
        if (contact.efc_address>=0 && colliders.has(other)) touched.add(colliders.get(other));
      } finally {contact.delete();}
    }
  } finally {list.delete();}
}

/** Validated native velocity actuator controls in room X/Z order (metres per second). */
export function limitShowroomVelocity(command) {
  check(Array.isArray(command) && command.length===2 && command.every(Number.isFinite) &&
    Number.isFinite(Math.hypot(...command)), 'The simulation controller must return two finite velocity targets.');
  const scale=Math.min(1,SPEED/(Math.hypot(...command)||1));
  return command.map(value=>value*scale);
}

export async function runShowroomEpisode(mujoco, scene, {controller='waypoint',act,trainingId=null}={}) {
  check((['waypoint','stationary'].includes(controller) && act===undefined) || (controller==='imitation' && typeof act==='function'),
    'Choose the waypoint controller or supply a local imitation policy.');
  check(trainingId===null || (controller==='imitation' && typeof trainingId==='string' && trainingId.length<=128),
    'Invalid policy training reference.');
  const modelXML=makeShowroomEpisodeMJCF(scene);
  // Clone once so the digest, replay metadata and actual simulated route share one snapshot.
  scene=structuredClone(scene);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(scene)));
  const sceneSha256=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  const model=mujoco.MjModel.from_xml_string(modelXML);
  let data;
  try {
    data=new mujoco.MjData(model);
    const {route}=scene, start=route[0], goal=route.at(-1);
    const names=new Map();
    for (const c of showroomEpisodeColliders(scene)) if(c.kind!=='floor') names.set(lookup(model,c.name),c.name);
    const cart=lookup(model,'cart_body');
    const maxSamples=Math.ceil(Math.min(450,10+2.8*lengthOf(route)/SPEED)/SAMPLE);
    const frames=[], contactNames=new Set();
    let waypoint=1, distanceMeters=0, reason='timeout', previous=start, contacts=new Set();
    mujoco.mj_forward(model,data);
    observeContacts(data,cart,names,contacts);
    for(let sample=0;sample<=maxSamples;sample++) {
      const position=[start[0]+data.qpos[0],start[1]+data.qpos[1]];
      const velocity=Array.from(data.qvel);
      check([...position,...velocity].every(Number.isFinite) && Math.abs(data.time-sample*SAMPLE)<1e-7,
        'The simulator could not resolve this room at its recorded scale.');
      while (waypoint<route.length-1 && Math.hypot(route[waypoint][0]-position[0],route[waypoint][1]-position[1])<.09) waypoint++;
      const target=[...route[waypoint]];
      const frame={time:sample*SAMPLE,position,velocity,target,action:null,contacts:[...contacts].sort()};
      frames.push(frame);
      for(const name of contacts) contactNames.add(name);
      if (contacts.size) {reason='contact'; break;}
      const goalError=Math.hypot(position[0]-goal[0],position[1]-goal[1]);
      if (waypoint===route.length-1 && goalError<=GOAL_RADIUS && Math.hypot(...velocity)<.09) {reason='goal-reached'; break;}
      if(sample===maxSamples) break;
      const command=controller==='stationary' ? [0,0] : act ? act({position:[...position],velocity:[...velocity],target:[...target]}) :
        [5*(target[0]-position[0]),5*(target[1]-position[1])];
      frame.action=limitShowroomVelocity(command);
      data.ctrl.set(frame.action);
      contacts=new Set();
      for(let k=0;k<SAMPLE_STEPS;k++) {
        mujoco.mj_step(model,data);
        observeContacts(data,cart,names,contacts);
        const next=[start[0]+data.qpos[0],start[1]+data.qpos[1]];
        distanceMeters+=Math.hypot(next[0]-previous[0],next[1]-previous[1]);
        previous=next;
      }
    }
    const last=frames.at(-1).position;
    return {schema:'brainsnn.showroom-episode.v1',scene,sceneSha256,engine:{name:'MuJoCo',version:mujoco.mj_versionString()},
      modelXML,sampleIntervalSeconds:SAMPLE,timestepSeconds:DT,frames,
      score:{success:reason==='goal-reached',reason,distanceMeters,finalErrorMeters:Math.hypot(last[0]-goal[0],last[1]-goal[1]),contactNames:[...contactNames].sort()},
      provenance:{physicsExecuted:true,learnedPolicyExecuted:controller==='imitation',controllerKind:controller,trainingId,
        controller:{waypoint:'Fixed waypoint-following velocity controller',imitation:'State-only imitation policy following planned waypoints',stationary:'Stationary comparison controller'}[controller],
        geometry:'Convex hulls of the supplied floor footprints, extruded to a fixed 0.5 m height. Unseen areas block travel.',
        cart:'Planar holonomic cylinder with two force-limited velocity actuators. Radius and height are assumptions.',
        coordinates:'Room X/Z in metres maps to MuJoCo X/-Y. Joint positions are offsets from the route start.',
        timing:'At each frame, observe position and velocity, then apply the target velocity until the next frame. Contacts cover the preceding interval; terminal action is null.'}};
  } finally {data?.delete(); model.delete();}
}
