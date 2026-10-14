'use strict';
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const name of readdirSync(path.join(root, 'dist')).filter(name => name.endsWith('.js'))) run(['--check', `dist/${name}`]);
for (const name of [
  'brainsnn-experiment-review.cjs', 'brainsnn-sensor-camera.cjs',
  'brainsnn-skill-connector.cjs', 'arena-runtime.test.cjs',
  'arena-integration-ui.cjs', 'arena-campaign-math.cjs', 'arena-campaign-flow.cjs', 'arena-game.test.cjs',
]) run([`tests/${name}`]);
console.log('ARENA_LOGIC_OK: selection, observations, session lifecycle, replay, campaign planning and Beat the bot.');
