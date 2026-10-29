// Bisect harness: run a slice of the worker-client suite in a fresh process.
// Usage: node scripts/bisect-worker-client.mjs <startIdx> <endIdx>
// Indexes are 0-based over the top-level test() blocks in order of appearance.
// Running a slice alone isolates each test from any state leaked by earlier
// tests (timers, rejections, microtask residue). If a slice that includes the
// failing test passes, the poison comes from a test before startIdx.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
// Accept either "start end" or an explicit comma list "1,3,5,9" (plus any
// trailing "N" blocks). If the first arg contains a comma it's a list.
let start, end;
if (args[0]?.includes(',')) {
  const list = args[0].split(',').map(Number);
  start = Math.min(...list); end = Math.max(...list) + 1;
} else {
  start = Number.isInteger(Number(args[0])) ? Number(args[0]) : 0;
  end = Number.isInteger(Number(args[1])) ? Number(args[1]) : 1000;
}

const testFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'world', 'worker-client.test.mjs');
const lines = readFileSync(testFile, 'utf8').split('\n');

// Identify top-level test block starts: lines matching /^test\(/.
const starts = [];
lines.forEach((l, i) => { if(/^test\(/.test(l)) starts.push(i); });
console.error(`found ${starts.length} top-level test blocks at lines ${starts.join(', ')}`);

const header = lines.slice(0, starts[0]).join('\n');
const endLine = end < starts.length ? starts[end] : lines.length;
const body = lines.slice(starts[start], endLine).join('\n');
const patched = header + '\n' + body + '\n';
const tmp = join(process.cwd(), 'tests', 'world', `__bisect_${process.pid}.test.mjs`);
writeFileSync(tmp, patched);

const child = spawn(process.execPath, ['--test', tmp], {stdio: 'inherit', env: process.env});
const code = await new Promise(r => child.on('exit', r));
unlinkSync(tmp);
process.exit(code);
