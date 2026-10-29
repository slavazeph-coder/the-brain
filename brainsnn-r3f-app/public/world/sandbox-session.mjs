/**
 * Navigation state for one World Builder document. This is a scene selector,
 * never a geometry adapter: the street scene does not enter the indoor map
 * normalizer, and selecting Capture does not register media to either scene.
 * Credentials, source bytes and simulation/edit state remain with their owners.
 */
export const SANDBOX_SESSION_SCHEMA = 'brainsnn.sandbox-session.v1';
const WORKSPACES = new Set(['map', 'street', 'capture']);
const TOOLS = new Set(['edit', 'simulate', 'evidence', 'export']);
const SCENES = Object.freeze({map:'planning-map', street:'green-gardens', capture:null});
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function selection(value, fallback = {workspace:'map', tool:'edit'}) {
  if (!plain(value)) throw new Error('Choose a sandbox workspace and tool.');
  if (Object.keys(value).some(key => !['workspace','tool','sceneId'].includes(key))) {
    throw new Error('Sandbox navigation cannot contain media, credentials or scene geometry.');
  }
  const workspace = own(value,'workspace') ? value.workspace : fallback.workspace;
  const tool = own(value,'tool') ? value.tool : fallback.tool;
  if (!WORKSPACES.has(workspace) || !TOOLS.has(tool)) throw new Error('Unknown sandbox workspace or tool.');
  const sceneId = SCENES[workspace];
  if (own(value,'sceneId') && value.sceneId !== sceneId) throw new Error('The selected scene does not belong to this workspace.');
  return {workspace, tool, sceneId};
}

/** Invalid or ambiguous external routes open the normal map, never a remote URL. */
export function routeSelection(value) {
  let url;
  try { url = new URL(value, 'https://brainsnn.invalid/world/'); }
  catch { return selection({}); }
  const sandbox = url.searchParams.get('sandbox'), scene = url.searchParams.get('scene');
  const tool = TOOLS.has(url.searchParams.get('tool')) ? url.searchParams.get('tool') : 'edit';
  if (url.searchParams.getAll('sandbox').length > 1 || url.searchParams.getAll('scene').length > 1 || url.searchParams.getAll('tool').length > 1) return selection({});
  if (sandbox && !WORKSPACES.has(sandbox)) return selection({});
  if (scene && !['green-gardens','planning-map'].includes(scene)) return selection({});
  let workspace = sandbox || (scene === 'green-gardens' ? 'street' : 'map');
  if (scene && (workspace === 'capture' || SCENES[workspace] !== scene)) return selection({});
  return selection({workspace, tool});
}

/**
 * Safe share route. Preserve supported non-sensitive shell options; other
 * query fields are deliberately omitted rather than copying arbitrary session
 * identifiers. Source files, credentials, scene edits and location data are
 * not encoded into the route.
 */
export function sandboxURL(value, requested) {
  if (!plain(requested)) throw new Error('Choose a sandbox workspace and tool.');
  // getState() also carries lifecycle counters; only navigation is shareable.
  const selected = selection({
    ...(own(requested,'workspace') ? {workspace:requested.workspace} : {}),
    ...(own(requested,'tool') ? {tool:requested.tool} : {}),
    ...(own(requested,'sceneId') ? {sceneId:requested.sceneId} : {}),
  }), url = new URL(value);
  if (!['http:','https:'].includes(url.protocol)) throw new Error('A sandbox link needs an HTTP or HTTPS page.');
  const original = url.searchParams;
  const safe = new URLSearchParams();
  for (const flag of ['nosw','install']) if (original.get(flag) === '1') safe.set(flag,'1');
  for (const name of ['lang','locale']) {
    const language = original.get(name);
    if (language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(language)) safe.set(name,language);
  }
  if (['dark','light','auto'].includes(original.get('theme'))) safe.set('theme',original.get('theme'));
  safe.set('sandbox',selected.workspace);
  if (selected.sceneId) safe.set('scene',selected.sceneId);
  if (selected.tool !== 'edit') safe.set('tool',selected.tool);
  url.username = ''; url.password = ''; url.search = safe.toString(); url.hash = 'workspace';
  return url.href;
}

export function createSandboxSession({initial = {workspace:'map', tool:'edit'}} = {}) {
  let state = selection(initial), revision = 0, disposed = false, token = null;
  let returnWorkspace = state.workspace === 'capture' ? 'map' : state.workspace;
  let lastTools = {map:'edit', street:'edit'};
  if (state.workspace !== 'capture') lastTools[state.workspace] = state.tool;
  function activate(next) {
    if (disposed) throw new Error('This sandbox session has been disposed.');
    state = next;
    if (next.workspace !== 'capture') {
      returnWorkspace = next.workspace;
      lastTools[next.workspace] = next.tool;
    }
    token = Object.freeze({...state, revision:++revision});
    return token;
  }
  function select(workspace, tool) {
    const fallbackTool = workspace === 'capture' ? 'edit' : lastTools[workspace] || 'edit';
    return activate(selection({workspace, tool:tool === undefined ? fallbackTool : tool}));
  }
  function snapshot() {
    return {schema:SANDBOX_SESSION_SCHEMA, ...state, returnWorkspace, lastTools:{...lastTools}};
  }
  function restore(value) {
    if (!plain(value) || Object.keys(value).some(key => !['schema','workspace','tool','sceneId','returnWorkspace','lastTools'].includes(key)) || value.schema !== SANDBOX_SESSION_SCHEMA) throw new Error('Import a supported sandbox navigation descriptor.');
    const next = selection({workspace:value.workspace, tool:value.tool, sceneId:value.sceneId});
    if (!['map','street'].includes(value.returnWorkspace) || !plain(value.lastTools) || Object.keys(value.lastTools).length !== 2 || !own(value.lastTools,'map') || !own(value.lastTools,'street') || !TOOLS.has(value.lastTools.map) || !TOOLS.has(value.lastTools.street)) throw new Error('The sandbox navigation history is invalid.');
    if (next.workspace !== 'capture' && (value.returnWorkspace !== next.workspace || value.lastTools[next.workspace] !== next.tool)) throw new Error('The sandbox navigation history does not match its active scene.');
    if (disposed) throw new Error('This sandbox session has been disposed.');
    // All checks precede the only mutation; a rejected descriptor is atomic.
    returnWorkspace = value.returnWorkspace; lastTools = {map:value.lastTools.map, street:value.lastTools.street};
    return activate(next);
  }
  return Object.freeze({
    select,
    returnToScene:() => select(returnWorkspace),
    isCurrent:candidate => !disposed && candidate !== null && candidate === token,
    getState:() => ({...state, revision, disposed}),
    snapshot,
    restore,
    // Invalidate a pending asynchronous operation without changing visible mode.
    cancelPending:() => { token = null; revision++; },
    dispose:() => { disposed = true; token = null; revision++; },
  });
}
