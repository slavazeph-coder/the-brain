// BrainSNN Walk: list → walk → results. Everything stays in this browser
// until the person exports, shares, or hands the video to World Builder.
import {
  FEATURE_TYPES, LIMITS, bundleEntries, createTrackMeter, defaultWalkName, featureType, formatDuration, formatMetres, isFix,
  makeFeature, measureBetween, pinWalk, placeFeatures, positionStatement, readBundle, readMark, summarizeTrack, toCSV, toGPX, toGeoJSON,
} from './walk-core.mjs';
import { unzip, zipParts } from './walk-zip.mjs';
import { askToKeepWalks, createWalkStore } from './walk-store.mjs';
import { drawWalkMap, zoomAbout } from './walk-map.mjs';
import { buildGeoPackage, loadSqlJs, looksLikeGeoPackage, readGeoPackage } from './walk-gpkg.mjs';
import { HANDOFF_MAX_BYTES, stageLocalCapture } from '../world/capture-handoff.mjs';

const $ = id => document.getElementById(id);
const store = createWalkStore();
const SCREENS = ['list', 'capture', 'results'];
const objectUrls = new Set();
let capture = null;
let current = null;
let view = freshView();
let mapApi = null;
let installEvent = null;

function freshView() { return { showTrack: true, showFeatures: true, showError: false, selectedId: null, measuring: false, measure: [], zoom: 1, panX: 0, panY: 0 }; }
function say(id, message = '', error = false) { const node = $(id); node.textContent = message; node.classList.toggle('error', !!error); }
function url(blob) { const href = URL.createObjectURL(blob); objectUrls.add(href); return href; }
function releaseUrls() { for (const href of objectUrls) URL.revokeObjectURL(href); objectUrls.clear(); }
const slug = name => (name || 'walk').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40) || 'walk';
const newId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /(x|s|ch|sh)$/u.test(word) ? 'es' : 's'}`;

function show(name) {
  for (const screen of SCREENS) $(`screen-${screen}`).hidden = screen !== name;
  document.body.dataset.screen = name;
  window.scrollTo(0, 0);
  $(`${name === 'list' ? 'list' : name === 'capture' ? 'capture' : 'walk'}-title`).focus({ preventScroll: true });
}

// ---------- list ----------

async function renderList() {
  let walks = [];
  try { walks = await store.list(); } catch (error) { say('list-status', error.message, true); }
  for (const walk of walks) {
    if (walk.state === 'recording' && walk.id !== capture?.walk.id) {
      // The page closed mid-walk. Keep what was saved; the video was only in memory.
      walk.state = 'interrupted';
      walk.endedAt = Math.max(walk.startedAt, ...walk.fixes.map(f => f.t), ...walk.features.map(f => f.t));
      walk.features = placeFeatures(walk.features, walk.fixes);
      try { await store.put(walk); } catch {}
    }
  }
  $('walk-list').replaceChildren(...walks.filter(walk => walk.state !== 'recording').map(walk => {
    const summary = summarizeTrack(walk.fixes, walk);
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'walk-card'; button.dataset.walk = walk.id;
    const name = document.createElement('span'); name.className = 'walk-name'; name.textContent = walk.name;
    const meta = document.createElement('span'); meta.className = 'walk-meta';
    const date = new Date(walk.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    meta.textContent = [date, formatMetres(summary.lengthMetres), plural(walk.features.length, 'feature'),
      summary.map.metres === null ? 'no GPS figure' : `±${formatMetres(summary.map.metres)}`].join(' · ');
    button.append(name, meta);
    if (walk.state === 'interrupted') { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'Interrupted · no video'; button.append(tag); }
    li.append(button);
    return li;
  }));
  $('list-empty').hidden = walks.length > 0;
}

// ---------- capture ----------

const pickMime = () => globalThis.MediaRecorder && ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  .find(type => MediaRecorder.isTypeSupported?.(type));

function renderDrops() {
  $('drops').replaceChildren(...FEATURE_TYPES.map((type, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'drop'; button.dataset.type = type.id;
    button.style.setProperty('--type', type.colour);
    button.innerHTML = `<span class="drop-key" aria-hidden="true">${index + 1}</span><span class="drop-label"></span>`;
    button.querySelector('.drop-label').textContent = type.label;
    button.setAttribute('aria-label', `Drop ${type.label} here`);
    return button;
  }));
}

function renderHud() {
  if (!capture) return;
  const { walk, meter, lastFix } = capture;
  $('hud-time').textContent = formatDuration((Date.now() - walk.startedAt) / 1000);
  $('hud-dist').textContent = formatMetres(meter.lengthMetres);
  $('hud-count').textContent = String(walk.features.length);
  const gps = $('hud-gps');
  const fresh = lastFix && Date.now() - lastFix.receivedAt <= 10000;
  gps.textContent = fresh ? `±${Math.round(lastFix.acc)} m` : capture.gpsDenied ? 'Off' : 'Waiting';
  gps.className = `hud-value ${!fresh ? 'gps-none' : lastFix.acc <= 10 ? 'gps-good' : lastFix.acc <= 30 ? 'gps-fair' : 'gps-poor'}`;
  $('rec').hidden = !(capture.recorder && capture.recorder.state === 'recording');
}

function onFix(position) {
  if (!capture) return;
  const now = Date.now();
  const stamp = Number.isFinite(position.timestamp) && Math.abs(position.timestamp - now) < 60000 ? position.timestamp : now;
  const c = position.coords;
  const fix = { t: stamp, lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: Number.isFinite(c.altitude) ? c.altitude : null, altAcc: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null };
  if (!isFix(fix) || capture.walk.fixes.at(-1)?.t === fix.t) return;
  if (capture.walk.fixes.length >= LIMITS.fixes) { say('cap-status', 'This walk has the most GPS fixes one walk can hold. Finish it and start another.', true); return; }
  capture.walk.fixes.push(fix);
  capture.meter.add(fix);
  capture.lastFix = { ...fix, receivedAt: now };
  renderHud();
}

function onFixError(error) {
  if (!capture) return;
  if (error.code === 1) {
    capture.gpsDenied = true;
    say('cap-status', 'Location is off for this site. Features still get photos and times, but no map position. Allow location in Settings to fix it.', true);
  }
  renderHud();
}

function onOrientation(event) {
  if (!capture) return;
  const heading = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading
    : event.absolute && Number.isFinite(event.alpha) ? (360 - event.alpha) % 360 : null;
  if (heading !== null) capture.heading = { value: heading, t: Date.now() };
}

async function startVideo(stream) {
  const mime = pickMime();
  if (!mime) { say('cap-status', 'This browser cannot record video, so there will be no 3D build. Photos and GPS still work.'); return; }
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
  capture.recorder = recorder; capture.mime = mime; capture.chunks = []; capture.videoBytes = 0;
  capture.videoStopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
  recorder.addEventListener('dataavailable', event => {
    if (!capture || !event.data?.size) return;
    capture.chunks.push(event.data); capture.videoBytes += event.data.size;
    if (capture.videoBytes >= LIMITS.videoBytes - 4 * 1024 ** 2 && recorder.state === 'recording') {
      recorder.stop();
      say('cap-status', `The video reached ${formatMb(LIMITS.videoBytes)} and stopped. GPS, photos and features carry on.`);
    }
  });
  recorder.start(1000);
  capture.videoStartedAt = Date.now();
}

const formatMb = bytes => `${Math.round(bytes / 1024 ** 2)} MB`;

async function startWalk() {
  if (capture) return;
  // iOS only grants compass access from inside the tap itself.
  const orientationAsk = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
    ? DeviceOrientationEvent.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
  let walks = [];
  try { walks = await store.list(); } catch (error) { say('list-status', error.message, true); return; }
  const walk = { id: newId('w'), name: defaultWalkName(walks), startedAt: Date.now(), endedAt: null, fixes: [], features: [], video: null, state: 'recording' };
  try { await store.put(walk); } catch (error) { say('list-status', error.message, true); return; }
  capture = { walk, meter: createTrackMeter(), lastFix: null, heading: null, chunks: [], videoBytes: 0, lastType: 'note' };
  say('cap-status'); say('drop-toast');
  show('capture');
  renderHud();
  void askToKeepWalks();
  if (globalThis.navigator?.geolocation) {
    capture.watchId = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  } else {
    capture.gpsDenied = true;
    say('cap-status', 'This browser has no location. Features get photos and times only.', true);
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (!capture) { stream.getTracks().forEach(track => track.stop()); return; }
    capture.stream = stream;
    const video = $('cam'); video.srcObject = stream; $('cam-off').hidden = true;
    await video.play().catch(() => {});
    await startVideo(stream);
  } catch {
    $('cam-off').hidden = false;
    if (capture) say('cap-status', 'Camera is off: features get a time and GPS position but no photo, and there is no video for a 3D build.');
  }
  orientationAsk.then(state => {
    if (!capture || state !== 'granted') return;
    capture.orientationEvent = 'ondeviceorientationabsolute' in globalThis ? 'deviceorientationabsolute' : 'deviceorientation';
    addEventListener(capture.orientationEvent, onOrientation);
  });
  try { capture.wake = await navigator.wakeLock?.request('screen'); } catch {}
  capture.timer = setInterval(renderHud, 1000);
  capture.saver = setInterval(() => void saveProgress(), 5000);
  renderHud();
}

async function saveProgress() {
  if (!capture) return;
  try { await store.put(capture.walk); } catch (error) { say('cap-status', error.message, true); }
}

function grabFrame() {
  const video = $('cam');
  if (!capture?.stream || !video.videoWidth) return null;
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

async function dropFeature(type) {
  if (!capture) return;
  const { walk } = capture;
  if (walk.features.length >= LIMITS.features) { say('drop-toast', 'This walk has the most features one walk can hold.', true); return; }
  const t = Date.now();
  const id = `f-${walk.features.length + 1}-${t.toString(36)}`;
  const fix = capture.lastFix && Math.abs(t - capture.lastFix.t) <= LIMITS.featureFixSeconds * 1000 ? capture.lastFix : null;
  const heading = capture.heading && t - capture.heading.t <= 3000 ? capture.heading.value : null;
  const photoPending = grabFrame(); // the frame is taken now, encoded below
  const recording = capture.recorder?.state === 'recording';
  const feature = makeFeature({ id, type, t, fix, heading, photo: photoPending ? `photos/${id}.jpg` : null, videoSeconds: recording ? (t - capture.videoStartedAt) / 1000 : null });
  walk.features.push(feature);
  capture.lastType = feature.type;
  navigator.vibrate?.(35);
  const n = walk.features.length;
  say('drop-toast', `${feature.label} #${n} dropped · ${fix ? `±${Math.round(fix.acc)} m` : 'waiting for GPS'}`);
  const button = $('drops').querySelector(`[data-type="${feature.type}"]`);
  button?.classList.remove('flash'); void button?.offsetWidth; button?.classList.add('flash');
  renderHud();
  if (photoPending) {
    try {
      const blob = await photoPending;
      if (blob && blob.size <= LIMITS.photoBytes) await store.putFile(walk.id, feature.photo, blob);
      else feature.photo = null;
    } catch { feature.photo = null; }
  }
  await saveProgress();
}

