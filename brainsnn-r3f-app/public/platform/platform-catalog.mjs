// The API explorer's catalogue: operations from the published OpenAPI document, grouped by what a developer is
// doing, with example request bodies filled from what the session already created (project, source, revision...).
// Pure functions; the page and tests/world/platform-core.test.mjs both use them.

export const GROUPS = [
  { id: 'start', label: 'Start', match: path => path === '/status' || path === '/me' },
  { id: 'projects', label: 'Projects', match: path => /^\/projects(\/\{project_id\}(\/export)?)?$/.test(path) },
  { id: 'records', label: 'Site records', match: path => /^\/projects\/\{project_id\}\/(sources(\/\{source_id\})?|revisions|evidence|changes|trials)$/.test(path) },
  { id: 'review', label: 'Review', match: path => /\/(review|decisions)$/.test(path) },
  { id: 'workspace', label: 'Keys and usage', match: path => /^\/(keys|usage)/.test(path) },
  { id: 'processing', label: 'Processing', match: path => path.startsWith('/processing') },
  { id: 'uploads', label: 'Large sources', match: path => /source-uploads|\/content$/.test(path) },
];

/** Every operation in the document, in document order, with its group. */
export function operations(openapi) {
  const out = [];
  for (const [path, item] of Object.entries(openapi.paths || {})) {
    for (const method of ['get', 'post', 'put', 'delete', 'head']) {
      const op = item[method];
      if (!op) continue;
      const params = [...(item.parameters || []), ...(op.parameters || [])].map(p => resolve(openapi, p));
      const schemaRef = op.requestBody?.content?.['application/json']?.schema;
      out.push({
        id: op.operationId || `${method} ${path}`, method: method.toUpperCase(), path, summary: op.summary || '', description: op.description || '',
        scopes: op['x-required-scopes'] || [], public: Array.isArray(op.security) && op.security.length === 0,
        pathParams: params.filter(p => p.in === 'path').map(p => p.name),
        queryParams: params.filter(p => p.in === 'query').map(p => p.name),
        idempotent: params.some(p => p.in === 'header' && /idempotency-key/i.test(p.name)),
        bodySchema: schemaRef ? resolve(openapi, schemaRef) : null,
        binaryBody: !!op.requestBody?.content?.['application/octet-stream'],
        group: (GROUPS.find(g => g.match(path)) || { id: 'other' }).id,
      });
    }
  }
  return out;
}

export function resolve(openapi, node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return node;
  if (node.$ref) {
    const target = node.$ref.replace(/^#\//, '').split('/').reduce((value, key) => value?.[key], openapi);
    return resolve(openapi, target, depth + 1);
  }
  return node;
}

// Values a developer would type, by field name. Context supplies the IDs and version the session already has.
const NAMED = {
  title: () => 'Warehouse aisle 4', description: () => 'Phone scan of aisle 4 before the cart pilot.',
  name: () => 'reconstruction.json', media_type: () => 'application/json', content_text: () => '{"scan":"as-is","frames":24}\n',
  label: () => 'As-is scan, 24 November', claim: () => 'The aisle is 1.9 m wide at the dock door.', reason: () => 'Checked against the walk frames.',
  unit: () => 'm', value: () => 1.9, uncertainty: () => 0.05, component_id: () => 'aisle-4-dock-door',
  actor_name: () => 'Client reviewer', role: () => 'reviewer', robot_model: () => 'Cart AMR', task: () => 'Dock to aisle 4.',
  notes: () => 'Recorded during the pilot.', occurred_at: () => new Date().toISOString(),
  robot: () => ({ model: 'Cart AMR', width_m: 0.7, margin_m: 0.08 }), task_profile: () => ({ kind: 'route', goal: 'Dock to aisle 4.' }),
  locator: () => ({ note: 'Frame 12 of the walk video' }),
};

/** An example JSON body for an operation, using context IDs where the schema asks for them. */
export function exampleBody(openapi, op, context = {}) {
  if (!op.bodySchema) return null;
  const body = example(openapi, op.bodySchema, context, '', op);
  if (body && typeof body === 'object' && 'expected_version' in body) body.expected_version = context.version ?? 1;
  return body;
}

function example(openapi, schema, context, name, op, depth = 0) {
  schema = resolve(openapi, schema);
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return structuredClone(schema.example);
  // allOf beside the object's own properties only adds conditions (if/then); merge it only when it is the shape itself.
  if (schema.allOf && !schema.properties) return Object.assign({}, ...schema.allOf.map(part => example(openapi, part, context, name, op, depth + 1)));
  // A oneOf that only picks between the object's own properties (content_text or data_base64) is not a separate shape.
  if ((schema.oneOf || schema.anyOf) && !schema.properties && !schema.type) return example(openapi, (schema.oneOf || schema.anyOf)[0], context, name, op, depth + 1);
  const fromContext = contextValue(name, context, op);
  if (fromContext !== undefined) return fromContext;
  if (name === 'task' && schema.type === 'object') return NAMED.task_profile();
  if (NAMED[name] && !(name === 'task' && schema.type !== 'string')) return NAMED[name]();
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': {
      const out = {};
      const required = new Set(schema.required || []);
      for (const [key, value] of Object.entries(schema.properties || {})) {
        // Keep bodies short: required fields, plus optional ones a first request usually wants.
        if (!required.has(key) && !['description', 'width_m', 'margin_m', 'unit', 'value', 'uncertainty', 'component_id', 'parent_revision_id', 'sha256'].includes(key)) continue;
        if (key === 'sha256' || (key === 'data_base64' && !required.has(key))) continue;
        if (key === 'parent_revision_id' && !context.as_is_revision_id) continue;
        const v = example(openapi, value, context, key, op, depth + 1);
        if (v !== null && v !== undefined) out[key] = v;
      }
      if (op.id === 'addSource' && !('content_text' in out) && !('data_base64' in out)) out.content_text = NAMED.content_text();
      return out;
    }
    case 'array': return [example(openapi, schema.items || {}, context, name.replace(/s$/, ''), op, depth + 1)].filter(v => v !== null);
    case 'integer': return schema.minimum ?? 1;
    case 'number': return schema.minimum ?? 0.5;
    case 'boolean': return true;
    case 'string': return schema.format === 'date-time' ? new Date().toISOString() : (schema.minLength ? 'x'.repeat(schema.minLength) : 'example');
    default: return null;
  }
}

