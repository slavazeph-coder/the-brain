// A short captioned video of the current map and its robot run, made on this device: a slow orbit, the largest obstacles
// called out with their sizes, the route replay, and a closing card that says what the scale and the run are. It draws
// the same map the planner used with the same renderer, so it shows nothing the map does not hold.
import {createRenderer} from './renderer.mjs';

export const VIDEO = Object.freeze({width: 1280, height: 720, mapWidth: 853, mapHeight: 400, mapScale: 1.5, callouts: 3});

const metres = v => `${(Math.round(v * 10) / 10).toLocaleString('en')} m`;
const ease = u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;

/** What the video says about the map's scale, from the map's own provenance and review state. */
export function scaleLabel(world) {
  if (world?.provenance === 'authored') return 'Authored sample, not a reconstruction';
  if (world?.provenance === 'generated') return 'Generated, visual only: not a collision map';
  const said = String(world?.geometrySource?.warnings?.[0] || '');
  const base = /self-reported/.test(said) ? 'Scale from a distance you measured'
    : /metric-depth model/.test(said) ? 'Scale estimated by a depth model, not measured'
      : /assumed/.test(said) ? 'Scale assumed from the phone height, not measured'
        : world?.geometrySource?.kind === 'reconstruction-proposal' ? 'Scale unverified' : 'Imported map';
  return world?.scaleReviewed ? `${base}; checked by you` : base;
}

/** The video as scenes of {seconds, caption, card?, yaw:[from, to], zoom:[from, to], select?, cursor?:[from, to]}.
 *  Pure, so the story can be tested without a browser. */
export function storyboard(world, result, robot) {
  if (!world) throw new Error('Open or build a map first.');
  const obstacles = world.objects.filter(o => o.kind === 'obstacle' || o.kind === 'no-go');
  const unseen = world.objects.filter(o => o.kind === 'unknown').reduce((sum, o) => sum + o.w * o.d, 0);
  const largest = [...obstacles].sort((a, b) => b.w * b.d - a.w * a.d).slice(0, VIDEO.callouts);
  const minutes = s => Math.max(1, Math.round(s / 60));
  const label = scaleLabel(world);
  let yaw = -.55;
  const turn = by => { const from = yaw; yaw += by; return [from, yaw]; };
  const scenes = [{seconds: 3, card: {kicker: 'BRAINSNN · WORLD BUILDER', title: world.name, sub: `${metres(world.width)} × ${metres(world.depth)} · ${label}`}}];
  scenes.push({seconds: 5, yaw: turn(.8), zoom: [.92, 1.08],
    caption: `${metres(world.width)} × ${metres(world.depth)} · ${obstacles.length} obstacle${obstacles.length === 1 ? '' : 's'}${unseen > .05 ? ` · ${Math.round(unseen)} m² unknown, kept blocked` : ''}`});
  for (const o of largest)
    scenes.push({seconds: 2.4, yaw: turn(.22), zoom: [1.08, 1.08], select: o.id,
      caption: `${o.name} · ${metres(o.w)} × ${metres(o.d)}, ${metres(o.h)} tall`});
  if (result?.route?.length) {
    const what = result.goal
      ? `${robot.name}: route to the goal, ${metres(result.distance)}, about ${minutes(result.travelSeconds)} min`
      : `${robot.name}: ${Math.round(result.reachableArea)} m² reached, ${Math.round(result.distance).toLocaleString('en')} m of travel, about ${minutes(result.travelSeconds)} min`;
    scenes.push({seconds: 7, yaw: turn(.35), zoom: [1.08, 1.15], cursor: [0, 1], caption: what});
  } else {
    scenes.push({seconds: 3, yaw: turn(.3), zoom: [1.08, 1.1], caption: 'No robot run yet: review the map and plan to add the route'});
  }
  scenes.push({seconds: 4, card: {kicker: 'BRAINSNN.COM · WORLD BUILDER', title: 'Turn any world into a robot simulation.',
    sub: `${label}. ${result?.route?.length ? 'A simulation on this map; no robot moved.' : 'No route planned.'} Made from the map, not a render of the real place.`}});
  return scenes;
}

