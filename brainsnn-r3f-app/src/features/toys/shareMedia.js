// Shareable artifacts for the toys: recorded clips, poster frames and score
// cards, each with the brainsnn.com watermark burned in.
//
// Every share path ends in one of two places: the native share sheet with the
// file attached (phones — two taps from toy to posted clip), or a download
// plus the caption on the clipboard (desktops). Nothing is uploaded anywhere;
// the file is made in this browser and handed straight to the person.
import { WATERMARK } from './toyConfig.js';

const BG = '#05070b';
const CYAN = '#68eaff';
const VIOLET = '#947cff';
const TEXT = '#f4f7fb';
const MUTED = '#99a6b7';
const SANS = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// --- capability checks -------------------------------------------------------

export function canRecordClip() {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

/** MP4 first — it posts everywhere; WebM where MP4 recording is unavailable. */
export function pickClipMime() {
  if (!canRecordClip()) return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((type) => {
    try {
      return window.MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  }) || '';
}

export function extensionFor(mime) {
  return String(mime).startsWith('video/mp4') ? 'mp4' : 'webm';
}

// --- delivery ----------------------------------------------------------------

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Hand a file to the person: native share sheet when the platform can share
 * files, otherwise a download with the caption copied alongside.
 * Resolves to 'shared' | 'downloaded' | 'cancelled'.
 */
export async function shareOrDownload({ blob, filename, title, caption }) {
  const file = typeof File !== 'undefined' ? new File([blob], filename, { type: blob.type }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: caption });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      // A share sheet that refuses the file still leaves the download route.
    }
  }
  download(blob, filename);
  if (caption) await copyText(caption);
  return 'downloaded';
}

// --- drawing helpers ---------------------------------------------------------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintBackground(ctx, width, height) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  const violet = ctx.createRadialGradient(width * 0.85, height * 0.1, 0, width * 0.85, height * 0.1, width * 0.9);
  violet.addColorStop(0, 'rgba(148,124,255,0.24)');
  violet.addColorStop(1, 'rgba(148,124,255,0)');
  ctx.fillStyle = violet;
  ctx.fillRect(0, 0, width, height);
  const cyan = ctx.createRadialGradient(width * 0.05, height * 0.55, 0, width * 0.05, height * 0.55, width * 0.8);
  cyan.addColorStop(0, 'rgba(104,234,255,0.13)');
  cyan.addColorStop(1, 'rgba(104,234,255,0)');
  ctx.fillStyle = cyan;
  ctx.fillRect(0, 0, width, height);
}

