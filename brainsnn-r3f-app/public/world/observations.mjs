/**
 * Source-bound visual observations, never world geometry or measured facts.
 *
 * Binding records must come from locally hashed original bytes and verified PNG
 * artifact bytes/metadata, not from the sidecar being imported. This module
 * checks their identity; it does not authenticate a provider or hash image bytes.
 * A video timestamp is the decoded source PTS and time base, never frame index/fps.
 * Boxes are [left, top, right, bottom] in normalized image coordinates.
 * Text is inert data: UI callers must render it with textContent, not innerHTML.
 */
export const OBSERVATION_SCHEMA = 'brainsnn.world.observations.v1';
export const OBSERVATION_PROOF_SCHEMA = 'brainsnn.world.observation-proof.v1';
export const OBSERVATION_LIMITS = Object.freeze({ bytes: 256 * 1024, frames: 6, observations: 100, sources: 12, imageEdge: 512, seconds: 86400 });

const sessions = new WeakSet();
const encoder = new TextEncoder();
const fail = message => { throw new Error(message); };
const own = (object, key) => Object.hasOwn(object, key);

function record(value, required, optional = [], name = 'Record') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name} must be a plain object.`);
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !own(value, key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) fail(`${name} has missing or unsupported fields.`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !own(descriptor, 'value')) fail(`${name} must contain ordinary JSON fields.`);
  }
  return value;
}
function list(value, min, max, name) {
  if (!Array.isArray(value) || value.length < min || value.length > max ||
      Reflect.ownKeys(value).length !== value.length + 1) fail(`${name} exceeds its bounds or is not an array.`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) fail(`${name} must contain ordinary JSON entries.`);
  }
  return value;
}
function text(value, max, name, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) ||
      !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(`${name} is invalid or too long.`);
  return value;
}
function id(value, name = 'Identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) fail(`${name} is invalid.`);
  return value;
}
function hash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('A lowercase SHA-256 digest is required.');
  return value;
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${name} is outside its bounds.`);
  return value;
}
function timestamp(value, kind) {
  if (kind === 'photo') {
    if (value !== null) fail('Photo timestamps must be null.');
    return null;
  }
  record(value, ['pts', 'timeBase'], [], 'Video timestamp');
  if (typeof value.pts !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.pts)) fail('Video PTS must be an exact nonnegative integer string.');
  list(value.timeBase, 2, 2, 'Video time base');
  const timeBase = value.timeBase.map(v => integer(v, 1, 1e9, 'Video time base'));
  if (BigInt(value.pts) * BigInt(timeBase[0]) > BigInt(OBSERVATION_LIMITS.seconds) * BigInt(timeBase[1])) fail('Video timestamp exceeds the supported duration.');
  return { pts: value.pts, timeBase };
}
function frame(value, kind) {
  record(value, ['id', 'sha256', 'width', 'height', 'timestamp'], [], 'Frame');
  return { id: id(value.id, 'Frame ID'), sha256: hash(value.sha256),
    width: integer(value.width, 1, OBSERVATION_LIMITS.imageEdge, 'Frame width'),
    height: integer(value.height, 1, OBSERVATION_LIMITS.imageEdge, 'Frame height'), timestamp: timestamp(value.timestamp, kind) };
}
function frames(value, kind) {
  const result = list(value, 1, OBSERVATION_LIMITS.frames, 'Frames').map(v => frame(v, kind));
  if (new Set(result.map(v => v.id)).size !== result.length) fail('Frame IDs must be unique.');
  return result;
}
function source(value) {
  record(value, ['sha256', 'kind'], [], 'Source');
  if (!['photo', 'video'].includes(value.kind)) fail('Source kind must be photo or video.');
  return { sha256: hash(value.sha256), kind: value.kind };
}
function annotation(value) {
  record(value, ['label', 'uncertainty'], ['box'], 'Annotation');
  const result = { label: text(value.label, 120, 'Label'), uncertainty: text(value.uncertainty, 600, 'Uncertainty') };
  if (own(value, 'box')) {
    const box = list(value.box, 4, 4, '2D box').map(v => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) fail('2D box coordinates must be normalized numbers.');
      return v;
    });
    if (box[0] >= box[2] || box[1] >= box[3]) fail('2D box must have positive width and height.');
    result.box = box;
  }
  return result;
}
function proposed(value) {
  const result = { label: value.label, uncertainty: value.uncertainty };
  if (own(value, 'box')) result.box = value.box;
  return annotation(result);
}
function sidecar(value) {
  record(value, ['schema', 'source', 'model', 'frames', 'observations'], [], 'Observation sidecar');
  if (value.schema !== OBSERVATION_SCHEMA) fail('Unsupported observation schema.');
  const original = source(value.source);
  record(value.model, ['provider', 'id', 'revision', 'promptVersion', 'promptSha256'], [], 'Model provenance');
  const model = { provider: text(value.model.provider, 80, 'Provider'), id: text(value.model.id, 200, 'Model ID'),
    revision: value.model.revision === null ? null : text(value.model.revision, 200, 'Model revision'),
    promptVersion: text(value.model.promptVersion, 120, 'Prompt version'), promptSha256: hash(value.model.promptSha256) };
  const selected = frames(value.frames, original.kind), knownFrames = new Set(selected.map(v => v.id));
  const observations = list(value.observations, 0, OBSERVATION_LIMITS.observations, 'Observations').map(value => {
    record(value, ['id', 'frameId', 'label', 'uncertainty'], ['box'], 'Observation');
    const frameId = id(value.frameId, 'Frame reference');
    if (!knownFrames.has(frameId)) fail('Observation cites an unknown frame.');
    return { id: id(value.id, 'Observation ID'), frameId, ...proposed(value) };
  });
  if (new Set(observations.map(v => v.id)).size !== observations.length) fail('Observation IDs must be unique.');
  return { schema: OBSERVATION_SCHEMA, source: original, model, frames: selected, observations };
}
function bound(value, currentSources) {
  // This registry is supplied by the caller after checking original/artifact
  // bytes. Never build it by copying untrusted imported sidecar metadata.
  list(currentSources, 1, OBSERVATION_LIMITS.sources, 'Current sources');
  const matches = currentSources.filter(item => item?.sha256 === value.source.sha256);
  if (matches.length !== 1) fail('Observation source is unbound, stale or ambiguous.');
  const binding = matches[0];
  record(binding, ['sha256', 'kind', 'frames'], [], 'Source binding');
  const expected = source({ sha256: binding.sha256, kind: binding.kind });
  if (expected.kind !== value.source.kind) fail('Observation source kind changed.');
  const known = new Map(frames(binding.frames, expected.kind).map(v => [v.id, v]));
  for (const selected of value.frames) {
    if (JSON.stringify(known.get(selected.id)) !== JSON.stringify(selected)) fail('Observation frame is unbound or stale.');
  }
  return value;
}
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function session(value, reviews) {
  const result = frozen({ ...value, reviews });
  sessions.add(result);
  return result;
}
function pending(value) {
  return value.observations.map(item => ({ observationId: item.id, status: 'pending', annotation: null, note: '', reviewedAt: null }));
}
function generated(value) {
  return sidecar({ schema: value.schema, source: value.source, model: value.model, frames: value.frames, observations: value.observations });
}
function checkedSession(value, currentSources) {
  if (!sessions.has(value)) fail('Use an observation session returned by this module.');
  return bound(generated(value), currentSources);
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Review time must be a valid UTC timestamp.');
  return value;
}
function proofReviews(value, original) {
  const rows = list(value, original.observations.length, original.observations.length, 'Reviews');
  const known = new Map(original.observations.map(item => [item.id, item])), seen = new Set();
  return rows.map(row => {
    record(row, ['observationId', 'status', 'annotation', 'note', 'reviewedAt'], [], 'Review');
    const observationId = id(row.observationId), observation = known.get(observationId);
    if (!observation || seen.has(observationId)) fail('Reviews must refer to each observation exactly once.');
    seen.add(observationId);
    if (!['pending', 'accepted', 'edited', 'rejected'].includes(row.status)) fail('Unknown observation review state.');
    const note = text(row.note, 600, 'Review note', true);
    let reviewed = null;
    if (row.status === 'pending') {
      if (row.annotation !== null || row.reviewedAt !== null || note !== '') fail('Pending observations cannot contain a review.');
    } else {
      instant(row.reviewedAt);
      if (row.status === 'rejected') {
        if (row.annotation !== null) fail('Rejected observations cannot have an accepted annotation.');
      } else {
        reviewed = annotation(row.annotation);
        if (row.status === 'accepted' && JSON.stringify(reviewed) !== JSON.stringify(proposed(observation))) fail('An unchanged acceptance must preserve the model annotation.');
      }
    }
    return { observationId, status: row.status, annotation: reviewed, note, reviewedAt: row.reviewedAt };
  });
}
function withinBytes(value) {
  const result = JSON.stringify(value);
  if (encoder.encode(result).byteLength > OBSERVATION_LIMITS.bytes) fail('Observation data exceeds 256 KiB.');
  return value;
}

