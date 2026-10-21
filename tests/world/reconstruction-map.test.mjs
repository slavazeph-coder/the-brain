import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeWorld,readCameras,toMap,PROPOSAL} from '../../brainsnn-r3f-app/public/world/reconstruction-map.mjs';
import {planWorld,planningGate,ROBOTS,LIMITS} from '../../brainsnn-r3f-app/public/world/core.mjs';

// A measured 8 x 6 m room, then the arbitrary frame COLMAP would report: rotated, scaled by K and shifted.
const K=.37,SHIFT=[4,-2,7];
function rotation(ax,ay,az){const [ca,sa,cb,sb,cc,sc]=[Math.cos(ax),Math.sin(ax),Math.cos(ay),Math.sin(ay),Math.cos(az),Math.sin(az)];
  return [[cb*cc,sa*sb*cc-ca*sc,ca*sb*cc+sa*sc],[cb*sc,sa*sb*sc+ca*cc,ca*sb*sc-sa*cc],[-sb,sa*cb,ca*cb]];}
const R=rotation(.9,-.4,2.1);
const apply=(M,v)=>M.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
const toColmap=p=>apply(R,p).map((v,i)=>v*K+SHIFT[i]);
const BOX={x:[3,4],z:[2,3],h:.8},HIDDEN={x:[6.4,8],z:[5,6]};
function room({tilt=0}={}){
  const pts=[];
  for(let x=.05;x<8;x+=.15)for(let z=.05;z<6;z+=.15){
    const hidden=x>HIDDEN.x[0]&&z>HIDDEN.z[0],inBox=x>BOX.x[0]&&x<BOX.x[1]&&z>BOX.z[0]&&z<BOX.z[1];
    if(!hidden&&!inBox)pts.push([x,0,z]);}
  for(let x=BOX.x[0];x<=BOX.x[1];x+=.1)for(let z=BOX.z[0];z<=BOX.z[1];z+=.1){pts.push([x,BOX.h,z]);for(let y=.15;y<BOX.h;y+=.15)if(x===BOX.x[0]||z===BOX.z[0])pts.push([x,y,z]);}
  for(let s=0;s<8;s+=.2)for(let y=.2;y<2.5;y+=.2){pts.push([s,y,0]);if(s<6.4)pts.push([s,y,6]);}
  for(let s=0;s<6;s+=.2)for(let y=.2;y<2.5;y+=.2){pts.push([0,y,s]);if(s<5)pts.push([8,y,s]);}
  // A walk around the box at chest height, phone upright and facing along the path.
  const path=[];for(let t=0;t<1;t+=.02){const a=t*Math.PI*2;path.push([4+2.4*Math.cos(a),1.35,2.8+1.7*Math.sin(a)]);}
  const cameras=path.map((c,i)=>{const n=path[(i+1)%path.length],f=[n[0]-c[0],Math.sin(tilt*i)*.05,n[2]-c[2]],l=Math.hypot(...f),fw=f.map(v=>v/l);
    const down=[0,-1,0],right=[fw[1]*down[2]-fw[2]*down[1],fw[2]*down[0]-fw[0]*down[2],fw[0]*down[1]-fw[1]*down[0]];
    const rows=[right,down,fw].map(r=>apply(R,r));
    return{image:`image_${String(i).padStart(4,'0')}.jpg`,camera_center:toColmap(c),world_to_camera:[[...rows[0],0],[...rows[1],0],[...rows[2],0]]};});
  return{points:pts.map(toColmap),reconstruction:{schema:'brainsnn.reconstruction.v1',cameras},truth:{pts,path}};
}
const inside=(o,p)=>p.x>=o.x&&p.x<=o.x+o.w&&p.z>=o.z&&p.z<=o.z+o.d;

test('a reconstruction becomes an unreviewed observed map with recovered scale',()=>{
  const r=room(),{world,report}=proposeWorld({points:r.points,reconstruction:r.reconstruction,name:'Synthetic room'});
  assert.equal(world.provenance,'observed');
  assert.equal(world.scaleReviewed,false);assert.equal(world.mapReviewed,false);
  assert.match(planningGate(world),/scale/);
  assert.equal(world.geometrySource.kind,'reconstruction-proposal');
  assert.ok(Math.abs(report.metresPerUnit-1/K)/(1/K)<.03,`scale ${report.metresPerUnit}`);
  const dims=[world.width,world.depth].sort((a,b)=>a-b);
  assert.ok(Math.abs(dims[1]-9)<1.2&&Math.abs(dims[0]-7)<1.2,`dims ${dims}`);
  assert.ok(world.objects.length<=LIMITS.objects);
  assert.equal(report.scaleVerified,false);
  assert.ok(report.warnings.some(w=>/assumed 1\.35 m camera height/.test(w)));
});

