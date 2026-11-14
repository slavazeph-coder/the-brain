import { kneeFlexion, readForceCsv, forceAt, buildMovementReview } from './movement-analysis.mjs';

import { mountTrial, trialDemoLandmarks } from './movement-trial-ui.mjs';

const $ = id => document.getElementById(id);
const video = $('video'), stage = $('stage'), overlay = $('overlay'), slider = $('time');
const joints = ['hip', 'knee', 'ankle'];
const provenance = { measured: 'Measured', modelled: 'Model estimate', synthetic: 'Synthetic example' };
let source = null, observations = [], forceTrace = null, draft = [], time = 0, localURL = null;
let playing = false, animation = 0, seekPending = false, traceRequest = 0, draftEdited = false;
let crosshair = {x: .5, y: .5}, keyboard = false, demoStart = 0;
let staticChart = null;
const clamp = v => Math.max(0, Math.min(1, v));
const sec = t => t.toFixed(3) + ' s';
const report = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };

const trial = mountTrial({
  getSource: () => source,
  getVideoUrl: () => localURL,
  sideChanged: () => { loadDraft(); },
  forceRemoved: removed => {
    if (forceTrace !== removed) return;
    forceTrace = null;
    traceRequest++;
    staticChart = null;
    render();
  },
  seek,
  redraw: () => { staticChart = null; render(); },
  openDemo() {
    clearSource();
    $('video-file').value = '';
    $('capture-file').value = '';
    source = {kind:'synthetic', name:'Sit-to-stand trial', width:720, height:480, durationSeconds:8, trialDemo:true};
    showSource();
    report('Synthetic sit-to-stand trial. Scrub the movement or review each detected rise.');
  },
});

function demoLandmarks(t) {
  const bend = (1 - Math.cos(Math.PI * t / 2)) / 2;
  return [{x: .47 - .085 * bend, y: .48 + .17 * bend},
    {x: .5 + .085 * bend, y: .65 + .055 * bend}, {x: .48, y: .84}];
}

// The original squat has no recorded anatomical side. Keep that review untagged.
function selectedSide() { return source?.kind === 'synthetic' && !source.trialDemo ? undefined : trial.side(); }
function sameFrame(t) { return observations.find(o => o.side === selectedSide() && Math.abs(o.timeSeconds - t) < .000001); }
function loadDraft() {
  draft = (sameFrame(time)?.landmarks || []).map(p => ({...p}));
  draftEdited = false;
}
function angle(points) {
  if (points.length !== 3 || !source) return null;
  try { return kneeFlexion(points, source.width, source.height); } catch { return null; }
}

function stop() {
  playing = false;
  cancelAnimationFrame(animation);
  animation = 0;
  video.pause();
  $('play').textContent = 'Play';
}
function clearSource() {
  stop();
  trial.resetSource(null);
  source = null;
  if (localURL) {
    URL.revokeObjectURL(localURL);
    localURL = null;
  }
  video.removeAttribute('src');
  video.load();
  observations = [];
  forceTrace = null;
  staticChart = null;
  draft = [];
  draftEdited = false;
  traceRequest++;
  time = 0;
  seekPending = false;
  keyboard = false;
  crosshair = {x:.5, y:.5};
  $('review').hidden = true;
  $('preview-demo').hidden = false;
  $('force-label').value = '';
  $('force-offset').value = '0';
  $('force-kind').value = 'measured';
  $('force-file').value = '';
}
function showSource() {
  trial.resetSource(source);
  $('review').hidden = false;
  $('preview-demo').hidden = true;
  stage.style.setProperty('--aspect', String(source.width / source.height));
  $('source-name').textContent = source.name;
  $('source-kind').textContent = source.kind === 'synthetic' ? 'Synthetic side view' : 'Local video';
  video.hidden = source.kind !== 'video';
  $('force-panel').hidden = source.kind !== 'video';
  slider.max = String(source.durationSeconds);
  slider.value = String(time);
  loadDraft();
  refreshSaved();
  render();
}

