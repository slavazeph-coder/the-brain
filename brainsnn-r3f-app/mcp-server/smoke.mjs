// Smoke test: spawn the stdio MCP server, list tools, call a couple, assert.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['index.mjs'] });
const client = new Client({ name: 'brainsnn-smoke', version: '0.0.1' });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log('tools:', names.join(', '));

const expected = ['brain_affect', 'brain_analyze', 'brain_firewall', 'brain_layers', 'brain_soliton', 'brain_soliton_explore'];
for (const name of expected) {
  if (!names.includes(name)) throw new Error(`missing tool: ${name}`);
}

const soliton = JSON.parse((await client.callTool({ name: 'brain_soliton', arguments: { content: 'Last chance! Act now before this rigged scam ruins everything you trust.' } })).content[0].text);
console.log('brain_soliton →', soliton.synchrony, 'coherence', soliton.gammaCoherence);
if (typeof soliton.gammaCoherence !== 'number') throw new Error('brain_soliton returned no coherence');

const firewall = JSON.parse((await client.callTool({ name: 'brain_firewall', arguments: { content: 'Last chance, guaranteed, they do not want you to know the hidden truth.' } })).content[0].text);
console.log('brain_firewall →', 'grade', firewall.grade, 'tier', firewall.tier);
if (!firewall.grade) throw new Error('brain_firewall returned no grade');

const layers = JSON.parse((await client.callTool({ name: 'brain_layers', arguments: {} })).content[0].text);
console.log('brain_layers → total', layers.total);
if (layers.total < 103) throw new Error('brain_layers total too low');

await client.close();
console.log('SMOKE_OK');
