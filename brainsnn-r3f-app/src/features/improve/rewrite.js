import { analyzeContentLocally } from '../../lib/analysisEngine.js';

export const REWRITE_GOALS = [
  { id: 'curiosity', label: 'Increase curiosity', description: 'Open with tension, contrast, or a useful unanswered question.' },
  { id: 'trust', label: 'Build trust', description: 'Add proof, specificity, and constraints before asking for action.' },
  { id: 'reduce-risk', label: 'Reduce manipulation', description: 'Remove unsupported scarcity, fear pressure, and forced commands.' },
  { id: 'urgency', label: 'Add real urgency', description: 'Give the reader an honest, concrete reason to act now.' },
  { id: 'clarity', label: 'Make it clearer', description: 'Simplify the promise and make the next action obvious.' },
  { id: 'resonance', label: 'More emotionally resonant', description: 'Keep the audience visible without raising pressure.' },
];

function trimSentences(content) {
  return String(content || '').replace(/\s+/g, ' ').trim();
}

// Each replacement must read naturally in place (same part of speech,
// works at a sentence start) so the output never looks machine-spliced.
const SOFTENERS = [
  [/\blast chance\b/gi, 'quick heads-up'],
  [/\bact now\b/gi, 'take a look'],
  [/\bthey don't want you to know\b/gi, 'that often gets overlooked'],
  [/\bguaranteed\b/gi, 'designed'],
  [/\bguarantees\b/gi, 'is built to support'],
  [/\bguarantee\b/gi, 'aim for'],
  [/\bsecret\b/gi, 'practical'],
];

function repairSentenceCasing(text) {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (match, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
}

export function createRewrite(content, goal = 'trust') {
  const text = trimSentences(content);
  if (!text) return '';
  const softened = repairSentenceCasing(
    SOFTENERS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text),
  );

  const openers = {
    curiosity: 'What changes when your message earns attention and trust at the same time?',
    trust: 'Here is the clearest reason to believe this message before you publish it:',
    'reduce-risk': 'Keep the useful urgency, but make the proof do the work:',
    urgency: 'Here is why this matters right now, in concrete terms:',
    clarity: 'The simpler promise is this:',
    resonance: 'For the person reading this, the real question is simple:',
  };
  const closers = {
    curiosity: 'Use the strongest line, then make the next reason to believe impossible to miss.',
    trust: 'Add one concrete proof point, a customer example, or a measurable constraint before the ask.',
    'reduce-risk': 'Replace pressure with context, then ask for the next step calmly.',
    urgency: 'Name the real deadline or cost of waiting, and let that fact carry the ask.',
    clarity: 'Name the audience, the outcome, and the action in one clean sequence.',
    resonance: 'Show that you understand the reader before asking them to act.',
  };
  return `${openers[goal] || openers.trust}\n\n${softened}\n\n${closers[goal] || closers.trust}`;
}

export function analyzeRewrite(originalResult, rewriteContent) {
  return analyzeContentLocally({
    content: rewriteContent,
    contentType: originalResult?.contentType || 'text',
    forceFallback: true,
  });
}
