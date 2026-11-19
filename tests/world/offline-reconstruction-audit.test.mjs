import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../../brainsnn-r3f-app/public/world/',import.meta.url);
test('the installed World Builder shell precaches every reconstruction audit import',()=>{
  const app=readFileSync(new URL('app.mjs',root),'utf8');
  const sw=readFileSync(new URL('sw.js',root),'utf8');
  const imported=[...app.matchAll(/from ['"]\.\/((?:reconstruction-|surface-review)[^'"]*\.mjs)['"]/g)].map(match=>match[1]);
  assert.ok(imported.includes('reconstruction-frame-audit.mjs'),'Expected frame audit in app import graph');
  for(const name of imported)assert.ok(sw.includes(`'./${name}'`),`Missing offline shell asset: ${name}`);
  assert.match(sw,/world-shell-robot-camera-v33/,'Changes to precache need a new cache version');
  for(const name of ['facility-review.mjs','facility-review-ui.mjs','facility-review.css','playground-help.mjs','playground-icons.mjs','playground-controls.mjs','robot-setup.mjs','world-layer-tools.mjs','world-layer-tools.css','layer-preview.mjs','layer-job-client.mjs','biomechanics-preview.mjs','biomechanics-tool.mjs', 'camera-calibration-tool.mjs', 'camera-calibration-data.mjs', 'examples/camera-calibration/camera-setup.toml', 'examples/camera-calibration/example-walk.trc','examples/biomechanics/authored-pendulum.osim','examples/biomechanics/authored-motion.mot','examples/biomechanics/kinematics-options.json'])assert.ok(sw.includes(`'./${name}'`),`${name} is part of the linked review shell`);
});
