// Shared deterministic RNG helpers. FNV-1a seed + mulberry32, matching the
// implementations solitonLayer.js has used since the soliton field shipped, so
// anything seeded here is reproducible across runs, machines and processes.

export function seedFromText(text) {
  let hash = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience: a generator seeded from any value (text, number, or object).
export function createRng(seed) {
  if (typeof seed === 'function') return seed;
  const numeric = typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : seedFromText(seed);
  return mulberry32(numeric);
}
