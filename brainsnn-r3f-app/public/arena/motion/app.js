/* Expressive motion workspace: instruction -> motion worker (or recorded example) -> simulated Reachy Mini. */
const $ = (id) => document.getElementById(id);
const PLANNER_LABEL = { high: '27B · best quality', medium: '4B · balanced', low: '0.8B · fastest' };
const FAILURE = {
  invalid_input: 'Use a short instruction of up to 300 characters.',
  effort_unavailable: 'That planner is not loaded on the motion worker.',
  not_configured: 'No motion worker is connected. Recorded examples still play.',
  invalid_configuration: 'The motion worker is not configured correctly. Recorded examples still play.',
  busy: 'The motion worker is busy with another request. Try again in a moment.',
  timeout: 'The motion worker did not answer in time. Try again, or pick an example.',
  planner_failed: 'The planner could not write a valid motion for that instruction. Try rephrasing it as "feeling. one sentence of context."',
  authentication_failed: 'The motion worker refused the website. Recorded examples still play.',
};
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let viewer = null, current = null, variant = 0, worker = null, generating = false;

function message(text, kind = '') {
  const node = $('run-message');
  node.textContent = text;
  node.className = 'run-message' + (kind ? ' ' + kind : '');
}

function headline(prompt) {
  const first = String(prompt || 'Motion').split('.')[0].trim();
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function isMove(value) {
  return value && Array.isArray(value.time) && Array.isArray(value.set_target_data) && value.time.length >= 2
    && value.time.length === value.set_target_data.length && value.time.length <= 2000
    && value.time.every(Number.isFinite)
    && value.set_target_data.every((frame) => Array.isArray(frame?.head) && frame.head.length === 4
      && frame.head.every((row) => Array.isArray(row) && row.length === 4 && row.every(Number.isFinite))
      && Array.isArray(frame.antennas) && frame.antennas.length === 2 && frame.antennas.every(Number.isFinite)
      && Number.isFinite(frame.body_yaw ?? 0));
}

/** A /generate-dense response, a single SDK move, or a list of moves. */
function fromFile(value, name) {
  const moves = Array.isArray(value?.moves) ? value.moves : isMove(value) ? [value] : Array.isArray(value) ? value : null;
  if (!moves?.length || moves.length > 16 || !moves.every(isMove)) throw new Error('not a Reachy Mini move or motion response');
  return { prompt: value.prompt || value.description || name.replace(/\.json$/i, ''), idea: value.idea || '', recipe: value.recipe || '',
    moves, source: 'file', label: 'Opened file' };
}

// Approximate head angles for the channel chart (ZYX), antennas and body yaw, in degrees.
function channels(move) {
  const deg = 180 / Math.PI;
  return move.set_target_data.map((frame) => {
    const r = frame.head;
    return [Math.asin(Math.max(-1, Math.min(1, -r[2][0]))) * deg, Math.atan2(r[2][1], r[2][2]) * deg, Math.atan2(r[1][0], r[0][0]) * deg,
      frame.antennas[0] * deg, frame.antennas[1] * deg, (frame.body_yaw || 0) * deg];
  });
}

const COLORS = ['#68eaff', '#947cff', '#8ce0c8', '#ff9fd0', '#ff9fd0', '#efb78a'];
let chart = null;
function drawChart(playhead = null) {
  const canvas = $('channels'), context = canvas.getContext('2d');
  const width = canvas.clientWidth || 600, height = canvas.clientHeight || 120, ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#1d3342'; context.lineWidth = 1;
  context.beginPath(); context.moveTo(0, height / 2 + 6); context.lineTo(width, height / 2 + 6); context.stroke();
  if (!chart) return;
  // Antennas sweep far wider than the head, so each group gets its own vertical scale.
  const { values, times, headScale, antennaScale } = chart, duration = times[times.length - 1] || 1;
  const x = (t) => (t / duration) * (width - 2) + 1;
  values[0].forEach((_, channel) => {
    const scale = channel === 3 || channel === 4 ? antennaScale : headScale, y = (v) => height / 2 + 6 - (v / scale) * (height / 2 - 14);
    context.strokeStyle = COLORS[channel]; context.globalAlpha = channel === 4 ? 0.55 : 0.95; context.lineWidth = 1.4;
    context.beginPath();
    values.forEach((row, index) => (index ? context.lineTo(x(times[index]), y(row[channel])) : context.moveTo(x(times[index]), y(row[channel]))));
    context.stroke();
  });
  context.globalAlpha = 1;
  context.fillStyle = '#7d94ae'; context.font = '9px system-ui';
  context.fillText(`head & body ±${Math.round(headScale)}°`, 4, 11);
  const label = `antennas ±${Math.round(antennaScale)}°`;
  context.fillText(label, width - context.measureText(label).width - 4, 11);
  if (playhead !== null) {
    context.strokeStyle = '#ffffffaa'; context.beginPath(); context.moveTo(x(playhead), 0); context.lineTo(x(playhead), height); context.stroke();
  }
}

function play(index) {
  variant = index;
  const move = current.moves[index];
  [...$('variant-tabs').children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  const values = channels(move), times = move.time.map((t) => t - move.time[0]);
  const peak = (columns) => Math.max(10, ...values.flatMap((row) => columns.map((column) => Math.abs(row[column]))));
  chart = { values, times, headScale: peak([0, 1, 2, 5]), antennaScale: peak([3, 4]) };
  drawChart(0);
  const duration = times[times.length - 1];
  $('duration').textContent = `${duration.toFixed(1)} s`;
  if (viewer?.available) {
    const loaded = viewer.load(move);
    if (reducedMotion && current.source === 'example' && !current.userChose) viewer.toggle();
    if (loaded.unreachable) message(`${loaded.unreachable} frame(s) were outside the reachable set and hold the previous pose.`, 'error');
  }
  syncPlay();
  $('download').disabled = false;
  ['restart', 'timeline'].forEach((id) => { $(id).disabled = !viewer?.available; });
}

function show(result) {
  current = result;
  $('motion-title').textContent = headline(result.prompt);
  $('source-label').textContent = result.source === 'live_worker' ? 'LIVE · GENERATED NOW' : result.source === 'example' ? 'RECORDED EXAMPLE · PRE-GENERATED' : 'OPENED FILE';
  $('idea').textContent = result.idea || '—';
  $('recipe').textContent = result.recipe || '—';
  $('planner').textContent = result.source === 'live_worker' ? (result.planner || '—') + ' · live' : result.source === 'example' ? '27B · recorded' : '—';
  const total = result.timing_ms?.total;
  $('latency-label').textContent = result.source === 'live_worker' ? 'Generation time' : 'Generation';
  $('latency').textContent = result.source === 'live_worker' && Number.isFinite(total) ? (total >= 1000 ? `${(total / 1000).toFixed(1)} s` : `${total} ms`) : result.source === 'example' ? 'Pre-generated' : '—';
  $('latency').classList.toggle('small', result.source !== 'live_worker');
  $('planner').classList.toggle('small', result.source !== 'live_worker');
  const tabs = $('variant-tabs');
  tabs.replaceChildren(...result.moves.map((_, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = String(index + 1); button.setAttribute('aria-label', `Variation ${index + 1}`);
    button.addEventListener('click', () => play(index));
    return button;
  }));
  tabs.hidden = result.moves.length < 2;
  play(0);
}

function syncPlay() {
  const playing = viewer?.available && viewer.playing();
  $('play').disabled = !viewer?.available || !current;
  $('play').textContent = playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

async function loadExamples() {
  const box = $('examples');
  try {
    const response = await fetch('./examples.json');
    if (!response.ok) throw new Error(String(response.status));
    const examples = (await response.json()).filter((example) => Array.isArray(example.moves) && example.moves.every(isMove));
    box.replaceChildren(...examples.map((example, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = headline(example.prompt); button.title = example.prompt;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        [...box.children].forEach((node) => node.setAttribute('aria-pressed', String(node === button)));
        show({ ...example, source: 'example', userChose: true });
        message(`Recorded example: “${example.prompt}”`);
      });
      if (index === 0) button.setAttribute('aria-pressed', 'true');
      return button;
    }));
    if (examples.length && !current) {
      show({ ...examples[0], source: 'example' });
      message(`Recorded example: “${examples[0].prompt}”`);
    }
  } catch {
    box.replaceChildren(Object.assign(document.createElement('p'), { className: 'field-caption', textContent: 'Examples could not be loaded.' }));
  }
}

async function loadWorker() {
  const note = $('worker-note'), select = $('effort');
  try {
    const response = await fetch('/api/motion/status', { cache: 'no-store' });
    worker = response.ok ? await response.json() : null;
  } catch { worker = null; }
  if (worker?.configured && worker.efforts?.length) {
    select.replaceChildren(...worker.efforts.map(({ effort, planner }) => Object.assign(document.createElement('option'), { value: effort, textContent: PLANNER_LABEL[effort] || planner })));
    select.disabled = false;
    $('generate').disabled = false;
    $('prompt').maxLength = worker.maxPromptLength || 300;
    [...$('variants').options].forEach((option) => { option.disabled = Number(option.value) > (worker.maxVariants || 1); });
    note.textContent = worker.status === 'degraded'
      ? 'The motion worker failed its last request. You can still try; recorded examples always play.'
      : `Motion worker connected · ${worker.efforts.map(({ planner }) => planner).join(', ')} planner.`;
    note.className = 'worker-note' + (worker.status === 'degraded' ? ' error' : '');
  } else {
    note.textContent = worker?.status === 'invalid_configuration' ? FAILURE.invalid_configuration : FAILURE.not_configured;
    note.className = 'worker-note offline';
  }
}

async function generate(event) {
  event.preventDefault();
  if (generating || !worker?.configured) return;
  const prompt = $('prompt').value.replace(/\s+/g, ' ').trim();
  if (!prompt) { $('prompt').setAttribute('aria-invalid', 'true'); $('prompt').focus(); message('Describe the behaviour first.', 'error'); return; }
  $('prompt').removeAttribute('aria-invalid');
  generating = true;
  const button = $('generate'), started = performance.now();
  button.disabled = true;
  const timer = setInterval(() => message(`Planning and generating… ${((performance.now() - started) / 1000).toFixed(0)} s`), 500);
  message('Planning and generating…');
  try {
    const response = await fetch('/api/motion/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, effort: $('effort').value, n: Number($('variants').value), seed: Math.floor(Math.random() * 2 ** 31) }),
    });
    const body = await response.json().catch(() => ({}));
    // 429 is either the worker being busy or the site's per-visitor limit; both mean "try again shortly".
    if (!response.ok) throw Object.assign(new Error(body.error || 'upstream_error'), { reason: response.status === 429 ? 'busy' : body.error });
    [...$('examples').children].forEach((node) => node.setAttribute?.('aria-pressed', 'false'));
    show({ ...body, source: 'live_worker' });
    message(`Generated by the ${body.planner} planner for “${body.prompt}”.`);
  } catch (error) {
    message(FAILURE[error.reason] || 'The motion worker could not complete this request. Recorded examples still play.', 'error');
  } finally {
    clearInterval(timer);
    generating = false;
    button.disabled = false;
  }
}

