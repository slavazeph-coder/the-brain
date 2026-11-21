export const ROBOT_TASK_LIMITS = Object.freeze({minDistance: .14, maxDistance: .72, maxSeed: 0xffffffff});
export const ROBOT_TASK_DEFAULTS = Object.freeze({task: 'reach', distance: .30, seed: 42, controller: 'standard'});

const TIMESTEP = .002;
const SAMPLE_INTERVAL = .05;
const SAMPLE_STEPS = Math.round(SAMPLE_INTERVAL / TIMESTEP);
const DURATION = 4;
const STEPS = Math.round(DURATION / TIMESTEP);
const REQUIRED_HOLD_STEPS = Math.round(.2 / TIMESTEP);
const TABLE_X = .65;
const TABLE_Y = .40;
const HOME_X = -.42;
const DRIVE_MIN_X = -.48;
const DRIVE_MAX_X = .38;
const DRIVE_MAX_Y = .25;
const PUSHER_Z = .044;
const PUSHER_RADIUS = .033;
const PUSH_BAR_HALF_LENGTH = .046;
const PUCK_RADIUS = .04;
const PUCK_HALF_HEIGHT = .025;
const TOUCH_OFFSET = PUSHER_RADIUS + PUCK_RADIUS;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeRobotTask(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !Object.hasOwn(ROBOT_TASK_DEFAULTS, key))) {
    throw Error('Choose a built-in tabletop task and its settings.');
  }
  const {task, distance, seed, controller} = {...ROBOT_TASK_DEFAULTS, ...input};
  if (!['reach', 'push'].includes(task)) throw Error('Choose Reach or Push.');
  if (!Number.isFinite(distance) || distance < ROBOT_TASK_LIMITS.minDistance || distance > ROBOT_TASK_LIMITS.maxDistance) {
    throw Error('Choose a goal distance between 0.14 and 0.72 metres.');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > ROBOT_TASK_LIMITS.maxSeed) {
    throw Error('Choose a whole-number seed from 0 to 4294967295.');
  }
  if (!['standard', 'limited'].includes(controller)) throw Error('Choose the standard or limited-travel controller.');
  return {task, distance, seed, controller};
}

function sceneFor({task, seed, distance}) {
  let state = seed;
  function random() {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }
  const puckX = -.17 + (random() - .5) * .05;
  const laneY = (random() - .5) * .26;
  const push = task === 'push';
  return {
    bounds: {x: [-TABLE_X, TABLE_X], y: [-TABLE_Y, TABLE_Y]},
    goal: [push ? puckX + distance : HOME_X + distance, laneY, push ? PUCK_HALF_HEIGHT : PUSHER_Z],
    goalRadius: push ? .045 : .038,
    pusherRadius: PUSHER_RADIUS,
    pusherHalfLength: push ? PUSH_BAR_HALF_LENGTH : 0,
    puckRadius: PUCK_RADIUS,
    puckHalfHeight: PUCK_HALF_HEIGHT,
    pusherStart: [HOME_X, 0, PUSHER_Z],
    puckStart: push ? [puckX, laneY, PUCK_HALF_HEIGHT + .001] : null,
  };
}

