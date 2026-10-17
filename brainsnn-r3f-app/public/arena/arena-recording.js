/* Native, inert recording envelopes. The authoritative manifest is UTF-8 text:
 * hash those exact bytes, never a cross-language reserialization of its floats.
 * No network, command dispatch, HTML rendering, or archive extraction lives here.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.BrainSNNArenaRecording = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const SCHEMA = 'brainsnn.arena.recording.v1';
  const BUNDLE_SCHEMA = 'brainsnn.arena.bundle.v1';
  const LIMITS = Object.freeze({ bundleBytes: 128 * 1024 * 1024, manifestBytes: 8 * 1024 * 1024,
    artifactBytes: 32 * 1024 * 1024, totalArtifactBytes: 96 * 1024 * 1024,
    artifacts: 4096, events: 20000, findings: 4000, depth: 32, nodes: 500000 });
  const SOURCE_KINDS = ['scripted-practice', 'simulator-policy', 'robot-observed', 'imported'];
  const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
  const SHA = /^[a-f0-9]{64}$/;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const encoder = new TextEncoder();
  class RecordingError extends Error {
    constructor(code, message) { super(message); this.name = 'RecordingError'; this.code = code; }
  }
  const fail = (code, message) => { throw new RecordingError(code, message); };
  const requireThat = (condition, code, message) => { if (!condition) fail(code, message); };
  const forbiddenKey = key => ['__proto__', 'constructor', 'prototype'].includes(key);
  function unicode(value) {
    for (let i = 0; i < value.length; i++) {
      const n = value.charCodeAt(i);
      if (n >= 0xd800 && n <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
      else if (n >= 0xdc00 && n <= 0xdfff) return false;
    }
    return true;
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  }
  function checkTree(value) {
    let nodes = 0;
    const ancestors = new Set();
    function walk(item, depth) {
      requireThat(++nodes <= LIMITS.nodes && depth <= LIMITS.depth, 'limit_exceeded', 'JSON exceeds depth or element limits.');
      if (typeof item === 'number') requireThat(Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item)), 'unsafe_number', 'Non-finite or unsafe integer; encode large timestamps as strings.');
      else if (typeof item === 'string') requireThat(unicode(item), 'invalid_unicode', 'Strings must contain Unicode scalar values.');
      else if (item !== null && typeof item === 'object') {
        requireThat(!ancestors.has(item), 'invalid_json', 'Cyclic JSON input.');
        requireThat(Array.isArray(item) || Object.prototype.toString.call(item) === '[object Object]', 'invalid_json', 'Only plain JSON data is supported.');
        ancestors.add(item);
        for (const key of Object.keys(item)) {
          requireThat(!forbiddenKey(key), 'unsafe_key', 'Unsupported object key.');
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          requireThat(descriptor && own(descriptor, 'value'), 'invalid_json', 'Accessors are not recording data.');
          walk(descriptor.value, depth + 1);
        }
        ancestors.delete(item);
      } else requireThat(item === null || ['string', 'boolean'].includes(typeof item), 'invalid_json', 'Only JSON values are supported.');
    }
    walk(value, 0);
  }
  // A small bounded JSON reader rejects duplicate keys before JSON.parse could
  // discard them. Different parser choices must not produce different evidence.
  function parseJSON(text, maxBytes = LIMITS.bundleBytes) {
    requireThat(typeof text === 'string' && text.length <= maxBytes, 'limit_exceeded', 'JSON input is too large.');
    requireThat(encoder.encode(text).byteLength <= maxBytes, 'limit_exceeded', 'UTF-8 JSON input is too large.');
    let at = 0, nodes = 0;
    const ws = () => { while (/[\x20\t\n\r]/.test(text[at] || 'x')) at++; };
    function string() {
      const start = at++;
      while (at < text.length) {
        const c = text[at++];
        if (c === '"') {
          let result;
          try { result = JSON.parse(text.slice(start, at)); } catch { fail('invalid_json', 'Invalid JSON string.'); }
          requireThat(unicode(result), 'invalid_unicode', 'Strings must contain Unicode scalar values.'); return result;
        }
        if (c === '\\') at++;
      }
      fail('invalid_json', 'Unclosed JSON string.');
    }
    function value(depth) {
      requireThat(++nodes <= LIMITS.nodes && depth <= LIMITS.depth, 'limit_exceeded', 'JSON exceeds depth or element limits.');
      ws(); const c = text[at];
      if (c === '"') return string();
      if (c === '{') {
        at++; ws(); const result = {};
        if (text[at] === '}') { at++; return result; }
        while (at < text.length) {
          requireThat(text[at] === '"', 'invalid_json', 'Expected JSON object key.');
          const key = string();
          requireThat(!forbiddenKey(key), 'unsafe_key', 'Unsupported object key.');
          requireThat(!own(result, key), 'duplicate_key', 'Duplicate JSON object key.');
          ws(); requireThat(text[at++] === ':', 'invalid_json', 'Expected colon.');
          result[key] = value(depth + 1); ws();
          const end = text[at++];
          if (end === '}') return result;
          requireThat(end === ',', 'invalid_json', 'Expected comma.'); ws();
        }
      } else if (c === '[') {
        at++; ws(); const result = [];
        if (text[at] === ']') { at++; return result; }
        while (at < text.length) {
          result.push(value(depth + 1)); ws();
          const end = text[at++]; if (end === ']') return result;
          requireThat(end === ',', 'invalid_json', 'Expected comma.');
        }
      } else {
        const tail = text.slice(at);
        for (const [token, data] of [['true', true], ['false', false], ['null', null]]) {
          if (tail.startsWith(token)) { at += token.length; return data; }
        }
        const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(tail);
        if (match) {
          at += match[0].length; const number = Number(match[0]);
          requireThat(Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)), 'unsafe_number', 'Non-finite or unsafe integer; encode large timestamps as strings.');
          return number;
        }
      }
      fail('invalid_json', 'Invalid or incomplete JSON.');
    }
    const parsed = value(0); ws(); requireThat(at === text.length, 'invalid_json', 'Trailing JSON content.'); return parsed;
  }
  function copy(value) { checkTree(value); return parseJSON(JSON.stringify(value)); }
  function bytes(value) {
    if (typeof value === 'string') return encoder.encode(value);
    if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    fail('invalid_payload', 'Artifact bytes must be a string, ArrayBuffer or typed byte array.');
  }
  async function sha256(value) {
    const crypto = root.crypto || globalThis.crypto;
    requireThat(crypto?.subtle, 'crypto_unavailable', 'SHA256 needs WebCrypto in a secure browser context.');
    const hash = await crypto.subtle.digest('SHA-256', bytes(value));
    return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
  }
  function bytesToBase64(value) {
    const data = bytes(value); let text = '';
    for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
    return (root.btoa || globalThis.btoa)(text);
  }
  function base64ToBytes(value) {
    requireThat(typeof value === 'string' && value.length <= Math.ceil(LIMITS.artifactBytes / 3) * 4, 'limit_exceeded', 'Artifact exceeds encoded size limit.');
    const padding = value.indexOf('=');
    requireThat(value.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(value) && (padding === -1 || (padding >= value.length - 2 && /^={1,2}$/.test(value.slice(padding)))), 'invalid_payload', 'Artifact must use canonical base64.');
    let binary;
    try { binary = (root.atob || globalThis.atob)(value); } catch { fail('invalid_payload', 'Invalid base64 artifact.'); }
    const result = Uint8Array.from(binary, c => c.charCodeAt(0));
    requireThat(bytesToBase64(result) === value, 'invalid_payload', 'Noncanonical base64 padding.');
    return result;
  }
  function safePath(path) {
    return typeof path === 'string' && path.length <= 240 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path)
      && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
  }
  function list(value, max, name) { requireThat(Array.isArray(value) && value.length <= max, 'invalid_schema', name + ' must be a bounded array.'); }
  function references(value, name) {
    list(value, LIMITS.events, name);
    requireThat(value.every(id => typeof id === 'string' && ID.test(id)) && new Set(value).size === value.length, 'invalid_reference', name + ' contains invalid or duplicate references.');
  }
  function noCycles(nodes, edges) {
    const visited = new Set(), active = new Set();
    // Iterative DFS: a long but valid episode must not exhaust the JS stack.
    for (const start of nodes) {
      if (visited.has(start)) continue;
      const stack = [[start, false]];
      while (stack.length) {
        const [id, end] = stack.pop();
        if (end) { active.delete(id); visited.add(id); continue; }
        requireThat(!active.has(id), 'reference_cycle', 'Evidence references contain a cycle.');
        if (visited.has(id)) continue;
        active.add(id); stack.push([id, true]);
        for (const next of edges.get(id) || []) stack.push([next, false]);
      }
    }
  }
  function validateManifest(manifest) {
    checkTree(manifest);
    requireThat(object(manifest) && manifest.schema === SCHEMA && ID.test(manifest.recordingId || ''), 'invalid_schema', 'Unsupported recording schema or ID.');
    requireThat(object(manifest.source) && SOURCE_KINDS.includes(manifest.source.kind) && manifest.source.identityStatus === 'declared', 'invalid_source', 'Source kind and declared identity are required.');
    requireThat(object(manifest.context) && object(manifest.outcome) && ['succeeded', 'failed', 'interrupted', 'unknown'].includes(manifest.outcome.status), 'invalid_schema', 'Context and explicit outcome are required.');
    list(manifest.clocks, 256, 'clocks');
    const clockIds = new Set();
    for (const clock of manifest.clocks) {
      requireThat(object(clock), 'invalid_schema', 'Clock must be an object.');
      if (clock.id !== undefined) { requireThat(ID.test(clock.id) && !clockIds.has(clock.id), 'invalid_schema', 'Clock ID must be unique.'); clockIds.add(clock.id); }
    }
    list(manifest.events, LIMITS.events, 'events'); list(manifest.artifacts, LIMITS.artifacts, 'artifacts'); list(manifest.findings, LIMITS.findings, 'findings');
    const allIds = new Set(), eventIds = new Set(), artifactIds = new Set(), edges = new Map(), paths = new Set();
    function addId(id) { requireThat(typeof id === 'string' && ID.test(id) && !allIds.has(id), 'duplicate_id', 'Evidence IDs must be valid and globally unique.'); allIds.add(id); }
    let total = 0;
    const dtypeBytes = { uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, uint64: 8, int64: 8, float16: 2, float32: 4, float64: 8, bool: 1 };
    for (const artifact of manifest.artifacts) {
      requireThat(object(artifact), 'invalid_artifact', 'Artifact descriptor must be an object.'); addId(artifact.id); artifactIds.add(artifact.id);
      requireThat(safePath(artifact.path) && !paths.has(artifact.path.toLowerCase()), 'unsafe_path', 'Artifact paths must be safe, local and unambiguous.'); paths.add(artifact.path.toLowerCase());
      requireThat(SHA.test(artifact.sha256 || '') && integer(artifact.byteLength), 'invalid_artifact', 'Artifact needs full SHA256 and safe integer byteLength.');
      requireThat(typeof artifact.mediaType === 'string' && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:;[a-z0-9= .+-]+)?$/i.test(artifact.mediaType), 'invalid_artifact', 'Artifact media type is required.');
      requireThat(['included', 'omitted'].includes(artifact.retention), 'invalid_artifact', 'Artifact retention must be explicit.');
      if (artifact.retention === 'included') requireThat(artifact.byteLength <= LIMITS.artifactBytes, 'limit_exceeded', 'Included artifact exceeds byte limit.');
      requireThat(!['symlink', 'hardlink', 'executable'].includes(artifact.kind) && artifact.linkTarget === undefined && artifact.url === undefined, 'unsafe_artifact', 'Artifacts cannot be links, executables or remote fetch instructions.');
      if (artifact.retention === 'included') total += artifact.byteLength;
      if (artifact.shape !== undefined || artifact.dtype !== undefined || artifact.endianness !== undefined) {
        requireThat(Array.isArray(artifact.shape) && artifact.shape.length > 0 && artifact.shape.length <= 8 && artifact.shape.every(n => integer(n) && n > 0), 'invalid_array', 'Array shape must contain positive dimensions.');
        requireThat(own(dtypeBytes, artifact.dtype) && ['little', 'big', 'not-applicable'].includes(artifact.endianness), 'invalid_array', 'Array dtype and endianness must be explicit.');
        const size = artifact.shape.reduce((a, b) => a * b, dtypeBytes[artifact.dtype]);
        requireThat(Number.isSafeInteger(size) && (artifact.retention === 'omitted' || size <= LIMITS.totalArtifactBytes), 'invalid_array', 'Decoded array exceeds memory limits.');
        if (artifact.mediaType === 'application/octet-stream') requireThat(size === artifact.byteLength, 'invalid_array', 'Raw array shape/dtype must match byteLength.');
      }
      if (artifact.derivedFrom !== undefined) { references(artifact.derivedFrom, 'derivedFrom'); edges.set(artifact.id, artifact.derivedFrom); }
    }
    requireThat(total <= LIMITS.totalArtifactBytes, 'limit_exceeded', 'Included artifacts exceed the total byte limit.');
    let sequence = 0;
    for (const event of manifest.events) {
      requireThat(object(event), 'invalid_event', 'Event must be an object.'); addId(event.id); eventIds.add(event.id);
      requireThat(integer(event.seq) && event.seq > sequence && typeof event.kind === 'string' && ID.test(event.kind) && object(event.data), 'invalid_event', 'Events need increasing positive sequences, kind and data.'); sequence = event.seq;
      references(event.refs, 'event.refs'); references(event.artifactIds, 'event.artifactIds'); edges.set(event.id, event.refs);
      if (event.simTime !== undefined) requireThat(typeof event.simTime === 'number' && Number.isFinite(event.simTime) && event.simTime >= 0, 'invalid_time', 'Simulation time must be nonnegative.');
      if (event.monotonicNs !== undefined) requireThat(typeof event.monotonicNs === 'string' && /^\d{1,30}$/.test(event.monotonicNs), 'invalid_time', 'Monotonic nanoseconds must be decimal strings.');
    }
    for (const finding of manifest.findings) {
      requireThat(object(finding), 'invalid_finding', 'Finding must be an object.'); addId(finding.id);
      requireThat(['fact', 'rule', 'hypothesis', 'human'].includes(finding.origin) && typeof finding.summary === 'string' && finding.summary.length > 0 && finding.summary.length <= 10000, 'invalid_finding', 'Finding needs origin and bounded summary.');
      references(finding.refs, 'finding.refs'); requireThat(finding.refs.length > 0, 'invalid_reference', 'Every finding must cite evidence.'); edges.set(finding.id, finding.refs);
    }
    for (const event of manifest.events) {
      requireThat(event.refs.every(id => eventIds.has(id)) && event.artifactIds.every(id => artifactIds.has(id)), 'missing_reference', 'Event references unavailable IDs.');
    }
    for (const artifact of manifest.artifacts) requireThat((artifact.derivedFrom || []).every(id => artifactIds.has(id)), 'missing_reference', 'Artifact lineage references unavailable IDs.');
    for (const finding of manifest.findings) requireThat(finding.refs.every(id => allIds.has(id)), 'missing_reference', 'Finding references unavailable IDs.');
    noCycles(allIds, edges);
    const completion = manifest.completion;
    requireThat(object(completion) && ['complete', 'partial', 'recording'].includes(completion.status) && ['committedSequence', 'lastObservedSequence', 'gapCount'].every(k => integer(completion[k])) && typeof completion.unknownTail === 'boolean', 'invalid_completion', 'Completion coverage must be explicit.');
    requireThat(completion.committedSequence >= sequence && completion.lastObservedSequence >= completion.committedSequence, 'invalid_completion', 'Committed and observed sequence coverage is inconsistent.');
    if (completion.status === 'complete') requireThat(completion.gapCount === 0 && !completion.unknownTail && completion.committedSequence === sequence && completion.lastObservedSequence === sequence && manifest.events.every((event, index) => event.seq === index + 1) && manifest.artifacts.every(a => a.retention === 'included'), 'invalid_completion', 'A complete recording cannot contain missing evidence or an unknown tail.');
    return manifest;
  }
  function createManifest(options = {}) {
    const defaults = { schema: SCHEMA, recordingId: 'recording-' + (root.crypto?.randomUUID?.() || Date.now().toString(36)),
      source: { kind: 'imported', identityStatus: 'declared' }, context: {}, clocks: [], events: [], artifacts: [], findings: [],
      completion: { status: 'partial', committedSequence: 0, lastObservedSequence: 0, gapCount: 0, unknownTail: true }, outcome: { status: 'unknown' } };
    return copy({ ...defaults, ...options });
  }
  async function seal(manifest, rawPayloads = {}) {
    const data = copy(manifest), payloads = {};
    requireThat(object(rawPayloads), 'invalid_payload', 'Payload map is required.');
    for (const artifact of data.artifacts || []) {
      if (artifact.retention !== 'included') continue;
      requireThat(own(rawPayloads, artifact.path), 'missing_payload', 'Included artifact has no bytes.');
      const raw = bytes(rawPayloads[artifact.path]);
      requireThat(raw.byteLength <= LIMITS.artifactBytes, 'limit_exceeded', 'Artifact exceeds byte limit.');
      const digest = await sha256(raw);
      requireThat(artifact.sha256 === undefined || artifact.sha256 === digest, 'hash_mismatch', 'Artifact changed; derive a new descriptor instead of silently resealing.');
      requireThat(artifact.byteLength === undefined || artifact.byteLength === raw.byteLength, 'length_mismatch', 'Artifact byteLength does not match bytes.');
      artifact.sha256 = digest; artifact.byteLength = raw.byteLength; payloads[artifact.path] = bytesToBase64(raw);
    }
    requireThat(Object.keys(rawPayloads).every(path => own(payloads, path)), 'unexpected_payload', 'Unlisted artifact payload.');
    validateManifest(data); const manifestText = JSON.stringify(data);
    const bundle = { schema: BUNDLE_SCHEMA, manifestText, manifestSha256: await sha256(manifestText), payloads };
    return (await importBundle(bundle)).bundle;
  }
  async function importBundle(input, options = {}) {
    let bundle;
    if (typeof input === 'string') bundle = parseJSON(input);
    else { checkTree(input); bundle = copy(input); }
    if (bundle?.schema === 'brainsnn.arena.evidence.v1' && options.allowLegacy) return importBundle(await adaptLegacy(bundle));
    requireThat(object(bundle) && bundle.schema === BUNDLE_SCHEMA && Object.keys(bundle).sort().join(',') === 'manifestSha256,manifestText,payloads,schema', 'invalid_bundle', 'Expected an inert recording bundle with one authoritative manifest.');
    requireThat(typeof bundle.manifestText === 'string' && SHA.test(bundle.manifestSha256 || '') && object(bundle.payloads), 'invalid_bundle', 'Bundle manifest text, digest and payloads are required.');
    const manifest = parseJSON(bundle.manifestText, LIMITS.manifestBytes);
    requireThat(await sha256(bundle.manifestText) === bundle.manifestSha256, 'hash_mismatch', 'Manifest bytes do not match SHA256.');
    validateManifest(manifest);
    const payloads = {}, expected = new Set(); let total = 0;
    for (const artifact of manifest.artifacts) {
      if (artifact.retention === 'omitted') { requireThat(!own(bundle.payloads, artifact.path), 'unexpected_payload', 'Omitted artifact has an unexpected payload.'); continue; }
      expected.add(artifact.path); requireThat(own(bundle.payloads, artifact.path), 'missing_payload', 'Included artifact is missing.');
      const raw = base64ToBytes(bundle.payloads[artifact.path]); total += raw.byteLength;
      requireThat(total <= LIMITS.totalArtifactBytes, 'limit_exceeded', 'Decoded artifacts exceed the byte limit.');
      requireThat(raw.byteLength === artifact.byteLength, 'length_mismatch', 'Artifact byte length differs from its descriptor.');
      requireThat(await sha256(raw) === artifact.sha256, 'hash_mismatch', 'Artifact bytes differ from SHA256.'); payloads[artifact.path] = raw;
    }
    requireThat(Object.keys(bundle.payloads).every(path => expected.has(path)), 'unexpected_payload', 'Bundle contains an unlisted payload.');
    const sourcesPresent = manifest.artifacts.every(a => a.retention === 'included');
    const verification = { schemaValid: true, hashesMatch: true, sourcesPresent, producerIdentity: 'declared',
      execution: ['simulator-policy', 'robot-observed'].includes(manifest.source.kind) && manifest.events.some(e => ['action', 'controller-input'].includes(e.kind)) ? 'declared' : 'not-recorded',
      complete: manifest.completion.status === 'complete', limitations: ['Hashes establish byte integrity, not truth, authorship or physical execution.'] };
    if (!sourcesPresent) verification.limitations.push('Some original artifacts were explicitly omitted.');
    if (manifest.completion.unknownTail) verification.limitations.push('The recording has an unknown tail.');
    return { bundle: freeze(bundle), manifest: freeze(manifest), payloads, verification: freeze(verification) };
  }
  async function verifyBundle(input, options) {
    try { return { ok: true, ...(await importBundle(input, options)) }; }
    catch (error) { return { ok: false, errors: [{ code: error.code || 'invalid_bundle', message: error.message }] }; }
  }
  function exportBundle(value) {
    const bundle = value.bundle || value;
    requireThat(bundle?.schema === BUNDLE_SCHEMA, 'invalid_bundle', 'Expected a recording bundle.');
    const payloads = {}; Object.keys(bundle.payloads).sort().forEach(path => { payloads[path] = bundle.payloads[path]; });
    return JSON.stringify({ schema: BUNDLE_SCHEMA, manifestText: bundle.manifestText, manifestSha256: bundle.manifestSha256, payloads });
  }
  const manifestOf = value => value.manifest || value;
  function comparable(value) {
    if (Array.isArray(value)) return '[' + value.map(comparable).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + comparable(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function comparisonCompatibility(left, right) {
    const a = manifestOf(left), b = manifestOf(right), issues = [], differences = [];
    for (const key of ['taskId', 'taskRevision', 'judgeRevision', 'environment', 'actionSemantics', 'stateSemantics', 'units', 'preprocessingRevision']) {
      const av = a.context?.[key], bv = b.context?.[key];
      if (av == null || bv == null || av === '' || bv === '') issues.push({ field: key, reason: 'unknown', baseline: av ?? null, candidate: bv ?? null });
      else if (comparable(av) !== comparable(bv)) issues.push({ field: key, reason: 'incompatible', baseline: av, candidate: bv });
    }
    for (const key of new Set([...Object.keys(a.context || {}), ...Object.keys(b.context || {})])) {
      if (comparable(a.context?.[key] ?? null) !== comparable(b.context?.[key] ?? null)) differences.push({ field: key, baseline: a.context?.[key] ?? null, candidate: b.context?.[key] ?? null });
    }
    if (a.source.kind !== b.source.kind) issues.push({ field: 'source.kind', reason: 'different source kinds', baseline: a.source.kind, candidate: b.source.kind });
    return { compatible: issues.length === 0, issues, differences };
  }
  function eventValue(event, manifest) {
    const descriptors = new Map(manifest.artifacts.map(a => [a.id, a]));
    if (event.kind === 'observation') return { artifacts: event.artifactIds.map(id => descriptors.get(id)?.sha256), state: event.data.state ?? null };
    if (['action', 'controller-input', 'dataset-action'].includes(event.kind)) return event.data.vector ?? event.data.action ?? null;
    if (['chunk', 'inference-result'].includes(event.kind)) return event.data.actions ?? null;
    if (event.kind === 'state') return event.data.state ?? event.data.qpos ?? null;
    if (event.kind === 'outcome') return event.data.status ?? event.data.success ?? null;
    return null;
  }
  function compareRecordings(left, right, options = {}) {
    const a = manifestOf(left), b = manifestOf(right), compatibility = comparisonCompatibility(a, b);
    const result = { compatibility, alignment: options.alignment || null, firstDivergence: null,
      limitations: ['An observed difference does not establish a cause or reliability estimate.'] };
    if (!compatibility.compatible) { result.limitations.push('Context is incompatible or insufficiently specified.'); return result; }
    const alignment = options.alignment; let offset;
    if (alignment?.kind === 'simTime' && Number.isFinite(alignment.candidateOffset ?? 0)) offset = alignment.candidateOffset ?? 0;
    else if (alignment?.kind === 'event') {
      const ae = a.events.find(e => e.id === alignment.baselineEventId), be = b.events.find(e => e.id === alignment.candidateEventId);
      if (Number.isFinite(ae?.simTime) && Number.isFinite(be?.simTime)) offset = ae.simTime - be.simTime;
    }
    if (!Number.isFinite(offset)) { result.limitations.push('Declare a supported simulation-time or recorded-event alignment.'); return result; }
    result.alignment = { ...alignment, candidateOffset: offset };
    if (a.completion.status !== 'complete' || b.completion.status !== 'complete') result.limitations.push('Comparison covers only retained events; absence is not equivalence.');
    const candidate = new Map();
    for (const event of b.events) {
      if (!Number.isFinite(event.simTime)) continue;
      const key = event.kind + ':' + (event.simTime + offset).toFixed(9);
      if (!candidate.has(key)) candidate.set(key, []); candidate.get(key).push(event);
    }
    for (const event of a.events) {
      if (!Number.isFinite(event.simTime)) continue;
      const match = candidate.get(event.kind + ':' + event.simTime.toFixed(9))?.shift();
      if (!match) continue;
      const av = eventValue(event, a), bv = eventValue(match, b);
      if (av !== null && bv !== null && comparable(av) !== comparable(bv)) {
        result.firstDivergence = { baselineEventId: event.id, candidateEventId: match.id, kind: event.kind,
          baselineTime: event.simTime, candidateTime: match.simTime, reason: 'Recorded ' + event.kind + ' values differ at the declared alignment.' }; break;
      }
    }
    if (!result.firstDivergence) result.limitations.push('No difference found among aligned supported values; unaligned or unavailable data is not compared.');
    return result;
  }
  function deriveFindings(value) {
    const manifest = manifestOf(value), findings = [], ids = new Set([...manifest.events, ...manifest.artifacts, ...manifest.findings].map(item => item.id));
    const add = (event, summary, limitations = []) => {
      if (manifest.findings.some(finding => finding.producer === 'brainsnn-recording-rules.v1' && finding.refs.length === 1 && finding.refs[0] === event.id && finding.summary === summary)) return;
      let id = 'rule-' + event.id; while (ids.has(id)) id += '-r'; ids.add(id);
      findings.push({ id, origin: 'rule', producer: 'brainsnn-recording-rules.v1', summary, refs: [event.id], limitations });
    };
    for (const event of manifest.events) {
      if (event.kind === 'gap') add(event, 'The recorder reports unavailable evidence here.', ['The missing interval cannot be reconstructed from this record.']);
      else if (event.kind === 'error') add(event, 'The producer recorded an error.', ['An error record alone does not locate the underlying cause.']);
      else if (event.kind === 'intervention') add(event, 'A recorded intervention changed this run.', ['This records the intervention, not its causal effect.']);
      else if (event.kind === 'outcome') add(event, 'Task checker outcome: ' + String(event.data.status ?? event.data.success ?? 'unknown') + '.', ['This is the recorded task checker result.']);
      else if (event.kind === 'observation' && (event.data.stale === true || event.data.missing === true)) add(event, 'The producer marked this observation stale or unavailable.');
    }
    return findings;
  }
  function createReview(validated, options = {}) {
    requireThat(validated?.bundle?.manifestSha256 && validated.manifest, 'invalid_review', 'Review requires an imported, integrity-checked recording.');
    const findingId = options.findingId ?? null;
    const findings = [...validated.manifest.findings, ...deriveFindings(validated.manifest)];
    requireThat(findingId === null || findings.some(f => f.id === findingId), 'invalid_review', 'Review finding must exist.');
    requireThat(['accept', 'reject', 'needs-evidence'].includes(options.decision), 'invalid_review', 'Review decision is required.');
    return freeze({ schema: 'brainsnn.arena.review.v1', manifestSha256: validated.bundle.manifestSha256, findingId,
      findingSnapshot: findingId === null ? null : copy(findings.find(f => f.id === findingId)),
      decision: options.decision, reviewer: { label: String(options.reviewerLabel || 'Local reviewer').slice(0, 160), authenticated: false },
      createdAt: options.createdAt || new Date().toISOString() });
  }
  function reviewStatus(review, validated) {
    if (review?.schema !== 'brainsnn.arena.review.v1' || review.manifestSha256 !== validated?.bundle?.manifestSha256) return { current: false, reason: 'Recording identity changed or review is unsupported.' };
    const finding = [...validated.manifest.findings, ...deriveFindings(validated.manifest)].find(f => f.id === review.findingId);
    if (review.findingId !== null && (!finding || comparable(finding) !== comparable(review.findingSnapshot))) return { current: false, reason: 'Finding changed or is unavailable.' };
    return { current: true, reason: 'Bound content is unchanged; reviewer identity is self-declared.' };
  }
  async function redactBundle(validated, options = {}) {
    const input = validated?.bundle ? await importBundle(validated.bundle) : await importBundle(validated);
    const manifest = copy(input.manifest), payloads = {}, omitted = new Set(options.omitArtifacts || []);
    for (const artifact of manifest.artifacts) {
      const omit = omitted.has(artifact.id) || (options.omitImages && (artifact.mediaType.startsWith('image/') || artifact.mediaType.startsWith('video/') || artifact.shape?.length === 3))
        || (options.omitPrompts && (artifact.kind === 'prompt' || /prompt/i.test(artifact.id)));
      if (omit && artifact.retention === 'included') { artifact.retention = 'omitted'; artifact.omissionReason = 'Excluded by local export selection.'; }
      if (artifact.retention === 'included') payloads[artifact.path] = input.payloads[artifact.path];
    }
    if (options.omitPrompts) {
      const scrub = item => { if (item && typeof item === 'object') for (const key of Object.keys(item)) { if (/prompt|instruction/i.test(key) && typeof item[key] === 'string') item[key] = '[redacted]'; else scrub(item[key]); } };
      scrub(manifest.context); manifest.events.forEach(event => scrub(event.data));
    }
    manifest.source.derivation = { kind: 'selected-export', manifestSha256: input.bundle.manifestSha256 };
    manifest.completion.status = 'partial'; manifest.completion.reason = 'Selected export; consult artifact retention and redaction receipt.';
    return seal(manifest, payloads);
  }
  async function adaptLegacy(input) {
    const old = typeof input === 'string' ? parseJSON(input) : copy(input);
    requireThat(old?.schema === 'brainsnn.arena.evidence.v1', 'unsupported_legacy', 'Unsupported legacy evidence schema.');
    const practice = old.execution?.kind === 'scripted-kinematic-demo';
    const manifest = createManifest({ recordingId: 'legacy-' + (await sha256(JSON.stringify(old))).slice(0, 32),
      source: { kind: practice ? 'scripted-practice' : 'imported', identityStatus: 'declared', originalSchema: old.schema,
        limitation: practice ? 'Scripted kinematic practice; no named model executed.' : 'Browser metadata export; original policy inputs and full state are unavailable.' },
      context: { taskId: old.execution?.task || old.selected?.task || 'legacy-practice', selectedRobot: old.selected?.robotId || null, selectedModel: old.selected?.modelId || null,
        seed: old.execution?.seed ?? old.selected?.seed ?? null, legacyProfile: old.worker?.profile || null },
      clocks: [{ id: 'sim', kind: 'simulation', unit: 'seconds' }] });
    let seq = 0;
    const append = (kind, time, data) => {
      const event = { id: 'legacy-e' + (++seq), seq, kind, refs: [], artifactIds: [], data };
      if (typeof time === 'number' && Number.isFinite(time) && time >= 0) event.simTime = time;
      manifest.events.push(event);
    };
    if (practice) {
      for (const snapshot of old.local?.snapshots || []) {
        if (snapshot.controllerInput !== undefined) append('controller-input', snapshot.state?.time, { vector: snapshot.controllerInput, originalId: snapshot.id, coverage: 'scripted controller input; no model inference' });
        const previous = manifest.events.at(-1);
        append('state', snapshot.state?.time, { state: snapshot.state, originalId: snapshot.id, branch: snapshot.branch || null, coverage: 'scripted snapshot' });
        if (snapshot.controllerInput !== undefined && previous) manifest.events.at(-1).refs = [previous.id];
      }
      for (const event of old.local?.events || []) append(event.kind === 'intervention' ? 'intervention' : 'legacy-event', event.simTime, { original: event });
    } else for (const frame of old.worker?.frames || (old.worker ? [old.worker] : [])) append('preview-metadata', frame.simTime, { frame, coverage: 'metadata only; image and physics state absent' });
    manifest.completion = { status: 'partial', committedSequence: seq, lastObservedSequence: seq, gapCount: Math.max(0, Math.floor(Number(old.worker?.droppedFrames) || 0)), unknownTail: true, reason: 'Legacy preview coverage cannot establish a complete archival recording.' };
    manifest.findings = deriveFindings(manifest);
    return seal(manifest, {});
  }
  return Object.freeze({ SCHEMA, BUNDLE_SCHEMA, LIMITS, RecordingError, parseJSON, sha256, bytesToBase64, base64ToBytes,
    createManifest, validateManifest, seal, importBundle, verifyBundle, exportBundle, adaptLegacy,
    comparisonCompatibility, compareRecordings, deriveFindings, createReview, reviewStatus, redactBundle });
});
