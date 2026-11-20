import test from 'node:test';
import assert from 'node:assert/strict';
import {closestTimedFrame} from '../../brainsnn-r3f-app/public/world/showroom-page.mjs';

test('video selects the nearest source view across irregular gaps and skips untimed views', () => {
  const frames = [null, 0, 0.5, null, 2.5].map(timeSeconds => ({timeSeconds}));
  assert.equal(closestTimedFrame(frames, 0), 1);
  assert.equal(closestTimedFrame(frames, 1.5), 2);
  assert.equal(closestTimedFrame(frames, 1.51), 4);
  assert.equal(closestTimedFrame([{timeSeconds: null}], 0), -1);
  assert.equal(closestTimedFrame(frames, NaN), -1);
});
