// A holdout set for the persuasion-technique detector.
//
// WHY THIS FILE EXISTS
//
// `calibrationCorpus.js` is contaminated as an evaluation set for
// `persuasionTechniques.js`: the detector's cue patterns were adjusted while
// looking at those 18 passages, so its Spearman 0.918 on them is an in-sample
// number and overstates what it will do on text it has not seen. Reporting
// that figure as if it were performance would be exactly the kind of borrowed
// confidence the rest of this codebase refuses.
//
// So these passages were written to be scored ONCE, under a rule that is the
// entire point of the file:
//
//   *** NO PATTERN IN persuasionTechniques.js MAY BE CHANGED IN RESPONSE TO
//   *** A RESULT ON THIS CORPUS. If the detector does badly here, the number
//   *** is the finding. Tuning against it converts this into a second
//   *** training set and destroys the only honest measurement we have.
//
// If a genuine defect is found through this corpus, fix it — and then retire
// these items to the calibration corpus and write a fresh holdout. Moving the
// items is honest; quietly tuning against them is not.
//
// WHAT IS DELIBERATELY HERE
//
// The items are not a fair sample of the internet. They are stacked against
// the detector on purpose, because a holdout that only contains text the
// method obviously handles measures nothing:
//
//  - **Paraphrase cases** express a technique with wording no cue list
//    contains ("the window shuts Friday" for Appeal to Time). These probe the
//    recall ceiling that DETECTOR_LIMITS admits to.
//  - **Trap cases** are benign passages that borrow manipulative-sounding
//    vocabulary — a security notice that must say "suspicious activity", a
//    postmortem that must say "destroyed". These probe precision, and they are
//    the failure mode that matters most: a false positive on an honest message
//    is worse than a miss on a manipulative one.
//
// Labels are ordinal for the same reason as the calibration corpus: we can
// defend that one passage carries more pressure than another, not that it
// scores 71. `techniques` lists what a human annotator would tag, so per-class
// recall is measurable rather than inferred from the aggregate.

/** @typedef {'low'|'moderate'|'high'|'extreme'} Level */

