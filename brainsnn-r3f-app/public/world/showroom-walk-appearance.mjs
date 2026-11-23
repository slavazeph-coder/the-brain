// Project only depth-supported source pixels. All camera vectors use room XYZ, with Y up.
const MAX_GRID = 256;
const background = [21, 29, 40];

export function validateWalkDepth(raw, width, height) {
  const w = raw?.width, h = raw?.height, data = raw?.millimeters;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
      w > MAX_GRID || h > MAX_GRID || Math.abs(w * height / width - h) > 0.51 ||
      typeof data !== 'string' || data.length !== 4 * Math.ceil(w * h * 2 / 3) ||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(data) || atob(data).length !== w * h * 2) {
    throw new Error('Invalid camera depth map.');
  }
  return {width:w, height:h, millimeters:data};
}

/** Back-project a depth map and an identically sized RGBA sample grid once, when the endpoints change. */
export function appearanceSource(frame, rgba) {
  const {pose, depth, width, height} = frame;
  if (!pose || !depth || rgba.length !== depth.width * depth.height * 4) throw new Error('Missing source samples.');
  const packed = atob(depth.millimeters);
  const [fx, fy, cx, cy] = pose.intrinsics;
  const xyz = new Float32Array(depth.width * depth.height * 3);
  const colors = new Uint8Array(xyz.length);
  let count = 0;
  for (let i = 0; i < depth.width * depth.height; i++) {
    const mm = packed.charCodeAt(i * 2) + 256 * packed.charCodeAt(i * 2 + 1);
    if (mm === 0) continue;
    const z = mm / 1000;
    const u = (((i % depth.width) + .5) * width / depth.width - cx) * z / fx;
    const v = ((Math.floor(i / depth.width) + .5) * height / depth.height - cy) * z / fy;
    for (let j = 0; j < 3; j++) {
      xyz[count * 3 + j] = pose.eye[j] + u * pose.right[j] + v * pose.down[j] + z * pose.forward[j];
      colors[count * 3 + j] = rgba[i * 4 + j];
    }
    count++;
  }
  return {width:depth.width, height:depth.height, rgba, xyz:xyz.subarray(0,count*3), colors:colors.subarray(0,count*3)};
}

async function loadSource(frame) {
  const img = new Image();
  img.src = frame.image;
  await img.decode();
  if (img.naturalWidth !== frame.width || img.naturalHeight !== frame.height) {
    throw new Error('Source picture dimensions disagree with the saved camera.');
  }
  const raster = document.createElement('canvas');
  raster.width = frame.depth.width;
  raster.height = frame.depth.height;
  const ctx = raster.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(img, 0, 0, raster.width, raster.height);
  return appearanceSource(frame, ctx.getImageData(0, 0, raster.width, raster.height).data);
}

export async function prepareWalkAppearance(room, start, end) {
  const frames = [room.frames[start],room.frames[end]];
  if (!frames.every(f => f?.pose && f.depth) || start === end) return null;
  const sources = await Promise.all(frames.map(loadSource));
  if (sources.some(source => !source.xyz.length)) return null;
  return {sources, canvas:document.createElement('canvas')};
}

// Resolve occlusion separately for each source before blending. Unseen pixels keep the background.
function project(source, pose, width, height) {
  const depth = new Float32Array(width * height).fill(Infinity);
  const offsets = new Int32Array(depth.length);
  const {eye, right, down, forward} = pose;
  const [fx,fy,cx,cy] = pose.intrinsics;
  for (let i = 0; i < source.xyz.length; i += 3) {
    const x = source.xyz[i] - eye[0], y = source.xyz[i+1] - eye[1], z = source.xyz[i+2] - eye[2];
    const d = forward[0]*x + forward[1]*y + forward[2]*z;
    if (d <= .02) continue;
    const u = ((right[0]*x + right[1]*y + right[2]*z) * fx / d + cx) * width / pose.width;
    const v = ((down[0]*x + down[1]*y + down[2]*z) * fy / d + cy) * height / pose.height;
    const col = Math.floor(u), row = Math.floor(v);
    if (col < 0 || row < 0 || col >= width || row >= height) continue;
    const j = row * width + col;
    if (d < depth[j]) { depth[j] = d; offsets[j] = i; }
  }
  return {depth, offsets, colors:source.colors};
}

/** Fixed resolution reference implementation, also used in the private held-out evaluation. */
export function renderWalkAppearance(sources, pose, fraction, width, height, fillGaps = false) {
  if (sources.length !== 2 || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > MAX_GRID || height > MAX_GRID || !Number.isFinite(fraction)) {
    throw new Error('Invalid walkthrough raster.');
  }
  const t = Math.max(0, Math.min(1, fraction));
  const [a,b] = sources.map(s => project(s, pose, width, height));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const valid = new Uint8Array(width * height);
  const endpoint = sources[t <= .5 ? 0 : 1];
  let filled = 0;
  for (let i = 0; i < valid.length; i++) {
    const za = a.depth[i], zb = b.depth[i];
    const hasA = t < 1 && Number.isFinite(za), hasB = t > 0 && Number.isFinite(zb);
    const sameSurface = hasA && hasB && Math.abs(za - zb) <= Math.max(.025, Math.min(za,zb)*.01);
    const useB = sameSurface ? t : Number(hasB && (!hasA || zb < za));
    pixels[i*4+3] = 255;
    if (!hasA && !hasB) {
      const u = Math.floor(((i % width) + .5) * endpoint.width / width);
      const v = Math.floor((Math.floor(i / width) + .5) * endpoint.height / height);
      const offset = 4 * (v * endpoint.width + u);
      for (let c = 0; c < 3; c++) pixels[i*4+c] = fillGaps ? endpoint.rgba[offset+c] : background[c];
      continue;
    }
    valid[i] = 1;
    filled++;
    for (let c = 0; c < 3; c++) {
      pixels[i*4+c] = (1-useB)*a.colors[a.offsets[i]+c] + useB*b.colors[b.offsets[i]+c];
    }
  }
  return {pixels, valid, coverage:filled / valid.length, width, height};
}

/** Both the playground and exported predictions use the same bounded camera raster. */
export function walkRasterSize(sources, pose, displayWidth = MAX_GRID) {
  const aspect = pose.width / pose.height;
  const longest = Math.min(224, MAX_GRID);
  const sourceWidth = Math.max(...sources.map(source => source.width));
  const w = Math.max(1, Math.round(Math.min(displayWidth, sourceWidth, longest, longest * aspect)));
  const h = Math.max(1, Math.min(longest, Math.round(w / aspect)));
  return {width:w, height:h};
}

export function drawWalkAppearance(canvas, prepared, pose, fraction, fillGaps = false) {
  const backing = prepared.canvas;
  const {width:w, height:h} = walkRasterSize(prepared.sources, pose, canvas.width);
  if (backing.width !== w || backing.height !== h) {backing.width = w; backing.height = h;}
  const result = renderWalkAppearance(prepared.sources, pose, fraction, w, h, fillGaps);
  backing.getContext('2d').putImageData(new ImageData(result.pixels, w, h), 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(21,29,40)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  const fit = Math.min(canvas.width / pose.width, canvas.height / pose.height);
  const dw = pose.width * fit, dh = pose.height * fit;
  ctx.drawImage(backing, (canvas.width-dw)/2, (canvas.height-dh)/2, dw, dh);
  return {coverage:result.coverage};
}
