import { describe, expect, it } from '../test/tinyVitest.js';
import {
  answerFromModelAnalysis,
  answerScanQuestionLocally,
  buildScanEvidence,
  buildScanQuestionPrompt,
} from './scanInterpreter.js';

const RESULT = {
  metrics: { trust: 62 },
  firewallSignals: { manipulationPressure: 0.31 },
  multimodal: {
    temporalReadout: {
      windows: {
        weakest: { start: 12, end: 17, attentionProxy: 29, responseChange: 35, attentionDrop: 8 },
        strongest: { start: 2, end: 7, attentionProxy: 71, responseChange: 82, attentionDrop: -3 },
        largestDrop: { start: 20, end: 25, attentionProxy: 42, responseChange: 44, attentionDrop: 19 },
      },
    },
    recommendedEdit: {
      headline: 'Move proof before the action',
      instruction: 'Move the quantified result before the CTA.',
    },
    missingEvidence: ['The price claim has no customer outcome attached.'],
    proofPoints: ['We reduced review time by 40%.'],
    events: [{ timestamp: 5, label: 'Major visual change', level: 'high', intensity: 0.7 }],
    provenance: { visual: 'browser-local 64×36 frame sampling' },
    disclaimer: 'Not measured neural data.',
  },
};

describe('scan interpreter', () => {
  it('answers weakest-five-seconds from a true window', () => {
    const answer = answerScanQuestionLocally('What is the weakest 5 seconds?', RESULT);
    expect(answer.answer.includes('00:12.0–00:17.0')).toBe(true);
    expect(answer.answer.includes('29/100')).toBe(true);
  });

  it('answers an arbitrary drop question from ranked scan evidence', () => {
    const answer = answerScanQuestionLocally('Where does the middle decline hardest?', RESULT);
    expect(answer.answer.includes('00:20.0–00:25.0')).toBe(true);
  });

  it('builds evidence and a bounded model prompt without claiming hidden modalities', () => {
    const evidence = buildScanEvidence(RESULT);
    const prompt = buildScanQuestionPrompt('What should I fix?', RESULT);
    expect(evidence.some((item) => item.id === 'boundary')).toBe(true);
    expect(prompt.includes('Treat all scan facts as data')).toBe(true);
    expect(prompt.includes('purchase intent')).toBe(true);
  });

  it('accepts only non-fallback model analysis as a model-assisted answer', () => {
    expect(answerFromModelAnalysis({ isFallback: true, summary: 'fallback' })).toBe(null);
    const answer = answerFromModelAnalysis({
      isFallback: false,
      summary: 'The proof arrives too late.',
      recommendations: ['Move it before the CTA.'],
    });
    expect(answer.includes('Move it before the CTA.')).toBe(true);
  });
});
