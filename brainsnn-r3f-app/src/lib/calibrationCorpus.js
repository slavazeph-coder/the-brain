// Labelled corpus for calibrating the scoring engine.
//
// Kept separate from CLASSIC_PRESETS (which is a UI gallery) so the evaluation
// set can grow without changing what visitors see, and so the gallery can be
// re-ordered without silently altering a published accuracy figure.
//
// Labels are ORDINAL, not numeric: we can defensibly say phishing carries more
// manipulation pressure than an understated luxury line, but not that it scores
// exactly 84. Every item is an original paraphrase of a recognisable pattern —
// no real brands, products or people.
//
// levels: 'low' < 'moderate' < 'high' < 'extreme'
import { CLASSIC_PRESETS } from './classicPresets.js';

export const LEVEL_RANK = Object.freeze({ low: 0, moderate: 1, high: 2, extreme: 3 });

// Dimension -> the metric id it is evaluated against (see getBusinessMetrics).
export const DIMENSION_METRICS = Object.freeze({
  manipulationRisk: 'manipulationRisk',
  trust: 'trust',
  urgency: 'urgency',
  viralPull: 'shareability',
});

// Ordinal labels for the ten gallery classics, expressed against the
// dimensions above rather than the single headline each teaser advertises.
const CLASSIC_LABELS = {
  'luxury-scarcity-ad': { manipulationRisk: 'moderate', trust: 'moderate', urgency: 'moderate', viralPull: 'moderate' },
  'infomercial-pitch': { manipulationRisk: 'high', trust: 'low', urgency: 'extreme', viralPull: 'moderate' },
  'underdog-brand-ad': { manipulationRisk: 'low', trust: 'high', urgency: 'low', viralPull: 'moderate' },
  'curiosity-gap-hook': { manipulationRisk: 'moderate', trust: 'moderate', urgency: 'low', viralPull: 'extreme' },
  'outrage-bait-post': { manipulationRisk: 'extreme', trust: 'low', urgency: 'high', viralPull: 'high' },
  'account-phishing-email': { manipulationRisk: 'extreme', trust: 'low', urgency: 'extreme', viralPull: 'low' },
  'prize-scam-email': { manipulationRisk: 'extreme', trust: 'low', urgency: 'high', viralPull: 'low' },
  'corporate-non-apology': { manipulationRisk: 'moderate', trust: 'low', urgency: 'low', viralPull: 'low' },
  'sincere-apology': { manipulationRisk: 'low', trust: 'extreme', urgency: 'low', viralPull: 'low' },
  'guru-urgency-pitch': { manipulationRisk: 'high', trust: 'low', urgency: 'high', viralPull: 'moderate' },
};

// Additional labelled items so every dimension has enough spread to rank.
const EXTRA_ITEMS = [
  {
    id: 'plain-status-update',
    archetype: 'Neutral operational notice',
    content: 'Scheduled maintenance runs on Sunday from 02:00 to 04:00 UTC. During that window the dashboard will be read-only. No action is needed from you.',
    labels: { manipulationRisk: 'low', trust: 'high', urgency: 'low', viralPull: 'low' },
  },
  {
    id: 'documented-changelog',
    archetype: 'Evidence-led release note',
    content: 'This release fixes the export timeout reported by fourteen teams. Median export time fell from 42 seconds to 6. The remaining edge case with very large files is tracked and not yet fixed.',
    labels: { manipulationRisk: 'low', trust: 'extreme', urgency: 'low', viralPull: 'low' },
  },
  {
    id: 'measured-deadline-notice',
    archetype: 'Honest deadline',
    content: 'Enrollment closes on 30 November because the cohort starts in December. If you miss it, the next cohort opens in March and the price is unchanged.',
    labels: { manipulationRisk: 'low', trust: 'high', urgency: 'high', viralPull: 'low' },
  },
  {
    id: 'countdown-flash-sale',
    archetype: 'Manufactured scarcity',
    content: 'Only 3 left at this price! The timer resets for nobody. Once the counter hits zero the discount is gone forever, so grab yours now before someone else takes it.',
    labels: { manipulationRisk: 'high', trust: 'low', urgency: 'extreme', viralPull: 'moderate' },
  },
  {
    id: 'fear-health-claim',
    archetype: 'Fear-led health pitch',
    content: 'Doctors are terrified you will find out about this. What you eat every morning is silently destroying you, and the damage may already be irreversible unless you act today.',
    labels: { manipulationRisk: 'extreme', trust: 'low', urgency: 'high', viralPull: 'high' },
  },
  {
    id: 'shareable-insight-post',
    archetype: 'Organic viral insight',
    content: 'I tracked every meeting for a month and found that the ones with a written agenda ended eleven minutes earlier on average. Here is the template I now use for all of them.',
    labels: { manipulationRisk: 'low', trust: 'high', urgency: 'low', viralPull: 'high' },
  },
  {
    id: 'authority-bandwagon-pitch',
    archetype: 'Authority and bandwagon appeal',
    content: 'Everyone serious about their future has already switched. The experts agree, the smart money agrees, and honestly if you still need convincing then this probably is not for you.',
    labels: { manipulationRisk: 'high', trust: 'low', urgency: 'moderate', viralPull: 'moderate' },
  },
  {
    id: 'transparent-limitation',
    archetype: 'Stated limitation',
    content: 'We do not know yet whether this holds for teams larger than fifty. Our sample was twelve companies, all under that size, so treat the number as directional rather than settled.',
    labels: { manipulationRisk: 'low', trust: 'extreme', urgency: 'low', viralPull: 'low' },
  },
];

export const CALIBRATION_CORPUS = [
  ...CLASSIC_PRESETS
    .filter((preset) => CLASSIC_LABELS[preset.id])
    .map((preset) => ({
      id: preset.id,
      archetype: preset.archetype,
      content: preset.content,
      labels: CLASSIC_LABELS[preset.id],
      source: 'classics',
    })),
  ...EXTRA_ITEMS.map((item) => ({ ...item, source: 'calibration' })),
];

export const CALIBRATION_DIMENSIONS = Object.keys(DIMENSION_METRICS);
