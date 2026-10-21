// The Reachy Mini viewer is requested only by the motion workspace. Keep it
// outside the homepage/Arcade bundle, self-hosted, pinned and reproducible.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/arena/motion');
const three = JSON.parse(await readFile(resolve(root, 'node_modules/three/package.json'), 'utf8'));
const urdf = JSON.parse(await readFile(resolve(root, 'node_modules/urdf-loader/package.json'), 'utf8'));
if (urdf.version !== '0.12.3') throw new Error('Qualify the changed URDF loader before publishing it.');

// GLTFLoader decodes the Draco-compressed meshes with the decoder that ships with three.
const draco = resolve(root, 'node_modules/three/examples/jsm/libs/draco/gltf');
await mkdir(resolve(output, 'robot/draco'), { recursive: true });
for (const filename of ['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js']) {
  await copyFile(resolve(draco, filename), resolve(output, 'robot/draco', filename));
}

await build({
  absWorkingDir: root,
  entryPoints: ['src/arena/motion-renderer.js'],
  outfile: 'public/arena/motion/renderer.js',
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'eof',
  logLevel: 'warning',
});

const meshes = (await readdir(resolve(output, 'robot/meshes_optimized'))).filter((name) => name.endsWith('.glb')).sort()
  .map((name) => 'robot/meshes_optimized/' + name);
const files = ['renderer.js', 'app.js', 'examples.json', 'robot/reachy-mini.urdf',
  'robot/draco/draco_decoder.wasm', 'robot/draco/draco_wasm_wrapper.js', 'robot/draco/draco_decoder.js', ...meshes];
const assets = [];
for (const filename of files) {
  const bytes = await readFile(resolve(output, filename));
  assets.push({ path: filename, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(resolve(output, 'runtime-manifest.json'), JSON.stringify({
  schema: 'brainsnn.motion.runtime.v1',
  build: 'reachy-motion-2026-10-21-v1',
  viewer: { three: three.version, urdfLoader: urdf.version, execution: 'kinematic playback in the browser', license: 'Apache-2.0' },
  upstream: {
    source: 'https://github.com/pham-tuan-binh/reachy-motion-generator',
    commit: '96497d69a31cc89da209f224bd9c1fee1834b864',
    model: 'https://huggingface.co/spaces/8bitkick/reachy_mini_3d_web_viz',
  },
  assets,
}, null, 2) + '\n');
