// BrainSNN developer platform: one page for the World Projects API. Sandbox (in the browser) or a real project key
// (kept in this tab's memory only). Views: home, API explorer, projects with the client review view, keys, usage,
// processing, docs.
import { createProjectsClient, createIdempotencyKey } from '../world/projects-client.mjs';
import { createSandboxApi } from './platform-sandbox.mjs';
import { snippets } from './platform-snippets.mjs';
import * as planner from './platform-planner.mjs';
import { h, clear, add, toast, codeTabs, explain } from './platform-dom.mjs';
import { renderExplorer } from './platform-explorer.mjs';
import { renderProjects, renderKeys, renderUsage, renderProcessing, renderDocs, seedSampleSite } from './platform-workspace.mjs';

const BASE = '/api/world/v1';
export const ROLE_LABELS = { admin: 'Admin', editor: 'Site operator', reviewer: 'Client reviewer', reader: 'Viewer' };
const STEPS = [
  ['connect', 'Connect', 'Start the sandbox, or use your project key.'],
  ['request', 'Send a request', 'Ask the API who you are.'],
  ['project', 'Create a project', 'One site, one record.'],
  ['evidence', 'Record evidence', 'A claim tied to a source.'],
  ['approve', 'Approve a change', 'As a different person than the one who proposed it.'],
];

export const state = {
  mode: null, key: '', sandbox: null, role: 'admin', me: null, context: {}, progress: new Set(), openapi: null, connecting: false,
};

export function currentKey() { return state.mode === 'sandbox' ? state.sandbox.principals[state.role] : state.key; }
export function fetchImpl() { return state.mode === 'sandbox' ? state.sandbox.fetch : globalThis.fetch.bind(globalThis); }
export function api() { return createProjectsClient({ apiKey: currentKey(), baseUrl: BASE, fetchImpl: fetchImpl() }); }
export function can(scope) { return !!state.me?.scopes?.includes(scope); }
export function origin() { return state.mode === 'live' ? location.origin : 'https://www.brainsnn.com'; }

