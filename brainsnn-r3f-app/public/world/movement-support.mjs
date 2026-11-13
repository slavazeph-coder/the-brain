import { readSignalCsv } from './movement-analysis.mjs';

// Vertical force balance on the whole body, with upward positive. The input
// must be acceleration of the whole-body centre of mass in world coordinates.
export function estimateSupport(csv, {massKg, sourceLabel, offsetSeconds = 0}) {
  if (!Number.isFinite(massKg) || massKg <= 0 || massKg > 1000) throw new Error('Enter mass in kilograms (above 0 and at most 1,000).');
  if (typeof sourceLabel !== 'string' || !sourceLabel.trim() || sourceLabel.length > 160) throw new Error('Name the source of the centre-of-mass acceleration.');
  if (!Number.isFinite(offsetSeconds)) throw new Error('Enter a finite video time offset.');
  const g = 9.80665;
  const acceleration = readSignalCsv(csv, 'com_az_m_s2').map(({timeSeconds, value}) => ({timeSeconds, accelerationMps2:value}));
  const samples = acceleration.map(({timeSeconds, accelerationMps2}) => {
    const verticalForceN = massKg * (g + accelerationMps2);
    if (!Number.isFinite(verticalForceN)) throw new Error('Acceleration exceeds the supported range.');
    return {timeSeconds, verticalForceN};
  });
  return {kind:'modelled',label:'Whole-body vertical support estimate',offsetSeconds,samples,
    model:{method:'F_vertical = m × (a_COM,vertical + g)',massKg,gravityMps2:g,sourceLabel:sourceLabel.trim(),
      inputCoordinates:'Upward world axis. Linear acceleration of whole-body centre of mass; gravity excluded.',acceleration,
      interpretation:'Net vertical non-gravitational external force. Ground support only when the ground is the sole external contact. External loads, device acceleration and per-limb forces need separate modelling.'}};
}
