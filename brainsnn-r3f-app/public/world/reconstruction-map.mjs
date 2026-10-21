/** Reconstructed points + camera poses -> a proposed, unreviewed World v1 planning map.
 * Nothing here verifies scale, free space or collision geometry: the output always needs review. */
import {SCHEMA,LIMITS,normalizeWorld} from './core.mjs';

export const PROPOSAL=Object.freeze({cameraHeight:1.35,minCameraHeight:.3,maxCameraHeight:2.5,robotHeight:1.9,cell:.2,floorBand:.1,obstacleMin:.12,walkedRadius:.35,maxWalkStep:1,minObstacleHits:2,strongObstacleHits:4,maxPoints:200000});

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=a=>{const l=Math.hypot(...a);return l>1e-12?a.map(v=>v/l):null;};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const finite=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
function quantile(sorted,q){if(!sorted.length)return NaN;const i=Math.min(sorted.length-1,Math.max(0,Math.floor(q*(sorted.length-1))));return sorted[i];}

/** COLMAP-style evidence: camera_center and a 3x4 or 4x4 world_to_camera matrix per registered image. */
export function readCameras(reconstruction){
  if(!reconstruction||reconstruction.schema!=='brainsnn.reconstruction.v1'||!Array.isArray(reconstruction.cameras))throw new Error('Load the reconstruction.json evidence that came with these points.');
  const cameras=[];
  for(const c of reconstruction.cameras.slice(0,2000)){
    const m=c?.world_to_camera;
    if(!finite(c?.camera_center)||!Array.isArray(m)||m.length<3||m.slice(0,3).some(r=>!Array.isArray(r)||r.length<3||!r.slice(0,3).every(Number.isFinite)))continue;
    // Rows of the rotation are the camera axes in world coordinates: image right, image down, viewing direction.
    cameras.push({name:String(c.image||''),centre:c.camera_center.slice(),down:m[1].slice(0,3),forward:m[2].slice(0,3)});
  }
  if(cameras.length<3)throw new Error('At least 3 reconstructed camera poses are needed to find the floor and scale.');
  return cameras.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}

function pointsOf(points,stride){
  const list=[];
  if(points instanceof Float32Array){const step=Math.max(1,Math.ceil(points.length/stride/PROPOSAL.maxPoints));for(let i=0;i+2<points.length;i+=stride*step){const p=[points[i],points[i+1],points[i+2]];if(finite(p))list.push(p);}}
  else if(Array.isArray(points))for(const p of points.slice(0,PROPOSAL.maxPoints)){const q=p?.slice?.(0,3);if(finite(q))list.push(q);}
  if(list.length<30)throw new Error('At least 30 reconstructed points are needed to propose a map.');
  return list;
}

/** Gravity from how people hold cameras: the mean image-down axis. */
function upAxis(cameras){
  const down=cameras.reduce((s,c)=>{const d=norm(c.down);return d?s.map((v,i)=>v+d[i]):s;},[0,0,0]);
  const agreement=Math.hypot(...down)/cameras.length;
  if(agreement<.6)throw new Error('Camera orientations disagree too much to infer which way is up. Recapture holding the phone upright.');
  return {up:norm(down.map(v=>-v)),agreement};
}

/** Horizontal axes along the walls: most rooms are rectangular, so the right rotation makes
 * projected wall points pile up into sharp histogram peaks. Falls back to the principal spread. */
