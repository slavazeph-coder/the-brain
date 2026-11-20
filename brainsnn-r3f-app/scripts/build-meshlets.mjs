// r187 lives only in this optional, self-hosted lab. Existing R3F stays on r182.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'node_modules/three-meshlets');
const info = JSON.parse(await readFile(join(vendor, 'package.json'), 'utf8'));
if (info.version !== '0.187.0') throw new Error('Requalify a changed meshlets runtime.');
const output = resolve(root, 'public/lab/meshlets/runtime');
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root, entryPoints: ['src/lab/meshlets/renderer.js'],
  outdir: output, entryNames: 'renderer', bundle: true, splitting: true,
  format: 'esm', target: 'es2022', minify: true, legalComments: 'eof', metafile: true,
  plugins: [{ name: 'isolated-three-r187', setup(build) {
    build.onResolve({ filter: /^three(?:\/|$)/ }, ({ path }) => {
      const entry = { three: 'build/three.module.js', 'three/webgpu': 'build/three.webgpu.js', 'three/tsl': 'build/three.tsl.js' }[path];
      if (entry) return { path: join(vendor, entry) };
      if (path.startsWith('three/addons/')) return { path: join(vendor, 'examples/jsm', path.slice(13)) };
      throw new Error('Unqualified Three import: ' + path);
    });
  } }],
});
await copyFile(join(vendor, 'LICENSE'), join(output, 'THREE-LICENSE.txt'));
await copyFile(join(root, 'vendor-licenses/meshoptimizer-LICENSE.txt'), join(output, 'MESHOPTIMIZER-LICENSE.txt'));
const assets = [];
for (const path of Object.keys(result.metafile.outputs)) {
  const bytes = await readFile(resolve(root, path));
  assets.push({ path: path.split('/').pop(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify({
  schema: 'brainsnn.meshlets-runtime.v1', three: info.version, meshletTriangles: 64,
  source: 'https://github.com/mrdoob/three.js/tree/r187', license: 'MIT', assets,
}, null, 2) + '\n');
