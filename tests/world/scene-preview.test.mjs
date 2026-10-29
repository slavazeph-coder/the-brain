import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneFacts,worldFromScene,SCENE_SCHEMA} from '../../brainsnn-r3f-app/public/world/scene-preview.mjs';
import {planWorld,planningGate,ROBOTS,LIMITS} from '../../brainsnn-r3f-app/public/world/core.mjs';
const scene=(over={})=>({schema:SCENE_SCHEMA,units:'arbitrary',counts:{points:6195,walls:1,objects:0,unplaced:2,unknown_cells:14},usd:{written:false,reason:'Isaac Sim reads USD in metres.'},...over});
test('scene facts come only from scene.json and say what was observed, detected and unknown',()=>{
  const f=sceneFacts(scene());
  assert.equal(f[0],'Observed: 6,195 reconstructed points, a floor bounding extent and 1 wall.');
  assert.equal(f[1],'Detected: no objects placed, 2 left unplaced.');
  assert.match(f[2],/^Unknown: 14 floor cells .*never free space\.$/);
  assert.match(f[3],/arbitrary reconstruction units/);
  assert.match(f[4],/^No scene\.usda: .*no measured scale\. .*Export static OpenUSD\.$/);});
test('a metric scene with a written USD says so',()=>{const f=sceneFacts(scene({units:'m',counts:{points:10,walls:3,objects:1,unplaced:0,unknown_cells:0},usd:{written:true,metersPerUnit:1}}));
  assert.equal(f[1],'Detected: 1 object placed from 2D detections.');assert.equal(f[3],'Units: metres, from the scale recorded in this scene.');assert.match(f[4],/^scene\.usda was written/);});
test('missing or malformed scene.json never produces invented counts or scale',()=>{
  for(const bad of [null,undefined,'x',{},{schema:'other'}])assert.deepEqual(sceneFacts(bad),['No valid scene.json came with this scene, so its provenance and scale are unknown. Treat it as a picture only.']);
  const f=sceneFacts(scene({counts:{points:-1,walls:1.5,objects:'3',unknown_cells:NaN},usd:undefined,units:'ft'}));
  assert.deepEqual(f,['Observed: counts not recorded.','Detected: not recorded.','Unknown space: not recorded.','Units: not recorded.','USD status was not recorded.']);
  // An unsupported unit is unknown, so neither the units nor the missing USD are explained as an unmeasured scene.
  assert.deepEqual(sceneFacts(scene({units:'ft',usd:{written:false,reason:'Fixture reason.'}})).slice(3),['Units: not recorded.','No scene.usda. Fixture reason.']);
  assert.ok(sceneFacts(scene({units:'m',usd:{written:false,reason:'r'.repeat(5000)}}))[4].length<='No scene.usda. '.length+300);});
test('a scene scaled by a distance the user measured says it is self-reported',()=>{
  const f=sceneFacts(scene({units:'m',scale:{source:'user-measured',metresPerUnit:.66,distance:3.581,selfReported:true,verified:false},usd:{written:true,metersPerUnit:1}}));
  assert.equal(f[3],'Units: metres, from an entered distance (3.581 m). Self-reported, not verified.');
  assert.equal(f.length,5,'no IFC line unless scene.json says it was written');
  assert.match(sceneFacts(scene({units:'m',usd:{written:true},ifc:{written:true,schema:'IFC4'}}))[5],/^scene\.ifc was written for BIM tools \(IFC4, metres\)/);
  assert.equal(sceneFacts(scene({ifc:{written:false,reason:'x'}})).length,5);
  assert.equal(sceneFacts(scene({units:'m',scale:{selfReported:true,distance:'3 m'}}))[3],'Units: metres, from an entered distance. Self-reported, not verified.');});
test('separated objects are counted and the largest are measured, only from scene.json',()=>{
  const objects=[{name:'object_1',label:'object',kind:'separated',size:[3.412,0.731,1.26]},{name:'object_2',label:'chair',kind:'separated',size:[0.5,0.9,0.48]},
    {name:'floor_observed',label:'floor',size:[4,0.02,8]},{name:'object_3',kind:'separated',size:[1,NaN,1]}];
  const f=sceneFacts(scene({units:'m',usd:{written:true},ifc:{written:true},separation:{done:true},counts:{points:10,walls:2,objects:0,unplaced:0,unknown_cells:0,separated:3},objects}));
  assert.equal(f[6],'Separated: 3 objects from the points, each measured as an oriented box in metres. Largest: Object 1: 3.41 × 1.26 m, 0.73 m high; chair: 0.50 × 0.48 m, 0.90 m high.');
  assert.equal(sceneFacts(scene({separation:{done:false,reason:'x'}}))[5],'Separated: none, because object sizes need a measured scale.');
  assert.equal(sceneFacts(scene({units:'m',usd:{written:true},separation:{done:true},counts:{points:1,walls:0,objects:0,unknown_cells:0,separated:0}}))[5],'Separated: no clusters of points stand above the floor apart from walls.');
  assert.equal(sceneFacts(scene()).length,5,'older scenes without separation add no line');});
