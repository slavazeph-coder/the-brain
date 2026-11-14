import { estimateSupport } from './movement-support.mjs';
import { MAX_MOT_BYTES, parseOpenSimKnees } from './movement-opensim.mjs';

const panel = document.getElementById('mot-panel');
panel.innerHTML = `<details><summary>Review an OpenSim motion file</summary>
  <p>Inspect the signed left and right knee coordinates from an existing model on its own time axis.</p>
  <label>OpenSim motion (.mot) <input type="file" id="mot-file" accept=".mot,text/plain"></label>
  <p id="mot-status" role="status">The file needs time, a knee_angle_l or knee_angle_r column, and declared angular units.</p>
  <div id="mot-controls" hidden><label>Model sample <input id="mot-frame" type="range" min="0" step="1" value="0"></label>
    <output id="mot-readout" for="mot-frame"></output>
    <button type="button" id="mot-save">Export model coordinates</button></div></details>`;
const control = id => panel.querySelector('#' + id);
const status = control('mot-status'), frame = control('mot-frame'), fileInput = control('mot-file');
let report = null;
let generation = 0;
const pretty = value => String(Number(value.toFixed(4)));
function render() {
  const point = report.frames[Number(frame.value)];
  const parts = report.availableSides.map(side => `${side === 'left' ? 'Left' : 'Right'} ${pretty(point[side])}°`);
  control('mot-readout').textContent = `${pretty(point.time)} s · ${parts.join(' · ')}`;
}
fileInput.addEventListener('change', async () => {
  const ticket = ++generation, file = fileInput.files[0];
  report = null;
  control('mot-controls').hidden = true;
  if (!file) { status.textContent = 'Choose an OpenSim motion file.'; return; }
  status.textContent = 'Reading motion file…';
  try {
    if (file.size > MAX_MOT_BYTES) throw new Error('Choose an OpenSim motion file of 4 MiB or less.');
    const bytes = await file.arrayBuffer();
    const parsed = parseOpenSimKnees(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (ticket !== generation) return;
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
    report = { schema:'brainsnn.model-knee-motion.v1', source:{name:file.name, sha256}, ...parsed,
      angleUnits:'degrees', timeUnits:'seconds', method:'Imported signed model knee coordinates. The source model defines the sign and zero.' };
    frame.max = String(parsed.frames.length - 1);
    frame.value = '0';
    frame.disabled = parsed.frames.length === 1;
    control('mot-controls').hidden = false;
    status.textContent = `${file.name} · ${parsed.frames.length} samples · input in ${parsed.sourceUnits}.`;
    render();
  } catch(error) {
    if (ticket === generation) status.textContent = error.message;
  }
});
frame.addEventListener('input', () => { if (report) render(); });
control('mot-save').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'brainsnn-model-knee-motion.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const support = document.getElementById('support-model');
support.innerHTML = `<details><summary>Estimate vertical force from whole-body movement</summary>
  <p>Supply mass and calibrated whole-body centre-of-mass acceleration. Use the upward world axis in m/s², with gravity excluded. A phone accelerometer or an individual joint follows a different trajectory.</p>
  <div class="form"><label>Mass (kg)<input id="support-mass" type="number" min="0.01" max="1000" step="any"></label>
  <label>Acceleration source<input id="support-label" placeholder="e.g. Whole-body motion analysis" maxlength="160"></label>
  <label>Video time offset (s)<input id="support-offset" type="number" step="any" value="0"></label>
  <label>Acceleration CSV<input id="support-file" type="file" accept=".csv,text/csv,text/plain"></label></div>
  <p class="help">CSV header <code>time_s,com_az_m_s2</code>. The model estimates the combined vertical support from all contacts. With feet as the only contact, this is total vertical ground reaction.</p>
  <button type="button" id="support-apply">Use estimated force</button><p role="status" id="support-status"></p>
  </details>`;
const input = id => support.querySelector('#support-' + id);
let supportGeneration = 0;
function invalidateSupportRead() { ++supportGeneration; }
support.addEventListener('input', invalidateSupportRead);
for (const id of ['apply-force','clear-force']) document.getElementById(id).addEventListener('click', invalidateSupportRead);
function clearSupportInputs() {
  invalidateSupportRead();
  for (const id of ['file','mass','label']) input(id).value = '';
  input('offset').value = '0';
  input('status').textContent = '';
}
document.querySelector('#video-file').addEventListener('change', clearSupportInputs);
document.querySelector('#demo').addEventListener('click', clearSupportInputs);
input('apply').addEventListener('click', async () => {
  const ticket = ++supportGeneration;
  support.dispatchEvent(new Event('movement-support-start'));
  try {
    const file = input('file').files[0];
    if (!file || file.size > 8 * 1024 * 1024) throw new Error('Choose an acceleration CSV of up to 8 MiB.');
    const csv = await file.text();
    if (ticket !== supportGeneration) return;
    const trace = estimateSupport(csv,{massKg:input('mass').valueAsNumber,sourceLabel:input('label').value,offsetSeconds:input('offset').valueAsNumber});
    trace.model.fileName = file.name;
    support.dispatchEvent(new CustomEvent('movement-support-trace',{detail:trace}));
    input('status').textContent = `${trace.samples.length} samples processed using mass × (upward acceleration + 9.80665 m/s²).`;
  } catch(error) { if (ticket === supportGeneration) input('status').textContent = error.message; }
});
