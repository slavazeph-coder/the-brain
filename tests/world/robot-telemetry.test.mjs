import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRobotTelemetry, compareRobotTelemetry, calibrateWheelScale} from '../../brainsnn-r3f-app/public/world/robot-telemetry.mjs';
import {quaternionAngle, quaternionFromEuler} from '../../brainsnn-r3f-app/public/world/robot-frames.mjs';
const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const opts = {sourceId: 'physical-log-A', frameId: 'map'};
const comparison = {registration: {confirmed: true, sourceId: opts.sourceId, frameId: 'map'}, timeAlignmentConfirmed: true, maxGapSeconds: 1.1, heldOut: true};
const reference = () => ({id: 'sim-A', frames: [{time: 0, positionXYZ: [0, 0, .2], quaternionWxyz: [1, 0, 0, 0]}, {time: 1, positionXYZ: [1, 0, .2], quaternionWxyz: [1, 0, 0, 0]}]});

test('CSV preserves SI units, commands and encoder measurements with explicit conversion', () => {
  const data = parseRobotTelemetry('t,x,y,z,qx,qy,qz,qw,leftEncoderRad,rightEncoderRad,commandSpeedMps\n0,0,0,200,0,0,0,1,0,0,.5\n500,600,0,200,0,0,0,1,5,5,.5\n', {...opts, timeUnit: 'ms', lengthUnit: 'mm'});
  assert.equal(data.valid, true); close(data.samples[1].t, .5); close(data.samples[1].pose.position.x, .6); close(data.samples[1].pose.position.z, .2);
  assert.deepEqual(data.samples[1].encoder.wheelPositionRad, [5, 5]); assert.match(data.samples[1].command.origin, /not measured/);
  assert.equal(data.provenance.physicalValidated, false);
  assert.throws(() => parseRobotTelemetry('t,x,y,z\n0,0,0,0', {...opts, lengthUnit: 'feet'}), /units/);
});

test('named quaternion columns retain XYZW even for MuJoCo input and Y-up yaw uses Y', () => {
  const q = parseRobotTelemetry('t,x,y,z,qx,qy,qz,qw\n0,0,0,0,0,0,0,1', {...opts, convention: 'mujoco'});
  close(q.samples[0].pose.orientation.w, 1);
  const anonymous = parseRobotTelemetry(JSON.stringify({samples: [{t: 0, position: [0, 0, 0], quaternion: [1, 0, 0, 0]}]}), {...opts, convention: 'mujoco'});
  close(anonymous.samples[0].pose.orientation.w, 1);
  const yUp = parseRobotTelemetry('t,x,y,z,yaw,commandYawRateRps\n0,1,2,3,90,.4', {...opts, convention: 'world-y-up', angleUnit: 'deg'});
  assert.deepEqual(Object.fromEntries(Object.entries(yUp.samples[0].pose.position).map(([k, v]) => [k, Math.round(v)])), {x: 1, y: -3, z: 2});
  close(quaternionAngle(yUp.samples[0].pose.orientation, quaternionFromEuler(0, 0, Math.PI / 2)), 0);
  close(yUp.samples[0].command.yawRateRps, .4);
});

test('out-of-order, missing wheel pairs and stale health are detected instead of silently repaired', () => {
  const data = parseRobotTelemetry('t,x,y,z\n0,0,0,0\n2,1,0,0\n1,2,0,0', opts);
  assert.equal(data.valid, false); assert.ok(data.issues.some(i => i.code === 'out-of-order'));
  assert.equal(compareRobotTelemetry(reference(), data, comparison).status, 'invalid-telemetry');
  const pair = parseRobotTelemetry('t,x,y,z,leftEncoderRad\n0,0,0,0,2', opts); assert.equal(pair.valid, false);
  const stale = parseRobotTelemetry('t,x,y,z,state\n0,0,0,0,lost', {...opts, nowSeconds: 5});
  assert.ok(stale.issues.some(i => i.code === 'stale-stream')); assert.ok(stale.issues.some(i => i.code === 'unusable-pose'));
});

test('native localization nanosecond timestamps retain precision and source binding', () => {
  const first = 1795387498123456789n;
  const doc = {schema: 'brainsnn.localization-recording.v1', binding: {bundleSha256: 'a'.repeat(64), mapFrame: 'map', baseFrame: 'base_link'}, runtime: {origin: 'recorded-ros2'},
    samples: [0, .05].map(t => ({t, timestampNs: (first + BigInt(Math.round(t * 1e9))).toString(), position: [t, 0, .2], quaternion: [0, 0, 0, 1], state: 'tracking', covariance: Array(36).fill(0),
      diagnostics: {level: 0, reinitializationRequested: false, poseSource: 'pcl_pose', statusTimestampNs: (first + BigInt(Math.round(t * 1e9))).toString()}}))};
  const log = parseRobotTelemetry(JSON.stringify(doc)); assert.equal(log.valid, true); close(log.samples[1].t, .05); assert.equal(log.timestampOriginNs, first.toString());
  assert.equal(log.binding.bundleSha256, doc.binding.bundleSha256); assert.equal(log.provenance.producerAttested, false);
  doc.samples[1].t = .1; assert.equal(parseRobotTelemetry(JSON.stringify(doc)).valid, false);
  doc.samples[1].t = .05; doc.samples[0].covariance[0] = -1;
  assert.equal(parseRobotTelemetry(JSON.stringify(doc)).valid, false);
});

