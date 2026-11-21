/**
 * The World Builder studio: one bar that reaches every tool, and one workbench that opens the
 * separate tool pages inside the playground instead of in new tabs.
 *
 * The tool list is showcase-features.mjs, the same registry the showcase uses, so a tool added
 * there appears here too. In-page tools open through the showcase's own navigator (tabs, layers,
 * sections, Project Review, processing settings). Separate pages (/world/*.html and the Arena)
 * open in the workbench frame; the map, its edits and any running job stay where they are.
 */

const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

/** One literal picture per chapter. Each sits beside its visible name; none carries meaning alone. */
export const CHAPTER_ICONS = {
  robot: svg('<rect x="6" y="7" width="12" height="10" rx="3"/><path d="M12 7V4"/><circle cx="12" cy="3.2" r="1"/><circle cx="9.5" cy="11.5" r="1.1"/><circle cx="14.5" cy="11.5" r="1.1"/><path d="M8 20h8M9 17v3M15 17v3"/>'),
  capture: svg('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>'),
  scan: svg('<path d="M12 3 20 7.5v9L12 21 4 16.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'),
  building: svg('<path d="M4 20V9l6-4v15M10 20V5l10 4v11M3 20h18"/><path d="M13 11h4M13 14h4M13 17h4M6.5 12h1M6.5 15h1"/>'),
  motion: svg('<circle cx="14" cy="4.5" r="1.8"/><path d="m9 21 3-6 3 2v4M8 11l3-3h4l2 4 3 1M11 8l-1 5"/>'),
  share: svg('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>'),
};
/** Short, plain names for the bar. Each chapter's panel heading carries its full title. */
export const CHAPTER_SHORT = { robot: 'Robots', capture: 'Captures', scan: '3D scenes', building: 'Buildings', motion: 'Movement', share: 'Save & share' };

const SEARCH_ICON = svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>');
const WINDOW_ICON = svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>');
const HOME_ICON = svg('<path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z"/>');

/** Where a feature opens, in plain words: the workbench, the showroom, or the person's own world. */
export function featurePlace(target) {
  if (isWorkbenchPage(target)) return 'workbench';
  if (target === '#showroom') return 'showroom';
  return 'world';
}

