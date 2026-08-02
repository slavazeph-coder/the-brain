// Guards the three.js code split.
//
// three + @react-three total ~926 KB raw / ~250 KB gzipped. That is affordable
// for a lab someone chose to open and completely unaffordable on first paint of
// the landing page, so vite.config.ts routes it into a `vendor-three` chunk that
// only loads when a 3D module is dynamically imported.
//
// That arrangement is easy to break by accident: a single static import of
// `three` (or of a module that imports it) from anything reachable at startup
// pulls the whole chunk into the entry graph, and nothing about the build fails
// — the site just gets a quarter-megabyte heavier. This script makes that
// failure loud.
//
// Two checks:
//   1. Source-level — only files on an allowlist may mention three at all, and
//      every one of them must be reached exclusively through React.lazy /
//      dynamic import.
//   2. Build-level (when dist/ exists) — the entry chunk must not contain
//      three, and vendor-three must still be its own file.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

// Modules permitted to import three. Keep this list short and deliberate: each
// entry must be loaded only via a dynamic import somewhere up its chain.
const THREE_IMPORTERS = new Set([
  'src/features/brain3d/BrainScene.jsx',
]);

const THREE_IMPORT = /from\s+['"](three|@react-three\/[a-z-]+)['"]|import\s*\(\s*['"](three|@react-three\/[a-z-]+)['"]/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

const problems = [];

// --- 1. Source check -------------------------------------------------------
const files = walk(SRC);
const offenders = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (!THREE_IMPORT.test(readFileSync(file, 'utf8'))) continue;
  if (!THREE_IMPORTERS.has(rel)) offenders.push(rel);
}
if (offenders.length) {
  problems.push(
    `${offenders.length} file(s) import three but are not on the allowlist:\n`
    + offenders.map((file) => `    ${file}`).join('\n')
    + '\n  Either load it via React.lazy and add it to THREE_IMPORTERS in this'
    + ' script, or stop importing three there.',
  );
}

// Every allowlisted module must be dynamically imported, never statically.
for (const importer of THREE_IMPORTERS) {
  const base = importer.split('/').pop();
  const staticImporters = files.filter((file) => {
    const rel = relative(ROOT, file);
    if (rel === importer) return false;
    const source = readFileSync(file, 'utf8');
    // A static `import ... from './BrainScene.jsx'` with no lazy() around it.
    return new RegExp(`^\\s*import[^\\n]*['"][^'"]*${base.replace('.', '\\.')}['"]`, 'm').test(source);
  }).map((file) => relative(ROOT, file));
  if (staticImporters.length) {
    problems.push(
      `${importer} is statically imported by:\n`
      + staticImporters.map((file) => `    ${file}`).join('\n')
      + '\n  This defeats the code split — use React.lazy(() => import(...)).',
    );
  }
}

// --- 2. Build check --------------------------------------------------------
const assets = join(ROOT, 'dist', 'assets');
if (existsSync(assets)) {
  const built = readdirSync(assets);
  const entry = built.find((file) => /^index-.*\.js$/.test(file));
  const vendorThree = built.find((file) => /^vendor-three-.*\.js$/.test(file));

  if (!vendorThree) {
    problems.push('No vendor-three chunk in dist/assets — the manualChunks split is not being applied.');
  }
  if (entry) {
    const source = readFileSync(join(assets, entry), 'utf8');
    // three's build banner is the cheapest reliable fingerprint.
    if (/THREE\.WebGLRenderer|three\.module\.js|WebGLRenderer:/.test(source)) {
      problems.push(`three appears to be inlined into the entry chunk (${entry}). The landing page would pay for it on first paint.`);
    }
  }
}

if (problems.length) {
  console.error('\nthree.js code-split guard FAILED:\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(`three.js code-split guard passed (${THREE_IMPORTERS.size} allowlisted importer(s)).`);
