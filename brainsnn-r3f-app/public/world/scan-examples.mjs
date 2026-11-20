// Two authored rooms made from coloured Gaussian samples in local display units.
const SPACING = 0.075;
const SH_DC = 0.28209479177387814;
const PROPERTIES = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];

export function createScanExample(room) {
  if (!['reading', 'studio'].includes(room)) throw Error('Choose the reading room or the studio.');
  const rows = [];
  function surface(origin, u, v, rgb, spacing = SPACING) {
    const stepsU = Math.max(1, Math.ceil(Math.hypot(...u) / spacing));
    const stepsV = Math.max(1, Math.ceil(Math.hypot(...v) / spacing));
    const axes = u.map((component, axis) => (component || v[axis]) ? spacing * 0.61 : spacing * 0.29);
    for (let a = 0; a <= stepsU; a++) for (let b = 0; b <= stepsV; b++) {
      const position = origin.map((start, axis) => start + u[axis] * a / stepsU + v[axis] * b / stepsV);
      const shade = 0.97 + 0.03 * Math.sin(a * 17.1 + b * 6.7);
      rows.push([...position, ...rgb.map(c => (c * shade / 255 - 0.5) / SH_DC), 2.4,
        ...axes.map(Math.log), 1, 0, 0, 0]);
    }
  }
  function box(x, y, z, w, h, d, color, spacing = SPACING) {
    const dx = [w,0,0], dy = [0,h,0], dz = [0,0,d];
    const side = color.map(c => c * 0.93);
    surface([x,y,z], dx, dz, side, spacing);
    surface([x,y+h,z], dx, dz, color, spacing);
    surface([x,y,z], dy, dx, side, spacing);
    surface([x,y,z+d], dy, dx, color, spacing);
    surface([x,y,z], dz, dy, side, spacing);
    surface([x+w,y,z], dz, dy, side, spacing);
  }
  const reading = room === 'reading';
  const plaster = reading ? [159,187,172] : [133,168,197];
  const oak = [189,148,103];
  // Floorboards, back wall and a recessed-looking framed print.
  for (let i = 0; i < 12; i++) {
    const wood = (reading ? [124,149,152] : [188,167,134]).map(c => c + (i % 3) * 4);
    surface([-3+i*0.5,0,-2], [0.487,0,0], [0,0,4.2], wood, 0.12);
  }
  surface([-3,0,-2.04], [6,0,0], [0,2.85,0], plaster, 0.12);
  box(-2.34,1.02,-1.99,1.15,1.3,0.075,oak,0.11);
  surface([-2.24,1.12,-1.90], [0.95,0,0], [0,1.1,0], [246,220,168], 0.09);
  surface([-2.15,1.24,-1.875], [0.77,0,0], [0,0.26,0], [65,112,110], 0.065);
  surface([-1.85,1.50,-1.87], [0.3,0,0], [0,0.45,0], [198,132,70], 0.065);
  // A rug leaves the centre of the second room free for a portable object.
  surface([-1.76,0.035,-0.68], [3.15,0,0], [0,0,2.12], reading ? [67,121,122] : [92,116,150], 0.09);
  box(1.04,0.68,-1.35,1.45,0.13,0.64,oak);
  for (const x of [1.12,2.29]) for (const z of [-1.28,-0.87]) box(x,0,z,0.1,0.68,0.1,oak,0.10);
  box(1.26,0.82,-1.21,0.56,0.08,0.35,[92,100,140]);
  box(1.31,0.90,-1.19,0.48,0.07,0.32,[221,197,135]);
  if (reading) {
    const coral = [216,109,80];
    // Seat, back and legs touch so a geometric selection can reach the whole chair.
    box(-0.93,0.59,-0.04,1.13,0.19,0.96,coral);
    box(-0.93,0.76,-0.04,1.13,0.94,0.17,coral);
    for (const x of [-0.86,0.01]) for (const z of [0.04,0.72]) box(x,0.07,z,0.13,0.53,0.13,coral);
  }
  const header = new TextEncoder().encode(['ply', 'format binary_little_endian 1.0', 'comment authored BrainSNN practice room',
    'element vertex ' + rows.length, ...PROPERTIES.map(name => 'property float ' + name), 'end_header', ''].join('\n'));
  const bytes = new Uint8Array(header.length + rows.length * PROPERTIES.length * 4);
  bytes.set(header);
  const view = new DataView(bytes.buffer);
  let offset = header.length;
  for (const row of rows) for (const value of row) { view.setFloat32(offset, value, true); offset += 4; }
  return new File([bytes], 'authored-' + (reading ? 'reading-room' : 'empty-studio') + '.ply', {type:'application/octet-stream'});
}

export function practiceRoomView(canvas) {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const framing = Math.max(1, 1.48 / Math.max(0.5, aspect));
  const target = [0, 1.16, -0.1];
  return {target, eye:[2.3, 1.55, 5.55].map((value, axis) => target[axis] + value * framing), fov:48};
}

export function mountScanExamples({openAsset, input}) {
  const buttons = document.querySelectorAll('[data-scan-example]');
  const open = room => {
    input.value = '';
    return openAsset(createScanExample(room), 'authored');
  };
  for (const button of buttons) {
    button.disabled = input.disabled;
    button.addEventListener('click', () => open(button.dataset.scanExample));
  }
  if (window.frameElement?.id === 'scan-workshop-frame' && !input.disabled) open('reading');
}

export function sendScanSelection(file, selection, isCurrent) {
  const frame = window.frameElement;
  if (!frame?.openReviewedRepair || !file || !selection) throw Error('Open a reviewed Gaussian selection inside the playground first.');
  return frame.openReviewedRepair(file, selection, isCurrent);
}