function xmlFor(config, scene) {
  const name = `brainsnn_tabletop_${config.task}`;
  const xRange = `${DRIVE_MIN_X - HOME_X} ${DRIVE_MAX_X - HOME_X}`;
  const yRange = `${-DRIVE_MAX_Y} ${DRIVE_MAX_Y}`;
  return `<mujoco model="${name}">
  <compiler angle="radian"/>
  <option timestep="${TIMESTEP}" gravity="0 0 -9.81" integrator="implicitfast" iterations="40" tolerance="1e-10"/>
  <size memory="4M"/>
  <default>
    <joint damping="1.8" armature=".015"/>
    <geom friction=".55 .01 .001" solref=".008 1" solimp=".93 .98 .001"/>
  </default>
  <worldbody>
    <light pos="0 -.2 2.2" dir="0 0 -1"/>
    <body name="${name}" pos="0 0 0">
      <geom name="table" type="box" pos="0 0 -.025" size="${TABLE_X} ${TABLE_Y} .025" rgba=".21 .27 .34 1"/>
      <body name="pusher" pos="${scene.pusherStart.join(' ')}">
        <joint name="slide_x" type="slide" axis="1 0 0" range="${xRange}" limited="true"/>
        <joint name="slide_y" type="slide" axis="0 1 0" range="${yRange}" limited="true"/>
        <geom name="pusher_geom" ${scene.pusherHalfLength
          ? `type="capsule" fromto="0 ${-scene.pusherHalfLength} 0 0 ${scene.pusherHalfLength} 0"`
          : 'type="sphere"'} size="${PUSHER_RADIUS}" mass=".24" rgba=".18 .78 .76 1"/>
      </body>
    </body>${scene.puckStart ? `
    <body name="puck" pos="${scene.puckStart.join(' ')}">
      <freejoint name="puck_free"/>
      <geom name="puck_geom" type="cylinder" size="${PUCK_RADIUS} ${PUCK_HALF_HEIGHT}" mass=".12" rgba=".94 .60 .24 1"/>
    </body>` : ''}
    <site name="goal" type="cylinder" pos="${scene.goal.join(' ')}" size="${scene.goalRadius} .003" rgba=".3 .9 .43 .55"/>
  </worldbody>
  <actuator>
    <position name="drive_x" joint="slide_x" kp="170" kv="9" ctrlrange="${xRange}" forcerange="-11 11"/>
    <position name="drive_y" joint="slide_y" kp="170" kv="9" ctrlrange="${yRange}" forcerange="-11 11"/>
  </actuator>
</mujoco>
`;
}

export function makeRobotTaskMJCF(input = {}) {
  const config = normalizeRobotTask(input);
  return xmlFor(config, sceneFor(config));
}

export async function loadRobotTaskPhysics(options) {
  const {loadPhysics} = await import('../arena/deformable/rope-physics.js');
  return loadPhysics(options);
}

function planCommand(scene, controller) {
  const limited = controller === 'limited';
  const [goalX, goalY] = scene.goal;
  const smooth = (from, to, fraction) => {
    const t = clamp(fraction, 0, 1);
    return from + (to - from) * t * t * (3 - 2 * t);
  };
  const behindPuck = scene.puckStart ? scene.puckStart[0] - TOUCH_OFFSET - .015 : HOME_X;
  const span = scene.puckStart ? goalX - scene.puckStart[0] : goalX - HOME_X;
  const aimX = scene.puckStart
    ? scene.puckStart[0] + span * (limited ? .43 : 1) - TOUCH_OFFSET
    : HOME_X + span * (limited ? .43 : 1);
  return time => {
    const x = scene.puckStart
      ? time < .8 ? smooth(HOME_X, behindPuck, (time - .28) / .52) : smooth(behindPuck, aimX, (time - .8) / 2.15)
      : smooth(HOME_X, aimX, time / 2.15);
    return [clamp(x, DRIVE_MIN_X, DRIVE_MAX_X), smooth(0, goalY, time / (scene.puckStart ? .5 : 2.15))];
  };
}

function modelId(model, kind, name) {
  const item = model[kind](name);
  try { return item.id; } finally { item.delete(); }
}

function hasPuckContact(data, tool, puck) {
  if (puck === null || !data.ncon) return false;
  const contacts = data.contact;
  try {
    for (let index = 0; index < data.ncon; index++) {
      const contact = contacts.get(index);
      if (!contact) continue;
      try {
        if (contact.efc_address >= 0 && (
          (contact.geom1 === tool && contact.geom2 === puck) ||
          (contact.geom2 === tool && contact.geom1 === puck)
        )) return true;
      } finally { contact.delete(); }
    }
    return false;
  } finally { contacts.delete(); }
}

