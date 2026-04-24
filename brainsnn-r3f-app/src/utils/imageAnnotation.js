/**
 * Layer 95 — Image Annotation Overlay
 *
 * Given per-word OCR bounding boxes (from tesseract) and a scanned
 * text, find which words fall inside Firewall-matched spans and
 * return rectangles that can be painted on a canvas overlay atop
 * the original image.
 */

import { getActiveRules } from './cognitiveFirewall';

function collectMatches(text) {
  const rules = getActiveRules();
  const matches = [];
  for (const [category, list] of Object.entries(rules)) {
    for (const re of list) {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const cloned = (() => {
        try { return new RegExp(re.source, flags); } catch { return null; }
      })();
      if (!cloned) continue;
      let m;
      while ((m = cloned.exec(text)) !== null) {
        if (!m[0]) { cloned.lastIndex++; continue; }
        matches.push({
          category,
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
        });
        if (matches.length > 200) break;
      }
    }
  }
  return matches;
}

// Map each OCR word to its start index in the reconstructed text.
// tesseract returns words in reading order, but text often contains
// line breaks + multiple spaces — we reconstruct by concatenating
// word.text separated by single spaces and keep a parallel offset
// array so index-into-text ↔ word-index is recoverable.
function indexWords(words) {
  let text = '';
  const offsets = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i > 0) text += ' ';
    offsets.push({ start: text.length, end: text.length + (w.text || '').length, wordIdx: i });
    text += w.text || '';
  }
  return { text, offsets };
}

export const BOX_COLORS = {
  urgency: '#fdab43',
  outrage: '#e57b40',
  certainty: '#a86fdf',
  fear: '#dd6974',
};

/**
 * Given OCR result ({ words, imageSize }), find matched spans and
 * return the set of { x, y, w, h, category, text } boxes to paint
 * on the image canvas.
 */
export function annotateMatches({ words = [], imageSize = null }) {
  if (!words.length) return { boxes: [], matchedText: '' };
  const { text, offsets } = indexWords(words);
  const matches = collectMatches(text);

  const boxes = [];
  for (const m of matches) {
    // Find words that overlap the match span
    const hit = [];
    for (const off of offsets) {
      if (off.end >= m.start && off.start <= m.end) hit.push(off.wordIdx);
    }
    if (!hit.length) continue;
    // Merge bounding boxes for all touched words
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const idx of hit) {
      const b = words[idx].bbox;
      if (!b) continue;
      x0 = Math.min(x0, b.x0);
      y0 = Math.min(y0, b.y0);
      x1 = Math.max(x1, b.x1);
      y1 = Math.max(y1, b.y1);
    }
    if (!Number.isFinite(x0)) continue;
    boxes.push({
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      category: m.category,
      text: m.text,
    });
  }

  return { boxes, matchedText: text };
}

/**
 * Paint annotation rectangles onto a canvas context. Caller controls
 * how the canvas is sized / cleared; this just strokes boxes.
 */
export function paintAnnotations(ctx, boxes, { scale = 1 } = {}) {
  if (!ctx || !boxes?.length) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = '12px monospace';
  for (const b of boxes) {
    const color = BOX_COLORS[b.category] || '#77dbe4';
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '30';
    ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
    ctx.strokeRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
    // Tiny label above the box
    const label = b.category;
    ctx.fillStyle = color;
    ctx.fillRect(b.x * scale, (b.y * scale) - 14, label.length * 7, 13);
    ctx.fillStyle = '#0b1224';
    ctx.fillText(label, b.x * scale + 3, (b.y * scale) - 3);
  }
  ctx.restore();
}
