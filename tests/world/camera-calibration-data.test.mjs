import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CALIBRATION_BYTES,
  MAX_CALIBRATION_WALK_BYTES,
  parseCalibrationWalk,
  parseCameraCalibration,
} from '../../brainsnn-r3f-app/public/world/camera-calibration-data.mjs';

function camera(section, translation, rotation = '0.0, 0.0, 0.0') {
  return `[${section}]
name = "${section}"
size = [1088.0, 1920.0]
matrix = [ [1600.0, 0.0, 540.0], [0.0, 1602.0, 955.0], [0.0, 0.0, 1.0]]
distortions = [-0.053, 0.151, -1.2e-4, 6.6e-4]
rotation = [${rotation}]
translation = [${translation}]
fisheye = false
`;
}

const calibratedRig = camera('cam01', '0.0, 0.0, 0.0') + '\n' +
  camera('cam02', '2.0, -3.0, 4.0', '0.0, 1.5707963267948966, 0.0') +
  '\n[metadata]\nadjusted = false\nerror = 0.0\n';

const makeWalk = (units = 'm', frames = [
  ['1', '0.00000', '1.0', '2.0', '3.0', '', '', ''],
  ['2', '0.03333', '-1.0', '0.0', '4.0', '0.5', '1.5', '2.5'],
]) => [
  'PathFileType\t4\t(X/Y/Z)\t3d_skeleton_FINAL.trc',
  'DataRate\tCameraRate\tNumFrames\tNumMarkers\tUnits\tOrigDataRate\tOrigDataStartFrame\tOrigNumFrames',
  `30.00\t30.00\t${frames.length}\t2\t${units}\t30.00\t1\t${frames.length}`,
  'Frame#\tTime\tR.ASIS\t\t\tL.ASIS\t\t\t',
  '\t\tX1\tY1\tZ1\tX2\tY2\tZ2\t',
  '',
  ...frames.map(fields => fields.join('\t') + '\t'),
  '',
].join('\r\n');

test('reads the HumanCalib/Pose2Sim shape and inverts world-to-camera Rodrigues transforms without remapping axes', () => {
  const {cameras} = parseCameraCalibration('\uFEFF' + calibratedRig.replaceAll('\n', '\r\n'));
  assert.equal(cameras.length, 2);
  assert.deepEqual(cameras[0].center, [0, 0, 0]);
  assert.deepEqual(cameras[0].forward, [0, 0, 1]);
  assert.equal(cameras[1].name, 'cam02');
  assert.equal(cameras[1].width, 1088);
  assert.equal(cameras[1].height, 1920);
  assert.equal(cameras[1].matrix[1][1], 1602);
  for (const [actual, expected] of [[cameras[1].center, [4, 3, -2]], [cameras[1].forward, [-1, 0, 0]]]) {
    actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));
  }
});

test('allows numeric multiline TOML, comments, and explicit quoted camera names', () => {
  const multiline = calibratedRig.replace('[cam02]', '["left camera"] # export table')
    .replace('name = "cam02"', 'name = "Left #2" # selected camera')
    .replace('translation = [2.0, -3.0, 4.0]', 'translation = [\n +2.0, # x\n -3.0,\n 4.0,\n]');
  assert.equal(parseCameraCalibration(multiline).cameras[1].name, 'Left #2');
});

test('rejects coincident intrinsics-only rigs, ambiguous fields, and unsupported camera models', () => {
  assert.throws(() => parseCameraCalibration(camera('cam01', '0, 0, 0') + camera('cam02', '0, 0, 0')), /positions coincide/);
  assert.throws(() => parseCameraCalibration(calibratedRig.replace('translation = [2.0, -3.0, 4.0]', '')), /translation/);
  assert.throws(() => parseCameraCalibration(calibratedRig + '\n[cam01]'), /duplicate/);
  assert.throws(() => parseCameraCalibration(calibratedRig.replace('fisheye = false', 'fisheye = false\nfisheye = true')), /duplicate/);
  assert.throws(() => parseCameraCalibration(calibratedRig.replace('fisheye = false', 'fisheye = true')), /fisheye/);
  assert.throws(() => parseCameraCalibration(calibratedRig.replace('1600.0', '-1600.0')), /camera matrix/);
  assert.throws(() => parseCameraCalibration(calibratedRig.replace('1.5707963267948966', '90')), /rotation/);
  assert.throws(() => parseCameraCalibration(calibratedRig.replace('1600.0', '0x1f')), /unsupported/);
  assert.throws(() => parseCameraCalibration(calibratedRig.replace('name = "cam02"', 'name = "cam01"')), /unique/);
  assert.throws(() => parseCameraCalibration('#' + 'é'.repeat(MAX_CALIBRATION_BYTES / 2)), /large/);
});

test('reads authentic tab-delimited walk rows, keeping input axes, time and missing triplets', () => {
  const walk = parseCalibrationWalk(makeWalk());
  assert.deepEqual(walk.markers, ['R.ASIS', 'L.ASIS']);
  assert.deepEqual(walk.times, [0, 0.03333]);
  assert.deepEqual(walk.frames, [[[1, 2, 3], null], [[-1, 0, 4], [0.5, 1.5, 2.5]]]);
  assert.equal(walk.units, 'm');
});

test('converts explicit TRC length units, reads missing NaN triplets and accepts an omitted spacer', () => {
  const file = makeWalk('mm', [
    ['1', '.25000', '1e3', '-2000', '500.0', 'NaN', 'NaN', 'NaN'],
    ['2', '.29126', '+1000', '0.0', '1500', '250', '-500', '750'],
  ]).replace('\r\n\r\n', '\r\n');
  const walk = parseCalibrationWalk(file);
  assert.equal(walk.units, 'mm');
  assert.deepEqual(walk.times, [0.25, 0.29126]);
  assert.deepEqual(walk.frames, [[[1, -2, 0.5], null], [[1, 0, 1.5], [0.25, -0.5, 0.75]]]);
});

test('rejects uncertain TRC columns, non-monotonic times, incomplete rows and excess data', () => {
  const walk = makeWalk();
  assert.throws(() => parseCalibrationWalk(walk.replace('Y2', 'X2')), /ordered/);
  assert.throws(() => parseCalibrationWalk(walk.replace('L.ASIS', 'R.ASIS')), /unique/);
  assert.throws(() => parseCalibrationWalk(walk.replace('0.03333', '0.0')), /must increase/);
  assert.throws(() => parseCalibrationWalk(walk.replace('2.0\t3.0', '\t3.0')), /missing marker/);
  assert.throws(() => parseCalibrationWalk(walk.replace('0.5\t1.5\t2.5\t', '0.5')), /columns/);
  assert.throws(() => parseCalibrationWalk(walk.replace('2\t2\tm', '3\t2\tm')), /frame count/);
  assert.throws(() => parseCalibrationWalk(makeWalk('in')), /units/);
  assert.throws(() => parseCalibrationWalk(' '.repeat(MAX_CALIBRATION_WALK_BYTES + 1)), /large/);
});
