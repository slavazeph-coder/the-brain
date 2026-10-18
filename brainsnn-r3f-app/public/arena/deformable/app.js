const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const degrees = value => value * 180 / Math.PI;
const radians = value => value * Math.PI / 180;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fixed = (value, digits = 2) => finite(value) ? value.toFixed(digits) : '—';
let worker, renderer, config = null, defaults = null, provenance = null, episode = null, frame = null;
let phase = 'initializing', playing = false, playbackTime = 0, cursor = 0, lastTick = 0, count = 10, report = null, searchReport = null, autoPlay = false, draftChanged = false, cancelling = false;
let exportingReport = null;
const busy = () => ['initializing', 'computing', 'batch', 'search', 'exporting'].includes(phase);
const fields = ['amplitude', 'swingDuration', 'yaw', 'length', 'young', 'seed', 'target-x', 'target-y', 'target-z'];

function message(text, error = false) { $('run-message').textContent = text; $('run-message').classList.toggle('error', error); }
function fill(next) {
  config = clone(next); defaults ||= clone(next);
  const inputValue = value => String(Number(value.toFixed(6)));
  for (const key of ['amplitude', 'yaw']) $(key).value = inputValue(degrees(next[key]));
  for (const key of ['swingDuration', 'length', 'seed']) $(key).value = inputValue(next[key]);
  $('young').value = inputValue(next.young / 1000);
  next.target.forEach((value, i) => $('target-' + 'xyz'[i]).value = inputValue(value));
  $('settings-note').textContent = 'Changes apply to your next strike.';
}
function readConfig() {
  if (!config || !$('strike-settings').reportValidity()) return null;
  const next = clone(config);
  next.amplitude = radians(Number($('amplitude').value)); next.yaw = radians(Number($('yaw').value));
  for (const key of ['swingDuration', 'length', 'seed']) next[key] = Number($(key).value);
  next.young = Number($('young').value) * 1000;
  next.target = ['x', 'y', 'z'].map(axis => Number($('target-' + axis).value));
  return next;
}
function result() { return episode?.summary || episode?.outcome || {}; }
function draw() {
  if (!frame) return;
  const trail = episode ? episode.frames.slice(0, cursor + 1).map(item => item.tip || item.rope?.at(-1)).filter(Array.isArray) : [];
  renderer?.setFrame(frame, { trail, targetRadius: episode?.config?.targetRadius || config?.targetRadius, ropeRadius: episode?.config?.radius || config?.radius });
  $('time-label').textContent = fixed(frame.time) + ' s'; $('timeline').value = String(cursor);
  const summary = result(), complete = episode && cursor === episode.frames.length - 1;
  $('min-distance').textContent = fixed(frame.minDistance ?? summary.minDistance, 3) + (finite(frame.minDistance ?? summary.minDistance) ? ' m' : '');
  $('peak-speed').textContent = fixed(frame.peakTipSpeed ?? summary.peakTipSpeed, 2) + (finite(frame.peakTipSpeed ?? summary.peakTipSpeed) ? ' m/s' : '');
  const contact = complete ? summary.success === true ? 'Target reached' : 'Missed' : episode ? 'In motion' : 'Ready';
  $('contact-state').textContent = contact; $('contact-state').className = complete ? summary.success ? 'hit' : 'miss' : '';
}
function controls() {
  const available = Boolean(config) && !busy();
  $('settings-fields').disabled = !available;
  $('run-strike').disabled = busy(); $('reset-strike').disabled = !available;
  $('find-swing').disabled = !available;
  document.querySelectorAll('[data-preset],[data-batch-count]').forEach(button => button.disabled = !available);
  $('run-batch').disabled = !available; $('cancel-batch').hidden = phase !== 'batch' && phase !== 'search'; $('cancel-batch').disabled = cancelling;
  $('export-batch').disabled = !report || busy(); $('export-episode').disabled = !episode;
  $('export-search').hidden = !searchReport; $('export-search').disabled = busy();
  $('timeline').disabled = !episode || phase === 'batch' || phase === 'search';
  $('run-strike').firstChild.textContent = phase === 'error' && !config ? 'Retry physics ' : phase === 'computing' ? 'Simulating… ' : playing ? 'Pause ' : draftChanged ? 'Run strike ' : episode && cursor < episode.frames.length - 1 ? 'Resume ' : episode ? 'Run again ' : 'Run strike ';
  $('scene-mode').textContent = phase === 'batch' ? 'Local batch · physics running' : phase === 'search' ? 'Testing prescribed motions' : playing ? 'Recorded physics · playing' : episode ? 'Recorded physics · paused' : 'Physics view · paused';
  $('run-state').textContent = phase === 'initializing' ? 'Preparing the world' : phase === 'computing' ? 'Computing your strike' : phase === 'batch' ? 'Testing seeded strikes' : phase === 'search' ? 'Finding a swing' : playing ? 'Strike in motion' : episode ? 'Inspect the strike' : 'Ready for your first strike';
}
function showEpisode(next, play = false, atEnd = false) {
  if (!Array.isArray(next?.frames) || !next.frames.length) { receive({ data: { type: 'error', message: 'This run did not contain a recorded trajectory.' } }); return; }
  episode = next; cursor = atEnd ? next.frames.length - 1 : 0; playbackTime = next.frames[cursor]?.time || 0;
  frame = next.frames[cursor]; playing = play && !atEnd; lastTick = 0;
  $('timeline').max = String(Math.max(0, next.frames.length - 1));
  if (next.storageAvailable) $('storage-status').textContent = 'Full run saved on this browser.';
  else if (next.storageAvailable === false) $('storage-status').textContent = 'This run is in memory only. Export it before leaving.';
  draw(); controls();
}
function tick(seconds) {
  if (!playing || !episode) return;
  const frames = episode.frames, end = frames.at(-1).time;
  playbackTime = Math.min(end, playbackTime + Math.max(0, seconds));
  while (cursor + 1 < frames.length && frames[cursor + 1].time <= playbackTime + 1e-9) cursor++;
  frame = frames[cursor];
  if (playbackTime >= end) { playing = false; message(result().success ? 'Target reached. Replay the tip path or try another motion.' : 'The tip missed the target. Adjust the swing or use Find swing.'); controls(); }
  draw();
}
function animate(now) { if (lastTick) tick(Math.min(.1, (now - lastTick) / 1000)); lastTick = now; requestAnimationFrame(animate); }
function send(type, extra = {}) { worker.postMessage({ type, ...extra }); }
function begin(type) {
  const next = readConfig(); if (!next || busy()) return;
  playing = false; autoPlay = type === 'run'; cancelling = false; searchReport = null;
  phase = type === 'batch' ? 'batch' : type === 'search' ? 'search' : 'computing';
  if (type === 'batch') { report = null; $('batch-progress').hidden = false; $('batch-progress').max = count; $('batch-progress').value = 0; $('batch-status').textContent = 'Preparing ' + count + ' local tests…'; }
  message(type === 'search' ? 'Searching 12 prescribed motions for this target. This is a bounded local search, not policy training.' : type === 'batch' ? 'Running local physics tests. Cancellation keeps the completed prefix.' : 'Computing the physical strike. Playback starts when its recording is ready.');
  controls(); send(type, { config: next, ...(type === 'batch' ? { count, seed: next.seed } : {}) });
}
function summarizeReport(next) {
  const status = { complete: 'Complete', cancelled: 'Cancelled', time_limit: 'Time limit reached', storage_error: 'Storage stopped the batch' }[next.status] || next.status;
  $('batch-status').textContent = status + ' · ' + next.completed + '/' + next.requested + ' completed · ' + next.successes + ' target hits · ' + next.misses + ' misses · ' + next.errors + ' errors' + (next.unattempted ? ' · ' + next.unattempted + ' not attempted' : '') + '.';
  $('batch-progress').value = next.cases?.length || next.completed; $('batch-progress').hidden = false;
  $('storage-status').textContent = next.status === 'storage_error' ? 'Storage stopped this batch. Export results now to keep the completed recordings, including any run held in memory.' : 'Completed recordings are saved on this browser. Export results includes the retained full runs.';
}
function download(value, name) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function receive(event) {
  const data = event.data || {};
  if (data.type === 'ready') {
    phase = 'ready'; provenance = data.provenance; fill(data.config); frame = data.frame; episode = null; playing = false; cursor = 0; draftChanged = false; $('timeline').max = '0';
    $('scene-loading').hidden = Boolean(renderer);
    $('model-provenance').textContent = 'Engine: ' + (provenance.engine || 'MuJoCo') + ' ' + (provenance.version || provenance.engineVersion || '') + ' · local browser execution · no learned policy.';
    $('source-provenance').textContent = JSON.stringify(provenance, null, 2);
    message('World ready and paused. Run a strike when you are ready.'); draw(); controls();
  } else if (data.type === 'episode') {
    phase = 'ready'; fill(data.episode.config); draftChanged = false; showEpisode(data.episode, autoPlay); autoPlay = false;
    message('Physics recorded. ' + (playing ? 'Playing the measured trajectory.' : 'Use the timeline to inspect this run.'));
  } else if (data.type === 'progress') {
    const summary = data.summary || {}; $('batch-progress').value = data.processed ?? data.completed;
    $('batch-status').textContent = (data.processed ?? data.completed) + '/' + data.total + ' evaluated · ' + (summary.successes || 0) + ' hits · ' + (summary.misses || 0) + ' misses · ' + (summary.errors || 0) + ' errors.';
    if (data.lastEpisode) showEpisode(data.lastEpisode, false, true);
  } else if (data.type === 'batchComplete') {
    phase = 'ready'; report = data.report; playing = false; summarizeReport(report); message('Local batch finished. Inspect the latest strike or export its retained recordings.'); controls();
  } else if (data.type === 'batchArchive') {
    phase = 'ready'; exportingReport = null; download(data.archive, 'brainsnn-rope-test-recordings.json'); message('Full retained test recordings exported.'); controls();
  } else if (data.type === 'searchProgress') {
    message('Testing motion ' + data.completed + '/' + data.total + ' · best tip distance ' + fixed(data.bestDistance, 3) + ' m.');
  } else if (data.type === 'searchComplete') {
    phase = 'ready'; searchReport = data.searchReport || null;
    if (data.episode) {
      fill(data.episode.config); draftChanged = false; showEpisode(data.episode, true);
      message(data.searchReport?.status === 'complete' ? 'Best tested motion selected. This bounded search does not establish a global optimum.' : 'Search stopped early. Showing its best retained motion; this is an incomplete comparison.');
    } else {
      message('The search did not retain a verified winning motion. Your settings and previous recording are unchanged.', true); controls();
    }
  } else if (data.type === 'error') {
    const fallback = phase === 'exporting' ? exportingReport : null;
    exportingReport = null;
    phase = config ? 'ready' : 'error'; playing = false;
    if (fallback) {
      download({ schema: 'brainsnn.deformable.incomplete-export.v1', report: fallback, recordingError: String(data.message), completeRecordingsIncluded: false }, 'brainsnn-rope-test-summary-incomplete.json');
      message('The full recording archive is unavailable. Exported its summary with the recording error; it contains no full recordings.', true);
    } else message(String(data.message || 'Local physics could not finish. Try another setup.'), true);
    if (!config) $('scene-loading').textContent = 'Local physics could not load. Use Retry physics.';
    controls();
  }
}
function initialize(next = {}) {
  phase = 'initializing'; playing = false; autoPlay = false; searchReport = null; controls();
  send('initialize', { config: clone(next) });
}
function startWorker() {
  worker?.terminate(); worker = new Worker('./simulation-worker.js', { type: 'module' });
  worker.onmessage = receive; worker.onerror = error => { error.preventDefault(); receive({ data: { type: 'error', message: 'The local physics worker could not load. Check your connection and retry.' } }); };
  initialize(config || {});
}