async function finishWalk() {
  if (!capture || capture.finishing) return;
  capture.finishing = true;
  $('finish-walk').disabled = true;
  say('cap-status', 'Saving your walk…');
  const c = capture;
  clearInterval(c.timer); clearInterval(c.saver);
  if (c.watchId !== undefined) navigator.geolocation.clearWatch(c.watchId);
  if (c.orientationEvent) removeEventListener(c.orientationEvent, onOrientation);
  try { await c.wake?.release(); } catch {}
  if (c.recorder && c.recorder.state !== 'inactive') c.recorder.stop();
  if (c.videoStopped) await Promise.race([c.videoStopped, new Promise(resolve => setTimeout(resolve, 4000))]);
  c.stream?.getTracks().forEach(track => track.stop());
  $('cam').srcObject = null;
  const walk = c.walk;
  walk.endedAt = Date.now();
  walk.features = placeFeatures(walk.features, walk.fixes);
  walk.state = 'done';
  try {
    if (c.chunks.length) {
      const type = c.mime.split(';')[0];
      const blob = new Blob(c.chunks, { type });
      const name = type === 'video/mp4' ? 'video.mp4' : 'video.webm';
      if (blob.size <= LIMITS.videoBytes) { await store.putFile(walk.id, name, blob); walk.video = { name, bytes: blob.size, type }; }
    }
    await store.put(walk);
  } catch (error) {
    say('cap-status', error.message, true);
    try { await store.put(walk); } catch {}
  }
  capture = null;
  $('finish-walk').disabled = false;
  location.hash = `walk=${walk.id}`;
}

