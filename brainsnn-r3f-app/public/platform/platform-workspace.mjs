// Workspace views: projects (with the plain-language client review page), keys, usage, processing and docs.
import { state, api, can, done, go, needConnection, actAs, refreshMe, origin, ROLE_LABELS, createIdempotencyKey } from './platform.mjs';
import { snippets } from './platform-snippets.mjs';
import { h, clear, add, toast, codeTabs, explain, copy, fmtBytes, fmtWhen } from './platform-dom.mjs';

const READINESS = {
  'needs-evidence': ['Needs evidence', 'The site record is missing a baseline or reviewed measurements.'],
  'review-required': ['Waiting on a review', 'Something needs a decision before this site record is complete.'],
  'trial-recorded': ['Trial recorded', 'Every recorded step is complete. This is a record, not a safety approval.'],
};
const STATUS_WORDS = { pending: 'Waiting for approval', approved: 'Approved', implemented: 'Done on site', verified: 'Verified on site', rejected: 'Rejected', stale: 'Out of date' };
const EVENT_WORDS = {
  'project.created': 'started the project', 'source.retained': 'added a source', 'revision.recorded': 'recorded a revision', 'evidence.recorded': 'added evidence',
  'evidence.reviewed': 'reviewed evidence', 'change.proposed': 'proposed a change', 'change.approved': 'approved a change', 'change.rejected': 'rejected a change',
  'change.implemented': 'marked a change done on site', 'change.verified': 'verified a change', 'trial.recorded': 'recorded a trial',
};

function viewHead(eyebrow, title, lead, ...extra) {
  return h('header', { class: 'pf-view-head' }, h('div', {}, h('p', { class: 'pf-eyebrow', text: eyebrow }), h('h1', { text: title }), lead ? h('p', { class: 'pf-muted', text: lead }) : null), ...extra);
}
const reasonOf = form => (new FormData(form).get('reason') || '').toString().trim();

// ---------------------------------------------------------------- projects

export async function renderProjects(main, projectId) {
  if (!state.mode) { add(main, viewHead('Projects', 'Your sites.', 'One project per site: its sources, as-is and proposed revisions, evidence, changes and trials.')); needConnection(main, 'projects'); return; }
  if (projectId) return renderProject(main, projectId);
  add(main, viewHead('Projects', 'Your sites.', 'One project per site. Open one to see it the way your client does.',
    state.mode === 'sandbox' ? h('button', { type: 'button', class: 'pf-secondary', onclick: async () => { const id = await seedSampleSite(); if (id) go(`#/projects/${id}`); }, text: 'Add a sample site' }) : null));
  const list = h('div', { class: 'pf-projects', 'aria-live': 'polite' }, h('p', { class: 'pf-muted', text: 'Loading projects…' }));
  const form = h('form', { class: 'pf-inline-form', 'aria-label': 'New project' },
    h('label', { for: 'pf-new-title', class: 'pf-visually-hidden', text: 'Project title' }),
    h('input', { class: 'pf-input', id: 'pf-new-title', name: 'title', required: true, maxlength: '160', placeholder: 'New site, e.g. Warehouse aisle 4' }),
    h('button', { type: 'submit', class: 'pf-primary', disabled: !can('project:write'), text: 'Create project' }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const title = new FormData(form).get('title').toString().trim();
    if (!title) return;
    try { const { project } = await api().createProject({ title }); done('project'); go(`#/projects/${project.id}`); }
    catch (error) { list.prepend(explain(error)); }
  });
  add(main, form, list);
  try {
    const { projects } = await api().listProjects();
    clear(list);
    if (!projects.length) {
      add(list, h('div', { class: 'pf-empty' }, h('h2', { text: 'No sites yet' }),
        h('p', { text: state.mode === 'sandbox' ? 'Create one above, or add a sample site with a change waiting for approval.' : 'Create one above, or from your code with createProject().' })));
      return;
    }
    for (const p of projects) {
      add(list, h('a', { class: 'pf-card pf-project', href: `#/projects/${encodeURIComponent(p.id)}` },
        h('h2', { text: p.title }), p.description ? h('p', { class: 'pf-muted', text: p.description }) : null,
        h('p', { class: 'pf-mono pf-faint', text: `version ${p.version} · updated ${fmtWhen(p.updated_at)}` })));
    }
  } catch (error) { add(clear(list), explain(error)); }
}

