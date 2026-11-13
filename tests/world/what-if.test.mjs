/** What-if: the before/after comparison is only made for the robot that drove the first route. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBefore,compare,sameRobot,whatIfCard} from '../../brainsnn-r3f-app/public/world/what-if.mjs';
import {ROBOTS} from '../../brainsnn-r3f-app/public/world/core.mjs';

const route={goal:{x:9,z:4},distance:10.8,travelSeconds:30,route:[{x:1,z:1},{x:9,z:4}]};
const world={objects:[{id:'cart',name:'Cart'}]};
const cleaner={...ROBOTS.cleaner,margin:.1};
const before=robot=>captureBefore({goal:route.goal,result:route,world,selected:'cart',kind:'removed',robot});

test('the record keeps the robot that drove the previous route',()=>{
  const record=before(cleaner);
  assert.deepEqual(record.robot,{width:cleaner.width,depth:cleaner.depth,speed:cleaner.speed,margin:.1});
  assert.equal(sameRobot(record,{...cleaner}),true,'the same numbers on a new object are the same robot');
  assert.equal(captureBefore({goal:null,result:route,world,robot:cleaner}),null,'no routed goal, nothing to compare');
});

test('a changed envelope, speed or margin is never compared as "same robot"',()=>{
  const record=before(cleaner);
  assert.equal(sameRobot(record,{...ROBOTS.forklift,margin:.1}),false,'another robot');
  for(const key of ['width','depth','speed','margin'])assert.equal(sameRobot(record,{...cleaner,[key]:cleaner[key]+.05}),false,key);
  assert.equal(sameRobot(record,null),false);assert.equal(sameRobot(null,cleaner),false);
  assert.equal(sameRobot(before(undefined),cleaner),false,'a record made without a robot matches nothing');
  assert.equal(sameRobot(before({...cleaner,speed:NaN}),cleaner),false,'nor does one with a missing number');
});

test('when the robot is unchanged the card says so with both distances',()=>{
  const record=before(cleaner);
  record.after=compare(record,{distance:7.6});
  assert.equal(record.after.text,'Same spot, same robot, after "removed Cart": 10.8 m → 7.6 m (−3.2 m). A simulation on the reviewed map; no robot was moved.');
  assert.match(whatIfCard(record,null),/What changed/);
});