test('comparison uses interpolation, body height, reviewed registration and time alignment', () => {
  const log = parseRobotTelemetry('t,x,y,z,qx,qy,qz,qw\n.5,.6,0,.2,0,0,0,1', opts);
  assert.equal(compareRobotTelemetry(reference(), log).status, 'needs-registration');
  assert.equal(compareRobotTelemetry(reference(), log, {...comparison, timeAlignmentConfirmed: false}).status, 'needs-time-alignment');
  assert.equal(compareRobotTelemetry(reference(), log, {...comparison, registration: {...comparison.registration, sourceId: 'another'}}).status, 'registration-source-mismatch');
  const r = compareRobotTelemetry(reference(), log, comparison); assert.equal(r.status, 'compared'); assert.equal(r.coverage, 1); close(r.metrics.positionErrorM.rms, .1); close(r.metrics.orientationErrorRad.rms, 0);
  assert.equal(r.pairs[0].dimensions, 'xyz'); assert.equal(r.provenance.physicalAccuracyVerified, false);
  const old = reference(); old.frames = old.frames.map(f => ({time: f.time, position: [f.positionXYZ[0], 0], headingRad: 0}));
  const planar = compareRobotTelemetry(old, log, comparison); close(planar.metrics.positionErrorM.rms, .1); assert.equal(planar.pairs[0].dimensions, 'planar-xy');
});

test('long gaps, unhealthy poses and calibration reuse cannot masquerade as held-out accuracy', () => {
  const log = parseRobotTelemetry(JSON.stringify({samples: [{t: .5, position: [.6, 0, .2], state: 'tracking'}, {t: .7, position: [.7, 0, .2], state: 'lost'}]}), opts);
  const r = compareRobotTelemetry(reference(), log, comparison); assert.equal(r.matchedSamples, 1); close(r.coverage, .5); assert.equal(r.excluded.unhealthy, 1);
  const gap = compareRobotTelemetry(reference(), log, {...comparison, maxGapSeconds: .2}); assert.equal(gap.status, 'no-comparable-samples');
  const reuse = compareRobotTelemetry(reference(), log, {...comparison, calibrationSourceIds: [opts.sourceId]}); assert.equal(reuse.status, 'calibration-reuse'); assert.equal(reuse.provenance.evaluationRole, 'calibration-data-reused');
  const changedFrame = parseRobotTelemetry(JSON.stringify({samples: [{t: 0, frameId: 'different-map', position: [0, 0, 0]}]}), opts);
  assert.equal(changedFrame.valid, false);
});

test('wheel scale fitting requires independent straight travel and returns a proposal only', () => {
  const doc = {datasetRole: 'calibration', referenceIndependent: true, poseSource: 'independent-reference', samples: Array.from({length: 11}, (_, i) => ({t: i * .1, position: [i * .12, 0, 0], quaternion: [0, 0, 0, 1], wheelPositionRad: [i, i]}))};
  const log = parseRobotTelemetry(JSON.stringify(doc), {...opts, referenceIndependent: true});
  assert.equal(calibrateWheelScale(log, {wheelRadiusM: .1}).status, 'independent-reference-required');
  const proposal = calibrateWheelScale(log, {wheelRadiusM: .1, referenceIndependent: true});
  assert.equal(proposal.status, 'calibration-proposal'); close(proposal.wheelRadiusScale, 1.2); assert.equal(proposal.applied, false);
  doc.poseSource = 'wheel-odometry'; const correlated = parseRobotTelemetry(JSON.stringify(doc), {...opts, referenceIndependent: true});
  assert.equal(calibrateWheelScale(correlated, {wheelRadiusM: .1, referenceIndependent: true}).status, 'insufficient-independent-straight-travel');
});

test('sparse reference frames never extrapolate or bridge a gap, including after a clock offset', () => {
  const ref = {frameId: 'map', childFrameId: 'base_link', frames: [1, 1.1, 3, 3.1].map(time => ({time, positionXYZ: [time, 0, .2]}))};
  const log = parseRobotTelemetry(JSON.stringify({samples: [.1, .25, 1, 2.25, 2.4].map(t => ({t, position: [t + .8, 0, .2]}))}), opts);
  const r = compareRobotTelemetry(ref, log, {...comparison, timeOffsetSeconds: .8, maxGapSeconds: .2});
  assert.equal(r.matchedSamples, 2); assert.equal(r.excluded.outsideCoverage, 3); close(r.coverage, .4);
  close(r.metrics.positionErrorM.rms, 0); assert.equal(r.metrics.orientationErrorRad, null);
  assert.deepEqual(r.pairs.map(p => p.referenceTime), [1.05, 3.05]);
});

test('reference pose frames, dimensions and clocks cannot silently change during comparison', () => {
  const log = parseRobotTelemetry('t,x,y,z\n.5,.5,0,.2', opts);
  const changedFrame = reference(); changedFrame.frames[1].frameId = 'different-map';
  assert.throws(() => compareRobotTelemetry(changedFrame, log, comparison), /change the declared pose frame/);
  const changedBody = reference(); changedBody.frames[1] = {time: 1, pose: {frameId: 'map', childFrameId: 'sensor', position: [1, 0, .2]}};
  assert.throws(() => compareRobotTelemetry(changedBody, log, comparison), /change the declared pose frame/);
  const mixed = reference(); mixed.frames[1] = {time: 1, position: [1, 0]};
  assert.throws(() => compareRobotTelemetry(mixed, log, comparison), /dimensions cannot change/);
  const duplicate = reference(); duplicate.frames[1].time = 0;
  assert.throws(() => compareRobotTelemetry(duplicate, log, comparison), /strictly ordered/);
  const long = reference(); long.frames[1].time = 86401;
  assert.throws(() => compareRobotTelemetry(long, log, comparison), /duration exceeds/);
  const invalidOffset = {...comparison, timeOffsetSeconds: NaN};
  assert.throws(() => compareRobotTelemetry(reference(), log, invalidOffset), /Time offset must be finite/);
});
