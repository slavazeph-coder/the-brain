// The API explorer: every documented operation, sent for real (sandbox or your key), with the body prefilled from
// what this session already created, the raw response, and the same request as curl / JavaScript / Python.
import { state, rawSend, done, origin, go, needConnection, ROLE_LABELS, createIdempotencyKey } from './platform.mjs';
import { operations, GROUPS, exampleBody, fillPath, pathDefaults, learn } from './platform-catalog.mjs';
import { snippets } from './platform-snippets.mjs';
import { h, clear, add, jsonView, codeTabs, explain, toast } from './platform-dom.mjs';

const GUIDE = ['getMe', 'createProject', 'addSource', 'createRevision', 'addEvidence', 'createChange', 'reviewEvidence', 'decideChange'];

async function catalogue() {
  if (!state.openapi) state.openapi = await (await fetch('/world/projects-api.openapi.json')).json();
  return operations(state.openapi);
}

export async function renderExplorer(main, selectedId) {
  const ops = await catalogue();
  const op = ops.find(o => o.id === selectedId) || ops.find(o => o.id === 'getMe');
  add(main, h('header', { class: 'pf-view-head' },
    h('div', {}, h('p', { class: 'pf-eyebrow', text: 'API explorer' }), h('h1', { text: 'Every endpoint, live.' }),
      h('p', { class: 'pf-muted', text: 'Pick an operation, send it, read the answer. Bodies are prefilled from what you created a moment ago.' })),
    guideStrip(ops)));
  if (!state.mode) needConnection(main, 'live responses');
  const layout = h('div', { class: 'pf-explorer' });
  add(layout, sidebar(ops, op), await detail(op));
  add(main, layout);
}

function guideStrip(ops) {
  return h('ol', { class: 'pf-guide', 'aria-label': 'Suggested order' }, GUIDE.map((id, index) => {
    const op = ops.find(o => o.id === id);
    return h('li', {}, h('a', { href: `#/explorer/${id}`, 'aria-current': location.hash === `#/explorer/${id}` ? 'step' : null },
      h('span', { class: 'pf-mono', text: String(index + 1) }), op ? shortName(op) : id));
  }));
}

function shortName(op) {
  const names = { getMe: 'Who am I', createProject: 'New project', addSource: 'Add a source', createRevision: 'Record a revision', addEvidence: 'Add evidence',
    createChange: 'Propose a change', reviewEvidence: 'Confirm evidence', decideChange: 'Approve' };
  return names[op.id] || op.summary;
}

function sidebar(ops, selected) {
  const list = h('div', { class: 'pf-oplist' });
  const search = h('input', { type: 'search', class: 'pf-input', placeholder: 'Filter endpoints', 'aria-label': 'Filter endpoints' });
  const draw = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    for (const group of GROUPS) {
      const items = ops.filter(o => o.group === group.id && (!q || `${o.method} ${o.path} ${o.summary} ${o.id}`.toLowerCase().includes(q)));
      if (!items.length) continue;
      add(list, h('p', { class: 'pf-oplist-group', text: group.label }),
        h('ul', {}, items.map(o => h('li', {}, h('a', { href: `#/explorer/${encodeURIComponent(o.id)}`, class: 'pf-op', 'aria-current': o === selected ? 'page' : null },
          h('span', { class: `pf-method pf-method-${o.method.toLowerCase()}`, text: o.method }), h('span', { class: 'pf-op-summary', text: o.summary }))))));
    }
    if (!list.firstChild) add(list, h('p', { class: 'pf-muted', text: 'No endpoint matches.' }));
  };
  search.addEventListener('input', draw);
  draw();
  return h('nav', { class: 'pf-explorer-side', 'aria-label': 'Endpoints' }, search, list);
}

