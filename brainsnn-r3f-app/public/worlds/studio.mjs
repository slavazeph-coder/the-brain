import { MODEL, MAX_FILE_BYTES, STRIDE, validateFile, manifest, fromDepth, toSplat, parseSplat, parsePLY, demoScene } from './geometry.mjs';
import { createViewer } from './viewer.mjs';
const icon = (name, size = 20) => {
  const paths = { upload:'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5', box:'m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9v9M3 8l9 4 9-4', camera:'M4 6h4l2-3h4l2 3h4v14H4V6Zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8', arrow:'M4 12h16m-6-6 6 6-6 6', layers:'m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5', orbit:'M12 3a9 9 0 1 0 9 9M12 3v5m0-5 5 3M8 12h8m-4-4v8', reset:'M4 9a8 8 0 1 1 0 7M4 3v6h6', full:'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6', shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6', video:'M3 5h13v14H3V5Zm13 5 5-3v10l-5-3', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6', walk:'M10 4h4m-2 0v5m0 0-4 5m4-5 4 5m-4-5v7m0 0-3 5m3-5 4 5', close:'m6 6 12 12M6 18 18 6' };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.box}"/></svg>`;
};
const button = (action, title, label = '') => `<button type="button" data-action="${action}" class="ws-icon-button" aria-label="${title}" title="${title}">${icon(action)}${label}</button>`;
export function studioMarkup() { return `
<section class="ws-intro" aria-labelledby="worlds-title"><div class="ws-intro-copy"><p class="ws-eyebrow"><span class="ws-dot"></span> INTRODUCING BRAINSNN WORLDS <span class="ws-beta">BETA</span></p><h1 id="worlds-title">One photo.<br><span>A world you can enter.</span></h1><p>Turn a photo into an explorable 3D scene. Bring a walkthrough.<br class="ws-desktop"> Take the next step from seeing a space to testing a robot.</p><div class="ws-hero-actions"><button type="button" class="ws-primary" data-action="choose">Upload a photo ${icon('arrow',16)}</button><a href="#worlds-studio">Explore the example ${icon('box',15)}</a></div></div><div class="ws-intro-right"><span class="ws-chip">${icon('camera',16)} Your phone is the starting point</span><p>No scanning rig. No app to install.<br>A local depth preview, right in your browser.</p><a href="#worlds-studio">Start with a photo ${icon('arrow',16)}</a></div></section>
<section id="worlds-studio" class="ws-studio" aria-label="Interactive capture-to-world studio"><div class="ws-studio-header"><div class="ws-studio-name">${icon('box',18)} <strong>World Studio</strong><span class="ws-slash">/</span><span id="ws-project-label">Studio example</span></div><div class="ws-session"><span class="ws-dot"></span> LOCAL SESSION <button type="button" class="ws-quiet" data-action="evidence">Evidence ${icon('arrow',13)}</button></div></div>
<div class="ws-workspace"><aside class="ws-input-panel" aria-label="Capture and reconstruction controls"><div class="ws-panel-heading"><span class="ws-step">01</span><h2>Bring your world</h2></div><div class="ws-source-tabs" role="group" aria-label="Input type"><button type="button" data-mode="photo" aria-pressed="true">Photo</button><button type="button" data-mode="video" aria-pressed="false">Video</button><button type="button" data-mode="splat" aria-pressed="false">3D splat</button></div>
<label class="ws-drop" id="ws-drop"><input id="ws-file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo"><span class="ws-drop-icon">${icon('upload',26)}</span><strong id="ws-drop-title">Drop a photo here</strong><span id="ws-drop-formats">JPG, PNG, WebP · up to 64 MiB</span><span class="ws-browse">or browse files ${icon('arrow',13)}</span></label>
<div id="ws-source-preview" class="ws-source-preview" hidden></div><button class="ws-camera" type="button" data-action="camera">${icon('camera',16)} Use your phone camera</button><input id="ws-camera-file" type="file" accept="image/*" capture="environment" hidden>
<p id="ws-source-help" class="ws-help">A room, a workspace, a place worth exploring. Start with one clear photo.</p>
<div class="ws-divider"></div><div class="ws-panel-heading"><span class="ws-step">02</span><h2>Choose your engine</h2></div><label class="ws-field">Reconstruction engine<select id="ws-engine"><option value="local">On-device depth · no upload</option><option value="moge">MoGe 2 · private worker</option><option value="lyra2">Lyra 2 · licensed research worker</option></select></label><p class="ws-engine-note" id="ws-engine-note">Depth Anything V2 Small. Estimates the visible surface; does not invent the rest of the room.</p>
<button class="ws-primary" type="button" data-action="build" disabled>Build my world ${icon('arrow',17)}</button><button type="button" class="ws-cancel" data-action="cancel" hidden>Cancel processing</button><div id="ws-status" class="ws-status" role="status" aria-live="polite">Choose a photo, or explore the example.</div><p class="ws-private">${icon('shield',14)} Files stay local unless you approve a worker upload.</p>
<details class="ws-worker"><summary>Connect a private worker</summary><p>Operator connection only. Use a trusted HTTPS endpoint; the token stays in memory.</p><label class="ws-field">Worker URL<input id="ws-worker-url" type="url" placeholder="https://your-worker.example" autocomplete="off"></label><label class="ws-field">Access token<input id="ws-worker-token" type="password" autocomplete="off"></label><button class="ws-secondary" type="button" data-action="connect">Check connection</button><span id="ws-worker-state" role="status">Not connected</span></details></aside>
<div class="ws-view-column"><div class="ws-view-top"><div class="ws-view-tabs" role="group" aria-label="Scene layers"><button type="button" data-layer="world" aria-pressed="true">${icon('box',15)} World</button><button type="button" data-layer="depth" aria-pressed="false">Depth</button><button type="button" data-layer="points" aria-pressed="false">Points</button><button type="button" data-layer="source" aria-pressed="false">Source</button></div><span class="ws-renderer-badge">WEBGL 2</span></div>
<div class="ws-viewport" id="ws-viewport"><canvas id="ws-canvas" tabindex="0" aria-label="Interactive 3D Gaussian scene. Drag to orbit, pinch or scroll to zoom. WASD or arrow keys move the view."></canvas><img id="ws-source-image" class="ws-source-image" alt="Your original capture" hidden><div id="ws-empty" class="ws-empty" hidden></div><div class="ws-view-label"><span class="ws-view-dot"></span><span id="ws-provenance">AUTHORED EXAMPLE</span><small id="ws-scene-subtitle">An explorable scene, not a scan of a real site</small></div><div class="ws-view-controls">${button('orbit','Toggle slow camera orbit')}${button('walk','Move into the scene')}${button('reset','Reset camera')}${button('full','Toggle fullscreen')}</div><div class="ws-view-bottom"><span id="ws-view-hint">Drag to orbit <span>·</span> Scroll to explore</span><span class="ws-axis"><i>Y</i><b>└</b> X</span></div><div class="ws-loading" id="ws-loading" hidden><div class="ws-spinner"></div><strong>Building a new perspective</strong><span id="ws-loading-text">Preparing your image…</span></div>
<aside id="ws-evidence" class="ws-evidence" aria-label="World evidence" hidden><div><h3>What this world knows</h3><button type="button" data-action="evidence" aria-label="Close evidence">${icon('close',17)}</button></div><p id="ws-evidence-summary"></p><dl><dt>Source</dt><dd id="ws-evidence-source"></dd><dt>Geometry</dt><dd id="ws-evidence-engine"></dd><dt>Real dimensions</dt><dd>Not verified</dd><dt>Collision map</dt><dd>Not generated</dd></dl><label class="ws-field">Your review note<textarea id="ws-note" maxlength="1200" placeholder="Record a real measurement, an uncertain doorway, or a detail to recapture."></textarea></label><p>Notes are manual observations, not AI detections. Export them with the scene manifest.</p><button type="button" class="ws-secondary" data-action="manifest">Export evidence JSON</button></aside></div>
<div class="ws-view-footer"><div class="ws-point-count"><span id="ws-point-count">0</span> <small>displayed Gaussians</small></div><label class="ws-density">Splat size <input id="ws-size" type="range" min="0.4" max="1.6" step="0.05" value="1" aria-label="Splat display size"></label><button type="button" class="ws-export" data-action="export">Export .splat ${icon('arrow',15)}</button><button type="button" class="ws-quiet ws-snapshot" data-action="snapshot">Save view</button></div><div class="ws-scene-tray"><button type="button" class="ws-scene-card" data-action="demo"><span class="ws-scene-thumb">${icon('box',28)}</span><span><strong>Explore the studio</strong><small>Authored sample · interactive now</small></span><span class="ws-scene-arrow">↗</span></button><a class="ws-scene-card ws-robot-card" href="/arena/"><span class="ws-scene-thumb ws-robot-thumb">${icon('walk',28)}</span><span><strong>Put a robot to the test</strong><small>Reviewed maps & tasks in Arena</small></span><span class="ws-scene-arrow">↗</span></a></div></div></div>
<div class="ws-trust-bar"><span>${icon('eye',15)} Capture shows what was seen.</span><span>${icon('layers',15)} Depth estimates what is 3D.</span><span>${icon('shield',15)} Robot planning needs a reviewed map.</span></div></section>
<section class="ws-journey" aria-labelledby="ws-journey-title"><div class="ws-section-head"><div><p class="ws-eyebrow">FROM PIXELS TO POSSIBILITIES</p><h2 id="ws-journey-title">Don't just look at a space.<br>Find out what comes next.</h2></div><p>A visual world is the starting point.<br>Keep its evidence as you move toward robotics.</p></div><div class="ws-journey-grid"><article><span class="ws-card-number">01 / CAPTURE</span>${icon('camera',26)}<h3>Your camera.<br>Your starting point.</h3><p>Take a photo, pick a frame from a walkthrough, or import a Gaussian splat you already made.</p><span class="ws-tag">Browser workflow</span></article><article><span class="ws-card-number">02 / RECONSTRUCT</span>${icon('layers',26)}<h3>Give the photo<br>another dimension.</h3><p>Estimate depth on your device. Orbit the visible surface and inspect where a different viewpoint is needed.</p><span class="ws-tag">On-device model</span></article><article><span class="ws-card-number">03 / EXPAND</span>${icon('box',26)}<h3>Explore beyond<br>the original frame.</h3><p>Connect a qualified Lyra worker for generated views. Keep imagined geometry separate from captured evidence.</p><span class="ws-tag ws-tag-violet">Research / licence gated</span></article><article><span class="ws-card-number">04 / TEST</span>${icon('walk',26)}<h3>A world to see.<br>A map to test.</h3><p>Continue in Arena to review dimensions, draw obstacles and preview robot routes. No automatic safety claims.</p><a href="/arena/">Open robot Arena ${icon('arrow',16)}</a></article></div></section>
<section class="ws-engine-section" aria-labelledby="ws-engine-title"><div><p class="ws-eyebrow">A COMPOSABLE WORLD STACK</p><h2 id="ws-engine-title">The right engine.<br>Not a black box.</h2><p>Local preview first. More powerful tools when the task and evidence call for them.</p></div><div class="ws-engine-list"><details><summary><span><strong>Photo → depth splat</strong><small>Depth Anything V2 Small · Transformers.js</small></span><span class="ws-tag">Local</span></summary><p>A real relative-depth model runs in a Web Worker after permission to download its files. Browser speed and memory vary. The result is a depth-lifted Gaussian surface, not a complete measured room.</p><a href="https://huggingface.co/onnx-community/depth-anything-v2-small" target="_blank" rel="noopener noreferrer">Model & licence ↗</a></details><details><summary><span><strong>Image2Splat / Brush → Worlds</strong><small>Import uncompressed .ply and .splat outputs</small></span><span class="ws-tag">Compatible</span></summary><p>Bring completed Gaussian outputs into this viewer. Image2Splat's separate camera-controlled video and Brush training workflow is not silently run or billed here. Large scenes are sampled for this mobile preview; keep the original for full-quality tools.</p><a href="https://github.com/romanpillai/Image2Splat" target="_blank" rel="noopener noreferrer">Image2Splat project ↗</a></details><details><summary><span><strong>MoGe 2 → estimated geometry</strong><small>Optional private worker · explicit upload</small></span><span class="ws-tag ws-tag-violet">Worker</span></summary><p>The included worker adapter produces a Gaussian preview from estimated point maps. Estimated metric scale still needs physical verification. No GPU host is assumed to be connected.</p><a href="https://github.com/microsoft/MoGe" target="_blank" rel="noopener noreferrer">MoGe project ↗</a></details><details><summary><span><strong>NVIDIA Lyra 2 → generated world</strong><small>Camera-controlled video · Gaussian reconstruction</small></span><span class="ws-tag ws-tag-violet">Gated</span></summary><p>The adapter is disabled by default. Operator-qualified hardware, installed checkpoints and appropriate model-use rights are required. Lyra 2's model licence differs from its code licence. Generated views cannot verify unseen parts of a customer's site.</p><a href="https://github.com/nv-tlabs/lyra" target="_blank" rel="noopener noreferrer">Lyra project & model terms ↗</a></details></div></section>
<section class="ws-bottom-cta"><span class="ws-eyebrow">START WITH WHAT'S IN FRONT OF YOU</span><h2>The next world starts<br>with your camera.</h2><a href="#worlds-studio" class="ws-primary">Create a depth splat ${icon('arrow',18)}</a><a href="/arena/" class="ws-text-link">Keep exploring the robot Arena ↗</a></section>
<dialog id="ws-consent" class="ws-dialog"><form method="dialog"><button class="ws-dialog-close" value="cancel" aria-label="Close">${icon('close',18)}</button><span class="ws-eyebrow">BEFORE WE BUILD</span><h2 id="ws-consent-title">Keep the photo on your device.</h2><p id="ws-consent-body"></p><p class="ws-help">Single-image depth is inferred. Unseen surfaces and real-world scale are not verified.</p><div class="ws-dialog-actions"><button value="cancel" class="ws-secondary">Not now</button><button value="approve" class="ws-primary" id="ws-approve">Load model & build</button></div></form></dialog>`; }