function horizontalAxes(up,structure,all){
  const seed=Math.abs(up[0])<.9?[1,0,0]:[0,0,1];
  const a=norm(cross(up,seed)),b=norm(cross(up,a));
  const sample=(list,max)=>{const step=Math.max(1,Math.ceil(list.length/max));return list.filter((_,i)=>i%step===0).map(p=>[dot(p,a),dot(p,b)]);};
  const flat=sample(structure.length>=50?structure:all,20000);
  let mx=0,mz=0;for(const p of flat){mx+=p[0];mz+=p[1];}mx/=flat.length;mz/=flat.length;
  const spread=Math.max(1e-9,...flat.map(p=>Math.hypot(p[0]-mx,p[1]-mz))),bins=96,sharp=angle=>{
    const c=Math.cos(angle),s=Math.sin(angle),u=new Float64Array(bins),v=new Float64Array(bins);
    for(const p of flat){const x=p[0]-mx,z=p[1]-mz,i=Math.floor(((c*x+s*z)/spread+1)/2*(bins-1)),j=Math.floor(((-s*x+c*z)/spread+1)/2*(bins-1));u[i]++;v[j]++;}
    let score=0;for(let k=0;k<bins;k++)score+=u[k]*u[k]+v[k]*v[k];return score;};
  let best=0,bestScore=-1;
  for(let d=0;d<90;d+=1){const score=sharp(d*Math.PI/180);if(score>bestScore){bestScore=score;best=d;}}
  for(let d=best-1;d<=best+1;d+=.1){const score=sharp(d*Math.PI/180);if(score>bestScore){bestScore=score;best=d;}}
  let angle=best*Math.PI/180;
  if(structure.length<50){let sxx=0,sxz=0,szz=0;for(const p of flat){const x=p[0]-mx,z=p[1]-mz;sxx+=x*x;sxz+=x*z;szz+=z*z;}angle=.5*Math.atan2(2*sxz,sxx-szz);}
  const c=Math.cos(angle),s=Math.sin(angle),ex=a.map((v,i)=>c*v+s*b[i]);
  return {ex,ez:cross(ex,up),method:structure.length>=50?'wall-alignment':'principal-spread'};
}

/** Lowest dense layer of points below the cameras: floors are many points at one height. */
function floorHeight(heights,cameraHeights){
  const camera=quantile([...cameraHeights].sort((a,b)=>a-b),.5);
  const below=heights.filter(h=>h<camera).sort((a,b)=>a-b);
  if(below.length<20)throw new Error('Too few points below the cameras to find the floor.');
  const lo=quantile(below,.01),hi=camera,bins=60,width=(hi-lo)/bins||1,counts=new Array(bins).fill(0);
  for(const h of below){const i=Math.floor((h-lo)/width);if(i>=0&&i<bins)counts[i]++;}
  const lower=counts.slice(0,Math.ceil(bins*.6)),peak=Math.max(...lower);
  const index=lower.findIndex(c=>c>=Math.max(5,peak*.35));
  return {floor:lo+(index+.5)*width,camera,support:counts[index]/below.length};
}

function rectangles(grid,nx,nz,value){
  const used=new Uint8Array(grid.length),out=[];
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const i=z*nx+x;if(grid[i]!==value||used[i])continue;
    let w=1;while(x+w<nx&&grid[i+w]===value&&!used[i+w])w++;
    let d=1;grow:while(z+d<nz){for(let k=0;k<w;k++){const j=(z+d)*nx+x+k;if(grid[j]!==value||used[j])break grow;}d++;}
    for(let r=0;r<d;r++)for(let k=0;k<w;k++)used[(z+r)*nx+x+k]=1;
    out.push({x,z,w,d});
  }
  return out;
}

const FREE=1,OBSTACLE=2,UNKNOWN=0;

/**
 * @param {{points:Float32Array|number[][],stride?:number,reconstruction:object,name?:string,cameraHeight?:number,robotHeight?:number}} input
 * @returns {{world:object,report:object}}
 */
export function toMap(transform,p){const {ex,up,ez,floor,scale,offset}=transform;return{x:dot(p,ex)*scale-offset[0],y:(dot(p,up)-floor)*scale,z:dot(p,ez)*scale-offset[1]};}

