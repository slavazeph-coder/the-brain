'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { validateEvidence } = require('../evidence.cjs');
const { createProvider, normalizeUsage, MODEL, MAX_OUTPUT_TOKENS } = require('../provider.cjs');

function fixture() {
  function chunk(kind, body) { const b = Buffer.alloc(body.length + 12); b.writeUInt32BE(body.length); b.write(kind, 4); body.copy(b, 8);
    let crc = 0xffffffff; for (const byte of b.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4); return b; }
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))]);
  return validateEvidence({ schema: 'brainsnn.arena.analysis-input.v1', manifestSha256: 'a'.repeat(64), recordingId: 'recording-1', sourceKind: 'imported',
    context: { limitations: ['One resized frame only.'] }, selectedEventIds: ['obs-1'], includePrompts: false,
    events: [{ id: 'obs-1', kind: 'observation', seq: 1, refs: [], data: {} }], images: [{ id: 'image-1', eventId: 'obs-1', artifactId: 'source-1',
      originalSha256: 'b'.repeat(64), sha256: createHash('sha256').update(png).digest('hex'), mimeType: 'image/png', width: 1, height: 1, dataBase64: png.toString('base64') }] });
}
const review = () => ({ hypotheses: [{ summary: 'A visible gap may remain.', refs: ['image-1', 'obs-1'], counterevidence: [], limitations: ['No calibrated depth.'] }],
  suggestedExperiments: [{ summary: 'Compare a repeated recorded trial.', refs: ['obs-1'], expectedObservation: 'Check whether the gap recurs.' }], missingInformation: ['Additional states.'] });
function response(value = review()) { return { status: 'completed', model: MODEL, output_text: JSON.stringify(value), usage: {
  total_input_tokens: 100, total_output_tokens: 50, total_thought_tokens: 20, total_tokens: 170, total_cached_tokens: 20,
} }; }