test('an inferred base and the fit check are reported from scene.json, with misfits by name',()=>{
  const objects=[{name:'object_1',label:'sofa',kind:'separated',size:[3,0.7,1.2]},{name:'object_2',label:'chair',kind:'separated',size:[1,1,0.8],base:'inferred'}];
  const fit={within_5cm:0.623,by_kind:{floor:{median_cm:0.7},wall:{median_cm:2.7},object:{median_cm:5.6}},misfits:['object_1','wall_9']};
  const f=sceneFacts(scene({units:'m',usd:{written:true},separation:{done:true},counts:{points:1,walls:0,objects:0,unknown_cells:0,separated:2},objects,fit}));
  assert.ok(f.includes('Inferred: 1 object stands on the floor, though the floor under it went unseen. Check against the walkthrough.'));
  assert.equal(f.at(-1),'Fit: 62% of points within 5 cm of the model (median floor 0.7 cm, walls 2.7 cm, objects 5.6 cm); flagged for review: sofa, Wall 9. Model to points, not a survey.');
  for(const bad of [{within_5cm:2},{within_5cm:'62%'},null])assert.ok(!sceneFacts(scene({units:'m',fit:bad})).some(l=>l.startsWith('Fit')),'a malformed fit says nothing');
  assert.ok(!sceneFacts(scene({fit})).some(l=>l.startsWith('Fit')),'an unscaled scene states no centimetres');
  assert.ok(!sceneFacts(scene()).some(l=>l.startsWith('Inferred')||l.startsWith('Fit')));});
test('model names are reported as unreviewed suggestions, with the model that made them',()=>{
  const f=sceneFacts(scene({units:'m',usd:{written:true},separation:{done:true},counts:{points:1,walls:0,objects:0,unknown_cells:0,separated:3},naming:{model:'claude-opus-5-5',named:2,reviewed:false}}));
  assert.equal(f.at(-1),'Named: 2 objects by claude-opus-5-5 from the walkthrough frames. Suggestions, not reviewed.');
  assert.ok(!sceneFacts(scene({naming:null})).some(l=>l.startsWith('Named')));
  assert.ok(!sceneFacts(scene({naming:{model:'m',named:-1}})).some(l=>l.startsWith('Named')),'a malformed count is not reported');});

// A measured 4 x 6 m room in the compiler's frame (floor at y = -0.02, x from -2, z from -3): two walls, a diagonal
// separated object, a detected box, a detection that could not be placed, and three unobserved cells in a row.
const metric=(over={})=>({schema:SCENE_SCHEMA,units:'m',scale:{source:'user-measured',selfReported:true,distance:2},source:'dense-preview.ply',floor_y:-.02,
  objects:[{name:'floor_observed',label:'floor',min:[-2,-.04,-3],max:[2,-.02,3]},
    {name:'object_1',label:'object',kind:'separated',centre:[.5,.38,0],size:[1.6,.8,.6],yaw_degrees:45},
    {name:'chair',label:'chair',provenance:'detected',min:[-1.2,-.02,1.8],max:[-.7,.88,2.3]},
    {name:'lamp',label:'lamp',provenance:'detected-unplaced',reason:'no pose'}],
  walls:[{name:'wall_1',label:'wall',centre:[0,1.18,-2.9],size:[4,2.4,.2],yaw_degrees:0},{name:'wall_2',label:'wall',centre:[1.9,1.18,0],size:[6,2.4,.2],yaw_degrees:90}],
  unknown:[[-2,-1,.5],[-1.5,-1,.5],[-1,-1,.5]],...over});