$('demo').onclick = () => {
  clearSource();
  $('video-file').value = '';
  $('capture-file').value = '';
  source = {kind:'synthetic', name:'Squat cycle', width:720, height:480, durationSeconds:4};
  observations = [0, 1, 2, 3, 4].map(timeSeconds => ({timeSeconds, landmarks:demoLandmarks(timeSeconds)}));
  forceTrace = readForceCsv('time_s,vertical_force_n\n0,650\n1,510\n2,680\n3,930\n4,650', {kind:'synthetic', label:'Authored example load', offsetSeconds:0});
  time = 2;
  showSource();
  report('Synthetic motion and force values. Choose a saved frame, scrub the timeline or open your own video.');
};
function openLocalClip(event) {
  const file = event.currentTarget.files[0];
  event.currentTarget.value = '';
  if (!file) return;
  clearSource();
  localURL = URL.createObjectURL(file);
  const requested = localURL;
  report('Opening ' + file.name + '…');
  video.onloadedmetadata = () => {
    if (localURL !== requested || video.currentSrc !== requested) return;
    const width = video.videoWidth, height = video.videoHeight, durationSeconds = video.duration;
    if (!width || !height || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      report('This video needs a readable frame size and a finite duration.', true);
      return;
    }
    source = {kind:'video', name:file.name, sizeBytes:file.size, lastModifiedMs:file.lastModified, width, height, durationSeconds};
    showSource();
    report('Video opened locally. Pause at the movement you want to mark.');
  };
  video.onerror = () => {
    if (localURL === requested && video.currentSrc === requested) {
      clearSource();
      report('The browser could not decode this video. Try a locally playable MP4 or WebM file.', true);
    }
  };
  video.src = localURL;
  video.load();
}
for (const id of ['video-file', 'capture-file']) $(id).addEventListener('change', openLocalClip);
video.addEventListener('loadeddata', () => { if (source?.kind === 'video') render(); });
video.addEventListener('seeked', () => {
  if (source?.kind !== 'video' || video.seeking) return;
  seekPending = false;
  time = video.currentTime;
  loadDraft();
  render();
});
function seek(t) {
  if (!source || !Number.isFinite(t)) return;
  stop();
  const target = Math.max(0, Math.min(t, source.durationSeconds));
  if (source.kind === 'video' && (target !== video.currentTime || video.seeking)) {
    seekPending = true;
    video.currentTime = target;
  }
  time = target;
  loadDraft();
  render();
}
slider.oninput = () => seek(Number(slider.value));
slider.onkeydown = event => {
  // Browser-native default range increments disagree for step="any".
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !source) return;
  event.preventDefault();
  seek(time + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? .5 : .05));
};
$('play').onclick = async () => {
  if (!source || seekPending) return;
  if (playing) { stop(); loadDraft(); render(); return; }
  if (time >= source.durationSeconds) {
    time = 0;
    if (source.kind === 'video') video.currentTime = 0;
  }
  playing = true;
  draft = [];
  draftEdited = false;
  $('play').textContent = 'Pause';
  const active = source;
  if (source.kind === 'video') {
    try { await video.play(); }
    catch { if (source === active) { stop(); render(); report('Video playback was interrupted.', true); } return; }
    if (source !== active || !playing) return;
  } else { demoStart = performance.now() - time * 1000; }
  function tick(now) {
    if (!playing || source !== active) return;
    time = source.kind === 'video' ? video.currentTime : Math.min((now - demoStart) / 1000, source.durationSeconds);
    if (time >= source.durationSeconds || video.ended && source.kind === 'video') { stop(); loadDraft(); }
    render();
    if (playing) animation = requestAnimationFrame(tick);
  }
  animation = requestAnimationFrame(tick);
};

