import {
  MAX_CALIBRATION_BYTES, MAX_CALIBRATION_WALK_BYTES,
  parseCameraCalibration, parseCalibrationWalk,
} from './camera-calibration-data.mjs';

export const cameraCalibrationPanel = `<details data-camera-review>
  <summary>Check a camera setup</summary>
  <p>See where your cameras were placed and review the walk used to set them up. Choose a finished HumanCalib or Pose2Sim calibration. Your files stay in this browser.</p>
  <div class="layer-input-row">
    <label>Camera setup · .toml<input data-camera-rig type="file" accept=".toml"></label>
    <label>Calibration walk · optional .trc<input data-camera-walk type="file" accept=".trc"></label>
  </div>
  <div class="layer-toolbar">
    <button type="button" data-camera-review-open>Open setup</button>
    <button type="button" data-camera-review-example>Try an example</button>
    <button type="button" data-camera-review-clear hidden>Clear setup</button>
  </div>
  <p data-camera-review-info class="layer-note camera-review-break" role="status">Choose a finished camera setup, or open the example.</p>
  <div data-camera-review-result hidden>
    <div class="layer-toolbar">
      <label>Show<select data-camera-view><option value="rig">Camera positions</option><option value="walk" disabled>Walk points</option></select></label>
      <label>View axes<select data-camera-plane><option value="xy">X and Y</option><option value="xz">X and Z</option></select></label>
    </div>
    <div class="layer-stage camera-review-stage"><canvas data-camera-canvas role="img" aria-label="Camera positions in the uploaded setup"></canvas></div>
    <p data-camera-view-note class="layer-note"></p>
    <label data-camera-frame-label hidden>Walk frame<input data-camera-frame type="range" min="0" max="0" value="0"></label>
    <p data-camera-frame-info aria-live="polite" class="layer-note" hidden></p>
    <details><summary>Camera positions and source files</summary><ul data-camera-list class="camera-review-break"></ul><p data-camera-sources class="layer-note camera-review-break"></p></details>
  </div>
  <p class="layer-note">Camera setup files describe where cameras are placed. The walk points can help you spot gaps. Check accuracy against a known reference before using the setup for measurements.</p>
</details>`;

async function readInput(file, extension, limit) {
  if (!file || !file.name.toLowerCase().endsWith(extension) || !file.size || file.size > limit) {
    throw Error(`Choose a ${extension} file up to ${limit < 1024 * 1024 ? `${limit / 1024} KiB` : `${limit / (1024 * 1024)} MiB`}.`);
  }
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    text: new TextDecoder('utf-8', {fatal: true}).decode(bytes),
    sha: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
    name: file.name,
  };
}

function canvasProjection(canvas, points) {
  const {width, height} = canvas.getBoundingClientRect();
  if (width < 60 || height < 60) return null;
  const scale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 2; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  const zoom = Math.min((width - 48) / Math.max(0.4, max[0] - min[0]), (height - 54) / Math.max(0.4, max[1] - min[1]));
  const mid = min.map((value, axis) => (value + max[axis]) / 2);
  return {context, project: ([x, y]) => [width / 2 + (x - mid[0]) * zoom, height / 2 - (y - mid[1]) * zoom]};
}

function drawCameras(canvas, cameras, axis) {
  const centres = cameras.map(({center}) => [center[0], center[axis]]);
  const reach = Math.max(0.3, ...centres.map(a => Math.max(...centres.map(b => Math.hypot(a[0] - b[0], a[1] - b[1]))))) * 0.17;
  const ends = cameras.map(({center, forward}) => [center[0] + forward[0] * reach, center[axis] + forward[axis] * reach]);
  const plot = canvasProjection(canvas, [...centres, ...ends]);
  if (!plot) return;
  const {context, project} = plot;
  context.font = '14px system-ui';
  context.textAlign = 'center';
  context.lineWidth = 2;
  centres.forEach((center, index) => {
    const [x, y] = project(center);
    const [targetX, targetY] = project(ends[index]);
    const heading = Math.atan2(targetY - y, targetX - x);
    context.strokeStyle = '#5fe4e8';
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(targetX, targetY);
    if (Math.hypot(targetX - x, targetY - y) > 6) {
      for (const turn of [-0.42, 0.42]) {
        context.moveTo(targetX, targetY);
        context.lineTo(targetX - 8 * Math.cos(heading + turn), targetY - 8 * Math.sin(heading + turn));
      }
    }
    context.stroke();
    context.fillStyle = '#5fe4e8';
    context.beginPath();
    context.arc(x, y, 5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f3f7ff';
    context.fillText(String(index + 1), x, y + (targetY >= y ? -11 : 19));
  });
}

function walkBounds(walk) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const frame of walk.frames) {
    for (const point of frame) {
      if (!point) continue;
      point.forEach((value, axis) => {
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      });
    }
  }
  return [min, max];
}

function drawWalk(canvas, frame, bounds, axis) {
  const toPlane = point => [point[0], point[axis]];
  const plot = canvasProjection(canvas, bounds.map(toPlane));
  if (!plot) return;
  const {context, project} = plot;
  context.fillStyle = '#ffe197';
  for (const point of frame) {
    if (!point) continue;
    const [x, y] = project(toPlane(point));
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
  }
}

