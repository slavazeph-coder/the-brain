/**
 * Fail on UNDEFINED IDENTIFIERS in the JS server modules.
 *
 * Why this exists: `node --check` validates syntax only, so a reference to a
 * variable that was never declared passes it happily and explodes at runtime on
 * whichever code path reaches it. That happened twice in one session
 * (`rawAmount`, then `delivered`) and took the whole suite red both times.
 *
 * `tsc --checkJs` does catch it (TS2304/TS2552), but turning checkJs on
 * wholesale also surfaces type noise from the untyped sqlite helpers, which
 * would need real work to adopt. So this runs checkJs and keeps ONLY the
 * undefined-name diagnostics, which are free of that noise.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk('src/server');
if (files.length === 0) {
  console.error('check-undef: no JS files found under src/server');
  process.exit(1);
}

const tsc = './node_modules/.bin/tsc';
const result = spawnSync(tsc, [
  '--noEmit', '--allowJs', '--checkJs',
  '--target', 'es2022', '--module', 'esnext',
  '--moduleResolution', 'bundler', '--skipLibCheck',
  ...files,
], { encoding: 'utf8' });

const output = `${result.stdout || ''}${result.stderr || ''}`;
// TS2304: Cannot find name 'x'.   TS2552: Cannot find name 'x'. Did you mean 'y'?
const undefinedNames = output
  .split('\n')
  .filter(line => /error TS(2304|2552)/.test(line));

if (undefinedNames.length > 0) {
  console.error('check-undef: UNDEFINED IDENTIFIERS - these throw at runtime:');
  for (const line of undefinedNames) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`check-undef: no undefined identifiers across ${files.length} file(s)`);
