import {estimateStereoDepth, exportStereoPly, maxStereoDisparity, MAX_STEREO_WIDTH, MAX_STEREO_HEIGHT} from './stereo-depth-data.mjs';
import {inspectStereoPhoto, stereoImageData, MAX_STEREO_PHOTO_BYTES} from './stereo-photo.mjs';
import {createVisualViewer} from './visual-viewer.mjs';
import {mountStereoExport} from './stereo-export.mjs';

const RIG_SCHEMA = 'brainsnn.stereo.rectified.v1';
const RIG_FIELDS = ['width', 'height', 'fx', 'fy', 'cxLeft', 'cxRight', 'cy', 'baselineMeters'];
const MAX_RIG_BYTES = 8192;
const EXAMPLE = new URL('./examples/stereo/', import.meta.url);
const stops = [[255, 221, 120], [46, 209, 195], [136, 139, 255]];
const UNKNOWN = [15, 23, 40, 255];
const dimensionsEqual = (a, b) => a.width === b.width && a.height === b.height;
const distanceLabel = depth => `${depth.toFixed(depth < 10 ? 2 : 1)} m`;

export const stereoDepthPanel = `<section id="layer-panel-stereo" role="tabpanel" aria-labelledby="layer-tab-stereo" hidden>
  <p>See how far away parts of a scene are by matching details in two photos. Try the example first, or use two photos from a calibrated pair of cameras.</p>
  <div class="layer-toolbar">
    <button type="button" class="primary" data-stereo-example>Try two example photos</button>
    <button type="button" data-stereo-clear hidden>Clear pair</button>
  </div>
  <details data-stereo-own>
    <summary>Use my own photos</summary>
    <p class="layer-note">Use the left and right views of the same still scene. Rectify them first so matching details sit on the same horizontal row. Choose upright PNG or JPEG files, up to 16 MiB and 16 megapixels each.</p>
    <div class="layer-input-row">
      <label>Left photo<input type="file" accept="image/png,image/jpeg,.jpg,.jpeg,.png" data-stereo-left></label>
      <label>Right photo<input type="file" accept="image/png,image/jpeg,.jpg,.jpeg,.png" data-stereo-right></label>
    </div>
    <label>How will you provide your camera calibration?<select data-stereo-cal-mode>
      <option value="manual">Enter the calibration</option><option value="file">Open a calibration JSON file</option>
    </select></label>
    <div data-stereo-manual>
      <p class="layer-note">Use the calibration for these rectified photos at their original size. Both views must share the same focal lengths and vertical image centre.</p>
      <div class="stereo-rig-grid">
        <label>Photo width · px<input type="number" inputmode="numeric" step="1" data-stereo-rig="width"></label>
        <label>Photo height · px<input type="number" inputmode="numeric" step="1" data-stereo-rig="height"></label>
        <label>Horizontal focal length (fx) · px<input type="number" inputmode="decimal" step="any" data-stereo-rig="fx"></label>
        <label>Vertical focal length (fy) · px<input type="number" inputmode="decimal" step="any" data-stereo-rig="fy"></label>
        <label>Left horizontal centre (cx) · px<input type="number" inputmode="decimal" step="any" data-stereo-rig="cxLeft"></label>
        <label>Right horizontal centre (cx) · px<input type="number" inputmode="decimal" step="any" data-stereo-rig="cxRight"></label>
        <label>Shared vertical centre (cy) · px<input type="number" inputmode="decimal" step="any" data-stereo-rig="cy"></label>
        <label>Distance between camera centres · m<input type="number" inputmode="decimal" step="any" data-stereo-rig="baselineMeters"></label>
      </div>
    </div>
    <div data-stereo-cal-file-row hidden>
      <label>Rectified rig calibration<input type="file" accept=".json,application/json" data-stereo-cal-file></label>
      <button type="button" data-stereo-cal-example>Download the example calibration</button>
    </div>
    <details>
      <summary>Change the distance range</summary>
      <p class="layer-note">Leave these blank to search the widest supported range. Set limits only if you know your scene fits inside them. A lookalike outside the real match can give a misleading distance when the range is too narrow.</p>
      <div class="layer-input-row">
        <label>Closest expected distance · m<input type="number" min="0" step="any" inputmode="decimal" data-stereo-min-depth></label>
        <label>Farthest expected distance · m<input type="number" min="0" step="any" inputmode="decimal" data-stereo-max-depth></label>
      </div>
    </details>
    <label class="layer-check"><input type="checkbox" data-stereo-confirm>
      <span>These photos are a rectified left and right pair, and this calibration matches their original size and camera positions.</span>
    </label>
    <button type="button" class="primary" data-stereo-run>Find depth</button>
    <p class="layer-note">The photos stay in this browser.</p>
  </details>
  <div data-stereo-working hidden>
    <label>Comparing the photos<progress data-stereo-progress max="1" value="0"></progress></label>
    <button type="button" data-stereo-cancel>Stop matching</button>
  </div>
  <p class="layer-note stereo-status" data-stereo-status role="status">Try the example or choose your two photos.</p>
  <section data-stereo-result aria-label="Stereo depth results" hidden>
    <div class="stereo-images">
      <figure><figcaption>Left photo</figcaption><canvas data-stereo-view-left role="img" aria-label="Rectified left photo used for matching"></canvas></figure>
      <figure><figcaption>Right photo</figcaption><canvas data-stereo-view-right role="img" aria-label="Rectified right photo used for matching"></canvas></figure>
      <figure><figcaption>Estimated depth</figcaption>
        <div class="stereo-map"><canvas data-stereo-depth tabindex="0" aria-label="Estimated depth map" aria-describedby="stereo-probe-help"></canvas><span data-stereo-marker hidden></span></div>
      </figure>
    </div>
    <div class="stereo-legend" data-stereo-legend hidden aria-label="Depth colours">
      <span data-stereo-near></span><span class="stereo-ramp" aria-hidden="true"></span><span data-stereo-far></span><span class="stereo-gap">Dark areas have no match</span>
    </div>
    <p id="stereo-probe-help" class="layer-note">Tap the depth map to read a match. With the map focused, use the arrow keys to move.</p>
    <p class="layer-note stereo-probe" data-stereo-probe role="status">Pick a point on the depth map.</p>
    <details data-stereo-inspect hidden>
      <summary>Look at the matching points in 3D</summary>
      <div class="layer-stage stereo-point-stage"><canvas data-stereo-points tabindex="0" aria-label="Stereo points. Drag or use the turn buttons to look around."></canvas></div>
      <div class="layer-toolbar" data-stereo-orbit>
        <button type="button" data-stereo-turn="left">Turn left</button>
        <button type="button" data-stereo-turn="right">Turn right</button>
        <button type="button" data-stereo-reset-view>Reset view</button>
      </div>
      <p class="layer-note" data-stereo-view-note></p>
    </details>
    <button type="button" data-stereo-download hidden>Save matching points (.ply)</button>
    <details><summary>Photos and calibration used</summary><p class="layer-note stereo-source" data-stereo-source></p></details>
    <p class="layer-note">The metre scale comes from your camera calibration. Before using it to measure, compare the estimate with a known distance straight ahead of the left camera. The points are separate from the robot map.</p>
  </section>
  <div data-stereosplat-import></div>
</section>`;

