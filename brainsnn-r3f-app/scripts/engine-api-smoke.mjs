// Exercise the compiled server, not a mocked fetch or a copied route handler.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
let output = '';
const server = spawn(process.execPath, ['dist/server.cjs'], {
  // Deliberately exclude account/database/model credentials from this test.
  env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), GEMINI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => { output = (output + chunk).slice(-5000); });
server.stderr.on('data', (chunk) => { output = (output + chunk).slice(-5000); });
const origin = `http://127.0.0.1:${port}`;
const post = (body) => fetch(`${origin}/api/engine/compare`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
});

try {
  let ready = false;
  for (let i = 0; i < 50; i += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited before readiness: ${output}`);
    try { ready = (await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Server did not become ready: ${output}`);
  const input = { original: 'Guaranteed! Act now before this hidden threat ruins everything.', candidate: 'Test the workflow with your team. Review the source and measured limitations.' };
  const first = await post(input);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /no-store/);
  const record = await first.json();
  assert.equal(record.schemaVersion, 'brainsnn.engine-comparison.v1');
  assert.equal(record.decision, 'REVIEW_REQUIRED');
  assert.equal(record.execution.providerCalls, 0);
  assert.equal(record.execution.persisted, false);
  assert.equal(record.evidence.marketOutcomeMeasured, false);
  assert.equal(record.original.content, input.original);
  assert.equal(record.signalsWithinLimits, true);
  assert.equal((await (await post(input)).json()).id, record.id);
  for (const finding of record.original.findings) assert.equal(input.original.slice(finding.start, finding.end), finding.quotation);
  assert.equal((await (await post({ original: input.candidate, candidate: input.original })).json()).signalsWithinLimits, false);
  for (const invalid of [null, {}, { ...input, original: 23 }, { ...input, candidate: ' ' }, { ...input, candidate: 'x'.repeat(8001) }, { ...input, limits: { maxTrustDrop: null } }]) {
    const rejected = await post(invalid);
    assert.equal(rejected.status, 400);
    assert.match(rejected.headers.get('cache-control'), /no-store/);
  }
  assert.equal((await post({ ...input, original: 'Invalid \ud800 text' })).status, 400);
  const oversized = await post({ ...input, original: 'x'.repeat(70_000) });
  assert.equal(oversized.status, 413);
  assert.match(oversized.headers.get('cache-control'), /no-store/);
  const page = await fetch(`${origin}/engine`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Compare two drafts \| BrainSNN Engine/);
  console.log('ENGINE_API_SMOKE_OK: compiled route, repeatable identities, source spans, regression, validation, body cap, metadata; zero provider calls.');
} finally {
  server.kill('SIGTERM');
  if (server.exitCode === null) await once(server, 'exit');
}
