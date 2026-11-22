// The 2D walk map: north up, metres true to scale, no basemap tiles (nothing
// leaves the phone to draw it). Draws the GPS error the walk actually had.
import { featureType, formatMetres, isFix, measureBetween, projector, trackFixes } from './walk-core.mjs';

const TRACK = '#ffa31a';
const niceLength = metres => {
  const power = 10 ** Math.floor(Math.log10(Math.max(metres, 0.1)));
  return [1, 2, 5, 10].map(n => n * power).filter(n => n <= metres).at(-1) ?? power;
};

export function drawWalkMap(canvas, walk, { showTrack = true, showFeatures = true, showError = false, selectedId = null, measure = [], dpr = globalThis.devicePixelRatio || 1 } = {}) {
  // Never draw into a collapsed canvas: a hidden or still-laying-out canvas reports 0 or a few px.
  const width = Math.max(160, canvas.clientWidth || 360), height = Math.max(160, canvas.clientHeight || 320);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0b0d15'; g.fillRect(0, 0, width, height);

  const line = trackFixes(walk);
  const features = (walk.features ?? []).filter(f => Number.isFinite(f.lat) && Number.isFinite(f.lon));
  const anchor = line[0] ?? features[0];
  const hits = [];
  if (!anchor) {
    g.fillStyle = '#c9cbe0'; g.font = '600 16px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('No GPS positions in this walk', width / 2, height / 2 - 8);
    g.font = '14px system-ui, sans-serif'; g.fillStyle = '#9ea1bb';
    g.fillText('Features still have their photos and times below.', width / 2, height / 2 + 16);
    return { hit: () => null };
  }
  const project = projector(anchor);
  const track = line.map(project), pins = features.map(f => ({ f, p: project(f) }));
  const all = [...track, ...pins.map(({ p }) => p)];
  let minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x));
  let minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y));
  // A tiny or stationary walk still shows at least 20 m, so GPS jitter is not blown up to fill the screen.
  const span = Math.max(20, maxX - minX, maxY - minY);
  const pad = 36;
  const fit = Math.min((width - 2 * pad) / Math.max(20, maxX - minX), (height - 2 * pad) / Math.max(20, maxY - minY));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const toScreen = p => ({ x: width / 2 + (p.x - cx) * fit, y: height / 2 - (p.y - cy) * fit });

  // Grid at a round number of metres.
  const step = niceLength(span / 4);
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
  const left = cx - width / 2 / fit, right = cx + width / 2 / fit, bottom = cy - height / 2 / fit, top = cy + height / 2 / fit;
  g.beginPath();
  for (let x = Math.floor(left / step) * step; x <= right; x += step) { const s = toScreen({ x, y: 0 }).x; g.moveTo(s, 0); g.lineTo(s, height); }
  for (let y = Math.floor(bottom / step) * step; y <= top; y += step) { const s = toScreen({ x: 0, y }).y; g.moveTo(0, s); g.lineTo(width, s); }
  g.stroke();

  if (showError) {
    g.fillStyle = 'rgba(124,196,255,0.07)';
    const every = Math.max(1, Math.ceil(line.length / 300));
    line.forEach((fix, i) => { if (i % every) return; const s = toScreen(track[i]); g.beginPath(); g.arc(s.x, s.y, Math.max(0, fix.acc * fit), 0, Math.PI * 2); g.fill(); });
  }
  if (showTrack && track.length) {
    g.strokeStyle = TRACK; g.lineWidth = 4; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    track.forEach((p, i) => { const s = toScreen(p); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
    g.stroke();
    const start = toScreen(track[0]), end = toScreen(track.at(-1));
    g.fillStyle = '#3ddc84'; g.beginPath(); g.arc(start.x, start.y, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.arc(end.x, end.y, 7, 0, Math.PI * 2); g.stroke();
  }
  if (measure.length === 2) {
    const [a, b] = measure.map(id => pins.find(({ f }) => f.id === id)).filter(Boolean);
    const result = a && b ? measureBetween(a.f, b.f) : null;
    if (result) {
      const sa = toScreen(a.p), sb = toScreen(b.p);
      g.setLineDash([8, 6]); g.strokeStyle = '#ffffff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(sa.x, sa.y); g.lineTo(sb.x, sb.y); g.stroke(); g.setLineDash([]);
      const label = `${formatMetres(result.metres)} ±${formatMetres(result.plusMinus)}`;
      g.font = '700 14px system-ui, sans-serif';
      const w = g.measureText(label).width + 16, mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2;
      g.fillStyle = 'rgba(11,13,21,0.9)'; g.fillRect(mx - w / 2, my - 14, w, 28);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, mx, my);
    }
  }
  if (showFeatures) {
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 12px system-ui, sans-serif';
    pins.forEach(({ f, p }) => {
      const s = toScreen(p);
      const number = (walk.features ?? []).indexOf(f) + 1;
      if (showError && Number.isFinite(f.acc)) {
        g.setLineDash([4, 4]); g.strokeStyle = featureType(f.type).colour; g.lineWidth = 1.5;
        g.beginPath(); g.arc(s.x, s.y, Math.max(0, f.acc * fit), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      }
      if (f.id === selectedId || measure.includes(f.id)) { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(s.x, s.y, 15, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = featureType(f.type).colour; g.beginPath(); g.arc(s.x, s.y, 12, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0b0d15'; g.fillText(String(number), s.x, s.y + 0.5);
      hits.push({ id: f.id, x: s.x, y: s.y });
    });
  }

  // Scale bar and north arrow.
  const bar = niceLength((width * 0.28) / fit);
  const barPx = bar * fit;
  g.fillStyle = 'rgba(11,13,21,0.85)'; g.fillRect(10, height - 40, barPx + 20, 30);
  g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.moveTo(20, height - 18); g.lineTo(20 + barPx, height - 18); g.stroke();
  g.fillStyle = '#ffffff'; g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(formatMetres(bar), 20, height - 25);
  g.textAlign = 'center'; g.font = '800 13px system-ui, sans-serif';
  g.fillText('N', width - 22, 22);
  g.beginPath(); g.moveTo(width - 22, 28); g.lineTo(width - 28, 42); g.lineTo(width - 16, 42); g.closePath(); g.fill();

  return {
    hit(x, y) {
      let best = null, bestDistance = 26;
      for (const h of hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bestDistance) { best = h.id; bestDistance = d; } }
      return best;
    },
  };
}

export const hasPositions = walk => (walk.fixes ?? []).some(isFix) || (walk.features ?? []).some(f => Number.isFinite(f.lat));