export function mountStudio(root) {
  root.innerHTML = studioMarkup();
  const $ = id => root.querySelector('#' + id), action = name => root.querySelector('[data-action="' + name + '"]');
  let disposed = false, mode = 'photo', sourceFile = null, sourceURL = '', imagePixels = null, points = null, info = null, depthWorker = null, busy = false, epoch = 0, controller = null, remoteJob = '', connected = null, notes = '', currentVideo = null, selectedLayer = 'world';
  let viewer = null, viewerError = '', modelTimeout = 0;
  const handlers = [];
  const listen = (el, type, fn, options) => { el.addEventListener(type, fn, options); handlers.push(() => el.removeEventListener(type, fn, options)); };
  const say = (text, error = false) => { if (disposed) return; $('ws-status').textContent = text; $('ws-status').classList.toggle('ws-error', error); };
  const setBusy = value => { busy = value; action('build').disabled = value || !imagePixels || mode === 'splat'; action('cancel').hidden = !value; $('ws-loading').hidden = !value; $('ws-engine').disabled = value; };
  function refreshEvidence() {
    $('ws-evidence-summary').textContent = info?.provenance === 'authored-example' ? 'This is an authored example, not evidence of a real site or an AI reconstruction.' : info?.provenance === 'unverified-import' ? 'Imported appearance has unverified provenance and dimensions. This file is not a reviewed collision map.' : info?.provenance === 'generated' ? 'Generated views may contain invented geometry. Use them for exploration, not to verify the site.' : 'Colour comes from the input. Depth is inferred, not measured. There is no reviewed collision map.';
    $('ws-evidence-source').textContent = info?.source?.name || 'No capture'; $('ws-evidence-engine').textContent = info?.engine || 'None';
  }
  function updatePoints(next, nextInfo, photo = false) {
    points = next; info = nextInfo;
    if (viewer) viewer.setPoints(points, { photo });
    $('ws-point-count').textContent = (points.length / STRIDE).toLocaleString();
    $('ws-provenance').textContent = info.provenance === 'authored-example' ? 'AUTHORED EXAMPLE' : info.provenance === 'generated' ? 'GENERATED WORLD' : info.provenance === 'unverified-import' ? 'IMPORTED / UNVERIFIED' : 'INFERRED GEOMETRY';
    $('ws-project-label').textContent = info.source.name;
    $('ws-scene-subtitle').textContent = info.provenance === 'authored-example' ? 'An explorable scene, not a scan of a real site' : info.engine === 'external-import' ? 'Imported appearance · provenance and dimensions unverified' : 'Visual reconstruction · real dimensions not verified';
    action('export').disabled = false; refreshEvidence(); setLayer('world');
  }
  function demo() { cancel(); clearSource(); $('ws-note').value = ''; notes = ''; updatePoints(demoScene(), manifest({ name: 'Studio example', kind: 'authored' }, 'authored-demo')); say('Explore this authored sample. Upload your own photo to build a new world.'); }
  function setLayer(layer) {
    selectedLayer = layer; root.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layer === layer)));
    const showSource = layer === 'source' && !!sourceURL && mode !== 'video' && mode !== 'splat';
    $('ws-source-image').hidden = !showSource; $('ws-canvas').hidden = layer === 'source'; $('ws-empty').hidden = layer !== 'source' || showSource;
    if (layer === 'source' && !showSource) $('ws-empty').textContent = mode === 'video' ? 'Choose a video frame in the capture panel.' : 'This sample has no source photo. Add your own capture to compare views.';
    if (!viewer && layer !== 'source') { $('ws-empty').hidden = false; $('ws-empty').textContent = viewerError || 'This browser cannot display WebGL 2. Your source and evidence remain available.'; }
    if (viewer) viewer.setMode(layer === 'depth' ? 1 : layer === 'points' ? 2 : 0);
  }
  function clearSource() {
    if (sourceURL) URL.revokeObjectURL(sourceURL);
    sourceURL = ''; sourceFile = null; imagePixels = null; currentVideo?.pause(); currentVideo = null;
    $('ws-source-preview').replaceChildren(); $('ws-source-preview').hidden = true; $('ws-drop').hidden = false;
    $('ws-source-image').removeAttribute('src'); $('ws-file').value = ''; setBusy(false);
  }
  function changeMode(next) {
    cancel(); mode = next; clearSource(); root.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('ws-file').accept = mode === 'photo' ? 'image/jpeg,image/png,image/webp' : mode === 'video' ? 'video/mp4,video/quicktime,video/webm' : '.ply,.splat';
    $('ws-drop-title').textContent = mode === 'photo' ? 'Drop a photo here' : mode === 'video' ? 'Bring a walkthrough' : 'Import a Gaussian splat';
    $('ws-drop-formats').textContent = (mode === 'photo' ? 'JPG, PNG, WebP' : mode === 'video' ? 'MP4, MOV, WebM' : 'PLY or SPLAT') + ' · up to 64 MiB';
    $('ws-source-help').textContent = mode === 'video' ? 'Preview a frame locally. For full multi-view reconstruction, use the capture worker in Arena.' : mode === 'splat' ? 'Import Image2Splat, Brush or Lyra exports. This mobile viewer samples up to 100,000 Gaussians and uses DC colour.' : 'A room, a workspace, a place worth exploring. Start with one clear photo.';
    action('camera').hidden = mode !== 'photo'; setLayer('world'); say('Choose a ' + (mode === 'video' ? 'video' : mode === 'splat' ? 'Gaussian file' : 'photo') + '.');
  }
  async function pixelsFor(image) {
    const w = image.videoWidth || image.naturalWidth || image.width, h = image.videoHeight || image.naturalHeight || image.height;
    if (!w || !h || w * h > 64000000) throw Error('Image dimensions are unsupported. Resize to at most 64 megapixels.');
    const factor = Math.min(1, 768 / Math.max(w, h)), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(w * factor)); canvas.height = Math.max(1, Math.round(h * factor));
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, canvas };
  }
  async function acceptFile(file) {
    try { validateFile(file, mode); } catch (error) { say(error.message, true); return; }
    cancel(); clearSource(); notes = ''; $('ws-note').value = ''; const ticket = epoch; sourceFile = file;
    try {
      if (mode === 'splat') { const buffer = await file.arrayBuffer(); if (ticket !== epoch || disposed) return; const parsed = /\.ply$/i.test(file.name) ? parsePLY(buffer) : parseSplat(buffer); updatePoints(parsed.points, manifest({ name: file.name, bytes: file.size, kind: 'import' }, 'external-import', { originalPoints: parsed.total, sampled: parsed.sampled, provenance: 'unverified-import' })); say(parsed.sampled ? 'Imported a sampled preview. The full original file remains unchanged.' : 'Gaussian file loaded. Its real-world scale and provenance remain unverified.'); return; }
      sourceURL = URL.createObjectURL(file); $('ws-source-preview').hidden = false; $('ws-drop').hidden = true;
      const name = document.createElement('span'); name.className = 'ws-filename'; name.textContent = file.name;
      if (mode === 'video') {
        const video = document.createElement('video'); currentVideo = video; video.src = sourceURL; video.controls = true; video.playsInline = true; video.preload = 'metadata';
        const capture = document.createElement('button'); capture.type = 'button'; capture.className = 'ws-secondary'; capture.textContent = 'Use current frame';
        capture.onclick = async () => { try { if (busy) cancel(); if (video.readyState < 2) throw Error('Play or seek the video to load a frame first.'); imagePixels = await pixelsFor(video); imagePixels.timestamp = video.currentTime; setBusy(false); say('Frame at ' + video.currentTime.toFixed(2) + ' s selected. This is a single-frame depth preview.'); } catch (error) { say(error.message, true); } };
        video.onerror = () => say('This browser cannot decode the video. Export an H.264 MP4 and try again.', true);
        $('ws-source-preview').append(video, name, capture); say('Play or seek the video, then select a frame.');
      } else {
        const image = new Image(); image.alt = 'Selected source photo'; image.src = sourceURL;
        await image.decode(); if (ticket !== epoch || disposed) return;
        imagePixels = await pixelsFor(image); $('ws-source-preview').append(image, name); $('ws-source-image').src = sourceURL; setBusy(false); setLayer('source'); say('Photo ready. Build an inferred depth splat on your device.');
      }
    } catch (error) { if (ticket === epoch) { clearSource(); say(error.message || 'Could not read this capture.', true); } }
  }
  function save(name, blob) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; root.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  function exportManifest() { if (!info) return; save('brainsnn-world-evidence.json', new Blob([JSON.stringify({ ...info, displayedGaussians: points.length / STRIDE, notes: notes ? [{ author: 'user', text: notes, timestamp: imagePixels?.timestamp ?? null }] : [] }, null, 2)], { type: 'application/json' })); }
  function cancel() { clearTimeout(modelTimeout); modelTimeout = 0; epoch++; depthWorker?.terminate(); depthWorker = null; controller?.abort(); controller = null;
    if (remoteJob && connected) { fetch(connected.base + '/v1/worlds/' + encodeURIComponent(remoteJob), { method: 'DELETE', redirect: 'error', headers: { Authorization: 'Bearer ' + connected.token }, credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => {}); }
    remoteJob = ''; setBusy(false);
  }
  async function consent() {
    if (!imagePixels || busy) return;
    const engine = $('ws-engine').value;
    if (engine !== 'local' && (!connected || !connected.engines.some(e => e.id === engine && e.available))) { say('Connect a qualified worker that advertises this engine before uploading.', true); return; }
    $('ws-consent-title').textContent = engine === 'local' ? 'Keep the photo on your device.' : 'Send this capture to your worker?';
    $('ws-consent-body').textContent = engine === 'local' ? 'Load the open depth model and runtime from Hugging Face and jsDelivr. Your image is processed locally, not sent to a model API. Downloads and inference use device memory and may take time.' : 'Your selected image/frame will be sent to ' + connected.base + '. The worker uses your hardware. Lyra-generated content is not observed site evidence. No third-party paid generation API is called by this application.';
    $('ws-approve').textContent = engine === 'local' ? 'Load model & build' : 'Approve upload & build'; $('ws-consent').showModal();
  }
  async function build() {
    if (!imagePixels || busy) return; const capture = imagePixels, engine = $('ws-engine').value;
    cancel(); const ticket = epoch; setBusy(true); $('ws-loading-text').textContent = 'Preparing your image…';
    const source = { name: sourceFile.name, kind: mode === 'video' ? 'video-frame' : 'photo', bytes: sourceFile.size, timestamp: capture.timestamp ?? null, width: capture.width, height: capture.height };
    if (engine === 'local') {
      depthWorker = new Worker(new URL('./depth-worker.mjs', import.meta.url), { type: 'module' });
      const timeout = modelTimeout = setTimeout(() => { if (ticket === epoch && busy) { cancel(); say('Local inference timed out. Try a smaller image or a private worker.', true); } }, 240000);
      depthWorker.onmessage = ({ data }) => {
        if (disposed || ticket !== epoch) return;
        if (data.type === 'status') { say(data.text); $('ws-loading-text').textContent = data.text; }
        else if (data.type === 'error') { clearTimeout(timeout); cancel(); say('Depth model could not finish: ' + data.text, true); }
        else if (data.type === 'result') { clearTimeout(timeout); try { const reconstructed = fromDepth(capture.rgba, capture.width, capture.height, new Float32Array(data.depth), data.width, data.height); updatePoints(reconstructed, manifest(source, MODEL, { representation: 'depth-lifted-isotropic-gaussians', cameraFov: { value: 60, status: 'assumed' } }), true); say('Your depth splat is ready. Orbit gently; unseen areas have not been reconstructed.'); } catch (error) { say(error.message, true); } depthWorker?.terminate(); depthWorker = null; setBusy(false); }
      };
      depthWorker.onerror = e => { clearTimeout(timeout); if (ticket === epoch) { cancel(); say(e.message || 'Could not start the local model. Check your connection and browser support.', true); } };
      const copy = capture.rgba.slice(); depthWorker.postMessage({ type: 'infer', pixels: copy.buffer, width: capture.width, height: capture.height }, [copy.buffer]);
    } else {
      try {
        controller = new AbortController(); const body = await new Promise(resolve => capture.canvas.toBlob(resolve, 'image/png'));
        if (!body || ticket !== epoch) return;
        const job = await workerJSON('/v1/worlds?engine=' + encodeURIComponent(engine), { method: 'POST', headers: { 'Content-Type': 'image/png' }, body, signal: controller.signal });
        if (!/^[a-f0-9]{32}$/.test(job.id)) throw Error('The worker returned an invalid job ID.'); remoteJob = job.id;
        for (let tries = 0; tries < 900 && ticket === epoch && !disposed; tries++) {
          const result = await workerJSON('/v1/worlds/' + job.id, { signal: controller.signal });
          if (result.status === 'failed' || result.status === 'cancelled') throw Error(result.error || result.status);
          say(result.stage || result.status); $('ws-loading-text').textContent = result.stage || result.status;
          if (result.status === 'complete') {
            const response = await fetch(connected.base + '/v1/worlds/' + job.id + '/preview', { headers: { Authorization: 'Bearer ' + connected.token }, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
            if (!response.ok) throw Error('Could not fetch the worker preview.');
            const reader = response.body.getReader(), chunks = []; let size = 0;
            while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4 * 1024 * 1024) { await reader.cancel(); throw Error('Worker preview exceeds the safe browser limit.'); } chunks.push(value); }
            const parsed = parseSplat(await new Blob(chunks).arrayBuffer());
            if (ticket !== epoch || disposed) return;
            updatePoints(parsed.points, manifest(source, engine, { provenance: engine === 'lyra2' ? 'generated' : 'inferred', workerJob: job.id }), engine === 'moge'); remoteJob = ''; say('Worker result loaded. Review its evidence before using it beyond visual exploration.'); return;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (ticket === epoch) throw Error('Worker processing timed out. Check the operator logs.');
      } catch (error) { if (ticket === epoch && !disposed && error.name !== 'AbortError') { cancel(); say(error.message, true); } }
      finally { if (ticket === epoch && !disposed) setBusy(false); }
    }
  }
  async function workerJSON(path, options = {}) {
    if (!connected) throw Error('Worker not connected.');
    const response = await fetch(connected.base + path, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + connected.token }, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    if (!response.ok) throw Error('Worker request failed (' + response.status + ').');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw Error('Expected a JSON worker response.');
    const reader = response.body.getReader(), chunks = []; let count = 0; while (true) { const part = await reader.read(); if (part.done) break; count += part.value.byteLength; if (count > 65536) { await reader.cancel(); throw Error('Oversized worker response.'); } chunks.push(part.value); } return JSON.parse(await new Blob(chunks).text());
  }
  async function connect() {
    if (busy) { say('Cancel the current build before changing workers.', true); return; }
    try { const url = new URL($('ws-worker-url').value); if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw Error('Use HTTPS, or localhost for development. Do not put credentials in the URL.');
      const token = $('ws-worker-token').value.trim(); if (token.length < 32) throw Error('Use an operator token of at least 32 characters.');
      connected = { base: url.href.replace(/\/$/, ''), token, engines: [] }; $('ws-worker-state').textContent = 'Checking…';
      const data = await workerJSON('/v1/worlds/capabilities', { signal: AbortSignal.timeout(10000) });
      if (data.schema !== 'brainsnn.world-worker.v1' || !Array.isArray(data.engines)) throw Error('This is not a compatible Worlds worker.');
      connected.engines = data.engines; $('ws-worker-state').textContent = data.engines.filter(e => e.available).map(e => e.name || e.id).join(', ') || 'Connected; no qualified engine is enabled.';
      say('Worker checked. Upload still requires your approval.');
    } catch (error) { connected = null; $('ws-worker-state').textContent = 'Not connected'; say(error.message, true); }
  }
  try { viewer = createViewer($('ws-canvas'), text => say(text, true)); } catch (error) { viewerError = error.message; say(error.message, true); $('ws-empty').hidden = false; $('ws-empty').textContent = error.message; }
  listen(root, 'click', async event => {
    const modeButton = event.target.closest('[data-mode]'); if (modeButton) { changeMode(modeButton.dataset.mode); return; }
    const layerButton = event.target.closest('[data-layer]'); if (layerButton) { setLayer(layerButton.dataset.layer); return; }
    const b = event.target.closest('[data-action]'); if (!b) return;
    try { switch (b.dataset.action) {
      case 'build': await consent(); break; case 'cancel': cancel(); say('Processing cancelled. Your files remain local unless already uploaded.'); break;
      case 'choose': changeMode('photo'); $('ws-file').click(); break; case 'camera': $('ws-camera-file').click(); break; case 'demo': demo(); break; case 'connect': await connect(); break;
      case 'orbit': viewer?.orbit(); break; case 'reset': viewer?.reset(); break;
      case 'walk': { const walking = viewer?.walk(); $('ws-view-hint').textContent = walking ? 'WASD / arrow keys to move · visual exploration only' : 'Drag to orbit · scroll to explore'; $('ws-canvas').focus({ preventScroll: true }); break; }
      case 'full': if (document.fullscreenElement) await document.exitFullscreen(); else if ($('ws-viewport').requestFullscreen) await $('ws-viewport').requestFullscreen(); else say('Fullscreen is not available in this browser. Rotate your phone for a wider view.'); break;
      case 'export': if (points) { save('brainsnn-world.splat', new Blob([toSplat(points)], { type: 'application/octet-stream' })); say('Exported the displayed Gaussian preview. Export evidence JSON to keep provenance alongside it.'); } break;
      case 'manifest': exportManifest(); break;
      case 'snapshot': if (viewer) { const response = await fetch(viewer.snapshot()); save('brainsnn-world-view.png', await response.blob()); } break;
      case 'evidence': $('ws-evidence').hidden = !$('ws-evidence').hidden; refreshEvidence(); break;
    } } catch (error) { say(error.message, true); }
  });
  listen($('ws-file'), 'change', event => { if (event.target.files[0]) acceptFile(event.target.files[0]); });
  listen($('ws-camera-file'), 'change', event => { if (event.target.files[0]) { changeMode('photo'); acceptFile(event.target.files[0]); } });
  listen($('ws-drop'), 'dragover', event => { event.preventDefault(); $('ws-drop').classList.add('ws-drag'); });
  listen($('ws-drop'), 'dragleave', () => $('ws-drop').classList.remove('ws-drag'));
  listen($('ws-drop'), 'drop', event => { event.preventDefault(); $('ws-drop').classList.remove('ws-drag'); if (event.dataTransfer.files[0]) acceptFile(event.dataTransfer.files[0]); });
  listen($('ws-size'), 'input', event => viewer?.setSize(Number(event.target.value)));
  listen($('ws-note'), 'input', event => { notes = event.target.value; });
  listen($('ws-engine'), 'change', () => { $('ws-engine-note').textContent = $('ws-engine').value === 'local' ? 'Depth Anything V2 Small. Estimates the visible surface; does not invent the rest of the room.' : $('ws-engine').value === 'moge' ? 'Requires a private MoGe worker. Estimated geometry still needs real measurements.' : 'Requires qualified hardware and appropriate Lyra 2 model-use rights. Generated areas are not evidence.'; });
  listen($('ws-consent'), 'close', () => { if ($('ws-consent').returnValue === 'approve') build().catch(error => { cancel(); say(error.message, true); }); });
  listen(window, 'pagehide', () => cancel());
  demo();
  return () => { cancel(); disposed = true; clearSource(); viewer?.destroy(); handlers.forEach(fn => fn()); $('ws-consent')?.close(); root.replaceChildren(); connected = null; };
}