const inBox=(o,x,z,r=0)=>x>=o.x-r&&x<=o.x+o.w+r&&z>=o.z-r&&z<=o.z+o.d+r;
test('a metric scene becomes an unreviewed planning map whose boxes contain every wall and object',()=>{
  const {world,counts,summary}=worldFromScene(metric(),'Scene map / test');
  assert.deepEqual(counts,{walls:2,separated:1,detected:1,unknown:1,outside:0});
  assert.equal(summary,'Map built from the simulation scene: 2 walls and 2 objects as obstacles, 1 unobserved area, 4 × 6 m floor bounding extent. Review scale and obstacles, then plan.');
  assert.equal(world.provenance,'observed');assert.equal(world.scaleReviewed,false);assert.equal(world.mapReviewed,false);
  assert.match(planningGate(world),/scale/);assert.equal(world.geometrySource.kind,'compiled-scene');
  assert.ok(world.geometrySource.warnings.some(w=>/entered distance, not verified/.test(w)));
  assert.equal(world.width,4);assert.equal(world.depth,6);
  // Every point of the diagonal object's footprint lies in one of its strips, and the strips block far less than one box would.
  const parts=world.objects.filter(o=>o.id.startsWith('object-1-'));assert.ok(parts.length>1&&parts.every(o=>/^Object 1 \(part \d of \d\)$/.test(o.name)));
  const a=Math.PI/4;
  for(let u=-.8;u<=.8;u+=.05)for(let v=-.3;v<=.3;v+=.05){const x=.5+u*Math.cos(a)-v*Math.sin(a)+2,z=u*Math.sin(a)+v*Math.cos(a)+3;
    assert.ok(parts.some(o=>inBox(o,x,z,1e-9)),`object point ${x.toFixed(2)}, ${z.toFixed(2)}`);}
  let covered=0;for(let x=.005;x<4;x+=.01)for(let z=.005;z<6;z+=.01)if(parts.some(o=>inBox(o,x,z)))covered+=1e-4;
  const aabb=((1.6+.6)*Math.SQRT1_2)**2;assert.ok(covered<.7*aabb,`strips block ${covered.toFixed(2)} m² vs ${aabb.toFixed(2)} m² for one box`);
  assert.ok(parts.every(o=>Math.abs(o.h-.8)<.011),'height above the floor');
  const wall=world.objects.find(o=>o.id==='wall-1');assert.deepEqual([wall.x,wall.z,wall.w,wall.d,wall.h],[0,0,4,.2,2.4]);
  const chair=world.objects.find(o=>o.name==='chair');assert.deepEqual([chair.x,chair.z,chair.w,chair.d,chair.h],[.8,4.8,.5,.5,.9]);
  assert.ok(!world.objects.some(o=>o.name==='lamp'),'an unplaced detection has no geometry to block with');
  const unknown=world.objects.filter(o=>o.kind==='unknown');assert.deepEqual(unknown.map(o=>[o.x,o.z,o.w,o.d]),[[0,2,1.5,.5]]);
  assert.ok(!world.objects.some(o=>inBox(o,world.start.x,world.start.z,.3)),'the start is clear of every box');
  // An element entirely beyond the observed floor is left out and said so; one partly on it is clipped to the floor.
  const beyond=worldFromScene(metric({walls:[...metric().walls,{name:'wall_3',centre:[9,1.18,0],size:[2,2.4,.2],yaw_degrees:0},{name:'wall_4',centre:[2,1.18,0],size:[1,2.4,.2],yaw_degrees:0}]}));
  assert.equal(beyond.counts.outside,1);assert.match(beyond.summary,/4 × 6 m floor bounding extent \(1 beyond it left out\)\./);
  const clipped=beyond.world.objects.find(o=>o.id==='wall-4');assert.deepEqual([clipped.x,clipped.w],[3.5,.5]);});
test('a reviewed scene map plans a route that never enters a wall, object or unobserved area',()=>{
  const {world}=worldFromScene(metric()),robot=ROBOTS.vacuum,plan=planWorld({...world,scaleReviewed:true,mapReviewed:true},robot);
  assert.ok(plan.distance>5&&plan.reachableArea>2,`route ${plan.distance} m over ${plan.reachableArea} m²`);
  const radius=Math.hypot(robot.width,robot.depth)/2;
  for(const p of plan.route)assert.ok(!world.objects.some(o=>inBox(o,p.x,p.z,radius-1e-6)),`route point ${p.x}, ${p.z}`);});