async function renderProject(main, projectId) {
  let project;
  try { ({ project } = await api().getProject(projectId)); }
  catch (error) { add(main, h('a', { class: 'pf-back', href: '#/projects', text: '← All projects' }), explain(error)); return; }
  state.context = { ...state.context, project_id: project.id, version: project.version, as_is_revision_id: project.current_as_is_revision_id || state.context.as_is_revision_id };
  const [stateLabel, generic] = READINESS[project.readiness.state] || [project.readiness.state, ''];
  const stateMeaning = project.readiness.blockers[0]?.message || generic;
  const pending = project.changes.filter(c => c.status === 'pending');
  const waiting = [...pending, ...project.changes.filter(c => c.status === 'approved')];
  add(main, h('a', { class: 'pf-back', href: '#/projects', text: '← All projects' }),
    h('header', { class: 'pf-site-head' },
      h('div', {}, h('p', { class: 'pf-eyebrow', text: 'Client view' }), h('h1', { text: project.title }),
        project.description ? h('p', { class: 'pf-muted', text: project.description }) : null),
      h('div', { class: `pf-ready pf-ready-${project.readiness.state}` }, h('strong', { text: stateLabel }), h('span', { text: stateMeaning }))));

  const asIs = project.revisions.find(r => r.id === project.current_as_is_revision_id);
  add(main, h('section', { class: 'pf-grid3 pf-facts', 'aria-label': 'Site facts' },
    fact('Baseline', asIs ? asIs.label : 'Not recorded yet', asIs ? `${asIs.robot.model}${asIs.robot.width_m ? `, ${asIs.robot.width_m} m wide` : ''}` : 'Record an as-is revision'),
    fact('Evidence', `${project.evidence.filter(e => e.status === 'confirmed').length} confirmed of ${project.evidence.length}`, `${project.sources.length} source${project.sources.length === 1 ? '' : 's'} retained`),
    fact('Changes', `${pending.length} waiting`, `${project.changes.length} in total`)));

  const decisions = h('section', { class: 'pf-card', 'aria-labelledby': 'pf-waiting' }, h('h2', { id: 'pf-waiting', text: waiting.length ? 'Waiting on you' : 'Nothing is waiting' }));
  if (!waiting.length) add(decisions, h('p', { class: 'pf-muted', text: project.changes.length ? 'Every proposed change has a decision.' : 'When someone proposes a change to this site, it shows up here with its evidence and two buttons.' }));
  for (const change of waiting) add(decisions, changeCard(project, change));
  add(main, decisions);

  add(main, h('section', { class: 'pf-card', 'aria-labelledby': 'pf-history' }, h('h2', { id: 'pf-history', text: 'What happened' }),
    h('ol', { class: 'pf-timeline' }, [...project.events].reverse().slice(0, 30).map(event => h('li', {},
      h('span', { class: 'pf-mono pf-faint', text: fmtWhen(event.at) }),
      h('span', {}, h('strong', { text: event.actor_name }), ` ${EVENT_WORDS[event.type] || event.type}`))))));

  add(main, h('details', { class: 'pf-card' }, h('summary', { text: 'The full record (for developers)' }),
    h('p', { class: 'pf-muted' }, 'Everything above comes from GET /projects/{id}. ', h('a', { href: `#/explorer/getProject`, text: 'Open it in the explorer' }), ', or the ',
      h('a', { href: '/world/projects.html', text: 'full project workspace' }), ' for sources, revisions and trials.'),
    codeTabs(snippets({ method: 'GET', path: `/projects/${project.id}`, op: { id: 'getProject' }, origin: origin() }), 'Read this project')));
}

function fact(label, value, note) {
  return h('div', { class: 'pf-card pf-fact' }, h('span', { class: 'pf-eyebrow', text: label }), h('strong', { text: value }), h('span', { class: 'pf-muted', text: note }));
}

