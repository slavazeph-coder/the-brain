// Server-only client for a Reachy Mini text-to-motion worker: the open-source
// reachy-motion-generator API (prompt -> planner recipe -> 25 Hz trajectory),
// served by robotics/motion. The website never runs the planner or generator,
// never stores prompts or motions, and never returns the worker address or key.

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT = 1;
const MAX_VARIANTS = 4;
const MAX_PROMPT = 300;
const FPS = 25;
// The generator caps a clip at 28.8 s: 720 frames at 25 Hz, plus frame zero.
const MAX_FRAMES = 721;
const MAX_SEED = 2_147_483_647;
export const MOTION_PLANNERS = Object.freeze({ high: '27B', medium: '4B', low: '0.8B' });

export class MotionFailure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const HTTP_STATUS = Object.freeze({
  invalid_input: 400, effort_unavailable: 400, not_configured: 503, invalid_configuration: 503,
  busy: 429, timeout: 504, planner_failed: 422, authentication_failed: 502, upstream_error: 502,
  invalid_output: 502, response_too_large: 502,
});

export function motionFailureStatus(reason) {
  return HTTP_STATUS[reason] || 502;
}

function configuration(env) {
  const enabled = Boolean(env.MOTION_INFERENCE_URL || env.MOTION_INFERENCE_KEY);
  try {
    const base = new URL(String(env.MOTION_INFERENCE_URL || ''));
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname);
    const key = String(env.MOTION_INFERENCE_KEY || '').trim();
    // A remote worker spends GPU time for every caller, so it must authenticate us.
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))
      || base.username || base.password || base.search || base.hash
      || /[\r\n]/.test(key) || (key && (key.length < 32 || key.length > 256)) || (!loopback && !key)) {
      throw new Error('Invalid configuration');
    }
    const efforts = String(env.MOTION_INFERENCE_EFFORTS || 'medium').split(',').map((value) => value.trim()).filter(Boolean);
    if (!efforts.length || efforts.some((effort) => !MOTION_PLANNERS[effort]) || new Set(efforts).size !== efforts.length) {
      throw new Error('Invalid efforts');
    }
    const requested = Number(env.MOTION_INFERENCE_TIMEOUT_MS);
    // CPU workers need tens of seconds per request; a GPU answers in under one.
    const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(120_000, Math.max(2_000, requested)) : 20_000;
    return { enabled, configured: true, base: base.href.replace(/\/$/, ''), key, efforts, timeoutMs };
  } catch {
    return { enabled, configured: false, efforts: [] };
  }
}

/** Normalise and bound a browser request before it can reach the worker. */
export function validateMotionRequest(body, efforts) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MotionFailure('invalid_input');
  const prompt = typeof body.prompt === 'string' ? body.prompt.replace(/\s+/g, ' ').trim() : '';
  // eslint-disable-next-line no-control-regex
  if (!prompt || prompt.length > MAX_PROMPT || /[\u0000-\u001f\u007f]/.test(prompt)) throw new MotionFailure('invalid_input');
  const n = body.n === undefined ? 1 : body.n;
  const seed = body.seed === undefined ? 0 : body.seed;
  if (!Number.isInteger(n) || n < 1 || n > MAX_VARIANTS || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new MotionFailure('invalid_input');
  }
  const effort = body.effort === undefined ? efforts[0] : body.effort;
  if (typeof effort !== 'string' || !MOTION_PLANNERS[effort]) throw new MotionFailure('invalid_input');
  if (!efforts.includes(effort)) throw new MotionFailure('effort_unavailable');
  return { prompt, n, seed, effort };
}

const round = (value) => Math.round(value * 1e5) / 1e5;

function finite(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new MotionFailure('invalid_output');
  return value;
}

function text(value, max, allowEmpty = false) {
  if (value === undefined && allowEmpty) return '';
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new MotionFailure('invalid_output');
  return value.trim();
}

// A head pose is a rigid transform: orthonormal rotation, millimetre-scale
// translation and a homogeneous bottom row. Anything else is not a Reachy pose.
function headPose(value) {
  if (!Array.isArray(value) || value.length !== 4 || value.some((row) => !Array.isArray(row) || row.length !== 4)) {
    throw new MotionFailure('invalid_output');
  }
  const pose = value.map((row) => row.map((cell) => finite(cell, -1.5, 1.5)));
  for (let column = 0; column < 3; column += 1) {
    const norm = Math.hypot(pose[0][column], pose[1][column], pose[2][column]);
    if (Math.abs(norm - 1) > 1e-3 || Math.abs(pose[3][column]) > 1e-6) throw new MotionFailure('invalid_output');
  }
  for (let row = 0; row < 3; row += 1) finite(pose[row][3], -0.1, 0.1);
  if (Math.abs(pose[3][3] - 1) > 1e-6) throw new MotionFailure('invalid_output');
  return pose.map((row) => row.map(round));
}

