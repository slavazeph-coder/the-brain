// Shareable score card: composes the text payload (pure, unit-testable) and
// renders a 1200x630 branded PNG. Extends the previous ShareDialog downloadPng.
import { deriveExecutiveVerdict, getBusinessMetrics } from '../../lib/scoreMapping.js';
import { synchronyPalette } from '../brain3d/mapResultToBrain.js';
import { BRAIN_REGIONS } from '../brain3d/brainRegions.js';
import { mapResultToActivities } from '../brain3d/mapResultToBrain.js';

export function composeScoreCardText(result = {}) {
  // Explicit null bypasses the default parameter.
  const safeResult = result || {};
  const verdict = deriveExecutiveVerdict(safeResult);
  const metricMap = Object.fromEntries(getBusinessMetrics(safeResult).map((metric) => [metric.id, metric.value]));
  const raw = String(safeResult.rawContent || '').replace(/\s+/g, ' ').trim();
  const excerpt = raw.length > 90 ? `${raw.slice(0, 87).trimEnd()}…` : raw;
  return {
    headline: verdict.headline,
    decisionScore: verdict.score,
    viralScore: verdict.viralScore,
    viralLabel: verdict.viralLabel,
    excerpt,
    metricRows: [
      ['Hook Strength', metricMap.hookStrength, 'good'],
      ['Trust', metricMap.trust, 'good'],
      ['Viral Pull', verdict.viralScore, 'good'],
      ['Manipulation Risk', metricMap.manipulationRisk, 'risk'],
    ],
    footer: 'brainsnn.com',
    disclaimer: 'AI-estimated content response',
  };
}

export async function renderScoreCardBlob(result, { width = 1200, height = 630 } = {}) {
  const card = composeScoreCardText(result);
  const palette = synchronyPalette(result?.solitonField?.synchrony);
  const activities = mapResultToActivities(result);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#06060a';
  ctx.fillRect(0, 0, width, height);
  const gradient = ctx.createRadialGradient(260, 140, 0, 260, 140, 520);
  gradient.addColorStop(0, 'rgba(0,245,255,0.32)');
  gradient.addColorStop(1, 'rgba(168,85,247,0.02)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#00f5ff';
  ctx.font = '700 26px JetBrains Mono, monospace';
  ctx.fillText('BRAIN SCAN', 72, 78);

  ctx.fillStyle = '#f1f1f6';
  ctx.font = '700 62px Space Grotesk, Inter, sans-serif';
  ctx.fillText(card.headline.slice(0, 28), 72, 158);
  if (card.headline.length > 28) ctx.fillText(card.headline.slice(28, 58), 72, 228);

  if (card.excerpt) {
    // fillText does not wrap; measure and break so the quote never runs into
    // the right-hand score column (centered at x=920).
    ctx.fillStyle = '#9aa0b4';
    ctx.font = 'italic 24px Inter, sans-serif';
    const words = `“${card.excerpt}”`.split(' ');
    const maxWidth = 620;
    const lineHeight = 30;
    let line = '';
    let y = card.headline.length > 28 ? 268 : 214;
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        ctx.fillText(line, 72, y);
        line = word;
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, 72, y);
  }

  // Metric rows (left column)
  const rowsTop = 360;
  card.metricRows.forEach(([label, value, tone], index) => {
    const y = rowsTop + index * 54;
    ctx.fillStyle = '#9aa0b4';
    ctx.font = '26px Inter, sans-serif';
    ctx.fillText(label, 72, y);
    ctx.fillStyle = tone === 'risk' ? '#ef4444' : '#00f5ff';
    ctx.font = '700 32px JetBrains Mono, monospace';
    ctx.fillText(String(value), 380, y);
    // meter
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(450, y - 18, 220, 10);
    ctx.fillStyle = tone === 'risk' ? '#ef4444' : '#00f5ff';
    ctx.fillRect(450, y - 18, Math.max(6, (Number(value) || 0) * 2.2), 10);
  });

  // Decision + viral score blocks (right side)
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f1f1f6';
  ctx.font = '700 96px JetBrains Mono, monospace';
  ctx.fillText(String(card.decisionScore), 920, 210);
  ctx.fillStyle = '#9aa0b4';
  ctx.font = '24px Inter, sans-serif';
  ctx.fillText('Decision score', 920, 246);

  ctx.fillStyle = palette.edge;
  ctx.font = '700 62px JetBrains Mono, monospace';
  ctx.fillText(String(card.viralScore), 920, 340);
  ctx.fillStyle = '#9aa0b4';
  ctx.font = '22px Inter, sans-serif';
  ctx.fillText(`Viral pull — ${card.viralLabel}`, 920, 374);
  ctx.textAlign = 'left';

  // Mini brain constellation (region dots sized by activity)
  const cx = 920;
  const cy = 470;
  BRAIN_REGIONS.forEach((region, index) => {
    const angle = (index / BRAIN_REGIONS.length) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * 90;
    const y = cy + Math.sin(angle) * 52;
    const value = activities[region.code] || 0.2;
    ctx.beginPath();
    ctx.arc(x, y, 5 + value * 11, 0, Math.PI * 2);
    ctx.fillStyle = region.color;
    ctx.globalAlpha = 0.45 + value * 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // Mini attention waveform along the bottom-left
  const curve = Array.isArray(result?.attentionCurve) ? result.attentionCurve : [];
  if (curve.length > 1) {
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    curve.forEach((point, index) => {
      const x = 72 + (index / (curve.length - 1)) * 560;
      const y = 596 - ((Number(point.value) || 0) / 100) * 42;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  ctx.fillStyle = '#7c8294';
  ctx.font = '20px Inter, sans-serif';
  ctx.fillText(card.disclaimer, 72, 622);
  ctx.fillStyle = '#f1f1f6';
  ctx.font = '700 30px Inter, sans-serif';
  ctx.fillText(card.footer, 990, 596);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Score card image could not be generated.');
  return blob;
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Web Share API with file support when available, download otherwise.
export async function shareScoreCard(result) {
  const blob = await renderScoreCardBlob(result);
  const card = composeScoreCardText(result);
  const file = typeof File !== 'undefined' ? new File([blob], 'brainsnn-score.png', { type: 'image/png' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'My BrainSNN score',
        text: `"${card.headline}" — decision score ${card.decisionScore}, viral pull ${card.viralScore}. Scan yours free at brainsnn.com`,
      });
      return { method: 'shared' };
    } catch (error) {
      if (error?.name === 'AbortError') return { method: 'cancelled' };
    }
  }
  downloadBlob('brainsnn-score.png', blob);
  return { method: 'downloaded' };
}
