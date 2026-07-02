import { describe, expect, it } from '../test/tinyVitest.js';
import {
  createReplayNeuralInput,
  getNeuralGatewayCapabilities,
  normalizeConfidence,
  normalizeModality,
  normalizeTokenConfidences,
  sanitizeDecodedText,
} from './neuralInputGateway.js';

describe('Neural Input Gateway', () => {
  it('normalizes percentage and probability confidence values', () => {
    expect(normalizeConfidence(82)).toBe(0.82);
    expect(normalizeConfidence(0.67)).toBe(0.67);
    expect(normalizeConfidence(140)).toBe(1);
    expect(normalizeConfidence(-2)).toBe(0);
  });

  it('falls back unknown modalities to decoded text', () => {
    expect(normalizeModality('MEG')).toBe('meg');
    expect(normalizeModality('unknown-device')).toBe('decoded_text');
  });

  it('creates a consent-aware replay envelope without retaining raw signal', () => {
    const fixedNow = () => new Date('2026-07-01T12:00:00.000Z');
    const envelope = createReplayNeuralInput({
      decodedText: 'Customer proof makes this launch easier to trust.',
      modality: 'meg',
      confidence: 78,
      decoder: 'research-decoder',
      modelVersion: '2.0',
      sessionId: 'session-42',
      consentConfirmed: true,
      tokenConfidences: [0.8, 74],
    }, fixedNow);

    expect(envelope.mode).toBe('replay');
    expect(envelope.confidence).toBe(0.78);
    expect(envelope.provenance.decoder).toBe('research-decoder');
    expect(envelope.capture.capturedAt).toBe('2026-07-01T12:00:00.000Z');
    expect(envelope.research.consentConfirmed).toBe(true);
    expect(envelope.research.rawSignalRetained).toBe(false);
    expect(envelope.tokenConfidences).toHaveLength(2);
    expect(envelope.tokenConfidences[1].confidence).toBe(0.74);
  });

  it('sanitizes transcript control characters and line endings', () => {
    expect(sanitizeDecodedText('  hello\u0000\r\nworld  ')).toBe('hello\nworld');
  });

  it('requires decoded text for replay mode', () => {
    let message = '';
    try {
      createReplayNeuralInput({});
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('decodedText is required');
  });

  it('maps token confidence arrays onto transcript tokens', () => {
    const tokens = normalizeTokenConfidences([91, { score: 0.62 }], 'alpha beta');
    expect(tokens).toEqual([
      { token: 'alpha', confidence: 0.91 },
      { token: 'beta', confidence: 0.62 },
    ]);
  });

  it('advertises an auditable no-retention adapter contract', () => {
    const capabilities = getNeuralGatewayCapabilities({});
    expect(capabilities.schemaVersion).toBe('brainsnn.neural-input.v1');
    expect(capabilities.modalities).toContain('meg');
    expect(capabilities.retainsRawSignal).toBe(false);
  });
});
