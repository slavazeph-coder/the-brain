import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeWorld,readCameras,toMap,PROPOSAL} from '../../brainsnn-r3f-app/public/world/reconstruction-map.mjs';
import {planWorld,planningGate,ROBOTS,LIMITS} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {K,toColmap,room} from './fixtures/synthetic-room.mjs';

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

test('a measured distance between two picked points sets the scale exactly',()=>{
  // Both edges of a 0.9 m doorway in the far wall, as the user would pick them in the 3D view.
  const r=room(),a=toColmap([2,1,6]),b=toColmap([2.9,1,6]);
  const {world,report}=proposeWorld({points:r.points,reconstruction:r.reconstruction,cameraHeight:2,measurement:{a,b,distance:.9}});
  assert.equal(report.scaleSource,'measured-pair');assert.equal(report.assumedCameraHeight,null);
  assert.ok(Math.abs(report.metresPerUnit-1/K)<1e-9,`scale ${report.metresPerUnit}`);
  assert.ok(Math.abs(report.measurement.span-.9*K)<1e-12);
  // The measurement recovers how high the phone really was, regardless of the assumed height.
  assert.ok(Math.abs(report.impliedCameraHeight-1.35)<.08,`implied ${report.impliedCameraHeight}`);
  const p=toMap(report.transform,a),q=toMap(report.transform,b);
  assert.ok(Math.abs(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)-.9)<1e-9);
  assert.equal(world.scaleReviewed,false);assert.equal(report.scaleVerified,false);
  assert.match(world.geometrySource.warnings[0],/self-reported 0\.9 m measurement/);
  // The same pair reported a third longer grows the map by a third.
  const longer=proposeWorld({points:r.points,reconstruction:r.reconstruction,measurement:{a,b,distance:1.2}});
  assert.ok(Math.abs(longer.report.metresPerUnit/report.metresPerUnit-4/3)<1e-9);
  assert.ok(Math.abs(longer.world.width/world.width-4/3)<.1);
});

test('implausible measurements are refused with the reason',()=>{
  const r=room(),a=toColmap([2,1,6]),b=toColmap([2.9,1,6]);
  // 9 m for a doorway would put the phone ~13 m above the floor.
  assert.throws(()=>proposeWorld({points:r.points,reconstruction:r.reconstruction,measurement:{a,b,distance:9}}),/phone 1[0-9]\.\d\d m above the floor/);
  assert.throws(()=>proposeWorld({points:r.points,reconstruction:r.reconstruction,measurement:{a,b:a,distance:1}}),/two different points/);
  assert.throws(()=>proposeWorld({points:r.points,reconstruction:r.reconstruction,measurement:{a,b,distance:NaN}}),/Measured distance/);
  assert.throws(()=>proposeWorld({points:r.points,reconstruction:r.reconstruction,measurement:{a,b,distance:.01}}),/Measured distance/);
  assert.throws(()=>proposeWorld({points:r.points,reconstruction:r.reconstruction,measurement:{a:[1,2],b,distance:1}}),/Pick two/);
  // The assumed height is not used, so an out-of-range value does not block a measured proposal.
  assert.doesNotThrow(()=>proposeWorld({points:r.points,reconstruction:r.reconstruction,cameraHeight:NaN,measurement:{a,b,distance:.9}}));
});

test('MapAnything camera-to-world poses propose the same map as the equivalent COLMAP poses',()=>{
  // Same cameras rewritten as MapAnything stores them: 4x4 camera-to-world with OpenGL axes (right, up, backward) as columns.
  const r=room(),mapanything={schema:'brainsnn.reconstruction.v1',pipeline:'mapanything-apache',cameras:r.reconstruction.cameras.map((c,view)=>{
    const [right,down,forward]=c.world_to_camera.map(row=>row.slice(0,3)),t=c.camera_center;
    return{view,camera_to_world_y_up:[0,1,2].map(i=>[right[i],-down[i],-forward[i],t[i]]).concat([[0,0,0,1]]),intrinsics_opencv:[[1,0,0],[0,1,0],[0,0,1]]};})};
  const a=proposeWorld({points:r.points,reconstruction:r.reconstruction}),b=proposeWorld({points:r.points,reconstruction:mapanything});
  assert.equal(b.report.cameras,a.report.cameras);
  assert.ok(Math.abs(b.report.metresPerUnit-a.report.metresPerUnit)<1e-9);
  assert.deepEqual(b.world.objects,a.world.objects);assert.deepEqual(b.world.start,a.world.start);
  assert.deepEqual(readCameras(mapanything).map(c=>c.name).slice(0,2),['view_0000','view_0001']);
});