test('scenes without metres, a floor or valid json are refused, never guessed',()=>{
  assert.throws(()=>worldFromScene(null),/No valid scene\.json/);
  assert.throws(()=>worldFromScene(metric({units:'arbitrary'})),/metric scene/);
  assert.throws(()=>worldFromScene(metric({objects:[]})),/no floor bounding extent/);
  assert.throws(()=>worldFromScene(metric({floor_y:NaN})),/no floor bounding extent/);
  // Malformed elements and cells are skipped rather than placed somewhere.
  const {counts}=worldFromScene(metric({walls:[null,{name:'wall_x',centre:[0,1],size:[1,1,1],yaw_degrees:0}],unknown:[[0,0],[0,0,-1],'x']}));
  assert.deepEqual(counts,{walls:0,separated:1,detected:1,unknown:0,outside:0});
  // A box with a centre and size but no yaw is axis-aligned.
  const plain=worldFromScene(metric({objects:[{name:'floor_observed',label:'floor',centre:[0,-.03,0],size:[4,.02,6]}],walls:[],unknown:[]})).world;
  assert.deepEqual([plain.width,plain.depth,plain.objects.length],[4,6,0]);});
test('diagonal objects share the object budget as strips, and a scene beyond it is refused',()=>{
  const many=n=>Array.from({length:n},(_,i)=>({name:`object_${i+1}`,label:'object',kind:'separated',centre:[-1.8+(i%13)*.3,.2,-2.5+Math.floor(i/13)*.5],size:[.3,.4,.1],yaw_degrees:30}));
  const floor=metric().objects[0];
  const {world}=worldFromScene(metric({objects:[floor,...many(40)],walls:[],unknown:[]}));
  assert.ok(world.objects.length<=LIMITS.objects);assert.ok(world.objects.every(o=>/\(part \d of 3\)$/.test(o.name)),'40 diagonal objects get 3 strips each');
  assert.throws(()=>worldFromScene(metric({objects:[floor,...many(130)],walls:[],unknown:[]})),/at most 128/);});

function withOpening(over={},wallOver={}) {
  const s=metric({objects:[metric().objects[0]],walls:[{...metric().walls[0],...wallOver}],unknown:[]}),w=s.walls[0];
  s.openings=[{id:'entry',hostWall:w.name,offsetMeters:1.5,widthMeters:1,heightMeters:2.1,sillMeters:0,kind:'opening',reviewed:true,
    host:{centre:[...w.centre],size:[...w.size],yaw_degrees:w.yaw_degrees},...over}];
  return s;
}
test('reviewed floor voids produce a real planning gap with rotated jambs preserved',()=>{
  for(const yaw of [0,30,90]) {
    const s=withOpening({}, {centre:[0,1.18,0],yaw_degrees:yaw}),{world,counts}=worldFromScene(s),a=yaw*Math.PI/180;
    const walls=world.objects.filter(o=>o.id.startsWith('wall-'));
    assert.equal(counts.walls,1);assert.ok(walls.length>=2);
    assert.ok(!walls.some(o=>inBox(o,2,3)),`yaw ${yaw}: void midpoint must be clear`);
    for(const along of [-1.9,-1.3,.8,1.8]) {
      const x=2+along*Math.cos(a),z=3+along*Math.sin(a);
      assert.ok(walls.some(o=>inBox(o,x,z,1e-8)),`yaw ${yaw}: jamb ${along} must stay blocked`);
    }
    assert.ok(world.geometrySource.warnings.some(w=>/2 m headroom/.test(w)));
  }
});
test('raised windows, low voids, closed reference doors and unknown floor remain blocked',()=>{
  for(const o of [{kind:'door'},{sillMeters:.9,heightMeters:1.1},{heightMeters:1.5}]) {
    const {world}=worldFromScene(withOpening(o,{centre:[0,1.18,0]}));
    assert.ok(world.objects.some(o=>inBox(o,2,3)),JSON.stringify(o));
  }
  const s=withOpening({}, {centre:[0,1.18,0]});s.unknown=[[-.25,-.25,.5]];
  assert.ok(worldFromScene(s).world.objects.some(o=>o.kind==='unknown'&&inBox(o,2,3)),'a void does not erase unknown floor');
});
test('malformed, stale or overlapping reviewed voids are refused before a planning map is made',()=>{
  for(const over of [{reviewed:false},{offsetMeters:-1},{widthMeters:5},{heightMeters:3},{kind:'window'},
    {host:{centre:[1,1.18,-2.9],size:[4,2.4,.2],yaw_degrees:0}}]) {
    assert.throws(()=>worldFromScene(withOpening(over)),/review|host/i);
  }
  const s=withOpening();s.openings.push({...s.openings[0],id:'overlap',offsetMeters:1.6});
  assert.throws(()=>worldFromScene(s),/overlap/);
});