test('sends stateless structured Interactions with explicit limits, no tools, retries or source URL', async () => {
  let calls = 0, request, options;
  const provider = createProvider({ client: { interactions: { create: async (r, o) => { calls++; request = r; options = o; return response(); } } } });
  const input = fixture(), result = await provider.analyze(input);
  assert.equal(calls, 1); assert.equal(request.model, MODEL); assert.equal(request.store, false); assert.equal(request.background, false);
  assert.equal(request.generation_config.max_output_tokens, MAX_OUTPUT_TOKENS); assert.equal(request.generation_config.thinking_level, 'low');
  assert.equal(request.generation_config.thinking_summaries, 'none'); assert.equal(request.response_format.mime_type, 'application/json');
  assert.equal(request.tools, undefined); assert.equal(request.previous_interaction_id, undefined); assert.deepEqual(options.retries, { strategy: 'none' });
  assert.equal(options.timeout_ms, 600000); assert.equal(request.input[2].resolution, 'high'); assert.equal(request.input[2].uri, undefined);
  assert.equal(result.inputDigest, input.inputDigest); assert.equal(result.manifestSha256, input.evidence.manifestSha256);
  assert.equal(result.modelVersion, MODEL); assert.equal(result.usage.billedOutputTokens, 70); assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.provenance.evidenceIdentityStatus, 'client-declared'); assert.equal(result.hypotheses[0].id, 'hypothesis-1');
  assert.equal(result.hypotheses[0].timestamp, undefined); assert.equal(result.coverage.selectedEventIds[0], 'obs-1');
});
test('rejects invented references and malformed outputs while retaining charged usage', async () => {
  const invalids = [() => { const r = review(); r.hypotheses[0].refs.push('invented'); return r; },
    () => ({ ...review(), timestamp: 4 }), () => { const r = review(); r.hypotheses[0].refs = []; return r; }];
  for (const value of invalids) {
    const provider = createProvider({ client: { interactions: { create: async () => response(value()) } } });
    await assert.rejects(provider.analyze(fixture()), error => error.code === 'invalid_provider_output' && error.usage.billedOutputTokens === 70 && !error.costUnknown);
  }
  const provider = createProvider({ client: { interactions: { create: async () => ({ ...response(), output_text: '{broken' }) } } });
  await assert.rejects(provider.analyze(fixture()), { code: 'invalid_provider_output' });
});
test('permits abstention, records unreported usage/version honestly, rejects model substitution', async () => {
  const provider = createProvider({ client: { interactions: { create: async () => ({ status: 'completed', output_text: JSON.stringify({ hypotheses: [], suggestedExperiments: [], missingInformation: ['Insufficient evidence.'] }) }) } } });
  const result = await provider.analyze(fixture()); assert.equal(result.modelVersion, null); assert.equal(result.usage.complete, false); assert.equal(result.usage.billedOutputTokens, null);
  const wrong = createProvider({ client: { interactions: { create: async () => ({ ...response(), model: 'different-model' }) } } });
  await assert.rejects(wrong.analyze(fixture()), /unexpected model/);
});
test('timeout aborts exactly one attempt and never pretends provider cost was canceled', async () => {
  let calls = 0, signal;
  const provider = createProvider({ timeoutMs: 10, client: { interactions: { create: (_, options) => { calls++; signal = options.signal; return new Promise(() => {}); } } } });
  await assert.rejects(provider.analyze(fixture()), error => error.code === 'provider_timeout' && error.costUnknown && error.providerAttempted);
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});
test('provider failures hide raw secrets and are never retried', async () => {
  let calls = 0;
  const provider = createProvider({ client: { interactions: { create: async () => { calls++; throw Object.assign(new Error('api-key=secret raw-user-prompt'), { status: 429 }); } } } });
  await assert.rejects(provider.analyze(fixture()), error => error.code === 'provider_unavailable' && !String(error).includes('secret') && error.costUnknown);
  assert.equal(calls, 1);
});
test('mutated previously validated evidence cannot dispatch an expensive request', async () => {
  let calls = 0; const provider = createProvider({ client: { interactions: { create: async () => { calls++; return response(); } } } });
  const valid = fixture(); valid.evidence.context.task = 'different';
  await assert.rejects(provider.analyze(valid), error => error.code === 'evidence_changed' && error.providerAttempted === false);
  assert.equal(calls, 0);
});
test('usage reserves thinking and extra generated usage without relying on cache savings', () => {
  assert.equal(normalizeUsage({ total_input_tokens: 10, total_output_tokens: 20, total_thought_tokens: 30, total_tokens: 70 }).billedOutputTokens, 60);
  assert.equal(normalizeUsage({ total_input_tokens: 10, total_output_tokens: 20 }).complete, false);
  assert.equal(normalizeUsage({ total_input_tokens: -1, total_output_tokens: 20, total_thought_tokens: 0, total_tokens: 19 }).complete, false);
});

test('installed SDK serializes the intended wire contract and does not retry HTTP 503', async () => {
  const originalFetch = global.fetch; let calls = 0, wire, unavailable = false;
  global.fetch = async (request, init) => {
    calls++;
    wire = JSON.parse(request instanceof Request ? await request.text() : init.body);
    if (unavailable) return new Response(JSON.stringify({ error: { code: 503, message: 'test outage', status: 'UNAVAILABLE' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    const good = response(); delete good.output_text;
    good.id = 'test-interaction'; good.steps = [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(review()) }] }];
    return new Response(JSON.stringify(good), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const provider = createProvider({ apiKey: 'test-only-never-network', timeoutMs: 1000 });
    const result = await provider.analyze(fixture());
    assert.equal(result.hypotheses.length, 1); assert.equal(calls, 1); assert.equal(wire.store, false);
    assert.equal(wire.generation_config.max_output_tokens, 32768); assert.equal(wire.input[2].resolution, 'high');
    assert.equal(wire.response_format.mime_type, 'application/json'); assert.equal(wire.tools, undefined);
    unavailable = true;
    await assert.rejects(provider.analyze(fixture()), { code: 'provider_failed' });
    assert.equal(calls, 2, 'one success request plus exactly one failed request');
  } finally { global.fetch = originalFetch; }
});
