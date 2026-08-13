// Sharing a grid without a compression dependency.
//
// A powder grid is overwhelmingly long runs of the same material — mostly AIR —
// so plain run-length encoding beats anything general-purpose here, and costs
// nothing at install time. The encoding is deliberately readable: you can look
// at a share string and see it is runs, which matters when someone reports a
// link that will not load.
//
// FORMAT
//
//   p1:240x160:<material runs>[:<weight runs>]
//
// A run is a base36 length followed by one uppercase letter, and the letter is
// what terminates it — `A` is 0, `Z` is 25. Lengths are lowercase base36, so
// the two alphabets never collide and the parser needs no delimiter:
//
//   "1eB2aA" -> 50 cells of material 1, then 82 cells of material 0
//
// Weights are the same shape, quantised to 26 buckets over 0..1. That is a
// resolution of 0.04, which is well inside what the brightness ramp can show.
import { PowderEngine, DEFAULT_HEIGHT, DEFAULT_WIDTH } from './powderEngine.ts';
import { Material, MATERIAL_COUNT } from './materials.ts';

export const SHARE_VERSION = 'p1';
export const WEIGHT_BUCKETS = 26;
/** Links much longer than this get mangled by chat clients that "helpfully" wrap. */
export const MAX_SHARE_LENGTH = 12_000;

const LETTER_A = 'A'.charCodeAt(0);

function encodeRuns(values: ArrayLike<number>, length: number): string {
  let out = '';
  let runValue = values[0];
  let runLength = 0;
  for (let at = 0; at < length; at += 1) {
    const value = values[at];
    if (value === runValue) {
      runLength += 1;
      continue;
    }
    out += runLength.toString(36) + String.fromCharCode(LETTER_A + runValue);
    runValue = value;
    runLength = 1;
  }
  if (runLength > 0) out += runLength.toString(36) + String.fromCharCode(LETTER_A + runValue);
  return out;
}

/**
 * Expands runs into `sink`. Returns how many cells were written, or -1 if the
 * text is malformed — callers treat -1 as "not a share string", never as an
 * exception, because this input arrives from a URL a stranger typed.
 */
function decodeRuns(text: string, sink: (at: number, value: number) => void, capacity: number): number {
  let at = 0;
  let digits = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch >= 'A' && ch <= 'Z') {
      if (digits === '') return -1;
      const runLength = Number.parseInt(digits, 36);
      if (!Number.isFinite(runLength) || runLength < 0) return -1;
      const value = ch.charCodeAt(0) - LETTER_A;
      if (at + runLength > capacity) return -1;
      for (let n = 0; n < runLength; n += 1) sink(at + n, value);
      at += runLength;
      digits = '';
      continue;
    }
    if ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z')) {
      digits += ch;
      continue;
    }
    return -1;
  }
  // Trailing digits with no terminating letter means the string was truncated.
  return digits === '' ? at : -1;
}

function quantiseWeight(weight: number): number {
  const clamped = weight < 0 ? 0 : weight > 1 ? 1 : weight;
  const bucket = Math.round(clamped * (WEIGHT_BUCKETS - 1));
  return bucket;
}

function dequantiseWeight(bucket: number): number {
  return bucket / (WEIGHT_BUCKETS - 1);
}

/** Serialises materials, plus synaptic weights when any synapse is above the floor. */
export function encodeGrid(engine: PowderEngine): string {
  const materials = new Uint8Array(engine.size);
  const weights = new Uint8Array(engine.size);
  let anySynapse = false;
  for (let at = 0; at < engine.size; at += 1) {
    const kind = engine.cells[at] & 0x1f;
    materials[at] = kind;
    if (kind === Material.SYNAPSE) {
      anySynapse = true;
      weights[at] = quantiseWeight(engine.weight[at]);
    }
  }
  const head = `${SHARE_VERSION}:${engine.width}x${engine.height}:${encodeRuns(materials, engine.size)}`;
  // A grid with no synapses carries no weight segment at all, which keeps the
  // common "I drew a volcano" link short.
  return anySynapse ? `${head}:${encodeRuns(weights, engine.size)}` : head;
}

export interface DecodedGrid {
  width: number;
  height: number;
  materials: Uint8Array;
  weights: Uint8Array | null;
}

