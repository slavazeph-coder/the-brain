export const MAX_SCAN_CHARS = 12000;
export const MIN_SCAN_CHARS = 12;

export function validateScanInput(content) {
  const text = String(content || '').trim();
  if (!text) {
    return { valid: false, message: 'Paste content before running a Brain Scan.' };
  }
  if (text.length < MIN_SCAN_CHARS) {
    return { valid: false, message: `Add a little more context (${MIN_SCAN_CHARS} characters minimum).` };
  }
  if (text.length > MAX_SCAN_CHARS) {
    return { valid: false, message: `Keep scans under ${MAX_SCAN_CHARS.toLocaleString()} characters for this version.` };
  }
  return { valid: true, message: '' };
}

export function splitIntoSegments(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 18);
}