/** One raw HTTP request, for the explorer: status, headers and body exactly as returned. */
export async function rawSend({ method, path, body = null, isPublic = false, idempotencyKey = null }) {
  const headers = {};
  if (!isPublic && currentKey()) headers.Authorization = `Bearer ${currentKey()}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const started = performance.now();
  const response = await fetchImpl()(BASE + path, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: response.status, ok: response.ok, ms: Math.round(performance.now() - started), body: parsed,
    requestId: response.headers.get('x-request-id'), replayed: response.headers.get('idempotency-replayed') === 'true' };
}

export function done(step) {
  if (state.progress.has(step)) return;
  state.progress.add(step);
  const label = STEPS.find(([id]) => id === step)?.[1];
  if (label) toast(`Done: ${label}. ${state.progress.size} of ${STEPS.length}.`, 'ok');
  renderStatus();
}

// ---------------------------------------------------------------- connection

export async function startSandbox() {
  state.sandbox = createSandboxApi();
  state.mode = 'sandbox'; state.key = ''; state.role = 'admin'; state.context = {};
  await refreshMe();
  done('connect');
  closeConnect();
  route();
}

async function connectKey(key) {
  const trimmed = key.trim();
  if (!/^bsk_[A-Za-z0-9_-]{43}$/.test(trimmed)) { toast('That does not look like a project key (bsk_ and 43 characters).', 'warn'); return false; }
  state.mode = 'live'; state.key = trimmed; state.sandbox = null; state.context = {};
  try { await refreshMe(true); }
  catch (error) { state.mode = null; state.key = ''; state.me = null; renderStatus(); showConnectError(error); return false; }
  done('connect');
  closeConnect();
  route();
  return true;
}

export function disconnect() {
  state.mode = null; state.key = ''; state.sandbox = null; state.me = null; state.context = {};
  renderStatus(); route();
  toast('Disconnected. Nothing was stored in this browser.', 'info');
}

export async function refreshMe(raise = false) {
  try { state.me = await api().me(); }
  catch (error) { state.me = null; if (raise) throw error; }
  renderStatus();
}

export async function actAs(role) {
  if (state.mode !== 'sandbox') return;
  state.role = role;
  await refreshMe();
  toast(`Now acting as ${state.me?.actor?.name || ROLE_LABELS[role]}.`, 'info');
  route();
}

function showConnectError(error) {
  const slot = document.getElementById('pf-connect-error');
  if (slot) add(clear(slot), explain(error));
}

function openConnect(tab = 'sandbox') {
  const dialog = document.getElementById('pf-connect');
  clear(document.getElementById('pf-connect-error'));
  selectConnectTab(tab);
  if (!dialog.open) dialog.showModal();
}
function closeConnect() { const d = document.getElementById('pf-connect'); if (d?.open) d.close(); }
function selectConnectTab(tab) {
  for (const b of document.querySelectorAll('[data-connect-tab]')) b.setAttribute('aria-selected', String(b.dataset.connectTab === tab));
  for (const p of document.querySelectorAll('[data-connect-panel]')) p.hidden = p.dataset.connectPanel !== tab;
  if (tab === 'key') setTimeout(() => document.getElementById('pf-key')?.focus(), 30);
}

// ---------------------------------------------------------------- shell

function renderStatus() {
  const pill = document.getElementById('pf-mode');
  const who = document.getElementById('pf-who');
  const roleBox = document.getElementById('pf-role');
  const connectButton = document.getElementById('pf-connect-open');
  const disconnectButton = document.getElementById('pf-disconnect');
  if (!pill) return;
  pill.dataset.mode = state.mode || 'none';
  pill.textContent = state.mode === 'sandbox' ? 'Sandbox' : state.mode === 'live' ? 'Live key' : 'Not connected';
  who.textContent = state.me ? `${state.me.actor.name} · ${state.me.tenant.name}` : '';
  roleBox.hidden = state.mode !== 'sandbox';
  if (state.mode === 'sandbox') for (const b of roleBox.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.role === state.role));
  connectButton.hidden = !!state.mode;
  disconnectButton.hidden = !state.mode;
  const count = document.getElementById('pf-progress-count');
  if (count) count.textContent = `${state.progress.size}/${STEPS.length}`;
}

const VIEWS = [
  ['', 'Home'], ['explorer', 'API explorer'], ['projects', 'Projects'], ['keys', 'Keys'], ['usage', 'Usage'], ['processing', 'Processing'], ['docs', 'Docs'],
];

function renderNav(active) {
  for (const a of document.querySelectorAll('[data-view-link]')) {
    if (a.dataset.viewLink === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

export function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

let stopToy = null, routeToken = 0;
export async function route() {
  // Each render builds off-screen and is shown only if no newer render started meanwhile (switching person re-renders).
  const token = ++routeToken;
  const [view = '', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const main = document.getElementById('pf-main');
  const known = VIEWS.some(([id]) => id === view) ? view : '';
  const page = h('div', { class: 'pf-view' });
  try {
    if (known === '') renderHome(page);
    else if (known === 'explorer') await renderExplorer(page, decodeURIComponent(rest[0] || ''));
    else if (known === 'projects') await renderProjects(page, rest[0] ? decodeURIComponent(rest[0]) : null);
    else if (known === 'keys') await renderKeys(page);
    else if (known === 'usage') await renderUsage(page);
    else if (known === 'processing') await renderProcessing(page);
    else if (known === 'docs') renderDocs(page);
  } catch (error) {
    add(page, explain(error));
  }
  if (token !== routeToken) return;
  if (stopToy) { stopToy(); stopToy = null; }
  renderNav(known);
  document.title = `${VIEWS.find(([id]) => id === known)[1]} · BrainSNN Platform`;
  add(clear(main), page);
  if (known === '') stopToy = startToy();
  if (document.activeElement === document.body || !main.contains(document.activeElement)) main.focus({ preventScroll: true });
}

export function needConnection(main, what) {
  add(main, h('section', { class: 'pf-empty' },
    h('h2', { text: `Connect to see ${what}` }),
    h('p', { text: 'Try everything in the sandbox: it runs in your browser and saves nothing. Or connect your project key.' }),
    h('div', { class: 'pf-actions' },
      h('button', { type: 'button', class: 'pf-primary', onclick: startSandbox, text: 'Start the sandbox' }),
      h('button', { type: 'button', class: 'pf-secondary', onclick: () => openConnect('key'), text: 'Use my key' }))));
}

// ---------------------------------------------------------------- home

function renderHome(main) {
  const hero = h('section', { class: 'pf-hero' },
    h('div', { class: 'pf-hero-copy' },
      h('p', { class: 'pf-eyebrow', text: 'BrainSNN Platform · API v1' }),
      h('h1', {}, 'Build with ', h('span', { text: 'spatial intelligence.' })),
      h('p', { class: 'pf-lead', text: 'Sites, evidence, changes and reviews for the places your robots work, from your own code. Try every call in the sandbox, then switch to your key.' }),
      h('div', { class: 'pf-actions' },
        state.mode ? h('a', { class: 'pf-primary', href: '#/explorer', text: 'Open the API explorer' })
          : h('button', { type: 'button', class: 'pf-primary', onclick: startSandbox, text: 'Start in the sandbox' }),
        state.mode ? h('a', { class: 'pf-secondary', href: '#/projects', text: 'See projects' })
          : h('button', { type: 'button', class: 'pf-secondary', onclick: () => openConnect('key'), text: 'Use my key' })),
      h('p', { class: 'pf-fine', text: 'No sign-up. The sandbox lives in this tab and saves nothing. A key is kept in memory only.' })),
    toyCard());
  const checklist = h('section', { class: 'pf-card pf-checklist', 'aria-labelledby': 'pf-first-five' },
    h('div', { class: 'pf-card-head' }, h('h2', { id: 'pf-first-five', text: 'Your first five minutes' }),
      h('span', { class: 'pf-mono pf-faint', text: `${state.progress.size} of ${STEPS.length} done` })),
    h('ol', {}, STEPS.map(([id, title, hint], index) => h('li', { class: state.progress.has(id) ? 'is-done' : '' },
      h('span', { class: 'pf-step-dot', 'aria-hidden': 'true', text: state.progress.has(id) ? '✓' : String(index + 1) }),
      h('div', {}, h('strong', { text: title }), h('span', { text: hint })),
      h('span', { class: 'pf-visually-hidden', text: state.progress.has(id) ? 'done' : 'not done yet' }),
      stepAction(id)))),
    state.mode === 'sandbox' ? h('p', { class: 'pf-fine' }, 'In a hurry? ',
      h('button', { type: 'button', class: 'pf-link', onclick: async () => { const id = await seedSampleSite(); go(id ? `#/projects/${id}` : '#/projects'); }, text: 'Fill the sandbox with a sample site' }),
      ' and approve its change as the client reviewer.') : null);
  const cards = h('section', { class: 'pf-grid3', 'aria-label': 'What is here' },
    featureCard('API explorer', 'Every endpoint, live, with the request prefilled from what you just made. Copy it as curl, JavaScript or Python.', '#/explorer', 'Explore the API'),
    featureCard('Client review', 'A plain-language page for the people who approve changes: what changed, the evidence, and two buttons.', '#/projects', 'Open projects'),
    featureCard('Keys and usage', 'Issue a key per person and role, revoke it in one click, and see this month\'s usage against your limits.', '#/keys', 'Manage keys'));
  const quick = h('section', { class: 'pf-card', 'aria-labelledby': 'pf-quick' },
    h('h2', { id: 'pf-quick', text: 'Your first call' }),
    h('p', { class: 'pf-muted', text: 'Set BRAINSNN_API_KEY in your environment. In Node, save the two SDK files beside your script first (the curl line in the JavaScript tab). The SDK adds idempotency keys and checks every response.' }),
    codeTabs(snippets({ method: 'GET', path: '/projects', op: { id: 'listProjects' }, origin: origin() }), 'Quickstart'));
  add(main, hero, checklist, cards, quick);
}