// ---------- results ----------

async function openWalk(id) {
  let walk = null;
  try { walk = await store.get(id); } catch (error) { say('list-status', error.message, true); }
  if (!walk || walk.state === 'recording') { location.hash = ''; return; }
  releaseUrls();
  current = { walk, readOnly: false, photos: null, video: null };
  view = freshView();
  show('results');
  renderResults();
}

function openShared({ walk, photos, video }) {
  releaseUrls();
  current = { walk: { ...walk, state: 'done' }, readOnly: true, photos, video };
  view = freshView();
  history.replaceState(null, '', location.pathname + location.search);
  show('results');
  renderResults();
}

async function photoBlob(name) {
  if (!name) return null;
  if (current.readOnly) { const bytes = current.photos.get(name); return bytes ? new Blob([bytes], { type: 'image/jpeg' }) : null; }
  return store.getFile(current.walk.id, name);
}

async function videoBlob() {
  const { walk } = current;
  if (!walk.video) return null;
  if (current.readOnly) return current.video ? new Blob([current.video], { type: walk.video.type }) : null;
  return store.getFile(walk.id, walk.video.name);
}

function drawMap() {
  if (!current) return;
  mapApi = drawWalkMap($('map'), pinWalk(current.walk).walk, { ...view, markedIds: new Set((current.walk.marks ?? []).map(m => m.featureId)) });
  const zoomed = view.zoom > 1.001;
  $('map').classList.toggle('zoomed', zoomed);
  $('map-fit').hidden = !zoomed;
}

