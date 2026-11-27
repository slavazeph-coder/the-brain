// Copy-ready code for one API request, in curl, JavaScript (the published SDK) and Python (requests).
// The key is never written into a snippet: snippets read it from BRAINSNN_API_KEY.

const SDK_METHODS = new Set(['status', 'me', 'listProjects', 'createProject', 'getProject', 'exportProject', 'addSource', 'getSource',
  'createRevision', 'addEvidence', 'reviewEvidence', 'createChange', 'decideChange', 'createTrial', 'usage', 'listKeys', 'createKey', 'revokeKey']);
// OpenAPI operation IDs that differ from the SDK's method names.
const ALIASES = { getStatus: 'status', getMe: 'me', getUsage: 'usage' };

const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const pyString = value => JSON.stringify(value);

function pythonLiteral(value, indent = 0) {
  const pad = ' '.repeat(indent + 4), end = ' '.repeat(indent);
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return value.length ? `[${value.map(v => pythonLiteral(v, indent)).join(', ')}]` : '[]';
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pythonLiteral(v, indent + 4)}`).join(',\n')}\n${end}}`;
}

/**
 * @param {{method:string, path:string, body?:object|null, op?:{id:string, pathParams?:string[], idempotent?:boolean, public?:boolean},
 *          origin?:string}} request  path is relative to /api/world/v1, with IDs already filled in.
 */
export function snippets({ method, path, body = null, op = { id: '' }, origin = 'https://www.brainsnn.com' }) {
  const base = `${origin.replace(/\/$/, '')}/api/world/v1`;
  const mutation = method !== 'GET' && method !== 'HEAD';
  const json = body ? JSON.stringify(body, null, 2) : null;

  const curl = [`curl -sS -X ${method} "${base}${path}"`];
  if (!op.public) curl.push('  -H "Authorization: Bearer $BRAINSNN_API_KEY"');
  if (mutation) curl.push('  -H "Idempotency-Key: $(uuidgen)"');
  if (json) curl.push('  -H "Content-Type: application/json"', `  --data ${shellQuote(JSON.stringify(body))}`);

  const name = ALIASES[op.id] || op.id;
  const ids = (path.match(/^\/(?:projects|keys)\/([^/]+)(?:\/[a-z-]+\/([^/]+))?/) || []).slice(1).filter(Boolean).map(decodeURIComponent);
  let call;
  if (SDK_METHODS.has(name)) {
    const args = [...ids.map(id => JSON.stringify(id))];
    if (mutation) args.push(json ? json.replace(/\n/g, '\n  ') : '{}');
    call = `const result = await client.${name}(${args.join(', ')});`;
  } else if (path.startsWith('/processing')) {
    call = `const result = await client.processingRequest(${JSON.stringify(path.replace(/^\/processing/, ''))}, { method: ${JSON.stringify(method)}${json ? `, body: ${json.replace(/\n/g, '\n  ')}` : ''} });`;
  } else {
    call = `// Not wrapped by the SDK: call it over HTTP as in the curl example.`;
  }
  const javascript = [
    `import { createProjectsClient } from '${origin.replace(/\/$/, '')}/world/projects-client.mjs';`,
    '',
    `const client = createProjectsClient({ apiKey: process.env.BRAINSNN_API_KEY, baseUrl: '${base}' });`,
    mutation ? '// The SDK adds an Idempotency-Key; reuse prepareMutation(...) to retry the exact same request.' : null,
    call,
    'console.log(result);',
  ].filter(line => line !== null).join('\n');

  const headers = [op.public ? null : '"Authorization": f"Bearer {os.environ[\'BRAINSNN_API_KEY\']}"', mutation ? '"Idempotency-Key": str(uuid.uuid4())' : null].filter(Boolean);
  const python = [
    'import os, uuid, requests',
    '',
    `response = requests.request(${pyString(method)}, ${pyString(base + path)},`,
    `    headers={${headers.join(', ')}},`,
    json ? `    json=${pythonLiteral(body, 4)},` : null,
    '    timeout=60)',
    'response.raise_for_status()',
    'print(response.json())',
  ].filter(line => line !== null).join('\n');

  return { curl: curl.join(' \\\n'), javascript, python };
}
