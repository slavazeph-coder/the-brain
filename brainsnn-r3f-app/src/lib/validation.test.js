import { describe, expect, it } from '../test/tinyVitest.js';
import { splitIntoSegments, validateScanInput } from './validation.js';

describe('scan validation', () => {
  it('rejects empty and very short content', () => {
    expect(validateScanInput('').valid).toBe(false);
    expect(validateScanInput('short').valid).toBe(false);
  });

  it('accepts realistic draft content', () => {
    expect(validateScanInput('This is a realistic draft with enough context to scan.').valid).toBe(true);
  });

  it('splits content into meaningful sentence segments', () => {
    const segments = splitIntoSegments('First sentence. Second sentence! Third?');
    expect(segments).toEqual(['First sentence.', 'Second sentence!', 'Third?']);
  });
});
