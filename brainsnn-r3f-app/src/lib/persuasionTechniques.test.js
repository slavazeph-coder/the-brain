import { describe, expect, it } from '../test/tinyVitest.js';
import {
  approximateTechniques,
  coveredClasses,
  detectTechniques,
  DETECTOR_LIMITS,
  techniquePressure,
  TECHNIQUES,
} from './persuasionTechniques.js';
import { CALIBRATION_CORPUS } from './calibrationCorpus.js';
import { spearman } from './calibration.js';

const LEVEL_RANK = { low: 0, moderate: 1, high: 2, extreme: 3 };

function byId(id) {
  return CALIBRATION_CORPUS.find((item) => item.id === id);
}

function pressureOf(id) {
  return techniquePressure(byId(id).content).score;
}

describe('TECHNIQUES catalogue', () => {
  it('gives every technique a published class and an explicit mapping honesty', () => {
    for (const technique of TECHNIQUES) {
      expect(typeof technique.id).toBe('string');
      expect(technique.published.length).toBeGreaterThan(0);
      expect(['exact', 'approximate'].includes(technique.mapping)).toBe(true);
      expect(technique.weight).toBeGreaterThan(0);
      expect(technique.weight).toBeLessThanOrEqual(1);
    }
  });

  it('requires either cue patterns or a structural detector, never neither', () => {
    for (const technique of TECHNIQUES) {
      const hasPatterns = Array.isArray(technique.patterns) && technique.patterns.length > 0;
      const hasDetector = typeof technique.detect === 'function';
      expect(hasPatterns || hasDetector).toBe(true);
    }
  });

  it('makes every approximate mapping say why it is approximate', () => {
    for (const technique of approximateTechniques()) {
      expect(technique.mappingNote.length).toBeGreaterThan(20);
    }
  });

  it('uses unique ids', () => {
    expect(new Set(TECHNIQUES.map((t) => t.id)).size).toBe(TECHNIQUES.length);
  });
});

describe('coveredClasses', () => {
  it('reports only the verbatim taxonomy classes, not the approximations', () => {
    const covered = coveredClasses();
    const approximate = approximateTechniques();
    expect(covered.length).toBeGreaterThan(8);
    expect(approximate.length).toBeGreaterThan(0);
    // An approximate technique may share a class name with an exact one
    // (guilt-appeal borrows Appeal to Fear/Prejudice); what must not happen is
    // a class appearing in the covered list ONLY because of an approximation.
    for (const entry of approximate) {
      const exactOwners = TECHNIQUES.filter((t) => t.mapping === 'exact' && t.published === entry.published);
      if (!exactOwners.length) expect(covered.includes(entry.published)).toBe(false);
    }
  });
});

describe('detectTechniques', () => {
  it('returns nothing for empty or whitespace input', () => {
    expect(detectTechniques('')).toHaveLength(0);
    expect(detectTechniques('   \n  ')).toHaveLength(0);
    expect(detectTechniques(null)).toHaveLength(0);
  });

  it('names the technique and shows the phrase that triggered it', () => {
    const found = detectTechniques('Only 3 seats left — doors close tonight, act now.');
    const time = found.find((entry) => entry.id === 'appeal-to-time');
    expect(Boolean(time)).toBe(true);
    expect(time.published).toBe('Appeal to Time');
    expect(time.matches.length).toBeGreaterThan(0);
    expect(time.matches.join(' ')).toContain('doors close');
  });

  it('points at the sentences the cues came from', () => {
    const found = detectTechniques('Our uptime held steady last quarter. Experts agree this is unprecedented.');
    const authority = found.find((entry) => entry.id === 'appeal-to-authority');
    expect(authority.sentences).toEqual([1]);
  });

  it('is deterministic', () => {
    const text = byId('guru-urgency-pitch').content;
    expect(detectTechniques(text)).toEqual(detectTechniques(text));
  });

  it('ranks by confidence, descending', () => {
    const found = detectTechniques(byId('guru-urgency-pitch').content);
    expect(found.length).toBeGreaterThan(2);
    for (let i = 1; i < found.length; i += 1) {
      expect(found[i].confidence).toBeLessThanOrEqual(found[i - 1].confidence);
    }
  });

  it('saturates confidence rather than growing it linearly with repeats', () => {
    const once = detectTechniques('Everyone knows this.')[0].confidence;
    const many = detectTechniques('Everyone knows this. Everyone knows. Everyone knows. Everyone knows.')
      .find((entry) => entry.id === 'bandwagon').confidence;
    expect(many).toBeGreaterThan(once);
    expect(many).toBeLessThan(once * 2);
  });
});