test('the box is an obstacle, the hidden corner is unknown and the walked path is free',()=>{
  const r=room(),{world,report}=proposeWorld({points:r.points,reconstruction:r.reconstruction});
  const at=p=>world.objects.filter(o=>inside(o,toMap(report.transform,toColmap(p))));
  assert.ok(at([3.5,.4,2.5]).some(o=>o.kind==='obstacle'),'box centre');
  assert.ok(at([7.3,0,5.6]).some(o=>o.kind==='unknown'),'hidden corner');
  for(const c of r.truth.path)assert.equal(at([c[0],0,c[2]]).length,0,`walked ${c}`);
  const box=at([3.5,.4,2.5]).find(o=>o.kind==='obstacle');
  assert.ok(box.h>.6&&box.h<1,`box height ${box.h}`);
  // The robot starts in the most open free cell near where the walk began.
  const first=toMap(report.transform,toColmap(r.truth.path[0]));
  assert.ok(Math.hypot(first.x-world.start.x,first.z-world.start.z)<=1.5+report.cell);
  assert.ok(!world.objects.some(o=>world.start.x>o.x-.5&&world.start.x<o.x+o.w+.5&&world.start.z>o.z-.5&&world.start.z<o.z+o.d+.5),'start has clearance');
});

test('a reviewed proposal plans routes that never enter obstacles or unknown space',()=>{
  const r=room(),{world}=proposeWorld({points:r.points,reconstruction:r.reconstruction});
  const reviewed={...world,scaleReviewed:true,mapReviewed:true},robot={...ROBOTS.cleaner,margin:.05};
  const plan=planWorld(reviewed,robot);
  assert.ok(plan.distance>5);assert.equal(plan.policyExecuted,false);
  for(const p of plan.route)for(const o of reviewed.objects)assert.ok(!inside(o,p),`route enters ${o.id}`);
});

test('the assumed camera height sets scale and is bounded',()=>{
  const r=room(),a=proposeWorld({points:r.points,reconstruction:r.reconstruction,cameraHeight:1.35}),b=proposeWorld({points:r.points,reconstruction:r.reconstruction,cameraHeight:1.62});
  assert.ok(Math.abs(b.report.metresPerUnit/a.report.metresPerUnit-1.2)<1e-9);
  assert.ok(b.world.width>a.world.width);
  for(const cameraHeight of [.1,3,NaN])assert.throws(()=>proposeWorld({points:r.points,reconstruction:r.reconstruction,cameraHeight}),/Camera height/);
  assert.equal(PROPOSAL.cameraHeight,1.35);
});

test('the proposal is deterministic and accepts the viewer buffer layout',()=>{
  const r=room(),flat=new Float32Array(r.points.length*14);r.points.forEach((p,i)=>flat.set(p,i*14));
  const a=proposeWorld({points:r.points,reconstruction:r.reconstruction}),b=proposeWorld({points:flat,reconstruction:r.reconstruction});
  assert.deepEqual(proposeWorld({points:r.points,reconstruction:r.reconstruction}).world,a.world);
  assert.equal(b.world.objects.length,a.world.objects.length);
  assert.ok(Math.abs(b.report.metresPerUnit-a.report.metresPerUnit)<1e-3);
});

test('missing or contradictory evidence is refused instead of guessed',()=>{
  const r=room();
  assert.throws(()=>readCameras({schema:'other',cameras:[]}),/reconstruction\.json/);
  assert.throws(()=>proposeWorld({points:r.points,reconstruction:{...r.reconstruction,cameras:r.reconstruction.cameras.slice(0,2)}}),/3 reconstructed camera/);
  assert.throws(()=>proposeWorld({points:r.points.slice(0,10),reconstruction:r.reconstruction}),/30 reconstructed points/);
  const scrambled={...r.reconstruction,cameras:r.reconstruction.cameras.map((c,i)=>({...c,world_to_camera:i%2?c.world_to_camera.map((row,j)=>j===1?row.map(v=>-v):row):c.world_to_camera}))};
  assert.throws(()=>proposeWorld({points:r.points,reconstruction:scrambled}),/which way is up/);
  assert.throws(()=>proposeWorld({points:r.points,reconstruction:r.reconstruction,cameraHeight:2.5,robotHeight:9}),/Robot height/);
});
