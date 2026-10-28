/** Terrain evidence inspection; no policy, learned inference, downloads or robot commands.
 * Inspired by ETH Zurich Watch Your Step, arXiv:2610.29612.
 * Brain XYZ (Y-up) -> Isaac [X,-Z,Y]. Grid is [left,forward].
 */
export const GRID=Object.freeze({nx:33,ny:21,resolution:.05,origin:[-.8,-.5]});
const numeric=(v,bound=10000)=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>bound)throw Error('Expected finite bounded numbers.');return v;};
const vector=(v,n)=>{if(!Array.isArray(v)||v.length!==n)throw Error(`Expected ${n} coordinates.`);return v.map(x=>numeric(x));};
// Torch/Python use nearest-even ties, not JavaScript's asymmetric Math.round.
export function roundEven(x){const lo=Math.floor(x),f=x-lo;return f<.5?lo:f>.5?lo+1:lo%2===0?lo:lo+1;}
const scanAnchor=(v,o)=>roundEven(Math.fround(Math.fround(Math.fround(v)-Math.fround(o))/Math.fround(.05)));
export function cloudGrid(cloud,basePosition,yawRad=0,minPoints=2,maxSpread=.03){
  if(cloud?.units!=='m'||cloud.coordinateFrame!=='right-handed-y-up'||!Array.isArray(cloud.points)||cloud.points.length<1||cloud.points.length>250000)throw Error('A metre-scaled Y-up source cloud with 1–250000 points is required.');
  const base=vector(basePosition,3),yaw=numeric(yawRad,2*Math.PI);
  if(!Number.isInteger(minPoints)||minPoints<1||minPoints>100||numeric(maxSpread,.25)<=0)throw Error('Invalid evidence thresholds.');
  const cells=Array.from({length:693},()=>({n:0,sum:0,min:Infinity,max:-Infinity})),c=Math.cos(yaw),s=Math.sin(yaw);
  for(const row of cloud.points){
    if(!Array.isArray(row)||row.length<3)throw Error('Every point needs XYZ coordinates.');
    const [x,y,z]=vector(row.slice(0,3),3);if(y<base[1]-2||y>base[1]-.05)continue;
    const dx=x-base[0],dy=-(z-base[2]),sx=c*dx+s*dy,sy=-s*dx+c*dy;
    if(sx<-.8||sx>.8||sy<-.5||sy>.5)continue;
    const ix=roundEven((sx+.8)/.05),iy=roundEven((sy+.5)/.05),cell=cells[iy*33+ix];
    cell.n++;cell.sum+=y;cell.min=Math.min(cell.min,y);cell.max=Math.max(cell.max,y);
  }
  const reasons=cells.map(v=>!v.n?'unobserved':v.n<minPoints?'insufficient-points':v.max-v.min>maxSpread?'mixed-height':'observed');
  return {shape:[21,33],resolution_m:.05,origin_xy_m:[-.8,-.5],
    height_scan:cells.map((v,i)=>reasons[i]==='observed'?base[1]-v.sum/v.n-.5:null),cell_status:reasons,
    base_position_brainsnn_m:base,sensor_yaw_rad:yaw,min_points:minPoints,max_spread_m:maxSpread,
    vertical_window_m:[base[1]-2,base[1]-.05],source_point_count:cloud.points.length};
}
export function samplePatches(heightScan,footholdsBase,footholdsSensor=null){
  if(!Array.isArray(heightScan)||heightScan.length!==693)throw Error('Expected a full 21 by 33 height scan.');
  const scan=heightScan.map(v=>v===null?null:numeric(v));
  if(!Array.isArray(footholdsBase)||footholdsBase.length!==2)throw Error('Exactly two footholds are required.');
  const base=footholdsBase.map(p=>vector(p,2)),sensor=footholdsSensor===null?base:footholdsSensor;
  if(!Array.isArray(sensor)||sensor.length!==2)throw Error('Exactly two sensor-frame footholds are required.');
  const patches=[],raw=[];
  for(let i=0;i<2;i++){
    const q=vector(sensor[i],2),p=base[i],ax=scanAnchor(q[0],-.8),ay=scanAnchor(q[1],-.5);
    const indices=[],heights=[],statuses=[];
    for(let ox=-3;ox<=3;ox++)for(let oy=-3;oy<=3;oy++){
      const x=ax+ox,y=ay+oy,inside=x>=0&&x<33&&y>=0&&y<21,index=inside?y*33+x:null,height=inside?scan[index]:null;
      indices.push(index);heights.push(height);statuses.push(!inside?'outside-map':height===null?'unknown':'observed');
    }
    const known=heights.filter(v=>v!==null);
    patches.push({foothold_base_xy_m:p,foothold_sensor_xy_m:q,anchor_xy:[ax,ay],indices,heights,status:statuses,known_count:known.length,height_range_m:known.length?Math.max(...known)-Math.min(...known):null});
    raw.push(...p,...heights);
  }
  const complete=raw.every(v=>v!==null);
  return {schema:'brainsnn.foothold-focus.v1',layout:'p1.xy,h1[49],p2.xy,h2[49];patch=x-outer,y-inner',patches,
    input_values:102,full_map_values:693,sample_complete:complete,observation_raw:complete?raw:null,
    observation_clipped:complete?raw.map(v=>Math.max(-1,Math.min(1,v))):null,
    validity_mask:patches.flatMap(p=>p.heights.map(v=>v!==null)),
    physics_executed:false,robot_control_enabled:false,metric_verified:false,checkpoint_compatible:false,
    warnings:['Coverage is not load-bearing support, collision clearance or physical accuracy.',
      'Unknown, mixed-height and out-of-bounds cells are never replaced by flat ground.',
      'This scan snapshot is not a live elevation map; moving objects are not tracked.',
      'No locomotion policy, physics simulation or physical robot was executed.']};
}
export function inspectCloud(cloud,query){
  if(query?.schema!=='brainsnn.foothold-query.v1')throw Error('Expected a brainsnn.foothold-query.v1 query.');
  const grid=cloudGrid(cloud,query.base_position_brainsnn_m,query.yaw_rad??0,query.min_points??2,query.max_spread_m??.03);
  return {...samplePatches(grid.height_scan,query.footholds_base_xy_m),grid,
    foothold_basis:'operator-query-not-model-prediction',source_basis:'observed-point-binning-not-raycast',query:structuredClone(query)};
}
