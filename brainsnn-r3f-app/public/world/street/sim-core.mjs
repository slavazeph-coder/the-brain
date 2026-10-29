/**
 * BrainSNN Street Studio: deterministic kinematic navigation, in Y-up metres.
 * Polygon footprints retain their holes. Circle sweeps prevent wall tunnelling.
 * This is not a dynamics engine or evidence of physical robot qualification.
 */
export const SIM_MODE = 'kinematic-navigation';
export const DEFAULTS = Object.freeze({playerRadius:0.30, playerHeight:1.8, eyeHeight:1.65,
  robotRadius:0.42, robotHeight:0.9, playerSpeed:2.5, robotSpeed:1.0,
  cellSize:0.65, maxStep:0.25, maxSlope:0.65, maxExpanded:45000});
const EPS=1e-8, clone=value=>JSON.parse(JSON.stringify(value));
const finite=(value,name)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${name} must be finite.`);return value;};
function positive(value,name,maximum=100000){finite(value,name);if(value<=0||value>maximum)throw new RangeError(`${name} is outside its allowed range.`);return value;}
function position(value,name='position'){
  if(Array.isArray(value)){if(value.length===2)return{x:finite(value[0],name+'.x'),z:finite(value[1],name+'.z')};if(value.length>=3)return{x:finite(value[0],name+'.x'),y:finite(value[1],name+'.y'),z:finite(value[2],name+'.z')};}
  if(!value||typeof value!=='object')throw new TypeError(`${name} must have x/z coordinates.`);
  const out={x:finite(value.x,name+'.x'),z:finite(value.z,name+'.z')};if(value.y!==undefined)out.y=finite(value.y,name+'.y');return out;
}
function identifier(value,name='id'){if(typeof value!=='string'||!value.length||value.length>240)throw new TypeError(`${name} must be a bounded string.`);return value;}
const length=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
function pointSegmentDistanceSquared(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz,t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/den)):0;return(p.x-a.x-t*dx)**2+(p.z-a.z-t*dz)**2;}
function intersects(a,b,c,d){
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  if(((abC>EPS&&abD< -EPS)||(abC< -EPS&&abD>EPS))&&((cdA>EPS&&cdB< -EPS)||(cdA< -EPS&&cdB>EPS)))return true;
  return Math.abs(abC)<=EPS&&pointSegmentDistanceSquared(c,a,b)<=EPS*EPS||Math.abs(abD)<=EPS&&pointSegmentDistanceSquared(d,a,b)<=EPS*EPS||Math.abs(cdA)<=EPS&&pointSegmentDistanceSquared(a,c,d)<=EPS*EPS||Math.abs(cdB)<=EPS&&pointSegmentDistanceSquared(b,c,d)<=EPS*EPS;
}
function segmentDistanceSquared(a,b,c,d){return intersects(a,b,c,d)?0:Math.min(pointSegmentDistanceSquared(a,c,d),pointSegmentDistanceSquared(b,c,d),pointSegmentDistanceSquared(c,a,b),pointSegmentDistanceSquared(d,a,b));}
function ringPoints(ring,name){
  if(!Array.isArray(ring)||ring.length<3)throw new TypeError(`${name} needs at least three vertices.`);
  const points=ring.map((p,i)=>position(p,`${name}[${i}]`));
  if(length(points[0],points.at(-1))<EPS)points.pop();
  if(points.length<3)throw new TypeError(`${name} is degenerate.`);
  let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.z-b.x*a.z;}
  if(Math.abs(area)<EPS)throw new TypeError(`${name} has no area.`);
  return points;
}
function pointInRing(p,ring){
  let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];if(pointSegmentDistanceSquared(p,a,b)<EPS*EPS)return true;
    if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }return inside;
}
function solidContains(p,polygon){return pointInRing(p,polygon.outer)&&!polygon.holes.some(h=>pointInRing(p,h));}
function makePolygon(value,name){
  const outer=ringPoints(value.outer,name+'.outer'),holes=(value.holes||[]).map((h,i)=>ringPoints(h,`${name}.holes[${i}]`));
  const edges=[];for(const ring of[outer,...holes])for(let i=0;i<ring.length;i++)edges.push([ring[i],ring[(i+1)%ring.length]]);
  const box={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};for(const p of outer){box.minX=Math.min(box.minX,p.x);box.maxX=Math.max(box.maxX,p.x);box.minZ=Math.min(box.minZ,p.z);box.maxZ=Math.max(box.maxZ,p.z);}
  return{outer,holes,edges,box};
}
function validateBounds(value){
  const b={};for(const k of['minX','maxX','minZ','maxZ'])b[k]=finite(value?.[k],'bounds.'+k);
  if(b.minX>=b.maxX||b.minZ>=b.maxZ||b.maxX-b.minX>10000||b.maxZ-b.minZ>10000)throw new RangeError('World bounds must be positive and at most 10 km across.');return b;
}
function inBounds(world,p,r=0){const b=world.bounds;return p.x-r>=b.minX-EPS&&p.x+r<=b.maxX+EPS&&p.z-r>=b.minZ-EPS&&p.z+r<=b.maxZ+EPS;}
function validateTerrain(terrain){
  if(!terrain)return{kind:'flat',height:0,sourceStatus:'authored-assumed'};
  if(terrain.kind==='flat'||(!terrain.heights&&typeof terrain.height==='number'))return{...clone(terrain),kind:'flat',height:finite(terrain.height,'terrain.height')};
  const t=clone(terrain);finite(t.originX,'terrain.originX');finite(t.originZ,'terrain.originZ');positive(t.cellSize,'terrain.cellSize',100);
  if(!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<2||t.height<2||t.width*t.height>4_000_000)throw new RangeError('Terrain grid dimensions are invalid.');
  if(!Array.isArray(t.heights)||t.heights.length!==t.width*t.height||t.heights.some(h=>h!==null&&(typeof h!=='number'||!Number.isFinite(h))))throw new TypeError('Terrain heights must match the grid; missing cells must be null.');
  t.kind='grid';return t;
}
/** Bilinear height. Null means outside/missing terrain, never invented free ground. */
export function terrainHeight(world,x,z){
  if(typeof x==='object'){const p=position(x);x=p.x;z=p.z;}
  finite(x,'x');finite(z,'z');const t=world.terrain||world;
  if(t.kind==='flat')return t.height;
  let fx=(x-t.originX)/t.cellSize,fz=(z-t.originZ)/t.cellSize;
  if(fx< -EPS||fz< -EPS||fx>t.width-1+EPS||fz>t.height-1+EPS)return null;
  fx=Math.max(0,Math.min(t.width-1,fx));fz=Math.max(0,Math.min(t.height-1,fz));
  const ix=Math.min(t.width-2,Math.floor(fx)),iz=Math.min(t.height-2,Math.floor(fz)),u=fx-ix,v=fz-iz;
  const samples=[t.heights[iz*t.width+ix],t.heights[iz*t.width+ix+1],t.heights[(iz+1)*t.width+ix],t.heights[(iz+1)*t.width+ix+1]];
  if(samples.some(h=>h===null||h===undefined))return null;
  return samples[0]*(1-u)*(1-v)+samples[1]*u*(1-v)+samples[2]*(1-u)*v+samples[3]*u*v;
}
function boxPolygon(box){
  const c=Math.cos(box.yaw),s=Math.sin(box.yaw),w=box.width/2,d=box.depth/2;
  return makePolygon({outer:[[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,z])=>[box.x+c*x+s*z,box.z-s*x+c*z])},box.id);
}
function normalizeBarrier(value,world){
  const b={id:identifier(value.id),x:finite(value.x,'barrier.x'),z:finite(value.z,'barrier.z'),width:positive(value.width,'barrier.width',100),depth:positive(value.depth,'barrier.depth',100),height:positive(value.height??1.0,'barrier.height',20),yaw:finite(value.yaw??(value.yawDegrees===undefined?0:value.yawDegrees*Math.PI/180),'barrier.yaw'),sourceStatus:value.sourceStatus||'authored-assumed'};
  if(Math.abs(b.yaw)>Math.PI*1000)throw new RangeError('Barrier angle is too large.');
  b.yaw=Math.atan2(Math.sin(b.yaw),Math.cos(b.yaw));
  const poly=boxPolygon(b);if(poly.outer.some(p=>!inBounds(world,p)))throw new RangeError('Barrier must remain within the world bounds.');
  const y=terrainHeight(world,b.x,b.z);if(y===null)throw new RangeError('Barrier needs terrain support.');
  b.baseY=y;b.minY=y;b.maxY=y+b.height;b.polygons=[poly];return b;
}
function publicBarrier(b){return{id:b.id,x:b.x,z:b.z,width:b.width,depth:b.depth,height:b.height,yaw:b.yaw,baseY:b.baseY,sourceStatus:b.sourceStatus};}
function staticBox(value){
  const b={id:identifier(value.id),x:finite(value.x,'obstacle.x'),z:finite(value.z,'obstacle.z'),width:positive(value.width,'obstacle.width'),depth:positive(value.depth,'obstacle.depth'),height:positive(value.height,'obstacle.height'),baseY:finite(value.baseY??0,'obstacle.baseY'),yaw:finite(value.yaw??0,'obstacle.yaw'),sourceStatus:value.sourceStatus||'authored-assumed'};
  b.minY=b.baseY;b.maxY=b.baseY+b.height;b.polygons=[boxPolygon(b)];return b;
}
function polygonsOverlap(a,b){
  if(a.box.maxX<b.box.minX||a.box.minX>b.box.maxX||a.box.maxZ<b.box.minZ||a.box.minZ>b.box.maxZ)return false;
  return a.outer.some(p=>solidContains(p,b))||b.outer.some(p=>solidContains(p,a))||a.edges.some(([p,q])=>b.edges.some(([r,s])=>intersects(p,q,r,s)));
}
function checkBarrierPlacement(world,b){
  for(const other of[...world.buildings,...world.obstacles,...world.barriers]){
    if(other.id===b.id||other.maxY<=b.minY+EPS||other.minY>=b.maxY-EPS)continue;
    if(other.polygons.some(p=>polygonsOverlap(b.polygons[0],p)))throw new RangeError(`Barrier would overlap ${other.id}.`);
  }
}
/** Consume assets/scene.json without changing its source data. */
export function createWorld(data){
  if(!data||typeof data!=='object')throw new TypeError('A scene record is required.');
  const world={bounds:validateBounds(data.bounds),terrain:validateTerrain(data.terrain),buildings:[],obstacles:[],barriers:[],revision:0,mode:SIM_MODE};
  const ids=new Set();for(const [index,b]of(data.buildings||[]).entries()){
    const id=identifier(b.id,`buildings[${index}].id`);if(ids.has(id))throw new TypeError('Collider IDs must be unique.');ids.add(id);
    if(!Array.isArray(b.polygons)||!b.polygons.length)throw new TypeError('Each building needs polygon footprints.');
    const baseY=finite(b.baseY??0,'building.baseY'),height=positive(b.height??1000,'building.height');
    // A reference building remains conservatively solid below its mapped base.
    world.buildings.push({id,baseY,height,minY:-Infinity,maxY:baseY+height,polygons:b.polygons.map((p,i)=>makePolygon(p,`${id}.polygons[${i}]`))});
  }
  const barriers=data.barriers||(data.barrier?[data.barrier]:[]);
  const barrierIds=new Set(barriers.map(b=>b.id));
  for(const input of data.navigationObstacles||[]){if(ids.has(input.id)||barrierIds.has(input.id))throw new TypeError('Collider IDs must be unique.');ids.add(input.id);world.obstacles.push(staticBox(input));}
  for(const object of data.objects||[]){
    if(ids.has(object.id)||barrierIds.has(object.id)||!object.collider?.enabled||object.geometry?.type!=='box')continue;
    const dims=object.geometry.dimensions,t=object.transform||{},p=position(t.position||[0,0,0]),rotation=t.rotation||[0,0,0],scale=t.scale||[1,1,1];
    if(!Array.isArray(dims)||dims.length!==3||rotation.length!==3||Math.abs(rotation[0])>EPS||Math.abs(rotation[2])>EPS||scale.length!==3||scale.some(s=>s!==1))throw new TypeError('Static box collider needs dimensions and a Y-only rotation.');
    ids.add(object.id);world.obstacles.push(staticBox({id:object.id,x:p.x,z:p.z,baseY:(p.y??0)-dims[1]/2,width:dims[0],height:dims[1],depth:dims[2],yaw:rotation[1],sourceStatus:'authored-assumed'}));
  }
  for(const barrier of barriers){if(ids.has(barrier.id))throw new TypeError('Collider IDs must be unique.');ids.add(barrier.id);const b=normalizeBarrier(barrier,world);checkBarrierPlacement(world,b);world.barriers.push(b);}
  const nav=data.navigation||data.nav||{};world.navigation={...clone(nav),start:position(nav.start||data.start||{x:(world.bounds.minX+world.bounds.maxX)/2,z:(world.bounds.minZ+world.bounds.maxZ)/2}),goal:position(nav.goal||data.goal||nav.start||data.start||{x:world.bounds.minX+2,z:world.bounds.minZ+2})};
  world.initialBarriers=world.barriers.map(publicBarrier);return world;
}
function motionOptions(value={}){
  const o=typeof value==='number'?{radius:value}:value;
  return{radius:positive(o.radius??DEFAULTS.robotRadius,'radius',10),height:positive(o.height??DEFAULTS.robotHeight,'height',20),maxStep:positive(o.maxStep??DEFAULTS.maxStep,'maxStep',10),maxSlope:positive(o.maxSlope??DEFAULTS.maxSlope,'maxSlope',20)};
}
function navigationOptions(world,options={}){const n=world.navigation||{};return motionOptions({radius:n.agentRadius??DEFAULTS.robotRadius,height:n.agentHeight??DEFAULTS.robotHeight,maxStep:n.maxStepHeight??DEFAULTS.maxStep,maxSlope:n.maxSlopeDegrees===undefined?DEFAULTS.maxSlope:Math.tan(finite(n.maxSlopeDegrees,'maxSlopeDegrees')*Math.PI/180),...options});}
function overlapsVertical(c,y,height){return c.maxY>y+0.015&&c.minY<y+height-0.015;}
function nearBox(p,box,r){return p.x+r>=box.minX&&p.x-r<=box.maxX&&p.z+r>=box.minZ&&p.z-r<=box.maxZ;}
function collisionAt(world,p,options){
  const o=motionOptions(options);if(!inBounds(world,p,o.radius))return'world-boundary';
  const y=terrainHeight(world,p.x,p.z);if(y===null)return'unknown-terrain';
  for(const c of[...world.buildings,...world.obstacles,...world.barriers]){
    if(!overlapsVertical(c,y,o.height))continue;
    for(const poly of c.polygons){if(!nearBox(p,poly.box,o.radius))continue;if(solidContains(p,poly)||poly.edges.some(([a,b])=>pointSegmentDistanceSquared(p,a,b)<=(o.radius+EPS)**2))return c.id;}
  }return null;
}
/** Circle-footprint clearance; holes and actor radius are both respected. */
export function pointClear(world,value,radiusOrOptions={}){return collisionAt(world,position(value),radiusOrOptions)===null;}
function terrainPassage(world,a,b,o){
  const distance=length(a,b),steps=Math.max(1,Math.ceil(distance/Math.min(0.2,world.terrain.cellSize?world.terrain.cellSize/3:0.2)));
  let previous=terrainHeight(world,a.x,a.z);if(previous===null)return'unknown-terrain';
  for(let i=1;i<=steps;i++){const t=i/steps,y=terrainHeight(world,a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);if(y===null)return'unknown-terrain';const rise=Math.abs(y-previous),run=distance/steps;if(rise>o.maxStep+EPS||run>EPS&&rise/run>o.maxSlope+EPS)return'terrain-step-or-slope';previous=y;}return null;
}
/** Exact swept-circle horizontal collision plus sampled terrain grade limits. */
export function segmentClear(world,from,to,options={}){
  const a=position(from),b=position(to),o=motionOptions(options);
  if(collisionAt(world,a,o)||collisionAt(world,b,o)||terrainPassage(world,a,b,o))return false;
  const yA=terrainHeight(world,a.x,a.z),yB=terrainHeight(world,b.x,b.z),lowY=Math.min(yA,yB),highY=Math.max(yA,yB)+o.height;
  const segmentBox={minX:Math.min(a.x,b.x)-o.radius,maxX:Math.max(a.x,b.x)+o.radius,minZ:Math.min(a.z,b.z)-o.radius,maxZ:Math.max(a.z,b.z)+o.radius};
  for(const c of[...world.buildings,...world.obstacles,...world.barriers]){
    if(c.maxY<=lowY+0.015||c.minY>=highY-0.015)continue;
    for(const poly of c.polygons){const q=poly.box;if(q.minX>segmentBox.maxX||q.maxX<segmentBox.minX||q.minZ>segmentBox.maxZ||q.maxZ<segmentBox.minZ)continue;
      if(poly.edges.some(([c,d])=>segmentDistanceSquared(a,b,c,d)<=(o.radius+EPS)**2))return false;
    }
  }return true;
}
function feet(world,p){return{x:p.x,y:terrainHeight(world,p.x,p.z)??p.y??0,z:p.z};}
function safePart(world,a,b,o){
  if(segmentClear(world,a,b,o))return b;
  let lo=0,hi=1;for(let i=0;i<23;i++){const t=(lo+hi)/2,p={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};if(segmentClear(world,a,p,o))lo=t;else hi=t;}
  const t=Math.max(0,lo-1e-6);return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
}
/** Continuous circle sweep with optional conservative axis sliding; no tunnelling. */
export function sweepMove(world,from,delta,options={}){
  const start=position(from),d=position(delta,'delta'),o=motionOptions(options),initialHit=collisionAt(world,start,o);
  if(initialHit)return{position:feet(world,start),blocked:true,collided:true,reason:initialHit,distance:0};
  const target={x:start.x+d.x,z:start.z+d.z};
  if(segmentClear(world,start,target,o))return{position:feet(world,target),blocked:false,collided:false,reason:null,distance:length(start,target)};
  let result=safePart(world,start,target,o);
  if(options.slide!==false){
    const remainder={x:target.x-result.x,z:target.z-result.z};
    const axes=Math.abs(remainder.x)>Math.abs(remainder.z)?['x','z']:['z','x'];
    for(const axis of axes){const next={...result,[axis]:target[axis]};result=safePart(world,result,next,o);}
  }
  return{position:feet(world,result),blocked:true,collided:true,reason:collisionAt(world,target,o)||terrainPassage(world,start,target,o)||'swept-obstacle',distance:length(start,result)};
}
class MinHeap{
  constructor(){this.items=[];}get length(){return this.items.length;}
  push(item){const a=this.items;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].f<=item.f)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.items,result=a[0],last=a.pop();if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=last.f)break;a[i]=a[c];i=c;}a[i]=last;}return result;}
}
function simplify(world,points,o){const out=[points[0]];let i=0;while(i<points.length-1){let j=Math.min(points.length-1,i+80);while(j>i+1&&!segmentClear(world,points[i],points[j],o))j--;out.push(points[j]);i=j;}return out;}
/** A* over a bounded grid, exact swept-circle edges and exact endpoint connectors. */
export function findPath(world,startValue,goalValue,options={}){
  const start=position(startValue),goal=position(goalValue),o=navigationOptions(world,options),cell=positive(options.cellSize??world.navigation?.cellSize??DEFAULTS.cellSize,'cellSize',20);
  const maxExpanded=options.maxExpanded??DEFAULTS.maxExpanded;if(!Number.isInteger(maxExpanded)||maxExpanded<1||maxExpanded>300000)throw new RangeError('maxExpanded must be 1..300000.');
  const result=(status,points=[],expanded=0,reason=null)=>({status,points:points.map(p=>feet(world,p)),revision:world.revision,expanded,reason,cost:points.slice(1).reduce((sum,p,i)=>sum+length(points[i],p),0),mode:SIM_MODE});
  const startHit=collisionAt(world,start,o),goalHit=collisionAt(world,goal,o);
  if(startHit)return result('blocked-start',[],0,startHit);if(goalHit)return result('blocked-goal',[],0,goalHit);
  if(segmentClear(world,start,goal,o))return result('ready',[start,goal]);
  const b=world.bounds,nx=Math.floor((b.maxX-b.minX)/cell)+1,nz=Math.floor((b.maxZ-b.minZ)/cell)+1;
  if(nx*nz>20_000_000)throw new RangeError('Navigation grid is too large; increase cellSize.');
  const key=(ix,iz)=>iz*nx+ix,at=(ix,iz)=>({x:b.minX+ix*cell,z:b.minZ+iz*cell}),coords=id=>({ix:id%nx,iz:Math.floor(id/nx)}),clearCache=new Map();
  const clear=(ix,iz)=>{if(ix<0||iz<0||ix>=nx||iz>=nz)return false;const id=key(ix,iz);if(!clearCache.has(id))clearCache.set(id,pointClear(world,at(ix,iz),o));return clearCache.get(id);};
  function connectors(p){const ix=Math.round((p.x-b.minX)/cell),iz=Math.round((p.z-b.minZ)/cell),out=[];for(let dz=-3;dz<=3;dz++)for(let dx=-3;dx<=3;dx++){const x=ix+dx,z=iz+dz,q=at(x,z);if(clear(x,z)&&segmentClear(world,p,q,o))out.push({id:key(x,z),point:q,distance:length(p,q)});}return out.sort((a,b)=>a.distance-b.distance).slice(0,12);}
  const begins=connectors(start),ends=new Map(connectors(goal).map(row=>[row.id,row]));
  if(!begins.length||!ends.size)return result('unreachable',[],0,'No clear grid connection to endpoint.');
  const open=new MinHeap(),costs=new Map(),parents=new Map(),closed=new Set();
  for(const item of begins){costs.set(item.id,item.distance);parents.set(item.id,null);open.push({id:item.id,g:item.distance,f:item.distance+length(item.point,goal)});}
  let expanded=0;while(open.length&&expanded<maxExpanded){
    const current=open.pop();if(closed.has(current.id)||current.g>(costs.get(current.id)??Infinity)+EPS)continue;
    closed.add(current.id);expanded++;const{ix,iz}=coords(current.id),p=at(ix,iz);
    if(ends.has(current.id)){const chain=[goal];let id=current.id;while(id!==null){const c=coords(id);chain.push(at(c.ix,c.iz));id=parents.get(id);}chain.push(start);chain.reverse();return result('ready',simplify(world,chain,o),expanded);}
    for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const x=ix+dx,z=iz+dz,id=key(x,z);if(closed.has(id)||!clear(x,z))continue;const q=at(x,z),g=current.g+cell*Math.hypot(dx,dz);
      if(g>=(costs.get(id)??Infinity)-EPS||!segmentClear(world,p,q,o))continue;
      costs.set(id,g);parents.set(id,current.id);open.push({id,g,f:g+length(q,goal)});
    }
  }return result(open.length?'search-limit':'unreachable',[],expanded,open.length?'Search budget reached.':'No traversable route at this grid resolution.');
}
function barrierEdit(world,edit){
  if(!edit||typeof edit!=='object'||Array.isArray(edit))throw new TypeError('Barrier edit must be an object.');
  const allowed=new Set(['id','x','z','width','depth','height','yaw','yawDegrees','transform','expectedRevision']);
  if(Object.keys(edit).some(k=>!allowed.has(k)))throw new TypeError('Unsupported barrier edit field.');
  if(edit.expectedRevision!==undefined&&edit.expectedRevision!==world.revision)throw new Error('Barrier edit refers to a stale scene revision.');
  const index=world.barriers.findIndex(b=>b.id===edit.id);if(index<0)throw new Error('Barrier ID is not editable in this world.');
  const next=publicBarrier(world.barriers[index]);for(const key of['x','z','width','depth','height','yaw'])if(edit[key]!==undefined)next[key]=edit[key];
  if(edit.yawDegrees!==undefined){if(edit.yaw!==undefined)throw new TypeError('Use yaw or yawDegrees, not both.');next.yaw=finite(edit.yawDegrees,'yawDegrees')*Math.PI/180;}
  if(edit.transform!==undefined){const t=edit.transform;if(!t||typeof t!=='object'||Object.keys(t).some(k=>!['position','rotation','scale'].includes(k)))throw new TypeError('Invalid barrier transform.');
    if(t.position!==undefined){const p=position(t.position,'transform.position');next.x=p.x;next.z=p.z;}
    if(t.rotation!==undefined){if(!Array.isArray(t.rotation)||t.rotation.length!==3||t.rotation.some(v=>typeof v!=='number'||!Number.isFinite(v))||Math.abs(t.rotation[0])>EPS||Math.abs(t.rotation[2])>EPS)throw new TypeError('Barrier rotation must be [0,yaw,0].');next.yaw=t.rotation[1];}
    if(t.scale!==undefined&&(!Array.isArray(t.scale)||t.scale.length!==3||t.scale.some(v=>v!==1)))throw new TypeError('Barrier scaling must use explicit dimensions.');
  }
  const candidate=normalizeBarrier(next,world);checkBarrierPlacement(world,candidate);return{index,next:candidate};
}
/** Atomic placement update. Stale/unknown/malformed edits leave the world unchanged. */
export function setBarrier(world,edit){const{index,next}=barrierEdit(world,edit);const old=publicBarrier(world.barriers[index]),current=publicBarrier(next),changed=JSON.stringify(old)!==JSON.stringify(current);if(changed){world.barriers[index]=next;world.revision++;}return{changed,revision:world.revision,barrier:current};}
/** Normalized collider data for a visual debug layer; no measured-physics claim. */
export function colliderSnapshot(world){return{revision:world.revision,buildings:world.buildings.map(b=>({id:b.id,baseY:b.baseY,height:b.height,polygons:b.polygons.map(p=>({outer:p.outer.map(q=>[q.x,q.z]),holes:p.holes.map(h=>h.map(q=>[q.x,q.z]))}))})),obstacles:world.obstacles.map(publicBarrier),barriers:world.barriers.map(publicBarrier)};}
export function createSimulation(world,options={}){
  if(!world||world.mode!==SIM_MODE)throw new TypeError('Pass a world created by createWorld.');
  const playerOptions=navigationOptions(world,{radius:options.playerRadius??world.navigation.playerRadius??DEFAULTS.playerRadius,height:options.playerHeight??world.navigation.playerHeight??DEFAULTS.playerHeight,...options.terrainLimits}),robotOptions=navigationOptions(world,{radius:options.robotRadius??world.navigation.agentRadius??DEFAULTS.robotRadius,height:options.robotHeight??world.navigation.agentHeight??DEFAULTS.robotHeight,...options.terrainLimits});
  const speed=positive(options.robotSpeed??DEFAULTS.robotSpeed,'robotSpeed',20),playerSpeed=positive(options.playerSpeed??DEFAULTS.playerSpeed,'playerSpeed',20),eyeHeight=positive(options.eyeHeight??DEFAULTS.eyeHeight,'eyeHeight',5);
  const initialStart=position(options.start||world.navigation.start),initialGoal=position(options.goal||world.navigation.goal),initialPlayer=position(options.playerStart||world.navigation.playerStart||initialStart);
  let player={position:feet(world,initialPlayer),yaw:0,radius:playerOptions.radius,eyeHeight},robot={position:feet(world,initialStart),yaw:0,radius:robotOptions.radius},goal={...initialGoal},running=false,wantedRunning=false,status='idle',blocked=false,playerBlocked=false,path=[],waypoint=1,route=null,routeRevision=-1,replans=0,travelled=0;
  const pathOptions={...robotOptions,cellSize:options.cellSize??world.navigation.cellSize??DEFAULTS.cellSize,maxExpanded:options.maxExpanded??DEFAULTS.maxExpanded};
  function replan(){route=findPath(world,robot.position,goal,pathOptions);routeRevision=world.revision;path=route.points;waypoint=1;replans++;blocked=route.status!=='ready';running=wantedRunning&&!blocked;status=blocked?route.status:running?'moving':'ready';if(length(robot.position,goal)<0.03&&!blocked){status='arrived';running=false;wantedRunning=false;}return route;}
  function getState(){return{mode:SIM_MODE,revision:world.revision,player:clone(player),robot:{...clone(robot),status,running,blocked,speed},robotPose:clone(robot),goal:feet(world,goal),path:clone(path),running,status,blocked,playerBlocked,routeRevision,replans,travelled,barriers:world.barriers.map(publicBarrier),route:route?{status:route.status,cost:route.cost,expanded:route.expanded,reason:route.reason,revision:route.revision}:null};}
  function step(dt){finite(dt,'dt');if(dt<0)throw new RangeError('dt cannot be negative.');if(routeRevision!==world.revision)replan();if(!running||!path.length)return getState();
    let remaining=Math.min(dt,0.25)*speed;
    while(remaining>1e-7&&waypoint<path.length){const target=path[waypoint],d=length(robot.position,target);if(d<1e-6){waypoint++;continue;}const amount=Math.min(remaining,d),dx=(target.x-robot.position.x)/d*amount,dz=(target.z-robot.position.z)/d*amount,moved=sweepMove(world,robot.position,{x:dx,z:dz},{...robotOptions,slide:false});
      robot.position=moved.position;robot.yaw=Math.atan2(dx,dz);travelled+=moved.distance;remaining-=amount;
      if(moved.blocked){blocked=true;status='blocked';running=false;replan();break;}if(amount>=d-1e-7)waypoint++;
    }
    if(path.length&&waypoint>=path.length&&!blocked){robot.position=feet(world,goal);status='arrived';running=false;wantedRunning=false;blocked=false;}return getState();
  }
  function movePlayer(input,dt){const d=position(input,'player movement');let dx=d.x,dz=d.z;if(dt!==undefined){finite(dt,'dt');if(dt<0)throw new RangeError('dt cannot be negative.');const magnitude=Math.hypot(dx,dz),factor=Math.min(1,magnitude)/(magnitude||1)*playerSpeed*Math.min(dt,0.25);dx*=factor;dz*=factor;}const moved=sweepMove(world,player.position,{x:dx,z:dz},playerOptions);player.position=moved.position;playerBlocked=moved.blocked;return moved;}
  function setPlayerPose(pose){if(!pose||typeof pose!=='object')throw new TypeError('Player pose is required.');if(pose.yaw!==undefined)finite(pose.yaw,'player.yaw');const p=pose.position?position(pose.position):null;if(p&&!pointClear(world,p,playerOptions))throw new Error('Player placement is blocked.');if(p)player.position=feet(world,p);if(pose.yaw!==undefined)player.yaw=pose.yaw;return getState();}
  function updateBarrier(edit){
    const candidate=barrierEdit(world,edit).next,probe={...world,buildings:[],obstacles:[],barriers:[candidate]};
    if(!pointClear(probe,player.position,playerOptions))throw new RangeError('Barrier would overlap the player.');
    if(!pointClear(probe,robot.position,robotOptions))throw new RangeError('Barrier would overlap the robot.');
    const result=setBarrier(world,edit);if(result.changed)replan();return{...result,state:getState()};
  }
  function reset(){world.barriers=world.initialBarriers.map(b=>normalizeBarrier(b,world));world.revision++;player={position:feet(world,initialPlayer),yaw:0,radius:playerOptions.radius,eyeHeight};robot={position:feet(world,initialStart),yaw:0,radius:robotOptions.radius};goal={...initialGoal};running=false;wantedRunning=false;blocked=false;playerBlocked=false;travelled=0;replan();return getState();}
  replan();
  return{world,step,getState,movePlayer,setPlayerPose,setBarrier:updateBarrier,setGoal(value){goal=position(value,'goal');replan();return getState();},startRobot(){wantedRunning=true;replan();return getState();},pauseRobot(){wantedRunning=false;running=false;if(status==='moving')status='paused';return getState();},reset,replan,terrainHeight:(x,z)=>terrainHeight(world,x,z),isClear:(p,r)=>pointClear(world,p,r??robotOptions),colliders:()=>colliderSnapshot(world)};
}