function setView(next) {
  Object.assign(view, next);
  $('map-hint').hidden = true; // learned it; the hint stays out of the way from now on
  drawMap();
}

function renderResults() {
  const { walk, readOnly } = current;
  const summary = summarizeTrack(walk.fixes, walk);
  $('walk-title').textContent = walk.name;
  $('rename').hidden = readOnly;
  $('rename-form').hidden = true;
  $('shared-badge').hidden = !readOnly;
  $('keep-copy').hidden = !readOnly;
  $('delete-walk').hidden = readOnly;
  const statement = positionStatement(walk);
  $('map-value').textContent = statement.metres !== null ? `±${formatMetres(statement.metres)}` : statement.basis === 'surveyed-mark' ? 'Unchecked' : 'Withheld';
  $('map-value').classList.toggle('muted', statement.metres === null);
  $('map-note').textContent = statement.note;
  const bits = [`${formatMetres(summary.lengthMetres)} walked`, formatDuration(summary.durationSeconds), plural(summary.fixes, 'GPS fix'), plural(summary.gaps, 'tracking gap')];
  if (summary.weakFixes) bits.push(`${plural(summary.weakFixes, 'weak fix')} left off the line`);
  $('stats').textContent = bits.join(' · ');
  $('map').setAttribute('aria-label', `Map of ${walk.name}: ${formatMetres(summary.lengthMetres)} track and ${plural(walk.features.length, 'feature')}. The feature list below has the same content.`);
  const build = $('build-3d');
  build.disabled = !walk.video || (readOnly && !current.video);
  build.title = build.disabled ? (walk.state === 'interrupted' ? 'This walk was interrupted before its video was saved.' : 'This walk has no video.') : '';
  say('result-status', walk.state === 'interrupted' ? 'This walk was interrupted. Its GPS track, features and photos were kept; the video was not.' : '');
  for (const chip of document.querySelectorAll('[data-layer]')) chip.setAttribute('aria-pressed', String(view[chip.dataset.layer]));
  $('measure').setAttribute('aria-pressed', String(view.measuring));
  say('measure-out', view.measuring ? 'Tap two features to measure between them.' : '');
  renderFeatureList();
  requestAnimationFrame(drawMap);
}

