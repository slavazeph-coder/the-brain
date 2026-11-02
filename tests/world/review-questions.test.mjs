import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewQuestions} from '../../brainsnn-r3f-app/public/world/review-questions.mjs';
import {proposeWorld} from '../../brainsnn-r3f-app/public/world/reconstruction-map.mjs';
import {sampleWorld} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {K,toColmap,room} from './fixtures/synthetic-room.mjs';

const estimate=factor=>({status:'estimated',metres_per_unit:factor/K,frames_used:10,model:{base_model:'Ruicheng/moge-2-vitb-normal'}});
const proposed=(extra={})=>{const r=room();return proposeWorld({points:r.points,reconstruction:{...r.reconstruction,...extra}}).world;};

test('a hand-drawn or imported map asks nothing: there is no scan to check it against',()=>{
  assert.deepEqual(reviewQuestions(sampleWorld()),[]);
  assert.deepEqual(reviewQuestions(null),[]);
});

test('an estimated scale is checked against how high the phone must have been held',()=>{
  const typical=reviewQuestions(proposed({scale_estimate:estimate(1.08)}));
  assert.equal(typical[0].id,'scale');
  assert.match(typical[0].ask,/^Is the space about [\d.]+ × [\d.]+ m\? The scale is estimated, not measured, and it puts your phone a typical 1\.\d m above the floor\./);
  assert.deepEqual(typical[0].action,{workflow:'scale',label:'Measure one distance'});
  // An estimate that puts the phone at knee height is asked about directly, the way a drawing check asks which dimension governs.
  const odd=reviewQuestions(proposed({scale_estimate:estimate(.5)}));
  assert.match(odd[0].ask,/^At the estimated scale your phone was 0\.\d m above the floor while filming\. Is that right\? If not, the scale is off/);
});

test('an assumed scale says what it assumed; a measured one is not asked again',()=>{
  assert.match(reviewQuestions(proposed())[0].ask,/Its scale assumes you held the phone 1\.35 m high\./);
  const r=room(),a=toColmap([2,1,6]),b=toColmap([2.9,1,6]);
  const measured=proposeWorld({points:r.points,reconstruction:r.reconstruction,measurement:{a,b,distance:.9}}).world;
  assert.ok(!reviewQuestions(measured).some(q=>q.id==='scale'));
});

test('unseen area, a cramped start and invisible surfaces are asked about, at most three, scale first',()=>{
  const w=proposed({scale_estimate:estimate(1.08)});
  const hidden={...w,objects:[...w.objects,{id:'unknown-x',name:'Unobserved area X',kind:'unknown',x:0,z:0,w:4,d:3,h:.05}]};
  const crowded={...hidden,start:{x:4.1,z:1.5}};
  const asked=reviewQuestions(crowded);
  assert.deepEqual(asked.map(q=>q.id),['scale','unknown','start']);
  assert.match(asked[1].ask,/^\d+ m² was never seen, so it stays blocked\. Walk it with the phone, or keep it blocked\?$/);
  assert.match(asked[2].ask,/^The robot starts (against|0\.\d m from) an obstacle\. Is that where it really docks\?/);
  const open=reviewQuestions({...w,objects:[],start:{x:w.width/2,z:w.depth/2}});
  assert.deepEqual(open.map(q=>q.id),['scale','glass']);
  assert.deepEqual(open[1].action,{action:'add-object',label:'Add an obstacle'});
});
