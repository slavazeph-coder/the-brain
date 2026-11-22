// Only public places have shareable fragments. Workspace handoffs and credentials
// are handled solely by the native document's explicit import flows.
const publicPlaces = new Set([
  '#workspace', '#studio', '#world-examples', '#robot-setup', '#what-to-create', '#systems',
  '#source-notes', '#site-resources', '#workspace-command-bar',
  '#showroom', '#showroom-walk', '#showroom-run', '#pancake-lab', '#rolling-pin',
  '#showcase', '#showcase-robot', '#showcase-capture', '#showcase-scan',
  '#showcase-building', '#showcase-motion', '#showcase-share',
  '#layer-tab-repair', '#layer-tab-localization', '#layer-tab-motion',
  '#layer-tab-biomechanics', '#layer-tab-open4dgs', '#layer-tab-stereo',
  '#layer-tab-scanedit', '#layer-tab-robottask',
]);

export function publicWorldFragment(hash) {
  return publicPlaces.has(hash) ? hash : '';
}

/** Forward only the sandbox's public navigation choices into its native document. */
export function worldDocumentSource(search = '', hash = '') {
  const input = new URLSearchParams(search), output = new URLSearchParams();
  const allowed = {
    sandbox: ['map', 'capture', 'street'],
    scene: ['planning-map', 'green-gardens'],
    tool: ['edit', 'simulate', 'evidence', 'export'],
    install: ['1'],
    nosw: ['1'],
  };
  for (const [key, values] of Object.entries(allowed)) {
    if (input.getAll(key).length === 1 && values.includes(input.get(key))) output.set(key, input.get(key));
  }
  const query = output.toString();
  return '/world/index.html' + (query ? '?' + query : '') + publicWorldFragment(hash);
}
