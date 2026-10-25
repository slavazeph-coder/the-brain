// Reuse the same pure pricing model in the standalone Arena and the main app.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  absWorkingDir: root,
  entryPoints: ['src/arena/pricing-preview.js'],
  outfile: 'public/arena/arena-pricing.js',
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'eof',
  logLevel: 'warning',
});