/**
 * Import a generated sidecar or an explicit proof envelope. All imported human
 * reviews, including edited text, are discarded: model originals start pending.
 * Input may be a JSON string or plain JSON object. Returns a frozen session.
 */
export function importObservations(input, currentSources) {
  let value = input;
  if (typeof value === 'string') {
    if (value.length > OBSERVATION_LIMITS.bytes || encoder.encode(value).byteLength > OBSERVATION_LIMITS.bytes) fail('Observation data exceeds 256 KiB.');
    try { value = JSON.parse(value); } catch { fail('Observation data is not valid JSON.'); }
  }
  record(value, ['schema'], ['source', 'model', 'frames', 'observations', 'sidecar', 'reviews', 'reviewAuthority', 'exportedAt'], 'Observation data');
  let original;
  if (value?.schema === OBSERVATION_PROOF_SCHEMA) {
    record(value, ['schema', 'sidecar', 'reviews', 'reviewAuthority', 'exportedAt'], [], 'Observation proof');
    if (value.reviewAuthority !== 'local-user-unverified') fail('Unsupported review authority.');
    instant(value.exportedAt);
    original = sidecar(value.sidecar);
    // Validate discarded reviews as well, so importing a proof never hides
    // malformed, overlong or unsupported fields behind the review reset.
    const reviews = proofReviews(value.reviews, original);
    withinBytes({ schema: OBSERVATION_PROOF_SCHEMA, sidecar: original, reviews, reviewAuthority: value.reviewAuthority, exportedAt: value.exportedAt });
  } else original = withinBytes(sidecar(value));
  bound(original, currentSources);
  return session(original, pending(original));
}