function surface(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width, h = rect.height;
  if (!w || !h) return null;
  const width = Math.round(w * ratio), height = Math.round(h * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(width / w, 0, 0, height / h, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return {ctx, w, h};
}

function displayedPose() {
  const marked = playing ? sameFrame(time)?.landmarks || [] : draft;
  if (marked.length || (!playing && draftEdited) || seekPending) return {points:marked, sample:null};
  const sample = trial.nearestAt(time);
  return {points:sample?.landmarks || [], sample};
}

function drawStage() {
  const s = surface(overlay);
  if (!s || !source) return;
  const {ctx, w, h} = s;
  const dot = (p, r, color) => { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, r, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); };
  const line = (points, color, thickness) => {
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h));
    ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  };
  if (source.kind === 'synthetic') {
    const [hip, knee, ankle] = source.trialDemo ? trialDemoLandmarks(time) : demoLandmarks(time);
    const shoulder = {x: hip.x + .055 + .55 * (hip.y - .48), y: hip.y - .255};
    const head = {x: shoulder.x + .014, y: shoulder.y - .09};
    ctx.fillStyle = '#101b26'; ctx.fillRect(0, 0, w, h);
    line([{x: .14, y: .87}, {x: .86, y: .87}], '#3b5368', 2);
    if (source.trialDemo) {
      line([{x:.11, y:.64}, {x:.38, y:.64}], '#8c7660', h * .017);
      line([{x:.15, y:.64}, {x:.15, y:.87}], '#8c7660', h * .014);
    }
    line([hip, {x:knee.x - .035, y:knee.y}, {x:ankle.x - .03, y:ankle.y}], '#35495f', h * .026);
    line([hip, shoulder], '#7c8ea6', h * .058);
    line([hip, knee, ankle, {x:ankle.x + .055, y:.85}], '#91a8bb', h * .033);
    line([shoulder, {x: shoulder.x + .08, y: shoulder.y + .11}, {x: shoulder.x + .17, y: shoulder.y + .09}], '#667f91', h * .024);
    dot(head, h * .053, '#bec9d4');
  }
  const {points, sample} = displayedPose();
  const color = sample ? '#ffc880' : '#76edee';
  if (points.length) {
    line(points, '#081018', 6);
    line(points, color, 2.5);
    ctx.font = 'bold 12px system-ui';
    for (const [i, p] of points.entries()) {
      dot(p, 5, '#101722'); dot(p, 3.5, color);
      const text = joints[i][0].toUpperCase() + joints[i].slice(1);
      const x = Math.max(2, Math.min(w - ctx.measureText(text).width - 6, p.x * w + 8)), y = Math.max(14, Math.min(h - 4, p.y * h - 6));
      ctx.lineWidth = 3; ctx.strokeStyle = '#081018'; ctx.strokeText(text, x, y); ctx.fillStyle = '#f4ffff'; ctx.fillText(text, x, y);
    }
  }
  if (keyboard && !playing && draft.length < 3) {
    const p = crosshair;
    line([{x:p.x - 8/w,y:p.y},{x:p.x + 8/w,y:p.y}], '#f9c981', 1.5);
    line([{x:p.x,y:p.y - 8/h},{x:p.x,y:p.y + 8/h}], '#f9c981', 1.5);
  }
}
function mark(p) {
  if (!source || seekPending || playing || source.kind === 'video' && (video.readyState < 2 || video.seeking) || draft.length >= 3) return;
  draft.push(p); draftEdited = true;
  crosshair = {...p};
  render();
}
overlay.onclick = event => {
  const rect = overlay.getBoundingClientRect();
  keyboard = false;
  mark({x:clamp((event.clientX - rect.left) / rect.width), y:clamp((event.clientY - rect.top) / rect.height)});
};
overlay.onfocus = () => { keyboard = true; drawStage(); };
overlay.onblur = () => { keyboard = false; drawStage(); };
overlay.onkeydown = event => {
  const dirs = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mark({...crosshair}); return; }
  if (!dirs[event.key] || !source) return;
  event.preventDefault();
  keyboard = true;
  const [dx, dy] = dirs[event.key], step = event.shiftKey ? 10 : 1;
  crosshair = {x:clamp(crosshair.x + dx * step / source.width), y:clamp(crosshair.y + dy * step / source.height)};
  drawStage();
};
$('undo').onclick = () => { draft.pop(); draftEdited = true; render(); };
$('reset').onclick = () => { draft = []; draftEdited = true; render(); };
$('save-frame').onclick = () => {
  if (playing || seekPending || angle(draft) === null) return;
  const previous = sameFrame(time);
  if (!previous && observations.length >= 10000) { report('The review already has 10,000 frames.', true); return; }
  const observation = {timeSeconds:time, ...(selectedSide() ? {side:selectedSide()} : {}), landmarks:draft.map(p => ({...p}))};
  observations = observations.filter(o => o !== previous).concat(observation).sort((a,b) => a.timeSeconds - b.timeSeconds);
  draftEdited = false;
  refreshSaved();
  render();
  report('Saved the knee landmarks at ' + sec(time) + '.');
};
function refreshSaved() {
  trial.setObservations(observations);
  staticChart = null;
  $('frames-empty').hidden = observations.length > 0;
  $('export').disabled = observations.length === 0;
  const fragment = document.createDocumentFragment();
  for (const [index,o] of observations.entries()) {
    const li = document.createElement('li'), go = document.createElement('button'), remove = document.createElement('button');
    go.type = remove.type = 'button';
    go.dataset.time = String(o.timeSeconds);
    go.dataset.index = String(index);
    const description = (o.side ? o.side + ' · ' : '') + sec(o.timeSeconds);
    go.textContent = description + ' · ' + angle(o.landmarks).toFixed(1) + '°';
    remove.dataset.remove = String(index);
    remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove annotation ' + description);
    li.append(go, remove); fragment.append(li);
  }
  $('frames').replaceChildren(fragment);
}
$('frames').onclick = event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.time !== undefined) {
    const selected = observations[Number(button.dataset.index)];
    if (!selected) return;
    if (selected.side && trial.side() !== selected.side) {
      $('trial-side').value = selected.side;
      $('trial-side').dispatchEvent(new Event('input', {bubbles:true}));
    }
    seek(selected.timeSeconds);
    return;
  }
  const index = Number(button.dataset.remove), removed = observations[index];
  if (!removed) return;
  observations = observations.filter((_,i) => i !== index);
  if (Math.abs(removed.timeSeconds - time) < .000001 && removed.side === selectedSide()) loadDraft();
  refreshSaved(); render(); report('Removed the annotation at ' + sec(removed.timeSeconds) + '.');
};
$('apply-force').onclick = async () => {
  const request = ++traceRequest;
  const file = $('force-file').files[0];
  if (!file || source?.kind !== 'video') { report('Select a CSV file for this video.', true); return; }
  if (file.size > 8 * 1024 * 1024) { report('Use a CSV under 8 MiB.', true); return; }
  const offsetSeconds = $('force-offset').valueAsNumber, label = $('force-label').value.trim(), kind = $('force-kind').value;
  try {
    const trace = readForceCsv(await file.text(), {kind, label, offsetSeconds});
    if (request !== traceRequest) return;
    forceTrace = trace;
    trial.acceptForce(trace);
    staticChart = null;
    render();
    report('Applied ' + label + ' to the video timeline.');
  } catch (error) { if (request === traceRequest) report(error.message, true); }
};
$('clear-force').onclick = () => { traceRequest++; trial.removeForce(forceTrace?.kind); forceTrace = null; staticChart = null; render(); report('Removed the force trace.'); };
$('export').onclick = () => {
  try {
    const review = buildMovementReview({source, observations, forceTrace});
    const url = URL.createObjectURL(new Blob([JSON.stringify(review, null, 2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'brainsnn-movement-review.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    report('Exported ' + observations.length + ' saved frames with source and trace metadata.');
  } catch (error) { report(error.message, true); }
};

$('support-model').addEventListener('movement-support-start', () => { traceRequest++; });
for (const id of ['force-kind', 'force-label', 'force-offset', 'force-file']) {
  $(id).addEventListener('input', () => { traceRequest++; });
}
$('support-model').addEventListener('movement-support-trace', event => {
  if (source?.kind !== 'video' || event.detail?.kind !== 'modelled') return;
  traceRequest++;
  forceTrace = event.detail;
  trial.acceptForce(forceTrace);
  staticChart = null;
  render();
  report('Applied ' + forceTrace.label + ' to the video timeline.');
});

function drawChart() {
  const s = surface($('chart'));
  if (!s || !source) return;
  const {ctx, w, h} = s;
  const left = 38, right = w - 44, top = 12, bottom = h - 25;
  const x = t => left + (right - left) * t / source.durationSeconds;
  if (!staticChart || staticChart.width !== w || staticChart.height !== h) {
    const backing = document.createElement('canvas');
    backing.width = $('chart').width; backing.height = $('chart').height;
    const pen = backing.getContext('2d');
    pen.setTransform(backing.width / w, 0, 0, backing.height / h, 0, 0);
    pen.font = '11px system-ui'; pen.textBaseline = 'middle';
    for (const deg of [0, 90, 180]) {
      const y = bottom - (bottom - top) * deg / 180;
      pen.fillStyle = '#a4b5c6'; pen.textAlign = 'right'; pen.fillText(deg + '°', left - 5, y);
      pen.beginPath(); pen.moveTo(left, y); pen.lineTo(right, y); pen.strokeStyle = '#2d3a4c'; pen.stroke();
    }
    pen.textAlign = 'left'; pen.fillText('0 s', left, bottom + 16);
    pen.textAlign = 'right'; pen.fillText(source.durationSeconds.toFixed(2) + ' s', right, bottom + 16);
    if (forceTrace) {
      const times = [0, source.durationSeconds];
      const values = times.map(t => [t, forceAt(forceTrace, t)]).filter(p => p[1] !== null);
      const points = forceTrace.samples.filter(p => {
        const t = p.timeSeconds + forceTrace.offsetSeconds;
        return t > 0 && t < source.durationSeconds;
      }).map(p => [p.timeSeconds + forceTrace.offsetSeconds, p.verticalForceN]);
      if (values[0]?.[0] === 0) points.unshift(values[0]);
      if (values.at(-1)?.[0] === source.durationSeconds) points.push(values.at(-1));
      if (points.length) {
        let lo = 0, hi = 0;
        for (const [, f] of points) { lo = Math.min(lo, f); hi = Math.max(hi, f); }
        if (hi === lo) hi = lo + 1;
        pen.fillStyle = '#bea4ff'; pen.textAlign = 'left';
        const fmt = v => Math.abs(v) >= 10000 ? v.toExponential(1) : String(Math.round(v));
        pen.fillText(fmt(hi), right + 4, top); pen.fillText(fmt(lo), right + 4, bottom);
        pen.strokeStyle = '#bea4ff'; pen.lineWidth = 1.5; pen.beginPath();
        points.forEach(([t, f], i) => {
          const y = bottom - (f - lo) / (hi - lo) * (bottom - top);
          i ? pen.lineTo(x(t), y) : pen.moveTo(x(t), y);
        }); pen.stroke();
      }
    }
    for (const frame of trial.poseFrames()) {
      if (!frame.landmarks) continue;
      const bend = angle(frame.landmarks);
      if (bend === null) continue;
      pen.fillStyle = '#ffc880';
      pen.fillRect(x(frame.timeSeconds) - 1.3, bottom - bend / 180 * (bottom - top) - 1.3, 2.6, 2.6);
    }
    // Discrete marks, so an unlabelled interval never appears to have a measured angle.
    for (const o of observations) {
      if (o.side !== selectedSide()) continue;
      const deg = angle(o.landmarks);
      if (deg === null) continue;
      pen.beginPath(); pen.arc(x(o.timeSeconds), bottom - deg / 180 * (bottom - top), 3.3, 0, 2 * Math.PI);
      pen.fillStyle = '#76edee'; pen.fill();
    }
    staticChart = {width:w, height:h, backing};
  }
  ctx.drawImage(staticChart.backing, 0, 0, w, h);
  ctx.beginPath(); ctx.moveTo(x(time), top); ctx.lineTo(x(time), bottom);
  ctx.strokeStyle = '#f0d48e'; ctx.lineWidth = 1; ctx.stroke();
}

function render() {
  if (!source) return;
  slider.value = String(time);
  slider.setAttribute('aria-valuetext', sec(time));
  $('clock').textContent = sec(time);
  stage.dataset.seeking = String(seekPending);
  const busy = playing || seekPending || source.kind === 'video' && (video.seeking || video.readyState < 2);
  const {points, sample} = displayedPose();
  const deg = angle(points);
  const force = forceAt(forceTrace, time);
  $('angle').textContent = deg === null ? '—' : deg.toFixed(1) + '°';
  $('force').textContent = force === null ? '—' : force.toFixed(1) + ' N';
  $('force-provenance').textContent = forceTrace
    ? provenance[forceTrace.kind] + ' · ' + forceTrace.label + (forceTrace.model?.sourceLabel ? ' · ' + forceTrace.model.sourceLabel : '') + (force === null ? ' · Outside trace coverage' : '')
    : 'Add a synchronized trace to review vertical force.';
  $('force-key').hidden = !forceTrace;
  $('tracked-key').hidden = !trial.poseFrames().length;
  $('clear-force').hidden = !forceTrace;
  $('undo').disabled = $('reset').disabled = busy || draft.length === 0;
  $('save-frame').disabled = busy || deg === null || !draftEdited;
  $('play').disabled = seekPending;
  $('chart').setAttribute('aria-label', trial.poseFrames().length ? 'Projected knee angles from trial samples and saved marks, with optional force on the same timeline' : 'Saved knee angles and optional force over video time');
  const guide = $('point-guide');
  const text = sample && !busy ? (sample.origin === 'manual' ? 'Manual observation' : source.kind === 'synthetic' ? 'Synthetic pose' : 'Tracker estimate') + ' at ' + sec(sample.timeSeconds) + '. Mark all three joints to save your own observation.'
    : playing ? 'Pause to mark landmarks.' : busy ? 'Loading frame…' : draft.length < 3
    ? 'Mark the ' + joints[draft.length] + ' on the same side of the body (' + (draft.length + 1) + ' of 3).'
    : deg === null ? 'Overlapping landmarks. Undo a point and mark a distinct joint.'
    : draftEdited ? 'All three landmarks are marked. Save this frame to keep the measurement.'
    : 'Saved landmarks. Use Undo or Clear points to revise them.';
  if (guide.textContent !== text) guide.textContent = text;
  drawStage();
  drawChart();
}
new ResizeObserver(() => { if (source) render(); }).observe($('review'));
window.addEventListener('pagehide', () => { stop(); });

// The opening visual is an explicitly synthetic three-pose illustration. It creates
// no measurements or exportable record until the viewer chooses the example.
function drawPreview() {
  const s = surface($('demo-strip'));
  if (!s) return;
  const {ctx, w, h} = s;
  const floor = .87 * h;
  ctx.strokeStyle = '#39495d'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(w * .06, floor); ctx.lineTo(w * .94, floor); ctx.stroke();
  for (const [i, t] of [0, 1, 2].entries()) {
    const [hip, knee, ankle] = demoLandmarks(t);
    const width = Math.min(w / 3, h * 1.4);
    const px = p => ((i + .5) / 3) * w + (p.x - .5) * width;
    const py = p => p.y * h;
    const shoulder = {x: hip.x + .055 + .55 * (hip.y - .48), y: hip.y - .255};
    const head = {x: shoulder.x + .014, y: shoulder.y - .09};
    const line = (points, color, thick) => {
      ctx.beginPath(); points.forEach((p, j) => j ? ctx.lineTo(px(p),py(p)) : ctx.moveTo(px(p),py(p)));
      ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = thick; ctx.strokeStyle = color; ctx.stroke();
    };
    line([hip, shoulder], '#7795a9', Math.max(4,h*.045));
    line([hip, knee, ankle, {x:ankle.x+.06,y:.85}], '#a2bacb', Math.max(4,h*.03));
    line([shoulder, {x:shoulder.x+.07,y:shoulder.y+.12}, {x:shoulder.x+.16,y:shoulder.y+.1}], '#7795a9', Math.max(3,h*.023));
    ctx.fillStyle='#adbfcc'; ctx.beginPath(); ctx.arc(px(head),py(head),h*.045,0,Math.PI*2); ctx.fill();
    line([hip,knee,ankle], '#76edee', 2);
    for (const p of [hip,knee,ankle]) {
      ctx.fillStyle = '#76edee'; ctx.beginPath(); ctx.arc(px(p),py(p),3.8,0,Math.PI*2); ctx.fill();
    }
  }
}
$('preview-demo').onclick = () => $('demo').click();
new ResizeObserver(drawPreview).observe($('preview-demo'));

if (new URLSearchParams(location.search).get('demo') === 'sit-to-stand') $('trial-demo').click();
