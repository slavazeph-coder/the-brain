import {
  drawWalkFrame, framePose, nearestWalkFrame, walkComparison, walkFrames, walkPose,
} from './showroom-walk.mjs';
import {drawWalkAppearance, prepareWalkAppearance} from './showroom-walk-appearance.mjs';

function viewOption(frame, index) {
  const seconds = frame.timeSeconds;
  const time = Number.isFinite(seconds) ? ' · ' + Math.floor(seconds / 60) + ':' +
    String(Math.floor(seconds % 60)).padStart(2, '0') : '';
  return new Option('View ' + (index + 1) + time, String(index));
}

function showPicture(container, frames, index, frameImage) {
  if (container.dataset.index === String(index)) return;
  container.dataset.index = String(index);
  const url = frameImage(frames[index]?.image);
  if (!url) {
    container.textContent = 'Picture unavailable.';
    return;
  }
  const img = new Image();
  img.alt = 'Saved room picture, view ' + (index + 1);
  img.onerror = () => {
    if (img.parentNode === container) container.textContent = 'Picture unavailable.';
  };
  container.replaceChildren(img);
  img.src = url;
}

function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

export function mountShowroomWalk(host, room, {frameImage}) {
  const {frames} = room;
  const indices = walkFrames(room);
  host.innerHTML = '<summary>Preview the walk</summary>';
  if (indices.length < 2) {
    const note = document.createElement('p');
    note.textContent = 'A walk needs two saved camera positions with viewing directions.';
    host.append(note);
    return {pause() {}, dispose() {}};
  }
  host.insertAdjacentHTML('beforeend', `
    <div class="walk-controls">
      <label>Activity<select data-walk-mode><option value="walk">Walk between views</option><option value="compare">Check a saved view</option></select></label>
      <label data-walk-start-label>Start at<select data-walk-from></select></label>
      <label data-walk-end-label>Finish at<select data-walk-to></select></label>
      <label data-walk-target-label hidden>View to check<select data-walk-target></select></label>
    </div>
    <p class="walk-help" data-walk-help></p>
    <div class="walk-views">
      <figure><figcaption data-walk-title>Walk preview</figcaption>
        <div class="walk-picture"><canvas data-walk-canvas width="640" height="360" role="img" aria-label="Walk preview from the room model"></canvas></div>
        <p class="walk-caption" data-walk-method-note></p></figure>
      <figure><figcaption data-walk-reference-title>Closest saved picture</figcaption>
        <div class="walk-picture" data-walk-reference></div>
        <p class="walk-caption" data-walk-reference-note></p></figure>
      <figure data-walk-alternative-figure hidden><figcaption>Closest other picture</figcaption>
        <div class="walk-picture" data-walk-alternative></div>
        <p class="walk-caption" data-walk-alternative-note></p></figure>
    </div>
    <div class="walk-playback" data-walk-playback>
      <button type="button" data-walk-play>Play walk</button>
      <label>Walk progress<input type="range" min="0" max="1000" step="1" value="0" data-walk-progress></label>
      <span data-walk-percent aria-hidden="true">0%</span>
    </div>
    <div class="walk-options">
      <label data-walk-method-label>Show<select data-walk-method><option value="appearance">Photo surfaces</option><option value="points">Room points</option></select></label>
      <label class="walk-fill" data-walk-fill-label hidden><input type="checkbox" data-walk-fill>Fill gaps with an endpoint picture</label>
      <p class="walk-caption" data-walk-camera-note></p>
    </div>
  `);
  const el = key => host.querySelector('[data-walk-' + key + ']');
  const mode = el('mode'), from = el('from'), to = el('to'), target = el('target');
  const play = el('play'), slider = el('progress'), method = el('method'), canvas = el('canvas');
  const fill = el('fill');
  const comparisons = new Map();
  for (const index of indices) {
    from.add(viewOption(frames[index], index));
    to.add(viewOption(frames[index], index));
  }
  to.value = String(indices.at(-1));
  mode.parentElement.hidden = indices.length < 3;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let progress = 0, animation = null, disposed = false;
  let pairKey = '', appearance, preparing = false, preferred = 'appearance';

  function pause() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    setText(play, progress === 1 ? 'Replay walk' : 'Play walk');
  }

  function prepareComparisons() {
    if (comparisons.size) return;
    for (const index of indices.slice(1, -1)) {
      const comparison = walkComparison(room, index);
      if (comparison) {
        comparisons.set(index, comparison);
        target.add(viewOption(frames[index], index));
      }
    }
    if (!comparisons.size) {
      mode.value = 'walk';
      mode.parentElement.hidden = true;
    }
  }

  function endpoints() {
    if (mode.value === 'compare') {
      const check = comparisons.get(Number(target.value));
      return {start:check.beforeIndex, end:check.afterIndex, check};
    }
    return {start:Number(from.value), end:Number(to.value), check:null};
  }

  async function loadAppearance(start, end, key) {
    if (preparing || appearance !== undefined || preferred !== 'appearance') return;
    preparing = true;
    let prepared = null;
    try { prepared = await prepareWalkAppearance(room, start, end); } catch { /* Room points remain available. */ }
    preparing = false;
    if (disposed) return;
    if (key === pairKey) appearance = prepared ?? null;
    if (host.open) render();
  }

  function distanceNote(nearest) {
    return nearest ? 'View ' + (nearest.index + 1) + ' · ' + nearest.distanceMeters.toFixed(2) +
      ' m from the preview camera.' : 'No other picture is available.';
  }

  function render() {
    if (!host.open || disposed) return;
    const {start, end, check} = endpoints();
    const key = start + '/' + end;
    if (key !== pairKey) { pairKey = key; appearance = undefined; }
    const stationary = start === end;
    const at = check ? check.t : progress;
    const pose = check ? framePose(frames[Number(target.value)]) :
      stationary ? framePose(frames[start]) : walkPose(room, start, end, at);
    play.disabled = slider.disabled = stationary || !pose;
    if (!pose) {
      pause();
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      showPicture(el('reference'), frames, start, frameImage);
      setText(el('reference-note'), 'Starting picture, view ' + (start + 1) + '.');
      setText(el('method-note'), 'These camera settings cannot be joined into one walk.');
      setText(el('help'), 'Choose another start or finish view.');
      setText(el('camera-note'), '');
      slider.value = '0';
      slider.setAttribute('aria-valuetext', '0% of the walk');
      setText(el('percent'), '0%');
      el('method-label').hidden = el('fill-label').hidden = true;
      return;
    }
    const scale = Math.min(640 / pose.width, 432 / pose.height);
    const width = Math.max(1, Math.round(pose.width * scale));
    const height = Math.max(1, Math.round(pose.height * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    // Only the two chosen source pictures may supply surface colors, including in comparison mode.
    if (!stationary && preferred === 'appearance') void loadAppearance(start, end, key);
    const useAppearance = !stationary && preferred === 'appearance' && appearance;
    const drawn = useAppearance ? drawWalkAppearance(canvas, appearance, pose, at, fill.checked) : drawWalkFrame(canvas, room, pose);
    el('fill-label').hidden = !useAppearance;
    el('method-label').hidden = stationary || appearance === null;
    method.disabled = preferred === 'appearance' && appearance === undefined;
    const percentage = Math.round(100 * drawn.coverage);
    const methodNote = useAppearance ? 'Pictures from views ' + (start + 1) + ' and ' + (end + 1) +
      ' projected onto the room. ' + percentage + '% of this view has projected color.' :
      !stationary && preferred === 'appearance' && appearance === undefined ? 'Loading photo surfaces. Showing room points.' :
      drawn.visiblePoints ? 'Room points · ' + drawn.visiblePoints.toLocaleString() + ' in view.' : 'No room points are visible here.';
    setText(el('method-note'), methodNote);
    setText(el('camera-note'), (pose.calibrated ? 'Uses saved camera settings.' : 'Camera height and lens are estimated.') +
      (useAppearance && fill.checked ? ' Gaps use the picture from view ' + ((at <= .5 ? start : end) + 1) + '.' :
        ' Dark gaps show where the model has no surface to draw.'));
    const nearest = check ? {index:check.nearestIndex, distanceMeters:check.distanceMeters} : nearestWalkFrame(room, pose);
    showPicture(el('reference'), frames, check ? Number(target.value) : nearest?.index, frameImage);
    setText(el('reference-note'), check ? 'View ' + (Number(target.value) + 1) + ' at the chosen camera position.' : distanceNote(nearest));
    if (check) {
      showPicture(el('alternative'), frames, nearest?.index, frameImage);
      setText(el('alternative-note'), distanceNote(nearest));
    }
    const percent = Math.round(progress * 100) + '%';
    slider.value = String(Math.round(progress * 1000));
    slider.setAttribute('aria-valuetext', percent + ' of the walk');
    setText(el('percent'), percent);
    setText(el('help'), check ? 'Compare the preview with the saved picture from the same spot.' :
      stationary ? 'Pick a different finish view to move the camera.' :
      'Play the walk or move the slider to look between the two views.');
  }

  function reset() {
    progress = 0;
    pause();
    if (mode.value === 'compare') prepareComparisons();
    const compare = mode.value === 'compare';
    el('start-label').hidden = el('end-label').hidden = el('playback').hidden = compare;
    el('target-label').hidden = el('alternative-figure').hidden = !compare;
    setText(el('title'), compare ? 'Preview at this spot' : 'Walk preview');
    setText(el('reference-title'), compare ? 'Saved picture to check' : 'Closest saved picture');
    render();
  }
  mode.onchange = from.onchange = to.onchange = target.onchange = reset;
  method.onchange = () => { preferred = method.value; render(); };
  fill.onchange = render;
  slider.oninput = () => {
    progress = Number(slider.value) / 1000;
    pause();
    render();
  };
  play.onclick = () => {
    if (animation !== null) { pause(); return; }
    if (progress === 1) progress = 0;
    const started = performance.now() - progress * 6000;
    let lastPaint = 0;
    setText(play, 'Pause walk');
    function tick(now) {
      if (!host.open || document.hidden || disposed) { pause(); return; }
      progress = Math.min(1, Math.max(0, (now - started) / 6000));
      if (now - lastPaint >= 40 || progress === 1) { render(); lastPaint = now; }
      if (progress === 1) pause();
      else animation = requestAnimationFrame(tick);
    }
    animation = requestAnimationFrame(tick);
  };
  host.ontoggle = () => { if (host.open) render(); else pause(); };
  const visibility = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', visibility);
  motion.addEventListener('change', pause);
  return {pause, dispose() {
    disposed = true;
    pause();
    document.removeEventListener('visibilitychange', visibility);
    motion.removeEventListener('change', pause);
  }};
}
