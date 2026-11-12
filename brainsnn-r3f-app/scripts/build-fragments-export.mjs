// The IFC-to-Fragments converter is requested only when someone asks for the Fragments file (for Unreal Engine through
// the FragmentsUnreal plugin, or any That Open viewer). Keep it out of the World Builder shell, self-hosted, pinned and
// reproducible: nothing here is committed, it is assembled from the lockfile.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/world/vendor');
const require = createRequire(import.meta.url);
const PINS = { '@thatopen/fragments': '3.6.1', 'web-ifc': '0.0.79' };
const webIfc = dirname(require.resolve('web-ifc'));
const versions = {
  '@thatopen/fragments': JSON.parse(await readFile(resolve(root, 'node_modules/@thatopen/fragments/package.json'), 'utf8')).version,
  'web-ifc': JSON.parse(await readFile(resolve(webIfc, 'package.json'), 'utf8')).version,
};
for (const [name, version] of Object.entries(PINS))
  if (versions[name] !== version) throw new Error(`Check that ${name} ${versions[name]} still converts and reads back scene.ifc before publishing it.`);

await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/world/fragments-export.js'],
  outfile: 'public/world/vendor/fragments-export.js',
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'eof',
  logLevel: 'warning',
});
await copyFile(resolve(webIfc, 'web-ifc.wasm'), resolve(output, 'web-ifc.wasm'));
const licences = [
  ['@thatopen/fragments ' + versions['@thatopen/fragments'] + ' (MIT) https://github.com/ThatOpen/engine_fragment', 'vendor-licenses/thatopen-fragments-LICENSE.txt'],
  ['web-ifc ' + versions['web-ifc'] + ' (MPL-2.0), unmodified; source at https://github.com/ThatOpen/engine_web-ifc', 'vendor-licenses/web-ifc-LICENSE.txt'],
];
let notice = 'fragments-export.js bundles the libraries below; web-ifc.wasm is web-ifc\'s own build, unmodified.\n';
for (const [heading, file] of licences) notice += `\n==== ${heading} ====\n\n${await readFile(resolve(root, file), 'utf8')}\n`;
await writeFile(resolve(output, 'LICENSES.txt'), notice);
const assets = [];
for (const filename of ['fragments-export.js', 'web-ifc.wasm', 'LICENSES.txt']) {
  const bytes = await readFile(resolve(output, filename));
  assets.push({ path: filename, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(resolve(output, 'fragments-manifest.json'), JSON.stringify({
  schema: 'brainsnn.fragments-export.runtime.v1',
  libraries: versions,
  format: 'That Open Fragments (.frag), as read by @thatopen/fragments 3.x and the FragmentsUnreal plugin',
  assets,
}, null, 2) + '\n');
