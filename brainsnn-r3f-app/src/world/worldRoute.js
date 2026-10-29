/** Forward only the sandbox's public navigation choices into its native document. */
export function worldDocumentSource(search = '') {
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
  return '/world/index.html' + (query ? '?' + query : '');
}
