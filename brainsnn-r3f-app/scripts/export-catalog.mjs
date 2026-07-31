#!/usr/bin/env node
// Publishes the layer catalog as pure data (os-taxonomy style): a single JSON
// dataset consumable by agents/tools without importing the app's JS. Run after
// changing the catalog: `npm run export:catalog`. A test keeps the committed
// file in sync via the manifest content hash.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LAYER_CATALOG,
  LAYER_GROUPS,
  LAYER_DEPENDENCIES,
  CORE_LAYER_IDS,
  getCatalogManifest,
} from '../src/lib/layerCatalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'data', 'layer-catalog.json');

const dataset = {
  manifest: getCatalogManifest(),
  groups: LAYER_GROUPS,
  layers: LAYER_CATALOG,
  dependencies: LAYER_DEPENDENCIES,
  coreLayerIds: CORE_LAYER_IDS,
};

writeFileSync(outPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Wrote ${outPath} (hash ${dataset.manifest.contentHash})`);