function checkedRig(rig) {
  if (!rig || rig.schema !== RIG_SCHEMA || !RIG_FIELDS.every(key => Number.isFinite(rig[key]))) {
    throw Error('Provide the complete rectified calibration, including original photo width and height.');
  }
  if (!Number.isInteger(rig.width) || !Number.isInteger(rig.height) || rig.width < 32 || rig.height < 24 ||
      rig.fx <= 0 || rig.fy <= 0 || rig.baselineMeters <= 0) {
    throw Error('Use whole-number photo dimensions of at least 32 × 24 and positive focal lengths and camera distance.');
  }
  return Object.fromEntries(RIG_FIELDS.map(key => [key, rig[key]]));
}

async function fileRig(file) {
  if (!file?.size || file.size > MAX_RIG_BYTES) throw Error('Choose a rectified calibration JSON file up to 8 KiB.');
  let rig;
  try { rig = JSON.parse(await file.text()); }
  catch { throw Error('This calibration file is not valid JSON.'); }
  return checkedRig(rig);
}

function workingRig(rig) {
  const scale = Math.min(1, MAX_STEREO_WIDTH / rig.width, MAX_STEREO_HEIGHT / rig.height);
  const width = Math.max(1, Math.floor(rig.width * scale)), height = Math.max(1, Math.floor(rig.height * scale));
  if (width < 32 || height < 24) throw Error('These photos are too narrow to compare at the working size.');
  const sx = width / rig.width, sy = height / rig.height;
  return {width, height, calibration: {fx: rig.fx * sx, fy: rig.fy * sy,
    cxLeft: (rig.cxLeft + 0.5) * sx - 0.5, cxRight: (rig.cxRight + 0.5) * sx - 0.5,
    cy: (rig.cy + 0.5) * sy - 0.5, baselineMeters: rig.baselineMeters}};
}