/** Parses a share string. Returns null for anything it does not fully understand. */
export function decodeGrid(text: string): DecodedGrid | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_SHARE_LENGTH) return null;
  const parts = text.split(':');
  if (parts.length < 3 || parts.length > 4) return null;
  if (parts[0] !== SHARE_VERSION) return null;

  const dimensions = /^(\d{1,4})x(\d{1,4})$/.exec(parts[1]);
  if (!dimensions) return null;
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  if (width < 1 || height < 1 || width > DEFAULT_WIDTH * 4 || height > DEFAULT_HEIGHT * 4) return null;
  const size = width * height;

  const materials = new Uint8Array(size);
  let unknownMaterial = false;
  const written = decodeRuns(parts[2], (at, value) => {
    if (value >= MATERIAL_COUNT) unknownMaterial = true;
    materials[at] = value;
  }, size);
  // A short grid is a truncated link, not a small drawing — runs always cover
  // every cell, including the AIR.
  if (written !== size || unknownMaterial) return null;

  let weights: Uint8Array | null = null;
  if (parts.length === 4) {
    const buckets = new Uint8Array(size);
    const count = decodeRuns(parts[3], (at, value) => { buckets[at] = value; }, size);
    if (count !== size) return null;
    weights = buckets;
  }

  return { width, height, materials, weights };
}

/**
 * Loads a decoded grid into an engine. Dimensions must match — this refuses to
 * silently crop or centre, because a link that half-loads looks like a bug in
 * the simulation rather than a bad link.
 */
export function applyDecodedGrid(engine: PowderEngine, grid: DecodedGrid): boolean {
  if (grid.width !== engine.width || grid.height !== engine.height) return false;
  engine.clear();
  for (let at = 0; at < engine.size; at += 1) {
    const material = grid.materials[at] as Material;
    if (material === Material.AIR) continue;
    engine.setCell(at % engine.width, (at / engine.width) | 0, material);
  }
  if (grid.weights) {
    for (let at = 0; at < engine.size; at += 1) {
      if ((engine.cells[at] & 0x1f) !== Material.SYNAPSE) continue;
      engine.weight[at] = dequantiseWeight(grid.weights[at]);
    }
  }
  return true;
}

/** Round trip in one call, for callers that only care whether it worked. */
export function loadShareString(engine: PowderEngine, text: string): boolean {
  const grid = decodeGrid(text);
  return grid ? applyDecodedGrid(engine, grid) : false;
}

export const SHARE_PARAM = 'grid';

/**
 * Marks a visit as having arrived through a shared circuit.
 *
 * Sharing is this product's only organic growth loop, and until this existed
 * every visit it produced was indistinguishable from someone typing the URL —
 * so the loop could not be told apart from no loop at all. Read by
 * src/lib/attribution.js.
 */
export const SOURCE_PARAM = 's';
export const SOURCE_VALUE = 'lab';

export function buildShareUrl(engine: PowderEngine, base: string): string {
  const url = new URL(base);
  url.hash = '';
  url.searchParams.set(SHARE_PARAM, encodeGrid(engine));
  url.searchParams.set(SOURCE_PARAM, SOURCE_VALUE);
  return url.toString();
}

export function readShareParam(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get(SHARE_PARAM);
}

// --- Local saves ------------------------------------------------------------
//
// One slot, deliberately. Storage access is wrapped because Safari in private
// mode throws on `localStorage` rather than returning null, and losing a drawing
// is not worth crashing a render for.

export const STORAGE_KEY = 'brainsnn.powder.slot';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveLocal(engine: PowderEngine, store: StorageLike | null = storage()): boolean {
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, encodeGrid(engine));
    return true;
  } catch {
    // Quota, or a browser that refuses writes. The drawing is still on screen.
    return false;
  }
}

export function loadLocal(engine: PowderEngine, store: StorageLike | null = storage()): boolean {
  if (!store) return false;
  let text: string | null = null;
  try {
    text = store.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  return text ? loadShareString(engine, text) : false;
}

export function hasLocalSave(store: StorageLike | null = storage()): boolean {
  if (!store) return false;
  try {
    return store.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
