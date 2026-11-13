// A .mot table can mix angular coordinates, translations and forces. Read only
// named knee coordinate values; the originating model defines their signs.
export const MAX_MOT_BYTES = 4 * 1024 * 1024;
const MAX_FRAMES = 60000;
const numberToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function readNumber(token, label) {
  const value = Number(token);
  if (!numberToken.test(token) || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label} in the motion table.`);
  }
  return value;
}

function columnIndex(columns, name) {
  // OpenSim 4 may use a full coordinate path ending in /value. A /speed
  // column for the same joint is a different signal.
  const matches = columns.flatMap((column, i) =>
    column === name || column.endsWith('/' + name + '/value') ? [i] : []);
  if (matches.length > 1) throw new Error(`Ambiguous motion table: multiple ${name} columns.`);
  return matches.length ? matches[0] : -1;
}

export function parseOpenSimKnees(text) {
  if (typeof text !== 'string' || text.length > MAX_MOT_BYTES || new TextEncoder().encode(text).length > MAX_MOT_BYTES) {
    throw new Error('Choose an OpenSim text motion file of 4 MiB or less.');
  }
  const headerEnd = /^[ \t]*endheader[ \t]*$/im.exec(text);
  if (!headerEnd) throw new Error('OpenSim motion header must end with endheader.');
  const header = text.slice(0, headerEnd.index);
  const declarations = [...header.matchAll(/^[ \t]*inDegrees[ \t]*(?:=[ \t]*|[ \t]+)(\S+)[ \t]*$/gim)];
  if (declarations.length !== 1 || !/^(yes|no)$/i.test(declarations[0][1])) {
    throw new Error('Declare angular units once in the header as inDegrees=yes or inDegrees=no.');
  }
  const sourceUnits = declarations[0][1].toLowerCase() === 'yes' ? 'degrees' : 'radians';
  const scale = sourceUnits === 'degrees' ? 1 : 180 / Math.PI;
  const lines = text.slice(headerEnd.index + headerEnd[0].length).matchAll(/[^\r\n]+/g);
  let columns, indices;
  const frames = [];
  for (const [line] of lines) {
    if (!line.trim()) continue;
    if (line.length > 32768) throw new Error('A motion table row exceeds the supported length.');
    const values = line.trim().split(/\s+/);
    if (!columns) {
      columns = values;
      indices = { time: columnIndex(columns, 'time'), left: columnIndex(columns, 'knee_angle_l'), right: columnIndex(columns, 'knee_angle_r') };
      if (indices.time < 0 || (indices.left < 0 && indices.right < 0)) {
        throw new Error('Expected time and at least one knee coordinate (knee_angle_l or knee_angle_r).');
      }
      continue;
    }
    if (values.length !== columns.length) throw new Error('Motion row length differs from its column headings.');
    if (frames.length >= MAX_FRAMES) throw new Error(`Choose a motion trial of at most ${MAX_FRAMES} samples.`);
    const time = readNumber(values[indices.time], 'time');
    if (frames.length && time <= frames.at(-1).time) throw new Error('Motion sample times must strictly increase.');
    const frame = { time, left: null, right: null };
    for (const side of ['left', 'right']) {
      if (indices[side] < 0) continue;
      const angle = readNumber(values[indices[side]], side + ' knee angle') * scale;
      if (!Number.isFinite(angle)) throw new Error('Knee coordinate exceeds the supported degree range.');
      frame[side] = angle;
    }
    frames.push(frame);
  }
  if (!frames.length) throw new Error('No knee motion samples found.');
  for (const [key, actual] of [['(?:nRows|datarows)', frames.length], ['(?:nColumns|datacolumns)', columns.length]]) {
    const count = new RegExp('^[ \\t]*' + key + '(?:[ \\t]*=[ \\t]*|[ \\t]+)(\\S+)[ \\t]*$', 'gim');
    for (const [, declared] of header.matchAll(count)) {
      if (!/^\d+$/.test(declared) || Number(declared) !== actual) throw new Error('Motion table size differs from its header.');
    }
  }
  const durationSeconds = frames.at(-1).time - frames[0].time;
  if (!Number.isFinite(durationSeconds)) throw new Error('Motion sample duration exceeds the supported range.');
  return { sourceUnits, availableSides: ['left', 'right'].filter(side => indices[side] >= 0), durationSeconds, frames };
}
