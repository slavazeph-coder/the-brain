// Records a world update (robotics/world_worker/world_update.py, project-requests.json) in a World Project for review.
// Each step is one ordinary SDK mutation: the source, evidence on the current as-is revision, then one proposed revision
// and one change per robot. Nothing is approved or applied here; a different named reviewer must confirm the evidence
// and approve each change. The plan stops at the first refused step and reports the ids it created.

export const WORLD_UPDATE_PLAN_SCHEMA = 'brainsnn.project-request-plan.v1';
const ACTIONS = new Set(['addSource', 'addEvidence', 'createRevision', 'createChange']);
const REF = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Only these fields may name an earlier step ("$ref") or the current as-is revision ("$as_is").
const SINGLE = ['revision_id', 'source_id', 'parent_revision_id', 'base_revision_id', 'proposed_revision_id'];
const LISTS = ['source_ids', 'evidence_ids'];

export function checkWorldUpdatePlan(plan) {
  if (!plan || typeof plan !== 'object' || plan.schema !== WORLD_UPDATE_PLAN_SCHEMA) {
    throw new Error(`Use a ${WORLD_UPDATE_PLAN_SCHEMA} plan from world_update.py.`);
  }
  if (!Array.isArray(plan.steps) || plan.steps.length > 64) throw new Error('A plan has at most 64 steps.');
  const refs = new Set(['as_is']);
  for (const [index, step] of plan.steps.entries()) {
    if (!step || !ACTIONS.has(step.action) || typeof step.ref !== 'string' || !REF.test(step.ref) || refs.has(step.ref)) {
      throw new Error(`Step ${index + 1} needs a known action and a new lower-case ref.`);
    }
    if (!step.body || typeof step.body !== 'object' || Array.isArray(step.body) || 'expected_version' in step.body) {
      throw new Error(`Step ${index + 1} needs a body without expected_version (it is read when the step runs).`);
    }
    for (const value of references(step.body)) {
      if (!refs.has(value.slice(1))) throw new Error(`Step ${index + 1} refers to ${value} before it exists.`);
    }
    // The service accepts at most 32 evidence IDs on a change; refuse here, before any step runs, not at that step.
    if (step.action === 'createChange' && (!Array.isArray(step.body.evidence_ids) || step.body.evidence_ids.length > 32)) {
      throw new Error(`Step ${index + 1} must cite 1 to 32 evidence items.`);
    }
    refs.add(step.ref);
  }
  return plan;
}

function references(body) {
  const values = [];
  for (const name of SINGLE) if (typeof body[name] === 'string' && body[name].startsWith('$')) values.push(body[name]);
  for (const name of LISTS) if (Array.isArray(body[name])) values.push(...body[name].filter(v => typeof v === 'string' && v.startsWith('$')));
  return values;
}

function resolve(body, ids) {
  const id = value => (typeof value === 'string' && value.startsWith('$') ? ids[value.slice(1)] : value);
  const out = { ...body };
  for (const name of SINGLE) if (name in out) out[name] = id(out[name]);
  for (const name of LISTS) if (Array.isArray(out[name])) out[name] = out[name].map(id);
  return out;
}

/**
 * Run a plan against `projectId` with a projects client. Returns the project after the last step and every created id.
 * baseline 'require' (default): the project's current as-is revision must hold the exact scan the walk was compared
 * with (plan.as_is_scan) as a source. 'any' records the update against whatever the current as-is revision is.
 */
export async function applyWorldUpdatePlan(client, projectId, plan, { onStep, signal, baseline = 'require' } = {}) {
  checkWorldUpdatePlan(plan);
  if (!['require', 'any'].includes(baseline)) throw new Error("baseline is 'require' or 'any'.");
  let { project } = await client.getProject(projectId, { signal });
  if (!project?.current_as_is_revision_id) {
    throw new Error("Record the site's as-is revision first; a world update is proposed against it.");
  }
  const sources = project.sources || [];
  const recorded = sources.find(source => source.sha256 === plan.source_sha256);
  if (plan.steps.length && recorded) {
    throw new Error(`This world update is already recorded in the project (source ${recorded.id}); it was not recorded again.`);
  }
  if (baseline === 'require') {
    const scan = plan.as_is_scan?.sha256;
    if (!scan) throw new Error("This plan does not name the scan the walk was compared with. Pass baseline 'any' to record it anyway.");
    const asIs = (project.revisions || []).find(revision => revision.id === project.current_as_is_revision_id);
    const held = new Set((asIs?.source_ids || []).map(id => sources.find(source => source.id === id)?.sha256));
    if (!held.has(scan)) {
      throw new Error("The walk was compared with a scan that is not a source of the project's current as-is revision " +
        `(reconstruction.json ${scan.slice(0, 12)}…). Retain that scan as the as-is revision's source, compare the walk ` +
        "with the current scan, or pass baseline 'any' knowingly.");
    }
  }
  const ids = { as_is: project.current_as_is_revision_id };
  for (const step of plan.steps) {
    const body = { ...resolve(step.body, ids), expected_version: project.version };
    const result = await client.prepareMutation(step.action, [projectId, body]).run({ signal });
    project = result.project;
    ids[step.ref] = result.resource.id;
    onStep?.({ ref: step.ref, action: step.action, id: result.resource.id, version: project.version });
  }
  return { project, ids };
}
