import { createVisualViewer } from './visual-viewer.mjs';
import { STRIDE, frameBounds } from './visual-geometry.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const FALLBACK_POINTS = 1600;

function createProjectedViewer(canvas) {
  const context = canvas.getContext('2d');
  if (!context) throw Error('This browser could not start a graphics preview.');
  let points = null, framing = null, yaw = 0.35, pitch = 0.18;
  const resize = new ResizeObserver(draw);
  resize.observe(canvas);

  function draw() {
    const {width, height} = canvas.getBoundingClientRect();
    if (width < 2 || height < 2) return;
    const density = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(width * density);
    canvas.height = Math.ceil(height * density);
    context.setTransform(density, 0, 0, density, 0, 0);
    context.fillStyle = '#05080c';
    context.fillRect(0, 0, width, height);
    if (!points?.length || !framing) return;

    const {center, radius} = framing;
    const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
    const zoom = Math.min(width, height) * 0.43 / radius;
    const step = Math.max(1, Math.ceil(points.length / STRIDE / FALLBACK_POINTS)) * STRIDE;
    const projected = [];
    for (let i = 0; i < points.length; i += step) {
      if (points[i + 9] < 0.004) continue;
      const x = points[i] - center[0], y = points[i + 1] - center[1], z = points[i + 2] - center[2];
      const localZ = x * sy + z * cy;
      projected.push([i, (x * cy - z * sy) * zoom + width / 2,
        height / 2 - (y * cp - localZ * sp) * zoom, y * sp + localZ * cp]);
    }
    projected.sort((a, b) => a[3] - b[3]);
    for (const [i, x, y] of projected) {
      const size = clamp(Math.max(points[i + 3], points[i + 4], points[i + 5]) * zoom, 1.5, 12);
      const r = Math.round(points[i + 6] * 255), g = Math.round(points[i + 7] * 255), b = Math.round(points[i + 8] * 255);
      context.fillStyle = `rgb(${r},${g},${b})`;
      context.globalAlpha = points[i + 9];
      context.beginPath();
      context.arc(x, y, size, 0, 2 * Math.PI);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function turn(dYaw, dPitch) {
    yaw = (yaw + dYaw) % (2 * Math.PI);
    pitch = clamp(pitch + dPitch, -1.4, 1.4);
    draw();
  }
  function reset() {
    if (points?.length) framing = frameBounds(points);
    yaw = 0.35;
    pitch = 0.18;
    draw();
  }
  function key(event) {
    const turns = {ArrowLeft: [0.2, 0], ArrowRight: [-0.2, 0], ArrowUp: [0, 0.2], ArrowDown: [0, -0.2]};
    if (event.key === '0') { event.preventDefault(); reset(); }
    else if (Object.hasOwn(turns, event.key)) { event.preventDefault(); turn(...turns[event.key]); }
  }
  canvas.addEventListener('keydown', key);
  return {set(pointsToDraw, preserve) {
    points = pointsToDraw;
    if (!preserve || !framing) reset();
    else draw();
  }, clear() { points = null; draw(); }, turn, reset,
  dispose() { resize.disconnect(); canvas.removeEventListener('keydown', key); points = framing = null; }};
}

function createPreview(canvas, fallbackCanvas, onStatus) {
  const originalHidden = canvas.hidden;
  const suppliedFallback = fallbackCanvas !== undefined;
  let visual;
  try { visual = createVisualViewer(canvas, onStatus); }
  catch {
    const fallback = fallbackCanvas ?? document.createElement('canvas');
    if (!suppliedFallback) {
      fallback.className = canvas.className;
      fallback.setAttribute('aria-label', 'Projected motion preview');
      fallback.tabIndex = 0;
      canvas.after(fallback);
    }
    const projected = createProjectedViewer(fallback);
    const fallbackHidden = fallback.hidden;
    canvas.hidden = true;
    fallback.hidden = false;
    onStatus('Projected points preview. WebGL2 is needed for oriented splats.');
    return {...projected, mode: 'projected-points', dispose() {
      projected.dispose();
      if (suppliedFallback) fallback.hidden = fallbackHidden;
      else fallback.remove();
      canvas.hidden = originalHidden;
    }};
  }

  return {mode: 'gaussian-splat', set(points, preserveView) {
    visual.setPoints(points, {kind: 'gaussian-splat', preserveView});
  }, clear() { visual.clear(); }, turn(yaw, pitch) {
    if (yaw) visual.rotateYaw(yaw);
    if (pitch) visual.rotatePitch(pitch);
  }, reset() { visual.reset(); }, dispose() { visual.destroy(); }};
}

/** Local playback anchored to source time. Slow decoding skips display frames. */
export function createOpen4DGSPlayer(canvas, {fallbackCanvas, onFrame = () => {}, onStatus = () => {},
  onPlaybackChange = () => {}} = {}) {
  const preview = createPreview(canvas, fallbackCanvas, onStatus);
  const cache = new Map();
  let sequence = null, current = null, revision = 0, playing = false, disposed = false;
  let raf = 0, anchor = 0, playIndex = 0, fitted = false;

  function setPlaying(value) {
    if (playing === value) return;
    playing = value;
    onPlaybackChange(value);
  }
  function pause() {
    revision++;
    cancelAnimationFrame(raf);
    raf = 0;
    setPlaying(false);
  }
  async function present(index, token) {
    const source = sequence;
    if (!source || disposed) return null;
    let frame = cache.get(index);
    if (!frame) frame = await source.loadFrame(index);
    if (token !== revision || source !== sequence || disposed) return null;
    cache.delete(index);
    cache.set(index, frame);
    if (cache.size > 2) cache.delete(cache.keys().next().value);
    if (frame.points.length) {
      preview.set(frame.points, fitted);
      fitted = true;
    } else preview.clear();
    current = frame;
    const {points: _points, ...info} = frame;
    const shown = {...info, visible: frame.visible ?? frame.points.length / STRIDE, renderMode: preview.mode};
    onFrame(shown);
    return shown;
  }
  async function tick(now) {
    raf = 0;
    if (!playing || !sequence || disposed) return;
    const token = revision;
    const final = sequence.frameCount - 1;
    const who = Math.min(final, playIndex + Math.floor(Math.max(0, now - anchor) * sequence.fps / 1000));
    try {
      if (who !== current?.index) await present(who, token);
      if (token !== revision || !playing || disposed) return;
      if (who >= final) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    } catch (error) {
      if (token !== revision || disposed) return;
      pause();
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }
  function clear() {
    if (disposed) return;
    pause();
    cache.clear();
    sequence = current = null;
    fitted = false;
    preview.clear();
  }

  return {renderMode: preview.mode,
    async open(value) {
      if (disposed) return null;
      clear();
      sequence = value;
      return present(0, revision);
    },
    async seek(index) {
      if (!sequence || disposed) return null;
      pause();
      return present(index, revision);
    },
    play() {
      if (!sequence || !current || disposed || playing) return false;
      revision++;
      playIndex = current.index === sequence.frameCount - 1 ? 0 : current.index;
      anchor = performance.now();
      setPlaying(true);
      raf = requestAnimationFrame(tick);
      return true;
    },
    pause, clear,
    orbit(yaw, pitch = 0) {
      if (!current || disposed || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
      preview.turn(yaw, pitch);
    },
    resetView() { if (current && !disposed) preview.reset(); },
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
      preview.dispose();
    },
    get playing() { return playing; },
  };
}