function changeCard(project, change) {
  const proposed = project.revisions.find(r => r.id === change.proposed_revision_id);
  const evidence = change.evidence_ids.map(id => project.evidence.find(e => e.id === id)).filter(Boolean);
  const unconfirmed = evidence.filter(e => e.status !== 'confirmed');
  const mine = state.me?.actor?.id === change.proposed_by;
  const reviewer = can('review:decide');
  const card = h('article', { class: 'pf-change' },
    h('div', { class: 'pf-change-head' }, h('h3', { text: change.title }), h('span', { class: `pf-chip pf-chip-${change.status}`, text: STATUS_WORDS[change.status] || change.status })),
    h('p', { text: change.reason }),
    h('p', { class: 'pf-muted', text: `Proposed by ${change.proposed_by_name}${proposed ? ` · new plan: ${proposed.task.goal}` : ''}` }),
    h('h4', { class: 'pf-label', text: `Evidence (${evidence.length})` }),
    h('ul', { class: 'pf-evidence' }, evidence.map(e => h('li', {},
      h('span', { class: `pf-chip pf-chip-${e.status}`, text: e.status === 'unreviewed' ? 'Not checked yet' : e.status === 'confirmed' ? 'Confirmed' : 'Rejected' }),
      h('span', { text: e.claim }),
      e.status === 'unreviewed' && reviewer ? evidenceButtons(project, e) : null))));
  if (change.status === 'pending') {
    if (!reviewer) add(card, h('p', { class: 'pf-note', text: state.mode === 'sandbox' ? 'Only a reviewer can decide. Switch to Client reviewer at the top of the page.' : 'Your key cannot approve changes. Ask a reviewer.' }),
      state.mode === 'sandbox' ? h('button', { type: 'button', class: 'pf-secondary', onclick: () => actAs('reviewer'), text: 'Act as the client reviewer' }) : null);
    else if (mine) add(card, h('p', { class: 'pf-note', text: 'You proposed this change, so someone else has to decide it. That is the point.' }),
      state.mode === 'sandbox' ? h('button', { type: 'button', class: 'pf-secondary', onclick: () => actAs(state.role === 'reviewer' ? 'admin' : 'reviewer'), text: 'Switch person' }) : null);
    else add(card, decisionForm(project, change, unconfirmed.length));
  } else if (change.status === 'approved') {
    add(card, h('p', { class: 'pf-note', text: 'Approved. When the site team has made the change, they mark it done; a passing physical trial then verifies it.' }));
    if (can('project:write')) {
      const form = h('form', { class: 'pf-decide' },
        h('label', { class: 'pf-label', for: `pf-impl-${change.id}`, text: 'What was done on site' }),
        h('input', { class: 'pf-input', id: `pf-impl-${change.id}`, name: 'reason', required: true, maxlength: '2000', placeholder: 'e.g. Route updated in the fleet manager' }),
        h('div', { class: 'pf-actions' }, h('button', { type: 'submit', class: 'pf-secondary', text: 'Mark done on site' })));
      form.addEventListener('submit', event => { event.preventDefault(); decide(project, change, 'implemented', reasonOf(form), form); });
      add(card, form);
    }
  }
  return card;
}

function evidenceButtons(project, evidence) {
  const confirm = async decision => {
    const reason = decision === 'confirmed' ? 'Checked against the walk frames.' : 'Does not match what is on site.';
    try {
      const fresh = (await api().getProject(project.id)).project;
      await api().reviewEvidence(project.id, evidence.id, { expected_version: fresh.version, decision, reason });
      toast(decision === 'confirmed' ? 'Evidence confirmed.' : 'Evidence rejected. Changes relying on it are now out of date.', decision === 'confirmed' ? 'ok' : 'warn');
      go(`#/projects/${project.id}`);
    } catch (error) { toast(error.message, 'warn'); }
  };
  return h('span', { class: 'pf-inline-actions' },
    h('button', { type: 'button', class: 'pf-ghost pf-small', onclick: () => confirm('confirmed'), text: 'Confirm' }),
    h('button', { type: 'button', class: 'pf-ghost pf-small', onclick: () => confirm('rejected'), text: 'Reject' }));
}