export const HOLDOUT_CORPUS = Object.freeze([
  // ---- Plain cases: technique present, phrasing reasonably conventional ----
  {
    id: 'renewal-pressure-email',
    kind: 'plain',
    content: 'Your subscription lapses at midnight and we cannot restore your history afterwards. '
      + 'Renew now to keep everything you have built.',
    labels: { manipulationRisk: 'high' },
    techniques: ['appeal-to-time', 'appeal-to-fear'],
  },
  {
    id: 'wellness-authority-post',
    kind: 'plain',
    content: 'Doctors agree that this one mineral is the reason some people never get sick. '
      + 'Studies show the difference is dramatic, and nobody in the industry wants it discussed.',
    labels: { manipulationRisk: 'extreme' },
    techniques: ['appeal-to-authority', 'exaggeration', 'doubt'],
  },
  {
    id: 'cohort-bandwagon-ad',
    kind: 'plain',
    content: 'Everyone in your field has already joined the thousands who made the switch this year. '
      + 'Do not be the last one still doing it the slow way.',
    labels: { manipulationRisk: 'high' },
    techniques: ['bandwagon'],
  },
  {
    id: 'political-labelling-post',
    kind: 'plain',
    content: 'The establishment shills will call this a conspiracy, because that is what liars do '
      + 'when the rigged system they built starts to show cracks. Wake up.',
    labels: { manipulationRisk: 'extreme' },
    techniques: ['name-calling', 'loaded-language', 'doubt'],
  },
  {
    id: 'vague-incident-statement',
    kind: 'plain',
    content: 'Certain users may have experienced degraded service during recent events. '
      + 'We remain committed to the highest standards and steps are being taken.',
    labels: { manipulationRisk: 'moderate' },
    techniques: ['obfuscation'],
  },
  {
    id: 'ultimatum-upgrade-notice',
    kind: 'plain',
    content: 'Confirm your billing details within 48 hours or your workspace will be archived. '
      + 'There is no other option once the grace period ends.',
    labels: { manipulationRisk: 'high' },
    techniques: ['false-dilemma', 'appeal-to-time'],
  },
  {
    id: 'inheritance-lure-email',
    kind: 'plain',
    content: 'Congratulations — you have been selected as the beneficiary of unclaimed funds held in our care. '
      + 'To release your prize, simply confirm your account and pay the small processing charge.',
    labels: { manipulationRisk: 'extreme' },
    techniques: ['prize-lure', 'exaggeration'],
  },
  {
    id: 'closing-argument-cliche',
    kind: 'plain',
    content: 'We looked at the numbers and it is what it is. End of story. '
      + 'If you have to ask why, this role probably is not for you.',
    labels: { manipulationRisk: 'high' },
    techniques: ['thought-terminating', 'guilt-appeal'],
  },

  // ---- Paraphrase cases: technique present, phrasing outside the cue lists ----
  {
    id: 'paraphrased-scarcity',
    kind: 'paraphrase',
    content: 'The window shuts Friday and we are not reopening it. '
      + 'Two places remain from the original nine, and when they are taken that is the end of the intake.',
    labels: { manipulationRisk: 'high' },
    techniques: ['appeal-to-time'],
  },
  {
    id: 'paraphrased-fear',
    kind: 'paraphrase',
    content: 'Most people discover the problem only when the bill arrives and by then the account cannot be unwound. '
      + 'Every month you wait makes the hole deeper.',
    labels: { manipulationRisk: 'high' },
    techniques: ['appeal-to-fear'],
  },
  {
    id: 'paraphrased-authority',
    kind: 'paraphrase',
    content: 'The people who actually run these systems for a living reached the same conclusion years ago. '
      + 'Take it from someone with two decades in the field.',
    labels: { manipulationRisk: 'moderate' },
    techniques: ['appeal-to-authority'],
  },
  {
    id: 'paraphrased-doubt',
    kind: 'paraphrase',
    content: 'Ask yourself why this never comes up in the coverage you are shown. '
      + 'The people paid to explain it to you have not been forthcoming.',
    labels: { manipulationRisk: 'high' },
    techniques: ['doubt'],
  },

  // ---- Trap cases: benign, but borrowing manipulative-sounding vocabulary ----
  {
    id: 'genuine-security-alert',
    kind: 'trap',
    content: 'We detected a sign-in from a device you have not used before, so we paused the session as a precaution. '
      + 'If it was you, no action is needed. If it was not, reset your password using the link in your account settings; '
      + 'we will never ask for it by email.',
    labels: { manipulationRisk: 'low' },
    techniques: [],
  },
  {
    id: 'postmortem-with-hard-words',
    kind: 'trap',
    content: 'The migration destroyed the read replica and we lost four hours of analytics data, which is unrecoverable. '
      + 'The risk was identified in review and we shipped anyway; that decision was mine. '
      + 'The rollback procedure is now tested weekly.',
    labels: { manipulationRisk: 'low' },
    techniques: [],
  },
  {
    id: 'honest-limited-run',
    kind: 'trap',
    content: 'We only made two hundred of these because that is how many the workshop could finish before the lease ended. '
      + 'When they are gone we will not make more, and we would rather say that plainly than pretend otherwise.',
    labels: { manipulationRisk: 'low' },
    techniques: [],
  },
  {
    id: 'measured-deadline-with-reason',
    kind: 'trap',
    content: 'Applications close on 14 March because interviews run the following week and the panel is fixed. '
      + 'If that does not work, the next round opens in September on the same terms.',
    labels: { manipulationRisk: 'low' },
    techniques: [],
  },
  {
    id: 'emphatic-but-honest-pitch',
    kind: 'trap',
    content: 'This is the best tool we have shipped, and I say that knowing everyone claims it. '
      + 'The difference is the benchmark in the appendix: 40% fewer retries on the same workload, measured over six weeks. '
      + 'If it does not do that for you, tell us and we will refund it.',
    labels: { manipulationRisk: 'low' },
    techniques: [],
  },
]);

export const HOLDOUT_KINDS = Object.freeze(['plain', 'paraphrase', 'trap']);

export const HOLDOUT_PROTOCOL = 'Written to be scored once. Detector patterns must not be tuned '
  + 'against these passages — a result here is a measurement, not a target. Stacked deliberately '
  + 'toward paraphrases (recall) and benign look-alikes (precision).';
