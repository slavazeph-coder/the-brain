import { isDeepStrictEqual } from 'node:util';

export const tests = [];
const beforeEachFns = [];
const stubs = new Map();

export function describe(_name, fn) {
  fn();
}

export function it(name, fn) {
  tests.push({ name, fn });
}

export function beforeEach(fn) {
  beforeEachFns.push(fn);
}

export async function runBeforeEach() {
  for (const fn of beforeEachFns) {
    await fn();
  }
}

function fail(message) {
  throw new Error(message);
}

function textOf(value) {
  return value?.textContent || '';
}

function makeMatchers(received, negate = false) {
  function assert(pass, message) {
    if (negate ? pass : !pass) fail(message);
  }
  return {
    get not() {
      return makeMatchers(received, !negate);
    },
    toBe(expected) {
      assert(Object.is(received, expected), `Expected ${received} to be ${expected}`);
    },
    toEqual(expected) {
      assert(isDeepStrictEqual(received, expected), `Expected ${JSON.stringify(received)} to equal ${JSON.stringify(expected)}`);
    },
    toContain(expected) {
      assert(received?.includes?.(expected), `Expected ${received} to contain ${expected}`);
    },
    toMatch(expected) {
      assert(expected.test(String(received)), `Expected ${received} to match ${expected}`);
    },
    toHaveLength(expected) {
      assert(received?.length === expected, `Expected length ${received?.length} to be ${expected}`);
    },
    toBeGreaterThan(expected) {
      assert(received > expected, `Expected ${received} to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      assert(received >= expected, `Expected ${received} to be greater than or equal to ${expected}`);
    },
    toBeLessThanOrEqual(expected) {
      assert(received <= expected, `Expected ${received} to be less than or equal to ${expected}`);
    },
    toBeInTheDocument() {
      assert(Boolean(received && received.ownerDocument?.contains(received)), 'Expected element to be in the document');
    },
    toHaveTextContent(expected) {
      const text = textOf(received);
      const pass = expected instanceof RegExp ? expected.test(text) : text.includes(String(expected));
      assert(pass, `Expected text "${text}" to contain ${expected}`);
    },
    toHaveValue(expected) {
      assert(received?.value === expected, `Expected value "${received?.value}" to be "${expected}"`);
    },
    toHaveBeenCalledTimes(expected) {
      assert(received?.mock?.calls?.length === expected, `Expected mock to be called ${expected} times, got ${received?.mock?.calls?.length}`);
    },
  };
}

export function expect(received) {
  return makeMatchers(received);
}

export const vi = {
  fn(implementation = () => undefined) {
    const mock = (...args) => {
      mock.mock.calls.push(args);
      return implementation(...args);
    };
    mock.mock = { calls: [] };
    return mock;
  },
  stubGlobal(name, value) {
    if (!stubs.has(name)) stubs.set(name, globalThis[name]);
    globalThis[name] = value;
  },
  restoreAllMocks() {
    for (const [name, value] of stubs.entries()) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
    stubs.clear();
  },
};
