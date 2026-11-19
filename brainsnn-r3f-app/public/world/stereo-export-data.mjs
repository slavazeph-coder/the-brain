import {parsePLY, STRIDE} from './visual-geometry.mjs';

const MAX_PREVIEW = 20000;
const MAX_PLY = 1024 ** 3;
const CAMERA_CONVENTION = 'OpenCV axes; world = first input left camera; meters';
const SPLAT_FIELDS = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
const finite = value => Number.isFinite(value);

export function readRenderCameras(value) {
  if (!value || value.convention !== CAMERA_CONVENTION) throw Error('Choose cameras.json from the StereoSplat render export.');
  const [h, w] = Array.isArray(value.image_size) ? value.image_size : [];
  if (value.image_size?.length !== 2 || ![h,w].every(n => Number.isInteger(n) && n > 0 && n <= 16384)) {
    throw Error('The render camera image dimensions are invalid.');
  }
  function matrix(m, n) {
    return Array.isArray(m) && m.length === n && m.every(row => Array.isArray(row) && row.length === n && row.every(finite));
  }
  const k = value.intrinsics, views = value.world_to_camera;
  if (!matrix(k,3) || k[0][0] <= 0 || k[1][1] <= 0 || Math.abs(k[1][0]) > 1e-6 ||
      Math.abs(k[2][0]) + Math.abs(k[2][1]) + Math.abs(k[2][2]-1) > 1e-6) throw Error('The render camera intrinsics are invalid.');
  if (!Array.isArray(views) || !views.length || views.length > 2048) throw Error('Choose a camera file with 1 to 2,048 render views.');
  const centers = views.map(m => {
    if (!matrix(m,4) || m[3].some((v,i) => Math.abs(v - Number(i === 3)) > 1e-4)) throw Error('A render camera transform is invalid.');
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j <= i; j++) {
        const dot = m[i][0]*m[j][0] + m[i][1]*m[j][1] + m[i][2]*m[j][2];
        if (Math.abs(dot - Number(i === j)) > 1e-3) throw Error('A render camera rotation is invalid.');
      }
    }
    const [a,b,c] = m;
    const det = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
    if (det < 0) throw Error('A render camera rotation reverses its axes.');
    return [0,1,2].map(j => -(a[j]*a[3] + b[j]*b[3] + c[j]*c[3]));
  });
  return {width:w, height:h, intrinsics:k, views, centers};
}

// Select complete original vertex records before using the existing Gaussian decoder.
// Only a small chunk of the original file is resident at any one time.
export async function readStereoGaussians(file, signal) {
  if (file.size < 64 || file.size > MAX_PLY) throw Error('Choose a binary Gaussian PLY up to 1 GiB.');
  const raw = new Uint8Array(await file.slice(0,65536).arrayBuffer());
  const text = new TextDecoder('ascii').decode(raw);
  const end = /^end_header\r?\n/m.exec(text);
  if (!end) throw Error('The Gaussian PLY header is missing.');
  const offset = end.index + end[0].length;
  const header = text.slice(0, offset);
  const lines = header.trimEnd().split(/\r?\n/);
  const elements = lines.filter(line => line.startsWith('element '));
  const vertex = /^element vertex (\d+)$/.exec(elements[0]);
  if (raw.subarray(0,offset).some(x => x > 127) || lines[0] !== 'ply' ||
      lines[1] !== 'format binary_little_endian 1.0' || elements.length !== 1 || !vertex) {
    throw Error('Choose the standard binary Gaussian PLY written by the StereoSplat exporter.');
  }
  const fields = lines.filter(line => line.startsWith('property ')).map(line => /^property (?:float|float32) (\w+)$/.exec(line)?.[1]);
  if (fields.includes(undefined) || new Set(fields).size !== fields.length || fields.length > 128 ||
      !SPLAT_FIELDS.every(k => fields.includes(k))) throw Error('The PLY is missing standard Gaussian attributes.');
  const total = Number(vertex[1]), stride = fields.length * 4;
  if (!Number.isSafeInteger(total) || total < 1 || offset + total*stride !== file.size) throw Error('The Gaussian PLY length does not match its vertex count.');
  const step = Math.ceil(total / MAX_PREVIEW), count = Math.ceil(total / step);
  const reducedHeader = new TextEncoder().encode(header.replace(/^element vertex \d+$/m, 'element vertex ' + count));
  const preview = new Uint8Array(reducedHeader.length + count*stride);
  preview.set(reducedHeader);
  const rowsPerRead = Math.max(1, Math.floor(2*1024**2 / stride));
  let dst = reducedHeader.length;
  for (let first=0; first<total; first+=rowsPerRead) {
    signal?.throwIfAborted();
    const stop = Math.min(total, first+rowsPerRead);
    const chunk = new Uint8Array(await file.slice(offset+first*stride,offset+stop*stride).arrayBuffer());
    for (let row=Math.ceil(first/step)*step; row<stop; row+=step) {
      const start = (row-first)*stride;
      preview.set(chunk.subarray(start,start+stride),dst);
      dst += stride;
    }
  }
  signal?.throwIfAborted();
  const {points} = parsePLY(preview.buffer);
  return {points, total, displayed:points.length/STRIDE};
}

// Rotate the OpenCV world into the viewer's Y-up convention, including splat orientation.
export function toViewerPoints(points) {
  const out = points.slice();
  for (let i=0; i<out.length; i+=STRIDE) {
    out[i+1] = -points[i+1];
    out[i+2] = -points[i+2];
    const [x,y,z,w] = points.subarray(i+10,i+14);
    out.set([w,-z,y,-x],i+10);
  }
  return out;
}