export function mountCameraCalibrationTool({root, signal}) {
  const $ = selector => root.querySelector(selector);
  const on = (selector, event, handler) => $(selector).addEventListener(event, handler, {signal});
  const pane = $('[data-camera-review]');
  const canvas = $('[data-camera-canvas]');
  const seek = $('[data-camera-frame]');
  const view = $('[data-camera-view]');
  const result = $('[data-camera-review-result]');
  const info = $('[data-camera-review-info]');
  const resetText = 'Choose a finished camera setup, or open the example.';
  let revision = 0;
  let rig = null;
  let walk = null;
  let bounds = null;

  function render() {
    if (!rig || signal.aborted || !pane.open) return;
    const showWalk = view.value === 'walk' && walk;
    const axis = $('[data-camera-plane]').value === 'xz' ? 2 : 1;
    const axes = axis === 2 ? 'X and Z' : 'X and Y';
    $('[data-camera-frame-label]').hidden = !showWalk;
    $('[data-camera-frame-info]').hidden = !showWalk;
    if (showWalk) {
      const index = Number(seek.value);
      const frame = walk.frames[index];
      const visible = frame.filter(Boolean).length;
      canvas.setAttribute('aria-label', `Walk points on the ${axes} axes`);
      $('[data-camera-view-note]').textContent = 'Each dot is a point from your walk file. The display uses the file’s axes and keeps the same scale as you move through time.';
      $('[data-camera-frame-info]').textContent = `Frame ${index + 1} of ${walk.frames.length} · ${walk.times[index].toFixed(3)} s · ${visible} of ${walk.markers.length} points visible`;
      drawWalk(canvas, frame, bounds, axis);
    } else {
      canvas.setAttribute('aria-label', `Camera positions and pointing directions on the ${axes} axes`);
      $('[data-camera-view-note]').textContent = 'Dots mark camera positions. Arrows show where the cameras point in this view. The numbers match the camera list below.';
      drawCameras(canvas, rig.cameras, axis);
    }
  }

  function reset(message = resetText) {
    revision++;
    rig = walk = bounds = null;
    result.hidden = true;
    $('[data-camera-review-clear]').hidden = !$('[data-camera-rig]').files.length && !$('[data-camera-walk]').files.length;
    $('[data-camera-list]').replaceChildren();
    $('[data-camera-sources]').textContent = '';
    info.textContent = message;
    canvas.width = 0;
    return revision;
  }

  function clear() {
    $('[data-camera-rig]').value = '';
    $('[data-camera-walk]').value = '';
    reset();
  }

  async function open(example) {
    const token = reset('Opening the setup locally…');
    try {
      const exampleFile = async (name, limit) => {
        const response = await fetch(new URL(`./examples/camera-calibration/${name}`, import.meta.url), {signal, credentials: 'same-origin', redirect: 'error'});
        if (!response.ok) throw Error('The example could not be opened.');
        return readInput(new File([await response.arrayBuffer()], name), `.${name.split('.').at(-1)}`, limit);
      };
      const walkFile = $('[data-camera-walk]').files[0];
      const [rigSource, walkSource] = await Promise.all(example ? [
        exampleFile('camera-setup.toml', MAX_CALIBRATION_BYTES),
        exampleFile('example-walk.trc', MAX_CALIBRATION_WALK_BYTES),
      ] : [
        readInput($('[data-camera-rig]').files[0], '.toml', MAX_CALIBRATION_BYTES),
        walkFile ? readInput(walkFile, '.trc', MAX_CALIBRATION_WALK_BYTES) : null,
      ]);
      if (token !== revision || signal.aborted) return;
      const parsedRig = parseCameraCalibration(rigSource.text);
      const parsedWalk = walkSource ? parseCalibrationWalk(walkSource.text) : null;
      const extent = parsedWalk ? walkBounds(parsedWalk) : null;
      rig = parsedRig;
      walk = parsedWalk;
      bounds = extent;
      view.value = 'rig';
      $('[data-camera-plane]').value = 'xy';
      view.options[1].disabled = !walk;
      seek.max = String(walk ? walk.frames.length - 1 : 0);
      seek.value = '0';
      $('[data-camera-list]').replaceChildren(...rig.cameras.map((camera, index) => {
        const item = document.createElement('li');
        item.textContent = `${index + 1}. ${camera.name} · ${camera.width} × ${camera.height} px · XYZ (${camera.center.map(value => value.toFixed(2)).join(', ')}) m`;
        return item;
      }));
      $('[data-camera-sources]').textContent = [rigSource, walkSource].filter(Boolean).map(source => `${source.name} · SHA-256 ${source.sha}`).join(' / ');
      if (example) {
        $('[data-camera-rig]').value = '';
        $('[data-camera-walk]').value = '';
      }
      result.hidden = false;
      $('[data-camera-review-clear]').hidden = false;
      info.textContent = `${example ? 'Authored example' : 'Local files opened'} · ${rig.cameras.length} cameras${walk ? ` · ${walk.frames.length} walk frames` : ''}.`;
      render();
    } catch (error) {
      if (token === revision && !signal.aborted) info.textContent = error.message;
    }
  }

  const observer = new ResizeObserver(render);
  observer.observe(canvas);
  signal.addEventListener('abort', () => observer.disconnect(), {once: true});
  on('[data-camera-review]', 'toggle', render);
  on('[data-camera-review-open]', 'click', () => void open(false));
  on('[data-camera-review-example]', 'click', () => void open(true));
  on('[data-camera-review-clear]', 'click', clear);
  on('[data-camera-rig]', 'change', () => reset('Files changed. Choose Open setup to review them.'));
  on('[data-camera-walk]', 'change', () => reset('Files changed. Choose Open setup to review them.'));
  on('[data-camera-view]', 'change', render);
  on('[data-camera-plane]', 'change', render);
  on('[data-camera-frame]', 'input', render);
  return {clear};
}
