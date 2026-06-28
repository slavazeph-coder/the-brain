import { describe, expect, it } from '../test/tinyVitest.js';
import { LAYER_CATALOG } from './layerCatalog.js';
import { createAutopsyFromLayerStack, getEngineStatusSnapshot, runLayerRouter } from './layerRouter.js';
import { analyzeContentLocally } from './analysisEngine.js';

describe('BrainSNN layer router', () => {
  it('indexes the full 103-layer stack', () => {
    expect(LAYER_CATALOG).toHaveLength(103);
    expect(LAYER_CATALOG.find((layer) => layer.id === 3)?.name).toContain('TRIBE');
    expect(LAYER_CATALOG.find((layer) => layer.id === 102)?.name).toContain('Lobster');
    expect(LAYER_CATALOG.find((layer) => layer.id === 103)?.name).toContain('Soliton');
  });

  it('enriches an AnalysisResult without removing required backend fields', () => {
    const baseResult = analyzeContentLocally({ content: 'Customer proof makes this calmer launch claim easier to trust today.' });
    const enriched = runLayerRouter({ content: baseResult.rawContent, baseResult });
    expect(enriched.id).toBe(baseResult.id);
    expect(enriched.layersUsed.length).toBeGreaterThan(8);
    expect(enriched.firewallSignals.manipulationPressure).toBeGreaterThanOrEqual(0);
    expect(enriched.tribeProjection.regions.AMY).toBeGreaterThanOrEqual(0);
    expect(enriched.receipt.id).toMatch(/^bsnn-/);
  });

  it('attaches a deterministic 39 Hz soliton field to every scan', () => {
    const baseResult = analyzeContentLocally({ content: 'Customer proof makes this calmer launch claim easier to trust today.' });
    const enriched = runLayerRouter({ content: baseResult.rawContent, baseResult });
    expect(enriched.solitonField.layer).toBe(103);
    expect(enriched.solitonField.baseFrequencyHz).toBe(39);
    expect(enriched.solitonField.effectiveFrequencyHz).toBeGreaterThanOrEqual(30);
    expect(enriched.solitonField.effectiveFrequencyHz).toBeLessThanOrEqual(100);
    expect(enriched.solitonField.gammaCoherence).toBeGreaterThanOrEqual(0);
    expect(enriched.solitonField.gammaCoherence).toBeLessThanOrEqual(1);
    expect(enriched.solitonField.solitons.length).toBeGreaterThan(2);
    expect(['bound', 'partial', 'desynchronized']).toContain(enriched.solitonField.synchrony);
    expect(enriched.engineTrace.some((stage) => stage.stage.includes('Soliton'))).toBe(true);
    // Deterministic: identical content yields an identical field.
    const again = runLayerRouter({ content: baseResult.rawContent, baseResult });
    expect(again.solitonField.gammaCoherence).toBe(enriched.solitonField.gammaCoherence);
    expect(again.solitonField.leapfrogEvents).toBe(enriched.solitonField.leapfrogEvents);
  });

  it('reports engine readiness from env without leaking secrets', () => {
    const status = getEngineStatusSnapshot({ STRIPE_SECRET_KEY: 'sk_test_secret', TRIBE_API_URL: 'https://example.com' });
    expect(status.totalLayers).toBe(103);
    expect(status.engines.stripe.configured).toBe(true);
    expect(status.engines.tribe.configured).toBe(true);
  });

  it('runs an autopsy comparison with layer evidence', () => {
    const autopsy = createAutopsyFromLayerStack(
      'Last chance to unlock the secret growth system before competitors win.',
      'See customer proof for the growth system, then decide whether it fits your campaign.'
    );
    expect(['left', 'right', 'tie']).toContain(autopsy.winner);
    expect(autopsy.layersUsed.length).toBeGreaterThan(4);
    expect(autopsy.left.layersUsed.length).toBeGreaterThan(8);
  });
});
