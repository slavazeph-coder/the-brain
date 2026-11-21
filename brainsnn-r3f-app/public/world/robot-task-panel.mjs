import {normalizeRobotTask, ROBOT_TASK_DEFAULTS, ROBOT_TASK_LIMITS} from './robot-task-physics.mjs';
import {exportTaskWorkspace, parseTaskInstruction, referencePath} from './robot-task-authoring.mjs';

import {kitchenPinMarkup, mountKitchenPin} from './kitchen-pin-ui.mjs';

const TASKS = {
  reach: {label: 'Reach a target', description: 'Move the blue pusher into the marked circle.'},
  push: {label: 'Push a puck', description: 'Use the blue pusher to move the amber puck into the marked circle.'},
};
const MISSES = {
  'puck-off-table': 'The puck left the tabletop.',
  'no-puck-contact': 'The pusher did not touch the puck.',
  'outside-goal': 'The run ended outside the goal circle.',
  'insufficient-hold': 'The goal needs a 0.2-second hold.',
};
const BRIEF_LIMIT = 1200;
const GEMINI_REFERENCE_LIMIT = 2 * 1024 * 1024;
const RUN_TIMEOUT = 45_000;

/** Inner markup for the existing World Builder tools tab. */
export function robotTaskMarkup() {
  const {minDistance, maxDistance, maxSeed} = ROBOT_TASK_LIMITS;
  const minCentimetres = Math.round(minDistance * 100), maxCentimetres = Math.round(maxDistance * 100);
  return `<div class="robot-task" data-robot-task>
    <h3>Build a robot task</h3>
    <p>Give a simple pusher a goal. Run the task on this device, then replay the recorded motion or save it to work on elsewhere.</p>
    <details data-robot-task-example>
      <summary>Watch a 7-second example</summary>
      <video data-robot-task-film controls playsinline preload="none" aria-label="Two robot runs with the same 30 centimetre goal" aria-describedby="robot-task-film-result"></video>
      <p id="robot-task-film-result">The first robot pushes the puck to the goal. With a shorter reach, the second stops 17.4 cm away.</p>
    </details>
    ${kitchenPinMarkup()}
    <form data-robot-task-form novalidate>
      <div class="robot-task-settings">
        <label>Practice task
          <select data-robot-task-preset aria-describedby="robot-task-description">
            ${Object.entries(TASKS).map(([task, {label}]) => `<option value="${task}">${label}</option>`).join('')}
          </select>
        </label>
        <label>How far forward? <span class="robot-task-unit">(cm)</span>
          <input type="number" inputmode="decimal" required min="${minCentimetres}" max="${maxCentimetres}" step="any" value="${Math.round(ROBOT_TASK_DEFAULTS.distance * 100)}" data-robot-task-distance>
        </label>
      </div>
      <p id="robot-task-description">${TASKS.reach.description}</p>
      <details>
        <summary>Change the controller or starting layout</summary>
        <div class="robot-task-settings">
          <label>Controller
            <select data-robot-task-controller><option value="standard">Standard</option><option value="limited">Limited travel</option></select>
          </label>
          <label>Starting layout number
            <input type="number" inputmode="numeric" required min="0" max="${maxSeed}" step="1" value="${ROBOT_TASK_DEFAULTS.seed}" data-robot-task-seed aria-describedby="robot-task-seed-help">
          </label>
        </div>
        <p id="robot-task-seed-help">Use the same number to repeat the starting layout.</p>
      </details>
      <details class="robot-task-brief">
        <summary>Describe the task or add a reference</summary>
        <label>Task brief
          <textarea rows="3" maxlength="${BRIEF_LIMIT}" data-robot-task-brief placeholder="Push the puck 30 cm" aria-describedby="robot-task-brief-help"></textarea>
        </label>
        <p id="robot-task-brief-help">Try “Push the puck 30 cm” or “Reach the target 20 cm away”. Choose “Use these words” to fill in the task settings, then check them.</p>
        <div class="robot-task-actions">
          <button type="button" data-robot-task-use-words>Use these words</button>
          <button type="button" data-robot-task-save-brief>Save for Antigravity (.zip)</button>
        </div>
        <p>Save your brief and optional original reference for a different scene in Google Antigravity.</p>
        <p data-robot-task-brief-status role="status"></p>
        <label>Reference picture or video <span class="robot-task-unit">(optional)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov" data-robot-task-reference aria-describedby="robot-task-reference-help">
        </label>
        <p id="robot-task-reference-help">Choose a file up to 32 MiB. MuJoCo uses the settings above. You can keep the file in a local task folder or choose to share it with Gemini below.</p>
        <div class="robot-task-reference" data-robot-task-reference-view hidden>
          <img data-robot-task-image alt="Your selected task reference" hidden>
          <video data-robot-task-video controls playsinline preload="metadata" aria-label="Your selected reference video" hidden></video>
          <p data-robot-task-reference-name></p>
          <button type="button" data-robot-task-remove-reference>Remove reference</button>
        </div>
        <p data-robot-task-reference-status role="status"></p>
        <details class="robot-task-gemini">
          <summary>Ask Gemini for a task</summary>
          <p id="robot-task-gemini-help">This sends your brief and optional reference (up to 2 MiB) to Google Gemini through a connected BrainSNN owner account. Gemini samples the first 12 seconds of a video and can draft a reach or push task for you to review.</p>
          <div class="robot-task-actions"><button type="button" data-robot-task-ai-draft aria-describedby="robot-task-gemini-help">Send brief and reference to Gemini</button></div>
          <p data-robot-task-ai-status role="status"></p>
        </details>
      </details>
      <div class="robot-task-actions">
        <button type="submit" class="primary" data-robot-task-run>Try this task</button>
        <button type="button" data-robot-task-stop hidden>Stop run</button>
        <button type="button" data-robot-task-reset>Start over</button>
      </div>
    </form>
    <p data-robot-task-status role="status">Ready to run a practice task.</p>
    <section class="robot-task-result" data-robot-task-result aria-labelledby="robot-task-result-title" hidden>
      <div class="robot-task-result-heading">
        <h4 id="robot-task-result-title">Watch the run</h4>
        <strong data-robot-task-outcome></strong>
      </div>
      <p data-robot-task-score></p>
      <div class="robot-task-actions robot-task-view" role="group" aria-label="Replay view">
        <button type="button" data-robot-task-2d aria-pressed="true">View from above</button>
        <button type="button" data-robot-task-3d aria-pressed="false">View in 3D</button>
      </div>
      <p data-robot-task-view-status role="status"></p>
      <figure>
        <canvas data-robot-task-canvas role="img" aria-label="Top-down replay of the recorded MuJoCo positions" aria-describedby="robot-task-key robot-task-frame"></canvas>
        <canvas data-robot-task-3d-canvas role="img" tabindex="0" aria-label="3D replay of the recorded MuJoCo positions" aria-describedby="robot-task-3d-help robot-task-key robot-task-frame" hidden></canvas>
        <figcaption id="robot-task-key" class="robot-task-key">
          <span class="robot-task-key-pusher">Pusher</span>
          <span class="robot-task-key-puck" data-robot-task-key-puck>Puck</span>
          <span class="robot-task-key-goal">Goal</span>
        </figcaption>
      </figure>
      <div data-robot-task-3d-controls hidden>
        <div class="robot-task-actions" role="group" aria-label="Move the 3D view">
          <button type="button" data-robot-task-turn-left>Turn left</button>
          <button type="button" data-robot-task-turn-right>Turn right</button>
          <button type="button" data-robot-task-zoom-in>Zoom in</button>
          <button type="button" data-robot-task-zoom-out>Zoom out</button>
          <button type="button" data-robot-task-reset-view>Reset view</button>
        </div>
        <p id="robot-task-3d-help">Drag to turn the view. With the view focused, use the arrow keys to turn, + or − to zoom, or Home to reset.</p>
      </div>
      <label>Move through the run
        <input type="range" min="0" max="0" step="1" value="0" data-robot-task-timeline>
      </label>
      <p id="robot-task-frame" data-robot-task-frame></p>
      <div class="robot-task-actions"><button type="button" data-robot-task-play>Play run</button><button type="button" data-robot-task-pause disabled>Pause</button></div>
      <div class="robot-task-download">
        <div class="robot-task-actions">
          <button type="button" data-robot-task-mjcf>Save scene (.xml)</button>
          <button type="button" data-robot-task-recording>Save run data (.json)</button>
          <button type="button" data-robot-task-workspace>Save task folder (.zip)</button>
        </div>
        <p>The task folder contains the simulation scene, recorded run, your brief, and the original reference file if you selected one.</p>
        <p data-robot-task-export-status role="status"></p>
      </div>
      <p class="robot-task-note" data-robot-task-engine></p>
    </section>
  </div>`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 20_000);
}

