/**
 * Spot-the-Manipulation quiz corpus.
 *
 * 10 curated items. Each has a "truth" score (0–100) derived from the
 * Cognitive Firewall + human calibration — used to grade how well a
 * user can eyeball manipulation without the scanner.
 *
 * Mix of high / medium / low pressure items so a naive "mark everything
 * manipulative" strategy gets ~55% accuracy — not 100%.
 */

export const QUIZ_ITEMS = [
  {
    id: 'q1',
    text:
      "URGENT: your account has been compromised. Click now to verify or it will be permanently terminated within the hour. Don't wait — act immediately.",
    truth: 85,
    kind: 'attack',
    label: 'Phishing / urgency',
  },
  {
    id: 'q2',
    text:
      "The paper, published today in Nature, describes a simple method for folding proteins that matches AlphaFold on a subset of targets while using 40x less compute.",
    truth: 8,
    kind: 'benign',
    label: 'Factual news',
  },
  {
    id: 'q3',
    text:
      "Everyone is finally waking up to the scandal they covered up for YEARS. Shocking. Disgusting. If you're not furious, you're not paying attention.",
    truth: 82,
    kind: 'attack',
    label: 'Outrage cascade',
  },
  {
    id: 'q4',
    text:
      "Take a slow breath. There is nothing you have to do right now except notice the weight of your body and the arrival of the next breath.",
    truth: 4,
    kind: 'benign',
    label: 'Calm prompt',
  },
  {
    id: 'q5',
    text:
      "Scientifically proven — 100% guaranteed results. Everyone knows it works. Obviously you should be using this. Limited time offer, act fast before it's gone.",
    truth: 88,
    kind: 'attack',
    label: 'Certainty + urgency ad',
  },
  {
    id: 'q6',
    text:
      "Q2 revenue came in at $2.1B, up 14% YoY, driven by a 19% jump in enterprise seats. Gross margin compressed 80 bps on higher infrastructure spend.",
    truth: 6,
    kind: 'benign',
    label: 'Earnings summary',
  },
  {
    id: 'q7',
    text:
      "A deadly new virus is spreading. Experts warn collapse is imminent. If you don't prepare NOW, it may already be too late to protect your family. WARNING.",
    truth: 83,
    kind: 'attack',
    label: 'Fear cascade',
  },
  {
    id: 'q8',
    text:
      "The team reports a 3.2 second median latency improvement after switching the cache key layout, though the P99 tail still shows the occasional regression.",
    truth: 5,
    kind: 'benign',
    label: 'Engineering update',
  },
  {
    id: 'q9',
    text:
      "They don't want you to know the hidden truth. The ones in power have been lying to you. Wake up before it's too late — share this before they delete it.",
    truth: 79,
    kind: 'attack',
    label: 'Conspiracy framing',
  },
  {
    id: 'q10',
    text:
      "Preliminary evidence suggests a small effect, though the confidence interval is wide and the authors caution against overinterpreting the result before replication.",
    truth: 3,
    kind: 'benign',
    label: 'Cautious science',
  },
];

/**
 * Grade a single guess: 0 (way off) → 1 (perfect).
 * Distance in absolute score points, normalized against a 40-point
 * "close enough" window so casual players can still hit 70–80%.
 */
export function gradeGuess(truth, guess) {
  const d = Math.abs((truth || 0) - (guess || 0));
  const window = 40;
  return Math.max(0, 1 - d / window);
}

/**
 * Aggregate accuracy across all answered items (0–100).
 */
export function quizAccuracy(guesses) {
  let sum = 0;
  let n = 0;
  for (const item of QUIZ_ITEMS) {
    if (typeof guesses[item.id] === 'number') {
      sum += gradeGuess(item.truth, guesses[item.id]);
      n++;
    }
  }
  if (n === 0) return 0;
  return Math.round((sum / n) * 100);
}

/**
 * Per-item breakdown for the result screen.
 */
export function quizBreakdown(guesses) {
  return QUIZ_ITEMS.map((item) => {
    const g = typeof guesses[item.id] === 'number' ? guesses[item.id] : null;
    return {
      id: item.id,
      label: item.label,
      truth: item.truth,
      guess: g,
      grade: g === null ? 0 : gradeGuess(item.truth, g),
      correct: g === null ? false : Math.abs(item.truth - g) <= 20,
    };
  });
}
