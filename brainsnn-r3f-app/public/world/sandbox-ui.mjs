import {createSandboxSession, routeSelection, sandboxURL} from './sandbox-session.mjs';

// One document owns capture, processing and the active scene. Each scene keeps
// its own geometry contract; switching tools never converts or registers it.
export function createSandboxUI({setMapTab, getMap, getSourceCount, status, event, pauseMap}) {
  const $ = id => document.getElementById(id);
  const session = createSandboxSession();
  const initial = routeSelection(location.href);
  const abort = new AbortController();
  const host = $('street-workspace'), placeholder = $('sandbox-loading');
  const mapBody = $('map-workspace'), progress = $('capture-progress');
  const tools = {world:'edit', test:'simulate', understand:'evidence', evidence:'export'};
  const tabs = {edit:'world', simulate:'test', evidence:'understand', export:'evidence'};
  let street = null, pending = null, loading = false, disposed = false, suspended = false, syncing = false;
  let resumeToken = null;

  function route() {
    try { history.replaceState(history.state, '', sandboxURL(location.href, session.getState())); }
    catch { /* Sandboxed embeds can deny history; the live workspace still works. */ }
  }
  function sync() {
    if (disposed) return;
    const state = session.getState(), active = state.workspace === 'street';
    $('workspace').dataset.sandbox = state.workspace;
    host.hidden = !active;
    mapBody.hidden = active;
    progress.hidden = active;
    $('fork').hidden = state.workspace !== 'map';
    $('export').textContent = active ? 'Export scene ↗' : 'Export proof ↗';
    $('sandbox-scene').value = state.workspace === 'capture' ? session.snapshot().returnWorkspace : state.workspace;
    $('sandbox-return').hidden = state.workspace !== 'capture';
    $('sandbox-source-count').textContent = `${getSourceCount()} local source${getSourceCount() === 1 ? '' : 's'}`;
    $('sandbox-source-count').hidden = getSourceCount() === 0;
    const selectedTab = state.workspace === 'capture' && state.tool === 'edit' ? 'capture' : tabs[state.tool];
    for (const button of document.querySelectorAll('[data-tab]')) {
      const selected = button.dataset.tab === selectedTab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.setAttribute('aria-controls', active ? 'street-workspace' : 'panel');
    }
    if (active) {
      $('world-title').textContent = 'Green Gardens / Toronto block';
      $('provenance').textContent = 'GEOGRAPHIC REFERENCE + AUTHORED DETAIL';
      $('sandbox-context').textContent = 'Edit objects, walk the block and test routes in this scene. Captures stay in this session; they are not automatically aligned to the block.';
    } else if (state.workspace === 'capture') {
      $('sandbox-context').textContent = `Capture and reconstruction · ${session.snapshot().returnWorkspace === 'street' ? 'Your street edits are kept. Return to the scene when ready.' : 'Your map is kept while you add or process sources.'}`;
    } else {
      $('sandbox-context').textContent = 'Planning map · review geometry and scale, edit obstacles, test a route and keep its evidence.';
    }
    $('sandbox-share').disabled = loading;
  }
  function mapTab(next) {
    syncing = true;
    try { setMapTab(next); }
    finally { syncing = false; }
  }
  function loadingMessage(message, retry = false) {
    placeholder.replaceChildren();
    const text = document.createElement('p'); text.textContent = message;
    placeholder.append(text); placeholder.hidden = false;
    if (retry) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'primary'; button.textContent = 'Retry street scene';
      button.addEventListener('click', () => void select('street', session.getState().tool), {signal:abort.signal});
      placeholder.append(button);
    }
  }
  async function getStreet() {
    if (street) return street;
    if (!pending) {
      loading = true;
      loadingMessage('Loading the street scene, objects and terrain…');
      sync();
      pending = import('./street/workspace.mjs').then(async module => {
        const controller = await module.mountStreetWorkspace($('street-mount'), {
          signal:abort.signal,
          onStatus:(message, error = false) => {
            if (!disposed && session.getState().workspace === 'street') status(message, error);
          },
          onChange:state => {
            if (!disposed && session.getState().workspace === 'street') {
              $('sandbox-scene-state').textContent = `${state.objectCount ?? 272} objects · edit ${state.editRevision ?? 0}`;
            }
          },
          onToolChange:tool => {
            if (disposed || suspended || session.getState().workspace !== 'street') return;
            session.select('street', tool); sync(); route();
          },
        });
        if (disposed) { controller.dispose(); throw new Error('Workspace closed.'); }
        street = controller;
        controller.setActive(false);
        placeholder.hidden = true;
        return controller;
      }).catch(error => {
        if (!disposed) loadingMessage(`The street scene could not load. ${error.message}`, true);
        throw error;
      }).finally(() => { pending = null; loading = false; sync(); });
    }
    return pending;
  }
  async function activate(token, {writeRoute = true} = {}) {
    street?.setActive(false);
    if (token.workspace !== 'map') pauseMap(token.workspace);
    if (token.workspace === 'capture') mapTab(token.tool === 'edit' ? 'capture' : tabs[token.tool]);
    else if (token.workspace === 'map') mapTab(tabs[token.tool]);
    sync();
    if (writeRoute) route();
    if (token.workspace !== 'street') return;
    try {
      const controller = await getStreet();
      if (suspended || !session.isCurrent(token)) return;
      controller.setActive(true);
      controller.setTool(token.tool);
      const state = controller.getState();
      $('sandbox-scene-state').textContent = `${state.objectCount} objects · edit ${state.editRevision}`;
      status('Street scene ready. Object edits, navigation and exports use this scene.');
      sync();
    } catch (error) {
      if (session.isCurrent(token)) status(`Street scene unavailable: ${error.message}`, true);
    }
  }
  async function select(workspace, tool) {
    if (disposed) return;
    const token = session.select(workspace, tool);
    event('sandbox_selected', {workspace:token.workspace, sceneId:token.sceneId, tool:token.tool});
    await activate(token);
  }
  function handleTab(tab) {
    if (tab === 'capture') return select('capture');
    const tool = tools[tab]; if (!tool) return;
    const target = session.getState().workspace === 'capture'
      ? ['evidence','export'].includes(tool) ? 'capture' : session.snapshot().returnWorkspace
      : session.getState().workspace;
    return select(target, tool);
  }
  function observeMapTab(tab) {
    if (disposed || syncing || session.getState().workspace === 'street') { sync(); return; }
    const captureContext = session.getState().workspace === 'capture' && ['capture','understand','evidence'].includes(tab);
    session.select(tab === 'capture' || captureContext ? 'capture' : 'map', tools[tab] || 'edit');
    street?.setActive(false);
    sync(); route();
  }
  $('sandbox-scene').addEventListener('change', e => void select(e.target.value), {signal:abort.signal});
  $('sandbox-return').addEventListener('click', () => void activate(session.returnToScene()), {signal:abort.signal});
  $('sandbox-share').addEventListener('click', async () => {
    // Always point to the native document. Sharing a route never shares files,
    // edits, a worker session or a private source URL.
    const link = sandboxURL(new URL('./index.html', location.href).href, session.getState());
    try {
      await navigator.clipboard.writeText(link);
      if (disposed) return;
      status('Sandbox link copied. It opens the scene; local edits and captures stay on this device.');
    } catch {
      if (disposed) return;
      $('sandbox-link').value = link; $('sandbox-link').hidden = false;
      $('sandbox-link').focus(); $('sandbox-link').select();
      status('Copy this scene link. Local edits and captures are not included.');
    }
  }, {signal:abort.signal});
  $('hero-street').addEventListener('click', () => {
    void select('street', 'edit'); $('workspace').scrollIntoView({block:'start'});
  }, {signal:abort.signal});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) street?.setActive(false);
    else if (!suspended && session.getState().workspace === 'street') street?.setActive(true);
  }, {signal:abort.signal});
  return {
    start:() => activate(session.select(initial.workspace, initial.tool), {writeRoute:false}),
    select, handleTab, observeMapTab, sync,
    getState:() => ({...session.getState(), ...(street ? {street:street.getState()} : {})}),
    isStreet:() => session.getState().workspace === 'street',
    openExport:() => handleTab('evidence'),
    suspend:() => { if (disposed) return; suspended = true; resumeToken = session.getState(); session.cancelPending(); street?.setActive(false); },
    resume:() => { if (disposed) return; suspended = false; if (resumeToken) { const state = resumeToken; resumeToken = null; void activate(session.select(state.workspace, state.tool), {writeRoute:false}); } },
    dispose:() => { if (disposed) return; disposed = true; session.dispose(); abort.abort(); street?.dispose(); street = null; },
  };
}
