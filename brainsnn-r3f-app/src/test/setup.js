// Vitest global setup: register jest-dom matchers and auto-clean the DOM
// between tests so renders don't leak into one another.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

function createMemoryStorage() {
  const store = new Map();
  return {
    clear: () => store.clear(),
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    key: (index) => Array.from(store.keys())[index] || null,
    removeItem: (key) => store.delete(String(key)),
    setItem: (key, value) => store.set(String(key), String(value)),
    get length() {
      return store.size;
    },
  };
}

const testStorage = createMemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  value: testStorage,
  configurable: true,
});
if (globalThis.window) {
  Object.defineProperty(globalThis.window, "localStorage", {
    value: testStorage,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
});
