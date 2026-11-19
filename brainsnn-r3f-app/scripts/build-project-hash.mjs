// Bundle the pinned incremental hash locally; large sources never need a CDN or
// a whole-file WebCrypto allocation. Keep the upstream MIT license with the asset.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = resolve(root, 'node_modules/@noble/hashes');
const license = await readFile(resolve(upstream, 'LICENSE'), 'utf8');
const { version } = JSON.parse(await readFile(resolve(upstream, 'package.json'), 'utf8'));
await build({
  absWorkingDir: root,
  stdin: { contents: "export { sha256 } from '@noble/hashes/sha2.js';", resolveDir: root, sourcefile: 'projects-hash-entry.mjs' },
  outfile: 'public/world/projects-sha256.mjs', bundle: true, format: 'esm',
  target: ['es2020'], minify: true, legalComments: 'eof', logLevel: 'warning',
  banner: { js: `/*! Incremental SHA-256: @noble/hashes ${version}\n${license.replaceAll('*/', '* /')}*/` },
});