function download() {
  if (!current) return;
  const move = current.moves[variant];
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(move)], { type: 'application/json' }));
  link.download = `${headline(current.prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'move'}-${variant + 1}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function openFile(file) {
  if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('the file is larger than 5 MB');
    show(fromFile(JSON.parse(await file.text()), file.name));
    [...$('examples').children].forEach((node) => node.setAttribute?.('aria-pressed', 'false'));
    message(`Opened ${file.name}.`);
  } catch (error) {
    message(`${file.name}: ${error.message}`, 'error');
  }
}

async function main() {
  $('motion-form').addEventListener('submit', generate);
  $('prompt').addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('motion-form').requestSubmit(); });
  $('play').addEventListener('click', () => { viewer?.toggle(); syncPlay(); });
  $('restart').addEventListener('click', () => { viewer?.restart(); syncPlay(); });
  $('timeline').addEventListener('input', (event) => viewer?.seek(Number(event.target.value) / 1000));
  $('speed').addEventListener('change', (event) => viewer?.setSpeed(Number(event.target.value)));
  $('loop').addEventListener('change', (event) => viewer?.setLoop(event.target.checked));
  $('download').addEventListener('click', download);
  $('file').addEventListener('change', (event) => { openFile(event.target.files[0]); event.target.value = ''; });
  document.querySelectorAll('[data-camera]').forEach((button) => button.addEventListener('click', () => {
    viewer?.setCamera?.(button.dataset.camera);
    document.querySelectorAll('[data-camera]').forEach((node) => node.setAttribute('aria-pressed', String(node === button)));
  }));
  new ResizeObserver(() => drawChart()).observe($('channels'));
  drawChart();

  const workerReady = loadWorker();
  try {
    viewer = await window.BrainSNNMotionRenderer.create($('viewport'), { assetBase: './robot/' });
    if (!viewer.available) throw new Error('webgl');
    $('scene-loading').hidden = true;
    $('scene-mode').textContent = 'Kinematic playback · no robot connected';
    viewer.onTick((time, duration) => {
      $('time-label').textContent = `${time.toFixed(1)} s`;
      if (document.activeElement !== $('timeline')) $('timeline').value = String(Math.round((time / (duration || 1)) * 1000));
      drawChart(time);
    });
  } catch {
    viewer = null;
    $('scene-loading').textContent = '3D view unavailable in this browser. The channel chart still shows each motion.';
    $('scene-mode').textContent = '3D view unavailable';
  }
  await loadExamples();
  await workerReady;
  window.BrainSNNMotion = Object.freeze({
    state: () => ({ source: current?.source || null, prompt: current?.prompt || null, moves: current?.moves.length || 0, variant,
      frames: current?.moves[variant]?.time.length || 0, playing: Boolean(viewer?.playing()), frame: viewer?.frame?.() ?? -1,
      viewer: Boolean(viewer?.available), worker: worker ? { configured: worker.configured, status: worker.status } : null }),
  });
  document.documentElement.dataset.motionReady = 'true';
}

main();