function renderFeatureList() {
  const { walk, readOnly } = current;
  $('features-empty').hidden = walk.features.length > 0;
  $('feature-list').replaceChildren(...walk.features.map((feature, index) => {
    const li = document.createElement('li');
    li.className = 'feature'; li.dataset.feature = feature.id;
    li.classList.toggle('selected', feature.id === view.selectedId || view.measure.includes(feature.id));
    const head = document.createElement('button');
    head.type = 'button'; head.className = 'feature-head'; head.dataset.select = feature.id;
    head.setAttribute('aria-expanded', String(feature.id === view.selectedId));
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = featureType(feature.type).colour; dot.textContent = String(index + 1);
    const text = document.createElement('span'); text.className = 'feature-text';
    const title = document.createElement('b'); title.textContent = feature.label;
    const meta = document.createElement('span');
    const time = new Date(feature.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const mark = (walk.marks ?? []).find(m => m.featureId === feature.id);
    meta.textContent = [featureType(feature.type).label, time, Number.isFinite(feature.acc) ? `GPS ±${formatMetres(feature.acc)}` : 'no GPS position', mark ? `pinned to ${mark.name}` : ''].filter(Boolean).join(' · ');
    text.append(title, meta);
    head.append(dot, text);
    li.append(head);
    if (feature.id === view.selectedId) {
      const detail = document.createElement('div'); detail.className = 'feature-detail';
      if (feature.photo) {
        const img = document.createElement('img'); img.alt = `Photo of ${feature.label}`; img.loading = 'lazy';
        void photoBlob(feature.photo).then(blob => { if (blob) img.src = url(blob); else img.replaceWith(Object.assign(document.createElement('p'), { textContent: 'Photo not available.' })); });
        detail.append(img);
      }
      if (feature.note) { const note = document.createElement('p'); note.textContent = feature.note; detail.append(note); }
      if (!readOnly) {
        const form = document.createElement('form'); form.className = 'feature-edit'; form.dataset.edit = feature.id;
        form.innerHTML = '<label>Name<input name="label" maxlength="60"></label><label>Note<textarea name="note" maxlength="500" rows="2"></textarea></label><div class="row"><button class="btn primary" type="submit">Save</button><button class="btn danger" type="button" data-remove="1">Remove feature</button></div>';
        form.elements.label.value = feature.label; form.elements.note.value = feature.note;
        detail.append(form);
        detail.append(markForm(feature, mark));
      }
      li.append(detail);
    }
    return li;
  }));
}

// Pin a feature to a surveyed mark (monument, PK nail, benchmark): the whole walk moves onto the marks.
function markForm(feature, mark) {
  const box = document.createElement('fieldset');
  box.className = 'mark-form'; box.dataset.markFor = feature.id;
  const legend = document.createElement('legend'); legend.textContent = 'Surveyed mark';
  box.append(legend);
  if (!Number.isFinite(feature.lat)) {
    const note = document.createElement('p'); note.textContent = 'This feature has no GPS position, so it cannot be pinned to a mark.';
    box.append(note);
    return box;
  }
  const help = document.createElement('p');
  help.textContent = 'Dropped on a monument, PK nail or benchmark? Enter its surveyed position (WGS 84 decimal degrees). The whole walk moves onto your marks; with two or more, each is checked against the others.';
  box.insertAdjacentHTML('beforeend', '<label>Latitude<input name="markLat" inputmode="decimal" autocomplete="off" placeholder="45.4215"></label><label>Longitude<input name="markLon" inputmode="decimal" autocomplete="off" placeholder="-75.6972"></label><label>Mark name<input name="markName" maxlength="60" autocomplete="off" placeholder="PK nail 3"></label><div class="row"><button class="btn primary" type="button" data-mark="save">Pin to this mark</button></div>');
  box.insertBefore(help, box.querySelector('label'));
  if (mark) {
    box.querySelector('[name=markLat]').value = String(mark.lat);
    box.querySelector('[name=markLon]').value = String(mark.lon);
    box.querySelector('[name=markName]').value = mark.name;
    box.querySelector('.row').insertAdjacentHTML('beforeend', '<button class="btn danger" type="button" data-mark="remove">Unpin</button>');
  }
  return box;
}

async function saveMark(featureId, box, remove = false) {
  const walk = current.walk;
  const others = (walk.marks ?? []).filter(m => m.featureId !== featureId);
  if (remove) { walk.marks = others; await saveWalk(); renderResults(); say('result-status', 'Mark removed.'); return; }
  const number = name => Number(String(box.querySelector(`[name=${name}]`).value).trim().replace(',', '.'));
  try {
    if (others.length >= LIMITS.marks) throw new Error(`A walk can hold up to ${LIMITS.marks} surveyed marks.`);
    const mark = readMark({ featureId, lat: number('markLat'), lon: number('markLon'), name: box.querySelector('[name=markName]').value }, new Set(walk.features.map(f => f.id)));
    walk.marks = [...others, mark];
    await saveWalk(); renderResults();
    const statement = positionStatement(walk);
    say('result-status', `${mark.name} pinned. The walk moved ${formatMetres(statement.pin.shiftMetres)}.`);
  } catch (error) { say('result-status', error.message, true); }
}

function selectFeature(id) {
  if (!id) return;
  if (view.measuring) {
    view.measure = view.measure.includes(id) ? view.measure.filter(x => x !== id) : [...view.measure.slice(-1), id];
    const [a, b] = view.measure.map(x => current.walk.features.find(f => f.id === x));
    const result = a && b ? measureBetween(a, b) : null;
    say('measure-out', view.measure.length < 2 ? 'Tap one more feature.'
      : result ? `${a.label} to ${b.label}: ${formatMetres(result.metres)} ± ${formatMetres(result.plusMinus)} (from both GPS fixes).`
      : 'One of these features has no GPS position, so there is nothing to measure.');
    renderFeatureList(); drawMap();
    return;
  }
  view.selectedId = view.selectedId === id ? null : id;
  renderFeatureList(); drawMap();
  if (view.selectedId) document.querySelector(`[data-feature="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function saveWalk() {
  if (current.readOnly) return;
  try { await store.put(current.walk); } catch (error) { say('result-status', error.message, true); }
}

// ---------- export, share, hand off ----------

async function deliver(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: current.walk.name }); return 'shared'; }
    catch (error) { if (error?.name === 'AbortError') return 'cancelled'; }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file); link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  return 'saved';
}

async function featurePhotos(walk) {
  const photos = new Map();
  for (const feature of walk.features) {
    if (!feature.photo) continue;
    const blob = await photoBlob(feature.photo);
    if (blob) photos.set(feature.photo, new Uint8Array(await blob.arrayBuffer()));
  }
  return photos;
}

async function geoPackage(walk, photos) {
  const SQL = await loadSqlJs();
  return buildGeoPackage(SQL, walk, { photos });
}

async function exportAs(kind) {
  const { walk } = current;
  const base = slug(walk.name);
  let file;
  say('result-status', 'Preparing the export…');
  try {
    if (kind === 'geojson') file = new File([JSON.stringify(toGeoJSON(walk), null, 1)], `${base}.geojson`, { type: 'application/geo+json' });
    else if (kind === 'gpx') file = new File([toGPX(walk)], `${base}.gpx`, { type: 'application/gpx+xml' });
    else if (kind === 'csv') file = new File([toCSV(walk)], `${base}-features.csv`, { type: 'text/csv' });
    else if (kind === 'gpkg') file = new File([await geoPackage(walk, await featurePhotos(walk))], `${base}.gpkg`, { type: 'application/geopackage+sqlite3' });
    else {
      const photos = await featurePhotos(walk);
      const withVideo = $('include-video').checked && walk.video;
      const video = withVideo ? await videoBlob() : null;
      const exported = { ...walk, video: video ? walk.video : null };
      let gpkg = null;
      try { gpkg = await geoPackage(exported, photos); } catch { /* the bundle still has GeoJSON, GPX and CSV */ }
      const entries = bundleEntries(exported, { photos, gpkg, video: video ? new Uint8Array(await video.arrayBuffer()) : null });
      file = new File(zipParts(entries), `${base}.zip`, { type: 'application/zip' });
    }
    const outcome = await deliver(file);
    say('result-status', outcome === 'cancelled' ? '' : `${file.name} ${outcome === 'shared' ? 'shared' : 'saved to your downloads'}.`);
    $('export-sheet').close();
  } catch (error) {
    say('result-status', `Export failed: ${error.message}`, true);
  }
}

async function buildWorld() {
  const blob = await videoBlob();
  if (!blob) { say('result-status', 'This walk has no saved video to build from.', true); return; }
  if (blob.size > HANDOFF_MAX_BYTES) { say('result-status', `The video is ${formatMb(blob.size)}; World Builder can take up to ${formatMb(HANDOFF_MAX_BYTES)} from this app. Export the bundle with the video and open it in World Builder instead.`, true); return; }
  try {
    say('result-status', 'Handing the video to World Builder on this phone. Nothing is uploaded.');
    const ext = current.walk.video.name.split('.').pop();
    const id = await stageLocalCapture([new File([blob], `${slug(current.walk.name)}.${ext}`, { type: blob.type })], { goal: 'room' });
    location.assign(`/world/index.html#handoff=${id}`);
  } catch (error) {
    say('result-status', error.message, true);
  }
}

async function keepCopy() {
  const { walk, photos, video } = current;
  const copy = { ...walk, id: newId('w'), name: walk.name, state: 'done', shared: true };
  try {
    for (const [name, bytes] of photos) await store.putFile(copy.id, name, new Blob([bytes], { type: 'image/jpeg' }));
    if (walk.video && video) await store.putFile(copy.id, walk.video.name, new Blob([video], { type: walk.video.type }));
    else copy.video = null;
    await store.put(copy);
    location.hash = `walk=${copy.id}`;
  } catch (error) { say('result-status', error.message, true); }
}

async function openSharedFile(file) {
  if (!file) return;
  say('list-status', 'Opening the shared walk…');
  try {
    if (file.size > LIMITS.bundleBytes) throw new Error(`Shared walks can be up to ${formatMb(LIMITS.bundleBytes)}.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksLikeGeoPackage(bytes)) openShared(readGeoPackage(await loadSqlJs(), bytes));
    else openShared(readBundle(await unzip(bytes, { maxBytes: LIMITS.bundleBytes })));
    say('list-status');
  } catch (error) {
    say('list-status', `Could not open it: ${error.message}`, true);
  }
}

// ---------- routing and events ----------

async function route() {
  const match = /^#walk=([a-z0-9-]{1,64})$/u.exec(location.hash);
  if (capture) return;
  if (match) { await openWalk(match[1]); return; }
  if (current?.readOnly && document.body.dataset.screen === 'results') return;
  current = null; releaseUrls();
  show('list');
  await renderList();
}

renderDrops();
addEventListener('hashchange', () => void route());
$('new-walk').addEventListener('click', () => void startWalk());
$('open-shared').addEventListener('change', event => { const file = event.target.files?.[0]; event.target.value = ''; void openSharedFile(file); });
$('walk-list').addEventListener('click', event => { const id = event.target.closest('[data-walk]')?.dataset.walk; if (id) location.hash = `walk=${id}`; });
$('drops').addEventListener('click', event => { const type = event.target.closest('[data-type]')?.dataset.type; if (type) void dropFeature(type); });
$('finish-walk').addEventListener('click', () => void finishWalk());
addEventListener('keydown', event => {
  if (!capture || event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('input, textarea')) return;
  const n = Number(event.key);
  if (n >= 1 && n <= FEATURE_TYPES.length) { event.preventDefault(); void dropFeature(FEATURE_TYPES[n - 1].id); }
  else if (event.key === ' ' || event.key === 'Enter' || event.key === 'AudioVolumeUp') {
    // A focused button keeps its own Enter/Space. Elsewhere, Space or a Bluetooth shutter repeats the last type.
    if (event.target.closest?.('button, a, summary, select')) return;
    event.preventDefault(); void dropFeature(capture.lastType);
  }
});
document.addEventListener('visibilitychange', () => {
  if (!capture) return;
  if (document.visibilityState === 'hidden') { void saveProgress(); return; }
  navigator.wakeLock?.request('screen').then(lock => { if (capture) capture.wake = lock; }).catch(() => {});
  // Phones stop the camera when the screen locks or another app opens. Say so instead of looking frozen.
  if (capture.stream && capture.stream.getVideoTracks().every(track => track.readyState === 'ended')) {
    $('cam-off').hidden = false;
    say('cap-status', 'The camera stopped while the screen was off. GPS and features carry on; the video so far is kept.');
  }
  renderHud();
});
$('back').addEventListener('click', () => {
  if (current?.readOnly) { current = null; void route(); return; }
  location.hash = '';
});
$('rename').addEventListener('click', () => { $('rename-form').hidden = false; $('rename-input').value = current.walk.name; $('rename-input').focus(); });
$('rename-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('rename-input').value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, LIMITS.nameChars);
  if (name) { current.walk.name = name; await saveWalk(); }
  renderResults();
});
for (const chip of document.querySelectorAll('[data-layer]')) chip.addEventListener('click', () => { view[chip.dataset.layer] = !view[chip.dataset.layer]; chip.setAttribute('aria-pressed', String(view[chip.dataset.layer])); drawMap(); });
$('measure').addEventListener('click', () => {
  view.measuring = !view.measuring; view.measure = []; view.selectedId = null;
  $('measure').setAttribute('aria-pressed', String(view.measuring));
  say('measure-out', view.measuring ? 'Tap two features to measure between them.' : '');
  renderFeatureList(); drawMap();
});
// Map gestures: one finger drags (once zoomed in), two fingers pinch, the wheel zooms, a tap selects,
// and a double tap fits the whole walk again. At normal size a vertical drag still scrolls the page.
const touches = new Map();
let gestureMoved = false, lastTap = 0;
const centreOffset = (canvas, x, y) => ({ sx: x - canvas.clientWidth / 2, sy: y - canvas.clientHeight / 2 });
const local = (canvas, event) => { const box = canvas.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
$('map').addEventListener('pointerdown', event => {
  const canvas = event.currentTarget;
  touches.set(event.pointerId, local(canvas, event));
  if (touches.size === 1) gestureMoved = false;
  try { canvas.setPointerCapture(event.pointerId); } catch {}
});
$('map').addEventListener('pointermove', event => {
  const canvas = event.currentTarget;
  const previous = touches.get(event.pointerId);
  if (!previous) return;
  const now = local(canvas, event);
  if (touches.size === 1) {
    const dx = now.x - previous.x, dy = now.y - previous.y;
    if (Math.hypot(dx, dy) > 0.5) {
      if (view.zoom > 1.001 || gestureMoved) { gestureMoved = true; setView({ panX: view.panX + dx, panY: view.panY + dy }); }
      else if (Math.hypot(dx, dy) > 6) gestureMoved = true;
    }
  } else if (touches.size === 2) {
    const [a, b] = [...touches.entries()].map(([id, p]) => id === event.pointerId ? now : p);
    const [pa, pb] = [...touches.values()];
    const before = Math.hypot(pa.x - pb.x, pa.y - pb.y), after = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = centreOffset(canvas, (a.x + b.x) / 2, (a.y + b.y) / 2);
    const oldMid = centreOffset(canvas, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    gestureMoved = true;
    const zoomed = before > 4 ? zoomAbout(view, after / before, mid.sx, mid.sy) : view;
    setView({ ...zoomed, panX: zoomed.panX + (mid.sx - oldMid.sx), panY: zoomed.panY + (mid.sy - oldMid.sy) });
  }
  touches.set(event.pointerId, now);
});
const endTouch = event => {
  const canvas = event.currentTarget;
  const point = touches.get(event.pointerId);
  touches.delete(event.pointerId);
  if (event.type !== 'pointerup' || touches.size || gestureMoved || !point || !mapApi) return;
  const now = Date.now();
  if (now - lastTap < 300) { lastTap = 0; setView({ zoom: 1, panX: 0, panY: 0 }); return; }
  lastTap = now;
  selectFeature(mapApi.hit(point.x, point.y));
};
for (const type of ['pointerup', 'pointercancel']) $('map').addEventListener(type, endTouch);
$('map').addEventListener('wheel', event => {
  event.preventDefault();
  const canvas = event.currentTarget;
  const { x, y } = local(canvas, event);
  const { sx, sy } = centreOffset(canvas, x, y);
  setView(zoomAbout(view, Math.exp(-event.deltaY * 0.0015), sx, sy));
}, { passive: false });
$('map-fit').addEventListener('click', () => setView({ zoom: 1, panX: 0, panY: 0 }));
$('feature-list').addEventListener('click', async event => {
  const select = event.target.closest('[data-select]');
  if (select) { selectFeature(select.dataset.select); return; }
  const markButton = event.target.closest('[data-mark]');
  if (markButton) { const box = markButton.closest('[data-mark-for]'); await saveMark(box.dataset.markFor, box, markButton.dataset.mark === 'remove'); return; }
  if (event.target.closest('[data-remove]')) {
    const id = event.target.closest('[data-edit]').dataset.edit;
    const feature = current.walk.features.find(f => f.id === id);
    if (!feature || !confirm(`Remove ${feature.label} from this walk?`)) return;
    current.walk.features = current.walk.features.filter(f => f.id !== id);
    current.walk.marks = (current.walk.marks ?? []).filter(m => m.featureId !== id);
    if (feature.photo) { try { await store.deleteFile(current.walk.id, feature.photo); } catch {} }
    view.selectedId = null;
    await saveWalk(); renderResults();
  }
});
$('feature-list').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target.closest('[data-edit]');
  const feature = current.walk.features.find(f => f.id === form?.dataset.edit);
  if (!feature) return;
  const clean = (value, max) => value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max);
  feature.label = clean(form.elements.label.value, LIMITS.labelChars) || featureType(feature.type).label;
  feature.note = clean(form.elements.note.value, LIMITS.noteChars);
  await saveWalk(); renderResults();
  say('result-status', `${feature.label} saved.`);
});
$('export').addEventListener('click', () => {
  const video = current.walk.video && (!current.readOnly || current.video);
  $('include-video-row').hidden = !video;
  $('include-video').checked = false;
  if (video) $('include-video-label').textContent = `Include the video (${formatMb(current.walk.video.bytes)})`;
  $('export-sheet').showModal();
});
$('export-sheet').addEventListener('click', event => { const kind = event.target.closest('[data-export]')?.dataset.export; if (kind) void exportAs(kind); });
$('build-3d').addEventListener('click', () => void buildWorld());
$('keep-copy').addEventListener('click', () => void keepCopy());
$('delete-walk').addEventListener('click', async () => {
  if (!current || current.readOnly || !confirm(`Delete ${current.walk.name} and its photos and video from this phone?`)) return;
  try { await store.remove(current.walk.id); location.hash = ''; } catch (error) { say('result-status', error.message, true); }
});
addEventListener('resize', () => { if (document.body.dataset.screen === 'results') drawMap(); });
addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; $('install').hidden = false; });
$('install').addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; $('install').hidden = true; });

if ('serviceWorker' in navigator && isSecureContext && !new URLSearchParams(location.search).has('nosw')) navigator.serviceWorker.register('./sw.js').catch(() => {});
void route();
