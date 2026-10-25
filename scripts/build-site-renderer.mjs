// This bundle belongs only to the standalone Arena. It never enters the home
// page's Vite graph and is requested only after the Site Test view opens.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  absWorkingDir: root,
  entryPoints: ['src/arena/site-renderer.js'],
  outfile: 'public/arena/site-renderer.js',
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'eof',
  logLevel: 'warning',
});
