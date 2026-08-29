import { describe, expect, it } from '../../test/tinyVitest.js';
import { DEFAULT_MISSION_DRAFT, runBuiltMission } from './missionBuilder.js';
import { buildMissionProofPack } from './missionRuntime.js';

describe('mission ProofPack reproducibility', () => {
  it('regenerates the same run and artifact hashes when the original timestamp is pinned', async () => {
    const result = runBuiltMission({ ...DEFAULT_MISSION_DRAFT, seed: 260829 });
    const createdAt = '2026-08-29T21:00:00.000Z';
    const a = await buildMissionProofPack(result, null, createdAt);
    const b = await buildMissionProofPack(result, null, createdAt);

    expect(a.createdAt).toBe(createdAt);
    expect(b.createdAt).toBe(createdAt);
    expect(a.runIdentity).toEqual(b.runIdentity);
    expect(a.evidence).toEqual(b.evidence);
    expect(a.evidence.sha256).toBeTruthy();
  });

  it('keeps run identity stable even when artifact creation times differ', async () => {
    const result = runBuiltMission({ ...DEFAULT_MISSION_DRAFT, seed: 260829 });
    const a = await buildMissionProofPack(result, null, '2026-08-29T21:00:00.000Z');
    const b = await buildMissionProofPack(result, null, '2026-08-29T21:00:01.000Z');

    expect(a.runIdentity).toEqual(b.runIdentity);
    expect(a.evidence.sha256 === b.evidence.sha256).toBe(false);
  });
});
