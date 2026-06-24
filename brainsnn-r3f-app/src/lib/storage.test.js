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
});