function decisionForm(project, change, unconfirmed) {
  const form = h('form', { class: 'pf-decide' },
    h('label', { class: 'pf-label', for: `pf-reason-${change.id}`, text: 'Your reason (kept with the decision)' }),
    h('input', { class: 'pf-input', id: `pf-reason-${change.id}`, name: 'reason', required: true, maxlength: '2000', placeholder: 'e.g. The crate is there; the new route is fine' }),
    unconfirmed ? h('p', { class: 'pf-note', text: `Confirm the ${unconfirmed === 1 ? 'evidence item' : `${unconfirmed} evidence items`} above before approving.` }) : null,
    h('div', { class: 'pf-actions' },
      h('button', { type: 'submit', class: 'pf-primary', name: 'decision', value: 'approve', disabled: unconfirmed > 0, text: 'Approve' }),
      h('button', { type: 'submit', class: 'pf-secondary', name: 'decision', value: 'reject', text: 'Reject' })));
  form.addEventListener('submit', event => {
    event.preventDefault();
    decide(project, change, event.submitter?.value || 'approve', reasonOf(form), form);
  });
  return form;
}

async function decide(project, change, decision, reason, form) {
  if (!reason) { toast('Add a short reason first.', 'warn'); return; }
  try {
    const fresh = (await api().getProject(project.id)).project;
    const { resource } = await api().decideChange(project.id, change.id, { expected_version: fresh.version, decision, reason });
    if (resource.status === 'approved') done('approve');
    toast(`${STATUS_WORDS[resource.status] || resource.status}: ${change.title}.`, 'ok');
    go(`#/projects/${project.id}`);
  } catch (error) { add(form, explain(error)); }
}

/** A sample site with a change waiting for the client reviewer, made through the SDK as the site operator. */
export async function seedSampleSite() {
  if (state.mode !== 'sandbox') return null;
  const operator = (await import('../world/projects-client.mjs')).createProjectsClient({ apiKey: state.sandbox.principals.editor, baseUrl: '/api/world/v1', fetchImpl: state.sandbox.fetch });
  let { project } = await operator.createProject({ title: 'Warehouse aisle 4 (sample)', description: 'A phone walk found a crate in the aisle. The cart AMR needs a new route.' });
  const text = '{"scan":"as-is","frames":24,"note":"sandbox sample"}\n';
  const source = await operator.addSource(project.id, { expected_version: project.version, name: 'reconstruction.json', media_type: 'application/json', content_text: text });
  project = source.project;
  const asIs = await operator.createRevision(project.id, { expected_version: project.version, label: 'As-is scan', kind: 'as_is', source_ids: [source.resource.id],
    robot: { model: 'Cart AMR', width_m: 0.7, margin_m: 0.08 }, task: { kind: 'route', goal: 'Dock to aisle 4.' } });
  project = asIs.project;
  const plan = await operator.createRevision(project.id, { expected_version: project.version, label: 'Proposed: route around the crate', kind: 'proposed', source_ids: [source.resource.id],
    robot: { model: 'Cart AMR', width_m: 0.7, margin_m: 0.08 }, task: { kind: 'route', goal: 'Dock to aisle 4 by the right-hand side, 0.6 m clear of the crate.' }, parent_revision_id: asIs.resource.id });
  project = plan.project;
  const evidence = await operator.addEvidence(project.id, { expected_version: project.version, revision_id: asIs.resource.id, source_id: source.resource.id, component_id: 'candidate-2',
    kind: 'observed', claim: 'A 1.2 × 0.5 m crate now stands in the middle of aisle 4 (seen in 4 walk frames; the spot was empty in the as-is scan).', value: 0.6, unit: 'm2', locator: { note: 'world-update.json, candidate-2' } });
  project = evidence.project;
  await operator.createChange(project.id, { expected_version: project.version, base_revision_id: asIs.resource.id, proposed_revision_id: plan.resource.id,
    title: 'Route the cart around the crate', reason: 'The straight route now runs through the crate; the right-hand side keeps 0.6 m of clearance.', evidence_ids: [evidence.resource.id] });
  done('project'); done('evidence');
  toast('Sample site added. Approve its change as the client reviewer.', 'ok');
  if (state.role !== 'reviewer') await actAs('reviewer');
  return project.id;
}