/** The gradient "B" mark and the watermark text, as on the site header. */
function paintBrand(ctx, x, y, size, { label = WATERMARK, sub = '' } = {}) {
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, CYAN);
  gradient.addColorStop(1, VIOLET);
  ctx.fillStyle = gradient;
  roundRect(ctx, x, y, size, size, size * 0.29);
  ctx.fill();
  ctx.fillStyle = '#041016';
  ctx.font = `900 ${Math.round(size * 0.56)}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('B', x + size / 2, y + size / 2 + size * 0.03);
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT;
  ctx.font = `700 ${Math.round(size * 0.46)}px ${SANS}`;
  ctx.fillText(label, x + size * 1.3, y + (sub ? size * 0.34 : size / 2));
  if (sub) {
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${Math.round(size * 0.3)}px ${SANS}`;
    ctx.fillText(sub, x + size * 1.3, y + size * 0.76);
  }
  ctx.textBaseline = 'alphabetic';
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paintWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const lines = wrapLines(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

/** Draw `source` into the rect using cover-fit around its centre. */
function drawCover(ctx, source, x, y, w, h, zoom = 1) {
  const sw = source.width;
  const sh = source.height;
  if (!sw || !sh) return;
  const scale = Math.max(w / sw, h / sh) * zoom;
  const cw = w / scale;
  const ch = h / scale;
  ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
}

// --- Poke the Brain: clip frames and poster ---------------------------------

export const CLIP = Object.freeze({ width: 720, height: 1280, fps: 30, seconds: 6, outroSeconds: 1.1 });

/**
 * One vertical 9:16 frame: hook on top, the live brain in the middle, the
 * signal count and watermark at the bottom. `outro` 0..1 fades to the end card.
 */
let stageScratch = null;

/** Draw the live canvas into a rect with soft top and bottom edges, via an alpha mask. */
function drawStage(ctx, source, x, y, w, h) {
  if (!source?.width || !source?.height) return;
  if (!stageScratch) stageScratch = document.createElement('canvas');
  const scratch = stageScratch;
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const sctx = scratch.getContext('2d');
  sctx.globalCompositeOperation = 'source-over';
  sctx.clearRect(0, 0, w, h);
  drawCover(sctx, source, 0, 0, w, h, 1.04);
  // Fade the crop out at both edges so it melts into the background instead of
  // ending in a hard line — masked, so the tinted background shows through.
  sctx.globalCompositeOperation = 'destination-in';
  const mask = sctx.createLinearGradient(0, 0, 0, h);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.1, 'rgba(0,0,0,1)');
  mask.addColorStop(0.88, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = mask;
  sctx.fillRect(0, 0, w, h);
  sctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(scratch, x, y);
}

/**
 * One frame: hook on top, the live brain in the middle, the signal count and
 * watermark at the bottom. Works for the 9:16 clip and the 4:5 poster — the
 * stage starts wherever the hook ends, so a long hook never covers the brain.
 * `outro` 0..1 fades to the end card.
 */
export function drawPokeFrame(ctx, { source, width = CLIP.width, height = CLIP.height, count = 0, hook, outro = 0, sponsor = null }) {
  paintBackground(ctx, width, height);
  const pad = Math.round(width * 0.075);

  ctx.fillStyle = CYAN;
  ctx.font = `800 ${Math.round(width * 0.026)}px ${SANS}`;
  ctx.fillText('BRAINSNN · SAPIENT PLAYGROUND', pad, pad + width * 0.03);
  ctx.fillStyle = TEXT;
  const hookSize = Math.round(width * (height / width > 1.5 ? 0.078 : 0.066));
  ctx.font = `600 ${hookSize}px ${SANS}`;
  const hookBottom = paintWrapped(ctx, hook, pad, pad + width * 0.03 + hookSize * 1.35, width - pad * 2, hookSize * 1.14, 3);

  const footerTop = height - pad - width * 0.21;
  const stageTop = Math.round(hookBottom);
  const stageHeight = Math.round(footerTop - stageTop);
  if (source && stageHeight > 40) drawStage(ctx, source, 0, stageTop, width, stageHeight);

  const baseY = height - pad;
  ctx.fillStyle = MUTED;
  ctx.font = `700 ${Math.round(width * 0.024)}px ${SANS}`;
  ctx.fillText('SIGNALS FIRED', pad, baseY - width * 0.16);
  ctx.fillStyle = TEXT;
  ctx.font = `700 ${Math.round(width * 0.1)}px ${MONO}`;
  ctx.fillText(String(count).padStart(4, '0'), pad, baseY - width * 0.06);
  paintBrand(ctx, pad, baseY - width * 0.03, Math.round(width * 0.06), { label: WATERMARK });

  if (outro > 0) {
    ctx.globalAlpha = Math.min(1, outro);
    paintBackground(ctx, width, height);
    ctx.textAlign = 'center';
    ctx.fillStyle = CYAN;
    ctx.font = `800 ${Math.round(width * 0.03)}px ${SANS}`;
    ctx.fillText('YOUR TURN', width / 2, height * 0.4);
    ctx.fillStyle = TEXT;
    ctx.font = `600 ${Math.round(width * 0.085)}px ${SANS}`;
    ctx.fillText('Poke it yourself', width / 2, height * 0.47);
    ctx.fillStyle = CYAN;
    ctx.font = `700 ${Math.round(width * 0.06)}px ${SANS}`;
    ctx.fillText(WATERMARK, width / 2, height * 0.55);
    if (sponsor?.name) {
      ctx.fillStyle = MUTED;
      ctx.font = `500 ${Math.round(width * 0.03)}px ${SANS}`;
      ctx.fillText(`brought to you by ${sponsor.name}`, width / 2, height * 0.64);
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }
}

/**
 * Record a vertical clip of the live canvas. The person keeps playing while it
 * records; the outro card is appended automatically.
 * Returns { done: Promise<{blob, mime}>, cancel() }.
 */
export function recordPokeClip({ source, hook, getCount, sponsor = null, seconds = CLIP.seconds, onProgress }) {
  const mime = pickClipMime();
  if (!mime) return { done: Promise.reject(new Error('Recording is not supported in this browser.')), cancel() {} };
  const canvas = document.createElement('canvas');
  canvas.width = CLIP.width;
  canvas.height = CLIP.height;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(CLIP.fps);
  const recorder = new window.MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  const chunks = [];
  let frame = 0;
  let cancelled = false;
  const total = seconds + CLIP.outroSeconds;
  const started = performance.now();

  const done = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = (event) => reject(event.error || new Error('Recording failed.'));
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (cancelled) reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      else resolve({ blob: new Blob(chunks, { type: mime.split(';')[0] }), mime });
    };
  });

  function tick() {
    if (cancelled) return;
    const elapsed = (performance.now() - started) / 1000;
    const outro = elapsed > seconds ? (elapsed - seconds) / 0.45 : 0;
    drawPokeFrame(ctx, { source, count: getCount(), hook, outro, sponsor });
    onProgress?.(Math.min(1, elapsed / total));
    if (elapsed >= total) {
      if (recorder.state !== 'inactive') recorder.stop();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  recorder.start(250);
  tick();
  return {
    done,
    cancel() {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), type);
  });
}

