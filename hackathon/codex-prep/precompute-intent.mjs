#!/usr/bin/env node
// hackathon/codex-prep/precompute-intent.mjs
//
// Walks hackathon/demo-corpus/ and materializes intent classifier
// responses into hackathon/cache/intent-scores.json. Run once before
// recording day so the live demo doesn't depend on Gemma latency or
// quota.
//
// Codex: this is the runtime sibling of firewallIntent.js. After
// dropping firewallIntent.js into brainsnn-r3f-app/src/utils/, copy
// this script to scripts/precompute-intent.mjs at the repo root and
// adjust the IMPORT_PATH constant.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const CORPUS_ROOT = join(REPO_ROOT, "hackathon/demo-corpus");
const CACHE_PATH = join(REPO_ROOT, "hackathon/cache/intent-scores.json");
const FIXTURES_PATH = join(REPO_ROOT, "hackathon/cache/corpus-fixtures.json");

const CATEGORIES = [
  "phishing",
  "marketing",
  "robot-prompts",
  "ar-overlays",
  "business-scenarios",
  "intel-corpus",
];
const DEFAULT_MODEL = "gemini-2.5-flash";

// Codex: replace this with a real import once firewallIntent.js
// lands in brainsnn-r3f-app/src/utils/. Until then, this script
// runs in --emit-fixtures mode only.
const IMPORT_PATH = "../../brainsnn-r3f-app/src/utils/firewallIntent.js";

function extractBody(md) {
  const m = md.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1].trim() : md.trim();
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function loadCorpus() {
  const out = [];
  for (const cat of CATEGORIES) {
    const dir = join(CORPUS_ROOT, cat);
    let files;
    try {
      files = await readdir(dir);
    } catch (_e) {
      continue;
    }
    for (const f of files.filter(
      (f) => f.endsWith(".md") && !f.toLowerCase().includes("readme"),
    )) {
      const md = await readFile(join(dir, f), "utf8");
      out.push({ category: cat, file: f, body: extractBody(md) });
    }
  }
  return out;
}

async function emitFixtures() {
  const corpus = await loadCorpus();
  const fixtures = {};
  for (const item of corpus) {
    fixtures[`${item.category}/${item.file}`] = item.body;
  }
  await mkdir(dirname(FIXTURES_PATH), { recursive: true });
  await writeFile(FIXTURES_PATH, JSON.stringify(fixtures, null, 2));
  console.log(`Wrote ${corpus.length} corpus fixtures → ${FIXTURES_PATH}`);
}

async function precomputeIntent(opts = {}) {
  const { model = DEFAULT_MODEL, force = false } = opts;
  let classifyIntent;
  try {
    const mod = await import(IMPORT_PATH);
    classifyIntent = mod.classifyIntent;
  } catch (err) {
    console.error(
      `\nERROR: cannot import firewallIntent.js from ${IMPORT_PATH}`,
    );
    console.error(`  Reason: ${err.message}`);
    console.error(
      `\nHave you copied hackathon/codex-prep/firewallIntent.js to`,
    );
    console.error(`brainsnn-r3f-app/src/utils/firewallIntent.js?`);
    console.error(
      `\nFor now, you can still run with --emit-fixtures to materialize`,
    );
    console.error(`corpus bodies for the test suite.\n`);
    process.exit(1);
  }

  const corpus = await loadCorpus();
  let cache = {};
  try {
    const existing = await readFile(CACHE_PATH, "utf8");
    cache = JSON.parse(existing);
    console.log(
      `Loaded ${Object.keys(cache).length} existing cache entries from ${CACHE_PATH}`,
    );
  } catch (_e) {
    console.log(`No existing cache at ${CACHE_PATH}; starting fresh`);
  }

  let added = 0,
    skipped = 0,
    errors = 0;
  for (const item of corpus) {
    const key = sha256Hex(`${model}:${item.body}`);
    if (cache[key] && !force) {
      skipped++;
      continue;
    }
    try {
      console.log(`Classifying ${item.category}/${item.file} ...`);
      const result = await classifyIntent(item.body, { model, cache: false });
      cache[key] = result;
      added++;
      // Throttle to avoid Gemma quota issues. ~3 req/sec is safe.
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      errors++;
    }
  }

  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`\nDone. Added ${added}, skipped ${skipped}, errors ${errors}.`);
  console.log(`Cache → ${CACHE_PATH}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--emit-fixtures")) {
    await emitFixtures();
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: node hackathon/codex-prep/precompute-intent.mjs [options]

Options:
  --emit-fixtures   Write hackathon/cache/corpus-fixtures.json with
                    every corpus body keyed by '<category>/<file>'.
                    Used by the test suite. Does NOT call Gemma.

  --force           Re-classify samples already in cache.

  --model <name>    Override classifier model (default: ${DEFAULT_MODEL}).

  -h, --help        Show this help.

Default behavior (no flags): walks hackathon/demo-corpus/, calls
classifyIntent on every sample not already in the cache, persists to
hackathon/cache/intent-scores.json.

Requires brainsnn-r3f-app/src/utils/firewallIntent.js to exist (copy
from hackathon/codex-prep/firewallIntent.js and implement the Gemma
call per INTEGRATION.md).
`);
    return;
  }
  const modelIdx = args.indexOf("--model");
  const opts = {
    model: modelIdx >= 0 ? args[modelIdx + 1] : DEFAULT_MODEL,
    force: args.includes("--force"),
  };
  await precomputeIntent(opts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
