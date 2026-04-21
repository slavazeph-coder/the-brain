/**
 * Layer 65 — Firewall Replay
 *
 * Record a scan session as an ordered list of step objects (scan,
 * apply-to-brain, share, etc.). Export as 'brainsnn-replay-v1'
 * JSON; import elsewhere to watch the session play back step-by-step.
 *
 * Keeps the memory in a single module-level array — the caller
 * starts/stops recording and emits events via pushStep().
 */

const RECORDING_KEY = 'brainsnn_replay_recording_v1';
const VERSION = 'brainsnn-replay-v1';
const MAX_STEPS = 200;

let _recording = null; // Array<step> or null

function readPersisted() {
  try { return JSON.parse(localStorage.getItem(RECORDING_KEY) || 'null'); } catch { return null; }
}
function writePersisted(list) {
  try { localStorage.setItem(RECORDING_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

export function isRecording() { return _recording !== null; }

export function startRecording() {
  _recording = readPersisted() || [];
  return _recording.length;
}

export function stopRecording() {
  const finalList = _recording || [];
  _recording = null;
  writePersisted(finalList);
  return finalList;
}

export function resetRecording() {
  _recording = null;
  try { localStorage.removeItem(RECORDING_KEY); } catch { /* noop */ }
}

/**
 * Record a step. Safe to call even when recording is off (no-op).
 * Kinds we use: 'scan', 'apply', 'share', 'template-click',
 * 'neutralize', 'scenario', 'note'.
 */
export function pushStep(step) {
  if (_recording == null) return;
  _recording.push({
    ts: Date.now(),
    ...step,
  });
  if (_recording.length > MAX_STEPS) _recording = _recording.slice(-MAX_STEPS);
  writePersisted(_recording);
}

export function currentSteps() {
  return _recording ? [..._recording] : (readPersisted() || []);
}

export function exportReplay({ title = 'Untitled session' } = {}) {
  const steps = currentSteps();
  return JSON.stringify({
    brainsnn: VERSION,
    title: String(title || '').slice(0, 100),
    exportedAt: new Date().toISOString(),
    stepCount: steps.length,
    steps,
  }, null, 2);
}

export function parseReplay(json) {
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('invalid JSON'); }
  if (data.brainsnn !== VERSION) throw new Error(`unsupported replay version: ${data.brainsnn}`);
  if (!Array.isArray(data.steps)) throw new Error('bundle has no steps');
  return {
    title: data.title || 'Imported replay',
    exportedAt: data.exportedAt || '',
    steps: data.steps.slice(0, MAX_STEPS),
  };
}

export function formatStep(step) {
  const dt = new Date(step.ts).toISOString().slice(11, 19);
  switch (step.kind) {
    case 'scan':
      return `${dt}  SCAN  "${(step.text || '').slice(0, 100)}" → ${Math.round((step.pressure || 0) * 100)}%`;
    case 'apply':
      return `${dt}  APPLY  pressure ${Math.round((step.pressure || 0) * 100)}%`;
    case 'share':
      return `${dt}  SHARE  ${step.kind2 || 'reaction'} → ${step.url || ''}`;
    case 'neutralize':
      return `${dt}  NEUTRALIZE  engine=${step.engine || 'local'}  pressure ${Math.round((step.before || 0) * 100)} → ${Math.round((step.after || 0) * 100)}`;
    case 'scenario':
      return `${dt}  SCENARIO  ${step.scenario || '?'}`;
    case 'template-click':
      return `${dt}  TEMPLATE  ${step.id || '?'}`;
    case 'note':
      return `${dt}  NOTE  ${step.text || ''}`;
    default:
      return `${dt}  ${step.kind || 'step'}`;
  }
}