/** A single poster frame of the brain, same layout as the clip. */
export function renderPokePoster({ source, hook, count, sponsor = null }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  drawPokeFrame(ctx, { source, width: 1080, height: 1350, count, hook, sponsor });
  return canvasToBlob(canvas);
}

// --- Score cards for the other toys -----------------------------------------

/**
 * A 4:5 card: toy name, a big headline (rank or winner), the score, up to four
 * detail lines, the hook and the tagged link. `accent` picks cyan or violet.
 */
export function drawScoreCard(ctx, { width = 1080, height = 1350, toyTitle, headline, score, scoreLabel, lines = [], hook, url, boundary = '', sponsor = null, accent = 'cyan' }) {
  paintBackground(ctx, width, height);
  const pad = 88;
  const accentColor = accent === 'violet' ? VIOLET : CYAN;

  paintBrand(ctx, pad, pad, 64, { label: 'BrainSNN', sub: 'Sapient Playground' });

  ctx.fillStyle = accentColor;
  ctx.font = `800 30px ${SANS}`;
  ctx.fillText(String(toyTitle).toUpperCase(), pad, 300);

  ctx.fillStyle = TEXT;
  ctx.font = `600 104px ${SANS}`;
  let y = paintWrapped(ctx, headline, pad, 412, width - pad * 2, 112, 2);

  if (score != null) {
    y += 34;
    ctx.fillStyle = accentColor;
    ctx.font = `700 150px ${MONO}`;
    ctx.fillText(String(score), pad, y + 110);
    const scoreWidth = ctx.measureText(String(score)).width;
    ctx.fillStyle = MUTED;
    ctx.font = `600 34px ${SANS}`;
    ctx.fillText(scoreLabel || '', pad + scoreWidth + 24, y + 108);
    y += 150;
  }

  ctx.font = `500 36px ${SANS}`;
  ctx.fillStyle = '#c3cedb';
  for (const line of lines.slice(0, 4)) {
    y += 58;
    ctx.fillText(line, pad, y);
  }

  // Panel with the hook and link, like the site's rounded translucent cards.
  const panelY = height - 330;
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  roundRect(ctx, pad - 24, panelY, width - (pad - 24) * 2, 200, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.11)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = TEXT;
  ctx.font = `600 44px ${SANS}`;
  paintWrapped(ctx, hook.charAt(0).toUpperCase() + hook.slice(1), pad, panelY + 76, width - pad * 2, 52, 1);
  ctx.fillStyle = accentColor;
  ctx.font = `600 32px ${SANS}`;
  ctx.fillText(String(url).replace(/^https:\/\/www\./, '').replace(/\?.*$/, ''), pad, panelY + 146);

  ctx.fillStyle = '#677589';
  ctx.font = `500 22px ${SANS}`;
  const footer = [boundary, sponsor?.name ? `brought to you by ${sponsor.name}` : ''].filter(Boolean).join(' · ');
  if (footer) paintWrapped(ctx, footer, pad, height - 82, width - pad * 2, 30, 2);
}

export function renderScoreCard(card) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  drawScoreCard(canvas.getContext('2d'), card);
  return canvasToBlob(canvas);
}

/** Wait for the site fonts so a card never renders in a fallback face. */
export async function fontsReady() {
  try {
    await document.fonts?.ready;
  } catch {
    // A missing font is a cosmetic difference, never a reason not to share.
  }
}
