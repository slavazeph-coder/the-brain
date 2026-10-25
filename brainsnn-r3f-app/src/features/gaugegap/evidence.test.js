import { describe, expect, it } from '../../test/tinyVitest.js';
import { buildAttractorEvidence, canonicalJson, sha256Hex, EVIDENCE_SCHEMA } from './evidence.js';

const params = { sigma: 10, rho: 28, beta: 2.667, speed: 1 };
const controls = [{ key: 'sigma', label: 'Stretch', min: 4, max: 22, step: 0.1 }];

describe('canonicalJson', () => {
  it('sorts object keys so hashing is order-independent', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(canonicalJson({ x: undefined })).toBe('{"x":null}');
  });
});

describe('sha256Hex', () => {
  it('produces a stable 64-char hex digest', async () => {
    const digest = await sha256Hex('gaugegap');
    expect(digest.length).toBe(64);
    expect(digest).toBe(await sha256Hex('gaugegap'));
  });
});

describe('buildAttractorEvidence', () => {
  it('bundles schema, parameters, solver facts, claim boundary and a content hash', async () => {
    const pack = await buildAttractorEvidence({ params, scores: { chaos: 70, beauty: 60, discovery: 80 }, shareUrl: 'https://brainsnn.com/?lab=attractor&run=10,28,2.667,1', controls });
    expect(pack.schema).toBe(EVIDENCE_SCHEMA);
    expect(pack.parameters.rho).toBe(28);
    expect(pack.parameter_ranges.sigma.max).toBe(22);
    expect(pack.solver.method.includes('Euler')).toBe(true);
    expect(pack.claim_boundary.includes('not proof')).toBe(true);
    expect(pack.content_hash.length).toBe(64);
  });

  it('is reproducible for identical input and diverges when a parameter changes', async () => {
    const now = new Date('2026-07-12T00:00:00Z');
    const packA = await buildAttractorEvidence({ params, controls, now });
    const packB = await buildAttractorEvidence({ params, controls, now });
    const packC = await buildAttractorEvidence({ params: { ...params, rho: 36 }, controls, now });
    expect(packA.content_hash).toBe(packB.content_hash);
    expect(packA.content_hash === packC.content_hash).toBe(false);
  });
});