try { renderer = window.BrainSNNDeformableRenderer?.create($('viewport')); } catch { renderer = null; }
if (!renderer) $('scene-loading').textContent = 'The scene renderer did not load. Reload this page to retry.';
$('run-strike').addEventListener('click', () => {
  if (phase === 'error' && !config) return startWorker();
  if (busy()) return;
  if (playing) { playing = false; controls(); message('Playback paused. The recorded physics is unchanged.'); }
  else if (episode && !draftChanged && cursor < episode.frames.length - 1) { playing = true; lastTick = 0; controls(); }
  else begin('run');
});
$('reset-strike').addEventListener('click', () => { const next = readConfig(); if (next && !busy()) initialize(next); });
$('find-swing').addEventListener('click', () => begin('search'));
$('run-batch').addEventListener('click', () => begin('batch'));
$('cancel-batch').addEventListener('click', () => { send('cancel'); cancelling = true; controls(); if (phase === 'search') message('Stopping after the current candidate. Completed candidates remain retained.'); else $('batch-status').textContent = 'Cancelling after the current test; completed runs stay retained.'; });
$('export-episode').addEventListener('click', () => { if (episode) download(episode, 'brainsnn-whip-strike.json'); });
$('export-batch').addEventListener('click', () => { if (report && !busy()) { exportingReport = report; phase = 'exporting'; controls(); send('exportBatch', { journalId: report.journalId }); } });
$('export-search').addEventListener('click', () => { if (searchReport && !busy()) { exportingReport = searchReport; phase = 'exporting'; controls(); send('exportBatch', { journalId: searchReport.journalId }); } });
$('timeline').addEventListener('input', () => { if (!episode) return; playing = false; cursor = Math.max(0, Math.min(episode.frames.length - 1, Number($('timeline').value))); frame = episode.frames[cursor]; playbackTime = frame.time; draw(); controls(); message('Recorded physics paused at ' + fixed(frame.time) + ' s. Use the timeline to inspect the tip path.'); });
document.querySelectorAll('[data-camera]').forEach(button => button.addEventListener('click', () => { renderer?.setCamera(button.dataset.camera); document.querySelectorAll('[data-camera]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); }));
document.querySelectorAll('[data-batch-count]').forEach(button => button.addEventListener('click', () => { if (busy()) return; count = Number(button.dataset.batchCount); document.querySelectorAll('[data-batch-count]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); $('run-batch').firstChild.textContent = 'Run ' + count + ' tests '; }));
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  if (!defaults || busy()) return;
  const next = clone(defaults);
  if (button.dataset.preset === 'sweep') { next.amplitude = Math.min(1.2, next.amplitude * 1.25); next.swingDuration = Math.min(1.25, next.swingDuration * 1.2); }
  if (button.dataset.preset === 'soft') next.young = Math.max(20000, next.young * .4);
  fill(next); draftChanged = true; playing = false; controls(); document.querySelectorAll('[data-preset]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); $('settings-note').textContent = 'Preset selected. Run to test this motion.';
}));
$('strike-settings').addEventListener('input', () => { draftChanged = true; playing = false; controls(); $('settings-note').textContent = 'Settings changed. They apply to your next strike.'; document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', 'false')); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { playing = false; lastTick = 0; controls(); } });
document.addEventListener('keydown', event => { if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return; if (event.code === 'Space') { event.preventDefault(); $('run-strike').click(); } if (event.key.toLowerCase() === 'f') { if (document.fullscreenElement) document.exitFullscreen?.(); else $('viewport').requestFullscreen?.(); } });
document.addEventListener('fullscreenchange', () => renderer?.resize());
window.addEventListener('pagehide', () => { worker?.postMessage({ type: 'cancel' }); worker?.terminate(); playing = false; renderer?.dispose(); });

window.render_game_to_text = () => JSON.stringify({ coordinateSystem: 'Z-up, metres; X forward, Y lateral', phase, playing, time: frame?.time || 0, cursor, frames: episode?.frames?.length || 0, tip: frame?.tip || null, target: frame?.target || null, rope: frame?.rope || [], arm: frame?.arm || [], minDistance: frame?.minDistance ?? null, peakTipSpeed: frame?.peakTipSpeed ?? null, outcome: episode?.outcome || null, config: episode?.config || config, draftChanged, localBatch: report ? { requested: report.requested, completed: report.completed, status: report.status } : null, physicsExecuted: Boolean(frame?.physicsExecuted), policyExecuted: false });
window.advanceTime = async ms => { tick(Math.max(0, Number(ms) || 0) / 1000); return window.render_game_to_text(); };
window.BrainSNNDeformableApp = Object.freeze({ getState: () => JSON.parse(window.render_game_to_text()), getProvenance: () => clone(provenance), pause: () => { playing = false; controls(); } });
startWorker(); requestAnimationFrame(animate);
