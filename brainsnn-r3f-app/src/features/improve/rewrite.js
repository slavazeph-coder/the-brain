import { analyzeContentLocally } from '../../lib/analysisEngine.js';

export const REWRITE_GOALS = [
  { id: 'curiosity', label: 'Increase curiosity', description: 'Open with tension, contrast, or a useful unanswered question.' },
  { id: 'trust', label: 'Build trust', description: 'Add proof, specificity, and constraints before asking for action.' },
  { id: 'reduce-risk', label: 'Reduce manipulation', description: 'Remove unsupported scarcity, fear pressure, and forced commands.' },
  { id: 'clarity', label: 'Make it clearer', description: 'Simplify the promise and make the next action obvious.' },
  { id: 'resonance', label: 'More emotionally resonant', description: 'Keep the audience visible without raising pressure.' },
];

function trimSentences(content) {
  return String(content || '').replace(/\s+/g, ' ').trim();
}

export function createRewrite(content, goal = 'trust') {
  const text = trimSentences(content);
  if (!text) return '';
  const softened = text
    .replace(/\blast chance\b/gi, 'a useful moment')
    .replace(/\bact now\b/gi, 'see whether it fits')
    .replace(/\bthey don't want you to know\b/gi, 'the overlooked part is')
    .replace(/\bguaranteed\b/gi, 'designed to help')
    .replace(/\bsecret\b/gi, 'practical signal');

  const openers = {
    curiosity: 'What changes when your message earns attention and trust at the same time?',
    trust: 'Here is the clearest reason to believe this message before you publish it:',
    'reduce-risk': 'Keep the useful urgency, but make the proof do the work:',
    clarity: 'The simpler promise is this:',
    resonance: 'For the person reading this, the real question is simple:',
  };
  const closers = {
    curiosity: 'Use the strongest line, then make the next reason to believe impossible to miss.',
    trust: 'Add one concrete proof point, a customer example, or a measurable constraint before the ask.',
    'reduce-risk': 'Replace pressure with context, then ask for the next step calmly.',
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
