#!/usr/bin/env node
// Evaluate the scoring engine against an externally labelled corpus.
//
//   node scripts/eval-corpus.mjs datasets/persuasion.jsonl --dimension manipulationRisk
//
// Input is JSONL, one object per line:
//   { "id": "...", "text": "...", "labels": { "manipulationRisk": 1, "trust": 0 } }
// where each label is 0/1 (or true/false).
//
// Public corpora are NOT vendored into this repo — they carry their own
// licences. Fetch them into datasets/ (gitignored) and point this script at
// the converted JSONL. See docs/ANNOTATION_RUBRIC.md for the mapping from
// published technique taxonomies onto our dimensions.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The engine reads a localStorage shim in a couple of places.
globalThis.window = globalThis.window || {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
};
globalThis.localStorage = globalThis.window.localStorage;

const [, , file, ...rest] = process.argv;
if (!file) {
  console.error('usage: node scripts/eval-corpus.mjs <corpus.jsonl> [--dimension <name>] [--bins <n>]');
  process.exit(2);
}

function flag(name, fallback) {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 && rest[index + 1] ? rest[index + 1] : fallback;
}

const base = pathToFileURL(`${process.cwd()}/`);
const { scoreCorpusItem } = await import(new URL('src/lib/calibration.js', base));
const { evaluateBinary } = await import(new URL('src/lib/evalMetrics.js', base));

const rows = readFileSync(file, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      console.error(`skipping unparseable line ${index + 1}: ${error.message}`);
      return null;
    }
  })
  .filter((row) => row && typeof row.text === 'string' && row.labels);

if (!rows.length) {
  console.error('no usable rows found');
  process.exit(1);
}

const requested = flag('dimension', null);
const dimensions = requested
  ? [requested]
  : [...new Set(rows.flatMap((row) => Object.keys(row.labels)))];

const scored = rows.map((row) => ({ row, metrics: scoreCorpusItem({ content: row.text }) }));

const report = { corpus: file, items: rows.length, dimensions: {} };
for (const dimension of dimensions) {
  const usable = scored.filter(({ row }) => row.labels[dimension] != null);
  if (usable.length < 4) {
    report.dimensions[dimension] = { skipped: `only ${usable.length} labelled items` };
    continue;
  }
  const scores = usable.map(({ metrics }) => metrics[dimension] ?? 0);
  const labels = usable.map(({ row }) => (row.labels[dimension] ? 1 : 0));
  const result = evaluateBinary(scores, labels, { bins: Number(flag('bins', 10)) });
  // Keep the console summary readable; the table is in the JSON.
  report.dimensions[dimension] = result;
  console.log(
    `${dimension.padEnd(20)} n=${String(result.n).padStart(5)} pos=${String(result.positives).padStart(5)} `
    + `AUC=${result.auc.toFixed(3)} Brier=${result.brier.toFixed(3)} ECE=${result.ece.toFixed(3)} `
    + `bestF1=${result.bestF1.f1.toFixed(3)}@${result.bestF1.threshold}`,
  );
}

if (rest.includes('--json')) console.log(JSON.stringify(report, null, 2));