function searchOptions(calibration, width, near, far) {
  if (near === null && far === null) return undefined;
  if (near !== null && !(near > 0) || far !== null && !(far > 0) || near !== null && far !== null && near >= far) {
    throw Error('Choose positive distances with the closest distance smaller than the farthest distance.');
  }
  const scale = calibration.fx * calibration.baselineMeters;
  const minDisparity = far === null ? 1 : Math.max(1, Math.floor(scale / far));
  const maxDisparity = near === null ? undefined : Math.ceil(scale / near);
  const supported = maxStereoDisparity(width);
  if (minDisparity > supported - 3 || maxDisparity !== undefined &&
      (maxDisparity > supported || maxDisparity < minDisparity + 3)) {
    throw Error('This distance range is too close or too narrow for these photos. Widen the range or leave it blank.');
  }
  return {minDisparity, maxDisparity};
}

async function fetchExample(name, limit, signal) {
  const response = await fetch(new URL(name, EXAMPLE), {signal, credentials:'same-origin', redirect:'error'});
  if (!response.ok || !response.body) throw Error('The example could not be opened. Try again.');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error('An example file is larger than expected.');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return new File(parts, name);
}

function paint(canvas, image) {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0);
}

function colorFor(value, low, high) {
  const fraction = high > low ? Math.min(1, Math.max(0, (value - low) / (high - low))) : 0.5;
  const band = fraction < 0.5 ? 0 : 1, blend = fraction * 2 - band;
  return stops[band].map((value, index) => Math.round(value + blend * (stops[band + 1][index] - value)));
}

