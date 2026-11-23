/** Bounded DC motor/driver accounting over explicitly recorded wheel torque.
 * Mechanical simulation is not an electrical measurement. Missing motor constants
 * stay unavailable; commanded vectors are never silently re-labelled as torque. */
export const DRIVE_ANALYSIS_SCHEMA = 'brainsnn.robot-drive-analysis.v1';
const MAX = 100000;
const finite = (x, label) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw Error(`${label} must be finite.`); return x; };
function parameter(obj, key, {zero = false, max = 1e9} = {}) {
  const x = obj?.[key]; if (x === undefined || x === null || x === '') return null;
  finite(x, key); if ((zero ? x < 0 : x < 1e-12) || x > max) throw Error(`${key} is outside its supported physical range.`); return x;
}
function pair(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e8)) throw Error(`${label} must contain two finite wheel values.`);
  return value;
}
export function analyzeDrive(profile, recording, options = {}) {
  if (!profile || typeof profile !== 'object') throw Error('Supply the robot capability profile.');
  const motor = profile.motor || {}, frames = recording?.frames ?? recording?.samples;
  if (!Array.isArray(frames) || frames.length < 2 || frames.length > MAX) throw Error('Use a recording with 2–100000 samples.');
  const maxGap = options.maxGapSeconds ?? 1;
  finite(maxGap, 'Maximum integrated gap'); if (maxGap <= 0 || maxGap > 3600) throw Error('Maximum integrated gap is out of bounds.');
  const voltage = parameter(motor, 'voltageV'), currentLimit = parameter(motor, 'currentLimitA');
  const kt = parameter(motor, 'torqueConstantNmPerA'), resistance = parameter(motor, 'resistanceOhm', {zero: true});
  const ratio = parameter(motor, 'gearRatio'), efficiency = parameter(motor, 'efficiency', {max: 1});
  const ke = parameter(motor, 'backEmfVPerRadPerSecond', {zero: true}), idleCurrent = parameter(motor, 'noLoadCurrentA', {zero: true});
  const driverResistance = parameter(motor, 'driverResistanceOhm', {zero: true});
  const rThermal = parameter(motor, 'thermalResistanceKPerW'), cThermal = parameter(motor, 'thermalCapacityJPerK');
  const ambient = motor.ambientC == null ? null : finite(motor.ambientC, 'Ambient temperature');
  const tempLimit = motor.temperatureLimitC == null ? null : finite(motor.temperatureLimitC, 'Temperature limit');
  if (ambient !== null && (ambient < -80 || ambient > 200) || tempLimit !== null && (tempLimit < -80 || tempLimit > 400)) throw Error('Temperature is outside the supported model range.');
  const auxiliaryPower = parameter(motor, 'auxiliaryPowerW', {zero: true});
  const canCurrent = kt !== null && ratio !== null && efficiency !== null;
  const canElectrical = canCurrent && resistance !== null && ke !== null;
  const canThermal = canCurrent && resistance !== null && rThermal !== null && cThermal !== null && ambient !== null;
  const unavailable = [], assumptions = [
    'Wheel torque and wheel speed retain their recording origin; inferred motor values are modelled, not measured.',
    'motor.efficiency is mechanical transmission efficiency. The DC motor approximation does not reproduce PWM switching, MOSFET transients or a brushless commutation waveform.',
    'Braking energy recovery is not credited. Current during braking uses the conservative motoring torque conversion.',
  ];
  if (!canCurrent) unavailable.push('Motor current needs torqueConstantNmPerA, gearRatio and transmission efficiency.');
  if (!canElectrical) unavailable.push('Motor terminal power/voltage needs current conversion, resistanceOhm and backEmfVPerRadPerSecond.');
  if (!canThermal) unavailable.push('Motor temperature needs resistance, thermal resistance/capacity, ambient temperature and the current conversion.');
  if (voltage === null) unavailable.push('Supply-voltage limit is unknown.');
  if (currentLimit === null) unavailable.push('Motor-current limit is unknown.');
  if (tempLimit === null) unavailable.push('Motor-temperature limit is unknown.');
  if (idleCurrent === null) assumptions.push('No-load current was not supplied; current estimates exclude it and are lower bounds on total motor current.');
  if (driverResistance === null) unavailable.push('Driver conduction loss needs driverResistanceOhm; MOSFET switching loss is not modelled.');
  if (auxiliaryPower === null) unavailable.push('Whole-robot energy excludes sensors, computers and other auxiliaries without auxiliaryPowerW.');
  const series = [], violations = [], temps = [ambient, ambient];
  let priorTime = -Infinity, previous = null, missingTorque = 0, mechanicalJ = 0, brakingJ = 0, copperJ = 0, motorInputJ = 0, driverJ = 0, gapCount = 0, thermalValid = true;
  let maxCurrent = null, maxVoltage = null, maxTemperature = null, currentCoverage = 0, coveredSeconds = 0;
  const addViolation = (kind, t, wheel, value, limit) => { if (violations.length < 1000) violations.push({kind, t, wheel, value, limit}); };
  for (let index = 0; index < frames.length; index++) {
    const f = frames[index], t = finite(f.time ?? f.t ?? f.timeSeconds, 'Sample time');
    if (t < 0 || t > 86400 || t <= priorTime) throw Error('Drive samples need strictly increasing seconds within one day.');
    const dt = index ? t - priorTime : 0; priorTime = t;
    if (dt > maxGap) { gapCount++; thermalValid = false; }
    const torqueRaw = f.wheelTorqueNm ?? (options.torqueSource === 'wheel-actuator' ? f.actuatorForce : undefined);
    const speedRaw = f.wheelVelocityRadS ?? f.encoder?.wheelVelocityRadS;
    if (torqueRaw == null || speedRaw == null || Array.isArray(torqueRaw) && !torqueRaw.length || Array.isArray(speedRaw) && !speedRaw.length) { missingTorque++; previous = null; thermalValid = false; continue; }
    const torque = pair(torqueRaw, 'Wheel torque in N m'), omega = pair(speedRaw, 'Wheel velocity in rad/s');
    const wheelPower = torque.map((tau, i) => tau * omega[i]);
    const sample = {t, wheelTorqueNm: [...torque], wheelVelocityRadS: [...omega], mechanicalPowerW: wheelPower.reduce((a, x) => a + Math.max(0, x), 0),
      brakingPowerW: wheelPower.reduce((a, x) => a + Math.max(0, -x), 0), currentA: null, voltageDemandV: null, copperLossW: null, driverConductionLossW: null, motorInputPowerW: null, temperatureC: null};
    if (canCurrent) {
      sample.currentA = torque.map(tau => Math.abs(tau) / (ratio * efficiency * kt) + (idleCurrent ?? 0));
      maxCurrent = Math.max(maxCurrent ?? 0, ...sample.currentA); currentCoverage++;
      sample.currentA.forEach((current, i) => { if (currentLimit !== null && current > currentLimit + 1e-9) addViolation('current-limit', t, i, current, currentLimit); });
      if (resistance !== null) sample.copperLossW = sample.currentA.map(i => i * i * resistance);
      if (driverResistance !== null) sample.driverConductionLossW = sample.currentA.map(i => i * i * driverResistance);
      if (canElectrical) {
        const terminalVoltage = sample.currentA.map((i, j) => i * resistance + Math.abs(omega[j] * ratio) * ke);
        sample.voltageDemandV = terminalVoltage.map((v, j) => v + sample.currentA[j] * (driverResistance ?? 0));
        // Upper motoring demand with no regenerative credit. This remains terminal input, not measured battery draw.
        sample.motorInputPowerW = terminalVoltage.reduce((sum, v, j) => sum + (wheelPower[j] >= 0 ? v * sample.currentA[j] : sample.copperLossW[j]), 0);
        maxVoltage = Math.max(maxVoltage ?? 0, ...sample.voltageDemandV);
        sample.voltageDemandV.forEach((v, i) => { if (voltage !== null && v > voltage + 1e-9) addViolation('voltage-limit', t, i, v, voltage); });
      }
      if (canThermal && thermalValid) {
        if (previous && dt <= maxGap) for (let j = 0; j < 2; j++) {
          const loss = .5 * (sample.copperLossW[j] + previous.copperLossW[j]);
          temps[j] = ambient + loss * rThermal + (temps[j] - ambient - loss * rThermal) * Math.exp(-dt / (rThermal * cThermal));
        }
        sample.temperatureC = [...temps]; maxTemperature = Math.max(maxTemperature ?? -Infinity, ...temps);
        temps.forEach((temp, i) => { if (tempLimit !== null && temp > tempLimit) addViolation('temperature-limit', t, i, temp, tempLimit); });
      }
    }
    if (previous && dt <= maxGap) {
      coveredSeconds += dt;
      mechanicalJ += .5 * (sample.mechanicalPowerW + previous.mechanicalPowerW) * dt;
      brakingJ += .5 * (sample.brakingPowerW + previous.brakingPowerW) * dt;
      if (sample.copperLossW) copperJ += .5 * (sample.copperLossW.reduce((s, x) => s + x, 0) + previous.copperLossW.reduce((s, x) => s + x, 0)) * dt;
      if (sample.motorInputPowerW !== null) motorInputJ += .5 * (sample.motorInputPowerW + previous.motorInputPowerW) * dt;
      if (sample.driverConductionLossW) driverJ += .5 * (sample.driverConductionLossW.reduce((s, x) => s + x, 0) + previous.driverConductionLossW.reduce((s, x) => s + x, 0)) * dt;
    }
    series.push(sample); previous = sample;
  }
  if (missingTorque) unavailable.push(`${missingTorque} samples lack explicitly named wheel torque and wheel velocity; their intervals were not integrated.`);
  if (gapCount) unavailable.push(`${gapCount} time gaps exceed ${maxGap} seconds and were not integrated.`);
  if (canThermal && !thermalValid) { maxTemperature = null; unavailable.push('Temperature after a missing interval is unavailable; no unobserved heating or cooling was invented.'); }
  const duration = frames.at(-1).time ?? frames.at(-1).t ?? frames.at(-1).timeSeconds;
  const firstTime = frames[0].time ?? frames[0].t ?? frames[0].timeSeconds;
  const coverage = coveredSeconds / Math.max(1e-12, duration - firstTime);
  if (canThermal) assumptions.push('Temperature is a first-order copper-loss motor model starting at ambient. Core, friction and enclosure effects require their own calibrated heat sources; gaps are excluded.');
  if (kt !== null && ke !== null && Math.abs(kt - ke) > .15 * Math.max(kt, ke)) assumptions.push('Supplied SI torque and back-EMF constants differ by more than 15%; verify motor convention, phase/bus definitions and calibration.');
  return {schema: DRIVE_ANALYSIS_SCHEMA, status: !series.length ? 'unavailable' : violations.length ? 'limits-exceeded' : unavailable.length ? 'partial' : 'modelled-within-limits',
    origin: recording?.provenance?.origin ?? recording?.provenance?.simulation ?? 'recording origin supplied by operator', physicalValidated: false,
    metrics: {durationSeconds: duration - firstTime, coveredSeconds, coverage, mechanicalEnergyWh: series.length ? mechanicalJ / 3600 : null,
      brakingEnergyWh: series.length ? brakingJ / 3600 : null, copperLossWh: canCurrent && resistance !== null && series.length ? copperJ / 3600 : null,
      motorTerminalEnergyWh: canElectrical && series.length ? motorInputJ / 3600 : null,
      driverConductionLossWh: canCurrent && driverResistance !== null && series.length ? driverJ / 3600 : null,
      auxiliaryEnergyWh: auxiliaryPower !== null ? auxiliaryPower * coveredSeconds / 3600 : null,
      maximumMotorCurrentA: maxCurrent, maximumVoltageDemandV: maxVoltage, maximumModelledTemperatureC: maxTemperature,
      currentSampleCoverage: currentCoverage / frames.length}, series, violations, unavailable, assumptions};
}