/** The first format this browser can record: MP4 where offered (Safari, recent Chrome), else WebM. */
export function pickMime(supported) {
  for (const type of ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    if (supported(type)) return type;
  return '';
}

function wrap(g, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Records the storyboard in real time (about 25 s) and returns {blob, type, seconds}. Keep the tab visible: browsers
 *  pause animation in hidden tabs. */
export async function recordShareVideo({world, result, robot, onProgress, signal} = {}) {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream)
    throw new Error('This browser cannot record video. Try a current Chrome or Safari.');
  const scenes = storyboard(world, result, robot), total = scenes.reduce((sum, s) => sum + s.seconds, 0);
  const stage = document.createElement('canvas');
  stage.width = VIDEO.width; stage.height = VIDEO.height;
  const g = stage.getContext('2d'), inner = document.createElement('canvas');
  const map = createRenderer(inner, {wheelZoom: false, fixed: {width: VIDEO.mapWidth, height: VIDEO.mapHeight}});
  map.setWorld(world); map.setResult(result?.route?.length ? result : null);
  const label = scaleLabel(world), font = 'Inter,system-ui,sans-serif', mono = '"JetBrains Mono",ui-monospace,monospace';
  function paint(t) {
    let start = 0, scene = scenes[scenes.length - 1];
    for (const s of scenes) { if (t < start + s.seconds) { scene = s; break; } start += s.seconds; }
    const u = Math.min(1, Math.max(0, (t - start) / scene.seconds)), e = ease(u);
    g.fillStyle = '#06060a'; g.fillRect(0, 0, VIDEO.width, VIDEO.height);
    g.textAlign = 'center';
    if (scene.card) {
      const {kicker, title, sub} = scene.card;
      g.globalAlpha = Math.min(1, u * 4, (1 - u) * 6 + .15);
      g.fillStyle = '#00f5ff'; g.font = `500 20px ${mono}`; g.fillText(kicker, VIDEO.width / 2, 250);
      g.fillStyle = '#f1f1f6'; g.font = `650 52px ${font}`;
      wrap(g, title, 1100).slice(0, 2).forEach((line, i) => g.fillText(line, VIDEO.width / 2, 330 + i * 62));
      g.fillStyle = '#9aa0b4'; g.font = `500 24px ${font}`;
      wrap(g, sub, 1050).slice(0, 3).forEach((line, i) => g.fillText(line, VIDEO.width / 2, 470 + i * 34));
      g.globalAlpha = 1;
      return;
    }
    map.setView({yaw: scene.yaw[0] + (scene.yaw[1] - scene.yaw[0]) * e, zoom: scene.zoom[0] + (scene.zoom[1] - scene.zoom[0]) * e});
    map.setSelected(scene.select || '');
    map.setCursor(scene.cursor ? scene.cursor[0] + (scene.cursor[1] - scene.cursor[0]) * u : 0);  // the route replays in its own scene
    g.drawImage(inner, 0, 50, VIDEO.mapWidth * VIDEO.mapScale, VIDEO.mapHeight * VIDEO.mapScale);
    g.textAlign = 'left'; g.fillStyle = '#00f5ff'; g.font = `500 16px ${mono}`; g.fillText('BRAINSNN · WORLD BUILDER', 36, 40);
    g.textAlign = 'right'; g.fillStyle = '#9aa0b4'; g.fillText(label, VIDEO.width - 36, 40);
    g.font = `600 28px ${font}`; g.textAlign = 'center';
    const lines = wrap(g, scene.caption, 1080).slice(0, 2), boxHeight = 30 + lines.length * 36, top = VIDEO.height - boxHeight - 26;
    g.fillStyle = 'rgba(6,6,10,.88)'; g.strokeStyle = 'rgba(0,245,255,.55)'; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect((VIDEO.width - 1140) / 2, top, 1140, boxHeight, 14); g.fill(); g.stroke();
    g.fillStyle = '#f1f1f6'; lines.forEach((line, i) => g.fillText(line, VIDEO.width / 2, top + 44 + i * 36));
  }
  const type = pickMime(t => MediaRecorder.isTypeSupported(t));
  const stream = stage.captureStream(30), recorder = new MediaRecorder(stream, type ? {mimeType: type, videoBitsPerSecond: 6_000_000} : {}), chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  paint(0); recorder.start(250);
  try {
    await new Promise((resolve, reject) => {
      const t0 = performance.now();
      const frame = now => {
        if (signal?.aborted) { reject(new DOMException('Recording cancelled.', 'AbortError')); return; }
        const t = (now - t0) / 1000;
        paint(Math.min(t, total)); onProgress?.(Math.min(1, t / total));
        if (t >= total) resolve(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  } finally {
    recorder.stop(); stream.getTracks().forEach(track => track.stop()); await stopped; map.destroy();
  }
  return {blob: new Blob(chunks, {type: recorder.mimeType || type || 'video/webm'}), type: recorder.mimeType || type || 'video/webm', seconds: Math.round(total)};
}
