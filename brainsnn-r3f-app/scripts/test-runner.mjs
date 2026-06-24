import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tests, runBeforeEach } from '../src/test/tinyVitest.js';

const localStorageData = new Map();
globalThis.window = {
  localStorage: {
    clear: () => localStorageData.clear(),
    getItem: (key) => localStorageData.get(key) || null,
    removeItem: (key) => localStorageData.delete(key),
    setItem: (key, value) => localStorageData.set(key, String(value)),
  },
};
globalThis.localStorage = globalThis.window.localStorage;

const files = execFileSync('find', ['src', '-name', '*.test.js', '-o', '-name', '*.test.jsx'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean)
  .sort();

for (const file of files) {
  await import(pathToFileURL(`${process.cwd()}/${file}`).href);
}

let failures = 0;
for (const test of tests) {
  try {
    await runBeforeEach();
    await test.fn();
    console.log(`✓ ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${test.name}`);
    console.error(error?.stack || error);
  }
}

if (failures) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}

console.log(`${tests.length} test(s) passed`);
