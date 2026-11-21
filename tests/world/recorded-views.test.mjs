import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestRecordedView, anotherObjectView} from '../../brainsnn-r3f-app/public/world/recorded-views.mjs';
import {createShowroomExample, parseShowroomBundle} from '../../brainsnn-r3f-app/public/world/showroom-model.mjs';

const seen = [{objectId:'cart'}];
const frames = [
  {camera:[0,0],heading:179,observations:seen},
  {camera:[0,0],heading:-20,observations:[]},
  {camera:[1,0],observations:seen},
  {camera:[3,0],heading:0,observations:seen},
  {observations:seen},
];
test('position and wrapped heading recall recorded evidence in the same room', () => {
  assert.equal(nearestRecordedView(frames,{camera:[0,0],heading:-179}).index,0);
  assert.equal(nearestRecordedView(frames,{camera:[0,0],heading:-20}).index,1);
  assert.equal(nearestRecordedView(frames,{camera:[0,0],heading:-20,objectId:'cart'}),null);
  assert.equal(nearestRecordedView(frames,{camera:[20,0]}),null);
  assert.equal(nearestRecordedView(frames,{camera:[NaN,0]}),null);
});
test('another view requires a different observed position and matching object', () => {
  const cart = {id:'cart',polygon:[[1,1],[2,1],[2,2],[1,2]]};
  assert.equal(anotherObjectView(frames,0,cart).index,3);
  assert.equal(anotherObjectView(frames,4,cart),null);
  assert.equal(anotherObjectView(frames,0,{...cart,id:'other'}),null);
});
test('older rooms retain position-only search; headings must be grounded', () => {
  const room = createShowroomExample();
  assert.ok(room.frames.every(f=>Number.isFinite(f.heading)));
  delete room.frames[0].heading;
  assert.equal(parseShowroomBundle(room).frames[0].heading,undefined);
  delete room.frames[1].camera;
  assert.throws(()=>parseShowroomBundle(room),/position/);
});
