// Package the runtime and the pinned Apache-2.0 model on our origin. Only
// the build accesses the model provider; video frames stay in the browser.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = 'public/world/vendor/movenet-v4/';
const url = 'https://www.kaggle.com/api/v1/models/google/movenet/tfJs/singlepose-lightning/4/download';
const files = {
  'model.json': 'c65a3447162efa0c42af29498a4b151f4415b36ff3ae6fae2b28a32e840dcbfb',
  'group1-shard1of2.bin': 'b42c3232bf13b0efc691d3f0693dd3fc74404f709b1deee0a271828af6dbbea2',
  'group1-shard2of2.bin': '8253ab965aa3122c08f331777ca395ce9ca19bb9e7cb278b99de1c46dbdeb6dc',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(out, { recursive:true });
const checks = await Promise.all(Object.entries(files).map(async ([name, hash]) =>
  digest(await readFile(join(out, name)).catch(() => Buffer.alloc(0))) === hash));
if (!checks.every(Boolean)) {
  const temp = await mkdtemp(join(tmpdir(), 'brainsnn-pose-'));
  try {
    const response = await fetch(url, {signal:AbortSignal.timeout(120000)});
    if (!response.ok) throw new Error('MoveNet download failed: ' + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (digest(bytes) !== '28b9a96dde847d2c5dd0d44ddd131d6dfd388b8a014a4535dc31b4059ce61765') {
      throw new Error('MoveNet v4 archive checksum mismatch.');
    }
    const tarball = join(temp, 'weights.tgz');
    await writeFile(tarball, bytes);
    execFileSync('tar', ['-xzf', tarball, '-C', temp, ...Object.keys(files)]);
    for (const [name, hash] of Object.entries(files)) {
      if (digest(await readFile(join(temp, name))) !== hash) throw new Error('MoveNet checksum mismatch: ' + name);
      await copyFile(join(temp, name), join(out, name));
      await chmod(join(out, name), 0o644);
    }
  } finally { await rm(temp, {recursive:true, force:true}); }
}
const wasmDir = 'node_modules/@tensorflow/tfjs-backend-wasm/dist';
for (const file of ['tfjs-backend-wasm.wasm','tfjs-backend-wasm-simd.wasm','tfjs-backend-wasm-threaded-simd.wasm']) {
  await copyFile(join(wasmDir, file), join(out, file));
}
await copyFile('vendor-licenses/movenet-LICENSE.txt', join(out, 'LICENSE.txt'));
await build({entryPoints:['src/world/sit-to-stand-detector.mjs'], outfile:join(out,'detector.mjs'), bundle:true,
  format:'esm', platform:'browser', target:'es2020', minify:true, legalComments:'eof'});
