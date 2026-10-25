import { describe, expect, it } from '../test/tinyVitest.js';
import {
  createReplayNeuralInput,
  deriveDecodeUncertainty,
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

  it('reports remote configured when NEURAL_DECODER_URL is set', () => {
    expect(getNeuralGatewayCapabilities({ NEURAL_DECODER_URL: 'https://decoder.example' }).remoteConfigured).toBe(true);
  });
});

describe('deriveDecodeUncertainty', () => {
  it('bands confidence into high / medium / low', () => {
    expect(deriveDecodeUncertainty(createReplayNeuralInput({ decodedText: 'reliable line', confidence: 90 })).band).toBe('high');
    expect(deriveDecodeUncertainty(createReplayNeuralInput({ decodedText: 'unsure line', confidence: 60 })).band).toBe('medium');
    expect(deriveDecodeUncertainty(createReplayNeuralInput({ decodedText: 'tentative line', confidence: 30 })).band).toBe('low');
  });

  it('surfaces low-confidence tokens and a human label, deterministically', () => {
    const envelope = createReplayNeuralInput({
      decodedText: 'proof helps trust',
      confidence: 40,
      tokenConfidences: [{ token: 'proof', confidence: 0.9 }, { token: 'helps', confidence: 0.3 }, { token: 'trust', confidence: 0.2 }],
    });
    const a = deriveDecodeUncertainty(envelope);
    const b = deriveDecodeUncertainty(envelope);
    expect(a.band).toBe('low');
    expect(a.lowConfidenceTokens).toHaveLength(2);
    expect(a.label).toContain('40%');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
