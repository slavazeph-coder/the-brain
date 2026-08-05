import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine } from './powderEngine.ts';
import { Material } from './materials.ts';
import {
  MAX_SHARE_LENGTH,
  SHARE_PARAM,
  STORAGE_KEY,
  applyDecodedGrid,
  buildShareUrl,
  decodeGrid,
  encodeGrid,
  hasLocalSave,
  loadLocal,
  loadShareString,
  readShareParam,
  saveLocal,
  type StorageLike,
} from './share.ts';

function memoryStore(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

function small() {
  return new PowderEngine({ width: 16, height: 8, seed: 'share' });
}

describe('share encoding', () => {
  it('round-trips an empty grid', () => {
    const engine = small();
    const other = small();
    expect(loadShareString(other, encodeGrid(engine))).toBe(true);
    expect(other.countNonEmpty()).toBe(0);
  });

  it('round-trips every material', () => {
    const engine = small();
    const kinds = [
      Material.SAND, Material.WATER, Material.WALL, Material.FIRE, Material.PLANT,
      Material.OIL, Material.GAS, Material.ACID, Material.LAVA, Material.NEURO,
      Material.SYNAPSE, Material.DOPAMINE, Material.INHIB, Material.STEAM,
      Material.ROCK, Material.GLASS,
    ];
    kinds.forEach((kind, at) => engine.setCell(at, 0, kind));

    const restored = small();
    expect(loadShareString(restored, encodeGrid(engine))).toBe(true);
    kinds.forEach((kind, at) => expect(restored.getCell(at, 0)).toBe(kind));
  });

  it('restores synaptic weights, so a learned circuit shares as learned', () => {
    const engine = small();
    engine.setCell(2, 2, Material.SYNAPSE);
    engine.weight[engine.index(2, 2)] = 0.8;

    const restored = small();
    expect(loadShareString(restored, encodeGrid(engine))).toBe(true);
    // 26 buckets over 0..1, so the round trip is exact to about 0.02.
    expect(restored.weight[restored.index(2, 2)]).toBeCloseTo(0.8, 1);
  });

  it('omits the weight segment when there is nothing to learn', () => {
    const engine = small();
    engine.setCell(1, 1, Material.SAND);
    expect(encodeGrid(engine).split(':').length).toBe(3);
    engine.setCell(2, 1, Material.SYNAPSE);
    expect(encodeGrid(engine).split(':').length).toBe(4);
  });

  // The whole reason RLE was chosen over a dependency: a mostly-empty grid has
  // to produce a link a person can paste.
  it('keeps a full-size grid inside a pasteable length', () => {
    const engine = new PowderEngine({ seed: 'full' });
    for (let x = 0; x < engine.width; x += 1) {
      for (let y = 120; y < engine.height; y += 1) engine.setCell(x, y, Material.SAND);
    }
    const text = encodeGrid(engine);
    expect(text.length).toBeLessThan(MAX_SHARE_LENGTH);
    // Flat layers are the best case; assert it is genuinely compact, not merely
    // under the cap.
    expect(text.length).toBeLessThan(400);
  });

  it('survives a grid with no runs at all', () => {
    // Alternating cells are RLE's worst case; it must still be correct.
    const engine = small();
    for (let at = 0; at < engine.size; at += 1) {
      if (at % 2 === 0) engine.setCell(at % engine.width, (at / engine.width) | 0, Material.SAND);
    }
    const restored = small();
    expect(loadShareString(restored, encodeGrid(engine))).toBe(true);
    expect(restored.countOf(Material.SAND)).toBe(engine.countOf(Material.SAND));
  });
});

describe('share decoding rejects bad input', () => {
  // This string arrives from a URL a stranger controls, so every branch has to
  // return null rather than throw or half-load.
  const bad = [
    '', 'nonsense', 'p1', 'p1:16x8', 'p2:16x8:80A',
    'p1:16x8:80A:extra:more',
    'p1:0x0:1A',
    'p1:16x8:80', // trailing digits, truncated link
    'p1:16x8:A', // no length
    'p1:16x8:80A80A', // overruns the grid
    'p1:16x8:40A', // covers only half the grid
    'p1:16x8:80!', // illegal character
    'p1:99999x8:80A',
  ];

  for (const text of bad) {
    it(`rejects ${JSON.stringify(text)}`, () => {
      expect(decodeGrid(text)).toBe(null);
      expect(loadShareString(small(), text)).toBe(false);
    });
  }

  it('rejects a material id no build knows about', () => {
    // 'Z' is 25; the table stops at 16.
    expect(decodeGrid('p1:16x8:80Z')).toBe(null);
  });

  it('rejects a string longer than the cap without parsing it', () => {
    expect(decodeGrid(`p1:16x8:${'1A'.repeat(MAX_SHARE_LENGTH)}`)).toBe(null);
  });

  it('refuses to load a grid of the wrong size rather than cropping', () => {
    const grid = decodeGrid(encodeGrid(small()));
    expect(grid !== null).toBe(true);
    expect(applyDecodedGrid(new PowderEngine({ width: 32, height: 8 }), grid!)).toBe(false);
  });

  it('leaves the engine untouched when the string is rejected', () => {
    const engine = small();
    engine.setCell(3, 3, Material.WALL);
    expect(loadShareString(engine, 'p1:16x8:zz')).toBe(false);
    expect(engine.getCell(3, 3)).toBe(Material.WALL);
  });
});

describe('share urls', () => {
  it('puts the grid in a query parameter and reads it back', () => {
    const engine = small();
    engine.setCell(4, 4, Material.NEURO);
    const url = buildShareUrl(engine, 'https://brainsnn.com/lab');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/lab');

    const param = readShareParam(parsed.search);
    expect(param !== null).toBe(true);
    const restored = small();
    expect(loadShareString(restored, param!)).toBe(true);
    expect(restored.getCell(4, 4)).toBe(Material.NEURO);
  });

  it('replaces an existing grid parameter instead of appending a second', () => {
    const engine = small();
    const url = buildShareUrl(engine, `https://brainsnn.com/lab?${SHARE_PARAM}=stale&keep=1`);
    const parsed = new URL(url);
    expect(parsed.searchParams.getAll(SHARE_PARAM).length).toBe(1);
    expect(parsed.searchParams.get('keep')).toBe('1');
  });

  it('returns null when there is no grid parameter', () => {
    expect(readShareParam('?other=1')).toBe(null);
    expect(readShareParam('')).toBe(null);
  });
});

describe('local saves', () => {
  it('saves and restores a grid through one slot', () => {
    const store = memoryStore();
    const engine = small();
    engine.setCell(5, 5, Material.LAVA);

    expect(hasLocalSave(store)).toBe(false);
    expect(saveLocal(engine, store)).toBe(true);
    expect(store.map.has(STORAGE_KEY)).toBe(true);
    expect(hasLocalSave(store)).toBe(true);

    const restored = small();
    expect(loadLocal(restored, store)).toBe(true);
    expect(restored.getCell(5, 5)).toBe(Material.LAVA);
  });

  it('reports failure rather than throwing when storage refuses', () => {
    // Safari in private mode throws on write; a full quota does too. Losing a
    // drawing is not worth taking the page down.
    const hostile: StorageLike = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('quota'); },
      removeItem() { throw new Error('denied'); },
    };
    expect(saveLocal(small(), hostile)).toBe(false);
    expect(loadLocal(small(), hostile)).toBe(false);
    expect(hasLocalSave(hostile)).toBe(false);
  });

  it('reports failure when there is no storage at all', () => {
    expect(saveLocal(small(), null)).toBe(false);
    expect(loadLocal(small(), null)).toBe(false);
    expect(hasLocalSave(null)).toBe(false);
  });

  it('does not restore a corrupted slot', () => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, 'p1:16x8:garbage');
    const engine = small();
    engine.setCell(1, 1, Material.WALL);
    expect(loadLocal(engine, store)).toBe(false);
    expect(engine.getCell(1, 1)).toBe(Material.WALL);
  });
});