function drawFrame(canvas, episode, index) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const pixelRatio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * pixelRatio)) canvas.width = Math.round(width * pixelRatio);
  if (canvas.height !== Math.round(height * pixelRatio)) canvas.height = Math.round(height * pixelRatio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = '#0b1420';
  context.fillRect(0, 0, width, height);

  const {scene, frames} = episode, frame = frames[index];
  const {x: [left, right], y: [bottom, top]} = scene.bounds;
  const scale = Math.min((width - 32) / (right - left), (height - 32) / (top - bottom));
  const edgeX = (width - (right - left) * scale) / 2;
  const edgeY = (height - (top - bottom) * scale) / 2;
  const project = ([x, y]) => [edgeX + (x - left) * scale, edgeY + (top - y) * scale];
  const circle = (point, radius) => {
    const [x, y] = project(point);
    context.beginPath();
    context.arc(x, y, Math.max(2, radius * scale), 0, 2 * Math.PI);
  };
  const pusher = (radius, color) => {
    const half = scene.pusherHalfLength || 0;
    const [x, y] = frame.pusher;
    if (!half) {
      circle(frame.pusher, radius);
      context.fillStyle = color;
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(...project([x, y - half]));
    context.lineTo(...project([x, y + half]));
    context.lineCap = 'round';
    context.lineWidth = Math.max(4, 2 * radius * scale);
    context.strokeStyle = color;
    context.stroke();
    context.lineCap = 'butt';
    context.lineWidth = 2;
  };

  context.fillStyle = '#132539';
  context.fillRect(edgeX, edgeY, (right - left) * scale, (top - bottom) * scale);
  context.strokeStyle = '#46647d';
  context.strokeRect(edgeX, edgeY, (right - left) * scale, (top - bottom) * scale);
  circle(scene.goal, scene.goalRadius);
  context.fillStyle = '#184d48';
  context.fill();
  context.strokeStyle = '#9cf4db';
  context.lineWidth = 2;
  context.setLineDash([4, 3]);
  context.stroke();
  context.setLineDash([]);

  const target = frame.puck ? 'puck' : 'pusher';
  context.beginPath();
  context.moveTo(...project(frames[0][target]));
  for (let i = 1; i <= index; i++) context.lineTo(...project(frames[i][target]));
  context.strokeStyle = frame.puck ? '#9c7940' : '#547fa5';
  context.stroke();

  pusher(scene.pusherRadius + (frame.contact ? .01 : .006), frame.contact ? '#fff' : '#cbecff');
  pusher(scene.pusherRadius, '#80cfff');
  if (frame.puck) {
    circle(frame.puck, scene.puckRadius);
    context.fillStyle = '#ffc46d';
    context.fill();
    context.strokeStyle = '#ffe4bb';
    context.stroke();
  }
}

const centimetres = value => `${(value * 100).toFixed(1)} cm`;

export function mountRobotTask({root, signal, draftWithGemini}) {
  const panel = root.matches('[data-robot-task]') ? root : root.querySelector('[data-robot-task]');
  const own = new AbortController();
  const kitchen = mountKitchenPin(panel, {signal:own.signal});
  const $ = key => panel.querySelector(`[data-robot-task-${key}]`);
  const on = (key, event, handler) => $(key).addEventListener(event, handler, {signal: own.signal});
  const form = $('form');
  const example = $('example'), film = $('film');
  on('example', 'toggle', () => {
    if (!example.open) { film.pause(); return; }
    if (film.hasAttribute('src')) return;
    film.poster = './media/robot-task-poster.jpg';
    const captions = document.createElement('track');
    captions.kind = 'captions';
    captions.srclang = 'en';
    captions.label = 'English';
    captions.src = './media/robot-task-captions.vtt';
    film.append(captions);
    film.src = './media/robot-task-comparison.mp4';
  });
  const preset = $('preset'), distance = $('distance'), seed = $('seed'), controller = $('controller');
  const brief = $('brief'), referenceInput = $('reference');
  const canvas = $('canvas'), slider = $('timeline');
  let canvas3D = $('3d-canvas');
  const referenceImage = $('image'), referenceVideo = $('video');
  let reference = null, referenceURL = '';
  let worker = null, deadline = 0, runId = 0, result = null, disposed = false;
  let draft = null;
  let replay = 0, playing = false, index = 0, exportRevision = 0, exportNote = null;
  let preview3D = null, viewLoading = false, viewRevision = 0;

  function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('robot-task-error', error);
  }

  function updateButtons() {
    $('run').disabled = Boolean(worker);
    $('stop').hidden = !worker;
    $('play').disabled = playing;
    $('pause').disabled = !playing;
    $('workspace').disabled = Boolean(exportNote);
    $('save-brief').disabled = Boolean(exportNote);
    $('ai-draft').disabled = Boolean(draft) || !draftWithGemini;
    $('3d').disabled = viewLoading;
  }

  function switchTo2D(message = '') {
    viewRevision++;
    viewLoading = false;
    preview3D?.dispose();
    preview3D = null;
    if (!canvas3D.hidden) {
      const replacement = canvas3D.cloneNode(false);
      replacement.hidden = true;
      canvas3D.replaceWith(replacement);
      canvas3D = replacement;
    }
    canvas.hidden = false;
    $('2d').setAttribute('aria-pressed', 'true');
    $('3d').setAttribute('aria-pressed', 'false');
    $('3d-controls').hidden = true;
    $('view-status').textContent = message;
    updateButtons();
    if (result) drawFrame(canvas, result, index);
  }

  async function switchTo3D() {
    if (!result || preview3D || viewLoading) return;
    const revision = ++viewRevision, episode = result;
    viewLoading = true;
    $('view-status').textContent = 'Opening the 3D replay…';
    updateButtons();
    try {
      const {createRobotTask3D} = await import('./vendor/robot-task-3d.mjs');
      if (disposed || revision !== viewRevision) return;
      canvas3D.hidden = false;
      canvas.hidden = true;
      preview3D = createRobotTask3D(canvas3D, episode);
      preview3D.showFrame(index);
      preview3D.resize();
      $('2d').setAttribute('aria-pressed', 'false');
      $('3d').setAttribute('aria-pressed', 'true');
      $('3d-controls').hidden = false;
      $('view-status').textContent = '3D replay ready.';
    } catch {
      if (revision === viewRevision) switchTo2D('3D could not open on this device. The top-down replay is ready.');
    } finally {
      if (revision === viewRevision) {
        viewLoading = false;
        updateButtons();
      }
    }
  }

  function config() {
    if (!form.checkValidity()) {
      const disclosure = form.querySelector(':invalid')?.closest('details');
      if (disclosure) disclosure.open = true;
      form.reportValidity();
      throw Error(`Use a distance from ${Math.round(ROBOT_TASK_LIMITS.minDistance * 100)} to ${Math.round(ROBOT_TASK_LIMITS.maxDistance * 100)} cm and a whole-number starting layout.`);
    }
    return normalizeRobotTask({task: preset.value, distance: distance.valueAsNumber / 100,
      seed: seed.valueAsNumber, controller: controller.value});
  }

  function showFrame(next) {
    index = next;
    const frame = result.frames[next];
    const seconds = frame.time.toFixed(2);
    const gap = centimetres(frame.errorMeters);
    slider.value = String(next);
    slider.setAttribute('aria-valuetext', `${seconds} seconds, ${gap} from the goal`);
    $('frame').textContent = `${seconds} s · ${gap} from goal${frame.contact ? ' · Pusher touched the puck' : ''}`;
    if (preview3D) preview3D.showFrame(next);
    else drawFrame(canvas, result, next);
  }

  function pause() {
    cancelAnimationFrame(replay);
    replay = 0;
    playing = false;
    updateButtons();
  }

  function play() {
    if (!result || playing) return;
    const frames = result.frames;
    const last = frames.length - 1;
    if (index === last) showFrame(0);
    const ownResult = result, from = frames[index].time, start = performance.now();
    playing = true;
    updateButtons();
    function step(now) {
      if (!playing || result !== ownResult) return;
      const time = from + (now - start) / 1000;
      let next = index;
      while (next < last && frames[next + 1].time <= time + 0.00001) next++;
      if (next !== index) showFrame(next);
      if (next === last) pause();
      else replay = requestAnimationFrame(step);
    }
    replay = requestAnimationFrame(step);
  }

  function stopWorker() {
    clearTimeout(deadline);
    worker?.terminate();
    worker = null;
    updateButtons();
  }

  function invalidateExport() {
    exportRevision++;
    if (exportNote) exportNote.textContent = '';
    exportNote = null;
    $('export-status').textContent = '';
    updateButtons();
  }

  function clearResult() {
    pause();
    result = null;
    switchTo2D();
    $('result').hidden = true;
    invalidateExport();
  }

  function cancelDraft(message = '') {
    const pending = draft;
    draft = null;
    pending?.abort();
    $('ai-status').textContent = message;
    updateButtons();
  }

  function editedDraft() {
    cancelDraft(draft ? 'Draft cancelled. Send the updated brief when ready.' : '');
  }

  function settingsChanged() {
    editedDraft();
    const hadRun = Boolean(worker || result);
    stopWorker();
    clearResult();
    panel.querySelector('#robot-task-description').textContent = TASKS[preset.value].description;
    status(hadRun ? 'Settings changed. Run again to see a result for these settings.' : 'Ready to run this task.');
  }

  function applyInstruction({task, distance: suggestedDistance}) {
    const suggested = normalizeRobotTask({task, distance: suggestedDistance ?? ROBOT_TASK_DEFAULTS.distance});
    preset.value = suggested.task;
    if (suggestedDistance !== undefined) distance.value = String(Math.round(suggested.distance * 100));
    settingsChanged();
  }

  function complete(episode) {
    if (!episode?.frames?.length || typeof episode.modelXML !== 'string') throw Error('MuJoCo returned an incomplete run.');
    result = episode;
    const {score, engine, frames, config: chosen} = episode;
    $('outcome').textContent = score.success ? 'Goal reached' : 'Goal missed';
    $('outcome').dataset.outcome = score.success ? 'success' : 'miss';
    const contact = chosen.task === 'push' ? ` · Contact for ${score.contactSeconds.toFixed(2)} s` : '';
    const outcomeDetail = MISSES[score.reason];
    $('score').textContent = `Finished ${centimetres(score.finalErrorMeters)} from the goal · Closest ${centimetres(score.nearestErrorMeters)}${contact}${outcomeDetail ? '. ' + outcomeDetail : ''}`;
    $('key-puck').hidden = chosen.task !== 'push';
    $('engine').textContent = `${engine.name} ${engine.version} · ${frames.length} recorded samples · Practice simulation with a scripted controller.`;
    slider.max = String(frames.length - 1);
    $('result').hidden = false;
    showFrame(frames.length - 1);
    status('Run complete. Replay the motion or save the results below.');
  }

  function start(event) {
    event.preventDefault();
    if (worker || disposed) return;
    let chosen;
    try { chosen = config(); }
    catch (error) { status(error.message, true); return; }
    if (draft) cancelDraft('Draft cancelled when the simulation started.');
    clearResult();
    const id = ++runId;
    try {
      const active = new Worker(new URL('./robot-task-worker.mjs', import.meta.url), {type:'module', name:'robot-task-physics'});
      worker = active;
      updateButtons();
      status('Loading MuJoCo and running the task on this device…');
      active.onmessage = ({data}) => {
        if (worker !== active || data?.id !== id) return;
        stopWorker();
        if (data.type === 'error') {
          status(data.message || 'The simulation stopped. Review the task settings and try again.', true);
          return;
        }
        try { complete(data.episode); }
        catch (error) { clearResult(); status(error.message, true); }
      };
      active.onerror = event => {
        event.preventDefault();
        if (worker !== active) return;
        stopWorker();
        status('MuJoCo could not start. Check the connection to load its files, then try again.', true);
      };
      deadline = setTimeout(() => {
        if (worker !== active) return;
        stopWorker();
        status('The simulation took too long on this device. Try running it again.', true);
      }, RUN_TIMEOUT);
      active.postMessage({type:'run', id, config: chosen});
    } catch {
      stopWorker();
      status('The browser could not start the simulation. Reload this page and try again.', true);
    }
  }

  function removeReference(clearInput = true) {
    editedDraft();
    reference = null;
    if (clearInput) referenceInput.value = '';
    referenceVideo.pause();
    referenceVideo.removeAttribute('src');
    referenceVideo.load();
    referenceImage.removeAttribute('src');
    referenceImage.hidden = referenceVideo.hidden = true;
    $('reference-view').hidden = true;
    $('reference-name').textContent = '';
    if (referenceURL) URL.revokeObjectURL(referenceURL);
    referenceURL = '';
    invalidateExport();
  }

  on('form', 'submit', start);
  for (const control of [preset, distance, seed, controller]) control.addEventListener('input', settingsChanged, {signal: own.signal});
  on('stop', 'click', () => {
    stopWorker();
    status('Run stopped. You can change the settings or run again.');
    $('run').focus({preventScroll: true});
  });
  on('timeline', 'input', () => {
    pause();
    if (result) showFrame(Number(slider.value));
  });
  on('play', 'click', play);
  on('pause', 'click', pause);
  on('2d', 'click', () => switchTo2D());
  on('3d', 'click', () => void switchTo3D());
  on('turn-left', 'click', () => preview3D?.rotate(-1));
  on('turn-right', 'click', () => preview3D?.rotate(1));
  on('zoom-in', 'click', () => preview3D?.zoom(-1));
  on('zoom-out', 'click', () => preview3D?.zoom(1));
  on('reset-view', 'click', () => preview3D?.resetView());
  on('brief', 'input', () => {
    editedDraft();
    $('brief-status').textContent = '';
    invalidateExport();
  });
  on('use-words', 'click', () => {
    try {
      applyInstruction(parseTaskInstruction(brief.value));
      $('brief-status').textContent = 'Settings filled in. Review them above, then choose Try this task.';
      preset.focus({preventScroll: true});
    } catch (error) { $('brief-status').textContent = error.message; }
  });
  on('reference', 'change', () => {
    const file = referenceInput.files[0];
    if (!file) return;
    try { referencePath(file); }
    catch (error) {
      editedDraft();
      referenceInput.value = '';
      $('reference-status').textContent = `${error.message}${reference ? ' Kept your previous reference.' : ''}`;
      return;
    }
    removeReference(false);
    reference = file;
    referenceURL = URL.createObjectURL(file);
    const media = file.type.startsWith('image/') ? referenceImage : referenceVideo;
    media.hidden = false;
    media.src = referenceURL;
    $('reference-view').hidden = false;
    $('reference-name').textContent = file.name;
    $('reference-status').textContent = 'Reference attached locally.';
  });
  for (const media of [referenceImage, referenceVideo]) media.addEventListener('error', () => {
    if (reference && media.getAttribute('src') === referenceURL) {
      media.hidden = true;
      $('reference-status').textContent = 'This browser could not show a preview. The original file can still be included in the task folder.';
    }
  }, {signal: own.signal});
  on('remove-reference', 'click', () => {
    removeReference();
    $('reference-status').textContent = 'Reference removed.';
    referenceInput.focus({preventScroll:true});
  });
  on('ai-draft', 'click', async () => {
    if (!draftWithGemini || draft) return;
    const text = brief.value.trim();
    if (!text && !reference) {
      $('ai-status').textContent = 'Write a brief or choose a small reference first.';
      return;
    }
    if (reference?.size > GEMINI_REFERENCE_LIMIT) {
      $('ai-status').textContent = 'For Gemini, choose a reference up to 2 MiB or remove the reference.';
      return;
    }
    const request = new AbortController();
    draft = request;
    $('ai-status').textContent = 'Waiting for Gemini to draft the task…';
    updateButtons();
    try {
      const instruction = await draftWithGemini({brief:text, reference, signal:request.signal});
      if (disposed || draft !== request) return;
      draft = null;
      applyInstruction(instruction);
      $('ai-status').textContent = 'Draft ready. Check the task and distance above before running.';
      preset.focus({preventScroll:true});
    } catch (error) {
      if (!disposed && (draft === request || !draft && !request.signal.aborted)) {
        draft = null;
        $('ai-status').textContent = error.message || 'Gemini could not draft this task.';
        updateButtons();
      }
    }
  });
  on('mjcf', 'click', () => {
    if (result) download(new Blob([result.modelXML], {type:'application/xml'}), 'scene.xml');
  });
  on('recording', 'click', () => {
    if (!result) return;
    const {modelXML, ...episode} = result;
    download(new Blob([JSON.stringify(episode, null, 2) + '\n'], {type:'application/json'}), 'episode.json');
  });
  async function saveWorkspace(includeRun) {
    if (exportNote || (includeRun && !result)) return;
    const note = $(includeRun ? 'export-status' : 'brief-status');
    if (!includeRun && !brief.value.trim() && !reference) {
      note.textContent = 'Write a brief or choose a reference first.';
      return;
    }
    const revision = ++exportRevision;
    exportNote = note;
    updateButtons();
    note.textContent = 'Preparing the local task folder…';
    try {
      const archive = await exportTaskWorkspace({brief: brief.value, reference, result:includeRun ? result : null});
      if (disposed || revision !== exportRevision) return;
      download(archive, includeRun ? 'brainsnn-robot-task.zip' : 'brainsnn-robot-task-brief.zip');
      note.textContent = 'Task folder saved. Unzip it and open the folder in Antigravity.';
    } catch (error) {
      if (!disposed && revision === exportRevision) note.textContent = error.message;
    } finally {
      if (revision === exportRevision) {
        exportNote = null;
        updateButtons();
      }
    }
  }
  on('save-brief', 'click', () => void saveWorkspace(false));
  on('workspace', 'click', () => void saveWorkspace(true));

  function suspend() {
    if (disposed) return;
    pause();
    switchTo2D();
    referenceVideo.pause();
    film.pause();
    kitchen.suspend();
    if (draft) cancelDraft('Draft cancelled when you left this tool.');
    if (worker) {
      stopWorker();
      status('Run stopped when you left this tool. Run again when ready.');
    }
  }

  function clear() {
    if (disposed) return;
    suspend();
    example.open = false;
    kitchen.clear();
    if (film.readyState) film.currentTime = 0;
    form.reset();
    removeReference();
    $('brief-status').textContent = $('reference-status').textContent = '';
    settingsChanged();
    status('Task reset. Choose a task when ready.');
  }

  on('reset', 'click', () => { clear(); preset.focus({preventScroll:true}); });
  const dimensions = new ResizeObserver(() => { if (result) drawFrame(canvas, result, index); });
  dimensions.observe(canvas);
  updateButtons();
  if (!draftWithGemini) $('ai-status').textContent = 'Gemini drafting needs a connected BrainSNN owner account.';
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); }, {signal: own.signal});
  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
    dimensions.disconnect();
    own.abort();
    signal?.removeEventListener('abort', dispose);
  }
  if (signal?.aborted) dispose();
  else signal?.addEventListener('abort', dispose, {once:true});
  return {suspend, clear, dispose};
}