function contextValue(name, context, op) {
  if (name === 'source_ids' || name === 'source_id' || name === 'source_ids_item') return context.source_id ? (name.endsWith('s') ? [context.source_id] : context.source_id) : undefined;
  if (name === 'source') return context.source_id;
  if (name === 'revision_id') return op.id === 'createTrial' ? (context.proposed_revision_id || context.as_is_revision_id) : context.as_is_revision_id;
  if (name === 'base_revision_id' || name === 'parent_revision_id') return context.as_is_revision_id;
  if (name === 'proposed_revision_id') return context.proposed_revision_id;
  if (name === 'evidence_ids' || name === 'evidence_id') return context.evidence_id ? (name.endsWith('s') ? [context.evidence_id] : context.evidence_id) : undefined;
  if (name === 'kind' && op.id === 'createRevision') return context.as_is_revision_id ? 'proposed' : 'as_is';
  if (name === 'kind' && op.id === 'addEvidence') return 'measured';
  if (op.id === 'createChange' && name === 'title') return 'Route the cart around the crate';
  if (op.id === 'createChange' && name === 'reason') return 'The walk found a crate in aisle 4; the straight route runs through it.';
  if (op.id === 'createRevision' && name === 'label' && context.as_is_revision_id) return 'Proposed: route around the crate';
  return undefined;
}

/** Fill {project_id}-style placeholders from context; unknown ones stay as placeholders for the user to type. */
export function fillPath(path, values = {}) {
  return path.replace(/\{([a-z_]+)\}/g, (match, key) => (values[key] ? encodeURIComponent(values[key]) : match));
}

export function pathDefaults(context = {}) {
  return { project_id: context.project_id, source_id: context.source_id, evidence_id: context.evidence_id, change_id: context.change_id,
    key_id: context.key_id, upload_id: context.upload_id, job_id: context.job_id };
}

// IDs that belong to one project. Switching project drops them, so the next request never points at the last site.
const PROJECT_SCOPED = ['source_id', 'as_is_revision_id', 'proposed_revision_id', 'evidence_id', 'change_id', 'upload_id', 'job_id'];

/** What a response teaches the session: IDs and the project version, for prefilling the next request. */
export function learn(context, op, body) {
  const next = { ...context };
  if (!body || typeof body !== 'object') return next;
  const switchTo = id => { if (id !== next.project_id) for (const key of PROJECT_SCOPED) delete next[key]; next.project_id = id; };
  const project = body.project;
  if (project?.id) { switchTo(project.id); next.version = project.version; }
  if (Array.isArray(body.projects) && body.projects.length && !next.project_id) { switchTo(body.projects[0].id); next.version = body.projects[0].version; }
  const r = body.resource;
  if (r?.id) {
    if (r.id.startsWith('src_')) next.source_id = r.id;
    if (r.id.startsWith('rev_')) { if (r.kind === 'as_is') next.as_is_revision_id = r.id; else next.proposed_revision_id = r.id; }
    if (r.id.startsWith('ev_')) next.evidence_id = r.id;
    if (r.id.startsWith('chg_')) next.change_id = r.id;
  }
  if (project && 'current_as_is_revision_id' in project) {
    if (project.current_as_is_revision_id) next.as_is_revision_id = project.current_as_is_revision_id;
    else delete next.as_is_revision_id;  // no baseline yet: the next revision is the as-is one
  }
  if (body.key?.id && op.id === 'createKey') next.key_id = body.key.id;
  return next;
}
