import {normalizeWorld, planningGate, routeWorld} from './core.mjs';
import {buildShowroomEpisodeScene} from './showroom-episode-physics.mjs';

// The recorder uses the same 35 cm delivery cart on every map. Leave extra space when planning.
const cart = {width:.35, depth:.35, speed:.65, margin:.10};

function floorEdges(world) {
  const floor = world.floor || [];
  const area = floor.reduce((sum, [x,z], i) => {
    const [u,v] = floor[(i+1) % floor.length];
    return sum + x*v-u*z;
  }, 0);
  const edges = [];
  for (let i = 0; i < floor.length; i++) {
    const a = floor[i], b = floor[(i+1) % floor.length];
    // The rectangular simulator perimeter already includes these edges.
    if ((a[0] === b[0] && [0,world.width].includes(a[0])) ||
        (a[1] === b[1] && [0,world.depth].includes(a[1]))) continue;
    const dx = b[0]-a[0], dz = b[1]-a[1], length = Math.hypot(dx,dz);
    if (length < 1e-8) continue;
    const offset = .01 * Math.sign(area) / length;
    const inward = ([x,z]) => [Math.max(0,Math.min(world.width,x-dz*offset)),
      Math.max(0,Math.min(world.depth,z+dx*offset))];
    edges.push([a,b,inward(b),inward(a)]);
  }
  return edges;
}

/** Plan the cart route from the current reviewed map, including unknown space and polygon boundaries. */
export function buildReviewedMapEpisodeScene(input, goal, reconstructionSource) {
  const world = normalizeWorld(input);
  const held = planningGate(world);
  if (held) throw new Error(held);
  const planned = routeWorld(world, cart, goal);
  const points = planned.route.map(p=>[p.x,p.z]);
  const atGoal = world.start.x === goal.x && world.start.z === goal.z;
  const route = atGoal ? [[goal.x,goal.z],[goal.x,goal.z]] : points;
  const objects = [], unknown = [];
  const blocked = [];
  for (const item of world.objects) {
    const {x,z,w,d} = item;
    const polygon = [[x,z],[x+w,z],[x+w,z+d],[x,z+d]];
    if (item.kind === 'obstacle') objects.push({id:item.id,label:item.name,polygon});
    else {
      unknown.push(polygon);
      blocked.push({kind:item.kind,label:item.name,id:item.id});
    }
  }
  const edges = floorEdges(world);
  const room = {
    title:world.name, provenance:'Current '+world.provenance+' World Builder map. The planner used its reviewed floor, blocked areas, start and goal.',
    bounds:[0,0,world.width,world.depth], objects, unknown:[...unknown,...edges],
    routes:{objectId:null,before:{points:route}},
  };
  const scene = buildShowroomEpisodeScene(room,{objectId:null,variant:'before'});
  for (const obstacle of scene.obstacles.filter(o => o.kind==='unknown')) {
    const index = Number(obstacle.name.slice('unknown_'.length));
    obstacle.label = blocked[index]?.label || 'Floor boundary';
    obstacle.id = blocked[index]?.id ?? null;
  }
  scene.sourceMap = {schema:world.schema,kind:world.provenance,scaleReviewed:world.scaleReviewed,
    mapReviewed:world.mapReviewed,geometrySource:world.geometrySource ?? null, floor:world.floor ?? null,
    blocked, goal:planned.goal,planner:planned.algorithm,marginMeters:cart.margin};
  if (reconstructionSource) scene.sourceMap.reconstruction = {name:reconstructionSource.source,
    sha256:/^[a-f0-9]{64}$/.test(reconstructionSource.sourceSha256) ? reconstructionSource.sourceSha256 : null,
    scaleMethod:reconstructionSource.scaleMethod ?? null};
  return scene;
}
