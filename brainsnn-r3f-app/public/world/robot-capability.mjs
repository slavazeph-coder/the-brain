/** A bounded, source-carrying robot model. Catalogue dimensions do not qualify hardware. */
export const ROBOT_CAPABILITY_SCHEMA = 'brainsnn.robot-capability.v1';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function number(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number from ${min} to ${max}.`);
  }
  return value;
}
function text(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008]/u.test(value)) {
    throw new Error(`${name} needs nonempty text up to ${max} characters.`);
  }
  return value;
}
function keys(value, allowed, name) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Unsupported ${name} fields.`);
}
function metadata(value, name) {
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 2048 || depth > 8) throw new Error(`${name} is too complex.`);
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') return number(item, -1e12, 1e12, name);
    if (typeof item === 'string') {
      if (item.length > 4000) throw new Error(`${name} text is too long.`);
      return item;
    }
    if (Array.isArray(item)) return item.map(entry => visit(entry, depth + 1));
    if (!object(item)) throw new Error(`${name} must be plain JSON data.`);
    const out = {};
    for (const [key, entry] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 120) throw new Error(`Unsafe ${name} key.`);
      out[key] = visit(entry, depth + 1);
    }
    return out;
  }
  return visit(value, 0);
}

export function normalizeRobotCapability(input) {
  keys(input, ['schema','id','name','body','limits','drive','motor','marginM','evidence','unknowns','source','basis'], 'robot capability');
  if (input.schema !== ROBOT_CAPABILITY_SCHEMA) throw new Error('Unsupported robot capability schema.');
  const id = text(input.id, 96, 'Robot ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) throw new Error('Robot ID must use letters, numbers, dots, dashes or colons.');
  const name = text(input.name, 160, 'Robot name');
  keys(input.body, ['width','depth','height','massKg','payloadKg'], 'robot body');
  const body = {
    width: number(input.body.width, .1, 5, 'Body width'),
    depth: number(input.body.depth, .1, 5, 'Body depth'),
    height: number(input.body.height, .08, 4, 'Body height'),
    massKg: number(input.body.massKg, .1, 3000, 'Body mass'),
    payloadKg: number(input.body.payloadKg, 0, 2000, 'Payload mass'),
  };
  keys(input.limits, ['speedMps','yawRateRps','accelerationMps2','brakingMps2','latencySeconds'], 'motion limits');
  const limits = {
    speedMps: number(input.limits.speedMps, .01, 3, 'Speed'),
    yawRateRps: number(input.limits.yawRateRps, .05, 6, 'Yaw rate'),
    accelerationMps2: number(input.limits.accelerationMps2, .02, 10, 'Acceleration'),
    brakingMps2: number(input.limits.brakingMps2, .02, 15, 'Braking'),
    latencySeconds: number(input.limits.latencySeconds, 0, 2, 'Control latency'),
  };
  keys(input.drive, ['kind','wheelRadiusM','wheelSeparationM','drivenWheels'], 'drivetrain');
  if (!['differential','holonomic'].includes(input.drive.kind)) throw new Error('Choose a differential or holonomic drivetrain. Legged and Ackermann models are not supplied.');
  const drive = {
    kind: input.drive.kind,
    wheelRadiusM: number(input.drive.wheelRadiusM, .015, .5, 'Wheel radius'),
    wheelSeparationM: number(input.drive.wheelSeparationM, .06, 4.9, 'Wheel separation'),
    drivenWheels: input.drive.drivenWheels ?? 2,
  };
  if (drive.drivenWheels !== 2) throw new Error('The current drivetrain model has two driven wheels.');
  if (drive.wheelSeparationM > body.width - .008) throw new Error('Wheel separation must fit inside the robot width.');
  if (2 * drive.wheelRadiusM > body.height) throw new Error('Wheel diameter must not exceed the declared body height.');
  if (2 * drive.wheelRadiusM > body.depth) throw new Error('Wheel diameter must fit inside the declared footprint depth.');
  let motor = null;
  if (input.motor != null) {
    keys(input.motor, ['voltageV','currentLimitA','torqueConstantNmPerA','resistanceOhm','gearRatio','efficiency',
      'backEmfVPerRadPerSecond','noLoadCurrentA','thermalResistanceKPerW','thermalCapacityJPerK','ambientC','temperatureLimitC','driverResistanceOhm','auxiliaryPowerW'], 'motor');
    motor = {};
    for (const [key, lo, hi] of [['voltageV',1,200],['currentLimitA',.01,500],['torqueConstantNmPerA',.0001,10],
      ['resistanceOhm',.001,1000],['gearRatio',.1,500],['efficiency',.01,1]]) motor[key] = number(input.motor[key], lo, hi, key);
    for (const [key, lo, hi] of [['backEmfVPerRadPerSecond',.0001,10],['noLoadCurrentA',0,50],
      ['thermalResistanceKPerW',.001,1000],['thermalCapacityJPerK',.01,1e7],['ambientC',-60,100],['temperatureLimitC',0,300],['driverResistanceOhm',0,1000],['auxiliaryPowerW',0,10000]]) {
      if (input.motor[key] != null) motor[key] = number(input.motor[key], lo, hi, key);
    }
    const thermal = ['thermalResistanceKPerW','thermalCapacityJPerK','ambientC','temperatureLimitC'];
    if (thermal.some(key => key in motor) && !thermal.every(key => key in motor)) throw new Error('Thermal simulation requires resistance, capacity, ambient and limit together.');
    if ('temperatureLimitC' in motor && motor.temperatureLimitC <= motor.ambientC) throw new Error('Thermal limit must exceed ambient temperature.');
  }
  const evidence = input.evidence ?? [];
  if (!Array.isArray(evidence) || evidence.length > 64 || evidence.some(item => !object(item))) throw new Error('Keep up to 64 source evidence records.');
  const unknowns = input.unknowns ?? [];
  if (!Array.isArray(unknowns) || unknowns.length > 64) throw new Error('Keep up to 64 unknown parameters.');
  const basis = input.basis ?? 'assumed';
  if (!['assumed','user-entered','manufacturer','measured','calibrated'].includes(basis)) throw new Error('Unknown parameter basis.');
  const out = {schema:ROBOT_CAPABILITY_SCHEMA,id,name,body,limits,drive,motor,
    marginM:number(input.marginM ?? .1,0,2,'Clearance margin'),basis,
    evidence:metadata(evidence,'Evidence'),unknowns:unknowns.map(value => text(value,1000,'Unknown parameter'))};
  if (input.source != null) out.source = metadata(input.source,'Source metadata');
  if (JSON.stringify(out).length > 65536) throw new Error('Robot profile exceeds 64 KiB.');
  return out;
}

/** Start from an envelope; added dynamics are explicit authored assumptions, never OEM specifications. */
export function createRobotCapability({id='generic-mobile',name='Generic mobile robot',width=.58,depth=.68,speed=.3,margin=.1,driveKind='differential'}={}) {
  const height = Math.max(.16, Math.min(.7, width));
  return normalizeRobotCapability({schema:ROBOT_CAPABILITY_SCHEMA,id,name,
    body:{width,depth,height,massKg:20,payloadKg:0},
    limits:{speedMps:speed,yawRateRps:1.2,accelerationMps2:.6,brakingMps2:.8,latencySeconds:0},
    drive:{kind:driveKind,wheelRadiusM:Math.min(.075,height/2,depth/2,width*.2),wheelSeparationM:width*.72,drivenWheels:2},
    motor:null,marginM:margin,basis:'assumed',
    source:{kind:'planning-envelope',catalogueId:id,physicalModelMatched:false},
    evidence:[{field:'body.width/body.depth/limits.speedMps',kind:'user-entered',note:'Copied from the selected planning envelope; verify against the actual robot.'},
      {field:'drive/body.massKg/body.height/limits',kind:'assumed',note:'Authored wheeled simulation parameters, not manufacturer data.'}],
    unknowns:['Actual drivetrain and wheel calibration','Motor electrical and thermal parameters','Floor traction and braking performance','Independent robot and site measurements'],
  });
}

export function profileEnvelope(input) {
  const profile = normalizeRobotCapability(input);
  return {name:profile.name,width:profile.body.width,depth:profile.body.depth,speed:profile.limits.speedMps,margin:profile.marginM};
}

export function canonicalCapabilityJSON(input) {
  const sorted = value => Array.isArray(value) ? value.map(sorted) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])) : value;
  return JSON.stringify(sorted(normalizeRobotCapability(input)));
}

export async function robotCapabilityHash(input) {
  const bytes = new TextEncoder().encode(canonicalCapabilityJSON(input));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