export function proposeWorld({points,stride=14,reconstruction,name='Reconstructed space',cameraHeight=PROPOSAL.cameraHeight,robotHeight=PROPOSAL.robotHeight}){
  if(!Number.isFinite(cameraHeight)||cameraHeight<PROPOSAL.minCameraHeight||cameraHeight>PROPOSAL.maxCameraHeight)throw new Error(`Camera height must be between ${PROPOSAL.minCameraHeight} and ${PROPOSAL.maxCameraHeight} m.`);
  if(!Number.isFinite(robotHeight)||robotHeight<.2||robotHeight>3)throw new Error('Robot height must be between 0.2 and 3 m.');
  const cameras=readCameras(reconstruction),cloud=pointsOf(points,stride),{up,agreement}=upAxis(cameras);
  const {floor,camera,support}=floorHeight(cloud.map(p=>dot(p,up)),cameras.map(c=>dot(c.centre,up)));
  const unitHeight=camera-floor;
  if(!(unitHeight>0))throw new Error('Cameras are not above the detected floor. Check that this is a walkthrough.');
  // Metres per reconstruction unit, from the assumed height the phone was held at.
  const scale=cameraHeight/unitHeight;
  const structure=cloud.filter(p=>{const h=(dot(p,up)-floor)*scale;return h>.3&&h<robotHeight;});
  const axes=horizontalAxes(up,structure,cloud),basis={up,agreement,...axes};
  const project=p=>[dot(p,basis.ex),dot(p,basis.up),dot(p,basis.ez)];
  const pts=cloud.map(project),cams=cameras.map(c=>project(c.centre));
  const metric=p=>[p[0]*scale,(p[1]-floor)*scale,p[2]*scale];
  const P=pts.map(metric),C=cams.map(metric);
  const relevant=P.filter(p=>p[1]>-.3&&p[1]<robotHeight);
  const xs=[...relevant.map(p=>p[0]),...C.map(p=>p[0])].sort((a,b)=>a-b),zs=[...relevant.map(p=>p[2]),...C.map(p=>p[2])].sort((a,b)=>a-b);
  const pad=.5,minX=Math.min(quantile(xs,.01),...C.map(p=>p[0]))-pad,maxX=Math.max(quantile(xs,.99),...C.map(p=>p[0]))+pad;
  const minZ=Math.min(quantile(zs,.01),...C.map(p=>p[2]))-pad,maxZ=Math.max(quantile(zs,.99),...C.map(p=>p[2]))+pad;
  if(maxX-minX>79||maxZ-minZ>79)throw new Error(`At a ${cameraHeight} m camera height this space spans more than 80 m. Check the camera height or capture a smaller area.`);

  // Whole-centimetre cells keep every coordinate a clean decimal; coarser cells only if the map needs fewer boxes.
  const CELLS=[20,25,30,40,50,60,80,100];let cell=PROPOSAL.cell,result=null;
  for(const centimetres of CELLS){if(result)break;cell=centimetres/100;
    const nx=Math.max(5,Math.ceil(Math.max(1,maxX-minX)/cell)),nz=Math.max(5,Math.ceil(Math.max(1,maxZ-minZ)/cell));
    const floorHits=new Uint16Array(nx*nz),obstacleHits=new Uint16Array(nx*nz),tallest=new Float32Array(nx*nz),walked=new Uint8Array(nx*nz);
    const index=(x,z)=>{const i=Math.floor((x-minX)/cell),j=Math.floor((z-minZ)/cell);return i>=0&&j>=0&&i<nx&&j<nz?j*nx+i:-1;};
    for(const p of P){const i=index(p[0],p[2]);if(i<0)continue;
      if(Math.abs(p[1])<=PROPOSAL.floorBand)floorHits[i]=Math.min(65535,floorHits[i]+1);
      else if(p[1]>=PROPOSAL.obstacleMin&&p[1]<=robotHeight){obstacleHits[i]=Math.min(65535,obstacleHits[i]+1);tallest[i]=Math.max(tallest[i],p[1]);}}
    // The person holding the camera walked here: strong evidence of traversable floor at capture time.
    const mark=(x,z)=>{const r=Math.ceil(PROPOSAL.walkedRadius/cell);const cx=Math.floor((x-minX)/cell),cz=Math.floor((z-minZ)/cell);
      for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){const i=cx+dx,j=cz+dz;if(i>=0&&j>=0&&i<nx&&j<nz&&Math.hypot(dx,dz)*cell<=PROPOSAL.walkedRadius+cell/2)walked[j*nx+i]=1;}};
    let walkedDistance=0;
    // Only steps a person could walk between sampled frames count; longer jumps are gaps in the capture.
    for(let k=0;k<C.length;k++){mark(C[k][0],C[k][2]);if(k){const a=C[k-1],b=C[k],len=Math.hypot(b[0]-a[0],b[2]-a[2]);if(len>PROPOSAL.maxWalkStep)continue;walkedDistance+=len;
      for(let t=cell/2;t<len;t+=cell/2)mark(a[0]+(b[0]-a[0])*t/len,a[2]+(b[2]-a[2])*t/len);}}
    const grid=new Uint8Array(nx*nz);
    // Dense evidence of something between floor and robot height wins over the walked path (a camera held over a table);
    // the walked path only overrides sparse, noisy points.
    for(let i=0;i<grid.length;i++)grid[i]=obstacleHits[i]>=PROPOSAL.strongObstacleHits?OBSTACLE:walked[i]?FREE:obstacleHits[i]>=PROPOSAL.minObstacleHits?OBSTACLE:floorHits[i]?FREE:UNKNOWN;
    // An isolated, weakly supported obstacle cell is more likely noise than furniture: it becomes unknown, never free.
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const i=z*nx+x;if(grid[i]!==OBSTACLE||obstacleHits[i]>=PROPOSAL.strongObstacleHits)continue;
      if(![x>0?i-1:-1,x<nx-1?i+1:-1,z>0?i-nx:-1,z<nz-1?i+nx:-1].some(j=>j>=0&&grid[j]===OBSTACLE))grid[i]=UNKNOWN;}
    // Close single-cell gaps: between observed floor cells (never across obstacles), and inside obstacles so furniture stays solid.
    const closed=grid.slice();
    for(let z=1;z<nz-1;z++)for(let x=1;x<nx-1;x++){const i=z*nx+x;if(grid[i]!==UNKNOWN)continue;
      if((grid[i-1]===FREE&&grid[i+1]===FREE)||(grid[i-nx]===FREE&&grid[i+nx]===FREE))closed[i]=FREE;
      else if((grid[i-1]===OBSTACLE&&grid[i+1]===OBSTACLE)||(grid[i-nx]===OBSTACLE&&grid[i+nx]===OBSTACLE))closed[i]=OBSTACLE;}
    const obstacles=rectangles(closed,nx,nz,OBSTACLE),unknown=rectangles(closed,nx,nz,UNKNOWN);
    if(obstacles.length+unknown.length>LIMITS.objects)continue;
    const count=v=>closed.reduce((s,g)=>s+(g===v),0);
    result={nx,nz,cell,closed,obstacles,unknown,walkedDistance,tallest,counts:{free:count(FREE),obstacle:count(OBSTACLE),unknown:count(UNKNOWN)}};
  }
  if(!result)throw new Error('The reconstruction is too fragmented to summarise as a planning map. Capture more of the floor.');
  const {nx,nz,closed,obstacles,unknown}=result;cell=result.cell;const cm=Math.round(cell*100),m=v=>v*cm/100;
  const box=(r,kind,i)=>{let h=.05;if(kind==='obstacle')for(let z=r.z;z<r.z+r.d;z++)for(let x=r.x;x<r.x+r.w;x++)h=Math.max(h,result.tallest[z*nx+x]);
    return{id:`${kind}-${i+1}`,name:kind==='obstacle'?`Reconstructed obstacle ${i+1}`:`Unobserved area ${i+1}`,kind,x:m(r.x),z:m(r.z),w:m(r.w),d:m(r.d),h:Math.round(h*100)/100,
      note:kind==='obstacle'?'Points between the floor and robot height. Confirm it is a fixed obstacle.':'Not seen in the capture. Blocked until observed or reviewed.'};};
  const objects=[...obstacles.map((r,i)=>box(r,'obstacle',i)),...unknown.map((r,i)=>box(r,'unknown',i))];
  // Robot start: the most open free cell (city-block distance to anything not free) within 1.5 m of where
  // the walk began, so a default robot fits; the reviewer can move it.
  const clearance=new Int32Array(nx*nz).fill(-1),queue=[];
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const i=z*nx+x;if(closed[i]!==FREE||x===0||z===0||x===nx-1||z===nz-1){clearance[i]=0;queue.push(i);}}
  for(let head=0;head<queue.length;head++){const i=queue[head],x=i%nx,z=Math.floor(i/nx);
    for(const j of [x>0?i-1:-1,x<nx-1?i+1:-1,z>0?i-nx:-1,z<nz-1?i+nx:-1])if(j>=0&&clearance[j]<0){clearance[j]=clearance[i]+1;queue.push(j);}}
  const first=C[0],fx=(first[0]-minX)/cell,fz=(first[2]-minZ)/cell,reach=1.5/cell;
  let start=null,best=-1;
  for(let pass=0;pass<2&&!start;pass++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const i=z*nx+x,d=Math.hypot(x+.5-fx,z+.5-fz);
    if(closed[i]!==FREE||(pass===0&&d>reach))continue;const score=clearance[i]*1000-d;if(score>best){best=score;start={x:m(x+.5),z:m(z+.5)};}}
  if(!start)throw new Error('No free floor was observed. Walk through the space while recording.');
  const area=n=>Math.round(n*cell*cell*10)/10;
  const warnings=[
    `Scale estimated from an assumed ${cameraHeight} m camera height (1 reconstruction unit ≈ ${scale.toFixed(3)} m). Confirm with a measured distance.`,
    'Free space is where the camera passed (steps up to 1 m) and where floor points were seen; gaps up to one cell were joined. Unobserved areas are blocked.',
    `Obstacles are point clusters between ${PROPOSAL.obstacleMin} m and ${robotHeight} m above the detected floor. Glass, plain walls and moving people may be missing.`,
    'Proposed from a reconstruction. Not reviewed, not metric-verified, not a safety assessment.',
  ];
  const world=normalizeWorld({schema:SCHEMA,name:String(name).slice(0,160),width:m(nx),depth:m(nz),provenance:'observed',scaleReviewed:false,mapReviewed:false,start,objects,
    geometrySource:{kind:'reconstruction-proposal',name:String(name).slice(0,160),warnings}});
  const report={schema:'brainsnn.map-proposal.v1',method:'camera-up/floor-histogram/occupancy-grid-v1',alignment:basis.method,cameras:cameras.length,points:cloud.length,upAgreement:Math.round(basis.agreement*1000)/1000,
    floorSupport:Math.round(support*1000)/1000,assumedCameraHeight:cameraHeight,metresPerUnit:scale,robotHeight,cell,grid:[nx,nz],walkedDistance:Math.round(result.walkedDistance*100)/100,
    area:{free:area(result.counts.free),obstacle:area(result.counts.obstacle),unknown:area(result.counts.unknown)},objects:{obstacles:obstacles.length,unknown:unknown.length},
    // Input coordinates -> map metres: x=dot(p,ex)*scale-offset[0], y=(dot(p,up)-floor)*scale, z=dot(p,ez)*scale-offset[1].
    transform:{ex:basis.ex,up:basis.up,ez:basis.ez,floor,scale,offset:[minX,minZ]},
    scaleVerified:false,reviewed:false,warnings};
  return{world,report};
}
