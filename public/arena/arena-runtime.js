/* BrainSNN v1: authenticated, server-authoritative physics/policy sessions. */
(() => {
  'use strict';
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const statuses = ['ready', 'running', 'paused', 'succeeded', 'failed', 'error'];
  const knownCommands = ['run', 'pause', 'step', 'reset', 'intervene', 'branch'];
  class RuntimeError extends Error {
    constructor(code, message) { super(message); this.name = 'RuntimeError'; this.code = code; }
  }
  const fail = (code, message) => { throw new RuntimeError(code, message); };
  const checkpointKey = value => typeof value === 'string' && value.startsWith('gs://') ? value.replace(/\/+$/, '') : value;
  function normalizeSelection(input = {}) {
    if (!object(input)) fail('selection_required', 'Choose both a robot and a model before creating a session.');
    if (!nonempty(input.robotId) || !nonempty(input.modelId)) fail('selection_required', 'Choose both a robot and a model. Your selection has been preserved.');
    const seed = Number(input.seed ?? 42);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647 || String(input.seed ?? 42).trim() === '') fail('invalid_seed', 'Use a whole-number seed between 0 and 2147483647.');
    const protocol = input.protocol || 'practice';
    if (!['practice', 'benchmark'].includes(protocol)) fail('invalid_protocol', 'Choose practice or benchmark mode.');
    return { robotId: String(input.robotId), modelId: String(input.modelId),
      ...(input.profileId ? { profileId: String(input.profileId) } : {}),
      task: String(input.task ?? '').slice(0, 300), seed, protocol };
  }
  function endpointURL(raw) {
    let url;
    try { url = new URL(raw); } catch { fail('invalid_url', 'Enter a complete worker URL, such as https://worker.example.com.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) fail('insecure_url', 'Use HTTPS for a remote worker. HTTP is allowed only for localhost development.');
    if (url.username || url.password || url.search || url.hash) fail('invalid_url', 'Use a worker base URL without credentials, query parameters or a fragment.');
    return url.href.replace(/\/+$/, '');
  }
  function validateProfile(p) {
    if (!object(p) || !['id', 'robotId', 'modelId', 'adapter'].every(k => nonempty(p[k])) || typeof p.ready !== 'boolean') fail('invalid_capabilities', 'The worker returned an incomplete profile identity or readiness state.');
    if (!Array.isArray(p.commands) || p.commands.some(c => !knownCommands.includes(c)) || !Array.isArray(p.protocols) || !p.protocols.length || p.protocols.some(v => !['practice', 'benchmark'].includes(v))) fail('invalid_capabilities', 'The worker must declare its supported commands and experiment protocols.');
    if (!Array.isArray(p.tasks) || p.tasks.some(t => !object(t) || !nonempty(t.id) || !nonempty(t.label))) fail('invalid_capabilities', 'The worker must return a labelled task list.');
    if (!Array.isArray(p.cameras) || p.cameras.some(c => !object(c) || !nonempty(c.id) || !Number.isInteger(c.width) || !Number.isInteger(c.height) || c.width < 1 || c.height < 1 || c.width > 8192 || c.height > 8192 || !['policy', 'spectator'].includes(c.role))) fail('invalid_capabilities', 'The worker returned an invalid camera contract.');
    if (new Set(p.cameras.map(c => c.id)).size !== p.cameras.length) fail('invalid_capabilities', 'Camera IDs must be unique.');
    if (!object(p.action) || !Number.isInteger(p.action.size) || p.action.size < 1 || !nonempty(p.action.space) || !nonempty(p.action.controller) || !object(p.state) || (p.state.size != null && (!Number.isInteger(p.state.size) || p.state.size < 1))) fail('invalid_capabilities', 'The worker returned an invalid observation or action contract.');
    if (p.ready && (!nonempty(p.checkpoint) || !nonempty(p.checkpointRevision) || !object(p.simulator) || !nonempty(p.simulator.name) || !nonempty(p.simulator.version) || !Number.isInteger(p.state.size))) fail('unversioned_profile', 'A ready worker must identify the checkpoint revision, simulator version and observation dimensions.');
    const expected = window.BrainSNNArenaProfiles?.find?.(p.id);
    if (expected) {
      for (const k of ['robotId', 'modelId', 'adapter']) if (expected[k] !== p[k]) fail('profile_mismatch', 'The worker changed the registered ' + k + ' for ' + p.id + '.');
      if (expected.checkpoint && checkpointKey(p.checkpoint) !== checkpointKey(expected.checkpoint)) fail('checkpoint_mismatch', 'The worker checkpoint does not match this exact recipe.');
      for (const k of ['size', 'space', 'controller']) if (expected.action[k] != null && expected.action[k] !== p.action[k]) fail('action_mismatch', 'The worker action contract does not match this robot and model.');
      if (expected.state.size != null && p.state.size !== expected.state.size) fail('state_mismatch', 'The worker observation dimensions do not match this recipe.');
      if (expected.timing && Object.entries(expected.timing).some(([key, value]) => p.timing?.[key] !== value)) fail('timing_mismatch', 'The worker control rate or action chunk differs from the selected evaluation recipe.');
      for (const wanted of expected.cameras) {
        const found = p.cameras.find(c => c.id === wanted.id);
        if (!found || ['width', 'height', 'role', 'sourceWidth', 'sourceHeight', 'rotation'].some(k => wanted[k] != null && wanted[k] !== found[k])) fail('camera_mismatch', 'The worker camera processing does not match the selected checkpoint.');
      }
    }
    return clone(p);
  }
  function validateCapabilities(raw) {
    if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.profiles) || raw.profiles.length > 500) fail('invalid_capabilities', 'This endpoint does not provide BrainSNN Arena protocol v1 capabilities.');
    const result = { ...raw, profiles: raw.profiles.map(validateProfile) };
    if (new Set(result.profiles.map(p => p.id)).size !== result.profiles.length) fail('invalid_capabilities', 'The worker returned duplicate profile IDs.');
    if (raw.recordings != null && (!object(raw.recordings) || raw.recordings.schema !== 'brainsnn.arena.recording.v1' || raw.recordings.readOnly !== true)) fail('invalid_capabilities', 'The worker advertised an unsupported recording contract.');
    return result;
  }
  function findProfile(capabilities, selection) {
    const matches = capabilities.profiles.filter(p => p.robotId === selection.robotId && p.modelId === selection.modelId && (!selection.profileId || p.id === selection.profileId));
    if (!matches.length) fail('unsupported_pair', 'This worker has no exact ' + selection.robotId + ' + ' + selection.modelId + ' profile. Your selection is preserved; connect a matching worker.');
    if (matches.length > 1 && !selection.profileId) fail('ambiguous_profile', 'This worker offers multiple checkpoints for the selected pair. Choose an exact profile.');
    const p = matches[0];
    if (!p.protocols.includes(selection.protocol)) fail('unsupported_protocol', 'This profile does not support ' + selection.protocol + ' mode.');
    return p;
  }
  function sameContract(a, b) {
    const sorted = value => Array.isArray(value) ? value.map(sorted) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
    const canonical = p => ({ id: p.id, robotId: p.robotId, modelId: p.modelId, checkpoint: checkpointKey(p.checkpoint), checkpointRevision: p.checkpointRevision,
      adapter: p.adapter, adapterVersion: p.adapterVersion, policyCodeRevision: p.policyCodeRevision, action: p.action, state: p.state, cameras: p.cameras, simulator: p.simulator, timing: p.timing, commands: p.commands, protocols: p.protocols, tasks: p.tasks });
    return JSON.stringify(sorted(canonical(a))) === JSON.stringify(sorted(canonical(b)));
  }
  function createClient(options = {}) {
    const fetcher = options.fetch || window.fetch?.bind(window);
    if (!fetcher) fail('fetch_unavailable', 'This browser cannot connect to a runtime worker.');
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(10, options.timeoutMs) : 20000;
    const startupTimeoutMs = Number.isFinite(options.startupTimeoutMs) ? Math.max(10, options.startupTimeoutMs) : 100000;
    const pollMs = Number.isFinite(options.pollMs) ? Math.max(20, options.pollMs) : 180;
    let url = '', token = '', epoch = 0, pollTimer = null, tail = Promise.resolve(), requestNumber = 0;
    let lastSeq = -1, session = null;
    const requests = new Set();
    let state = { status: 'disconnected', message: 'Connect a physics and policy worker to begin.', profile: null, capabilities: null, sessionId: null, selection: null, lastFrame: null, error: null };
    const emit = (name, value) => { try { options[name]?.(clone(value)); } catch { /* A UI callback must not break session cleanup. */ } };
    const update = patch => { state = { ...state, ...patch }; emit('onState', state); return clone(state); };
    const current = generation => generation === epoch;
    function clearPoll() { if (pollTimer != null) clearTimeout(pollTimer); pollTimer = null; }
    function invalidate() { epoch += 1; clearPoll(); for (const controller of requests) controller.abort(); requests.clear(); tail = Promise.resolve(); return epoch; }
    function report(error, generation) {
      if (!current(generation) || error.code === 'cancelled') return;
      clearPoll();
      const message = error.message || 'The worker could not be reached. Check its URL, CORS and server logs.';
      const info = { code: error.code || 'network_error', message: token ? message.split(token).join('[redacted]') : message };
      update({ status: 'error', error: info, message: info.message }); emit('onError', info);
    }
    async function request(path, settings = {}) {
      const controller = new AbortController(); requests.add(controller);
      const base = settings.base ?? url, secret = settings.secret ?? token;
      const headers = { Accept: 'application/json', ...(settings.body != null ? { 'Content-Type': 'application/json' } : {}), ...(secret ? { Authorization: 'Bearer ' + secret } : {}) };
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reject(new RuntimeError('timeout', 'The worker did not respond in time. Its session may still exist; retry or disconnect to release it.')); controller.abort(); }, settings.timeout ?? timeoutMs); });
      const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new RuntimeError('cancelled', 'The previous request was cancelled.')), { once: true }));
      try {
        return await Promise.race([(async () => {
          const response = await fetcher(base + path, { method: settings.method || 'GET', headers, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', ...(settings.body != null ? { body: JSON.stringify(settings.body) } : {}) });
          const limit = settings.maxBytes || 16 * 1024 * 1024;
          const declaredBytes = Number(response.headers?.get?.('content-length'));
          if (declaredBytes > limit) fail('response_too_large', 'The worker response exceeds the Arena size limit.');
          let text;
          if (response.body?.getReader && typeof TextDecoder !== 'undefined') {
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let bytes = 0; const parts = [];
            try {
              while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
                if (bytes > limit) { await reader.cancel(); fail('response_too_large', 'The worker response exceeds the Arena size limit.'); }
                parts.push(decoder.decode(part.value, { stream: true })); }
              parts.push(decoder.decode()); text = parts.join('');
            } finally { reader.releaseLock(); }
          } else text = await response.text();
          if (text.length > limit) fail('response_too_large', 'The worker response exceeds the Arena size limit.');
          let data;
          try { data = JSON.parse(text); } catch { fail('invalid_json', 'The worker returned a non-JSON response. Check its API URL and server logs.'); }
          if (!response.ok) {
            const message = object(data.error) ? data.error.message : data.message;
            fail(response.status === 401 || response.status === 403 ? 'unauthorized' : 'http_error', nonempty(message) ? (secret ? message.split(secret).join('[redacted]') : message) : 'The worker rejected this request (HTTP ' + response.status + ').');
          }
          if (!object(data) || (settings.schema ? data.schema !== settings.schema : data.version !== 1)) fail('protocol_mismatch', 'The worker returned an unsupported Arena response schema.');
          if (controller.signal.aborted && settings.onLateData) await settings.onLateData(data);
          return data;
        })(), timeout, aborted]);
      } finally { clearTimeout(timer); requests.delete(controller); }
    }
    async function cleanup(old) {
      if (!old) return;
      try { await request('/v1/sessions/' + encodeURIComponent(old.id), { method: 'DELETE', base: old.url, secret: old.token, timeout: Math.min(timeoutMs, 4000) }); }
      catch (error) { if (error.code !== 'cancelled') emit('onError', { code: 'cleanup_failed', message: 'Could not confirm that the previous worker session stopped. Check the worker and its idle timeout.' }); }
    }
    function frame(raw, generation) {
      if (!current(generation)) return false;
      if (!object(raw) || raw.version !== 1 || raw.sessionId !== session?.id || raw.profileId !== state.profile?.id) fail('frame_mismatch', 'The worker returned a frame for another session or profile.');
      if (!Number.isSafeInteger(raw.seq) || raw.seq < 0 || !finite(raw.simTime) || raw.simTime < 0 || !statuses.includes(raw.status) || typeof raw.policyExecuted !== 'boolean') fail('invalid_frame', 'The worker frame is missing authoritative sequence, time or policy evidence.');
      if (raw.seq <= lastSeq) return false;
      if (!Array.isArray(raw.cameras) || raw.cameras.some(c => !object(c) || !nonempty(c.id) || !['policy', 'spectator'].includes(c.role) || !nonempty(c.url) || (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.url) && !/^https:\/\//.test(c.url)))) fail('invalid_frame', 'The worker returned an unsafe or malformed sensor image.');
      if (new Set(raw.cameras.map(c => c.id)).size !== raw.cameras.length) fail('invalid_frame', 'Frame camera IDs must be unique.');
      for (const camera of raw.cameras) {
        const declared = state.profile.cameras.find(c => c.id === camera.id);
        if ((camera.role === 'policy' && !declared) || (declared && declared.role !== camera.role)) fail('camera_mismatch', 'The worker changed a sensor camera role.');
      }
      if (raw.policyExecuted && state.profile.cameras.some(c => c.role === 'policy' && !raw.cameras.some(image => image.id === c.id && image.role === 'policy'))) fail('camera_mismatch', 'Policy execution requires the declared observation camera frames.');
      if (raw.bodies != null && (!Array.isArray(raw.bodies) || raw.bodies.some(b => !object(b) || !nonempty(b.id) || !Array.isArray(b.position) || b.position.length !== 3 || b.position.some(n => !finite(n)) || !Array.isArray(b.quaternion) || b.quaternion.length !== 4 || b.quaternion.some(n => !finite(n))))) fail('invalid_frame', 'The worker returned invalid physics transforms.');
      if (!object(raw.metrics) || !Array.isArray(raw.events)) fail('invalid_frame', 'The worker frame must identify measured metrics and its event list.');
      lastSeq = raw.seq;
      update({ lastFrame: raw, status: raw.status, error: raw.status === 'error' ? state.error : null, message: raw.status === 'running' ? 'Robot physics and policy are running on the worker.' : raw.status === 'succeeded' ? 'Task succeeded according to the worker task checker.' : raw.status === 'failed' ? 'The worker task ended without success.' : 'Worker ' + raw.status + '. Control the experiment below.' });
      emit('onFrame', raw); return true;
    }
    function enqueue(generation, work) {
      const next = tail.catch(() => {}).then(() => { if (!current(generation)) fail('cancelled', 'The previous operation was cancelled.'); return work(); });
      tail = next; return next;
    }
    function schedule(generation) {
      clearPoll();
      if (!current(generation) || !session || state.status !== 'running') return;
      pollTimer = setTimeout(() => {
        pollTimer = null;
        enqueue(generation, async () => { const data = await request('/v1/sessions/' + encodeURIComponent(session.id) + '/frame'); frame(data, generation); }).then(() => schedule(generation)).catch(error => report(error, generation));
      }, pollMs);
    }
    async function connect(input = {}) {
      const old = session, generation = invalidate(); session = null; lastSeq = -1;
      update({ status: 'connecting', message: 'Checking the worker and exact robot/model contract…', profile: null, capabilities: null, sessionId: null, lastFrame: null, error: null, selection: null });
      try {
        await cleanup(old);
        if (!current(generation)) return clone(state);
        const newURL = endpointURL(input.url), selection = normalizeSelection(input.selection);
        if (input.token != null && (typeof input.token !== 'string' || /[\r\n]/.test(input.token))) fail('invalid_token', 'Enter a valid worker access token.');
        url = newURL; token = String(input.token || '');
        if (!current(generation)) return clone(state);
        update({ selection });
        const caps = validateCapabilities(await request('/v1/capabilities'));
        if (!current(generation)) return clone(state);
        update({ capabilities: caps });
        const profile = findProfile(caps, selection);
        return update({ status: 'connected', profile, message: profile.ready ? 'Exact profile verified. Create a session to load the task.' : profile.reason || 'This profile needs a configured policy runtime.' });
      } catch (error) { report(error, generation); return clone(state); }
    }
    async function start(input = state.selection) {
      const old = session, caps = state.capabilities, generation = invalidate(); session = null; lastSeq = -1;
      update({ sessionId: null, lastFrame: null, error: null });
      try {
        await cleanup(old);
        if (!current(generation)) return clone(state);
        if (!caps || !url) fail('not_connected', 'Connect a matched worker before creating a session.');
        const selection = normalizeSelection(input), profile = findProfile(caps, selection);
        update({ selection, profile });
        if (!current(generation)) return clone(state);
        if (!profile.ready) fail('profile_not_ready', profile.reason || 'This worker profile is not ready. Configure its checkpoint and controller.');
        const task = selection.task || profile.tasks[0]?.id;
        if (!task || (profile.tasks.length && !profile.tasks.some(t => t.id === task || t.label === task))) fail('unsupported_task', 'Choose a task listed by this worker for the selected checkpoint.');
        const exactTask = profile.tasks.find(t => t.id === task || t.label === task)?.id || task;
        update({ status: 'creating', message: 'Loading the robot, task and exact checkpoint…', selection: { ...selection, task: exactTask, profileId: profile.id } });
        const createdOn = { url, token };
        const data = await request('/v1/sessions', { method: 'POST', timeout: startupTimeoutMs, onLateData: data => nonempty(data.sessionId) ? cleanup({ id: data.sessionId, ...createdOn }) : Promise.resolve(), body: { version: 1, profileId: profile.id, robotId: profile.robotId, modelId: profile.modelId, checkpoint: profile.checkpoint, task: exactTask, seed: selection.seed, protocol: selection.protocol } });
        if (!current(generation)) { if (nonempty(data.sessionId)) await cleanup({ id: data.sessionId, ...createdOn }); return clone(state); }
        if (nonempty(data.sessionId)) session = { id: data.sessionId, ...createdOn };
        if (!nonempty(data.sessionId) || data.profileId !== profile.id || data.robotId !== profile.robotId || data.modelId !== profile.modelId || checkpointKey(data.checkpoint) !== checkpointKey(profile.checkpoint) || !object(data.profile)) fail('session_mismatch', 'The created session does not match the selected robot, model and checkpoint.');
        session = { id: data.sessionId, url, token };
        const actual = validateProfile(data.profile);
        if (!sameContract(profile, actual)) fail('session_mismatch', 'The worker changed its observation, action, checkpoint or simulator contract while creating the session.');
        if (!statuses.includes(data.status)) fail('session_mismatch', 'The worker returned an invalid session status.');
        update({ status: data.status, sessionId: data.sessionId, profile: actual, message: 'Worker ready. Start the experiment when ready.' });
        frame(data.frame || await request('/v1/sessions/' + encodeURIComponent(session.id) + '/frame'), generation);
        schedule(generation); return clone(state);
      } catch (error) {
        const rejected = current(generation) ? session : null;
        if (current(generation)) session = null;
        report(error, generation); await cleanup(rejected);
        if (current(generation)) update({ sessionId: null, lastFrame: null });
        return clone(state);
      }
    }
    async function command(type, payload = {}) {
      if (!knownCommands.includes(type)) { const error = new RuntimeError('unsupported_command', 'Unknown Arena command.'); report(error, epoch); return clone(state); }
      let generation = epoch;
      if (type === 'reset') generation = invalidate();
      clearPoll();
      try {
        await enqueue(generation, async () => {
          if (!session || !state.sessionId) fail('session_required', 'Create a session before controlling the robot.');
          if (!state.profile.commands.includes(type)) fail('unsupported_command', 'This worker does not support ' + type + '.');
          if (state.selection.protocol === 'benchmark' && ['intervene', 'branch'].includes(type)) fail('benchmark_locked', 'Benchmark conditions are locked. Start a practice session to change the scene or branch.');
          if (!object(payload)) fail('invalid_command', 'The command payload must be an object.');
          const requestId = 'arena-' + Date.now().toString(36) + '-' + (++requestNumber), id = session.id;
          const data = await request('/v1/sessions/' + encodeURIComponent(id) + '/commands', { method: 'POST', body: { version: 1, type, payload, requestId } });
          if (!current(generation)) return;
          if (data.sessionId !== id || data.requestId !== requestId || !statuses.includes(data.status)) fail('command_mismatch', 'The worker acknowledged another command or session.');
          update({ status: data.status, error: null });
          frame(data.frame || await request('/v1/sessions/' + encodeURIComponent(id) + '/frame'), generation);
        });
        schedule(generation);
      } catch (error) { report(error, generation); }
      return clone(state);
    }
    async function disconnect() {
      const old = session; invalidate(); session = null; lastSeq = -1;
      url = ''; token = '';
      update({ status: 'disconnected', message: 'Worker disconnected. Connect a matched runtime to begin.', profile: null, capabilities: null, sessionId: null, selection: null, lastFrame: null, error: null });
      await cleanup(old); return clone(state);
    }
    // Recording reads never enter the command queue or change simulation state.
    // Construct paths locally: an advertised URL must never receive a bearer token.
    async function getRecording(recordingId = state.lastFrame?.recording?.recordingId) {
      const generation = epoch;
      if (!state.capabilities?.recordings) fail('recording_unavailable', 'This worker does not advertise durable recordings. Only incomplete browser evidence is available.');
      if (typeof recordingId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(recordingId)) fail('recording_unavailable', 'The worker has not supplied a recording identity yet.');
      try {
        const data = await request('/v1/recordings/' + encodeURIComponent(recordingId) + '/bundle', { schema: 'brainsnn.arena.bundle.v1', maxBytes: 128 * 1024 * 1024, timeout: Math.max(timeoutMs, 60000) });
        if (!current(generation)) fail('cancelled', 'The worker connection changed while loading this recording.');
        if (typeof data.manifestText !== 'string' || data.manifestText.length > 8 * 1024 * 1024) fail('invalid_recording', 'The worker recording manifest is missing or too large.');
        let manifest; try { manifest = JSON.parse(data.manifestText); } catch { fail('invalid_recording', 'The worker recording manifest is not JSON.'); }
        if (manifest.recordingId !== recordingId) fail('recording_mismatch', 'The worker returned a different recording identity.');
        return data;
      } catch (error) { throw new RuntimeError(error.code || 'recording_error', token ? String(error.message).split(token).join('[redacted]') : error.message); }
    }
    async function getEvidence() {
      const generation = epoch, id = state.sessionId;
      if (!id) fail('session_required', 'Create a worker session before reading its evidence.');
      const data = await request('/v1/sessions/' + encodeURIComponent(id) + '/evidence');
      if (!current(generation)) fail('cancelled', 'The worker connection changed while loading evidence.');
      return data;
    }
    return Object.freeze({ connect, start, command, disconnect, getRecording, getEvidence, getState: () => clone(state) });
  }
  window.BrainSNNRuntime = Object.freeze({ createClient, normalizeSelection });
})();