/** Same-origin pages that the workbench may host. Everything else keeps its normal navigation. */
export function isWorkbenchPage(target) {
  return /^\/(?:world\/[a-z0-9-]+\.html|arena\/index\.html)(?:#[a-z0-9-]+)?$/u.test(String(target)) && !/^\/world\/index\.html/u.test(target);
}

/** A colour family for the access note, so "Has an example", "Needs setup" and "Preview" read at a glance. */
export function accessTone(access) {
  const text = String(access).toLowerCase();
  if (text.startsWith('preview')) return 'preview';
  if (/needs|planned/u.test(text)) return 'needs';
  if (/example|simulated/u.test(text)) return 'example';
  return 'ready';
}

const PLACE_WORDS = { workbench: 'Opens here, beside your world', showroom: 'Opens the showroom', world: 'Opens in your world' };

/** Lowercase words for search. Matches label, detail, access words and the chapter name. */
function searchable(chapter, feature) {
  return [feature.label, feature.detail, feature.access, chapter.label, chapter.title].join(' ').toLowerCase();
}

export function searchFeatures(chapters, query) {
  const words = String(query || '').toLowerCase().split(/\s+/u).filter(Boolean);
  const all = chapters.flatMap(chapter => chapter.features.map(feature => ({ chapter, feature })));
  if (!words.length) return all;
  return all.filter(({ chapter, feature }) => {
    const text = searchable(chapter, feature);
    return words.every(word => text.includes(word));
  });
}

/**
 * The page's site header: the first header or nav, before the page title, that links back to the
 * playground or the home page. Page-specific toolbars and section navigation are left alone.
 */
export function siteHeader(doc) {
  const first = doc.body?.querySelector('header, nav');
  if (!first) return null;
  const title = doc.querySelector('h1');
  if (title && (first.contains(title) || first.compareDocumentPosition(title) & 2 /* title precedes */)) return null;
  const home = [...first.querySelectorAll('a[href]')].some(link => {
    try {
      const url = new URL(link.getAttribute('href'), doc.location.href);
      return url.origin === doc.location.origin && ['/', '/world/', '/world/index.html'].includes(url.pathname);
    } catch { return false; }
  });
  return home ? first : null;
}

/**
 * The workbench hosts one separate tool page at a time in a same-origin frame.
 * Its own site header is hidden there (the studio bar already provides it), links back to the
 * playground close the workbench, and links that leave World Builder open in a new tab.
 */
export function createWorkbench({ root, onClose = () => {} }) {
  const frame = root.querySelector('#studio-workbench-frame');
  const title = root.querySelector('#studio-workbench-title');
  const chapterLabel = root.querySelector('#studio-workbench-chapter');
  const detail = root.querySelector('#studio-workbench-detail');
  const ownTab = root.querySelector('#studio-workbench-tab');
  const close = root.querySelector('#studio-workbench-close');
  const loading = root.querySelector('#studio-workbench-loading');
  let origin = null, current = null, settleUntil = 0, settleTimer = 0;
  // While a tool page loads, its own anchor navigation can scroll this page too. For a short time after
  // opening, keep the workbench header in view unless the person scrolls or types themselves.
  const settle = () => { if (Date.now() < settleUntil) requestAnimationFrame(() => root.scrollIntoView({ block: 'start', behavior: 'instant' })); };
  const stopSettling = () => { settleUntil = 0; };
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.addEventListener(type, stopSettling, { passive: true, capture: true });
  window.addEventListener('scroll', settle, { passive: true });

  function adopt() {
    let doc;
    try { doc = frame.contentDocument; } catch { return; }
    if (!doc?.body || doc.location.href === 'about:blank') return;
    loading.hidden = true;
    root.dataset.state = 'ready';
    if (settleUntil) { settleUntil = Date.now() + 1500; settle(); clearTimeout(settleTimer); settleTimer = setTimeout(stopSettling, 1600); }
    doc.documentElement.dataset.embedded = 'studio';
    // A World page's own site header repeats what the studio bar already offers. The Arena keeps its
    // header: it carries the Arena's own sections (Arcade, Pricing, Review, Evidence and more).
    const header = doc.location.pathname.startsWith('/world/') ? siteHeader(doc) : null;
    if (header) { header.hidden = true; header.dataset.studioHidden = 'site-header'; }
    if (!doc.getElementById('studio-embed-style')) {
      const style = doc.createElement('style');
      style.id = 'studio-embed-style';
      style.textContent = 'html{scroll-padding-top:12px}[data-studio-hidden]{display:none!important}';
      doc.head.append(style);
    }
    const pageTitle = doc.title.replace(/\s*[|·]\s*BrainSNN.*$/u, '').replace(/^BrainSNN\s*[|·]\s*/u, '').trim();
    if (pageTitle) frame.title = pageTitle + ' — inside World Builder';
    ownTab.href = doc.location.pathname + doc.location.hash;
    if (!doc.documentElement.dataset.studioLinks) {
      doc.documentElement.dataset.studioLinks = '1';
      // Input inside the tool page also means the person has taken over scrolling.
      for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) doc.defaultView?.addEventListener(type, stopSettling, { passive: true, capture: true });
      doc.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.('a[href]');
        if (!link) return;
        let url;
        try { url = new URL(link.getAttribute('href'), doc.location.href); } catch { return; }
        if (url.origin !== location.origin) { link.target = '_blank'; link.rel = 'noopener'; return; }
        if (url.pathname === '/world/' || url.pathname === '/world/index.html') {
          event.preventDefault();
          hide();
          if (url.hash && url.hash !== '#workspace') location.hash = url.hash;
          return;
        }
        if (!isWorkbenchPage(url.pathname) && !url.pathname.startsWith('/arena/')) { link.target = '_blank'; link.rel = 'noopener'; return; }
        // Another World Builder tool page: stay in the workbench.
        link.target = '_self';
      });
    }
  }

  frame.addEventListener('load', adopt);

  function show(feature, chapter, from) {
    origin = from || document.activeElement;
    current = feature.target;
    root.hidden = false;
    root.dataset.state = 'loading';
    loading.hidden = false;
    chapterLabel.textContent = chapter.label;
    title.textContent = feature.label;
    detail.textContent = feature.detail;
    ownTab.href = feature.target;
    frame.title = feature.label + ' — inside World Builder';
    const next = new URL(feature.target, location.href);
    let same = false;
    try { same = frame.contentWindow?.location.pathname === next.pathname; } catch { /* not loaded */ }
    if (same) {
      frame.contentWindow.location.hash = next.hash;
      adopt();
    } else {
      frame.src = next.pathname + (location.search.includes('nosw=1') ? '?nosw=1' : '') + next.hash;
    }
    document.documentElement.dataset.workbench = 'open';
    root.scrollIntoView({ block: 'start', behavior: 'instant' });
    settleUntil = Date.now() + 8000;
    title.focus({ preventScroll: true });
  }

  function hide({ restoreFocus = true } = {}) {
    if (root.hidden) return;
    stopSettling();
    root.hidden = true;
    current = null;
    delete document.documentElement.dataset.workbench;
    // Unload the page so its media, workers and animation loops stop with it.
    frame.removeAttribute('src');
    frame.src = 'about:blank';
    onClose();
    if (restoreFocus && origin?.isConnected) {
      origin.focus({ preventScroll: true });
      origin.scrollIntoView({ block: 'center', behavior: 'instant' });
    } else {
      const workspace = document.getElementById('workspace');
      workspace?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }

  close.addEventListener('click', () => hide());
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target === title) hide();
  });

  return { show, hide, get isOpen() { return !root.hidden; }, get current() { return current; } };
}

