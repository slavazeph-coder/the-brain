export const MAX_CALIBRATION_BYTES = 128 * 1024;
export const MAX_CALIBRATION_WALK_BYTES = 8 * 1024 * 1024;

const MAX_CAMERAS = 16;
const MAX_MARKERS = 128;
const MAX_WALK_FRAMES = 6000;
const MAX_MARKER_SAMPLES = 500_000;
const CAMERA_FIELDS = new Set(['name', 'size', 'matrix', 'distortions', 'rotation', 'translation', 'fisheye']);
const METADATA_FIELDS = new Set(['adjusted', 'error']);
const TOML_NUMBER = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const TRC_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const TRC_HEADER = 'DataRate CameraRate NumFrames NumMarkers Units OrigDataRate OrigDataStartFrame OrigNumFrames';
const UNIT_FACTORS = new Map([['m', 1], ['cm', 0.01], ['mm', 0.001]]);

function fileText(text, limit, label) {
  if (typeof text !== 'string' || text.length > limit || new TextEncoder().encode(text).length > limit) {
    throw new Error(`${label} is too large.`);
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(text)) throw new Error(`${label} must be plain UTF-8 text.`);
  return text.replace(/^\uFEFF/, '');
}

function number(text, pattern, bound, label) {
  const value = Number(text);
  if (!pattern.test(text) || !Number.isFinite(value) || Math.abs(value) > bound) {
    throw new Error(`${label} contains an invalid number.`);
  }
  return value;
}