function stepAction(id) {
  const button = (text, onclick) => h('button', { type: 'button', class: 'pf-ghost pf-small', onclick, text });
  if (id === 'connect') return state.mode ? null : button('Start', startSandbox);
  if (id === 'request') return button('Try it', () => go('#/explorer/getMe'));
  if (id === 'project') return button('Try it', () => go('#/explorer/createProject'));
  if (id === 'evidence') return button('Try it', () => go(state.context.as_is_revision_id ? '#/explorer/addEvidence' : '#/explorer/addSource'));
  if (id === 'approve') return button('Try it', () => go('#/projects'));
  return null;
}

function featureCard(title, text, href, action) {
  return h('article', { class: 'pf-card pf-feature' }, h('h3', { text: title }), h('p', { text }), h('a', { class: 'pf-arrow', href, text: action }));
}

// ---------------------------------------------------------------- the planner toy

const TOY = { width: 48, height: 30, start: [5, 15], goal: [42, 15], metresPerCell: 0.1,
  robots: [{ id: 'a', name: 'Robot A', note: '0.45 m', radius: 2.2, colour: '--pf-robot-a' }, { id: 'b', name: 'Robot B', note: '0.8 m cart', radius: 4.2, colour: '--pf-robot-b' }] };

function toyCard() {
  return h('figure', { class: 'pf-toy', 'aria-labelledby': 'pf-toy-caption' },
    h('div', { class: 'pf-toy-head' }, h('span', { class: 'pf-eyebrow', text: 'Adapt · try it' }),
      h('span', { class: 'pf-toy-hint', text: 'Click the floor to drop a box' })),
    h('canvas', { id: 'pf-toy-canvas', width: '640', height: '400', role: 'img', 'aria-label': 'A warehouse aisle. Two robots plan routes from left to right.' }),
    h('figcaption', { id: 'pf-toy-caption' },
      h('div', { class: 'pf-toy-results', id: 'pf-toy-results', 'aria-live': 'polite' }),
      h('div', { class: 'pf-toy-buttons' },
        h('button', { type: 'button', class: 'pf-ghost pf-small', id: 'pf-toy-crate', text: 'Drop a crate in the aisle' }),
        h('button', { type: 'button', class: 'pf-ghost pf-small', id: 'pf-toy-undo', text: 'Undo' }),
        h('button', { type: 'button', class: 'pf-ghost pf-small', id: 'pf-toy-clear', text: 'Clear' })),
      h('p', { class: 'pf-fine', text: 'A browser toy of the planning rules the engine uses on recorded walks: each robot keeps its own clearance.' })));
}

