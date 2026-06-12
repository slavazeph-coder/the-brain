import { describe, expect, it } from 'vitest';
import { LAYER_CATALOG } from './layerCatalog';
import {
  SECTION_REGISTRY,
  sectionForLayer,
  sectionPanelCount,
  sectionPanels,
} from './sectionRegistry';

const CATALOG_IDS = new Set(LAYER_CATALOG.map((l) => l.id));

describe('sectionRegistry', () => {
  it('every layerId points at a real catalog layer', () => {
    for (const [sectionId, section] of Object.entries(SECTION_REGISTRY)) {
      for (const p of section.panels) {
        if (p.layerId != null) {
          expect(CATALOG_IDS.has(p.layerId), `${sectionId} → layer ${p.layerId}`).toBe(true);
        } else {
          expect(p.anchor, `${sectionId} anchor entry needs an anchor`).toBeTruthy();
          expect(p.title, `${sectionId} anchor "${p.anchor}" needs a title`).toBeTruthy();
        }
      }
    }
  });

  it('no panel key appears in two sections', () => {
    const seen = new Map();
    for (const [sectionId, section] of Object.entries(SECTION_REGISTRY)) {
      for (const p of section.panels) {
        const key = p.layerId != null ? `l${p.layerId}` : p.anchor;
        expect(seen.has(key), `${key} in both ${seen.get(key)} and ${sectionId}`).toBe(false);
        seen.set(key, sectionId);
      }
    }
  });

  it('sectionPanels resolves titles from the catalog when not overridden', () => {
    const insights = sectionPanels('insights');
    const analytics = insights.find((p) => p.key === 'l7');
    expect(analytics.title).toBe('Analytics Dashboard');
    expect(insights.find((p) => p.key === 'activity-charts').title).toBe('Activity Charts');
  });

  it('sectionForLayer finds the owning section, null for unmapped layers', () => {
    expect(sectionForLayer(4)).toBe('firewall');
    expect(sectionForLayer(72)).toBe('tools');
    expect(sectionForLayer('eeg')).toBe('io');
    expect(sectionForLayer(1)).toBe(null); // 3D viewer isn't a section panel
  });

  it('panel counts match the section definitions', () => {
    expect(sectionPanelCount('insights')).toBe(3);
    expect(sectionPanelCount('firewall')).toBe(7);
    expect(sectionPanelCount('defense')).toBe(12);
    expect(sectionPanelCount('tools')).toBe(18);
    expect(sectionPanelCount('studio')).toBe(23);
    expect(sectionPanelCount('nope')).toBe(0);
  });
});