async function detail(op) {
  const panel = h('section', { class: 'pf-explorer-main', 'aria-labelledby': 'pf-op-title' });
  const values = pathDefaults(state.context);
  const paramInputs = {};
  const params = op.pathParams.length ? h('div', { class: 'pf-params' }, op.pathParams.map(name => {
    const input = h('input', { class: 'pf-input pf-mono', id: `pf-param-${name}`, value: values[name] || '', placeholder: name, spellcheck: 'false', autocomplete: 'off' });
    paramInputs[name] = input;
    return h('label', { for: `pf-param-${name}` }, h('span', { class: 'pf-mono', text: `{${name}}` }), input);
  })) : null;
  const initial = exampleBody(state.openapi, op, state.context);
  const editor = initial === null ? null : h('textarea', { class: 'pf-editor pf-mono', id: 'pf-body', rows: String(Math.min(18, JSON.stringify(initial, null, 2).split('\n').length + 1)),
    spellcheck: 'false', 'aria-label': 'Request body (JSON)', value: JSON.stringify(initial, null, 2) });
  const output = h('div', { class: 'pf-response', 'aria-live': 'polite' });
  const code = h('div', { class: 'pf-snippets' });
  let lastKey = null;

  const currentPath = () => fillPath(op.path, Object.fromEntries(Object.entries(paramInputs).map(([k, el]) => [k, el.value.trim()])));
  const currentBody = () => {
    if (!editor) return null;
    try { return JSON.parse(editor.value || 'null'); } catch { return undefined; }
  };
  const refreshCode = () => {
    const body = currentBody();
    add(clear(code), codeTabs(snippets({ method: op.method, path: currentPath(), body: body === undefined ? null : body, op, origin: origin() }), op.summary));
  };
  editor?.addEventListener('input', refreshCode);
  for (const input of Object.values(paramInputs)) input.addEventListener('input', refreshCode);

  const send = async (reuseKey = false) => {
    if (!state.mode && !op.public) { toast('Connect first: start the sandbox or use your key.', 'warn'); return; }
    const path = currentPath();
    if (/\{[a-z_]+\}/.test(path)) { toast('Fill in the IDs in the path first.', 'warn'); return; }
    const body = currentBody();
    if (body === undefined) { toast('The body is not valid JSON.', 'warn'); return; }
    if (!reuseKey || !lastKey) lastKey = op.method === 'GET' || op.method === 'HEAD' ? null : `pf-${createIdempotencyKey()}`;
    sendButton.disabled = true;
    try {
      const result = await rawSend({ method: op.method, path, body, isPublic: op.public, idempotencyKey: lastKey });
      // Learn first: the result's "Next" suggestion reads what this response just created.
      if (result.ok) state.context = learn(state.context, op, result.body);
      showResult(result);
      if (result.ok) {
        done('request');
        if (op.id === 'createProject') done('project');
        if (op.id === 'addEvidence') done('evidence');
        if (op.id === 'decideChange' && result.body?.resource?.status === 'approved') done('approve');
      }
    } catch (error) {
      add(clear(output), explain({ message: `The request did not complete: ${error.message}` }));
    } finally { sendButton.disabled = false; }
  };
  const showResult = result => {
    add(clear(output), 
      h('div', { class: 'pf-response-head' },
        h('span', { class: `pf-status ${result.ok ? 'is-ok' : 'is-bad'}`, text: String(result.status) }),
        h('span', { class: 'pf-mono pf-faint', text: `${result.ms} ms` }),
        result.requestId ? h('span', { class: 'pf-mono pf-faint', text: result.requestId }) : null,
        result.replayed ? h('span', { class: 'pf-chip', text: 'Replayed: same key, same answer, nothing done twice' }) : null),
      result.ok ? null : explain({ ...(result.body?.error || {}), requestId: result.requestId }),
      jsonView(result.body),
      result.ok && lastKey ? h('p', { class: 'pf-fine' }, 'Networks fail. ',
        h('button', { type: 'button', class: 'pf-link', onclick: () => send(true), text: 'Send again with the same Idempotency-Key' }),
        ' to see the API answer the retry without doing it twice.') : null,
      nextStep(op, result));
  };
  const sendButton = h('button', { type: 'button', class: 'pf-primary', onclick: () => send(false), text: state.mode || op.public ? `Send ${op.method}` : 'Connect to send' });

  add(panel, 
    h('div', { class: 'pf-op-head' },
      h('span', { class: `pf-method pf-method-${op.method.toLowerCase()}`, text: op.method }),
      h('code', { class: 'pf-path', text: `/api/world/v1${op.path}` })),
    h('h2', { id: 'pf-op-title', text: op.summary }),
    op.description ? h('p', { class: 'pf-muted', text: op.description }) : null,
    h('div', { class: 'pf-chips' },
      op.public ? h('span', { class: 'pf-chip', text: 'Public: no key' }) : op.scopes.map(s => h('span', { class: `pf-chip ${state.me?.scopes?.includes(s) ? '' : 'is-missing'}`, title: state.me && !state.me.scopes.includes(s) ? `Your key does not have ${s}` : null, text: s })),
      op.idempotent ? h('span', { class: 'pf-chip', text: 'Idempotency-Key added for you' }) : null,
      state.mode === 'sandbox' ? h('span', { class: 'pf-chip', text: `Acting as ${ROLE_LABELS[state.role]}` }) : null),
    params,
    op.binaryBody ? h('p', { class: 'pf-note', text: 'This endpoint takes raw file bytes. Use the SDK\'s uploadSourceFile(), which hashes, splits and resumes the upload for you.' }) : null,
    editor ? h('div', { class: 'pf-editor-wrap' }, h('label', { for: 'pf-body', class: 'pf-label', text: 'Request body' }), editor,
      h('button', { type: 'button', class: 'pf-ghost pf-small', onclick: () => { editor.value = JSON.stringify(exampleBody(state.openapi, op, state.context), null, 2); refreshCode(); }, text: 'Refill from my session' })) : null,
    h('div', { class: 'pf-actions' }, sendButton),
    output,
    h('h3', { class: 'pf-label', text: 'The same request in code' }),
    code);
  refreshCode();
  return panel;
}

function nextStep(op, result) {
  if (!result.ok) return null;
  const next = { getMe: 'createProject', createProject: 'addSource', addSource: 'createRevision', createRevision: state.context.proposed_revision_id ? 'addEvidence' : 'createRevision',
    addEvidence: 'createChange', createChange: 'reviewEvidence', reviewEvidence: 'decideChange' }[op.id];
  if (!next) return null;
  const needsReviewer = ['reviewEvidence', 'decideChange'].includes(next) && state.mode === 'sandbox' && !['reviewer', 'admin'].includes(state.role);
  const label = { createProject: 'Create a project', addSource: 'Add a source to it', createRevision: state.context.as_is_revision_id ? 'Record the proposed revision' : 'Record the as-is revision',
    addEvidence: 'Add evidence', createChange: 'Propose the change', reviewEvidence: 'Confirm the evidence', decideChange: 'Approve the change' }[next];
  return h('div', { class: 'pf-next' }, h('span', { class: 'pf-eyebrow', text: 'Next' }),
    h('button', { type: 'button', class: 'pf-secondary', onclick: () => go(`#/explorer/${next}`), text: `${label} →` }),
    needsReviewer ? h('span', { class: 'pf-fine', text: ' Switch to Client reviewer at the top: whoever proposes a change cannot approve it.' }) : null,
    op.id === 'createChange' && state.mode === 'sandbox' && !needsReviewer ? h('span', { class: 'pf-fine', text: ' Approving needs a different person from the one who proposed: switch to Client reviewer at the top.' }) : null);
}
