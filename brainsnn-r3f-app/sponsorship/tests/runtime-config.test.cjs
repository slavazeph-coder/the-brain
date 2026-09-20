'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('Railway effective start command matches the tested Docker runtime', () => {
  const toml = fs.readFileSync(path.join(root, 'railway.toml'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const railwayCommand = toml.match(/^startCommand\s*=\s*"([^"]+)"/m)?.[1];
  const dockerCommand = JSON.parse(docker.match(/^CMD\s+(\[[^\n]+\])/m)?.[1] || '[]');
  assert.ok(railwayCommand, 'Railway startCommand must be explicit.');
  assert.deepEqual(railwayCommand.trim().split(/\s+/), dockerCommand,
    'railway.toml overrides Docker CMD and must contain every tested preload.');
  for (const module of ['brand-brain-preload.cjs', 'mission-market-preload.cjs', 'sponsorship/server.cjs']) {
    assert.ok(railwayCommand.includes('--require ./' + module), 'Missing middleware: ' + module);
    assert.ok(fs.existsSync(path.join(root, module)), 'Missing preload file: ' + module);
  }
  assert.ok(railwayCommand.endsWith('dist/server.cjs'));
});
