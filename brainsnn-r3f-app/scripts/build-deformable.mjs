// Arena and World Builder robot tasks share the same on-demand physics runtime. Keep it
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
if (info.version !== '4.0.1') throw new Error('Qualify the changed MuJoCo runtime before publishing it.');
await mkdir(resolve(output, 'vendor'), { recursive: true });
for (const filename of ['mujoco.js', 'mujoco.wasm']) {
  await copyFile(resolve(engine, filename), resolve(output, 'vendor', filename));
}
await copyFile(resolve(root, 'vendor-licenses/mujoco-LICENSE.txt'), resolve(output, 'vendor/LICENSE.txt'));

// Task exports use the store-only ZIP path for the original reference media.
const taskVendor = resolve(root, 'public/world/vendor');
await mkdir(taskVendor, { recursive: true });
await build({
  absWorkingDir: root,
  stdin: { contents: "export { zipSync } from 'fflate';", resolveDir: root },
  outfile: resolve(taskVendor, 'robot-task-zip.mjs'),
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  bundle: true,
  minify: true,
  banner: { js: '/*! fflate\n' + await readFile(resolve(root, 'node_modules/fflate/LICENSE'), 'utf8') + '*/' },
});

await build({
  absWorkingDir: root,
  entryPoints: ['src/world/robot-task-3d.js'],
  outfile: resolve(taskVendor, 'robot-task-3d.mjs'),
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  bundle: true,
  minify: true,
  banner: { js: '/*! Three.js\n' + await readFile(resolve(root, 'node_modules/three/LICENSE'), 'utf8') + '*/' },
});

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
    engine: { name: 'MuJoCo', version: info.version, execution: 'single-threaded WebAssembly', license: 'Apache-2.0', source: 'https://github.com/google-deepmind/mujoco/tree/4.0.1' },
    assets,
  }, null, 2) + '\n');
}
