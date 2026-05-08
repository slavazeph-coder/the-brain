/**
 * Tiny localStorage shim for Node test runs.
 *
 * Each module that imports this gets a fresh, in-memory store —
 * tests should reset it explicitly between cases via clear().
 */

class LocalStorageShim {
  constructor() { this.s = new Map(); }
  get length() { return this.s.size; }
  getItem(k) { return this.s.has(k) ? this.s.get(k) : null; }
  setItem(k, v) { this.s.set(k, String(v)); }
  removeItem(k) { this.s.delete(k); }
  clear() { this.s.clear(); }
  key(i) { return Array.from(this.s.keys())[i] || null; }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new LocalStorageShim();
}

export function resetLocalStorage() {
  globalThis.localStorage.clear();
}
