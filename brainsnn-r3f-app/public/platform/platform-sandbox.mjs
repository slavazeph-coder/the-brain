// BrainSNN developer platform: an in-browser sandbox of the World Projects API (v1).
// It is a fetch implementation for the real SDK (createProjectsClient({ fetchImpl })), so the code a developer writes
// against the sandbox is the code that runs against the service. Responses follow the service's shapes, status codes
// and error codes for the core workflow; tests/world/platform-sandbox.test.mjs holds them to the real handlers.
// Nothing leaves the page and nothing is saved: the sandbox lives in memory and resets on reload. Processing, large
// uploads and exports are not simulated and answer 501 sandbox-not-simulated.

export const SANDBOX_TENANT = 'Sandbox workspace';
const ROLE_SCOPES = {
  reader: ['project:read', 'processing:read'],
  editor: ['project:read', 'project:write', 'processing:read', 'processing:write'],
  reviewer: ['project:read', 'project:write', 'review:decide', 'processing:read', 'processing:write'],
  admin: ['project:read', 'project:write', 'review:decide', 'processing:read', 'processing:write', 'keys:manage'],
};
const LIMITS = { projects: 100, sourcesPerProject: 128, sourceBytes: 524288, projectSourceBytes: 16777216,
  tenantSourceBytes: 134217728, recordsPerProject: 1000, eventsPerProject: 2000, keys: 100, requestsPerHour: 1200,
  requestBytes: 1048576, idempotencyKeys: 20000 };
const ID = /^[a-z0-9_-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;
const IDEMPOTENCY = /^[A-Za-z0-9:_-]{16,128}$/;

class SandboxError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (message, code = 'invalid-input') => { throw new SandboxError(422, code, message); };

// In bounded chunks: spreading a large source into one call exceeds the engine's argument limit.
function bytesToBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function hex(bytes) { return [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''); }
function randomHex(n) { const bytes = new Uint8Array(n); globalThis.crypto.getRandomValues(bytes); return hex(bytes); }
async function sha256(bytes) { return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))); }
function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
const clone = value => JSON.parse(JSON.stringify(value));

function shape(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('Send one JSON object.');
  const extra = Object.keys(value).filter(k => !allowed.includes(k));
  if (extra.length) bad(`Unsupported field: ${extra[0]}.`);
  const missing = required.filter(k => value[k] === undefined);
  if (missing.length) bad(`Provide ${missing.join(', ')}.`);
}
function text(value, name, limit, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > limit) bad(`Provide a ${name} of 1–${limit} characters.`);
  return value.trim();
}
function finite(value, name, low, high) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) bad(`Provide a ${name} from ${low} to ${high}.`);
  return value;
}
function selection(value, options, name) { if (!options.includes(value)) bad(`Choose a supported ${name}.`); return value; }
function identifier(value, name = 'identifier') { if (typeof value !== 'string' || !ID.test(value)) bad(`Provide a valid ${name} ID.`); return value; }
function ids(value, name, { minimum = 1 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 64 || new Set(value).size !== value.length) bad(`Provide distinct ${name} IDs.`);
  return value.map(v => identifier(v, name));
}
function optionalValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 2000) return value;
  if (typeof value === 'boolean') return value;
  bad('Provide a finite number, short text or true/false.');
}

/**
 * A sandbox workspace with four named principals (admin, editor, reviewer, reader). `keys` holds their bearer
 * tokens; the developer platform shows them as "act as" choices. Everything resets with a new sandbox.
 */
