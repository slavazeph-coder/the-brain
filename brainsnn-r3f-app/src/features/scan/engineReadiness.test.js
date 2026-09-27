import assert from 'node:assert/strict';
import { it } from '../../test/tinyVitest.js';
import { analysisProviderReadiness } from './engineReadiness.js';

it('analysis readiness reflects GPU priority and distinguishes reachability from verified inference', () => {
  const engines = { gemini: { configured: true }, gpu: { configured: true, status: 'reachable', lastInferenceStatus: 'not_tested' } };
  const reachable = analysisProviderReadiness({ engines });
  assert.equal(reachable.detail, 'Dedicated GPU with built-in fallback');
  assert.equal(reachable.status, 'reachable; inference unverified');
  engines.gpu.status = 'online';
  assert.deepEqual(analysisProviderReadiness({ engines }), { detail: 'Dedicated GPU', status: 'inference verified' });
  engines.gpu.status = 'reachable';
  engines.gpu.lastInferenceStatus = 'completed';
  assert.equal(analysisProviderReadiness({ engines }).status, 'inference verified');
});

it('analysis readiness retains fallback visibility for GPU failures even when Gemini is configured', () => {
  for (const status of ['invalid_configuration', 'unreachable', 'timeout', 'busy', 'authentication_failed', 'model_unavailable', 'invalid_output']) {
    const result = analysisProviderReadiness({ engines: { gpu: { configured: status !== 'invalid_configuration', status }, gemini: { configured: true } } });
    assert.equal(result.detail, 'Built-in fallback available');
    assert.ok(result.status.startsWith('GPU '));
  }
  const result = analysisProviderReadiness({ engines: { gpu: { configured: true, status: 'reachable', lastInferenceStatus: 'invalid_output' } } });
  assert.equal(result.status, 'GPU output unavailable');
});

it('analysis readiness does not claim offline processing or unused model providers', () => {
  assert.equal(analysisProviderReadiness(null).status, 'checking');
  const local = analysisProviderReadiness({ engines: { openai: { configured: true }, gemma: { configured: true }, gpu: { configured: false, status: 'not_configured' } } });
  assert.deepEqual(local, { detail: 'Built-in engine on BrainSNN', status: 'ready' });
  assert.deepEqual(analysisProviderReadiness({ engines: { gemini: { configured: true } } }), { detail: 'Gemini with built-in fallback', status: 'configured' });
});
