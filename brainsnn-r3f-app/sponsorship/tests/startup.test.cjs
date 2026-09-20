'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const railway = read('railway.toml').match(/^startCommand\s*=\s*"([^"]+)"\s*$/m)?.[1];
const docker = read('Dockerfile').match(/^CMD\s+(\[[^\n]+\])\s*$/m)?.[1];
const npm = JSON.parse(read('package.json')).scripts.start;
const required = ['--require', './brand-brain-preload.cjs', '--require', './mission-market-preload.cjs', '--require', './sponsorship/server.cjs'];
const expected = ['node', ...required, 'dist/server.cjs'];

test('Railway uses the complete production route chain, not only the old homepage', () => {
  assert.ok(railway, 'railway.toml must declare a startCommand.');
  assert.deepEqual(railway.trim().split(/\s+/), expected);
});

test('Docker CMD and Railway startCommand stay aligned', () => {
  assert.ok(docker, 'Dockerfile must declare an exec-form CMD.');
  assert.deepEqual(JSON.parse(docker), expected);
});

test('npm start preserves schema bootstrap and all production preloads', () => {
  assert.match(npm, /^node mission-market-schema-bootstrap\.cjs\s*&&\s*/);
  assert.deepEqual(npm.split('&&').at(-1).trim().split(/\s+/), expected);
});

test('every required production preload is a real source file', () => {
  for (const file of required.filter(value => value !== '--require')) {
    assert.ok(fs.statSync(path.resolve(root, file)).isFile(), `Missing preload: ${file}`);
  }
});
