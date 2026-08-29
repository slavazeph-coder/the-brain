import { describe, expect, it } from '../../test/tinyVitest.js';
import { buildMissionProofPack, canonicalJson, createSeededRandom } from './missionRuntime.js';

describe('proof mission runtime', () => {
  it('replays the same random sequence for the same seed', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('canonicalizes nested object keys deterministically', () => {
    expect(canonicalJson({ z: 1, a: { d: 4, b: 2 }, m: [{ y: 2, x: 1 }] }))
      .toBe('{"a":{"b":2,"d":4},"m":[{"x":1,"y":2}],"z":1}');
  });

  it('keeps run identity stable across repeated exports', async () => {
    const result = {
      mission: { id: 'mission.test', claimBoundary: 'Finite test only.' },
      configuration: { seed: 7 },
      metrics: { decisions: 1 },
      status: 'MISSION SUCCESS',
      ledger: [{ caseId: 'T-1', action: 'pass' }],
    };
    const a = await buildMissionProofPack(result);
    const b = await buildMissionProofPack(result);
    expect(a.runtime).toBe('brainsnn.proof_mission_runtime.v2');
    expect(a.runIdentity.sha256).toBe(b.runIdentity.sha256);
    expect(a.runIdentity.algorithm).toBe(b.runIdentity.algorithm);
  });
});