function startToy() {
  const canvas = document.getElementById('pf-toy-canvas');
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  const shelves = planner.grid(TOY.width, TOY.height);
  planner.setBox(shelves, 10, 1, 28, 6); planner.setBox(shelves, 10, 23, 28, 6);  // two shelf rows make an aisle
  const boxes = [];
  let plans = [], frame = 0, raf = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = name => getComputedStyle(document.body).getPropertyValue(name).trim();
  const recompute = () => {
    const after = { ...shelves, cells: shelves.cells.slice() };
    for (const b of boxes) planner.setBox(after, b[0], b[1], 4, 4);
    plans = TOY.robots.map(r => ({ robot: r, ...planner.plan(shelves, after, r.radius, TOY.start, TOY.goal) }));
    const results = document.getElementById('pf-toy-results');
    clear(results);
    for (const p of plans) {
      const extra = p.before && p.after ? (planner.length(p.after) - planner.length(p.before)) * TOY.metresPerCell : 0;
      add(results, h('span', { class: `pf-chip pf-chip-${p.outcome}` },
        h('i', { class: `pf-swatch pf-swatch-${p.robot.id}`, 'aria-hidden': 'true' }),
        `${p.robot.name} (${p.robot.note}): ${p.outcome}${p.outcome === 'rerouted' || p.outcome === 'shortened' ? ` ${extra >= 0 ? '+' : ''}${extra.toFixed(Math.abs(extra) < 0.1 ? 2 : 1)} m` : ''}`));
    }
    canvas.setAttribute('aria-label', `Warehouse aisle with ${boxes.length} dropped box${boxes.length === 1 ? '' : 'es'}. ${plans.map(p => `${p.robot.name}: ${p.outcome}`).join('. ')}.`);
    frame = 0;
  };
  const draw = () => {
    const cw = canvas.width / TOY.width, ch = canvas.height / TOY.height;
    ctx.fillStyle = css('--pf-toy-floor'); ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = css('--pf-toy-grid'); ctx.lineWidth = 1;
    for (let i = 0; i <= TOY.width; i += 2) { ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, canvas.height); ctx.stroke(); }
    for (let j = 0; j <= TOY.height; j += 2) { ctx.beginPath(); ctx.moveTo(0, j * ch); ctx.lineTo(canvas.width, j * ch); ctx.stroke(); }
    for (let j = 0; j < TOY.height; j++) for (let i = 0; i < TOY.width; i++) {
      if (shelves.cells[j * TOY.width + i]) { ctx.fillStyle = css('--pf-toy-shelf'); ctx.fillRect(i * cw, j * ch, cw + .5, ch + .5); }
    }
    ctx.fillStyle = css('--pf-toy-box');
    for (const [x, y] of boxes) { ctx.fillRect(x * cw, y * ch, 4 * cw, 4 * ch); }
    const point = ([x, y]) => [(x + .5) * cw, (y + .5) * ch];
    for (const p of plans) {
      const colour = css(p.robot.colour);
      if (p.before && p.outcome !== 'unchanged') { ctx.setLineDash([5, 5]); ctx.globalAlpha = .45; line(p.before, colour); ctx.globalAlpha = 1; ctx.setLineDash([]); }
      if (p.after) line(p.after, colour, 3);
    }
    function line(path, colour, width = 2) {
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath();
      path.forEach((c, k) => { const [x, y] = point(c); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
    }
    // Robots travel their adapted routes; a blocked robot waits at the start. The bigger footprint is drawn first.
    for (const p of [...plans].sort((x, y) => y.robot.radius - x.robot.radius)) {
      const path = p.after || [TOY.start];
      const total = planner.length(path), at = reduce ? total : (frame * 0.18) % (total + 12);
      const [x, y] = point(along(path, Math.min(at, total)));
      ctx.fillStyle = css(p.robot.colour);
      ctx.beginPath(); ctx.arc(x, y, p.robot.radius * cw * .55, 0, Math.PI * 2); ctx.fill();
      // Blocked robots wait at the start; their labels go under the disc, clear of the "Start" label above it.
      if (!p.after) { ctx.fillStyle = css('--pf-toy-text'); ctx.font = '600 12px system-ui, sans-serif'; ctx.fillText(`${p.robot.name}: blocked`, x - 24, y + p.robot.radius * cw * .55 + 16 + (p.robot.id === 'b' ? 16 : 0)); }
    }
    ctx.fillStyle = css('--pf-toy-text'); ctx.font = '600 12px system-ui, sans-serif';
    const [gx, gy] = point(TOY.goal); ctx.fillText('Goal', gx - 12, gy - 24);
    const [sx, sy] = point(TOY.start); ctx.fillText('Start', sx - 14, sy - 24);
    frame += 1;
    if (!reduce) raf = requestAnimationFrame(draw);
  };
  const along = (path, distance) => {
    let left = distance;
    for (let k = 1; k < path.length; k++) {
      const seg = Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
      if (left <= seg) { const t = seg ? left / seg : 0; return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * t, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * t]; }
      left -= seg;
    }
    return path[path.length - 1];
  };
  const drop = (x, y) => {
    const i = Math.max(1, Math.min(TOY.width - 5, x - 2)), j = Math.max(1, Math.min(TOY.height - 5, y - 2));
    const hit = boxes.findIndex(([bx, by]) => x >= bx && x < bx + 4 && y >= by && y < by + 4);
    if (hit >= 0) boxes.splice(hit, 1); else boxes.push([i, j]);
    recompute(); if (reduce) draw();
  };
  canvas.addEventListener('click', event => {
    const rect = canvas.getBoundingClientRect();
    drop(Math.floor((event.clientX - rect.left) / rect.width * TOY.width), Math.floor((event.clientY - rect.top) / rect.height * TOY.height));
  });
  document.getElementById('pf-toy-crate').addEventListener('click', () => drop(22 + (boxes.length % 3) * 5, 13 + (boxes.length % 2) * 3));
  document.getElementById('pf-toy-undo').addEventListener('click', () => { boxes.pop(); recompute(); if (reduce) draw(); });
  document.getElementById('pf-toy-clear').addEventListener('click', () => { boxes.length = 0; recompute(); if (reduce) draw(); });
  recompute(); draw();
  return () => cancelAnimationFrame(raf);
}