/**
 * The studio bar: Your world, six chapters and Find a tool. A chapter opens a panel of its tools;
 * Find a tool searches all of them. Choosing one opens it in place and closes the panel.
 */
export function mountStudioBar({ root, chapters, openFeature, onHome = () => {} }) {
  const chapterRow = root.querySelector('#studio-chapters');
  const panel = root.querySelector('#studio-panel');
  const searchButton = root.querySelector('#studio-search-open');
  const home = root.querySelector('#studio-home');
  const worldName = root.querySelector('#studio-world-name');
  const buttons = new Map();
  let openId = null, query = '';

  searchButton.insertAdjacentHTML('afterbegin', SEARCH_ICON);
  home.insertAdjacentHTML('afterbegin', `<span class="studio-home-icon">${HOME_ICON}</span>`);

  for (const chapter of chapters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'studio-chapter-' + chapter.id;
    button.className = 'studio-chapter';
    button.dataset.studioChapter = chapter.id;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', panel.id);
    button.innerHTML = `<span class="studio-chapter-icon">${CHAPTER_ICONS[chapter.id] || ''}</span><span class="studio-chapter-name"></span><span class="studio-chapter-count"></span>`;
    button.querySelector('.studio-chapter-name').textContent = CHAPTER_SHORT[chapter.id] || chapter.label;
    button.title = chapter.label;
    button.querySelector('.studio-chapter-count').textContent = String(chapter.features.length);
    button.querySelector('.studio-chapter-count').setAttribute('aria-label', `${chapter.features.length} tools`);
    button.addEventListener('click', () => (openId === chapter.id ? closePanel() : openPanel(chapter.id)));
    chapterRow.append(button);
    buttons.set(chapter.id, button);
  }

  function card({ chapter, feature }, index) {
    const place = featurePlace(feature.target);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'studio-tool';
    button.dataset.studioTarget = feature.target;
    button.dataset.studioIndex = String(index);
    button.dataset.place = place;
    const head = document.createElement('span');
    head.className = 'studio-tool-head';
    const name = document.createElement('strong');
    name.textContent = feature.label;
    head.append(name);
    if (place === 'workbench') head.insertAdjacentHTML('beforeend', `<span class="studio-tool-window">${WINDOW_ICON}</span>`);
    const text = document.createElement('span');
    text.className = 'studio-tool-detail';
    text.textContent = feature.detail;
    const foot = document.createElement('span');
    foot.className = 'studio-tool-foot';
    const access = document.createElement('small');
    access.className = 'studio-access';
    access.dataset.tone = accessTone(feature.access);
    access.textContent = feature.access;
    const where = document.createElement('small');
    where.className = 'studio-where';
    where.textContent = openId === 'search' ? `${chapter.label} · ${PLACE_WORDS[place]}` : PLACE_WORDS[place];
    foot.append(access, where);
    button.append(head, text, foot);
    return button;
  }

  let listed = [];
  function render() {
    const searching = openId === 'search';
    const chapter = chapters.find(entry => entry.id === openId);
    listed = searching ? searchFeatures(chapters, query) : chapter.features.map(feature => ({ chapter, feature }));
    const header = document.createElement('div');
    header.className = 'studio-panel-head';
    if (searching) {
      header.innerHTML = `<label class="studio-search"><span>${SEARCH_ICON}</span><span class="visually-hidden">Find a tool</span><input id="studio-search" type="search" autocomplete="off" spellcheck="false" placeholder="Find a tool: route, photo, drawing, movement…"></label><p class="studio-panel-count" role="status"></p>`;
      header.querySelector('input').value = query;
    } else {
      header.innerHTML = `<span class="studio-panel-icon">${CHAPTER_ICONS[chapter.id] || ''}</span><div><h2 id="studio-panel-title"></h2><p></p></div><p class="studio-panel-count"></p>`;
      header.querySelector('h2').textContent = chapter.title;
      header.querySelector('div p').textContent = chapter.description;
    }
    header.querySelector('.studio-panel-count').textContent = searching
      ? (listed.length ? `${listed.length} of ${chapters.reduce((n, c) => n + c.features.length, 0)} tools` : 'No tool matches yet. Try another word.')
      : `${listed.length} tools`;
    const grid = document.createElement('div');
    grid.className = 'studio-tools';
    grid.append(...listed.map(card));
    const foot = document.createElement('p');
    foot.className = 'studio-panel-foot';
    foot.textContent = 'Tools open beside your world. Your map, edits and results stay where they are.';
    panel.replaceChildren(header, grid, foot);
    panel.setAttribute('aria-label', searching ? 'Find a tool' : chapter.label + ' tools');
    if (searching) {
      const input = panel.querySelector('#studio-search');
      input.addEventListener('input', () => {
        query = input.value;
        const position = input.selectionStart;
        render();
        const next = panel.querySelector('#studio-search');
        next.focus({ preventScroll: true });
        next.setSelectionRange(position, position);
      });
    }
  }

  // Bring the bar to its stuck position first, so the panel opens below it with room to read.
  function stickBar() {
    const offset = parseFloat(getComputedStyle(root).top) || 0;
    const gap = root.getBoundingClientRect().top - offset;
    if (gap > 1) window.scrollBy({ top: gap, behavior: 'instant' });
  }

  function openPanel(id, { focus = true } = {}) {
    stickBar();
    openId = id;
    for (const [key, button] of buttons) {
      const active = key === id;
      button.setAttribute('aria-expanded', String(active));
      button.classList.toggle('active', active);
    }
    searchButton.setAttribute('aria-expanded', String(id === 'search'));
    render();
    panel.hidden = false;
    root.dataset.panel = id;
    if (focus) (panel.querySelector('#studio-search') || panel.querySelector('.studio-tool'))?.focus({ preventScroll: true });
  }

  function closePanel({ restore = false } = {}) {
    if (!openId) return;
    const button = openId === 'search' ? searchButton : buttons.get(openId);
    openId = null;
    panel.hidden = true;
    delete root.dataset.panel;
    for (const entry of [...buttons.values(), searchButton]) {
      entry.setAttribute('aria-expanded', 'false');
      entry.classList.remove('active');
    }
    if (restore) button?.focus({ preventScroll: true });
  }

  searchButton.addEventListener('click', () => (openId === 'search' ? closePanel() : openPanel('search')));
  panel.addEventListener('click', event => {
    const tool = event.target.closest('[data-studio-target]');
    if (!tool) return;
    const entry = listed[Number(tool.dataset.studioIndex)];
    const origin = buttons.get(entry.chapter.id);
    closePanel();
    for (const button of buttons.values()) button.classList.toggle('current', button === origin);
    void openFeature(entry.feature, entry.chapter, origin);
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closePanel({ restore: true }); return; }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key) || event.target.matches('input')) return;
    const tools = [...panel.querySelectorAll('.studio-tool')];
    const index = tools.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
    tools[(index + step + tools.length) % tools.length].focus();
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openId && !panel.contains(event.target)) closePanel({ restore: true });
  });
  document.addEventListener('pointerdown', event => {
    if (openId && !root.contains(event.target)) closePanel();
  });
  home.addEventListener('click', event => {
    event.preventDefault();
    closePanel();
    for (const button of buttons.values()) button.classList.remove('current');
    onHome();
  });

  // Keep "Your world" in step with the workspace heading without coupling to the editor.
  const source = document.getElementById('workspace-project-name');
  const syncName = () => { const text = source?.textContent.trim(); if (text) worldName.textContent = text; };
  if (source) new MutationObserver(syncName).observe(source, { childList: true, characterData: true, subtree: true });
  syncName();

  return { openPanel, closePanel, get open() { return openId; } };
}
