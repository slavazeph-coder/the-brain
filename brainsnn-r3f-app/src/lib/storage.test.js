import { beforeEach, describe, expect, it } from '../test/tinyVitest.js';
import { analyzeContentLocally } from './analysisEngine.js';
import { MEMORY_KEY, loadMemory, makeMemoryRecord, saveMemory } from './storage.js';

describe('localStorage memory migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads old array-shaped memory safely', () => {
    const result = analyzeContentLocally({ content: 'Customer proof makes this announcement easier to trust.' });
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify([{ id: result.id, result }]));
    const items = loadMemory();
    expect(items).toHaveLength(1);
    expect(items[0].versions).toHaveLength(1);
    expect(items[0].keyScores.trust).toBeGreaterThan(0);
  });

  it('adds and deletes history records through storage helpers', () => {
    const result = analyzeContentLocally({ content: 'A clear hook with proof and a simple next action.' });
    const saved = saveMemory([makeMemoryRecord(result)]);
    expect(saved).toHaveLength(1);
    const cleared = saveMemory(saved.filter((item) => item.id !== result.id));
    expect(cleared).toHaveLength(0);
    expect(loadMemory()).toHaveLength(0);
  });

  it('does not duplicate the canonical dense result in the original version', () => {
    const result = analyzeContentLocally({ content: 'A short creative with a deterministic response timeline.' });
    result.neural = {
      schemaVersion: 'brainsnn.neural-prediction.v1',
      timeline: [{ startMs: 0, endMs: 1500, activations: Array.from({ length: 1000 }, (_, index) => index / 1000) }],
    };
    const [saved] = saveMemory([makeMemoryRecord(result)]);
    expect(saved.result.neural.timeline[0].activations).toHaveLength(1000);
    expect(saved.versions[0].result).toBe(undefined);
  });

  it('does not throw when browser persistence rejects a write', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('quota'); };
    const result = analyzeContentLocally({ content: 'Persistence failure must not interrupt a scan.' });
    expect(saveMemory([makeMemoryRecord(result)])).toEqual([]);
    window.localStorage.setItem = original;
  });
});
