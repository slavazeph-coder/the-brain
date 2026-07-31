import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../test/tinyVitest.js';
import {
  LAYER_CATALOG,
  LAYER_DEPENDENCIES,
  CORE_LAYER_IDS,
  dependenciesFor,
  getCatalogManifest,
  validateCatalog,
} from './layerCatalog.js';

describe('layer catalog', () => {
  it('passes structural + referential validation', () => {
    const { ok, errors } = validateCatalog();
    expect(errors).toHaveLength(0);
    expect(ok).toBe(true);
  });

  it('produces a deterministic, self-consistent manifest', () => {
    const manifest = getCatalogManifest();
    expect(manifest.schemaVersion).toBe('brainsnn.layer-catalog.v1');
    expect(manifest.totalLayers).toBe(LAYER_CATALOG.length);
    expect(manifest.dependencyEdges).toBe(LAYER_DEPENDENCIES.length);
    expect(getCatalogManifest().contentHash).toBe(manifest.contentHash);
    const groupTotal = Object.values(manifest.groups).reduce((sum, count) => sum + count, 0);
    expect(groupTotal).toBe(LAYER_CATALOG.length);
  });

  it('exposes an acyclic dependency graph that only references real core layers', () => {
    const ids = new Set(LAYER_CATALOG.map((layer) => layer.id));
    LAYER_DEPENDENCIES.forEach((edge) => {
      expect(ids.has(edge.id)).toBe(true);
      edge.dependsOn.forEach((dep) => expect(ids.has(dep)).toBe(true));
    });
    // The soliton layer (103) depends on firewall (4) and affect (29).
    expect(dependenciesFor(103)).toContain(4);
    expect(dependenciesFor(103)).toContain(29);
  });

  it('keeps the published data/layer-catalog.json in sync (run npm run export:catalog)', () => {
    const dataset = JSON.parse(readFileSync(new URL('../../data/layer-catalog.json', import.meta.url), 'utf8'));
    expect(dataset.manifest.contentHash).toBe(getCatalogManifest().contentHash);
    expect(dataset.layers).toHaveLength(LAYER_CATALOG.length);
    expect(dataset.coreLayerIds).toHaveLength(CORE_LAYER_IDS.length);
  });
});
