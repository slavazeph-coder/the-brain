import {MAX_OPEN4DGS_METADATA_BYTES, createOpen4DGSSequence, openOpen4DGSTrigs, parseOpen4DGSMetadata} from './open4dgs-data.mjs';
import {createOpen4DGSPlayer} from './open4dgs-player.mjs';
import {mountOpen4DCapture} from './open4d-capture.mjs';

const EXAMPLE_FRAMES = 16;
const EXAMPLE_FOLDER = new URL('./examples/open4dgs/', import.meta.url);
const METADATA_FILE = 'export_meta.json';
const EXAMPLE_FRAME_LIMIT = 128 * 1024;
const FRAME_NAMES = Array.from({length: EXAMPLE_FRAMES}, (_, frame) => `frame_${String(frame).padStart(6, '0')}.ply`);

export const open4dgsPanel = `<section id="layer-panel-open4dgs" role="tabpanel" aria-labelledby="layer-tab-open4dgs" hidden>
  <p>Play a moving 3D scene and look at it from another side. Try the studio example or open your own Open4DGS export.</p>
  <div class="layer-input-row">
    <label>Moving scene files
      <input type="file" multiple accept=".trigsbin,.json,.ply" data-open4dgs-files aria-describedby="open4dgs-import-help">
    </label>
  </div>
  <p id="open4dgs-import-help" class="layer-note">Choose a single-clip .trigsbin file, or select export_meta.json and its numbered PLY frames together. Your files stay on this device. <a href="https://github.com/slavazeph-coder/the-brain/tree/main/scripts/world-open4dgs#open-a-large-scene" target="_blank" rel="noopener">Help with large scenes</a></p>
  <div class="layer-toolbar">
    <button type="button" data-open4dgs-import disabled>Open my scene</button>
    <button type="button" class="primary" data-open4dgs-example>Try a moving example</button>
    <button type="button" data-open4dgs-clear hidden>Clear scene</button>
  </div>
  <p data-open4dgs-status class="layer-note open4dgs-status" role="status">Choose an example or open your own scene.</p>
  <section data-open4dgs-result aria-label="Moving scene preview" hidden>
    <div class="layer-stage open4dgs-stage">
      <canvas data-open4dgs-canvas tabindex="0" role="img" aria-label="Moving 3D scene. Drag or use the turn buttons to look around."></canvas>
      <canvas data-open4dgs-fallback tabindex="0" role="img" aria-label="Moving scene point preview. Use the turn buttons to look around." hidden></canvas>
    </div>
    <label>Scene timeline
      <input type="range" min="0" max="0" value="0" data-open4dgs-seek disabled>
    </label>
    <p data-open4dgs-frame class="layer-note open4dgs-frame">Open a scene to see its frames.</p>
    <div class="layer-toolbar" role="group" aria-label="Playback">
      <button type="button" data-open4dgs-play disabled>Play</button>
      <button type="button" data-open4dgs-pause disabled>Pause</button>
    </div>
    <div class="layer-toolbar" role="group" aria-label="Look around the scene">
      <button type="button" data-open4dgs-turn="left">Turn left</button>
      <button type="button" data-open4dgs-turn="right">Turn right</button>
      <button type="button" data-open4dgs-turn="up">Look up</button>
      <button type="button" data-open4dgs-turn="down">Look down</button>
      <button type="button" data-open4dgs-reset>Reset view</button>
    </div>
    <details>
      <summary>Source and preview details</summary>
      <p data-open4dgs-source class="layer-note open4dgs-source"></p>
      <p class="layer-note">The preview shows basic splat colours. It is for looking around and does not provide measurements or robot obstacles.</p>
    </details>
  </section>
  <div data-open4d-capture></div>
</section>`;