function renderDepth(canvas, result) {
  const {width, height, samples, sampleStep} = result;
  const image = new ImageData(width, height);
  const lookup = new Int32Array(width * height).fill(-1);
  const depths = samples.map(sample => sample.depthMeters).sort((a, b) => a - b);
  const low = depths[Math.floor(depths.length * 0.05)], high = depths[Math.floor(depths.length * 0.95)];
  const side = Math.max(1, sampleStep - 1); // Show the matched grid, leaving unstamped space between samples.
  for (let pixel = 0; pixel < lookup.length; pixel++) image.data.set(UNKNOWN, pixel * 4);
  samples.forEach((sample, index) => {
    const left = sample.x - Math.floor(side / 2), top = sample.y - Math.floor(side / 2);
    const rgba = [...colorFor(sample.depthMeters, low, high), 255];
    for (let y = Math.max(0, top); y < Math.min(height, top + side); y++) {
      for (let x = Math.max(0, left); x < Math.min(width, left + side); x++) {
        const pixel = y * width + x;
        image.data.set(rgba, pixel * 4);
        lookup[pixel] = index;
      }
    }
  });
  paint(canvas, image);
  return {lookup, low, high};
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function mountStereoDepth({root, signal}) {
  const panel = root.querySelector('#layer-panel-stereo');
  const $ = selector => panel.querySelector(selector);
  const on = (selector, type, callback) => $(selector).addEventListener(type, callback, {signal});
  const toggle = $('[data-stereo-cal-mode]');
  const confirmation = $('[data-stereo-confirm]');
  const depthCanvas = $('[data-stereo-depth]');
  const status = $('[data-stereo-status]');
  const working = $('[data-stereo-working]');
  const progress = $('[data-stereo-progress]');
  const resultPane = $('[data-stereo-result]');
  const inspect = $('[data-stereo-inspect]');
  const clearButton = $('[data-stereo-clear]');
  const viewerBridge = mountStereoExport($('[data-stereosplat-import]'));
  let task = null, result = null, lookup = null, viewer = null, probe = null;

  function say(text, error = false) {
    status.textContent = text;
    status.classList.toggle('stereo-error', error);
  }

  function viewSettings() {
    $('[data-stereo-manual]').hidden = toggle.value !== 'manual';
    $('[data-stereo-cal-file-row]').hidden = toggle.value !== 'file';
  }

  function clearResult() {
    result = lookup = probe = null;
    resultPane.hidden = true;
    inspect.open = false;
    viewer?.clear();
    for (const canvas of panel.querySelectorAll('[data-stereo-depth],[data-stereo-view-left],[data-stereo-view-right]')) canvas.width = 1;
    $('[data-stereo-marker]').hidden = true;
    $('[data-stereo-probe]').textContent = 'Pick a point on the depth map.';
    $('[data-stereo-source]').textContent = '';
  }

  function stop() {
    task?.abort();
    task = null;
    working.hidden = true;
  }

  function clear() {
    stop();
    clearResult();
    for (const input of panel.querySelectorAll('[data-stereo-left],[data-stereo-right],[data-stereo-cal-file],[data-stereo-rig],[data-stereo-min-depth],[data-stereo-max-depth]')) input.value = '';
    confirmation.checked = false;
    clearButton.hidden = true;
    say('Pair cleared. Try the example or choose your two photos.');
  }

  function showResult(value, left, right, source, prepared) {
    result = value;
    paint($('[data-stereo-view-left]'), left);
    paint($('[data-stereo-view-right]'), right);
    const map = renderDepth(depthCanvas, result);
    lookup = map.lookup;
    const hasMatches = result.samples.length > 0;
    $('[data-stereo-legend]').hidden = !hasMatches;
    if (hasMatches) {
      $('[data-stereo-near]').textContent = `Near · ${distanceLabel(map.low)}`;
      $('[data-stereo-far]').textContent = `Far · ${distanceLabel(map.high)}`;
    }
    inspect.hidden = !result.points.length;
    $('[data-stereo-download]').hidden = !result.points.length;
    const rig = source.rig;
    const inputSize = `${rig.width} × ${rig.height} px`;
    const previewSize = `${prepared.width} × ${prepared.height} px`;
    const scale = dimensionsEqual(rig, prepared) ? inputSize : `${inputSize} → ${previewSize} for matching`;
    const rigLabel = `fx ${rig.fx} px, fy ${rig.fy} px, centres ${rig.cxLeft} / ${rig.cxRight} px, shared cy ${rig.cy} px, baseline ${rig.baselineMeters} m`;
    $('[data-stereo-source]').textContent = `${source.left.name} and ${source.right.name} · ${scale} · ${rigLabel}.`;
    resultPane.hidden = false;
    const summary = `${result.stats.accepted.toLocaleString()} of ${result.stats.tested.toLocaleString()} sampled areas matched.`;
    const note = source.authored ? 'Authored example. Its three layers were drawn at 1.00 m, 1.50 m and 2.40 m.' : 'Depth estimate ready.';
    say(hasMatches ? `${note} ${summary}` : `No reliable matches. ${summary} Check the alignment, lighting and distance range.`, !hasMatches);
  }

  async function run(load) {
    stop();
    clearResult();
    const controller = new AbortController();
    task = controller;
    const current = () => task === controller && !controller.signal.aborted && !signal.aborted;
    clearButton.hidden = false;
    working.hidden = false;
    progress.value = 0;
    say('Opening the photos on this device…');
    try {
      const source = await load(controller.signal);
      if (!current()) return;
      const leftSize = await inspectStereoPhoto(source.left);
      const rightSize = await inspectStereoPhoto(source.right);
      if (!dimensionsEqual(leftSize, rightSize) || !dimensionsEqual(leftSize, source.rig)) {
        throw Error('Both photos must have the same original size listed in their calibration.');
      }
      if (!current()) return;
      const prepared = workingRig(source.rig);
      const left = await stereoImageData(source.left, leftSize, prepared.width, prepared.height);
      if (!current()) return;
      const right = await stereoImageData(source.right, rightSize, prepared.width, prepared.height);
      if (!current()) return;
      say('Matching details across the two photos…');
      const value = await estimateStereoDepth({...prepared, left:left.data, right:right.data,
        options:searchOptions(prepared.calibration, prepared.width, source.near, source.far), signal:controller.signal,
        onProgress({completedRows, totalRows}) { if (current()) progress.value = completedRows / totalRows; },
      });
      if (current()) showResult(value, left, right, source, prepared);
    } catch (error) {
      if (current()) say(error.message || 'The photos could not be matched.', true);
    } finally {
      controller.abort();
      if (task === controller) {
        task = null;
        working.hidden = true;
      }
    }
  }

  function readProbe(x, y) {
    if (!result || !lookup) return;
    x = Math.max(0, Math.min(result.width - 1, x));
    y = Math.max(0, Math.min(result.height - 1, y));
    probe = {x, y};
    const mark = $('[data-stereo-marker]');
    mark.style.left = `${(x + 0.5) * 100 / result.width}%`;
    mark.style.top = `${(y + 0.5) * 100 / result.height}%`;
    mark.hidden = false;
    const sample = result.samples[lookup[y * result.width + x]];
    $('[data-stereo-probe]').textContent = sample ? `Estimated depth ${distanceLabel(sample.depthMeters)}.` : 'No reliable depth at this point. Try a bright match.';
  }

  on('[data-stereo-example]', 'click', () => void run(async requestSignal => {
    const [left, right, calibration] = await Promise.all([
      fetchExample('left.png', MAX_STEREO_PHOTO_BYTES, requestSignal), fetchExample('right.png', MAX_STEREO_PHOTO_BYTES, requestSignal),
      fetchExample('calibration.json', MAX_RIG_BYTES, requestSignal),
    ]);
    return {left, right, rig:await fileRig(calibration), authored:true, near:null, far:null};
  }));
  on('[data-stereo-run]', 'click', () => void run(async () => {
    const left = $('[data-stereo-left]').files[0], right = $('[data-stereo-right]').files[0];
    if (!left || !right) throw Error('Choose both the left and the right photo.');
    if (!confirmation.checked) throw Error('Check that your photos are rectified and match this calibration.');
    const rig = toggle.value === 'file' ? await fileRig($('[data-stereo-cal-file]').files[0]) : checkedRig({schema:RIG_SCHEMA,
      ...Object.fromEntries(RIG_FIELDS.map(key => [key, $(`[data-stereo-rig="${key}"]`).valueAsNumber]))});
    const near = $('[data-stereo-min-depth]'), far = $('[data-stereo-max-depth]');
    return {left, right, rig, near:near.value ? near.valueAsNumber : null, far:far.value ? far.valueAsNumber : null};
  }));
  on('[data-stereo-cal-example]', 'click', () => {
    const file = document.createElement('a');
    file.href = new URL('calibration.json', EXAMPLE);
    file.download = 'stereo-calibration-example.json';
    file.click();
  });
  on('[data-stereo-clear]', 'click', () => { clear(); $('[data-stereo-example]').focus(); });
  on('[data-stereo-cancel]', 'click', () => { stop(); say('Matching stopped.'); $('[data-stereo-example]').focus(); });
  for (const input of panel.querySelectorAll('[data-stereo-left],[data-stereo-right],[data-stereo-cal-file],[data-stereo-cal-mode],[data-stereo-rig],[data-stereo-min-depth],[data-stereo-max-depth]')) {
    input.addEventListener('input', () => {
      stop();
      clearResult();
      confirmation.checked = false;
      clearButton.hidden = false;
      viewSettings();
      say('Check the photos and camera calibration, then find depth.');
    }, {signal});
  }
  on('[data-stereo-depth]', 'click', event => {
    if (!result) return;
    const bounds = depthCanvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) * result.width / bounds.width);
    const y = Math.floor((event.clientY - bounds.top) * result.height / bounds.height);
    readProbe(x, y);
  });
  on('[data-stereo-depth]', 'keydown', event => {
    if (!result || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const index = probe ?? {x:Math.round(result.width / 2), y:Math.round(result.height / 2)};
    const step = result.sampleStep;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    readProbe(index.x + dx, index.y + dy);
  });
  on('[data-stereo-inspect]', 'toggle', () => {
    if (!inspect.open || !result?.points.length) return;
    try {
      viewer ??= createVisualViewer($('[data-stereo-points]'), text => { $('[data-stereo-view-note]').textContent = text; });
      viewer.setPoints(result.points, {kind:'point-cloud'});
      $('[data-stereo-view-note]').textContent = 'These points are the samples matched in both photos.';
      $('[data-stereo-orbit]').hidden = false;
    } catch {
      $('[data-stereo-view-note]').textContent = '3D preview needs WebGL2. You can still read the depth map and save the points.';
      $('[data-stereo-orbit]').hidden = true;
    }
  });
  on('[data-stereo-turn="left"]', 'click', () => viewer?.rotateYaw(.32));
  on('[data-stereo-turn="right"]', 'click', () => viewer?.rotateYaw(-.32));
  on('[data-stereo-reset-view]', 'click', () => viewer?.reset());
  on('[data-stereo-download]', 'click', () => {
    if (result?.points.length) download('stereo-matching-points.ply', new Blob([exportStereoPly(result)], {type:'text/plain'}));
  });
  signal.addEventListener('abort', () => { stop(); viewer?.destroy(); viewerBridge?.dispose?.(); }, {once:true});
  return {clear() { clear(); viewerBridge?.clear?.(); }, suspend() { if (task) { stop(); say('Matching stopped.'); } }};
}