// ---------------------------------------------------------------- boot

function boot() {
  document.getElementById('pf-connect-open').addEventListener('click', () => openConnect('sandbox'));
  document.getElementById('pf-disconnect').addEventListener('click', disconnect);
  document.getElementById('pf-connect-close').addEventListener('click', closeConnect);
  for (const b of document.querySelectorAll('[data-connect-tab]')) b.addEventListener('click', () => selectConnectTab(b.dataset.connectTab));
  document.getElementById('pf-sandbox-start').addEventListener('click', startSandbox);
  document.getElementById('pf-key-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.getElementById('pf-key');
    const value = input.value;
    input.value = '';  // the key lives in this page's memory only
    await connectKey(value);
  });
  for (const b of document.querySelectorAll('#pf-role button')) b.addEventListener('click', () => actAs(b.dataset.role));
  const theme = document.getElementById('pf-theme');
  const applyTheme = value => { if (value) document.documentElement.dataset.theme = value; else delete document.documentElement.dataset.theme; };
  try { applyTheme(localStorage.getItem('brainsnn-platform-theme')); } catch { /* storage may be unavailable */ }
  theme.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('brainsnn-platform-theme', next); } catch { /* fine */ }
    route();
  });
  addEventListener('hashchange', route);
  fetch('/world/projects-api.openapi.json').then(r => r.json()).then(doc => { state.openapi = doc; }).catch(() => {});
  api().status().then(status => {
    const el = document.getElementById('pf-service');
    if (el) { el.textContent = status.available ? 'API online' : 'API storage unavailable'; el.dataset.ok = String(!!status.available); }
  }).catch(() => { const el = document.getElementById('pf-service'); if (el) { el.textContent = 'API not reachable'; el.dataset.ok = 'false'; } });
  renderStatus();
  route();
}

export { openConnect, createIdempotencyKey, STEPS };
boot();