// ---------------------------------------------------------------- keys

export async function renderKeys(main) {
  add(main, viewHead('Keys', 'One key per person.', 'Each key names a person and a role. Give the client a reviewer key; your code an editor key. Revoke a key and it stops working at once.'));
  if (!state.mode) { needConnection(main, 'keys'); return; }
  if (!can('keys:manage')) {
    add(main, h('div', { class: 'pf-empty' }, h('h2', { text: 'Only an admin key can manage keys' }),
      h('p', { text: `You are connected as ${ROLE_LABELS[state.me?.actor?.role] || 'someone'} without keys:manage.` }),
      state.mode === 'sandbox' ? h('button', { type: 'button', class: 'pf-primary', onclick: () => actAs('admin'), text: 'Act as the admin' }) : null));
    return;
  }
  const secret = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'pf-card pf-key-form', 'aria-label': 'Issue a key' },
    h('h2', { text: 'Issue a key' }),
    h('div', { class: 'pf-fields' },
      h('label', {}, h('span', { class: 'pf-label', text: 'Person or system' }), h('input', { class: 'pf-input', name: 'actor_name', required: true, maxlength: '120', placeholder: 'e.g. Dana at Acme Robotics' })),
      h('label', {}, h('span', { class: 'pf-label', text: 'Role' }), h('select', { class: 'pf-input', name: 'role' },
        [['reviewer', 'Reviewer · approves changes'], ['editor', 'Editor · records sites'], ['reader', 'Reader · read only'], ['admin', 'Admin · also manages keys']]
          .map(([value, label]) => h('option', { value, text: label })))),
      h('label', {}, h('span', { class: 'pf-label', text: 'Expires after' }), h('select', { class: 'pf-input', name: 'days' },
        [['30', '30 days'], ['90', '90 days'], ['365', '1 year']].map(([value, label]) => h('option', { value, text: label }))))),
    h('div', { class: 'pf-actions' }, h('button', { type: 'submit', class: 'pf-primary', text: 'Issue key' })));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      const issued = await api().createKey({ actor_name: data.get('actor_name').toString().trim(), role: data.get('role').toString(),
        expires_at: new Date(Date.now() + Number(data.get('days')) * 86400000 - 60000).toISOString() });
      form.reset();
      add(clear(secret), h('div', { class: 'pf-secret', role: 'alert' },
        h('strong', { text: `Key for ${issued.key.actor_name}. Copy it now: it is shown once and never stored here.` }),
        h('code', { class: 'pf-mono', text: issued.token }),
        h('div', { class: 'pf-actions' },
          h('button', { type: 'button', class: 'pf-primary', onclick: () => copy(issued.token, 'Key copied'), text: 'Copy key' }),
          h('button', { type: 'button', class: 'pf-secondary', onclick: () => { clear(secret); }, text: 'I saved it' }))));
      await drawKeys(table);
    } catch (error) { add(clear(secret), explain(error)); }
  });
  const table = h('div', { class: 'pf-card', 'aria-live': 'polite' });
  add(main, form, secret, table);
  await drawKeys(table);
}

async function drawKeys(container) {
  add(clear(container), h('h2', { text: 'Keys in this workspace' }));
  try {
    const { keys } = await api().listKeys();
    const rows = keys.map(key => {
      const revoked = !!key.revoked_at, expired = Date.parse(key.expires_at) <= Date.now(), self = key.id === state.me?.key?.id;
      const action = revoked || expired ? h('span', { class: 'pf-faint', text: revoked ? 'Revoked' : 'Expired' })
        : self ? h('span', { class: 'pf-faint', text: 'This key' }) : revokeButton(key, container);
      return h('tr', {}, h('td', {}, h('strong', { text: key.actor_name }), h('div', { class: 'pf-mono pf-faint', text: key.id })),
        h('td', { text: ROLE_LABELS[key.role] || key.role }), h('td', { text: fmtWhen(key.created_at) }), h('td', { text: fmtWhen(key.expires_at) }), h('td', {}, action));
    });
    add(container, h('div', { class: 'pf-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Keys' },
      h('table', { class: 'pf-table' }, h('thead', {}, h('tr', {}, ['Person', 'Role', 'Issued', 'Expires', ''].map(t => h('th', { scope: 'col', text: t })))), h('tbody', {}, rows))));
  } catch (error) { add(container, explain(error)); }
}

