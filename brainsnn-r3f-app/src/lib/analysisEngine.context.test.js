import { describe, expect, it } from '../test/tinyVitest.js';
import { analyzeContentLocally } from './analysisEngine.js';

describe('context-specific local recommendations', () => {
  it('anchors advice to the actual claim instead of returning the old generic template', () => {
    const result = analyzeContentLocally({
      content: 'Our platform will double qualified leads for agencies. Book a demo today.',
      forceFallback: true,
    });

    const first = result.recommendations[0];
    expect(first.rationale).toContain('double qualified leads');
    expect(first.rewriteHint).toContain('double qualified leads');
    expect(first.rewriteHint).not.toBe('Add one concrete example, source, customer result, or constraint.');
    expect(result.insights.find((item) => item.label === 'Best next move').text).toBe(first.rewriteHint);
  });

  it('anchors multimodal advice to extracted timestamps and workflow steps', () => {
    const packet = [
      '[BrainSNN multimodal video packet]',
      'File: workflow.mp4',
      'Duration: 45.0 seconds',
      'Sampled frames: 16',
      'Detected visual transitions: 2',
      'Visual timeline:',
      '- 0:12: Visual transition (44% change intensity)',
      '- 0:31: Major visual change (78% change intensity)',
      'Transcript-derived workflow:',
      '- Step 1: Open the dashboard',
      '- Step 2: Export the report',
      'Transcript / operator notes:',
      'Open the dashboard. Export the report.',
    ].join('\n');

    const result = analyzeContentLocally({ content: packet, contentType: 'video', forceFallback: true });
    const combined = result.recommendations.map((item) => `${item.rationale} ${item.rewriteHint}`).join(' ');
    expect(combined).toContain('Export the report');
    expect(combined).toContain('0:31');
    expect(result.summary).toContain('workflow step');
  });
});