function decodeMetadata(bytes) {
  return parseOpen4DGSMetadata(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

async function metadataDigest(bytes) {
  if (!globalThis.crypto?.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function fetchExampleFile(name, limit, signal) {
  const response = await fetch(new URL(name, EXAMPLE_FOLDER), {signal, credentials: 'same-origin', redirect: 'error'});
  if (!response.ok || !response.body) throw Error('The example could not be opened. Check your connection and try again.');
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

async function loadFiles(files, authored = false) {
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.trigsbin')) {
    return {sequence: await openOpen4DGSTrigs(files[0]), sourceName: files[0].name, format: 'Open4DGS TRiGS runtime binary'};
  }
  const metadata = files.filter(file => file.name === METADATA_FILE);
  if (metadata.length !== 1) throw Error('Choose one export_meta.json and its numbered PLY frames, or one .trigsbin file.');
  const [manifest] = metadata;
  if (!manifest.size || manifest.size > MAX_OPEN4DGS_METADATA_BYTES) throw Error('The export_meta.json file must be between 1 byte and 128 KiB.');
  const bytes = await manifest.arrayBuffer();
  const frames = files.filter(file => file !== manifest && file.name !== 'preview-provenance.json');
  const sequence = createOpen4DGSSequence(frames, decodeMetadata(bytes));
  return {sequence, sourceName: authored ? 'Rolling light in a studio' : METADATA_FILE,
    format: 'Open4DGS numbered Gaussian PLY frames', digest: await metadataDigest(bytes)};
}

export function mountOpen4DGSTool({root, signal}) {
  const panel = root.querySelector('#layer-panel-open4dgs');
  const $ = selector => panel.querySelector(selector);
  const on = (selector, type, callback) => $(selector).addEventListener(type, callback, {signal});
  const chooser = $('[data-open4dgs-files]');
  const importButton = $('[data-open4dgs-import]');
  const clearButton = $('[data-open4dgs-clear]');
  const result = $('[data-open4dgs-result]');
  const playButton = $('[data-open4dgs-play]');
  const pauseButton = $('[data-open4dgs-pause]');
  const seek = $('[data-open4dgs-seek]');
  const frameLabel = $('[data-open4dgs-frame]');
  const status = $('[data-open4dgs-status]');
  const source = $('[data-open4dgs-source]');
  const turns = new Map([['left', [0.32, 0]], ['right', [-0.32, 0]], ['up', [0, 0.18]], ['down', [0, -0.18]]]);
  const capture = mountOpen4DCapture($('[data-open4d-capture]'));
  let player = null;
  let scene = null;
  let loading = null;
  let revision = 0;

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('open4dgs-error', error);
  }

  function transport(playing = player?.playing ?? false) {
    const ready = Boolean(scene) && !loading;
    playButton.disabled = !ready || playing;
    pauseButton.disabled = !ready || !playing;
    seek.disabled = !ready;
  }

  function markFrame(frame) {
    if (!scene) return;
    seek.value = String(frame.index);
    const label = `Frame ${frame.index + 1} of ${scene.sequence.frameCount} · ${frame.timeSeconds.toFixed(2)} s`;
    const detail = frame.visible === 0 ? ' · no visible splats' : frame.sampled ? ' · sampled preview' : '';
    frameLabel.textContent = label + detail;
    seek.setAttribute('aria-valuetext', label);
  }

  function getPlayer() {
    player ??= createOpen4DGSPlayer($('[data-open4dgs-canvas]'), {
      fallbackCanvas: $('[data-open4dgs-fallback]'),
      onFrame: markFrame,
      onStatus: text => message(text),
      onPlaybackChange: transport,
    });
    return player;
  }

  function clearView() {
    player?.clear();
    scene = null;
    result.hidden = true;
    source.textContent = '';
    frameLabel.textContent = 'Open a scene to see its frames.';
    seek.value = '0';
    seek.max = '0';
    seek.removeAttribute('aria-valuetext');
    transport(false);
  }

  function clear() {
    revision++;
    loading?.abort();
    loading = null;
    clearView();
    chooser.value = '';
    importButton.disabled = true;
    clearButton.hidden = true;
    message('Scene cleared. Choose an example or open your own scene.');
  }

  async function open(subject, makeSource) {
    const request = ++revision;
    loading?.abort();
    const controller = new AbortController();
    loading = controller;
    clearView();
    clearButton.hidden = false;
    message('Opening the scene on this device…');
    try {
      const input = await makeSource(controller.signal);
      if (request !== revision || signal.aborted) return;
      scene = input;
      result.hidden = false;
      seek.max = String(input.sequence.frameCount - 1);
      const version = input.sequence.formatVersion;
      const versionLabel = version == null ? '' : ` · version ${version}`;
      const digestLabel = input.digest ? ` · ${METADATA_FILE} SHA-256 ${input.digest}` : '';
      source.textContent = `${input.sourceName} · ${input.format}${versionLabel} · ${input.sequence.fps} frames per second${digestLabel}`;
      const viewer = getPlayer();
      const first = await viewer.open(input.sequence);
      if (request !== revision || signal.aborted) return;
      if (!first) throw Error('The first frame could not be opened. Try the scene again.');
      const fallback = viewer.renderMode === 'projected-points' ? ' · projected point preview' : '';
      message(`${subject} · ${input.sequence.frameCount} frames${fallback}. Press Play or move the timeline.`);
    } catch (error) {
      if (request !== revision || signal.aborted) return;
      clearView();
      message(error.message || 'This scene could not be opened.', true);
    } finally {
      controller.abort();
      if (request === revision) {
        loading = null;
        transport();
      }
    }
  }

  on('[data-open4dgs-files]', 'change', () => {
    importButton.disabled = !chooser.files.length;
    clearButton.hidden = !chooser.files.length && !scene && !loading;
  });
  on('[data-open4dgs-import]', 'click', () => {
    const files = Array.from(chooser.files);
    if (files.length) void open('Local scene opened', () => loadFiles(files));
  });
  on('[data-open4dgs-example]', 'click', () => {
    chooser.value = '';
    importButton.disabled = true;
    void open('Rolling light in a studio', async requestSignal => {
      const manifest = await fetchExampleFile(METADATA_FILE, MAX_OPEN4DGS_METADATA_BYTES, requestSignal);
      const frames = await Promise.all(FRAME_NAMES.map(name => fetchExampleFile(name, EXAMPLE_FRAME_LIMIT, requestSignal)));
      return loadFiles([manifest, ...frames], true);
    });
  });
  on('[data-open4dgs-clear]', 'click', () => {
    clear();
    chooser.focus();
  });
  on('[data-open4dgs-play]', 'click', () => player?.play());
  on('[data-open4dgs-pause]', 'click', () => player?.pause());
  on('[data-open4dgs-seek]', 'input', () => {
    if (!player || !scene) return;
    player.pause();
    const request = revision;
    void player.seek(Number(seek.value)).catch(error => {
      if (request === revision && !signal.aborted) message(error.message || 'That frame could not be opened.', true);
    });
  });
  on('[data-open4dgs-reset]', 'click', () => player?.resetView());
  for (const button of panel.querySelectorAll('[data-open4dgs-turn]')) {
    button.addEventListener('click', () => player?.orbit(...turns.get(button.dataset.open4dgsTurn)), {signal});
  }
  signal.addEventListener('abort', () => {
    revision++;
    loading?.abort();
    player?.dispose();
    capture?.dispose?.();
  }, {once: true});
  return {
    pause() {
      if (player?.playing) player.pause();
      capture?.pause?.();
    },
    clearSession() {
      clear();
      capture?.clear?.();
    },
  };
}
