#!/usr/bin/env node
// Structural + referential integrity check for the layer catalog and its
// dependency graph. Inspired by os-taxonomy's scripts/validate.mjs. Exits
// non-zero on any error so CI can gate it.
import { validateCatalog, getCatalogManifest } from '../src/lib/layerCatalog.js';

const { ok, errors } = validateCatalog();
const manifest = getCatalogManifest();

if (!ok) {
  console.error(`✗ Layer catalog invalid — ${errors.length} error(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `✓ Layer catalog valid — ${manifest.totalLayers} layers, ${manifest.dependencyEdges} dependency edges, hash ${manifest.contentHash}`,
);