function revokeButton(key, container) {
  let armed = false;
  const button = h('button', { type: 'button', class: 'pf-ghost pf-small pf-danger', text: 'Revoke' });
  button.addEventListener('click', async () => {
    if (!armed) { armed = true; button.textContent = `Revoke ${key.actor_name}'s key?`; setTimeout(() => { armed = false; button.textContent = 'Revoke'; }, 4000); return; }
    try { await api().revokeKey(key.id, {}); toast(`${key.actor_name}'s key no longer works.`, 'ok'); await drawKeys(container); }
    catch (error) { toast(error.message, 'warn'); }
  });
  return button;
}

// ---------------------------------------------------------------- usage

export async function renderUsage(main) {
  add(main, viewHead('Usage', 'This month, against your limits.', 'Counted per calendar month (UTC). Pilots are invoiced from these numbers.'));
  if (!state.mode) { needConnection(main, 'usage'); return; }
  try {
    const { usage, limits, billing } = await api().usage();
    const meter = (label, value, limit, format = n => n.toLocaleString()) => {
      const share = limit ? Math.min(1, value / limit) : 0;
      return h('div', { class: 'pf-card pf-meter' }, h('span', { class: 'pf-eyebrow', text: label }), h('strong', { text: format(value) }),
        h('div', { class: 'pf-bar', role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': String(limit || 0), 'aria-valuenow': String(value) },
          h('i', { style: `width:${(share * 100).toFixed(1)}%` })),
        h('span', { class: 'pf-muted', text: limit ? `of ${format(limit)}` : 'no fixed limit' }));
    };
    add(main, h('section', { class: 'pf-grid4', 'aria-label': 'Workspace usage' },
      meter('Projects', usage.projects, limits.projects), meter('Keys', usage.keys, limits.keys),
      meter('Records', usage.records, limits.recordsPerProject * Math.max(1, usage.projects)), meter('Retained sources', usage.source_bytes, limits.tenantSourceBytes, fmtBytes)));
    add(main, h('section', { class: 'pf-card', 'aria-labelledby': 'pf-billing' }, h('h2', { id: 'pf-billing', text: `Billing month ${billing.month}` }),
      h('dl', { class: 'pf-dl' },
        h('dt', { text: 'API requests' }), h('dd', { text: (billing.api_requests || 0).toLocaleString() }),
        h('dt', { text: 'Processing jobs started' }), h('dd', { text: (billing.processing_jobs_started || 0).toLocaleString() }),
        h('dt', { text: 'Uploaded for processing' }), h('dd', { text: fmtBytes(billing.processing_upload_bytes || 0) }),
        h('dt', { text: 'Results downloaded' }), h('dd', { text: fmtBytes(billing.processing_artifact_bytes || 0) })),
      h('p', { class: 'pf-fine', text: `Rate limit: ${limits.requestsPerHour.toLocaleString()} requests an hour per workspace.` })));
  } catch (error) { add(main, explain(error)); }
}

// ---------------------------------------------------------------- processing

export async function renderProcessing(main) {
  add(main, viewHead('Processing', 'Engines your key can run.', 'Phone scans to metric scenes, maps and checks. Upload, run and download through the same key.'));
  if (!state.mode) { needConnection(main, 'processing engines'); return; }
  if (state.mode === 'sandbox') {
    add(main, h('div', { class: 'pf-empty' }, h('h2', { text: 'The sandbox does not run processing' }),
      h('p', { text: 'Reconstruction runs on real machines. Connect a project key with processing access to see your engines here.' }),
      codeTabs(snippets({ method: 'GET', path: '/processing/capabilities', op: { id: 'getProcessingCapabilities' }, origin: origin() }), 'Processing capabilities')));
    return;
  }
  try {
    const capabilities = await api().processingRequest('/capabilities');
    const engines = Array.isArray(capabilities.engines) ? capabilities.engines : [];
    add(main, h('section', { class: 'pf-grid3', 'aria-label': 'Engines' }, engines.length ? engines.map(engine => h('article', { class: 'pf-card' },
      h('div', { class: 'pf-change-head' }, h('h3', { text: engine.label || engine.id }), h('span', { class: `pf-chip ${engine.available ? 'pf-chip-confirmed' : ''}`, text: engine.available ? 'Available' : 'Not available' })),
      h('p', { class: 'pf-mono pf-faint', text: engine.id }),
      engine.input_kinds ? h('p', { class: 'pf-muted', text: `Takes: ${engine.input_kinds.join(', ')}${engine.max_inputs ? ` (up to ${engine.max_inputs})` : ''}` }) : null))
      : h('p', { class: 'pf-muted', text: 'No engines are granted to this workspace yet.' })));
  } catch (error) { add(main, explain(error)); }
}

// ---------------------------------------------------------------- docs

export function renderDocs(main) {
  add(main, viewHead('Docs', 'Everything in one place.', 'The words, the reference and the code.'));
  const glossary = [
    ['Project', 'One site: a building, floor or aisle.'], ['Source', 'An exact file you keep as proof: a scan record, a report, a photo (up to 512 KiB inline; larger through resumable uploads).'],
    ['Revision', 'A snapshot of the site and the robot\'s task. The as-is revision is how it is now; a proposed revision is a plan built on it.'],
    ['Evidence', 'A claim tied to a source and a revision: measured (with a number and unit), observed or inferred. It starts unchecked.'],
    ['Change', 'A request to move from the as-is revision to a proposed one, with the evidence behind it. A different person must approve it.'],
    ['Trial', 'What happened when a robot actually ran (physical) or was simulated. Only a passing physical trial verifies a change.'],
    ['Idempotency-Key', 'A unique value on every change request, so a retry after a dropped connection never does the work twice.'],
    ['expected_version', 'The project version you last saw. If someone changed the project since, the API refuses instead of overwriting.'],
  ];
  add(main, h('section', { class: 'pf-card', 'aria-labelledby': 'pf-words' }, h('h2', { id: 'pf-words', text: 'The eight words' }),
    h('dl', { class: 'pf-glossary' }, glossary.flatMap(([term, meaning]) => [h('dt', { text: term }), h('dd', { text: meaning })]))));
  add(main, h('section', { class: 'pf-card', 'aria-labelledby': 'pf-first' }, h('h2', { id: 'pf-first', text: 'Your first project in code' }),
    codeTabs(snippets({ method: 'POST', path: '/projects', body: { title: 'Warehouse aisle 4' }, op: { id: 'createProject' }, origin: origin() }), 'Create a project')));
  const links = [
    ['OpenAPI 3.1 reference', '/world/projects-api.openapi.json', 'Every endpoint, schema and error.'],
    ['JavaScript SDK', '/world/projects-client.mjs', 'One file, no dependencies. Browser and Node 22+.'],
    ['Developer guide', '/world/api.html', 'Processing, uploads, maps and the site-to-sim pilot.'],
    ['Project workspace', '/world/projects.html', 'The full editor for sources, revisions and trials.'],
    ['World Builder', '/world/', 'Make and check a site scene in the browser.'],
    ['BrainSNN Walk', '/walk/', 'Capture a site with your phone.'],
  ];
  add(main, h('section', { class: 'pf-grid3', 'aria-label': 'Reference' }, links.map(([title, href, text]) =>
    h('a', { class: 'pf-card pf-feature', href }, h('h3', { text: title }), h('p', { text }), h('span', { class: 'pf-arrow', text: 'Open' })))));
}

export { createIdempotencyKey, refreshMe };
