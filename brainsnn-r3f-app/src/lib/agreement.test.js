import { describe, expect, it } from '../test/tinyVitest.js';
import { agreementByDimension, interpretAlpha, krippendorffAlpha } from './agreement.js';

describe('krippendorffAlpha', () => {
  it('is 1 when annotators agree perfectly', () => {
    const ratings = [[0, 0], [1, 1], [2, 2], [3, 3], [1, 1]];
    expect(krippendorffAlpha(ratings).alpha).toBe(1);
  });

  it('is near 0 when annotators disagree at chance level', () => {
    // Systematically opposite ratings carry no shared signal.
    const ratings = [[0, 3], [3, 0], [0, 3], [3, 0], [1, 2], [2, 1]];
    expect(krippendorffAlpha(ratings).alpha).toBeLessThan(0.2);
  });

  it('penalises a distant disagreement more than an adjacent one on ordinal data', () => {
    const adjacent = krippendorffAlpha([[0, 0], [1, 1], [2, 2], [3, 3], [1, 2]], { metric: 'ordinal' }).alpha;
    const distant = krippendorffAlpha([[0, 0], [1, 1], [2, 2], [3, 3], [0, 3]], { metric: 'ordinal' }).alpha;
    expect(distant).toBeLessThan(adjacent);
  });

  it('treats all disagreements alike on nominal data', () => {
    const adjacent = krippendorffAlpha([[0, 0], [1, 1], [2, 2], [3, 3], [1, 2]], { metric: 'nominal' }).alpha;
    const distant = krippendorffAlpha([[0, 0], [1, 1], [2, 2], [3, 3], [1, 3]], { metric: 'nominal' }).alpha;
    expect(Math.abs(adjacent - distant)).toBeLessThan(1e-9);
  });

  it('handles missing ratings and more than two annotators', () => {
    const ratings = [
      [0, 0, null],
      [1, 1, 1],
      [2, null, 2],
      [3, 3, 3],
      [null, 1, 1],
    ];
    const result = krippendorffAlpha(ratings);
    expect(result.units).toBe(5);
    expect(result.alpha).toBeGreaterThan(0.8);
  });

  it('ignores units with fewer than two ratings', () => {
    const result = krippendorffAlpha([[0], [1, 1], [2, 2], [null, null]]);
    expect(result.units).toBe(2);
  });

  it('returns a defined result for degenerate input', () => {
    expect(krippendorffAlpha([]).alpha).toBe(1);
    expect(krippendorffAlpha([[1]]).alpha).toBe(1);
    expect(krippendorffAlpha(null).alpha).toBe(1);
  });

  it('is 1 when every rating is identical (no variance to explain)', () => {
    expect(krippendorffAlpha([[2, 2], [2, 2], [2, 2]]).alpha).toBe(1);
  });
});

describe('interpretAlpha', () => {
  it('follows the conventional reliability thresholds', () => {
    expect(interpretAlpha(0.85).label).toBe('reliable');
    expect(interpretAlpha(0.85).usable).toBe(true);
    expect(interpretAlpha(0.7).label).toBe('tentative');
    expect(interpretAlpha(0.4).usable).toBe(false);
    expect(interpretAlpha(-0.1).label).toBe('no agreement');
  });
});

describe('agreementByDimension', () => {
  it('reports alpha and a reading per dimension', () => {
    const annotations = {
      'item-1': { manipulationRisk: { ann1: 3, ann2: 3 }, trust: { ann1: 0, ann2: 1 } },
      'item-2': { manipulationRisk: { ann1: 0, ann2: 0 }, trust: { ann1: 3, ann2: 3 } },
      'item-3': { manipulationRisk: { ann1: 2, ann2: 2 }, trust: { ann1: 1, ann2: 0 } },
      'item-4': { manipulationRisk: { ann1: 1, ann2: 1 }, trust: { ann1: 2, ann2: 2 } },
    };
    const report = agreementByDimension(annotations, {
      dimensions: ['manipulationRisk', 'trust'],
      annotators: ['ann1', 'ann2'],
      categories: 4,
    });
    expect(report.manipulationRisk.alpha).toBe(1);
    expect(report.manipulationRisk.label).toBe('reliable');
    expect(report.trust.alpha).toBeLessThan(1);
    expect(typeof report.trust.note).toBe('string');
  });
});