/** Rebuild one SDK recorded move from validated fields only. */
export function validateMove(move, description) {
  if (!move || typeof move !== 'object' || Array.isArray(move)) throw new MotionFailure('invalid_output');
  const { time, set_target_data: frames } = move;
  if (!Array.isArray(time) || time.length < 2 || time.length > MAX_FRAMES
    || !Array.isArray(frames) || frames.length !== time.length) throw new MotionFailure('invalid_output');
  const times = time.map((value) => finite(value, 0, MAX_FRAMES / FPS + 0.5));
  if (times[0] > 0.05) throw new MotionFailure('invalid_output');
  for (let index = 1; index < times.length; index += 1) {
    const step = times[index] - times[index - 1];
    if (step < 0.5 / FPS || step > 2 / FPS) throw new MotionFailure('invalid_output');
  }
  return {
    description,
    time: times.map(round),
    set_target_data: frames.map((frame) => {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)
        || !Array.isArray(frame.antennas) || frame.antennas.length !== 2) throw new MotionFailure('invalid_output');
      const target = {
        head: headPose(frame.head),
        antennas: frame.antennas.map((value) => round(finite(value, -3.5, 3.5))),
        body_yaw: round(finite(frame.body_yaw ?? 0, -Math.PI, Math.PI)),
      };
      // The SDK's recorded-move frames carry this flag; keep it so downloads replay unchanged.
      if (typeof frame.check_collision === 'boolean') target.check_collision = frame.check_collision;
      return target;
    }),
  };
}

function timing(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const name of ['planner', 'generator', 'reachability', 'total']) {
    if (value[name] !== undefined) out[name] = Math.round(finite(value[name], 0, 600_000));
  }
  return out;
}

/** Provider-controlled extras never reach the browser: every field is rebuilt. */
export function validateMotionResponse(body, request) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MotionFailure('invalid_output');
  if (body.effort !== undefined && body.effort !== request.effort) throw new MotionFailure('invalid_output');
  if (!Array.isArray(body.moves) || body.moves.length !== request.n) throw new MotionFailure('invalid_output');
  const moves = body.moves.map((move) => validateMove(move, request.prompt));
  return {
    prompt: request.prompt,
    effort: request.effort,
    planner: MOTION_PLANNERS[request.effort],
    seed: request.seed,
    idea: text(body.idea, 600, true),
    recipe: text(body.recipe, 2000),
    moves,
    durations_s: moves.map((move) => round(move.time[move.time.length - 1] - move.time[0])),
    timing_ms: timing(body.timing_ms),
  };
}

async function readJson(response, byteLimit) {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new MotionFailure(response.status === 401 || response.status === 403 ? 'authentication_failed'
      : response.status === 422 ? 'planner_failed'
        : response.status === 429 || response.status === 503 ? 'busy' : 'upstream_error');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')
    || Number(response.headers.get('content-length')) > byteLimit) {
    void response.body?.cancel().catch(() => {});
    throw new MotionFailure(Number(response.headers.get('content-length')) > byteLimit ? 'response_too_large' : 'invalid_output');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MotionFailure('invalid_output');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > byteLimit) throw new MotionFailure('response_too_large');
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    } catch {
      throw new MotionFailure('invalid_output');
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** @param {Record<string, string | undefined>} env */
export function createMotionWorkerClient(env = {}, { fetchImpl = globalThis.fetch, timeoutMs, maxConcurrent = MAX_CONCURRENT, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
  const config = configuration(env);
  let inFlight = 0;
  let status = config.configured ? 'unverified' : config.enabled ? 'invalid_configuration' : 'not_configured';
  let lastSuccessAt = null;
  let lastFailure = null;

  const snapshot = () => ({
    configured: config.configured, status, inFlight, maxConcurrent, maxVariants: MAX_VARIANTS, maxPromptLength: MAX_PROMPT,
    efforts: config.efforts.map((effort) => ({ effort, planner: MOTION_PLANNERS[effort] })),
    lastSuccessAt, lastFailure,
  });

  // One deadline covers connection, headers, the whole stream and validation.
  async function generate(body) {
    if (!config.configured) throw new MotionFailure(status);
    const request = validateMotionRequest(body, config.efforts);
    if (inFlight >= maxConcurrent) throw new MotionFailure('busy');
    inFlight += 1;
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetchImpl(`${config.base}/generate-dense`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) },
            body: JSON.stringify({ ...request, retries: 2 }),
            redirect: 'error', signal: controller.signal,
          });
          return validateMotionResponse(await readJson(response, maxResponseBytes), request);
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new MotionFailure('timeout'));
            controller.abort();
          }, timeoutMs ?? config.timeoutMs);
        }),
      ]);
      status = 'online';
      lastSuccessAt = new Date().toISOString();
      lastFailure = null;
      return result;
    } catch (error) {
      const reason = error instanceof MotionFailure ? error.reason : 'upstream_error';
      // A planner that could not write a valid recipe is a model answer, not an outage.
      if (reason !== 'planner_failed') {
        status = 'degraded';
        lastFailure = { reason, at: new Date().toISOString() };
      }
      throw new MotionFailure(reason);
    } finally {
      clearTimeout(timer);
      controller.abort();
      inFlight -= 1;
    }
  }

  return { configured: config.configured, snapshot, generate };
}