function runWithModel(mujoco, model, data, config, scene, modelXML) {
  const toolBody = modelId(model, 'body', 'pusher');
  const puckBody = scene.puckStart ? modelId(model, 'body', 'puck') : null;
  const toolGeom = modelId(model, 'geom', 'pusher_geom');
  const puckGeom = puckBody === null ? null : modelId(model, 'geom', 'puck_geom');
  const frames = [], commandAt = planCommand(scene, config.controller);
  const [goalX, goalY] = scene.goal;
  let action = commandAt(0), nearestError = Infinity, finalError, puckOnTable = true;
  let contactSteps = 0, holdSteps = 0, contactSinceFrame = false;
  mujoco.mj_forward(model, data);

  function observe(step, contact, record) {
    const positions = data.xpos;
    const subject = (puckBody ?? toolBody) * 3;
    const x = positions[subject], y = positions[subject + 1], z = positions[subject + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(data.time)) {
      throw Error('The physics engine did not produce a valid tabletop state.');
    }
    finalError = Math.hypot(x - goalX, y - goalY);
    nearestError = Math.min(nearestError, finalError);
    puckOnTable = puckBody === null || (Math.abs(x) <= TABLE_X && Math.abs(y) <= TABLE_Y && z >= .005);
    if (step > 0) holdSteps = puckOnTable && finalError <= scene.goalRadius ? holdSteps + 1 : 0;
    if (contact) { contactSteps++; contactSinceFrame = true; }
    if (!record) return;

    const pusher = Array.from(positions.subarray(toolBody * 3, toolBody * 3 + 3));
    const puck = puckBody === null ? null : [x, y, z];
    const puckQuaternion = puckBody === null ? null : Array.from(data.xquat.subarray(puckBody * 4, puckBody * 4 + 4));
    if (![...pusher, ...(puckQuaternion || [])].every(Number.isFinite) ||
        Math.abs(data.time - step * TIMESTEP) > 1e-7) throw Error('The physics engine interrupted this run.');
    frames.push({time: step * TIMESTEP, pusher, puck, puckQuaternion, action, contact: contactSinceFrame, errorMeters: finalError});
    contactSinceFrame = false;
  }

  observe(0, false, true);
  for (let step = 0; step < STEPS; step++) {
    if (step % SAMPLE_STEPS === 0) {
      action = commandAt(step * TIMESTEP);
      data.ctrl[0] = action[0] - HOME_X;
      data.ctrl[1] = action[1];
    }
    mujoco.mj_step(model, data);
    const contact = hasPuckContact(data, toolGeom, puckGeom);
    mujoco.mj_kinematics(model, data);
    observe(step + 1, contact, (step + 1) % SAMPLE_STEPS === 0);
  }

  let reason = 'goal-reached';
  if (!puckOnTable) reason = 'puck-off-table';
  else if (puckBody !== null && !contactSteps) reason = 'no-puck-contact';
  else if (finalError > scene.goalRadius) reason = 'outside-goal';
  else if (holdSteps < REQUIRED_HOLD_STEPS) reason = 'insufficient-hold';
  const lastPuck = frames.at(-1).puck;
  return {
    schema: 'brainsnn.robot-task.episode.v1',
    engine: {name: 'MuJoCo', version: mujoco.mj_versionString()},
    config, scene, frames, modelXML,
    steps: STEPS, durationSeconds: DURATION, timestepSeconds: TIMESTEP, sampleIntervalSeconds: SAMPLE_INTERVAL,
    score: {
      success: reason === 'goal-reached',
      reason,
      finalErrorMeters: finalError,
      nearestErrorMeters: nearestError,
      contactSeconds: contactSteps * TIMESTEP,
      goalHoldSeconds: holdSteps * TIMESTEP,
      puckDisplacementMeters: lastPuck === null ? null : Math.hypot(lastPuck[0] - scene.puckStart[0], lastPuck[1] - scene.puckStart[1]),
    },
    provenance: {
      physicsExecuted: true,
      learnedPolicyExecuted: false,
      backend: 'Official single-thread WebAssembly',
      scene: 'Authored tabletop and two-axis position-actuated pusher',
      units: 'Metres, seconds, right-handed Z-up. Quaternion order WXYZ.',
      actions: 'Each frame after the first records the world X/Y setpoint held over the preceding sample interval.',
      contacts: 'Active MuJoCo pusher-to-puck contacts. A replay frame flags any contact during its preceding interval.',
      success: 'Final subject centre held in the horizontal goal circle for at least 0.2 seconds. Push also requires pusher contact and a puck still on the table.',
    },
  };
}

export function runRobotTask(mujoco, input = {}) {
  const config = normalizeRobotTask(input), scene = sceneFor(config);
  const modelXML = xmlFor(config, scene);
  const model = mujoco.MjModel.from_xml_string(modelXML);
  let data;
  try {
    data = new mujoco.MjData(model);
    return runWithModel(mujoco, model, data, config, scene, modelXML);
  } finally {
    data?.delete();
    model.delete();
  }
}
