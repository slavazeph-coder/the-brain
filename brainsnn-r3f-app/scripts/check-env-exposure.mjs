// Guards against shipping build-time environment variables to browsers.
//
// Vite replaces `import.meta.env.VITE_NAME` with that one value. Any other use of
// `import.meta.env` — optional chaining, indexing, spreading, passing the object
// around — makes it inline the entire env object instead, with every VITE_*
// variable present at build time. A server secret given a VITE_ prefix (for
// example VITE_GEMINI_API_KEY on the hosting service) would then be public.
//
// Two checks:
//   1. Source-level — every `import.meta.env` in src/ must be followed by
//      `.NAME` (a static read).
//   2. Build-level (when dist/ exists) — no client chunk may contain an inlined
//      env object with a VITE_ key.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SOURCE = /\.(?:[cm]?js|jsx|ts|tsx)$/;
const failures = [];

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== 'node_modules') walk(path, visit); }
    else visit(path);
  }
}

walk(join(ROOT, 'src'), (path) => {
  if (!SOURCE.test(path)) return;
  const text = readFileSync(path, 'utf8');
  const pattern = /import\.meta\.env(?!\.[A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split('\n').length;
    // Comments may name the object; only code counts.
    const source = text.split('\n')[line - 1];
    if (/^\s*(\/\/|\*|\/\*)/.test(source)) continue;
    failures.push(`${relative(ROOT, path)}:${line} reads import.meta.env dynamically; use import.meta.env.NAME`);
  }
});

const assets = join(ROOT, 'dist', 'assets');
if (existsSync(assets)) {
  for (const name of readdirSync(assets)) {
    if (!name.endsWith('.js')) continue;
    const text = readFileSync(join(assets, name), 'utf8');
    const leaked = [...text.matchAll(/\{BASE_URL:"[^"]*",[^}]*?\b(VITE_[A-Z0-9_]+):/g)].map((m) => m[1]);
    if (leaked.length) failures.push(`dist/assets/${name} inlines the env object with ${[...new Set(leaked)].join(', ')}`);
  }
}

if (failures.length) {
  console.error('Build-time environment exposure:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('env exposure guard passed.');
