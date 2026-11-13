import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenSimKnees, MAX_MOT_BYTES } from '../../brainsnn-r3f-app/public/world/movement-opensim.mjs';

const mot = (units, columns, rows) => `Coordinates\nversion=1\n${units}\nendheader\n${columns}\n${rows}\n`;

test('imports signed bilateral coordinates from a mixed OpenSim IK table and preserves the time origin', () => {
  const text = mot('nRows=2\nnColumns=4\ninDegrees=yes', 'time\tknee_angle_r\tpelvis_tx\tknee_angle_l',
    '0.50 -19.854 0.45 -3.25\n0.52 -13.623 0.46 -4.5');
  const parsed = parseOpenSimKnees('\ufeff' + text.replaceAll('\n', '\r\n'));
  assert.equal(parsed.sourceUnits, 'degrees');
  assert.deepEqual(parsed.availableSides, ['left', 'right']);
  assert.deepEqual(parsed.frames, [{ time: 0.5, left: -3.25, right: -19.854 }, { time: 0.52, left: -4.5, right: -13.623 }]);
  assert.ok(Math.abs(parsed.durationSeconds - 0.02) < 1e-10);
});

test('converts model radians into degrees and distinguishes /value from /speed', () => {
  const text = mot('inDegrees=no', 'time /jointset/knee_l/knee_angle_l/speed /jointset/knee_l/knee_angle_l/value',
    `4.25 99 ${-Math.PI / 2}`);
  assert.deepEqual(parseOpenSimKnees(text), {
    sourceUnits: 'radians', availableSides: ['left'], durationSeconds: 0, frames: [{ time: 4.25, left: -90, right: null }],
  });
});

test('refuses evidence with missing or ambiguous units, times, or knee coordinates', () => {
  for (const header of ['', 'inDegrees=maybe', 'inDegrees=yes\ninDegrees=no']) {
    assert.throws(() => parseOpenSimKnees(mot(header, 'time knee_angle_r', '0 5')), /angular units/);
  }
  for (const [columns, rows, reason] of [
    ['time force_x', '0 10', /knee coordinate/], ['knee_angle_l', '8', /Expected time/],
    ['time time knee_angle_r', '0 0 7', /multiple time/],
    ['time knee_angle_r /jointset/knee_r/knee_angle_r/value', '0 6 7', /multiple knee_angle_r/],
    ['time knee_angle_r', '0 5\n0 6', /strictly increase/], ['time knee_angle_r', '0 5\n.25', /row length/],
    ['time knee_angle_r', '0 NaN', /knee angle/], ['time knee_angle_r', 'Infinity 6', /time/],
    ['time knee_angle_r', '0 0xff', /knee angle/], ['time knee_angle_r', '', /No knee motion/],
  ]) assert.throws(() => parseOpenSimKnees(mot('inDegrees=yes', columns, rows)), reason);
  assert.throws(() => parseOpenSimKnees('Coordinates\ninDegrees=yes'), /endheader/);
  assert.throws(() => parseOpenSimKnees(mot('inDegrees=yes\nnRows=3', 'time knee_angle_r', '0 5')), /table size/);
  assert.throws(() => parseOpenSimKnees(mot('inDegrees=yes\ndatacolumns 3', 'time knee_angle_r', '0 5')), /table size/);
  assert.throws(() => parseOpenSimKnees('a'.repeat(MAX_MOT_BYTES + 1)), /4 MiB/);
});
