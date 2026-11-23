import { createCameraPath, parseCameraPath, serializeCameraPath, sampleCameraPath } from './camera-path.mjs';
import { recordCameraTour } from './camera-tour-video.mjs';

/** Local appearance only. No path or imported file enters the scene compiler or planner. */
export function mountCameraTour({ root, getViewer }) {
  const $ = id => root.querySelector(`[data-tour-${id}]`);
  let source = null, transform = 'identity', placement = 'identity', translation = [0, 0, 0], frames = [], generation = 0, task = null, clip = null, lockedOrigin = null;
  let previewBlocked = false;
  const blockedHint = 'Turn off the preview lamp to preview or record a source-bound camera path.';
  const status = message => { $('status').textContent = message; };
  const provenance = () => lockedOrigin || $('provenance').value;
  const path = () => createCameraPath({ source, displayTransform: transform, sourcePlacement: placement, sourceTranslation: translation, provenance: provenance(), keyframes: frames });
  function controls() {
    const busy = !!task, ready = !!source;
    for (const id of ['add', 'undo', 'clear', 'import', 'provenance', 'interval']) $(id).disabled = !ready || busy;
    $('provenance').disabled ||= !!lockedOrigin;
    $('add').disabled ||= frames.length >= 32;
    $('undo').disabled ||= !frames.length;
    $('clear').disabled ||= !frames.length;
    for (const id of ['play', 'export', 'video']) $(id).disabled = !ready || frames.length < 2 || busy;
    $('play').disabled ||= previewBlocked;
    $('video').disabled ||= previewBlocked;
    for (const id of ['save-video', 'save-receipt']) $(id).disabled = !clip || busy;
    $('stop').disabled = !busy;
    $('frames').textContent = frames.length ? frames.map((f, i) => `${i + 1}: ${f.time.toFixed(1)} s`).join(' · ') : 'No camera views saved.';
  }
  function unlock() {
    const canvas = getViewer()?.getCanvas();
    if (canvas) { canvas.style.pointerEvents = ''; canvas.removeAttribute('aria-busy'); }
  }
  function stop() {
    generation++;
    if (task) { task.abort(); task = null; }
    unlock(); controls();
  }
  function begin() {
    stop();
    task = new AbortController();
    const canvas = getViewer()?.getCanvas();
    if (canvas) { canvas.style.pointerEvents = 'none'; canvas.setAttribute('aria-busy', 'true'); canvas.blur(); }
    controls();
    return { controller: task, token: generation };
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function clearViews(message) { generation++; frames = []; clip = null; controls(); status(message); }
  $('add').onclick = () => {
    try {
      const interval = Number($('interval').value);
      if (!Number.isFinite(interval) || interval < 0.5 || interval > 15) throw Error('Choose 0.5 to 15 seconds between views.');
      const next = [...frames, { time: frames.length ? frames.at(-1).time + interval : 0, ...getViewer().getView() }];
      const checked = createCameraPath({ source, displayTransform: transform, sourcePlacement: placement, sourceTranslation: translation, provenance: provenance(), keyframes: next });
      generation++; frames = checked.keyframes; clip = null;
      controls(); status('View saved. Preview the full move for clipping and unknown areas.');
    } catch (error) { status(error.message); }
  };
  $('undo').onclick = () => { generation++; frames.pop(); clip = null; controls(); status('Last view removed.'); };
  $('clear').onclick = () => clearViews('Camera views cleared.');
  $('provenance').onchange = () => clearViews('Origin changed. Save new views with this declared origin.');
  $('export').onclick = () => {
    try { download(new Blob([serializeCameraPath(path())], { type: 'application/json' }), 'appearance-camera-path.json'); status('Source-bound camera path downloaded. The asset is not embedded.'); }
    catch (error) { status(error.message); }
  };
  $('import').onchange = async () => {
    const file = $('import').files[0], token = ++generation;
    $('import').value = '';
    if (!file) return;
    try {
      if (!file.size || file.size > 128 * 1024) throw Error('Use a camera-path JSON file up to 128 KiB.');
      const text = await file.text();
      if (token !== generation || !source) return;
      const checked = parseCameraPath(text, { source, displayTransform: transform, sourcePlacement: placement, sourceTranslation: translation });
      if (lockedOrigin && checked.provenance !== lockedOrigin) throw Error('This derived object variant must retain its authored origin.');
      frames = checked.keyframes; clip = null; $('provenance').value = checked.provenance;
      controls(); status('Matching source and display transform verified. Declared origin is not independently verified.');
    } catch (error) { if (token === generation) status(`Path rejected: ${error.message}`); }
  };
  $('play').onclick = () => {
    if (previewBlocked) { status(blockedHint); return; }
    let checked;
    try { checked = path(); } catch (error) { status(error.message); return; }
    const { controller, token } = begin(), start = performance.now(), duration = checked.keyframes.at(-1).time;
    let raf = 0;
    controller.signal.addEventListener('abort', () => cancelAnimationFrame(raf), { once: true });
    const frame = now => {
      if (controller.signal.aborted || token !== generation) return;
      try {
        const time = Math.min(duration, (now - start) / 1000);
        getViewer().setView(sampleCameraPath(checked, time));
        status(`Preview ${time.toFixed(1)} / ${duration.toFixed(1)} s. Appearance only; path collisions unchecked.`);
        if (time < duration) raf = requestAnimationFrame(frame);
        else { task = null; unlock(); controls(); status('Preview complete. No collision or physical validation was performed.'); }
      } catch (error) { stop(); status(`Preview stopped: ${error.message}`); }
    };
    raf = requestAnimationFrame(frame);
  };
  $('video').onclick = async () => {
    if (previewBlocked) { status(blockedHint); return; }
    let checked;
    try { checked = path(); } catch (error) { status(error.message); return; }
    const { controller, token } = begin();
    try {
      const result = await recordCameraTour({ path: checked, viewer: getViewer(), signal: controller.signal,
        onProgress: fraction => { if (token === generation) status(`Recording ${(fraction * checked.duration).toFixed(1)} s. Keep this tab visible.`); } });
      if (controller.signal.aborted || token !== generation) return;
      const hash = await crypto.subtle.digest('SHA-256', await result.blob.arrayBuffer());
      if (controller.signal.aborted || token !== generation) return;
      const receipt = { ...result.receipt, displaySettings: { pointSize: document.getElementById('point-size')?.value,
        surfaceMode: document.getElementById('surface-mode')?.value, stripeFrequency: document.getElementById('stripe-frequency')?.value }, video: { bytes: result.blob.size, type: result.type,
        sha256: Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('') } };
      clip = { blob: result.blob, type: result.type, receipt };
      status('Recording ready. Use Download video and Download receipt. Local rendering only; no new views were generated.');
    } catch (error) { if (token === generation) status(`Recording stopped: ${error.message}`); }
    finally { if (token === generation) { task = null; unlock(); controls(); } }
  };
  $('save-video').onclick = () => { if (clip) download(clip.blob, `appearance-tour.${clip.type.includes('mp4') ? 'mp4' : 'webm'}`); };
  $('save-receipt').onclick = () => { if (clip) download(new Blob([JSON.stringify(clip.receipt, null, 2) + '\n'], { type: 'application/json' }), 'appearance-tour-receipt.json'); };
  $('stop').onclick = () => { stop(); status('Preview or recording cancelled. No partial video exported.'); };
  function suspend() {
    if (!task) return;
    stop();
    status(clip ? 'Tour stopped. Your completed video and receipt are ready to download.' : 'Tour stopped. Preview or record again when ready.');
  }
  function hidden() { if (document.hidden) suspend(); }
  document.addEventListener('visibilitychange', hidden);
  controls();
  return {
    suspend,
    setPreviewBlocked(value) {
      const blocked = Boolean(value);
      if (blocked === previewBlocked) return;
      previewBlocked = blocked;
      if (blocked) {
        if (task) stop();
        else controls();
        if (source) status(blockedHint);
      } else {
        controls();
        if ($('status').textContent === blockedHint) {
          status(clip ? 'Preview lamp off. Your completed video and receipt are ready to download.' : 'Preview lamp off. Your saved camera views are available.');
        }
      }
    },
    setSource(value, displayTransform = 'identity', sourcePlacement = 'identity', sourceTranslation = [0, 0, 0], declaredOrigin = 'unknown') {
      stop(); source = value ? { ...value } : null; transform = displayTransform; placement = sourcePlacement; translation = sourceTranslation.slice();
      lockedOrigin = source && declaredOrigin === 'authored' ? 'authored' : null;
      $('provenance').value = ['unknown', 'camera-reconstruction', 'generated', 'authored'].includes(declaredOrigin) ? declaredOrigin : 'unknown'; clearViews(source ? lockedOrigin ? 'Authored object variant. Save two or more views; its origin stays authored.' : 'Choose the asset origin, then save two or more views.' : 'Open a local asset to author a camera path.');
    },
    invalidate(displayTransform) { stop(); transform = displayTransform; clearViews('Display axis changed. Save new camera views for this orientation.'); },
    cancel() { const hadClip = !!clip; stop(); clip = null; controls(); if (hadClip) status('View settings changed. Record a new video for this presentation.'); },
    destroy() { stop(); clip = null; document.removeEventListener('visibilitychange', hidden); },
  };
}