export function createSandboxApi({ now = () => Date.now(), tenantName = SANDBOX_TENANT } = {}) {
  const tenant = { id: `tenant_${randomHex(6)}`, name: tenantName };
  const actors = new Map();
  const keys = new Map(); // token -> key record
  const projects = new Map();
  const ledger = new Map(); // `${key_id}:${idempotency}` -> { fingerprint, status, body }
  const usage = { api_requests: 0, processing_jobs_started: 0, processing_upload_bytes: 0, processing_artifact_bytes: 0 };
  const time = () => new Date(now()).toISOString();
  const newId = prefix => `${prefix}_${randomHex(12)}`;

  // The service's provisioning rules (worldProjectStore.provisionKey): a key may be narrowed to some of its role's
  // scopes, expires within 366 days, and an existing principal must match exactly.
  function provision(actorName, role, actorId, scopes = ROLE_SCOPES[role], expiresAt) {
    if (!Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length || scopes.some(s => !ROLE_SCOPES[role].includes(s))) {
      bad('Scopes must be distinct permissions available to the assigned role.');
    }
    if (expiresAt !== undefined && (typeof expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(expiresAt))) bad('Use an ISO timestamp for credential expiry.');
    const expiry = expiresAt === undefined ? new Date(now() + 30 * 86400000) : new Date(expiresAt);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= now() || expiry.getTime() > now() + 366 * 86400000) bad('Key expiry must be in the next 366 days.');
    if (keys.size >= LIMITS.keys) throw new SandboxError(429, 'key-limit', 'This workspace reached its retained credential limit.');
    let actor = null;
    if (actorId) {
      actor = actors.get(actorId);
      if (!actor || actor.name !== actorName || actor.role !== role) bad('Existing principal identity and role must match exactly.');
    } else { actor = { id: newId('actor'), name: actorName, role }; actors.set(actor.id, actor); }
    const token = `bsk_${randomHex(21)}${'s'}`; // 43 characters after bsk_, like a real key
    const key = { id: newId('key'), actor_id: actor.id, actor_name: actor.name, role, scopes: [...scopes],
      expires_at: expiry.toISOString(), revoked_at: null, created_at: time() };
    keys.set(token, key);
    return { key, token, token_available: true };
  }
  const principals = {};
  for (const [role, name] of [['admin', 'You (sandbox admin)'], ['editor', 'Site operator'], ['reviewer', 'Client reviewer'], ['reader', 'Read-only viewer']]) {
    principals[role] = provision(name, role).token;
  }

  function authenticate(headers) {
    const auth = headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new SandboxError(401, 'api-key-required', 'Connect with a named project API credential.');
    const key = keys.get(token);
    if (!key || key.revoked_at || Date.parse(key.expires_at) <= now()) throw new SandboxError(401, 'invalid-api-key', 'This project credential is invalid, expired or revoked.');
    const actor = actors.get(key.actor_id);
    return { key, actor, scopes: key.scopes };
  }
  const scope = (principal, required) => {
    if (!principal.scopes.includes(required)) throw new SandboxError(403, 'forbidden', `This credential requires ${required}.`);
  };

  function publicProject(p) {
    return { id: p.id, title: p.title, description: p.description, version: p.version, current_as_is_revision_id: p.current_as_is_revision_id,
      created_by: p.created_by, created_at: p.created_at, updated_at: p.updated_at };
  }
  function latestPhysical(trials, revisionId) {
    return trials.filter(t => t.kind === 'physical' && t.revision_id === revisionId)
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || (b.recorded_project_version || 0) - (a.recorded_project_version || 0))[0] || null;
  }
  function readiness(project) {
    const measured = project.evidence.filter(e => e.revision_id === project.current_as_is_revision_id && e.kind === 'measured' && e.status === 'confirmed');
    const physical = project.trials.filter(t => t.kind === 'physical');
    const latest = latestPhysical(project.trials, project.current_as_is_revision_id);
    const pending = project.changes.filter(c => ['pending', 'approved', 'implemented'].includes(c.status));
    const stale = project.changes.filter(c => c.status === 'stale');
    const blockers = [];
    if (!project.sources.length) blockers.push({ code: 'no-retained-source', message: 'Retain source evidence for this site.' });
    if (!project.current_as_is_revision_id) blockers.push({ code: 'no-baseline', message: 'Record the current as-is revision.' });
    if (!measured.length) blockers.push({ code: 'no-reviewed-measurements', message: 'Review measurement evidence for the current as-is revision.' });
    if (!latest) blockers.push({ code: 'no-recorded-physical-pass', message: 'A physical trial for the current revision has not been recorded.' });
    else if (latest.outcome !== 'pass') blockers.push({ code: 'latest-physical-trial-not-passed', message: `The latest physical trial for the current revision is ${latest.outcome}. Earlier passes do not resolve it.` });
    if (latest?.outcome === 'pass' && !latest.measurement_evidence_ids.some(id => measured.some(e => e.id === id))) blockers.push({ code: 'trial-measurements-unreviewed', message: 'The latest physical trial has no linked, confirmed measurement evidence for this revision.' });
    if (pending.length) blockers.push({ code: 'change-review-outstanding', message: 'One or more changes still need a decision, implementation or verification.' });
    if (stale.length) blockers.push({ code: 'stale-changes', message: 'Earlier change decisions need review against the current evidence or baseline.' });
    return { state: !project.current_as_is_revision_id || !measured.length ? 'needs-evidence' : blockers.length ? 'review-required' : 'trial-recorded',
      blockers, counts: { sources: project.sources.length, revisions: project.revisions.length, evidence: project.evidence.length,
        confirmed_measured: measured.length, physical_trials: physical.length, failed_trials: project.trials.filter(t => t.outcome === 'fail').length,
        pending_changes: pending.length, stale_changes: stale.length },
      latest_physical_trial_id: latest?.id || null,
      meaning: 'Record completeness and operator attestations; not physical qualification or safety approval.', physical_validated: false, certified: false };
  }
  function aggregate(p) {
    const result = { ...publicProject(p), sources: p.sources.map(({ data_base64, created_by_name, ...s }) => s), revisions: clone(p.revisions),
      evidence: clone(p.evidence), changes: clone(p.changes), trials: clone(p.trials), events: clone(p.events) };
    result.readiness = readiness(result);
    return result;
  }
  function project(id) {
    const p = projects.get(identifier(id, 'project'));
    if (!p) throw new SandboxError(404, 'not-found', 'This project was not found.');
    return p;
  }
  function record(p, id, kind) {
    const list = { revision: p.revisions, evidence: p.evidence, change: p.changes, trial: p.trials }[kind];
    const found = list.find(item => item.id === id);
    if (!found) throw new SandboxError(404, 'not-found', `This ${kind} was not found.`);
    return found;
  }
  const expected = (body, p) => {
    if (!Number.isSafeInteger(body.expected_version) || body.expected_version !== p.version) throw new SandboxError(409, 'stale-version', 'The project changed. Reload it before submitting this action.');
  };
  const requireSources = (p, sourceIds) => {
    for (const id of sourceIds) if (!p.sources.some(s => s.id === id)) throw new SandboxError(404, 'not-found', 'This source was not found.');
  };
  function staleChanges(p, reason, filter = () => true) {
    for (const change of p.changes) if (!['rejected', 'stale'].includes(change.status) && filter(change)) {
      change.status = 'stale'; change.stale_reason = reason; change.stale_at = time();
    }
  }

  async function mutateProject(principal, p, action, resourceId, body) {
    const by = { created_by: principal.actor.id, created_by_name: principal.actor.name, created_at: time() };
    expected(body, p);
    let resource, eventType;
    if (action === 'sources' && !resourceId) {
      scope(principal, 'project:write');
      shape(body, ['expected_version', 'name', 'media_type', 'content_text', 'data_base64', 'sha256'], ['expected_version', 'name', 'media_type']);
      const name = text(body.name, 'source name', 160);
      if (typeof body.media_type !== 'string' || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(body.media_type) || body.media_type.length > 100) bad('Use a valid source media type without parameters.');
      if (Object.hasOwn(body, 'content_text') === Object.hasOwn(body, 'data_base64')) bad('Provide exactly one of content_text or data_base64.');
      let bytes;
      if (Object.hasOwn(body, 'content_text')) {
        if (typeof body.content_text !== 'string') bad('Source content_text must be a string.');
        bytes = new TextEncoder().encode(body.content_text);
      } else {
        if (typeof body.data_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data_base64)) bad('Use canonical base64 source bytes.');
        bytes = base64ToBytes(body.data_base64);
      }
      if (!bytes.length || bytes.length > LIMITS.sourceBytes) throw new SandboxError(413, 'source-too-large', 'Each retained source must contain 1–524288 bytes.');
      const digest = await sha256(bytes);
      if (body.sha256 !== undefined && (typeof body.sha256 !== 'string' || !HASH.test(body.sha256) || body.sha256 !== digest)) bad('Source bytes do not match the declared SHA-256.', 'source-hash-mismatch');
      if (p.sources.length >= LIMITS.sourcesPerProject) throw new SandboxError(429, 'source-limit', 'This project reached its retained source limit.');
      resource = { id: newId('src'), name, media_type: body.media_type.toLowerCase(), sha256: digest, bytes: bytes.length, storage_kind: 'inline', ...by };
      resource.download_path = `/projects/${p.id}/sources/${resource.id}/content`;
      p.sources.push({ ...resource, data_base64: bytesToBase64(bytes) });
      eventType = 'source.retained';
    } else if (action === 'revisions' && !resourceId) {
      scope(principal, 'project:write');
      shape(body, ['expected_version', 'label', 'kind', 'source_ids', 'robot', 'task', 'parent_revision_id'], ['expected_version', 'label', 'kind', 'source_ids', 'robot', 'task']);
      const kind = selection(body.kind, ['as_is', 'proposed'], 'revision kind');
      const sourceIds = ids(body.source_ids, 'source'); requireSources(p, sourceIds);
      shape(body.robot, ['model', 'width_m', 'margin_m'], ['model']); shape(body.task, ['kind', 'goal'], ['kind', 'goal']);
      const robot = { model: text(body.robot.model, 'robot model', 160) };
      if (body.robot.width_m !== undefined) robot.width_m = finite(body.robot.width_m, 'robot width', 0.001, 100);
      if (body.robot.margin_m !== undefined) robot.margin_m = finite(body.robot.margin_m, 'robot margin', 0, 100);
      const parent = body.parent_revision_id === undefined || body.parent_revision_id === null ? null : identifier(body.parent_revision_id, 'parent revision');
      if (kind === 'proposed' && !parent) bad('A proposed revision needs its as-is parent revision.');
      if (parent) { const parentRecord = record(p, parent, 'revision'); if (kind === 'proposed' && parentRecord.kind !== 'as_is') bad('A proposed revision must name an as-is parent.'); }
      resource = { id: newId('rev'), label: text(body.label, 'revision label', 160), kind, source_ids: sourceIds, robot,
        task: { kind: text(body.task.kind, 'task kind', 80), goal: text(body.task.goal, 'task goal', 2000) }, parent_revision_id: parent,
        physical_validated: false, ...by };
      p.revisions.push(resource);
      if (kind === 'as_is') { p.current_as_is_revision_id = resource.id; staleChanges(p, 'The current as-is revision changed. Rebase and review a new change request.'); }
      eventType = 'revision.recorded';
    } else if (action === 'evidence' && !resourceId) {
      scope(principal, 'project:write');
      shape(body, ['expected_version', 'revision_id', 'source_id', 'component_id', 'kind', 'claim', 'value', 'unit', 'locator', 'uncertainty', 'status'], ['expected_version', 'revision_id', 'source_id', 'kind', 'claim', 'locator']);
      const revisionId = identifier(body.revision_id, 'revision'), sourceId = identifier(body.source_id, 'source');
      record(p, revisionId, 'revision'); requireSources(p, [sourceId]);
      if (body.status !== undefined && body.status !== 'unreviewed') bad('New evidence is unreviewed. Use the explicit evidence review action.');
      shape(body.locator, ['page', 'frame', 'time_seconds', 'note']);
      const locator = {};
      for (const name of ['page', 'frame']) if (body.locator[name] !== undefined) {
        if (!Number.isSafeInteger(body.locator[name]) || body.locator[name] < (name === 'page' ? 1 : 0) || body.locator[name] > 1e8) bad('Invalid source locator.');
        locator[name] = body.locator[name];
      }
      if (body.locator.time_seconds !== undefined) locator.time_seconds = finite(body.locator.time_seconds, 'source time', 0, 1e8);
      if (body.locator.note !== undefined) locator.note = text(body.locator.note, 'locator note', 1000);
      if (!Object.keys(locator).length) bad('Provide a page, frame, timestamp or source locator note.');
      resource = { id: newId('ev'), revision_id: revisionId, source_id: sourceId,
        component_id: body.component_id === undefined || body.component_id === null ? null : text(body.component_id, 'component ID', 160),
        kind: selection(body.kind, ['measured', 'observed', 'inferred'], 'evidence kind'), claim: text(body.claim, 'evidence claim', 2000),
        value: optionalValue(body.value), unit: text(body.unit, 'unit', 80, true), locator, uncertainty: optionalValue(body.uncertainty),
        status: 'unreviewed', reviews: [], physical_validated: false, ...by };
      if (typeof resource.uncertainty === 'number' && resource.uncertainty < 0) bad('Numeric uncertainty must be nonnegative.');
      if (resource.kind === 'measured' && (typeof resource.value !== 'number' || !resource.unit)) bad('Measured evidence requires a finite numeric value and its unit.');
      p.evidence.push(resource);
      eventType = 'evidence.recorded';
    } else if (action === 'evidence' && resourceId) {
      scope(principal, 'review:decide');
      shape(body, ['expected_version', 'decision', 'reason'], ['expected_version', 'decision', 'reason']);
      resource = record(p, resourceId, 'evidence');
      const decision = selection(body.decision, ['confirmed', 'rejected'], 'evidence review decision');
      resource.reviews.push({ id: newId('decision'), decision, reason: text(body.reason, 'review reason', 2000), actor_id: principal.actor.id, actor_name: principal.actor.name, at: time() });
      resource.status = decision;
      if (decision === 'rejected') staleChanges(p, 'Reviewed evidence was rejected. A new change review is required.', c => c.evidence_ids.includes(resource.id) || c.proposed_revision_id === resource.revision_id);
      eventType = 'evidence.reviewed';
    } else if (action === 'changes' && !resourceId) {
      scope(principal, 'project:write');
      shape(body, ['expected_version', 'base_revision_id', 'proposed_revision_id', 'title', 'reason', 'evidence_ids'], ['expected_version', 'base_revision_id', 'proposed_revision_id', 'title', 'reason', 'evidence_ids']);
      const base = record(p, identifier(body.base_revision_id), 'revision');
      const proposal = record(p, identifier(body.proposed_revision_id), 'revision');
      if (base.kind !== 'as_is' || proposal.kind !== 'proposed' || base.id !== p.current_as_is_revision_id || base.id === proposal.id || (proposal.parent_revision_id && proposal.parent_revision_id !== base.id)) {
        throw new SandboxError(409, 'revision-conflict', 'Use the current as-is baseline and its proposed revision.');
      }
      const evidenceIds = ids(body.evidence_ids, 'evidence');
      for (const id of evidenceIds) { const e = record(p, id, 'evidence'); if (![base.id, proposal.id].includes(e.revision_id)) bad('Change evidence must refer to its base or proposed revision.'); }
      resource = { id: newId('chg'), title: text(body.title, 'change title', 160), reason: text(body.reason, 'change reason', 2000), base_revision_id: base.id,
        proposed_revision_id: proposal.id, evidence_ids: evidenceIds, proposed_by: principal.actor.id, proposed_by_name: principal.actor.name,
        status: 'pending', decisions: [], physical_validated: false, ...by };
      p.changes.push(resource);
      eventType = 'change.proposed';
    } else if (action === 'changes' && resourceId) {
      shape(body, ['expected_version', 'decision', 'reason', 'trial_id'], ['expected_version', 'decision', 'reason']);
      const decision = selection(body.decision, ['approve', 'reject', 'implemented', 'verified'], 'change decision');
      scope(principal, decision === 'implemented' ? 'project:write' : 'review:decide');
      resource = record(p, resourceId, 'change');
      if (resource.base_revision_id !== p.current_as_is_revision_id || resource.status === 'stale') throw new SandboxError(409, 'stale-change', 'The change no longer matches the current site baseline or evidence.');
      if (decision !== 'implemented' && resource.proposed_by === principal.actor.id) throw new SandboxError(403, 'independent-review-required', 'A different named principal must review this change.');
      const permitted = { approve: ['pending'], reject: ['pending', 'approved'], implemented: ['approved'], verified: ['implemented'] };
      if (!permitted[decision].includes(resource.status)) throw new SandboxError(409, 'invalid-transition', 'This decision is not available in the current change state.');
      if (decision === 'approve' || decision === 'verified') for (const id of resource.evidence_ids) {
        if (record(p, id, 'evidence').status !== 'confirmed') throw new SandboxError(409, 'evidence-unreviewed', 'Confirm every referenced evidence item before approval or verification.');
      }
      let trialId = null;
      if (decision === 'verified') {
        trialId = identifier(body.trial_id, 'physical trial');
        const trial = record(p, trialId, 'trial');
        if (trial.kind !== 'physical' || trial.outcome !== 'pass' || trial.revision_id !== resource.proposed_revision_id || !trial.measurement_evidence_ids.length) {
          throw new SandboxError(409, 'physical-trial-required', 'Record a passing physical trial with confirmed measurements for the proposed revision.');
        }
        // The service's other two rules: the trial came after the implementation, and no later physical trial overrides it.
        const implemented = resource.decisions.findLast(d => d.decision === 'implemented');
        if (!implemented || !(trial.recorded_project_version > implemented.project_version) || Date.parse(trial.occurred_at) < Date.parse(implemented.at)) {
          throw new SandboxError(409, 'post-implementation-trial-required', 'Verification requires a physical trial that occurred and was recorded after the implementation decision.');
        }
        if (latestPhysical(p.trials, resource.proposed_revision_id)?.id !== trial.id) {
          throw new SandboxError(409, 'latest-physical-trial-required', 'Review the latest physical trial for this revision. An earlier pass cannot supersede a later outcome.');
        }
        for (const id of trial.measurement_evidence_ids) {
          const e = record(p, id, 'evidence');
          if (e.kind !== 'measured' || e.status !== 'confirmed' || e.revision_id !== trial.revision_id) {
            throw new SandboxError(409, 'measurement-review-required', 'Physical verification needs confirmed measured evidence on the same proposed revision.');
          }
        }
      } else if (body.trial_id !== undefined && body.trial_id !== null) bad('A trial reference is accepted only for verification.');
      resource.decisions.push({ id: newId('decision'), decision, reason: text(body.reason, 'decision reason', 2000), trial_id: trialId,
        actor_id: principal.actor.id, actor_name: principal.actor.name, role: principal.key.role, at: time(), project_version: p.version + 1,
        attestation: 'credential-holder-recorded', physical_validated: false });
      resource.status = { approve: 'approved', reject: 'rejected', implemented: 'implemented', verified: 'verified' }[decision];
      eventType = `change.${resource.status}`;
    } else if (action === 'trials' && !resourceId) {
      scope(principal, 'project:write');
      shape(body, ['expected_version', 'revision_id', 'robot_model', 'task', 'kind', 'outcome', 'prediction', 'source_ids', 'measurement_evidence_ids', 'notes', 'occurred_at'],
        ['expected_version', 'revision_id', 'robot_model', 'task', 'kind', 'outcome', 'prediction', 'source_ids', 'notes', 'occurred_at']);
      const revisionId = identifier(body.revision_id, 'revision'); const revision = record(p, revisionId, 'revision');
      const robotModel = text(body.robot_model, 'robot model', 160); if (robotModel !== revision.robot.model) bad('The trial robot must match its immutable revision profile.');
      const trialTask = text(body.task, 'trial task', 2000); if (trialTask !== revision.task.goal) bad('The trial task must exactly match its immutable revision goal. Record another revision for a different task.');
      const sourceIds = ids(body.source_ids, 'source'); requireSources(p, sourceIds);
      const measurementIds = ids(body.measurement_evidence_ids || [], 'measurement evidence', { minimum: 0 });
      for (const id of measurementIds) { const e = record(p, id, 'evidence'); if (e.revision_id !== revisionId || e.kind !== 'measured') bad('Trial measurement evidence must be measured and bound to the same revision.'); }
      const occurred = typeof body.occurred_at === 'string' && Number.isFinite(Date.parse(body.occurred_at)) && Date.parse(body.occurred_at) <= now() + 300000
        ? new Date(body.occurred_at).toISOString() : bad('Provide when the trial happened, not in the future.');
      resource = { id: newId('trial'), revision_id: revisionId, robot_model: robotModel, task: trialTask, kind: selection(body.kind, ['physical', 'simulation'], 'trial kind'),
        outcome: selection(body.outcome, ['pass', 'fail', 'inconclusive'], 'trial outcome'), prediction: selection(body.prediction, ['pass', 'fail', 'unknown'], 'prediction'),
        source_ids: sourceIds, measurement_evidence_ids: measurementIds, notes: text(body.notes, 'trial notes', 4000), occurred_at: occurred,
        recorded_project_version: p.version + 1, origin: 'operator-reported', physical_validated: false, ...by };
      resource.prediction_agreed = resource.prediction === 'unknown' || resource.outcome === 'inconclusive' ? null : resource.prediction === resource.outcome;
      p.trials.push(resource);
      // Like the service: a later physical trial that did not pass withdraws the verification it supersedes.
      if (resource.kind === 'physical' && resource.outcome !== 'pass' && latestPhysical(p.trials, revisionId)?.id === resource.id) {
        staleChanges(p, 'A later physical trial did not pass. The recorded verification needs a new review.',
          c => c.status === 'verified' && c.proposed_revision_id === revisionId);
      }
      eventType = 'trial.recorded';
    } else throw new SandboxError(404, 'not-found', 'This project action was not found.');
    p.version += 1; p.updated_at = time();
    p.events.push({ id: newId('event'), type: eventType, resource_id: resource.id, actor_id: principal.actor.id, actor_name: principal.actor.name,
      role: principal.key.role, at: time(), project_version: p.version });
    const receipt = clone({ ...resource, ...(resource.reviews ? { reviews: resource.reviews.slice(-1) } : {}), ...(resource.decisions ? { decisions: resource.decisions.slice(-1) } : {}) });
    delete receipt.data_base64;
    return { status: resourceId ? 200 : 201, body: { project: aggregate(p), resource: receipt } };
  }

  function usageBody(principal) {
    let sourceBytes = 0, records = 0;
    for (const p of projects.values()) { sourceBytes += p.sources.reduce((s, x) => s + x.bytes, 0); records += p.revisions.length + p.evidence.length + p.changes.length + p.trials.length; }
    return { usage: { projects: projects.size, source_bytes: sourceBytes, records, keys: keys.size, object_source_bytes: 0, active_source_uploads: 0 },
      limits: LIMITS, billing: { month: time().slice(0, 7), period: 'calendar month, UTC', ...usage } };
  }

  async function dispatch(method, path, headers, body) {
    if (path === '/status' && method === 'GET') {
      return { status: 200, body: { available: true, service: 'world-projects', version: 'v1', storage: 'sandbox-memory', limits: LIMITS,
        object_storage: { configured: false }, identity: 'sandbox-key', sandbox: true, physical_validated: false } };
    }
    const principal = authenticate(headers);
    usage.api_requests += 1;
    if (method === 'POST') {
      // One mutation at a time, ledger lookup to receipt, as the service does under its tenant lock: two overlapping
      // sends of one prepared request then replay instead of both applying.
      const run = mutations.then(() => idempotent(method, path, headers, principal, body));
      mutations = run.catch(() => {});
      return run;
    }
    return route(method, path, principal, body);
  }

  let mutations = Promise.resolve();
  async function idempotent(method, path, headers, principal, body) {
    const key = headers.get('idempotency-key');
    if (typeof key !== 'string' || !IDEMPOTENCY.test(key)) throw new SandboxError(400, 'idempotency-key-required', 'Send an Idempotency-Key of 16–128 letters, numbers, colons, underscores or hyphens.');
    const fingerprint = canonical({ method, path, body });
    const prior = ledger.get(`${principal.key.id}:${key}`);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new SandboxError(409, 'idempotency-conflict', 'This Idempotency-Key was already used for another request.');
      // Like the service: a project mutation replays its receipt against the project as it is now.
      const current = prior.projectId && projects.get(prior.projectId);
      const body = current ? { project: aggregate(current), ...(prior.result.body.resource ? { resource: prior.result.body.resource } : {}), applied_version: prior.appliedVersion }
        : prior.result.body;
      return { status: prior.result.status, body: clone(body), replay: true };
    }
    const result = await route(method, path, principal, body);
    if (result.body.project) result.body.applied_version = result.body.project.version;
    ledger.set(`${principal.key.id}:${key}`, { fingerprint, result: clone(result), projectId: result.body.project?.id, appliedVersion: result.body.applied_version });
    return result;
  }

  async function route(method, path, principal, body) {
    if (method === 'GET' && path === '/me') {
      return { status: 200, body: { tenant: { id: tenant.id, name: tenant.name }, actor: { id: principal.actor.id, name: principal.actor.name, role: principal.key.role },
        identity: 'sandbox-key', scopes: principal.scopes, key: { id: principal.key.id, expires_at: principal.key.expires_at } } };
    }
    if (method === 'GET' && path === '/usage') { scope(principal, 'project:read'); return { status: 200, body: usageBody(principal) }; }
    if (method === 'GET' && path === '/projects') {
      scope(principal, 'project:read');
      return { status: 200, body: { projects: [...projects.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(publicProject) } };
    }
    if (method === 'POST' && path === '/projects') {
      scope(principal, 'project:write'); shape(body, ['title', 'description'], ['title']);
      if (projects.size >= LIMITS.projects) throw new SandboxError(429, 'project-limit', 'This workspace reached its project limit.');
      const at = time();
      const p = { id: newId('proj'), title: text(body.title, 'project title', 160), description: text(body.description, 'description', 4000, true), version: 1,
        current_as_is_revision_id: null, created_by: principal.actor.id, created_at: at, updated_at: at,
        sources: [], revisions: [], evidence: [], changes: [], trials: [], events: [] };
      p.events.push({ id: newId('event'), type: 'project.created', resource_id: p.id, actor_id: principal.actor.id, actor_name: principal.actor.name,
        role: principal.key.role, at, project_version: 1 });
      projects.set(p.id, p);
      return { status: 201, body: { project: aggregate(p) } };
    }
    if (path === '/keys') {
      scope(principal, 'keys:manage');
      if (method === 'GET') return { status: 200, body: { keys: [...keys.values()].map(k => clone(k)) } };
      if (method === 'POST') {
        shape(body, ['actor_name', 'actor_id', 'role', 'scopes', 'expires_at'], ['actor_name', 'role']);
        if (!Object.hasOwn(ROLE_SCOPES, body.role) || typeof body.actor_name !== 'string' || !body.actor_name.trim() || body.actor_name.length > 120) bad('Choose a named principal and a supported role.');
        const issued = provision(body.actor_name.trim(), body.role, body.actor_id, body.scopes ?? ROLE_SCOPES[body.role], body.expires_at);
        return { status: 201, body: { key: clone(issued.key), token: issued.token, token_available: true } };
      }
    }
    const keyMatch = path.match(/^\/keys\/([a-z0-9_-]+)\/revoke$/);
    if (method === 'POST' && keyMatch) {
      scope(principal, 'keys:manage'); shape(body, []);
      const entry = [...keys.values()].find(k => k.id === keyMatch[1]);
      if (!entry) throw new SandboxError(404, 'not-found', 'The credential was not found.');
      entry.revoked_at = entry.revoked_at || time();
      return { status: 200, body: { key: { id: entry.id, actor_id: entry.actor_id, revoked_at: entry.revoked_at } } };
    }
    const projectMatch = path.match(/^\/projects\/([a-z0-9_-]+)(?:\/([a-z]+)(?:\/([a-z0-9_-]+)(?:\/(review|decisions|content))?)?)?$/);
    if (projectMatch) {
      const [, projectId, action, resourceId, verb] = projectMatch;
      // Like the service: reading needs project:read; each mutation checks its own write or review scope.
      if (method === 'GET') scope(principal, 'project:read');
      const p = project(projectId);
      if (method === 'GET' && !action) return { status: 200, body: { project: aggregate(p) } };
      if (method === 'GET' && action === 'sources' && resourceId && !verb) {
        const source = p.sources.find(s => s.id === resourceId);
        if (!source) throw new SandboxError(404, 'not-found', 'This source was not found.');
        const { data_base64, created_by_name, ...rest } = source;
        return { status: 200, body: { source: rest, data_base64 } };
      }
      if (method === 'POST' && ((action === 'evidence' && verb === 'review') || (action === 'changes' && verb === 'decisions') || (!resourceId && !verb))) {
        return mutateProject(principal, p, action, resourceId, body);
      }
    }
    if (path.startsWith('/processing/') || /\/(export|source-uploads|content)/.test(path)) {
      throw new SandboxError(501, 'sandbox-not-simulated', 'The sandbox does not run processing, large uploads or exports. Connect a project key to call this endpoint.');
    }
    throw new SandboxError(404, 'not-found', 'This project action was not found.');
  }

  async function fetchImpl(url, init = {}) {
    const headers = new Headers(init.headers || {});
    const method = (init.method || 'GET').toUpperCase();
    const requestId = `req_${randomHex(8)}`;
    const path = new URL(url, 'http://sandbox.local').pathname.replace(/^.*\/api\/world\/v1/, '') || '/';
    const reply = (status, value, extra = {}) => new Response(JSON.stringify(value), { status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, 'X-BrainSNN-Sandbox': 'true', ...extra } });
    if (init.signal?.aborted) throw init.signal.reason || new DOMException('Aborted', 'AbortError');
    try {
      let body;
      if (method === 'POST') {
        if (!/^application\/json/i.test(headers.get('content-type') || '')) throw new SandboxError(415, 'json-required', 'Send application/json.');
        try { body = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body)); } catch { bad('Send one JSON object.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) bad('Send one JSON object.');
      } else if (!['GET', 'PUT'].includes(method)) throw new SandboxError(405, 'method-not-allowed', 'Use a documented GET, POST or upload-part PUT endpoint.');
      const result = await dispatch(method, path, headers, body);
      return reply(result.status, result.body, result.replay ? { 'Idempotency-Replayed': 'true' } : {});
    } catch (error) {
      if (!(error instanceof SandboxError)) throw error;
      return reply(error.status, { error: { code: error.code, message: error.message, request_id: requestId } });
    }
  }

  return { fetch: fetchImpl, principals, tenant, roles: Object.keys(principals) };
}
