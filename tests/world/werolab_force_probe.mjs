// Opt-in replay on existing local WeRoLab AB01 sit-to-stand repetition 2 files.
// Run: node tests/world/werolab_force_probe.mjs "/data/AB01/Sit to stand/2"
// Accepts the published Data/generated/Results layout or the three files together.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readForceCsv } from '../../brainsnn-r3f-app/public/world/movement-analysis.mjs';
import { parseOpenSimKnees } from '../../brainsnn-r3f-app/public/world/movement-opensim.mjs';
import { estimateSupport } from '../../brainsnn-r3f-app/public/world/movement-support.mjs';
import { compareVerticalForce } from '../../brainsnn-r3f-app/public/world/movement-trial.mjs';

const files = {
  model: ['Results/sit_to_stand_2_IKOut.mot_BodyKinematics_pos_global', '06e398ad6e2ab523ac4a720d40080e579eb0c9fc5bfc08a50b71e172ec78c8ae'],
  ik: ['generated/sit_to_stand_2_IKOut.mot', 'b0f629133666a210dcb5fea06a829ccc12d1b58afa52dcedbff6ad4c4567b909'],
  plates: ['Data/sit_to_stand_2.mot', '50eef4e72cae3c2e97e31c01df6c70e59f7a47f1a0e7d720580ab8d4a181ab03'],
};

function input(directory, [relative, sha256]) {
  const paths = [join(directory, relative), join(directory, basename(relative))];
  const path = paths.find(existsSync);
  if (!path) throw new Error('Missing WeRoLab file: ' + relative);
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error('File differs from the published AB01 repetition 2 data: ' + relative);
  }
  return bytes.toString('utf8');
}

function columns(text, names) {
  const lines = text.trim().split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === 'endheader') + 1;
  const header = lines[start].trim().split(/\s+/);
  const indexes = names.map(name => header.indexOf(name));
  if (!start || indexes.includes(-1)) throw new Error('Missing OpenSim columns: ' + names.join(', '));
  return lines.slice(start + 1).map(line => {
    const fields = line.trim().split(/\s+/);
    return indexes.map(i => Number(fields[i]));
  });
}

function verifyRate(samples, rate) {
  if (!samples.slice(1).every(([time], i) => Math.abs(time - samples[i][0] - 1 / rate) < 1e-8)) {
    throw new Error('Expected evenly spaced samples at ' + rate + ' Hz.');
  }
}

// The even quadratic term in the centered cubic fit is orthogonal to the
// linear and cubic terms. Project onto (i² - mean(i²)) to obtain its coefficient.
function verticalAcceleration(positions, rate) {
  const offsets = Array.from({length:21}, (_, i) => i - 10);
  const meanSquare = offsets.reduce((sum, i) => sum + i*i, 0) / offsets.length;
  const weights = offsets.map(i => i*i - meanSquare);
  const denominator = weights.reduce((sum, w) => sum + w*w, 0);
  return positions.slice(10, -10).map(([time, center], index) => {
    const sum = weights.reduce((value, w, j) => value + w * (positions[index + j][1] - center), 0);
    return [time, 2 * rate * rate * sum / denominator];
  });
}

function run(directory) {
  const positions = columns(input(directory, files.model), ['time', 'center_of_mass_Y']);
  const plates = columns(input(directory, files.plates), ['time', 'ground_force_1_vy', 'ground_force_2_vy']);
  const knees = parseOpenSimKnees(input(directory, files.ik)).frames;
  verifyRate(positions, 200);
  verifyRate(plates, 1000);
  const acceleration = verticalAcceleration(positions, 200);
  const model = estimateSupport(['time_s,com_az_m_s2', ...acceleration.map(row => row.join(','))].join('\n'), {
    massKg:49.81, sourceLabel:'WeRoLab AB01 STS 2 marker-derived whole-body COM, upward Y',
  });
  const reference = readForceCsv(['time_s,vertical_force_n', ...plates.map(([time, left, right]) => [time, left + right].join(','))].join('\n'), {
    kind:'measured', label:'WeRoLab AB01 STS 2 bilateral vertical foot-plate force',
  });
  const standing = knees.find(frame => frame.left < 30 && frame.right < 30);
  if (!standing) throw new Error('Missing late-rise window.');
  const comparison = compareVerticalForce(model, reference, {startSeconds:standing.time, endSeconds:acceleration.at(-1)[0]});
  console.log(JSON.stringify({
    source:'WeRoLab, AB01, sit to stand, repetition 2', dataDoi:'10.7274/28689221',
    methodsDoi:'10.1038/s41597-025-06227-7', files,
    massKg:model.model.massKg, kinematicsHz:200, forcePlateHz:1000,
    filter:'21-sample centered cubic Savitzky–Golay second derivative of COM Y; discard 10 frames per edge.',
    reference:'Upward vertical force summed over plates 1 and 2.',
    window:'First sample with both IK knees below 30 degrees through the last centered derivative. Earlier chair contact excluded.',
    comparison,
  }, null, 2));
}

try {
  if (process.argv.length !== 3) throw new Error('Usage: node tests/world/werolab_force_probe.mjs "/path/to/AB01/Sit to stand/2"');
  run(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