function name(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} has an invalid name.`);
  }
  return value;
}

function quotedName(text, label) {
  if (/^'[^']*'$/.test(text)) return name(text.slice(1, -1), label);
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) {
    try { return name(JSON.parse(text), label); }
    catch { throw new Error(`${label} has an invalid name.`); }
  }
  throw new Error(`${label} needs a quoted name.`);
}

function calibrationTables(text) {
  const tables = new Map();
  let current = null;
  let pending = null;
  for (const original of text.split(/\r\n?|\n/)) {
    if (original.length > 4096) throw new Error('A calibration row is too long.');
    const line = original.replace(/"(?:[^"\\]|\\.)*"|'[^']*'|#.*/g, token => token.startsWith('#') ? '' : token).trim();
    if (!line) continue;
    if (!pending) {
      const table = /^\[(.+)\]$/.exec(line);
      if (table) {
        const key = /^[\w-]{1,80}$/.test(table[1]) ? table[1] : quotedName(table[1], 'Camera table');
        if (tables.has(key) || tables.size >= MAX_CAMERAS + 1) throw new Error('Calibration has duplicate or too many camera tables.');
        current = new Map();
        tables.set(key, current);
        continue;
      }
      const entry = /^([a-z]+)\s*=\s*(.+)$/.exec(line);
      if (!current || !entry || current.has(entry[1])) throw new Error('Calibration has an invalid or duplicate field.');
      const [, key, value] = entry;
      if (!value.startsWith('[')) {
        current.set(key, value);
        continue;
      }
      pending = {key, fragments: [], depth: 0, length: 0};
      appendArrayLine(pending, value);
    } else {
      appendArrayLine(pending, line);
    }
    if (pending.depth === 0) {
      current.set(pending.key, pending.fragments.join(' '));
      pending = null;
    }
  }
  if (pending) throw new Error('Calibration contains an unfinished array.');
  return tables;
}

function appendArrayLine(array, line) {
  array.length += line.length;
  if (array.length > 4096 || !/^[\s\[\],+\-.\deE]+$/.test(line)) throw new Error('Calibration contains an unsupported array.');
  for (const character of line) {
    if (character === '[') array.depth++;
    if (character === ']') array.depth--;
    if (array.depth < 0 || array.depth > 2) throw new Error('Calibration contains an unsupported array.');
  }
  array.fragments.push(line);
}

function vector(text, lengths, bound, label) {
  if (typeof text !== 'string' || !/^\[[^\[\]]+\]$/.test(text)) throw new Error(`${label} needs an array.`);
  const fields = text.slice(1, -1).trim().replace(/,$/, '').split(',').map(part => part.trim());
  if (!lengths.includes(fields.length)) throw new Error(`${label} has the wrong number of values.`);
  return fields.map(part => number(part, TOML_NUMBER, bound, label));
}

function intrinsics(text) {
  const match = /^\[\s*(\[[^\[\]]+\])\s*,\s*(\[[^\[\]]+\])\s*,\s*(\[[^\[\]]+\])\s*,?\s*\]$/.exec(text ?? '');
  if (!match) throw new Error('Camera matrix needs three rows.');
  const matrix = match.slice(1).map(row => vector(row, [3], 1e6, 'Camera matrix'));
  if (matrix[0][0] <= 0 || matrix[1][1] <= 0 || matrix[0][1] !== 0 || matrix[1][0] !== 0 ||
      matrix[2][0] !== 0 || matrix[2][1] !== 0 || matrix[2][2] !== 1) {
    throw new Error('Use a standard OpenCV camera matrix with positive focal lengths.');
  }
  return matrix;
}

function cameraPose(rotation, translation) {
  const angle = Math.hypot(...rotation);
  if (angle > Math.PI + 1e-6) throw new Error('Camera rotation must be an OpenCV Rodrigues vector in radians.');
  if (angle === 0) return {center: translation.map(component => -component || 0), forward: [0, 0, 1]};

  // Invert OpenCV's world-to-camera pose. The optical axis is camera-local +Z.
  const [x, y, z] = rotation.map(value => value / angle);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const d = 1 - cos;
  const rows = [
    [cos + x * x * d, x * y * d - z * sin, x * z * d + y * sin],
    [y * x * d + z * sin, cos + y * y * d, y * z * d - x * sin],
    [z * x * d - y * sin, z * y * d + x * sin, cos + z * z * d],
  ];
  const center = [0, 1, 2].map(i => -rows.reduce((total, row, j) => total + row[i] * translation[j], 0) || 0);
  return {center, forward: rows[2]};
}

export function parseCameraCalibration(text) {
  const tables = calibrationTables(fileText(text, MAX_CALIBRATION_BYTES, 'Calibration file'));
  const metadata = tables.get('metadata');
  if (metadata) {
    for (const [key, value] of metadata) {
      if (!METADATA_FIELDS.has(key) || (key === 'adjusted' && !/^(true|false)$/.test(value))) {
        throw new Error('Calibration has unsupported metadata.');
      }
      if (key === 'error') number(value, TOML_NUMBER, 1e9, 'Calibration metadata');
    }
    tables.delete('metadata');
  }
  if (tables.size < 2 || tables.size > MAX_CAMERAS) throw new Error(`Load a calibration for 2–${MAX_CAMERAS} cameras.`);

  const seenNames = new Set();
  const cameras = [];
  for (const [section, fields] of tables) {
    if ([...fields.keys()].some(key => !CAMERA_FIELDS.has(key))) throw new Error('Calibration has an unsupported camera field.');
    if (fields.has('fisheye') && fields.get('fisheye') !== 'false') throw new Error('This viewer supports standard cameras without a fisheye lens.');
    const cameraName = fields.has('name') ? quotedName(fields.get('name'), 'Camera') : section;
    if (seenNames.has(cameraName)) throw new Error('Camera names must be unique.');
    seenNames.add(cameraName);

    const [width, height] = vector(fields.get('size'), [2], 16_384, 'Camera image size');
    if (![width, height].every(value => Number.isInteger(value) && value > 0)) throw new Error('Camera image size needs positive whole pixels.');
    const matrix = intrinsics(fields.get('matrix'));
    const distortions = vector(fields.get('distortions'), [4, 5], 1e4, 'Camera distortion');
    const rotation = vector(fields.get('rotation'), [3], Math.PI + 1e-6, 'Camera rotation');
    const translation = vector(fields.get('translation'), [3], 10_000, 'Camera translation');
    cameras.push({name: cameraName, width, height, matrix, distortions, ...cameraPose(rotation, translation)});
  }

  const reference = cameras[0].center;
  if (!cameras.some(({center}) => Math.hypot(...center.map((value, axis) => value - reference[axis])) > 1e-6)) {
    throw new Error('Camera positions coincide. Load the finished camera calibration with estimated positions.');
  }
  return {cameras};
}

function trcColumns(line, expected, label) {
  const parts = line.split('\t').map(part => part.trim());
  // HumanCalib writes a final tab after the complete row, including when the
  // last marker is missing. Keep the three actual empty marker columns intact.
  if (parts.length < expected || parts.slice(expected).some(Boolean)) throw new Error(`${label} has the wrong number of columns.`);
  return parts.slice(0, expected);
}

function* walkRows(text) {
  for (const [line] of text.matchAll(/[^\r\n]*(?:\r\n?|\n|$)/g)) {
    if (line.length > 24_576) throw new Error('A walk row is too long.');
    yield line.replace(/(?:\r\n?|\n)$/, '');
  }
}

function trcMarker(values, multiplier) {
  const missing = value => value === '' || /^nan$/i.test(value);
  if (values.every(missing)) return null;
  if (values.some(missing)) throw new Error('A missing marker must leave all three coordinates empty.');
  return values.map(value => number(value, TRC_NUMBER, 10_000 / multiplier, 'Marker position') * multiplier);
}

export function parseCalibrationWalk(text) {
  const rows = walkRows(fileText(text, MAX_CALIBRATION_WALK_BYTES, 'Walk file'));
  const [formatRow, fieldsRow, settingsRow, namesRow, axesRow] = Array.from({length: 5}, () => rows.next().value ?? '');
  if (!/^PathFileType\s+4\s+\(X\/Y\/Z\)\s+\S/.test(formatRow) || fieldsRow.trim().replace(/\s+/g, ' ') !== TRC_HEADER) {
    throw new Error('Use an OpenSim or HumanCalib .trc marker file.');
  }
  const header = settingsRow.trim().split(/\s+/);
  const count = number(header[2] ?? '', TRC_NUMBER, MAX_WALK_FRAMES, 'Walk frame count');
  const markerCount = number(header[3] ?? '', TRC_NUMBER, MAX_MARKERS, 'Walk marker count');
  if (header.length !== 8 || !Number.isInteger(count) || count < 1 || !Number.isInteger(markerCount) ||
      markerCount < 1 || count * markerCount > MAX_MARKER_SAMPLES) throw new Error('Walk frame or marker count is outside the viewer limit.');
  const units = header[4];
  const multiplier = UNIT_FACTORS.get(units);
  if (!multiplier) throw new Error('Walk coordinates need m, cm or mm units.');
  for (const index of [0, 1, 5]) {
    if (number(header[index], TRC_NUMBER, 10_000, 'Walk sample rate') <= 0) throw new Error('Walk sample rates must be positive.');
  }
  for (const index of [6, 7]) {
    const value = number(header[index], TRC_NUMBER, 1e9, 'Walk original frame count');
    if (!Number.isInteger(value) || value < 0) throw new Error('Walk original frame labels must be nonnegative whole numbers.');
  }

  const width = 2 + 3 * markerCount;
  const names = trcColumns(namesRow, width - 2, 'Walk marker names');
  const axes = trcColumns(axesRow, width, 'Walk axes');
  if (names[0] !== 'Frame#' || names[1] !== 'Time' || axes[0] || axes[1]) throw new Error('Walk column labels are invalid.');

  const markers = [];
  const seenNames = new Set();
  for (let i = 0; i < markerCount; i++) {
    const index = i * 3 + 2;
    const marker = name(names[index], 'Walk marker');
    if (seenNames.has(marker) || names[index + 1] || names[index + 2] ||
        !['X', 'Y', 'Z'].every((axis, offset) => axes[index + offset] === axis + (i + 1))) {
      throw new Error('Walk marker names and X/Y/Z columns must be unique and ordered.');
    }
    markers.push(marker);
    seenNames.add(marker);
  }

  const times = [];
  const frames = [];
  let previousFrame = -1;
  let hasVisibleMarker = false;
  for (const row of rows) {
    if (!row.trim()) continue;
    if (frames.length >= count) throw new Error('Walk frame count disagrees with its header.');
    const values = trcColumns(row, width, 'Walk frame');
    const frame = number(values[0], TRC_NUMBER, 1e9, 'Walk frame label');
    const time = number(values[1], TRC_NUMBER, 86_400, 'Walk timestamp');
    if (!Number.isInteger(frame) || frame <= previousFrame || (times.length && time <= times.at(-1))) {
      throw new Error('Walk frame labels and times must increase.');
    }
    previousFrame = frame;
    times.push(time);
    const positions = markers.map((_, i) => trcMarker(values.slice(i * 3 + 2, i * 3 + 5), multiplier));
    hasVisibleMarker ||= positions.some(position => position !== null);
    frames.push(positions);
  }
  if (frames.length !== count) throw new Error('Walk frame count disagrees with its header.');
  if (!hasVisibleMarker) throw new Error('Walk has no visible marker coordinates.');
  return {times, markers, frames, units};
}
