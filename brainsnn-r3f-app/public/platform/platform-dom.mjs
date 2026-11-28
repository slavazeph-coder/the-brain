// Small DOM helpers for the developer platform. Everything from the API is rendered as text nodes, never as markup.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'selected') el[key] = !!value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export const clear = el => { while (el.firstChild) el.firstChild.remove(); return el; };
/** Element.append, minus empty slots: the DOM would print null as text. */
export const add = (el, ...children) => { el.append(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false)); return el; };

/** Pretty JSON with token colours, built from text nodes. */
export function jsonView(value, label = 'Response body') {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const pre = h('pre', { class: 'pf-json', tabindex: '0', 'aria-label': label });
  const token = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  for (const match of text.matchAll(token)) {
    if (match.index > last) pre.append(text.slice(last, match.index));
    const [whole, str, colon, literal, number] = match;
    if (str) { pre.append(h('span', { class: colon ? 'pf-j-key' : 'pf-j-str', text: str })); if (colon) pre.append(colon); }
    else if (literal) pre.append(h('span', { class: 'pf-j-lit', text: literal }));
    else if (number) pre.append(h('span', { class: 'pf-j-num', text: number }));
    else pre.append(whole);
    last = match.index + whole.length;
  }
  pre.append(text.slice(last));
  return pre;
}

let toastTimer;
export function toast(message, tone = 'info') {
  const el = document.getElementById('pf-toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

export async function copy(text, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(`${what} to the clipboard.`, 'ok'); }
  catch { toast('Copy did not work here. Select the text and copy it.', 'warn'); }
}

/** A code block with tabs (curl / JavaScript / Python) and a copy button. */
export function codeTabs(snippetSet, name = 'code') {
  const langs = [['javascript', 'JavaScript'], ['curl', 'curl'], ['python', 'Python']].filter(([k]) => snippetSet[k]);
  let current = langs[0][0];
  const pre = h('pre', { class: 'pf-code', tabindex: '0' });
  const show = lang => {
    current = lang; pre.textContent = snippetSet[lang];
    pre.setAttribute('aria-label', `${langs.find(([k]) => k === lang)[1]} example`);
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.lang === lang));
  };
  const tabs = h('div', { class: 'pf-code-tabs', role: 'tablist', 'aria-label': `${name} language` },
    langs.map(([lang, label]) => h('button', { type: 'button', role: 'tab', dataset: { lang }, onclick: () => show(lang), text: label })));
  const wrap = h('div', { class: 'pf-codebox' }, h('div', { class: 'pf-code-head' }, tabs,
    h('button', { type: 'button', class: 'pf-ghost pf-small', onclick: () => copy(snippetSet[current], 'Code copied'), text: 'Copy' })), pre);
  show(current);
  return wrap;
}

// What to do about the errors people actually hit, in plain words.
const ADVICE = {
  'api-key-required': 'Connect first: use the sandbox, or paste your project key.',
  missing_api_key: 'Connect first: use the sandbox, or paste your project key.',
  'invalid-api-key': 'This key is wrong, expired or revoked. Ask your workspace admin for a new one.',
  forbidden: 'Your key\'s role cannot do this. In the sandbox, act as someone else (top of the page).',
  'stale-version': 'Someone changed the project since you loaded it. Reload it, then try again with the new version.',
  'idempotency-key-required': 'Every change needs an Idempotency-Key header: any 16–128 letters, numbers, - _ or :.',
  'idempotency-conflict': 'That Idempotency-Key was already used for a different request. Use a new key for a new request.',
  'evidence-unreviewed': 'Confirm every evidence item on this change first, then approve it.',
  'independent-review-required': 'The person who proposed a change cannot approve it. Act as a different reviewer.',
  'invalid-transition': 'That decision is not available at this step. Approve, then mark implemented, then verify.',
  'revision-conflict': 'Use the current as-is revision as the base, and a proposed revision made from it.',
  'stale-change': 'The site baseline changed since this change was proposed. Propose it again against the current baseline.',
  'physical-trial-required': 'Verification needs a passing physical trial, with confirmed measurements, on the proposed revision.',
  'invalid-input': 'Check the request body: the message says which field.',
  'not-found': 'That ID does not exist in this workspace.',
  'sandbox-not-simulated': 'The sandbox does not run this. Connect a project key to call it for real.',
  'json-required': 'Send the body as JSON with Content-Type: application/json.',
};

export function explain(error) {
  const code = error?.code || error?.error?.code;
  const message = error?.message || error?.error?.message || 'The request failed.';
  const requestId = error?.requestId || error?.error?.request_id;
  return h('div', { class: 'pf-error', role: 'alert' },
    h('strong', { text: message }),
    ADVICE[code] ? h('p', { text: ADVICE[code] }) : null,
    h('p', { class: 'pf-mono pf-faint' }, code ? `code ${code}` : '', requestId ? ` · request ${requestId}` : ''));
}

export const fmtBytes = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`;
export const fmtWhen = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'; };
