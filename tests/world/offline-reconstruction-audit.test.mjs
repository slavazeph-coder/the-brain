import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../../brainsnn-r3f-app/public/world/',import.meta.url);
test('the installed World Builder shell precaches every reconstruction audit import',()=>{
  const app=readFileSync(new URL('app.mjs',root),'utf8');
  const sw=readFileSync(new URL('sw.js',root),'utf8');
  const imported=[...app.matchAll(/from ['"]\.\/(reconstruction-[^'"]+\.mjs)['"]/g)].map(match=>match[1]);
  assert.ok(imported.includes('reconstruction-frame-audit.mjs'),'Expected frame audit in app import graph');
  for(const name of imported)assert.ok(sw.includes(`'./${name}'`),`Missing offline shell asset: ${name}`);
  assert.match(sw,/world-shell-frame-audit-v19/,'Changes to precache need a new cache version');
});