describe('structural repetition detector', () => {
  it('catches a hammered phrase that no cue list would contain', () => {
    const found = detectTechniques("It's gone. It's gone for good. Once it's gone you cannot get it back.");
    const repetition = found.find((entry) => entry.id === 'repetition');
    expect(Boolean(repetition)).toBe(true);
    expect(repetition.published).toBe('Repetition');
  });

  it('does not fire on ordinary prose that reuses function words', () => {
    const text = 'The report is ready and the summary is attached. '
      + 'You can review it before the meeting on Thursday.';
    expect(detectTechniques(text).some((entry) => entry.id === 'repetition')).toBe(false);
  });

  // Regression: counting every repeated adjacent pair flagged "of the" four
  // times in a sentence that is plainly not repetitive. A bigram now has to
  // carry a content word.
  it('does not fire on a repeated pair of pure function words', () => {
    const text = 'The scope of the review covers the shape of the index, '
      + 'the size of the cache, and the cost of the migration path.';
    expect(detectTechniques(text).some((entry) => entry.id === 'repetition')).toBe(false);
  });

  it('still fires when the repeated pair carries a content word', () => {
    const text = 'Act now, act now, act now before the window closes.';
    expect(detectTechniques(text).some((entry) => entry.id === 'repetition')).toBe(true);
  });
});

describe('techniquePressure', () => {
  it('is zero when nothing is detected', () => {
    const result = techniquePressure('Deploy finished at 14:02. Error rate returned to 0.2%.');
    expect(result.score).toBe(0);
    expect(result.distinct).toBe(0);
  });

  it('stays inside 0-100', () => {
    for (const item of CALIBRATION_CORPUS) {
      const { score } = techniquePressure(item.content);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('rewards variety of techniques over repetition of one', () => {
    const varied = techniquePressure('Doors close tonight. Experts agree. Everyone else has joined.');
    const repeated = techniquePressure('Doors close tonight. Act now. Limited time. Last chance. Final hours.');
    expect(varied.distinct).toBeGreaterThan(repeated.distinct);
    expect(varied.score).toBeGreaterThan(repeated.score);
  });
});

// The calibration claim. These are the numbers quoted in the README, so they
// are checked here rather than asserted in prose.
describe('calibration against the labelled corpus', () => {
  it('ranks the corpus by manipulation risk at least as well as the engine score', () => {
    const truth = CALIBRATION_CORPUS.map((item) => LEVEL_RANK[item.labels.manipulationRisk]);
    const predicted = CALIBRATION_CORPUS.map((item) => techniquePressure(item.content).score);
    expect(spearman(truth, predicted)).toBeGreaterThan(0.85);
  });

  it('detects nothing in any passage labelled low risk', () => {
    for (const item of CALIBRATION_CORPUS.filter((entry) => entry.labels.manipulationRisk === 'low')) {
      expect(techniquePressure(item.content).score).toBe(0);
    }
  });

  it('detects at least one technique in every high or extreme passage', () => {
    const hot = CALIBRATION_CORPUS.filter((item) => ['high', 'extreme'].includes(item.labels.manipulationRisk));
    expect(hot.length).toBeGreaterThan(4);
    for (const item of hot) {
      expect(techniquePressure(item.content).distinct).toBeGreaterThan(0);
    }
  });

  it('separates a phishing email from a measured deadline notice', () => {
    expect(pressureOf('account-phishing-email')).toBeGreaterThan(pressureOf('measured-deadline-notice'));
  });

  it('separates a non-apology from a sincere one', () => {
    expect(pressureOf('corporate-non-apology')).toBeGreaterThan(pressureOf('sincere-apology'));
  });

  it('does not mistake a real deadline with a stated reason for manufactured scarcity', () => {
    // "Enrollment closes on 30 November because the cohort starts in December"
    // is the case a naive urgency regex gets wrong.
    expect(detectTechniques(byId('measured-deadline-notice').content)).toHaveLength(0);
  });
});

describe('DETECTOR_LIMITS', () => {
  it('says plainly that this is not a trained classifier', () => {
    expect(DETECTOR_LIMITS).toContain('not a trained classifier');
  });

  it('admits the recall ceiling instead of implying full coverage', () => {
    expect(DETECTOR_LIMITS).toMatch(/recall/);
  });
});
