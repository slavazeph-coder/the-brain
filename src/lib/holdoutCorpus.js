export const HOLDOUT_PROTOCOL =
  'Cue patterns in persuasionTechniques.js must not be tuned against this corpus. Holdout passages exist to measure out-of-sample generalisation and false-alarm rates.';

export const HOLDOUT_KINDS = Object.freeze(['plain', 'paraphrase', 'trap']);

export const HOLDOUT_CORPUS = Object.freeze([
  {
    id: 'holdout-plain-scarcity',
    kind: 'plain',
    content: 'Act now — only 3 seats left before midnight! Hurry or you will miss out forever.',
    techniques: ['scarcity', 'urgency'],
    labels: { manipulationRisk: 'extreme' },
  },
  {
    id: 'holdout-plain-fear',
    kind: 'plain',
    content: 'Warning: your account is in immediate danger of suspension unless you verify within 10 minutes.',
    techniques: ['fear_appeal', 'urgency'],
    labels: { manipulationRisk: 'extreme' },
  },
  {
    id: 'holdout-plain-outrage',
    kind: 'plain',
    content: 'Insiders are hiding the shocking truth from you while rigging the system behind closed doors.',
    techniques: ['conspiracy_framing'],
    labels: { manipulationRisk: 'high' },
  },
  {
    id: 'holdout-paraphrase-window',
    kind: 'paraphrase',
    content: 'Enrollment closes when the Friday cohort reaches capacity; applications received after the bell wait until autumn.',
    techniques: ['scarcity'],
    labels: { manipulationRisk: 'moderate' },
  },
  {
    id: 'holdout-paraphrase-social',
    kind: 'paraphrase',
    content: 'Every peer team in your division has already migrated; staying on the legacy workflow leaves your group isolated.',
    techniques: ['social_proof'],
    labels: { manipulationRisk: 'high' },
  },
  {
    id: 'holdout-paraphrase-guilt',
    kind: 'paraphrase',
    content: 'Passing on this review means the rest of the on-call rotation absorbs the risk on your behalf.',
    techniques: ['guilt_appeal'],
    labels: { manipulationRisk: 'high' },
  },
  {
    id: 'holdout-trap-security',
    kind: 'trap',
    content: 'Security notice: we detected suspicious sign-in activity on your token and rotated the credential as a precaution.',
    techniques: [],
    labels: { manipulationRisk: 'low' },
  },
  {
    id: 'holdout-trap-postmortem',
    kind: 'trap',
    content: 'Incident postmortem: an unguarded migration destroyed two staging tables before the replica snapshot restored them.',
    techniques: [],
    labels: { manipulationRisk: 'low' },
  },
  {
    id: 'holdout-trap-medical',
    kind: 'trap',
    content: 'Clinical note: seek urgent care if chest pressure or shortness of breath develops after starting the medication.',
    techniques: [],
    labels: { manipulationRisk: 'low' },
  },
  {
    id: 'holdout-trap-weather',
    kind: 'trap',
    content: 'Municipal advisory: severe flood warning remains in effect until 18:00; avoid low-lying underpasses.',
    techniques: [],
    labels: { manipulationRisk: 'low' },
  },
]);
