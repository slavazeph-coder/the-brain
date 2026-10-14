// Owner-reviewed pilot contact. This prepares a draft; it sends nothing.
export const RESCUE_CONTACT = 'slavazeph@gmail.com';

export function buildRescueMailto({ email = '', clip = '', notes = '' } = {}) {
  const subject = 'BrainSNN video rescue pilot — clip evaluation';
  const body = [
    'Please evaluate this clip for the BrainSNN video rescue pilot.',
    '',
    `Reply email: ${email.trim()}`,
    `Clip share link: ${clip.trim() || '(add a link before sending)'}`,
    `Problem and timestamps: ${notes.trim() || '(describe the unwanted change)'}`,
    '',
    'Requested scope: one clip up to 15 seconds; brightness or color correction, eligibility checked first.',
    'Proposed budget: US$99 for one clip, only if the result is useful and I accept it.',
    'Please confirm scope and eligibility before processing or payment.',
    'I understand this is a pilot and native HD quality gates have not passed.',
  ].join('\n');
  return `mailto:${RESCUE_CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