/**
 * A pending observation has exactly one explicit review transition:
 * {action:'accept', note?:string}
 * {action:'edit', annotation:{label,uncertainty,box?:[l,t,r,b]}, note?:string}
 * {action:'reject', note?:string}
 * Returns a new frozen session. `now` is a local clock, not signed attestation.
 */
export function reviewObservation(value, observationId, decision, currentSources, { now = () => new Date().toISOString() } = {}) {
  const original = checkedSession(value, currentSources);
  record(decision, ['action'], ['annotation', 'note'], 'Review decision');
  const index = original.observations.findIndex(item => item.id === id(observationId));
  if (index < 0) fail('Observation does not exist.');
  if (value.reviews[index].status !== 'pending') fail('Only pending observations can be reviewed.');
  if (!['accept', 'edit', 'reject'].includes(decision.action)) fail('Choose accept, edit or reject.');
  if ((decision.action === 'edit') !== own(decision, 'annotation')) fail('Only an edit must include replacement annotation fields.');
  const result = { observationId, status: { accept: 'accepted', edit: 'edited', reject: 'rejected' }[decision.action],
    annotation: decision.action === 'edit' ? annotation(decision.annotation) : decision.action === 'accept' ? proposed(original.observations[index]) : null,
    note: own(decision, 'note') ? text(decision.note, 600, 'Review note', true) : '', reviewedAt: instant(now()) };
  const reviews = value.reviews.map((row, i) => i === index ? result : { ...row });
  // A successful review must remain exportable as bounded proof; otherwise a
  // large edit could appear saved but fail only when the user downloads it.
  withinBytes({ schema: OBSERVATION_PROOF_SCHEMA, sidecar: original, reviews,
    reviewAuthority: 'local-user-unverified', exportedAt: result.reviewedAt });
  return session(original, reviews);
}

/** Ordinary exports always retain the original model output without reviews. */
export function exportObservations(value, currentSources) {
  return frozen(withinBytes(checkedSession(value, currentSources)));
}

/** Only this explicit proof export preserves the local, unverified human review. */
export function exportObservationProof(value, currentSources, { now = () => new Date().toISOString() } = {}) {
  const original = checkedSession(value, currentSources);
  return frozen(withinBytes({ schema: OBSERVATION_PROOF_SCHEMA, sidecar: original,
    reviews: proofReviews(value.reviews, original), reviewAuthority: 'local-user-unverified', exportedAt: instant(now()) }));
}

/** Approximate seconds for display only; the stored timestamp remains exact. */
export function frameTimeSeconds(value) {
  const time = timestamp(value, value === null ? 'photo' : 'video');
  return time === null ? null : Number(time.pts) * time.timeBase[0] / time.timeBase[1];
}
