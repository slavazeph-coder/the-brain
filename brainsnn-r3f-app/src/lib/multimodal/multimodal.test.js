import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  buildFeatureSequence,
  extractMultimodalFeatures,
  normalizeMultimodalInput,
  segmentMultimodalInput,
  validateMultimodalInput,
} from './index.js';

function fixture() {
  return {
    schemaVersion: 'brainsnn.multimodal.v1',
    id: 'fixture-video',
    source: { type: 'video', filename: 'fixture.mp4', durationMs: 3200, mimeType: 'video/mp4' },
    text: { transcript: 'Opening claim. Product demonstration. Price appears.' },
    temporal: {
      startMs: 0,
      endMs: 3200,
      segments: [
        { startMs: 0, endMs: 1500, text: 'Opening claim.' },
        { startMs: 1500, endMs: 3000, text: 'Product demonstration.' },
        { startMs: 3000, endMs: 3200, text: 'Price appears.' },
      ],
    },
    observations: {
      vision: [
        { timestampMs: 100, luminance: 0.4, motion: 0.2, red: 0.3, green: 0.4, blue: 0.5 },
        { timestampMs: 1600, luminance: 0.6, motion: 0.8, red: 0.5, green: 0.4, blue: 0.3 },
      ],
      audio: [
        { timestampMs: 200, audioEnergy: 0.3, speechPresent: true },
        { timestampMs: 1700, audioEnergy: 0.7, speechPresent: true },
      ],
    },
    provenance: { userProvided: true, extractorVersions: { browserSampler: '1.0.0' } },
  };
}

describe('multimodal input and temporal features', () => {
  it('normalizes a safe public input without exposing filesystem fields', () => {
    const normalized = normalizeMultimodalInput(fixture());
    expect(normalized.schemaVersion).toBe('brainsnn.multimodal.v1');
    expect(normalized.source.filename).toBe('fixture.mp4');
    expect('path' in normalized.source).toBe(false);
    expect(normalized.provenance.extractorVersions.browserSampler).toBe('1.0.0');
  });

  it('rejects invalid MIME, traversal, oversized duration, and private URLs', () => {
    const invalid = [
      { source: { type: 'video', filename: '../secret.mp4', durationMs: 1000, mimeType: 'video/mp4' } },
      { source: { type: 'video', filename: 'x.mp4', durationMs: 1000, mimeType: 'application/x-msdownload' } },
      { source: { type: 'video', filename: 'x.mp4', durationMs: 900_000, mimeType: 'video/mp4' } },
      { source: { type: 'video', url: 'https://127.0.0.1/private', durationMs: 1000, mimeType: 'video/mp4' } },
      { source: { type: 'video', url: 'http://example.com/video.mp4', durationMs: 1000, mimeType: 'video/mp4' } },
      { source: { type: 'video', filename: 'x.mp4', durationMs: 1000, mimeType: 'video/mp4', tempPath: '/tmp/x' } },
    ];
    for (const value of invalid) expect(validateMultimodalInput(value).valid).toBe(false);
  });

  it('segments deterministically at 1.5 seconds with exact transcript association', () => {
    const input = normalizeMultimodalInput(fixture());
    const first = segmentMultimodalInput(input);
    const second = segmentMultimodalInput(input);
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(first.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[0, 1500], [1500, 3000], [3000, 3200]]);
    expect(first[1].text).toBe('Product demonstration.');
    expect(first[1].observations.audio[0].audioEnergy).toBe(0.7);
  });

  it('keeps missing modalities unavailable while extracting the modalities that exist', async () => {
    const input = normalizeMultimodalInput({
      source: { type: 'text', mimeType: 'text/plain' },
      text: { transcript: 'A specific customer result supports this claim.' },
    });
    const extracted = await extractMultimodalFeatures(input);
    expect(extracted.modalityStatus.vision.status).toBe('unavailable');
    expect(extracted.modalityStatus.audio.status).toBe('unavailable');
    expect(extracted.modalityStatus.language.status).toBe('available');
    expect(extracted.segments[0].modalities.language.vector).toHaveLength(12);
  });

  it('uses a stable 28-dimensional fusion layout and applies ablations without relabeling missing data', async () => {
    const extracted = await extractMultimodalFeatures(normalizeMultimodalInput(fixture()));
    const all = buildFeatureSequence(extracted, { ablation: 'all' });
    const language = buildFeatureSequence(extracted, { ablation: 'language' });
    expect(all.embeddingDimension).toBe(28);
    expect(all.segments[0].fused).toHaveLength(28);
    expect(language.segments[0].fused.slice(0, 16).every((value) => value === 0)).toBe(true);
    expect(language.segments[0].fused.slice(16).some((value) => value !== 0)).toBe(true);
    expect(language.provenance.contributionLabel).toContain('not a causal');
  });
});
