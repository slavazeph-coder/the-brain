import {chapters} from './showcase-features.mjs';

// Assign focus inside existing tools. Opening a disclosure is local navigation.
function locateControl(scope, selector) {
  if (!selector) return null;
  const control = scope?.querySelector(selector);
  if (!control || control.disabled || control.closest('[hidden]')) return null;
  let ancestor = control.parentElement;
  while (ancestor) {
    if (ancestor.tagName === 'DETAILS' && control !== ancestor.querySelector(':scope > summary')) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  return control.getClientRects().length ? control : null;
}

async function scanControl(frame, selector) {
  if (!frame || !selector) return null;
  // The starter room is opened asynchronously inside the embedded editor.
  // Users with a different type of asset still get the main editor if a
  // feature only applies to Gaussians or a reviewed group.
  const current = () => locateControl(frame.contentDocument, selector);
  const available = current();
  if (available) return available;
  return new Promise(resolve => {
    let observer;
    const finish = control => {
      clearTimeout(timeout);
      observer?.disconnect();
      frame.removeEventListener('load', observe);
      resolve(control);
    };
    const check = () => { const control = current(); if (control) finish(control); };
    const observe = () => {
      observer?.disconnect();
      const doc = frame.contentDocument;
      if (!doc) return;
      observer = new MutationObserver(check);
      observer.observe(doc, {subtree:true, childList:true, attributes:true, attributeFilter:['hidden','disabled']});
      check();
    };
    const timeout = setTimeout(() => finish(null), 1500);
    frame.addEventListener('load', observe);
    observe();
  });
}

export function mountShowcase({root, showTab, showProject, showProcessing, leaveLayer}) {
  if (!root) return;
  const tabs = root.querySelector('[role=tablist]');
  const panel = root.querySelector('#showcase-panel');
  const back = document.getElementById('showcase-return');
  const video = root.querySelector('video');
  const filmStatus = root.querySelector('[data-film-status]');
  const filmUnavailable = filmStatus.textContent;
  const errorStatus = root.querySelector('[data-showcase-error]');
  let current, originButton, navigation = 0;
  const chapterButtons = new Map();

  function updateAddress(hash) {
    try {
      const url = new URL(location.href);
      url.hash = hash;
      history.replaceState(history.state, '', url);
    } catch { /* Navigation still works inside a restricted embed. */ }
  }

  async function openTool(feature) {
    const [kind, id] = feature.target.split(':');
    if (kind === 'project') {
      await showProject();
      return {control:null, insertBefore:panel};
    }
    if (kind === 'section') {
      const section = document.getElementById(id);
      return {control:locateControl(section, feature.focus) || section, insertBefore:section};
    }
    if (kind === 'layer') {
      const tab = document.getElementById('layer-tab-' + id);
      const area = document.getElementById('layer-panel-' + id);
      tab.click();
      const selected = id === 'scanedit'
        ? await scanControl(area.querySelector('iframe'), feature.focus)
        : locateControl(area, feature.focus);
      return {control:selected || area, insertBefore:area};
    }
    leaveLayer();
    if (kind === 'studio') {
      const options = await showProcessing();
      if (!options) throw Error('Open Add files to find the processing settings.');
      return {control:locateControl(options,feature.focus) || options.querySelector('summary'), insertBefore:document.getElementById('panel')};
    }
    await showTab(id);
    const tab = document.getElementById('tab-' + id);
    return {control:locateControl(document.getElementById('panel'), feature.focus) || tab, insertBefore:tab.closest('.workspace-journey') || tab.parentElement};
  }

  function featureControl(feature, index) {
    const externalPage = feature.target.startsWith('/');
    const control = document.createElement(externalPage ? 'a' : 'button');
    if (externalPage) {
      control.href = feature.target;
      control.target = '_blank';
      control.rel = 'noopener';
    } else {
      control.type = 'button';
    }
    control.dataset.showcaseTarget = feature.target;
    control.dataset.featureIndex = String(index);
    const name = document.createElement('strong');
    name.textContent = feature.label;
    const description = document.createElement('span');
    description.className = 'showcase-detail';
    description.textContent = feature.detail;
    const access = document.createElement('small');
    access.textContent = externalPage ? feature.access + ' · New tab' : feature.access;
    control.append(name, description, access);
    return control;
  }

  function select(chapter, {address = false, focus = false} = {}) {
    if (address) updateAddress('showcase-' + chapter.id);
    if (current !== chapter) {
      current = chapter;
      originButton = null;
      navigation++;
      back.hidden = true;
      errorStatus.textContent = '';
      for (const [id, button] of chapterButtons) {
        const active = id === chapter.id;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      }
      panel.setAttribute('aria-labelledby', 'showcase-' + chapter.id);
      const title = document.createElement('h3');
      title.textContent = chapter.title;
      const description = document.createElement('p');
      description.textContent = chapter.description;
      const list = document.createElement('ul');
      list.className = 'showcase-list';
      for (const [index, feature] of chapter.features.entries()) {
        const row = document.createElement('li');
        row.append(featureControl(feature, index));
        list.append(row);
      }
      panel.replaceChildren(title, description, list);
    }
    if (focus) chapterButtons.get(chapter.id).focus({preventScroll:true});
  }

  for (const chapter of chapters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role','tab');
    button.dataset.showcaseChapter = chapter.id;
    button.id = 'showcase-' + chapter.id;
    button.setAttribute('aria-controls', panel.id);
    button.textContent = chapter.label;
    button.addEventListener('click', () => select(chapter, {address:true}));
    tabs.append(button);
    chapterButtons.set(chapter.id, button);
  }

  tabs.addEventListener('keydown', event => {
    const index = chapters.findIndex(chapter => chapter.id === event.target.dataset.showcaseChapter);
    if (index < 0) return;
    const last = chapters.length - 1;
    const moves = {Home:0, End:last, ArrowLeft:(index + last) % chapters.length, ArrowRight:(index + 1) % chapters.length};
    if (!Object.hasOwn(moves, event.key)) return;
    event.preventDefault();
    select(chapters[moves[event.key]], {address:true, focus:true});
  });

  async function visit(feature, button) {
    video.pause();
    const token = ++navigation;
    errorStatus.textContent = '';
    try {
      const {control, insertBefore} = await openTool(feature);
      if (token !== navigation) return;
      originButton = button;
      back.hidden = false;
      back.dataset.fromLayer = String(feature.target.startsWith('layer:'));
      // Keep the return link next to the opened tool without covering its controls.
      insertBefore.before(back);
      if (control) {
        if (!control.hasAttribute('tabindex') && !control.matches('button, a, summary, input, select')) control.tabIndex = -1;
        control.focus({preventScroll:true});
        control.scrollIntoView({block:'start', behavior:'instant'});
      }
    } catch (error) {
      if (token === navigation) errorStatus.textContent = error.message || 'The tool could not open. Try it again.';
    }
  }
  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-showcase-target]');
    if (!button) return;
    if (button.tagName === 'A') video.pause();
    else void visit(current.features[Number(button.dataset.featureIndex)], button);
  });

  const related = document.getElementById('showcase-related');
  const cues = [...root.querySelectorAll('[data-showcase-seek]')].flatMap(button => {
    const number = Number(button.dataset.filmCue);
    for (const chapter of chapters) {
      const feature = chapter.features.find(entry => entry.filmCues?.includes(number));
      if (feature) return [{start:Number(button.dataset.showcaseSeek), chapter, feature, button}];
    }
    return [];
  });
  let activeCue;
  function syncFilm() {
    let cue = cues[0];
    for (const step of cues) {
      if (step.start > video.currentTime) break;
      cue = step;
    }
    if (!cue || !related) return;
    if (cue === activeCue) return;
    activeCue?.button.removeAttribute('aria-current');
    activeCue = cue;
    cue.button.setAttribute('aria-current','step');
    related.textContent = cue.feature.label + ' →';
    related.setAttribute('aria-label', 'Open this part of the video in the playground. ' + cue.feature.label);
  }
  for (const event of ['timeupdate','seeking','loadedmetadata']) video.addEventListener(event, syncFilm);
  syncFilm();
  if (related) related.hidden = !cues.length;
  related?.addEventListener('click', () => {
    syncFilm();
    select(activeCue.chapter, {address:true});
    void visit(activeCue.feature, related);
  });
  for (const cue of cues) cue.button.addEventListener('click', () => {
    video.currentTime = cue.start;
    video.scrollIntoView({block:'center', behavior:'instant'});
    video.focus({preventScroll:true});
    void video.play().catch(error => {
      // Pause and navigation can legitimately interrupt a pending play request.
      if (error.name === 'AbortError') return;
      filmStatus.textContent = error.name === 'NotAllowedError' ? 'Press Play on the video to continue.' : filmUnavailable;
      filmStatus.hidden = false;
    });
  });

  back.addEventListener('click', () => {
    back.hidden = true;
    if (back.dataset.fromLayer === 'true') leaveLayer();
    updateAddress('showcase-' + current.id);
    const target = originButton?.isConnected ? originButton : chapterButtons.get(current.id);
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'center', behavior:'instant'});
  });

  function followAddress() {
    const match = chapters.find(chapter => location.hash === '#showcase-' + chapter.id);
    if (match) {
      select(match);
      chapterButtons.get(match.id).scrollIntoView({block:'start', behavior:'instant'});
    } else if (location.hash === '#showcase') {
      back.hidden = true;
      root.scrollIntoView({block:'start', behavior:'instant'});
    }
  }
  select(chapters[0]);
  followAddress();
  window.addEventListener('hashchange', followAddress);
  window.addEventListener('pagehide', () => video.pause());
  function showMediaError() {
    filmStatus.textContent = filmUnavailable;
    filmStatus.hidden = false;
  }
  video.addEventListener('error', showMediaError);
  video.querySelector('source')?.addEventListener('error', showMediaError);
  for (const event of ['loadedmetadata','canplay','playing']) {
    video.addEventListener(event, () => { filmStatus.hidden = true; });
  }
}
