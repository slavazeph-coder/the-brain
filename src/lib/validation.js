export function splitIntoSegments(text = '') {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return parts.length ? parts : [cleaned];
}

export function validateContentInput(text = '', { minChars = 4, maxChars = 10000 } = {}) {
  const trimmed = String(text || '').trim();
  if (trimmed.length < minChars) {
    return { valid: false, error: `Please enter at least ${minChars} characters.` };
  }
  if (trimmed.length > maxChars) {
    return { valid: false, error: `Input exceeds ${maxChars} characters.` };
  }
  return { valid: true, value: trimmed };
}
