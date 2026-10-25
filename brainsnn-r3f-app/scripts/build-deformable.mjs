// The physics runtime is requested only by the rope-strike workspace. Keep it
// outside the homepage/Arcade bundle, self-hosted, pinned and reproducible.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/arena/deformable');
const engine = dirname(fileURLToPath(import.meta.resolve('@mujoco/mujoco')));
const info = JSON.parse(await readFile(resolve(engine, 'package.json'), 'utf8'));
if (info.version !== '3.16.0') throw new Error('Qualify the changed MuJoCo runtime before publishing it.');
await mkdir(resolve(output, 'vendor'), { recursive: true });
for (const filename of ['mujoco.js', 'mujoco.wasm']) {
  await copyFile(resolve(engine, filename), resolve(output, 'vendor', filename));
}
await copyFile(resolve(root, 'vendor-licenses/mujoco-LICENSE.txt'), resolve(output, 'vendor/LICENSE.txt'));

if (!process.argv.includes('--engine-only')) {
  await build({
    absWorkingDir: root,
    entryPoints: ['src/arena/deformable-renderer.js'],
    outfile: 'public/arena/deformable/renderer.js',
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    legalComments: 'eof',
    logLevel: 'warning',
  });
  const files = ['vendor/mujoco.js', 'vendor/mujoco.wasm', 'rope-physics.js', 'simulation-worker.js', 'journal.js', 'app.js', 'renderer.js'];
  const assets = [];
  for (const filename of files) {
    const bytes = await readFile(resolve(output, filename));
    assets.push({ path: filename, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(resolve(output, 'runtime-manifest.json'), JSON.stringify({
    schema: 'brainsnn.deformable.runtime.v1',
    build: 'deformable-physics-2026-10-17-v1',
    engine: { name: 'MuJoCo', version: info.version, execution: 'single-threaded WebAssembly', license: 'Apache-2.0', source: 'https://github.com/google-deepmind/mujoco/tree/3.16.0' },
    assets,
  }, null, 2) + '\n');
}
